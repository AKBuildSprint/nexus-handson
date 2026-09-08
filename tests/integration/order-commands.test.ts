import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '../../src/catalog/catalog-types';
import {
  cancelOrder,
  createRefundRequest,
  fulfillOrder,
  markPaid,
} from '../../src/orders/order-commands';
import { createOrder } from '../../src/orders/order-write';
import { routeConsoleOrderRequest } from '../../src/worker/console-order-routes';
import { digestOrderCapability, findOrderIdByCapability } from '../../src/orders/private-access';
import { BOOTSTRAP_STORE_ID } from '../../src/catalog/catalog-read';
import { OrderPersistenceError, OrderValidationError } from '../../src/orders/order-types';
import {
  parseCancelOrderInput,
  parseFulfillOrderInput,
  parseManualPaymentInput,
  parseRefundRequestInput,
} from '../../src/orders/order-validation';
import {
  catalogMigrations,
  resetCatalog,
  resetCatalogThrough,
  SIMPLE_CORE,
  workerRequest,
} from '../support/catalog-test-env';

const CAPABILITY_A = 'A'.repeat(43);
const CAPABILITY_B = 'B'.repeat(43);
const KEY_PAID = 'command-paid-000001';
const KEY_CANCEL = 'command-cancel-0001';
const KEY_REFUND = 'command-refund-0001';
const KEY_FULFILL = 'command-fulfill-0001';
const STOREFRONT_CONTEXT = { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'storefront' as const, id: null } };
const OWNER_CONTEXT = { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'bootstrap_owner' as const, id: null } };

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
    items: [{ productId, variantId: null, quantity: 1 }],
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

async function placedOrderId(reference: string, capability: string): Promise<string> {
  const orderId = await findOrderIdByCapability({
    database: env.DB,
    storeId: BOOTSTRAP_STORE_ID,
    reference,
    capability,
  });
  expect(orderId).toBeTruthy();
  return orderId as string;
}

async function storefrontCustomer(orderId: string) {
  const customerId = await env.DB.prepare('SELECT customer_id FROM orders WHERE id = ?')
    .bind(orderId).first<string>('customer_id');
  expect(customerId).toBeTruthy();
  return { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'storefront' as const, id: customerId as string } };
}

function payBody(reference: string, method = 'Bank transfer') {
  return { method, reference };
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
  const [status, history, refunds, commands, payments] = await Promise.all([
    env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first<string>('status'),
    env.DB.prepare(
      `SELECT action FROM order_history WHERE order_id = ? AND action != 'order_created' ORDER BY created_at, id`,
    ).bind(orderId).all<{ action: string }>(),
    env.DB.prepare('SELECT count(*) AS count FROM order_refund_requests WHERE order_id = ?')
      .bind(orderId).first<number>('count'),
    env.DB.prepare('SELECT count(*) AS count FROM order_commands WHERE order_id = ?')
      .bind(orderId).first<number>('count'),
    env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id = ?')
      .bind(orderId).first<number>('count'),
  ]);
  return {
    status,
    actions: history.results.map((row) => row.action),
    refunds: refunds ?? 0,
    commands: commands ?? 0,
    payments: payments ?? 0,
  };
}

async function exactSnapshot(orderId: string) {
  const [order, history, refunds, commands, payments] = await Promise.all([
    env.DB.prepare('SELECT id, reference, status, total_minor, currency FROM orders WHERE id = ?')
      .bind(orderId).first(),
    env.DB.prepare(
      'SELECT id, action, source, from_status, status, actor_id FROM order_history WHERE order_id = ? ORDER BY created_at, id',
    ).bind(orderId).all(),
    env.DB.prepare(
      'SELECT id, status, reason, actor_source, actor_id FROM order_refund_requests WHERE order_id = ? ORDER BY id',
    ).bind(orderId).all(),
    env.DB.prepare(
      'SELECT request_key, action, payload_hash, result_history_id, contract_version FROM order_commands WHERE order_id = ? ORDER BY request_key',
    ).bind(orderId).all(),
    env.DB.prepare(
      `SELECT id, method, external_reference, amount_minor, currency, source, status, history_id,
              recorded_actor_source, recorded_actor_id
         FROM payments WHERE order_id = ? ORDER BY id`,
    ).bind(orderId).all(),
  ]);
  return {
    order,
    history: history.results,
    refunds: refunds.results,
    commands: commands.results,
    payments: payments.results,
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
  spliceAt = [1, 3],
) {
  const baseline = await exactSnapshot(orderId);
  for (const offset of spliceAt) {
    await expect(run(faultyDatabase(offset))).rejects.toBeInstanceOf(OrderPersistenceError);
    expect(await exactSnapshot(orderId)).toEqual(baseline);
  }
  return baseline;
}

describe('order command parsers', () => {
  it('accepts strict paid, fulfill, cancel, and refund bodies and rejects the rest', () => {
    expect(parseManualPaymentInput({ method: '  Bank transfer  ', reference: ' WIRE-1 ' }, KEY_PAID)).toEqual({
      idempotencyKey: KEY_PAID,
      method: 'Bank transfer',
      reference: 'WIRE-1',
    });
    expect(parseFulfillOrderInput({}, KEY_FULFILL)).toEqual({ idempotencyKey: KEY_FULFILL });
    expect(parseCancelOrderInput({}, KEY_CANCEL)).toEqual({ idempotencyKey: KEY_CANCEL });
    expect(parseRefundRequestInput({ reason: '\r\n  Need a refund\rplease.  \n' }, KEY_REFUND)).toEqual({
      idempotencyKey: KEY_REFUND,
      reason: 'Need a refund\nplease.',
    });

    expect(() => parseManualPaymentInput({ method: 'Bank', reference: 'x', amount: 1 }, KEY_PAID))
      .toThrow(OrderValidationError);
    expect(() => parseManualPaymentInput({ method: 'Bank\ntransfer', reference: 'WIRE' }, KEY_PAID))
      .toThrow(OrderValidationError);
    expect(() => parseManualPaymentInput({ paymentConfirmed: true }, KEY_PAID)).toThrow(OrderValidationError);
    expect(() => parseFulfillOrderInput({ extra: 1 }, KEY_FULFILL)).toThrow(OrderValidationError);
    expect(() => parseCancelOrderInput({ reason: 'no' }, KEY_CANCEL)).toThrow(OrderValidationError);
    expect(() => parseRefundRequestInput({ reason: '   ' }, KEY_REFUND)).toThrow(OrderValidationError);
    expect(() => parseRefundRequestInput({ reason: `ok\u200B` }, KEY_REFUND)).toThrow(OrderValidationError);
    expect(parseRefundRequestInput({ reason: `${'n'.repeat(1000)}` }, KEY_REFUND).reason.length).toBe(1000);
    expect(() => parseRefundRequestInput({ reason: `${'n'.repeat(1001)}` }, KEY_REFUND)).toThrow(OrderValidationError);
    expect(parseRefundRequestInput({ reason: '😀\tok' }, KEY_REFUND).reason).toBe('😀\tok');

    try {
      parseManualPaymentInput({ method: 'Bank', reference: 'WIRE' }, 'short');
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
  it('records one manual Payment then Fulfill with distinct events', async () => {
    const order = await placeOrder('create-paid-fulfill-01');
    const orderId = await placedOrderId(order.reference, CAPABILITY_A);
    const paid = await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-ADA-1'),
      idempotencyKey: KEY_PAID,
    });
    expect(paid).toMatchObject({
      action: 'mark_paid',
      status: 'paid',
      reference: order.reference,
      refundRequest: null,
    });
    expect(paid.paymentId).toEqual(expect.stringMatching(/^pay_/));
    const fulfilled = await fulfillOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: {},
      idempotencyKey: KEY_FULFILL,
    });
    expect(fulfilled).toMatchObject({
      action: 'fulfill',
      status: 'fulfilled',
      paymentId: null,
      refundRequest: null,
    });
    const snapshot = await exactSnapshot(orderId);
    expect(snapshot.order).toMatchObject({ status: 'fulfilled', total_minor: 2400, currency: 'USD' });
    expect(snapshot.payments).toEqual([expect.objectContaining({
      id: paid.paymentId,
      method: 'Bank transfer',
      external_reference: 'WIRE-ADA-1',
      amount_minor: 2400,
      currency: 'USD',
      source: 'manual',
      status: 'succeeded',
      recorded_actor_source: 'bootstrap_owner',
      recorded_actor_id: null,
    })]);
    expect(snapshot.history.map((row) => row.action)).toEqual(['order_created', 'order_paid', 'order_fulfilled']);
    expect(await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-ADA-1'),
      idempotencyKey: KEY_PAID,
    })).toEqual(paid);
  });

  it('cancels pending Orders and refuses later paid or fulfill', async () => {
    const order = await placeOrder('create-cancel-pending1');
    const orderId = await placedOrderId(order.reference, CAPABILITY_A);
    const cancelled = await cancelOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: {},
      idempotencyKey: KEY_CANCEL,
    });
    expect(cancelled).toMatchObject({ action: 'cancel', status: 'canceled', paymentId: null });
    await expect(markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-CANCEL-1'),
      idempotencyKey: KEY_PAID,
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    await expect(fulfillOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: {},
      idempotencyKey: KEY_FULFILL,
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    expect(await commandGraph(orderId)).toMatchObject({
      status: 'canceled',
      payments: 0,
      actions: ['order_canceled'],
    });
  });

  it('CC-01: markPaid vs Cancel leaves one decision and 409s the loser', async () => {
    const order = await placeOrder('create-cc01-0000001');
    const orderId = await placedOrderId(order.reference, CAPABILITY_A);
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

    const paid = markPaid({
      database: racing,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-RACE-1'),
      idempotencyKey: KEY_PAID,
    });
    const cancel = cancelOrder({
      database: racing,
      context: OWNER_CONTEXT,
      orderId,
      body: {},
      idempotencyKey: KEY_CANCEL,
    });
    await started.promise;
    gate.resolve();
    const settled = await Promise.allSettled([paid, cancel]);
    const fulfilled = settled.filter((row) => row.status === 'fulfilled');
    const rejected = settled.filter((row) => row.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'order_state_conflict', status: 409 },
    });
    const graph = await commandGraph(orderId);
    expect(graph.actions).toHaveLength(1);
    expect(graph.commands).toBe(1);
    if (graph.status === 'paid') {
      expect(graph).toMatchObject({ actions: ['order_paid'], payments: 1 });
    } else {
      expect(graph).toMatchObject({ status: 'canceled', actions: ['order_canceled'], payments: 0 });
    }
  });

  it('double click and new-key same payload share one Payment and paid event', async () => {
    const order = await placeOrder('create-cc02-0000001');
    const orderId = await placedOrderId(order.reference, CAPABILITY_A);
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

    const first = markPaid({
      database: racing,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-DUP-1'),
      idempotencyKey: 'command-paid-aaaaaaa1',
    });
    const second = markPaid({
      database: racing,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-DUP-1'),
      idempotencyKey: 'command-paid-bbbbbbb1',
    });
    await started.promise;
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe('paid');
    expect(b.status).toBe('paid');
    expect(a.occurredAt).toBe(b.occurredAt);
    expect(a.paymentId).toBe(b.paymentId);
    expect(await commandGraph(orderId)).toMatchObject({
      status: 'paid',
      actions: ['order_paid'],
      payments: 1,
      commands: 2,
    });
  });

  it('same-key concurrent markPaid yields one Payment, event, and ledger', async () => {
    const order = await placeOrder('create-same-key-00001');
    const orderId = await placedOrderId(order.reference, CAPABILITY_A);
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
    const first = markPaid({
      database: racing,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-SAME-1'),
      idempotencyKey: KEY_PAID,
    });
    const second = markPaid({
      database: racing,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-SAME-1'),
      idempotencyKey: KEY_PAID,
    });
    await started.promise;
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.occurredAt).toBe(b.occurredAt);
    expect(a.paymentId).toBe(b.paymentId);
    expect(await commandGraph(orderId)).toMatchObject({
      status: 'paid',
      actions: ['order_paid'],
      payments: 1,
      commands: 1,
    });
  });

  it('keeps Cancel lookup failures inside the sanitized JSON boundary', async () => {
    const response = await routeConsoleOrderRequest(
      new Request('https://local.invalid/api/console/orders/NX-0123456789ABCDEF/cancel', { method: 'POST' }),
      interceptDatabase(env.DB, {
        prepare: () => {
          throw new Error('d1 unavailable');
        },
      }),
    );
    expect(response?.status).toBe(500);
    const body = await response!.json() as { error: { code: string; incidentId: string | null } };
    expect(body.error.code).toBe('order_operation_failed');
    expect(JSON.stringify(body)).not.toMatch(/d1 unavailable/);
    expect(body.error.incidentId).toEqual(expect.any(String));
  });

  it('conflicting payment details and reused external refs do not settle a second Order', async () => {
    const product = await createSimple();
    const first = await placeOrder('create-pay-a-000001', CAPABILITY_A, product);
    const second = await placeOrder('create-pay-b-000001', CAPABILITY_B, product);
    const firstId = await placedOrderId(first.reference, CAPABILITY_A);
    const secondId = await placedOrderId(second.reference, CAPABILITY_B);
    const paid = await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: firstId,
      body: payBody('WIRE-UNIQUE-1'),
      idempotencyKey: 'command-paid-first001',
    });
    await expect(markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: firstId,
      body: payBody('WIRE-OTHER-1'),
      idempotencyKey: 'command-paid-conflict1',
    })).rejects.toMatchObject({ code: 'payment_conflict', status: 409 });
    await expect(markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: secondId,
      body: payBody('WIRE-UNIQUE-1'),
      idempotencyKey: 'command-paid-second001',
    })).rejects.toMatchObject({ code: 'payment_conflict', status: 409 });
    expect(await commandGraph(firstId)).toMatchObject({ status: 'paid', payments: 1, commands: 1 });
    expect(await commandGraph(secondId)).toMatchObject({ status: 'pending', payments: 0, commands: 0 });
    expect(JSON.stringify(paid)).not.toMatch(/payload_hash|request_key|history_id|capability|ord_/);
  });

  it('Customer and Console refund races keep one request, reason, and actor', async () => {
    const order = await placeOrder('create-cc03-0000001');
    const orderId = await placedOrderId(order.reference, CAPABILITY_A);
    await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-REFUND-1'),
      idempotencyKey: KEY_PAID,
    });
    const customerId = await env.DB.prepare('SELECT customer_id FROM orders WHERE id = ?')
      .bind(orderId).first<string>('customer_id');
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
      context: await storefrontCustomer(orderId),
      orderId,
      body: { reason: 'First reason' },
      idempotencyKey: 'command-refund-a0001',
    });
    const second = createRefundRequest({
      database: racing,
      context: OWNER_CONTEXT,
      orderId,
      body: { reason: 'Second reason' },
      idempotencyKey: 'command-refund-b0001',
    });
    await started.promise;
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a.refundRequest).toEqual(b.refundRequest);
    expect(a.status).toBe('paid');
    expect(b.refundRequest?.status).toBe('pending');
    const graph = await commandGraph(orderId);
    expect(graph.refunds).toBe(1);
    expect(graph.status).toBe('paid');
    expect(graph.actions.filter((action) => action === 'refund_requested')).toEqual(['refund_requested']);
    const stored = await env.DB.prepare(
      'SELECT reason, actor_source, actor_id FROM order_refund_requests WHERE order_id = ?',
    ).bind(orderId).first<{ reason: string; actor_source: string; actor_id: string | null }>();
    expect(stored?.reason).toMatch(/reason/);
    expect(['storefront', 'bootstrap_owner']).toContain(stored?.actor_source);
    if (stored?.actor_source === 'storefront') expect(stored.actor_id).toBe(customerId);
    else expect(stored?.actor_id).toBeNull();
  });

  it('refund vs Fulfill both succeed without duplicate requests', async () => {
    const order = await placeOrder('create-refund-fulfill1');
    const orderId = await placedOrderId(order.reference, CAPABILITY_A);
    await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-RF-1'),
      idempotencyKey: KEY_PAID,
    });
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
    const refund = createRefundRequest({
      database: racing,
      context: await storefrontCustomer(orderId),
      orderId,
      body: { reason: 'Still waiting' },
      idempotencyKey: KEY_REFUND,
    });
    const fulfill = fulfillOrder({
      database: racing,
      context: OWNER_CONTEXT,
      orderId,
      body: {},
      idempotencyKey: KEY_FULFILL,
    });
    await started.promise;
    gate.resolve();
    const [refunded, fulfilled] = await Promise.all([refund, fulfill]);
    expect(refunded.refundRequest?.reason).toBe('Still waiting');
    expect(fulfilled.status).toBe('fulfilled');
    expect(await commandGraph(orderId)).toMatchObject({
      status: 'fulfilled',
      refunds: 1,
      payments: 1,
    });
  });

  it('CC-04: refund that observed pending 409s even if markPaid commits before delivery', async () => {
    const order = await placeOrder('create-cc04-0000001');
    const orderId = await placedOrderId(order.reference, CAPABILITY_A);
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
      context: await storefrontCustomer(orderId),
      orderId,
      body: { reason: 'Too late' },
      idempotencyKey: KEY_REFUND,
    });
    await captured.promise;
    await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('WIRE-LATE-1'),
      idempotencyKey: KEY_PAID,
    });
    release.resolve();
    await expect(refund).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });
    expect(batchCalls).toBe(0);
    expect(await commandGraph(orderId)).toMatchObject({
      status: 'paid',
      refunds: 0,
      actions: ['order_paid'],
    });
  });

  it('TX-01: fault after first write and after ledger restores exact baseline then same-key retry succeeds', async () => {
    const product = await createSimple();
    const paidTarget = await placeOrder('create-tx01-paid00001', CAPABILITY_A, product);
    const paidId = await placedOrderId(paidTarget.reference, CAPABILITY_A);
    await assertExactRollback(paidId, (database) => markPaid({
      database,
      context: OWNER_CONTEXT,
      orderId: paidId,
      body: payBody('WIRE-TX-1'),
      idempotencyKey: 'tx01-paid-key000001',
    }), [1, 4]);
    const paid = await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: paidId,
      body: payBody('WIRE-TX-1'),
      idempotencyKey: 'tx01-paid-key000001',
    });
    expect(paid).toMatchObject({
      action: 'mark_paid',
      status: 'paid',
      refundRequest: null,
      reference: paidTarget.reference,
    });
    expect(JSON.stringify(paid)).not.toMatch(/payload_hash|request_key|history_id|capability/);
    expect(await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: paidId,
      body: payBody('WIRE-TX-1'),
      idempotencyKey: 'tx01-paid-key000001',
    })).toEqual(paid);

    const afterPaid = await exactSnapshot(paidId);
    await expect(markPaid({
      database: faultyDatabase(4),
      context: OWNER_CONTEXT,
      orderId: paidId,
      body: payBody('WIRE-TX-1'),
      idempotencyKey: 'tx01-paid-key000002',
    })).rejects.toBeInstanceOf(OrderPersistenceError);
    expect(await exactSnapshot(paidId)).toEqual(afterPaid);
    const duplicate = await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: paidId,
      body: payBody('WIRE-TX-1'),
      idempotencyKey: 'tx01-paid-key000002',
    });
    expect(duplicate.occurredAt).toBe(paid.occurredAt);
    expect(duplicate.paymentId).toBe(paid.paymentId);

    await assertExactRollback(paidId, (database) => fulfillOrder({
      database,
      context: OWNER_CONTEXT,
      orderId: paidId,
      body: {},
      idempotencyKey: 'tx01-fulfill-key0001',
    }), [1, 3]);
    const fulfilled = await fulfillOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: paidId,
      body: {},
      idempotencyKey: 'tx01-fulfill-key0001',
    });
    expect(fulfilled).toMatchObject({ action: 'fulfill', status: 'fulfilled', paymentId: null });
    expect(await fulfillOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: paidId,
      body: {},
      idempotencyKey: 'tx01-fulfill-key0001',
    })).toEqual(fulfilled);
    expect(await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: paidId,
      body: payBody('WIRE-TX-1'),
      idempotencyKey: 'tx01-paid-key000001',
    })).toEqual(paid);
    expect((await exactSnapshot(paidId)).commands).toHaveLength(3);


    const cancelTarget = await placeOrder('create-tx01-cancel001', CAPABILITY_B, product);
    const cancelId = await placedOrderId(cancelTarget.reference, CAPABILITY_B);
    await assertExactRollback(cancelId, (database) => cancelOrder({
      database,
      context: OWNER_CONTEXT,
      orderId: cancelId,
      body: {},
      idempotencyKey: 'tx01-cancel-key0001',
    }));
    const cancelled = await cancelOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: cancelId,
      body: {},
      idempotencyKey: 'tx01-cancel-key0001',
    });
    expect(await cancelOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: cancelId,
      body: {},
      idempotencyKey: 'tx01-cancel-key0001',
    })).toEqual(cancelled);

    const refundTarget = await placeOrder('create-tx01-refund001', 'C'.repeat(43), product);
    const refundId = await placedOrderId(refundTarget.reference, 'C'.repeat(43));
    await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: refundId,
      body: payBody('WIRE-TX-REFUND-1'),
      idempotencyKey: 'tx01-refund-paid00001',
    });
    const refundActor = await storefrontCustomer(refundId);
    await assertExactRollback(refundId, (database) => createRefundRequest({
      database,
      context: refundActor,
      orderId: refundId,
      body: { reason: 'Rolled back' },
      idempotencyKey: 'tx01-refund-key00001',
    }));
    const refunded = await createRefundRequest({
      database: env.DB,
      context: refundActor,
      orderId: refundId,
      body: { reason: 'Rolled back' },
      idempotencyKey: 'tx01-refund-key00001',
    });
    expect(refunded.refundRequest?.status).toBe('pending');
    expect(await createRefundRequest({
      database: env.DB,
      context: refundActor,
      orderId: refundId,
      body: { reason: 'Rolled back' },
      idempotencyKey: 'tx01-refund-key00001',
    })).toEqual(refunded);
  });

  it('command keys are payload-bound, Store-scoped, and independent of Create Order', async () => {
    const product = await createSimple();
    const created = await placeOrder(KEY_PAID, CAPABILITY_A, product);
    const createdId = await placedOrderId(created.reference, CAPABILITY_A);
    const paid = await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: createdId,
      body: payBody('WIRE-KEY-1'),
      idempotencyKey: KEY_PAID,
    });
    expect(paid.action).toBe('mark_paid');
    await expect(cancelOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: createdId,
      body: {},
      idempotencyKey: KEY_PAID,
    })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    expect(await env.DB.prepare(
      'SELECT count(*) AS count FROM order_idempotency WHERE request_key = ?',
    ).bind(KEY_PAID).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      'SELECT action FROM order_commands WHERE request_key = ?',
    ).bind(KEY_PAID).first<string>('action')).toBe('mark_paid');

    const other = await placeOrder('create-other-000001', CAPABILITY_B, product);
    const otherId = await placedOrderId(other.reference, CAPABILITY_B);
    await expect(markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: otherId,
      body: payBody('WIRE-KEY-2'),
      idempotencyKey: KEY_PAID,
    })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect(await env.DB.prepare('SELECT status FROM orders WHERE reference = ?')
      .bind(other.reference).first<string>('status')).toBe('pending');
  });

  it('rejects opposing, ineligible, forged, and missing Orders without writing a denial ledger', async () => {
    const product = await createSimple();
    const pending = await placeOrder('create-ia-pending-01', CAPABILITY_A, product);
    const pendingId = await placedOrderId(pending.reference, CAPABILITY_A);
    await expect(cancelOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: pendingId,
      body: { reason: 'no' },
      idempotencyKey: KEY_CANCEL,
    })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(markPaid({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      orderId: pendingId,
      body: payBody('WIRE-FORGED-1'),
      idempotencyKey: 'command-paid-forged001',
    })).rejects.toMatchObject({ code: 'validation_failed', status: 422 });
    await expect(markPaid({
      database: env.DB,
      context: { storeId: 'store_other', actor: { source: 'bootstrap_owner', id: null } },
      orderId: pendingId,
      body: payBody('WIRE-OTHER-STORE'),
      idempotencyKey: 'command-paid-wrongstore',
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(markPaid({
      database: env.DB,
      context: { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'user', id: 'usr_forged' } },
      orderId: pendingId,
      body: payBody('WIRE-USER-1'),
      idempotencyKey: 'command-paid-user00001',
    })).rejects.toMatchObject({ code: 'validation_failed', status: 422 });
    await expect(fulfillOrder({
      database: env.DB,
      context: { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'system', id: null } },
      orderId: pendingId,
      body: {},
      idempotencyKey: 'command-fulfill-sys001',
    })).rejects.toMatchObject({ code: 'validation_failed', status: 422 });
    await expect(createRefundRequest({
      database: env.DB,
      context: { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'system', id: null } },
      orderId: pendingId,
      body: { reason: 'System may not request' },
      idempotencyKey: 'command-refund-sys0001',
    })).rejects.toMatchObject({ code: 'validation_failed', status: 422 });

    await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: pendingId,
      body: payBody('WIRE-IA-1'),
      idempotencyKey: KEY_PAID,
    });
    await expect(cancelOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: pendingId,
      body: {},
      idempotencyKey: KEY_CANCEL,
    })).rejects.toMatchObject({ code: 'order_state_conflict', status: 409 });

    const cancelled = await placeOrder('create-ia-cancel-001', CAPABILITY_B, product);
    const cancelledId = await placedOrderId(cancelled.reference, CAPABILITY_B);
    await cancelOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: cancelledId,
      body: {},
      idempotencyKey: 'command-cancel-ia001',
    });
    await expect(markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: cancelledId,
      body: payBody('WIRE-IA-2'),
      idempotencyKey: 'command-paid-ia000001',
    })).rejects.toMatchObject({ code: 'order_state_conflict' });
    await expect(createRefundRequest({
      database: env.DB,
      context: await storefrontCustomer(cancelledId),
      orderId: cancelledId,
      body: { reason: 'Not paid' },
      idempotencyKey: KEY_REFUND,
    })).rejects.toMatchObject({ code: 'order_state_conflict' });
    await expect(createRefundRequest({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      orderId: 'ord_missing_order_id',
      body: { reason: 'Gone' },
      idempotencyKey: 'command-refund-missing',
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_commands').first<number>('count')).toBe(2);
  });

  it('looks up the Store Order before parsing and rejects a mismatched storefront or Owner actor', async () => {
    const product = await createSimple();
    const pending = await placeOrder('create-auth-pending01', CAPABILITY_A, product);
    const pendingId = await placedOrderId(pending.reference, CAPABILITY_A);
    const commandsBefore = await env.DB.prepare('SELECT count(*) AS count FROM order_commands')
      .first<number>('count');

    await expect(markPaid({
      database: env.DB,
      context: { storeId: 'store_other', actor: { source: 'bootstrap_owner', id: null } },
      orderId: pendingId,
      body: { method: 1, extra: true },
      idempotencyKey: 'not-a-valid-key',
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(cancelOrder({
      database: env.DB,
      context: { storeId: 'store_other', actor: { source: 'bootstrap_owner', id: null } },
      orderId: pendingId,
      body: { reason: 'nope' },
      idempotencyKey: 1,
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(fulfillOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: 'ord_missing_order_id',
      body: { extra: true },
      idempotencyKey: 'short',
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(createRefundRequest({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      orderId: 'ord_missing_order_id',
      body: null,
      idempotencyKey: 'not-a-valid-key',
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });

    await expect(markPaid({
      database: env.DB,
      context: { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'bootstrap_owner', id: 'own_forged' } },
      orderId: pendingId,
      body: payBody('WIRE-OWNER-FORGE'),
      idempotencyKey: 'command-paid-ownforge1',
    })).rejects.toMatchObject({ code: 'validation_failed', status: 422 });

    await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: pendingId,
      body: payBody('WIRE-AUTH-1'),
      idempotencyKey: 'command-paid-auth00001',
    });
    await expect(createRefundRequest({
      database: env.DB,
      context: { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'storefront', id: 'cust_forged_other' } },
      orderId: pendingId,
      body: { reason: 'Wrong customer' },
      idempotencyKey: 'command-refund-wrongcst',
    })).rejects.toMatchObject({ code: 'validation_failed', status: 422 });
    await expect(createRefundRequest({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      orderId: pendingId,
      body: { reason: 'Null storefront id' },
      idempotencyKey: 'command-refund-nullcst1',
    })).rejects.toMatchObject({ code: 'validation_failed', status: 422 });

    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_commands').first<number>('count'))
      .toBe((commandsBefore ?? 0) + 1);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_refund_requests WHERE order_id = ?')
      .bind(pendingId).first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(pendingId).first<string>('status'))
      .toBe('paid');
  });

  it('replays refunds to the canonical request and pays a zero-total Order honestly', async () => {
    const zero = await placeZeroTotalOrder('create-zero-00000001');
    expect(zero.totalMinor).toBe(0);
    const orderId = await placedOrderId(zero.reference, CAPABILITY_A);
    const paid = await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('ZERO-OWNER-1', 'Zero charge'),
      idempotencyKey: 'command-zero-paid00001',
    });
    expect(paid.status).toBe('paid');
    expect(paid.refundRequest).toBeNull();
    const payment = await env.DB.prepare(
      'SELECT method, external_reference, amount_minor FROM payments WHERE order_id = ?',
    ).bind(orderId).first<{ method: string; external_reference: string; amount_minor: number }>();
    expect(payment).toEqual({
      method: 'Zero charge',
      external_reference: 'ZERO-OWNER-1',
      amount_minor: 0,
    });

    const first = await createRefundRequest({
      database: env.DB,
      context: await storefrontCustomer(orderId),
      orderId,
      body: { reason: 'Original reason' },
      idempotencyKey: 'command-zero-refund-a1',
    });
    const second = await createRefundRequest({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: { reason: 'Different reason' },
      idempotencyKey: 'command-zero-refund-b1',
    });
    expect(second.refundRequest).toEqual(first.refundRequest);
    expect(second.refundRequest?.reason).toBe('Original reason');
    await expect(createRefundRequest({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: { reason: 'Original reason' },
      idempotencyKey: 'command-zero-refund-b1',
    })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const replay = await createRefundRequest({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: { reason: 'Different reason' },
      idempotencyKey: 'command-zero-refund-b1',
    });
    expect(replay.refundRequest).toEqual(first.refundRequest);
    expect(await markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId,
      body: payBody('ZERO-OWNER-1', 'Zero charge'),
      idempotencyKey: 'command-zero-paid00001',
    })).toEqual(paid);
    expect(await commandGraph(orderId)).toMatchObject({
      status: 'paid',
      refunds: 1,
      payments: 1,
      actions: ['order_paid', 'refund_requested'],
    });
  });

  it('cross-Order same-key race keeps the losing Order unchanged', async () => {
    const product = await createSimple();
    const first = await placeOrder('create-cross-a-00001', CAPABILITY_A, product);
    const second = await placeOrder('create-cross-b-00001', CAPABILITY_B, product);
    const firstId = await placedOrderId(first.reference, CAPABILITY_A);
    const secondId = await placedOrderId(second.reference, CAPABILITY_B);
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

    const paidA = markPaid({
      database: racing,
      context: OWNER_CONTEXT,
      orderId: firstId,
      body: payBody('WIRE-CROSS-A'),
      idempotencyKey: KEY_PAID,
    });
    const cancelB = cancelOrder({
      database: racing,
      context: OWNER_CONTEXT,
      orderId: secondId,
      body: {},
      idempotencyKey: KEY_PAID,
    });
    await started.promise;
    gate.resolve();
    const settled = await Promise.allSettled([paidA, cancelB]);
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
      expect(statusA).toBe('paid');
      expect(statusB).toBe('pending');
    } else {
      expect(statusA).toBe('pending');
      expect(statusB).toBe('canceled');
    }
  });

  it('fulfills legacy paid Orders without inventing a Payment and reserves version-1 keys', async () => {
    await resetCatalogThrough(5);
    const digest = await digestOrderCapability(CAPABILITY_A);
    const hash = 'ab'.repeat(32);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customers (id,store_id,name,email_normalized) VALUES ('cust_zero','store_nexus','Ada Historic','ada-zero@example.test')",
      ),
      env.DB.prepare(
        `INSERT INTO order_lines (
           id, store_id, order_id, product_id, product_name, variant_id, variant_sku,
           selected_options_json, quantity, unit_price_minor, line_total_minor, currency,
           access_title, access_instructions, private_file_key
         ) VALUES ('line_zero','store_nexus','ord_zero','prod_notes','Field Notes',NULL,NULL,'[]',1,0,0,'USD','Download Field Notes','Open the PDF',NULL)`,
      ),
      env.DB.prepare(
        `INSERT INTO orders (
           id, store_id, reference, customer_id, customer_name, customer_email_normalized,
           status, currency, total_minor, created_at
         ) VALUES ('ord_zero','store_nexus','NX-ZERO-LEGACY-01','cust_zero','Ada Historic','ada-zero@example.test','completed','USD',0,'2026-01-01T10:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO order_history (id, store_id, order_id, status, created_at, action, source, from_status)
         VALUES ('hist_zero_created','store_nexus','ord_zero','pending_payment','2026-01-01T10:00:00.100Z','order_created','customer_capability',NULL)`,
      ),
      env.DB.prepare(
        `INSERT INTO order_history (id, store_id, order_id, status, created_at, action, source, from_status)
         VALUES ('hist_zero_done','store_nexus','ord_zero','completed','2026-01-01T11:00:00.000Z','order_completed','console','pending_payment')`,
      ),
      env.DB.prepare(
        'INSERT INTO order_access (id, store_id, order_id, capability_digest) VALUES (?,?,?,?)',
      ).bind('access_zero', 'store_nexus', 'ord_zero', digest),
      env.DB.prepare(
        `INSERT INTO order_commands (id, store_id, request_key, order_id, action, payload_hash, result_history_id, created_at)
         VALUES ('cmd_zero_complete','store_nexus','legacy-complete-01','ord_zero','complete',?,'hist_zero_done','2026-01-01T11:00:00.050Z')`,
      ).bind(hash),
    ]);
    await applyD1Migrations(env.DB, catalogMigrations.slice(5));

    const before = await env.DB.prepare(
      'SELECT id, total_minor, currency, status FROM orders WHERE id = ?',
    ).bind('ord_zero').first();
    expect(before).toMatchObject({ id: 'ord_zero', total_minor: 0, currency: 'USD', status: 'paid' });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id = ?')
      .bind('ord_zero').first<number>('count')).toBe(0);

    const fulfilled = await fulfillOrder({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: 'ord_zero',
      body: {},
      idempotencyKey: 'legacy-fulfill-0001',
    });
    expect(fulfilled).toMatchObject({ action: 'fulfill', status: 'fulfilled', paymentId: null });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id = ?')
      .bind('ord_zero').first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT id, total_minor FROM orders WHERE id = ?')
      .bind('ord_zero').first()).toMatchObject({ id: 'ord_zero', total_minor: 0 });

    const refunded = await createRefundRequest({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: 'ord_zero',
      body: { reason: 'Legacy return' },
      idempotencyKey: 'legacy-refund-000001',
    });
    expect(refunded.refundRequest?.reason).toBe('Legacy return');
    expect(refunded.status).toBe('fulfilled');

    const storedHash = await env.DB.prepare(
      'SELECT payload_hash, action, contract_version FROM order_commands WHERE request_key = ?',
    ).bind('legacy-complete-01').first<{ payload_hash: string; action: string; contract_version: number }>();
    await expect(markPaid({
      database: env.DB,
      context: OWNER_CONTEXT,
      orderId: 'ord_zero',
      body: payBody('ZERO-LEGACY-1', 'Zero charge'),
      idempotencyKey: 'legacy-complete-01',
    })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    expect(await env.DB.prepare(
      'SELECT payload_hash, action, contract_version FROM order_commands WHERE request_key = ?',
    ).bind('legacy-complete-01').first()).toEqual(storedHash);
    expect(storedHash).toMatchObject({ payload_hash: hash, action: 'complete', contract_version: 1 });
  });
});
