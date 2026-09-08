import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import { executeConsoleOrderAction, requestOrderRefund } from '@nexus/orders/order-operations';
import { listConsoleOrders, readConsoleOrderDetail } from '@nexus/orders/order-read';
import { createOrder } from '@nexus/orders/order-write';
import {
  resetCatalog,
  SIMPLE_CORE,
  workerRequest,
} from '../support/catalog-test-env';

beforeEach(resetCatalog);

function commandKey(label: string): string {
  return `${label}_${'x'.repeat(Math.max(0, 16 - label.length - 1))}`.slice(0, 128);
}

function orderBody(productId: string, overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: 'Grace Hopper', email: 'grace@example.com' },
    productId,
    variantId: null,
    quantity: 2,
    ...overrides,
  };
}

async function createProduct(overrides: Record<string, unknown> = {}): Promise<ProductDetailResponse> {
  const response = await workerRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product: { ...SIMPLE_CORE, ...overrides },
      schema: null,
      previewHash: null,
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { product: ProductDetailResponse }).product;
}

async function placeOrder(input: {
  productId: string;
  key: string;
  email?: string;
  name?: string;
  quantity?: number;
}) {
  const order = await createOrder({
    database: env.DB,
    body: orderBody(input.productId, {
      quantity: input.quantity ?? 2,
      customer: {
        name: input.name ?? 'Grace Hopper',
        email: input.email ?? 'grace@example.com',
      },
    }),
    idempotencyKey: input.key,
    capability: `${input.key}_capability_token`,
  });
  const row = await env.DB.prepare('SELECT id FROM orders WHERE reference = ?').bind(order.reference).first<{ id: string }>();
  if (!row) throw new Error('Expected persisted Order identity.');
  return { order, orderId: row.id };
}

async function purchaseSnapshot(orderId: string) {
  const order = await env.DB.prepare(
    `SELECT customer_name, customer_email_normalized, currency, total_minor, created_at
       FROM orders WHERE id = ?`,
  ).bind(orderId).first();
  const line = await env.DB.prepare(
    `SELECT product_id, product_name, variant_id, variant_sku, selected_options_json,
            quantity, unit_price_minor, line_total_minor, currency,
            access_title, access_instructions, private_file_key
       FROM order_lines WHERE order_id = ?`,
  ).bind(orderId).first();
  return { order, line };
}

async function historyActions(orderId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT action FROM order_history WHERE order_id = ? ORDER BY sequence ASC`,
  ).bind(orderId).all<{ action: string }>();
  return rows.results.map((row) => row.action);
}

async function refundCount(orderId: string): Promise<number> {
  return await env.DB.prepare(
    'SELECT count(*) AS count FROM refund_requests WHERE order_id = ?',
  ).bind(orderId).first<number>('count') ?? 0;
}

async function commandCount(requestKey?: string): Promise<number> {
  if (requestKey) {
    return await env.DB.prepare(
      'SELECT count(*) AS count FROM order_commands WHERE request_key = ?',
    ).bind(requestKey).first<number>('count') ?? 0;
  }
  return await env.DB.prepare('SELECT count(*) AS count FROM order_commands').first<number>('count') ?? 0;
}

function paidBody() {
  return { action: 'mark_paid', acknowledgedRefundRequestId: null };
}

function cancelBody() {
  return { action: 'cancel', acknowledgedRefundRequestId: null };
}

function fulfillBody(acknowledgedRefundRequestId: string | null = null) {
  return { action: 'mark_fulfilled', acknowledgedRefundRequestId };
}

function wrapDatabase(database: D1Database, gate: {
  markArrived: () => void;
  released: Promise<void>;
  markSettled: () => void;
}): D1Database {
  return {
    prepare: database.prepare.bind(database),
    exec: database.exec.bind(database),
    batch: async (statements) => {
      gate.markArrived();
      await gate.released;
      try {
        return await database.batch(statements);
      } finally {
        gate.markSettled();
      }
    },
  } as D1Database;
}

function createGate() {
  let markArrived!: () => void;
  let release!: () => void;
  let markSettled!: () => void;
  return {
    arrived: new Promise<void>((resolve) => { markArrived = resolve; }),
    markArrived,
    released: new Promise<void>((resolve) => { release = resolve; }),
    release,
    settled: new Promise<void>((resolve) => { markSettled = resolve; }),
    markSettled,
  };
}

async function raceBatches<T, U>(
  left: (database: D1Database) => Promise<T>,
  right: (database: D1Database) => Promise<U>,
  first: 'left' | 'right',
): Promise<[PromiseSettledResult<T>, PromiseSettledResult<U>]> {
  const leftGate = createGate();
  const rightGate = createGate();
  const leftPromise = left(wrapDatabase(env.DB, leftGate));
  const rightPromise = right(wrapDatabase(env.DB, rightGate));
  await Promise.all([leftGate.arrived, rightGate.arrived]);
  if (first === 'left') {
    leftGate.release();
    await leftGate.settled;
    rightGate.release();
  } else {
    rightGate.release();
    await rightGate.settled;
    leftGate.release();
  }
  return Promise.allSettled([leftPromise, rightPromise]);
}

describe('Order operations domain', () => {
  it('ST04 rejects illegal transitions without writes', async () => {
    const product = await createProduct();
    const pending = await placeOrder({ productId: product.id, key: commandKey('st04-create') });
    const before = await purchaseSnapshot(pending.orderId);

    await expect(executeConsoleOrderAction({
      database: env.DB,
      reference: pending.order.reference,
      body: fulfillBody(),
      idempotencyKey: commandKey('st04-pending-fulfill'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });

    await expect(requestOrderRefund({
      database: env.DB,
      orderId: pending.orderId,
      body: { reason: 'too soon' },
      idempotencyKey: commandKey('st04-pending-refund'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });

    const paid = await executeConsoleOrderAction({
      database: env.DB,
      reference: pending.order.reference,
      body: paidBody(),
      idempotencyKey: commandKey('st04-paid'),
    });
    expect(paid.command).toMatchObject({ outcome: 'applied', replayed: false, resultStatus: 'paid' });
    expect(paid.order.status).toBe('paid');

    await expect(executeConsoleOrderAction({
      database: env.DB,
      reference: pending.order.reference,
      body: cancelBody(),
      idempotencyKey: commandKey('st04-paid-cancel'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });

    const fulfilled = await executeConsoleOrderAction({
      database: env.DB,
      reference: pending.order.reference,
      body: fulfillBody(),
      idempotencyKey: commandKey('st04-fulfill'),
    });
    expect(fulfilled.order.status).toBe('fulfilled');
    expect(fulfilled.order.history.map((entry) => entry.sequence)).toEqual([0, 1, 2]);
    expect(fulfilled.order.history.map((entry) => entry.action)).toEqual([
      'order_created',
      'mark_paid',
      'mark_fulfilled',
    ]);

    await expect(executeConsoleOrderAction({
      database: env.DB,
      reference: pending.order.reference,
      body: cancelBody(),
      idempotencyKey: commandKey('st04-fulfilled-cancel'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    await expect(executeConsoleOrderAction({
      database: env.DB,
      reference: pending.order.reference,
      body: paidBody(),
      idempotencyKey: commandKey('st04-k3'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    await expect(executeConsoleOrderAction({
      database: env.DB,
      reference: pending.order.reference,
      body: fulfillBody(),
      idempotencyKey: commandKey('st04-second-fulfill'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    const frozen = '2026-09-07T00:00:00.000Z';
    await env.DB.prepare('UPDATE order_history SET created_at = ? WHERE order_id = ?').bind(frozen, pending.orderId).run();
    const frozenDetail = await readConsoleOrderDetail(env.DB, pending.order.reference);
    expect(frozenDetail?.history.map((entry) => entry.createdAt)).toEqual([frozen, frozen, frozen]);
    expect(frozenDetail?.history.map((entry) => entry.sequence)).toEqual([0, 1, 2]);
    expect(frozenDetail?.history.map((entry) => entry.action)).toEqual([
      'order_created',
      'mark_paid',
      'mark_fulfilled',
    ]);

    const cancelledProduct = await createProduct({ name: 'Cancel Notes' });
    const cancelled = await placeOrder({
      productId: cancelledProduct.id,
      key: commandKey('st04-cancel-create'),
      email: 'cancel@example.com',
    });
    await executeConsoleOrderAction({
      database: env.DB,
      reference: cancelled.order.reference,
      body: cancelBody(),
      idempotencyKey: commandKey('st04-cancel'),
    });
    await expect(executeConsoleOrderAction({
      database: env.DB,
      reference: cancelled.order.reference,
      body: paidBody(),
      idempotencyKey: commandKey('st04-cancelled-paid'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    await expect(executeConsoleOrderAction({
      database: env.DB,
      reference: cancelled.order.reference,
      body: fulfillBody(),
      idempotencyKey: commandKey('st04-cancelled-fulfill'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    await expect(executeConsoleOrderAction({
      database: env.DB,
      reference: cancelled.order.reference,
      body: cancelBody(),
      idempotencyKey: commandKey('st04-second-cancel'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    await expect(requestOrderRefund({
      database: env.DB,
      orderId: cancelled.orderId,
      body: { reason: 'cancelled order' },
      idempotencyKey: commandKey('st04-cancelled-refund'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });

    expect(await purchaseSnapshot(pending.orderId)).toEqual(before);
    expect(await historyActions(pending.orderId)).toEqual(['order_created', 'mark_paid', 'mark_fulfilled']);
    expect(await commandCount(commandKey('st04-k3'))).toBe(0);
    expect(await commandCount(commandKey('st04-second-fulfill'))).toBe(0);
    expect(await commandCount(commandKey('st04-second-cancel'))).toBe(0);
    expect(await refundCount(pending.orderId)).toBe(0);
    expect(await refundCount(cancelled.orderId)).toBe(0);
  });

  it('TM01 same-key overlapping callers receive equivalent success for all four operations', async () => {
    const product = await createProduct();
    const pending = await placeOrder({ productId: product.id, key: commandKey('tm01-create') });
    const paidKey = commandKey('tm01-paid');
    const [firstPaid, secondPaid] = await raceBatches(
      (database) => executeConsoleOrderAction({
        database, reference: pending.order.reference, body: paidBody(), idempotencyKey: paidKey,
      }),
      (database) => executeConsoleOrderAction({
        database, reference: pending.order.reference, body: paidBody(), idempotencyKey: paidKey,
      }),
      'left',
    );
    expect(firstPaid.status).toBe('fulfilled');
    expect(secondPaid.status).toBe('fulfilled');
    if (firstPaid.status !== 'fulfilled' || secondPaid.status !== 'fulfilled') throw new Error('expected paid success');
    expect(firstPaid.value.command.outcome).toBe(secondPaid.value.command.outcome);
    expect(firstPaid.value.order.status).toBe('paid');
    expect(secondPaid.value.order.status).toBe('paid');
    expect([firstPaid.value.command.replayed, secondPaid.value.command.replayed].sort()).toEqual([false, true]);
    expect(await historyActions(pending.orderId)).toEqual(['order_created', 'mark_paid']);

    const fulfillKey = commandKey('tm01-fulfill');
    const [firstFulfill, secondFulfill] = await raceBatches(
      (database) => executeConsoleOrderAction({
        database, reference: pending.order.reference, body: fulfillBody(), idempotencyKey: fulfillKey,
      }),
      (database) => executeConsoleOrderAction({
        database, reference: pending.order.reference, body: fulfillBody(), idempotencyKey: fulfillKey,
      }),
      'right',
    );
    expect(firstFulfill.status).toBe('fulfilled');
    expect(secondFulfill.status).toBe('fulfilled');
    if (firstFulfill.status !== 'fulfilled' || secondFulfill.status !== 'fulfilled') throw new Error('expected fulfill success');
    expect(firstFulfill.value.order.status).toBe('fulfilled');
    expect(secondFulfill.value.order.status).toBe('fulfilled');
    expect(await historyActions(pending.orderId)).toEqual(['order_created', 'mark_paid', 'mark_fulfilled']);

    const cancelProduct = await createProduct({ name: 'TM01 Cancel' });
    const cancellable = await placeOrder({
      productId: cancelProduct.id, key: commandKey('tm01-cancel-create'), email: 'tm01-cancel@example.com',
    });
    const cancelKey = commandKey('tm01-cancel');
    const [firstCancel, secondCancel] = await raceBatches(
      (database) => executeConsoleOrderAction({
        database, reference: cancellable.order.reference, body: cancelBody(), idempotencyKey: cancelKey,
      }),
      (database) => executeConsoleOrderAction({
        database, reference: cancellable.order.reference, body: cancelBody(), idempotencyKey: cancelKey,
      }),
      'left',
    );
    expect(firstCancel.status).toBe('fulfilled');
    expect(secondCancel.status).toBe('fulfilled');
    expect(await historyActions(cancellable.orderId)).toEqual(['order_created', 'cancel']);

    const refundable = await placeOrder({
      productId: product.id, key: commandKey('tm01-refund-create'), email: 'tm01-refund@example.com',
    });
    await executeConsoleOrderAction({
      database: env.DB,
      reference: refundable.order.reference,
      body: paidBody(),
      idempotencyKey: commandKey('tm01-refund-paid'),
    });
    const refundKey = commandKey('tm01-refund');
    const [firstRefund, secondRefund] = await raceBatches(
      (database) => requestOrderRefund({
        database, orderId: refundable.orderId, body: { reason: 'need help' }, idempotencyKey: refundKey,
      }),
      (database) => requestOrderRefund({
        database, orderId: refundable.orderId, body: { reason: 'need help' }, idempotencyKey: refundKey,
      }),
      'right',
    );
    expect(firstRefund.status).toBe('fulfilled');
    expect(secondRefund.status).toBe('fulfilled');
    if (firstRefund.status !== 'fulfilled' || secondRefund.status !== 'fulfilled') throw new Error('expected refund success');
    expect(firstRefund.value.order.refundRequest?.reason).toBe('need help');
    expect(secondRefund.value.order.refundRequest?.reason).toBe('need help');
    expect(await refundCount(refundable.orderId)).toBe(1);
    expect(await historyActions(refundable.orderId).then((actions) => actions.filter((action) => action === 'refund_requested'))).toEqual(['refund_requested']);
  });

  it('TM02 replays original paid key after fulfill and rejects a new paid key', async () => {
    const product = await createProduct();
    const placed = await placeOrder({ productId: product.id, key: commandKey('tm02-create') });
    const k1 = commandKey('tm02-k1');
    await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: k1,
    });
    await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: fulfillBody(), idempotencyKey: commandKey('tm02-k2'),
    });
    const replay = await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: k1,
    });
    expect(replay.command).toMatchObject({ outcome: 'applied', replayed: true, resultStatus: 'paid' });
    expect(replay.order.status).toBe('fulfilled');
    expect(replay.order.history.filter((entry) => entry.action === 'mark_paid')).toHaveLength(1);

    await expect(executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('tm02-k3'),
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    expect(await historyActions(placed.orderId)).toEqual(['order_created', 'mark_paid', 'mark_fulfilled']);
  });

  it('TM03 paid versus cancel keeps one legal history branch in both commit orders', async () => {
    const product = await createProduct();
    for (const first of ['left', 'right'] as const) {
      const placed = await placeOrder({
        productId: product.id,
        key: commandKey(`tm03-create-${first}`),
        email: `tm03-${first}@example.com`,
      });
      const [paid, cancelled] = await raceBatches(
        (database) => executeConsoleOrderAction({
          database, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey(`tm03-paid-${first}`),
        }),
        (database) => executeConsoleOrderAction({
          database, reference: placed.order.reference, body: cancelBody(), idempotencyKey: commandKey(`tm03-cancel-${first}`),
        }),
        first,
      );
      const winner = paid.status === 'fulfilled' ? paid.value : cancelled.status === 'fulfilled' ? cancelled.value : null;
      const loser = paid.status === 'rejected' ? paid : cancelled;
      expect(winner).not.toBeNull();
      expect(loser.status).toBe('rejected');
      if (loser.status === 'rejected') {
        expect(loser.reason).toMatchObject({ code: 'order_state_conflict', status: 409 });
      }
      const actions = await historyActions(placed.orderId);
      expect(actions).toHaveLength(2);
      expect(actions[0]).toBe('order_created');
      expect(['mark_paid', 'cancel']).toContain(actions[1]);
      expect(actions.includes('mark_paid') && actions.includes('cancel')).toBe(false);
      expect(winner?.order.status).toBe(actions[1] === 'mark_paid' ? 'paid' : 'cancelled');
    }
  });

  it('TM04 concurrent different paid keys apply once', async () => {
    const product = await createProduct();
    const placed = await placeOrder({ productId: product.id, key: commandKey('tm04-create') });
    const [left, right] = await raceBatches(
      (database) => executeConsoleOrderAction({
        database, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('tm04-a'),
      }),
      (database) => executeConsoleOrderAction({
        database, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('tm04-b'),
      }),
      'left',
    );
    expect(left.status).toBe('fulfilled');
    expect(right.status).toBe('fulfilled');
    if (left.status !== 'fulfilled' || right.status !== 'fulfilled') throw new Error('expected paid success');
    const outcomes = [left.value.command.outcome, right.value.command.outcome].sort();
    expect(outcomes).toEqual(['already_applied', 'applied']);
    expect(await historyActions(placed.orderId)).toEqual(['order_created', 'mark_paid']);
  });

  it('TM05 refund versus unacknowledged fulfill honors both legal commit orders', async () => {
    const product = await createProduct();
    for (const first of ['left', 'right'] as const) {
      const placed = await placeOrder({
        productId: product.id,
        key: commandKey(`tm05-create-${first}`),
        email: `tm05-${first}@example.com`,
      });
      await executeConsoleOrderAction({
        database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey(`tm05-paid-${first}`),
      });
      const [refund, fulfill] = await raceBatches(
        (database) => requestOrderRefund({
          database, orderId: placed.orderId, body: { reason: 'please review' }, idempotencyKey: commandKey(`tm05-refund-${first}`),
        }),
        (database) => executeConsoleOrderAction({
          database, reference: placed.order.reference, body: fulfillBody(), idempotencyKey: commandKey(`tm05-fulfill-${first}`),
        }),
        first,
      );
      expect(refund.status).toBe('fulfilled');
      if (refund.status !== 'fulfilled') throw new Error('expected refund success');
      expect(refund.value.order.refundRequest?.reason).toBe('please review');
      expect(await refundCount(placed.orderId)).toBe(1);
      if (first === 'left') {
        expect(fulfill.status).toBe('rejected');
        if (fulfill.status === 'rejected') {
          expect(fulfill.reason).toMatchObject({ code: 'refund_acknowledgement_required', status: 409 });
        }
        expect(refund.value.order.status).toBe('paid');
        expect(await historyActions(placed.orderId)).toEqual(['order_created', 'mark_paid', 'refund_requested']);
      } else {
        expect(fulfill.status).toBe('fulfilled');
        if (fulfill.status !== 'fulfilled') throw new Error('expected fulfill success');
        expect(fulfill.value.order.status).toBe('fulfilled');
        expect(refund.value.order.status).toBe('fulfilled');
        expect(await historyActions(placed.orderId)).toEqual(['order_created', 'mark_paid', 'mark_fulfilled', 'refund_requested']);
      }
    }
  });

  it('DI01 keeps the first refund reason across overlapping keys', async () => {
    const product = await createProduct();
    const placed = await placeOrder({ productId: product.id, key: commandKey('di01-create') });
    await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('di01-paid'),
    });
    const [left, right] = await raceBatches(
      (database) => requestOrderRefund({
        database, orderId: placed.orderId, body: { reason: 'first reason' }, idempotencyKey: commandKey('di01-k1'),
      }),
      (database) => requestOrderRefund({
        database, orderId: placed.orderId, body: { reason: 'second reason' }, idempotencyKey: commandKey('di01-k2'),
      }),
      'left',
    );
    expect(left.status).toBe('fulfilled');
    expect(right.status).toBe('fulfilled');
    if (left.status !== 'fulfilled' || right.status !== 'fulfilled') throw new Error('expected refund success');
    const winnerReason = left.value.command.outcome === 'applied'
      ? left.value.order.refundRequest?.reason
      : right.value.order.refundRequest?.reason;
    expect(winnerReason).toBe('first reason');
    expect(left.value.order.refundRequest?.reason).toBe('first reason');
    expect(right.value.order.refundRequest?.reason).toBe('first reason');
    const later = await requestOrderRefund({
      database: env.DB, orderId: placed.orderId, body: { reason: 'third reason' }, idempotencyKey: commandKey('di01-k3'),
    });
    expect(later.command.outcome).toBe('already_applied');
    expect(later.order.refundRequest?.reason).toBe('first reason');
    expect(await refundCount(placed.orderId)).toBe(1);
  });

  it('DI03 preserves purchase snapshot and money after paid, fulfill, and refund', async () => {
    const product = await createProduct();
    const placed = await placeOrder({ productId: product.id, key: commandKey('di03-create') });
    const before = await purchaseSnapshot(placed.orderId);
    await env.DB.prepare("UPDATE products SET name='Changed', base_price_minor=9999 WHERE id=?").bind(product.id).run();
    await env.DB.prepare("UPDATE customers SET name='Ada Lovelace' WHERE email_normalized='grace@example.com'").run();
    await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('di03-paid'),
    });
    const refund = await requestOrderRefund({
      database: env.DB, orderId: placed.orderId, body: { reason: 'keep snapshot' }, idempotencyKey: commandKey('di03-refund'),
    });
    const fulfilled = await executeConsoleOrderAction({
      database: env.DB,
      reference: placed.order.reference,
      body: fulfillBody(refund.order.refundRequest?.id ?? null),
      idempotencyKey: commandKey('di03-fulfill'),
    });
    expect(fulfilled.order.status).toBe('fulfilled');
    expect(fulfilled.order.refundRequest?.status).toBe('pending');
    expect(fulfilled.order.product.name).toBe('Field Notes');
    expect(fulfilled.order.totalMinor).toBe(4800);
    expect(await purchaseSnapshot(placed.orderId)).toEqual(before);
  });

  it('ER01 rolls back history and command aborts then retries cleanly', async () => {
    const product = await createProduct();
    const placed = await placeOrder({ productId: product.id, key: commandKey('er01-create') });
    const before = await purchaseSnapshot(placed.orderId);
    await env.DB.prepare(`
      CREATE TRIGGER abort_history_write
      BEFORE INSERT ON order_history
      WHEN NEW.action = 'mark_paid'
      BEGIN
        SELECT RAISE(ABORT, 'test_forced_abort');
      END
    `).run();
    await expect(executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('er01-paid'),
    })).rejects.toMatchObject({ code: 'order_persistence_failed', status: 500 });
    expect(await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(placed.orderId).first<string>('status')).toBe('pending_payment');
    expect(await historyActions(placed.orderId)).toEqual(['order_created']);
    expect(await commandCount()).toBe(0);
    expect(await purchaseSnapshot(placed.orderId)).toEqual(before);
    await env.DB.prepare('DROP TRIGGER abort_history_write').run();

    await env.DB.prepare(`
      CREATE TRIGGER abort_command_write
      BEFORE INSERT ON order_commands
      BEGIN
        SELECT RAISE(ABORT, 'test_forced_command_abort');
      END
    `).run();
    await expect(executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('er01-paid-2'),
    })).rejects.toMatchObject({ code: 'order_persistence_failed', status: 500 });
    await env.DB.prepare('DROP TRIGGER abort_command_write').run();

    const retry = await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('er01-paid'),
    });
    expect(retry.command).toMatchObject({ outcome: 'applied', replayed: false, resultStatus: 'paid' });
    expect(await historyActions(placed.orderId)).toEqual(['order_created', 'mark_paid']);
  });

  it('ER02 retries a committed lost response without a second effect', async () => {
    const product = await createProduct();
    const placed = await placeOrder({ productId: product.id, key: commandKey('er02-create') });
    const key = commandKey('er02-paid');
    let dropped = false;
    const commitThenDrop = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: async (statements: D1PreparedStatement[]) => {
        const result = await env.DB.batch(statements);
        if (!dropped) {
          dropped = true;
          throw new Error('lost response after commit');
        }
        return result;
      },
    } as unknown as D1Database;
    const committed = await executeConsoleOrderAction({
      database: commitThenDrop, reference: placed.order.reference, body: paidBody(), idempotencyKey: key,
    });
    expect(committed.command).toMatchObject({ outcome: 'applied', replayed: false, resultStatus: 'paid' });
    const retry = await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: key,
    });
    expect(retry.command).toMatchObject({ outcome: 'applied', replayed: true, resultStatus: 'paid' });
    expect(retry.order.status).toBe('paid');
    expect(await historyActions(placed.orderId)).toEqual(['order_created', 'mark_paid']);
    expect(await commandCount(key)).toBe(1);
  });

  it('ER03 surfaces persistence failure without a false success', async () => {
    const product = await createProduct();
    const placed = await placeOrder({ productId: product.id, key: commandKey('er03-create') });
    const unavailable = {
      prepare() { throw new Error('database unavailable'); },
      batch() { throw new Error('database unavailable'); },
    } as unknown as D1Database;
    await expect(executeConsoleOrderAction({
      database: unavailable, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('er03-paid'),
    })).rejects.toMatchObject({ code: 'order_persistence_failed', status: 500 });
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(placed.orderId).first<string>('status')).toBe('pending_payment');
  });

  it('BL01 does not auto-pay a zero-total Order', async () => {
    const product = await createProduct({ name: 'Free Notes', basePrice: '0.00' });
    const placed = await placeOrder({ productId: product.id, key: commandKey('bl01-create'), quantity: 1 });
    expect(placed.order.totalMinor).toBe(0);
    expect(placed.order.status).toBe('pending_payment');
    const paid = await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('bl01-paid'),
    });
    expect(paid.order.status).toBe('paid');
    expect(paid.order.totalMinor).toBe(0);
    const fulfilled = await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: fulfillBody(), idempotencyKey: commandKey('bl01-fulfill'),
    });
    expect(fulfilled.order.status).toBe('fulfilled');
    expect(fulfilled.order.totalMinor).toBe(0);
  });

  it('BL02 requires exact refund acknowledgement then keeps the request pending', async () => {
    const product = await createProduct();
    const placed = await placeOrder({ productId: product.id, key: commandKey('bl02-create') });
    await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('bl02-paid'),
    });
    const refund = await requestOrderRefund({
      database: env.DB, orderId: placed.orderId, body: { reason: 'please look' }, idempotencyKey: commandKey('bl02-refund'),
    });
    const refundId = refund.order.refundRequest?.id;
    expect(refundId).toMatch(/^refund_[a-f0-9]{32}$/);
    await expect(executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: fulfillBody(), idempotencyKey: commandKey('bl02-fulfill-1'),
    })).rejects.toMatchObject({ code: 'refund_acknowledgement_required', status: 409 });
    await expect(executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: fulfillBody('refund_ffffffffffffffffffffffffffffffff'), idempotencyKey: commandKey('bl02-fulfill-wrong'),
    })).rejects.toMatchObject({ code: 'refund_acknowledgement_required', status: 409 });
    const confirmed = await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: fulfillBody(refundId ?? null), idempotencyKey: commandKey('bl02-fulfill-2'),
    });
    expect(confirmed.order.status).toBe('fulfilled');
    expect(confirmed.order.refundRequest).toMatchObject({ id: refundId, reason: 'please look', status: 'pending' });
    expect(confirmed.order.history.at(-1)).toMatchObject({
      action: 'mark_fulfilled',
      refundRequestId: refundId,
    });
    expect(confirmed.order.allowedActions).toEqual([]);
  });

  it('IN01 enforces Unicode reason rules without occupying the refund slot', async () => {
    const product = await createProduct();
    const placed = await placeOrder({ productId: product.id, key: commandKey('in01-create') });
    await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('in01-paid'),
    });

    const invalid = [
      { body: { reason: null }, label: 'null' },
      { body: { reason: 12 }, label: 'number' },
      { body: { reason: '   ' }, label: 'whitespace' },
      { body: { reason: `bad${String.fromCharCode(0)}reason` }, label: 'nul' },
      { body: { reason: 'a'.repeat(1001) }, label: '1001' },
      { body: { reason: String.fromCharCode(0xD800) }, label: 'isolated-surrogate' },
    ];
    for (const [index, sample] of invalid.entries()) {
      const result = await requestOrderRefund({
        database: env.DB,
        orderId: placed.orderId,
        body: sample.body,
        idempotencyKey: commandKey(`in01-bad-${index}`),
      }).then(
        (ok) => {
          throw new Error(`${sample.label} applied reason=${ok.order.refundRequest?.reason}`);
        },
        (error: unknown) => error,
      );
      expect(result, sample.label).toMatchObject({
        code: 'validation_failed',
        status: 422,
        fields: [expect.objectContaining({ path: '/reason' })],
      });
    }
    expect(await refundCount(placed.orderId)).toBe(0);

    const one = await requestOrderRefund({
      database: env.DB, orderId: placed.orderId, body: { reason: 'a' }, idempotencyKey: commandKey('in01-one'),
    });
    expect(one.order.refundRequest?.reason).toBe('a');
    await env.DB.prepare('DELETE FROM order_commands').run();
    await env.DB.prepare('DELETE FROM order_history WHERE action = ?').bind('refund_requested').run();
    await env.DB.prepare('DELETE FROM refund_requests').run();

    const thousand = 'é'.repeat(1000);
    const storedThousand = await requestOrderRefund({
      database: env.DB, orderId: placed.orderId, body: { reason: thousand }, idempotencyKey: commandKey('in01-1000'),
    });
    expect(storedThousand.order.refundRequest?.reason).toBe(thousand);
    await env.DB.prepare('DELETE FROM order_commands').run();
    await env.DB.prepare('DELETE FROM order_history WHERE action = ?').bind('refund_requested').run();
    await env.DB.prepare('DELETE FROM refund_requests').run();

    const astral = '𝄞';
    const combining = 'e\u0301';
    const zwj = '👩‍👩‍👧';
    for (const [index, reason] of [astral, combining, zwj].entries()) {
      const result = await requestOrderRefund({
        database: env.DB, orderId: placed.orderId, body: { reason: `  ${reason}  ` }, idempotencyKey: commandKey(`in01-unicode-${index}`),
      });
      expect(result.order.refundRequest?.reason).toBe(reason);
      await env.DB.prepare('DELETE FROM order_commands').run();
      await env.DB.prepare('DELETE FROM order_history WHERE action = ?').bind('refund_requested').run();
      await env.DB.prepare('DELETE FROM refund_requests').run();
    }
  });

  it('IN03 rejects same-key changes of Order, action, or reason without mutation', async () => {
    const product = await createProduct();
    const first = await placeOrder({ productId: product.id, key: commandKey('in03-create-a'), email: 'in03-a@example.com' });
    const second = await placeOrder({ productId: product.id, key: commandKey('in03-create-b'), email: 'in03-b@example.com' });
    const shared = commandKey('in03-shared');
    await executeConsoleOrderAction({
      database: env.DB, reference: first.order.reference, body: paidBody(), idempotencyKey: shared,
    });
    const firstBefore = await purchaseSnapshot(first.orderId);
    const secondBefore = await purchaseSnapshot(second.orderId);
    await expect(executeConsoleOrderAction({
      database: env.DB, reference: second.order.reference, body: paidBody(), idempotencyKey: shared,
    })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    await expect(executeConsoleOrderAction({
      database: env.DB, reference: first.order.reference, body: cancelBody(), idempotencyKey: shared,
    })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    expect(await purchaseSnapshot(first.orderId)).toEqual(firstBefore);
    expect(await purchaseSnapshot(second.orderId)).toEqual(secondBefore);

    const refundKey = commandKey('in03-refund');
    await requestOrderRefund({
      database: env.DB, orderId: first.orderId, body: { reason: 'original' }, idempotencyKey: refundKey,
    });
    await expect(requestOrderRefund({
      database: env.DB, orderId: first.orderId, body: { reason: 'changed' }, idempotencyKey: refundKey,
    })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    expect(await env.DB.prepare('SELECT reason FROM refund_requests WHERE order_id = ?').bind(first.orderId).first<string>('reason')).toBe('original');
  });

  it('same-key different-Order refund leaves the loser with zero writes', async () => {
    const product = await createProduct();
    const winner = await placeOrder({ productId: product.id, key: commandKey('cross-create-a'), email: 'cross-a@example.com' });
    const loser = await placeOrder({ productId: product.id, key: commandKey('cross-create-b'), email: 'cross-b@example.com' });
    await executeConsoleOrderAction({
      database: env.DB, reference: winner.order.reference, body: paidBody(), idempotencyKey: commandKey('cross-paid-a'),
    });
    await executeConsoleOrderAction({
      database: env.DB, reference: loser.order.reference, body: paidBody(), idempotencyKey: commandKey('cross-paid-b'),
    });
    const shared = commandKey('cross-refund');
    const [left, right] = await raceBatches(
      (database) => requestOrderRefund({
        database, orderId: winner.orderId, body: { reason: 'winner reason' }, idempotencyKey: shared,
      }),
      (database) => requestOrderRefund({
        database, orderId: loser.orderId, body: { reason: 'loser reason' }, idempotencyKey: shared,
      }),
      'left',
    );
    expect(left.status).toBe('fulfilled');
    expect(right.status).toBe('rejected');
    if (right.status === 'rejected') {
      expect(right.reason).toMatchObject({ code: 'idempotency_conflict', status: 409 });
    }
    expect(await refundCount(winner.orderId)).toBe(1);
    expect(await refundCount(loser.orderId)).toBe(0);
    expect(await historyActions(loser.orderId)).toEqual(['order_created', 'mark_paid']);
    expect(await env.DB.prepare(
      'SELECT order_id, action FROM order_commands WHERE request_key = ?',
    ).bind(shared).first()).toMatchObject({ order_id: winner.orderId, action: 'request_refund' });
  });

  it('same-key cross-action refund versus paid leaves the loser unchanged', async () => {
    const product = await createProduct();
    for (const first of ['left', 'right'] as const) {
      const payable = await placeOrder({
        productId: product.id,
        key: commandKey(`xact-pay-create-${first}`),
        email: `xact-pay-${first}@example.com`,
      });
      const refundable = await placeOrder({
        productId: product.id,
        key: commandKey(`xact-ref-create-${first}`),
        email: `xact-ref-${first}@example.com`,
      });
      await executeConsoleOrderAction({
        database: env.DB,
        reference: refundable.order.reference,
        body: paidBody(),
        idempotencyKey: commandKey(`xact-ref-paid-${first}`),
      });
      const shared = commandKey(`xact-shared-${first}`);
      const payableBefore = await purchaseSnapshot(payable.orderId);
      const refundableBefore = await purchaseSnapshot(refundable.orderId);
      const [paid, refund] = await raceBatches(
        (database) => executeConsoleOrderAction({
          database, reference: payable.order.reference, body: paidBody(), idempotencyKey: shared,
        }),
        (database) => requestOrderRefund({
          database, orderId: refundable.orderId, body: { reason: 'cross action' }, idempotencyKey: shared,
        }),
        first,
      );
      const stored = await env.DB.prepare(
        'SELECT order_id, action FROM order_commands WHERE request_key = ?',
      ).bind(shared).first<{ order_id: string; action: string }>();
      expect(stored).toBeTruthy();
      if (stored?.action === 'mark_paid') {
        expect(paid.status).toBe('fulfilled');
        expect(refund.status).toBe('rejected');
        if (refund.status === 'rejected') {
          expect(refund.reason).toMatchObject({ code: 'idempotency_conflict', status: 409 });
        }
        expect(await historyActions(payable.orderId)).toEqual(['order_created', 'mark_paid']);
        expect(await refundCount(refundable.orderId)).toBe(0);
        expect(await historyActions(refundable.orderId)).toEqual(['order_created', 'mark_paid']);
        expect(await purchaseSnapshot(refundable.orderId)).toEqual(refundableBefore);
      } else {
        expect(refund.status).toBe('fulfilled');
        expect(paid.status).toBe('rejected');
        if (paid.status === 'rejected') {
          expect(paid.reason).toMatchObject({ code: 'idempotency_conflict', status: 409 });
        }
        expect(stored?.action).toBe('request_refund');
        expect(await refundCount(refundable.orderId)).toBe(1);
        expect(await historyActions(payable.orderId)).toEqual(['order_created']);
        expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(payable.orderId).first<string>('status')).toBe('pending_payment');
        expect(await purchaseSnapshot(payable.orderId)).toEqual(payableBefore);
      }
      expect(await commandCount(shared)).toBe(1);
    }
  });

  it('Console list omits refund data while detail and customer reads include it', async () => {
    const product = await createProduct();
    const placed = await placeOrder({ productId: product.id, key: commandKey('list-create') });
    await executeConsoleOrderAction({
      database: env.DB, reference: placed.order.reference, body: paidBody(), idempotencyKey: commandKey('list-paid'),
    });
    const refund = await requestOrderRefund({
      database: env.DB, orderId: placed.orderId, body: { reason: 'visible privately' }, idempotencyKey: commandKey('list-refund'),
    });
    const listed = await listConsoleOrders(env.DB, { q: '', status: 'all', refund: 'all', cursor: null });
    expect(listed.orders).toHaveLength(1);
    expect(listed.orders[0]).not.toHaveProperty('refundRequest');
    expect(listed.orders[0]).not.toHaveProperty('history');
    expect(listed.orders[0]).not.toHaveProperty('allowedActions');
    expect(JSON.stringify(listed.orders)).not.toContain('visible privately');
    expect(JSON.stringify(listed.orders)).not.toContain('refundRequest');
    expect(listed.orders[0]).toMatchObject({ hasPendingRefund: true });
    const detail = await readConsoleOrderDetail(env.DB, placed.order.reference);
    expect(detail?.refundRequest).toMatchObject({ reason: 'visible privately', status: 'pending' });
    expect(detail?.allowedActions).toEqual(['mark_fulfilled']);
    expect(refund.order.refundRequest?.reason).toBe('visible privately');
  });
});
