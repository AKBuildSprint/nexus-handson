import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '../../src/catalog/catalog-types';
import {
  cancelOrder,
  completeOrder,
  createRefundRequest,
} from '../../src/orders/order-commands';
import { createOrder } from '../../src/orders/order-write';
import { findOrderIdByCapability } from '../../src/orders/private-access';
import { BOOTSTRAP_STORE_ID } from '../../src/catalog/catalog-read';
import { OrderPersistenceError, OrderValidationError } from '../../src/orders/order-types';
import {
  parseCancelOrderInput,
  parseCompleteOrderInput,
  parseRefundRequestInput,
} from '../../src/orders/order-validation';
import {
  resetCatalog,
  SIMPLE_CORE,
  workerRequest,
} from '../support/catalog-test-env';

const CAPABILITY_A = 'A'.repeat(43);
const CAPABILITY_B = 'B'.repeat(43);
const KEY_COMPLETE = 'command-complete-01';
const KEY_CANCEL = 'command-cancel-0001';
const KEY_REFUND = 'command-refund-0001';
const STOREFRONT_CONTEXT = { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'storefront' as const, id: null } };


beforeEach(resetCatalog);

async function createSimple(): Promise<ProductDetailResponse> {
  const response = await workerRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { product: ProductDetailResponse }).product;
}

function orderBody(productId: string, overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: 'Ada Lovelace', email: 'ada@example.test' },
    productId,
    variantId: null,
    quantity: 1,
    ...overrides,
  };
}

async function placeOrder(
  key: string,
  capability = CAPABILITY_A,
  product?: ProductDetailResponse,
) {
  const catalog = product ?? await createSimple();
  return createOrder({
    database: env.DB,
    context: STOREFRONT_CONTEXT,
    body: orderBody(catalog.id),
    idempotencyKey: key,
    capability,
  });
}

async function placeZeroTotalOrder(key: string) {
  const product = await createSimple();
  await env.DB.prepare(
    'UPDATE products SET base_price_minor = 0, revision = revision + 1 WHERE id = ?',
  ).bind(product.id).run();
  return createOrder({
    database: env.DB,
    context: STOREFRONT_CONTEXT,
    body: orderBody(product.id),
    idempotencyKey: key,
    capability: CAPABILITY_A,
  });
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function interceptDatabase(
  database: D1Database,
  intercept: {
    batch?: (
      statements: D1PreparedStatement[],
      real: D1Database,
    ) => Promise<D1Result[]>;
    prepare?: (query: string, real: D1Database) => D1PreparedStatement;
  },
): D1Database {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'batch' && intercept.batch) {
        return (statements: D1PreparedStatement[]) => intercept.batch!(statements, target);
      }
      if (property === 'prepare' && intercept.prepare) {
        return (query: string) => intercept.prepare!(query, target);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapStatement(
  statement: D1PreparedStatement,
  wrapFirst: (inner: D1PreparedStatement) => Promise<unknown>,
): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, property, receiver) {
      if (property === 'bind') {
        return (...args: unknown[]) => wrapStatement(
          (target.bind as (...values: unknown[]) => D1PreparedStatement)(...args),
          wrapFirst,
        );
      }
      if (property === 'first') {
        return () => wrapFirst(target);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function commandGraph(orderId: string) {
  const [status, history, refunds, commands] = await Promise.all([
    env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first<string>('status'),
    env.DB.prepare(
      `SELECT action FROM order_history WHERE order_id = ? AND action != 'order_created' ORDER BY created_at, id`,
    ).bind(orderId).all<{ action: string }>(),
    env.DB.prepare('SELECT count(*) AS count FROM order_refund_requests WHERE order_id = ?')
      .bind(orderId).first<number>('count'),
    env.DB.prepare('SELECT count(*) AS count FROM order_commands WHERE order_id = ?')
      .bind(orderId).first<number>('count'),
  ]);
  return {
    status,
    actions: history.results.map((row) => row.action),
    refunds: refunds ?? 0,
    commands: commands ?? 0,
  };
}

async function exactSnapshot(orderId: string) {
  const [order, history, refunds, commands] = await Promise.all([
    env.DB.prepare('SELECT id, reference, status, total_minor FROM orders WHERE id = ?')
      .bind(orderId).first(),
    env.DB.prepare(
      'SELECT id, action, source, from_status, status FROM order_history WHERE order_id = ? ORDER BY created_at, id',
    ).bind(orderId).all(),
    env.DB.prepare('SELECT id, status, reason FROM order_refund_requests WHERE order_id = ? ORDER BY id')
      .bind(orderId).all(),
    env.DB.prepare(
      'SELECT request_key, action, payload_hash, result_history_id FROM order_commands WHERE order_id = ? ORDER BY request_key',
    ).bind(orderId).all(),
  ]);
  return {
    order,
    history: history.results,
    refunds: refunds.results,
    commands: commands.results,
  };
}

function faultyDatabase(spliceAt: number) {
  return interceptDatabase(env.DB, {
    batch: (statements, real) => real.batch([
      ...statements.slice(0, spliceAt),
      real.prepare('INSERT INTO orders (id) VALUES (NULL)'),
      ...statements.slice(spliceAt),
    ]),
  });
}

async function assertExactRollback(
  orderId: string,
  run: (database: D1Database) => Promise<unknown>,
) {
  const baseline = await exactSnapshot(orderId);
  for (const spliceAt of [1, 3]) {
    await expect(run(faultyDatabase(spliceAt))).rejects.toBeInstanceOf(OrderPersistenceError);
    expect(await exactSnapshot(orderId)).toEqual(baseline);
  }
  return baseline;
}


describe('order command parsers', () => {
  it('accepts strict complete, cancel, and refund bodies and rejects the rest', () => {
    expect(parseCompleteOrderInput({ paymentConfirmed: true }, KEY_COMPLETE)).toEqual({
      idempotencyKey: KEY_COMPLETE,
    });
    expect(parseCancelOrderInput({}, KEY_CANCEL)).toEqual({ idempotencyKey: KEY_CANCEL });
    expect(parseRefundRequestInput({ reason: '\r\n  Need a refund\rplease.  \n' }, KEY_REFUND)).toEqual({
      idempotencyKey: KEY_REFUND,
      reason: 'Need a refund\nplease.',
    });

    expect(() => parseCompleteOrderInput({ paymentConfirmed: false }, KEY_COMPLETE)).toThrow(OrderValidationError);
    expect(() => parseCompleteOrderInput({ paymentConfirmed: true, extra: 1 }, KEY_COMPLETE)).toThrow(OrderValidationError);
    expect(() => parseCancelOrderInput({ reason: 'no' }, KEY_CANCEL)).toThrow(OrderValidationError);
    expect(() => parseRefundRequestInput({ reason: '   ' }, KEY_REFUND)).toThrow(OrderValidationError);
    expect(() => parseRefundRequestInput({ reason: `ok\u200B` }, KEY_REFUND)).toThrow(OrderValidationError);
    expect(parseRefundRequestInput({ reason: `${'n'.repeat(1000)}` }, KEY_REFUND).reason.length).toBe(1000);
    expect(() => parseRefundRequestInput({ reason: `${'n'.repeat(1001)}` }, KEY_REFUND)).toThrow(OrderValidationError);
    expect(parseRefundRequestInput({ reason: '😀\tok' }, KEY_REFUND).reason).toBe('😀\tok');

    try {
      parseCompleteOrderInput({ paymentConfirmed: true }, 'short');
      throw new Error('expected invalid key');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'validation_failed',
        status: 400,
        fields: [{ path: '/headers/idempotency-key', code: 'idempotency_key_invalid' }],
      });
    }
  });
});

describe('order domain commands', () => {
  it('CC-01: Complete vs Cancel leaves one terminal history and 409s the loser', async () => {
    const order = await placeOrder('create-cc01-0000001');
    const started = deferred();
    let waiting = 0;
    const gate = deferred();
    const racing = interceptDatabase(env.DB, {
      batch: async (statements, real) => {
        waiting += 1;
        if (waiting === 2) started.resolve();
        await gate.promise;
        return real.batch(statements);
      },
    });

    const complete = completeOrder({
      database: racing,
      reference: order.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: KEY_COMPLETE,
    });
    const cancel = cancelOrder({
      database: racing,
      reference: order.reference,
      body: {},
      idempotencyKey: KEY_CANCEL,
    });
    await started.promise;
    gate.resolve();
    const settled = await Promise.allSettled([complete, cancel]);
    const fulfilled = settled.filter((row) => row.status === 'fulfilled');
    const rejected = settled.filter((row) => row.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({
      status: 'fulfilled',
      value: { refundRequest: null, reference: order.reference },
    });
    expect(rejected[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'order_state_conflict', status: 409 },
    });

    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference = ?')
      .bind(order.reference).first<string>('id');
    const graph = await commandGraph(orderId as string);
    expect(graph.actions).toHaveLength(1);
    expect(graph.commands).toBe(1);
    expect(['completed', 'cancelled']).toContain(graph.status);
    expect(graph.actions[0]).toBe(graph.status === 'completed' ? 'order_completed' : 'order_cancelled');
  });

  it('CC-02: two Completes share one event and both describe the same outcome', async () => {
    const order = await placeOrder('create-cc02-0000001');
    const started = deferred();
    let waiting = 0;
    const gate = deferred();
    const racing = interceptDatabase(env.DB, {
      batch: async (statements, real) => {
        waiting += 1;
        if (waiting === 2) started.resolve();
        await gate.promise;
        return real.batch(statements);
      },
    });

    const first = completeOrder({
      database: racing,
      reference: order.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'command-complete-a1',
    });
    const second = completeOrder({
      database: racing,
      reference: order.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'command-complete-b1',
    });
    await started.promise;
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe('completed');
    expect(b.status).toBe('completed');
    expect(a.occurredAt).toBe(b.occurredAt);
    expect(a.refundRequest).toBeNull();
    expect(b.refundRequest).toBeNull();
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference = ?')
      .bind(order.reference).first<string>('id');
    const graph = await commandGraph(orderId as string);
    expect(graph).toMatchObject({ status: 'completed', actions: ['order_completed'], commands: 2 });
  });

  it('CC-03: two refund keys store one request and one event', async () => {
    const order = await placeOrder('create-cc03-0000001');
    await completeOrder({
      database: env.DB,
      reference: order.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: KEY_COMPLETE,
    });
    const orderId = await findOrderIdByCapability({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      reference: order.reference,
      capability: CAPABILITY_A,
    });
    expect(orderId).toBeTruthy();

    const started = deferred();
    let waiting = 0;
    const gate = deferred();
    const racing = interceptDatabase(env.DB, {
      batch: async (statements, real) => {
        waiting += 1;
        if (waiting === 2) started.resolve();
        await gate.promise;
        return real.batch(statements);
      },
    });

    const first = createRefundRequest({
      database: racing,
      orderId: orderId as string,
      body: { reason: 'First reason' },
      idempotencyKey: 'command-refund-a0001',
    });
    const second = createRefundRequest({
      database: racing,
      orderId: orderId as string,
      body: { reason: 'Second reason' },
      idempotencyKey: 'command-refund-b0001',
    });
    await started.promise;
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a.refundRequest).toEqual(b.refundRequest);
    expect(a.refundRequest?.reason).toMatch(/reason/);
    const graph = await commandGraph(orderId as string);
    expect(graph.refunds).toBe(1);
    expect(graph.actions.filter((action) => action === 'refund_requested')).toEqual(['refund_requested']);
    expect(graph.status).toBe('completed');
  });

  it('CC-04: refund that observed pending 409s even if Complete commits before delivery', async () => {
    const order = await placeOrder('create-cc04-0000001');
    const orderId = await findOrderIdByCapability({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      reference: order.reference,
      capability: CAPABILITY_A,
    });
    const captured = deferred();
    const release = deferred();
    let batchCalls = 0;
    const paused = interceptDatabase(env.DB, {
      batch: (statements, real) => {
        batchCalls += 1;
        return real.batch(statements);
      },
      prepare: (query, real) => {
        const statement = real.prepare(query);
        if (!query.includes('eligibility_status')) return statement;
        return wrapStatement(statement, async (inner) => {
          const row = await inner.first();
          captured.resolve();
          await release.promise;
          return row;
        });
      },
    });

    const refund = createRefundRequest({
      database: paused,
      orderId: orderId as string,
      body: { reason: 'Too late' },
      idempotencyKey: KEY_REFUND,
    });
    await captured.promise;
    await completeOrder({
      database: env.DB,
      reference: order.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: KEY_COMPLETE,
    });
    release.resolve();
    await expect(refund).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    expect(batchCalls).toBe(0);
    const graph = await commandGraph(orderId as string);
    expect(graph).toMatchObject({ status: 'completed', refunds: 0, actions: ['order_completed'] });
  });

  it('TX-01: fault after first write and after ledger restores exact baseline then same-key retry succeeds', async () => {
    const product = await createSimple();
    const completeTarget = await placeOrder('create-tx01-complete1', CAPABILITY_A, product);
    const completeId = await env.DB.prepare('SELECT id FROM orders WHERE reference = ?')
      .bind(completeTarget.reference).first<string>('id') as string;
    await assertExactRollback(completeId, (database) => completeOrder({
      database,
      reference: completeTarget.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'tx01-complete-key01',
    }));
    const completed = await completeOrder({
      database: env.DB,
      reference: completeTarget.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'tx01-complete-key01',
    });
    expect(completed).toMatchObject({
      action: 'complete',
      status: 'completed',
      refundRequest: null,
      reference: completeTarget.reference,
    });
    expect(JSON.stringify(completed)).not.toMatch(/payload_hash|request_key|history_id|capability/);
    expect(await completeOrder({
      database: env.DB,
      reference: completeTarget.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'tx01-complete-key01',
    })).toEqual(completed);

    const afterComplete = await exactSnapshot(completeId);
    await expect(completeOrder({
      database: faultyDatabase(3),
      reference: completeTarget.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'tx01-complete-key02',
    })).rejects.toBeInstanceOf(OrderPersistenceError);
    expect(await exactSnapshot(completeId)).toEqual(afterComplete);
    const duplicate = await completeOrder({
      database: env.DB,
      reference: completeTarget.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'tx01-complete-key02',
    });
    expect(duplicate.occurredAt).toBe(completed.occurredAt);
    expect((await exactSnapshot(completeId)).commands).toHaveLength(2);

    const cancelTarget = await placeOrder('create-tx01-cancel001', CAPABILITY_B, product);
    const cancelId = await env.DB.prepare('SELECT id FROM orders WHERE reference = ?')
      .bind(cancelTarget.reference).first<string>('id') as string;
    await assertExactRollback(cancelId, (database) => cancelOrder({
      database,
      reference: cancelTarget.reference,
      body: {},
      idempotencyKey: 'tx01-cancel-key0001',
    }));
    const cancelled = await cancelOrder({
      database: env.DB,
      reference: cancelTarget.reference,
      body: {},
      idempotencyKey: 'tx01-cancel-key0001',
    });
    expect(await cancelOrder({
      database: env.DB,
      reference: cancelTarget.reference,
      body: {},
      idempotencyKey: 'tx01-cancel-key0001',
    })).toEqual(cancelled);

    const refundTarget = await placeOrder('create-tx01-refund001', 'C'.repeat(43), product);
    await completeOrder({
      database: env.DB,
      reference: refundTarget.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'tx01-refund-complete1',
    });
    const refundId = await findOrderIdByCapability({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      reference: refundTarget.reference,
      capability: 'C'.repeat(43),
    }) as string;
    await assertExactRollback(refundId, (database) => createRefundRequest({
      database,
      orderId: refundId,
      body: { reason: 'Rolled back' },
      idempotencyKey: 'tx01-refund-key00001',
    }));
    const refunded = await createRefundRequest({
      database: env.DB,
      orderId: refundId,
      body: { reason: 'Rolled back' },
      idempotencyKey: 'tx01-refund-key00001',
    });
    expect(await createRefundRequest({
      database: env.DB,
      orderId: refundId,
      body: { reason: 'Rolled back' },
      idempotencyKey: 'tx01-refund-key00001',
    })).toEqual(refunded);
  });

  it('DP-04/05: command keys are payload-bound and independent of Create Order', async () => {
    const product = await createSimple();
    const created = await placeOrder(KEY_COMPLETE, CAPABILITY_A, product);
    const completed = await completeOrder({
      database: env.DB,
      reference: created.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: KEY_COMPLETE,
    });
    expect(completed.action).toBe('complete');
    await expect(cancelOrder({
      database: env.DB,
      reference: created.reference,
      body: {},
      idempotencyKey: KEY_COMPLETE,
    })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    expect(await env.DB.prepare(
      'SELECT count(*) AS count FROM order_idempotency WHERE request_key = ?',
    ).bind(KEY_COMPLETE).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      'SELECT action FROM order_commands WHERE request_key = ?',
    ).bind(KEY_COMPLETE).first<string>('action')).toBe('complete');

    const other = await placeOrder('create-other-000001', CAPABILITY_B, product);
    await expect(completeOrder({
      database: env.DB,
      reference: other.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: KEY_COMPLETE,
    })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect(await env.DB.prepare('SELECT status FROM orders WHERE reference = ?')
      .bind(other.reference).first<string>('status')).toBe('pending_payment');
  });

  it('rejects opposing, ineligible, and missing Orders without writing a denial ledger', async () => {
    const product = await createSimple();
    const pending = await placeOrder('create-ia-pending-01', CAPABILITY_A, product);
    await expect(cancelOrder({
      database: env.DB,
      reference: pending.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: KEY_CANCEL,
    })).rejects.toMatchObject({ code: 'validation_failed' });
    await completeOrder({
      database: env.DB,
      reference: pending.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: KEY_COMPLETE,
    });
    await expect(cancelOrder({
      database: env.DB,
      reference: pending.reference,
      body: {},
      idempotencyKey: KEY_CANCEL,
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });

    const cancelled = await placeOrder('create-ia-cancel-001', CAPABILITY_B, product);
    await cancelOrder({
      database: env.DB,
      reference: cancelled.reference,
      body: {},
      idempotencyKey: 'command-cancel-ia001',
    });
    await expect(completeOrder({
      database: env.DB,
      reference: cancelled.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'command-complete-ia01',
    })).rejects.toMatchObject({ code: 'order_state_conflict' });

    const pendingId = await findOrderIdByCapability({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      reference: cancelled.reference,
      capability: CAPABILITY_B,
    });
    await expect(createRefundRequest({
      database: env.DB,
      orderId: pendingId as string,
      body: { reason: 'Not completed' },
      idempotencyKey: KEY_REFUND,
    })).rejects.toMatchObject({ code: 'order_state_conflict' });
    await expect(createRefundRequest({
      database: env.DB,
      orderId: 'ord_missing_order_id',
      body: { reason: 'Gone' },
      idempotencyKey: 'command-refund-missing',
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(completeOrder({
      database: env.DB,
      reference: 'NX-0000000000000000',
      body: { paymentConfirmed: true },
      idempotencyKey: 'command-missing-order1',
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_commands').first<number>('count')).toBe(2);
  });

  it('replays refunds to the canonical request and completes a zero-total Order', async () => {
    const zero = await placeZeroTotalOrder('create-zero-00000001');
    expect(zero.totalMinor).toBe(0);
    const completed = await completeOrder({
      database: env.DB,
      reference: zero.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'command-zero-complete1',
    });
    expect(completed.status).toBe('completed');
    expect(completed.refundRequest).toBeNull();

    const orderId = await findOrderIdByCapability({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      reference: zero.reference,
      capability: CAPABILITY_A,
    }) as string;
    const first = await createRefundRequest({
      database: env.DB,
      orderId,
      body: { reason: 'Original reason' },
      idempotencyKey: 'command-zero-refund-a1',
    });
    const second = await createRefundRequest({
      database: env.DB,
      orderId,
      body: { reason: 'Different reason' },
      idempotencyKey: 'command-zero-refund-b1',
    });
    expect(second.refundRequest).toEqual(first.refundRequest);
    expect(second.refundRequest?.reason).toBe('Original reason');
    await expect(createRefundRequest({
      database: env.DB,
      orderId,
      body: { reason: 'Original reason' },
      idempotencyKey: 'command-zero-refund-b1',
    })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const replay = await createRefundRequest({
      database: env.DB,
      orderId,
      body: { reason: 'Different reason' },
      idempotencyKey: 'command-zero-refund-b1',
    });
    expect(replay.refundRequest).toEqual(first.refundRequest);
    expect(await completeOrder({
      database: env.DB,
      reference: zero.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: 'command-zero-complete1',
    })).toEqual(completed);
    expect(await commandGraph(orderId)).toMatchObject({
      status: 'completed',
      refunds: 1,
      actions: ['order_completed', 'refund_requested'],
    });
  });

  it('cross-Order same-key race keeps the losing Order unchanged', async () => {
    const product = await createSimple();
    const first = await placeOrder('create-cross-a-00001', CAPABILITY_A, product);
    const second = await placeOrder('create-cross-b-00001', CAPABILITY_B, product);
    const started = deferred();
    let waiting = 0;
    const gate = deferred();
    const racing = interceptDatabase(env.DB, {
      batch: async (statements, real) => {
        waiting += 1;
        if (waiting === 2) started.resolve();
        await gate.promise;
        return real.batch(statements);
      },
    });

    const completeA = completeOrder({
      database: racing,
      reference: first.reference,
      body: { paymentConfirmed: true },
      idempotencyKey: KEY_COMPLETE,
    });
    const cancelB = cancelOrder({
      database: racing,
      reference: second.reference,
      body: {},
      idempotencyKey: KEY_COMPLETE,
    });
    await started.promise;
    gate.resolve();
    const settled = await Promise.allSettled([completeA, cancelB]);
    const fulfilled = settled.filter((row) => row.status === 'fulfilled');
    const rejected = settled.filter((row) => row.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'idempotency_conflict', status: 409 },
    });

    const statusA = await env.DB.prepare('SELECT status FROM orders WHERE reference = ?')
      .bind(first.reference).first<string>('status');
    const statusB = await env.DB.prepare('SELECT status FROM orders WHERE reference = ?')
      .bind(second.reference).first<string>('status');
    if (settled[0].status === 'fulfilled') {
      expect(statusA).toBe('completed');
      expect(statusB).toBe('pending_payment');
    } else {
      expect(statusA).toBe('pending_payment');
      expect(statusB).toBe('cancelled');
    }
  });
});
