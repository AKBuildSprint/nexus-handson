import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import { createOrder } from '@nexus/orders/commands/order-write';
import { PUBLIC_STORE_ID } from '@nexus/catalog/public-store';
import { cancelOrder, confirmPayfsCredit as confirmPayfsCreditCommand, markPaid } from '@nexus/orders/commands/order-commands';
import { assignOrder } from '@nexus/orders/commands/order-assignment';
import {
  SIMPLE_CORE,
  consoleRequest,
  getConsoleIdentity,
  resetCatalog,
  workerRequest,
} from '../support/catalog-test-env';
import { createConsoleSession, TEST_CONSOLE_ORIGIN } from '../support/identity-test-env';

const PAYFS_BINDINGS = {
  PAYFS_WEBHOOK_API_KEY: 'payfs-test-webhook-key',
  PAYFS_MERCHANT_BANK: 'MB',
  PAYFS_MERCHANT_ACCOUNT: '0933723830',
  PAYFS_FEFAULT_ACCOUNT: '0933723830',
};

const STOREFRONT_CONTEXT = {
  storeId: PUBLIC_STORE_ID,
  actor: { source: 'storefront' as const, id: null },
  identity: { kind: 'public' as const },
};

beforeEach(resetCatalog);

async function createOrderForCurrency(currency: 'USD' | 'VND', basePrice: string) {
  const response = await consoleRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product: { ...SIMPLE_CORE, basePrice, currency },
      schema: null,
      previewHash: null,
    }),
  });
  expect(response.status).toBe(201);
  const product = (await response.json() as { product: ProductDetailResponse }).product;
  return createOrder({
    database: env.DB,
    context: STOREFRONT_CONTEXT,
    body: {
      customer: { name: 'Ada Lovelace', email: 'ada@example.test' },
      items: [{ productId: product.id, variantId: null, quantity: 1 }],
    },
    idempotencyKey: `payfs-order-${crypto.randomUUID()}`,
    capability: 'P'.repeat(43),
  });
}

function createVndOrder() {
  return createOrderForCurrency('VND', '14000');
}

function createUsdOrder() {
  return createOrderForCurrency('USD', '140.00');
}

function credit(overrides: Record<string, unknown> = {}) {
  return {
    account_id: '1418079746853494784',
    amount: 14_000,
    bank: 'MB',
    bank_account_number: PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
    content: 'Ada transfer NP0123456789abcdef0123456789abcdef',
    transaction_date: '2025-09-15T15:02:00.000Z',
    transaction_id: '1418108930751619072',
    transfer_type: 'credit',
    ...overrides,
  };
}
function payfsRequest(body: unknown, init: RequestInit = {}, bindings = PAYFS_BINDINGS) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Client-API-Key', PAYFS_BINDINGS.PAYFS_WEBHOOK_API_KEY);
  return workerRequest('/api/payfs/webhook', {
    ...init,
    method: init.method ?? 'POST',
    headers,
    body: JSON.stringify(body),
  }, bindings);
}

function confirmPayfsCredit(input: Omit<Parameters<typeof confirmPayfsCreditCommand>[0], 'payloadJson'>) {
  return confirmPayfsCreditCommand({ ...input, payloadJson: JSON.stringify(input.body) });
}

async function recordManualPayment(reference: string): Promise<Response> {
  return consoleRequest(`/api/console/orders/${reference}/payments/manual`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `payfs-manual-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({ method: 'Bank transfer', reference: 'MANUAL-PAYFS-CONFLICT' }),
  });
}

async function cancelViaConsole(reference: string): Promise<Response> {
  return consoleRequest(`/api/console/orders/${reference}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `payfs-cancel-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({}),
  });
}

async function receiptCount(): Promise<number> {
  return (await env.DB.prepare('SELECT count(*) AS count FROM payfs_payment_receipts').first<number>('count')) ?? 0;
}

async function orderId(reference: string): Promise<string> {
  const id = await env.DB.prepare('SELECT id FROM orders WHERE reference = ?').bind(reference).first<string>('id');
  if (id === null) throw new Error('Expected test Order.');
  return id;
}

async function createSiblingOrder(orderId: string) {
  const productId = await env.DB.prepare(
    'SELECT product_id FROM order_lines WHERE order_id = ?',
  ).bind(orderId).first<string>('product_id');
  if (productId === null) throw new Error('Expected test Product.');
  return createOrder({
    database: env.DB,
    context: STOREFRONT_CONTEXT,
    body: {
      customer: { name: 'Grace Hopper', email: 'grace@example.test' },
      items: [{ productId, variantId: null, quantity: 1 }],
    },
    idempotencyKey: `payfs-sibling-${crypto.randomUUID()}`,
    capability: 'Q'.repeat(43),
  });
}

function batchGate() {
  let resolveGate = () => {};
  let resolveStarted = () => {};
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  let waiting = 0;
  const database = new Proxy(env.DB, {
    get(target, property, receiver) {
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          waiting += 1;
          if (waiting === 2) resolveStarted();
          await gate;
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as D1Database;
  return { database, started, release: resolveGate };
}

async function ownerContext() {
  const identity = await getConsoleIdentity();
  return {
    storeId: identity.storeId,
    actor: { source: 'user' as const, id: identity.userId },
    identity,
  };
}

async function payfsFinancialGraph(orderId: string) {
  const [status, history, receipts] = await Promise.all([
    env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first<string>('status'),
    env.DB.prepare(
      'SELECT action, source, status FROM order_history WHERE order_id = ? ORDER BY id',
    ).bind(orderId).all(),
    env.DB.prepare(
      'SELECT transaction_id, outcome, order_id, history_id FROM payfs_payment_receipts WHERE order_id = ? ORDER BY id',
    ).bind(orderId).all(),
  ]);
  return { status, history: history.results, receipts: receipts.results };
}

describe('PayFS webhook', () => {
  it('confirms the exact VND Order once and projects a safe PayFS payment detail', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const response = await payfsRequest(credit({ content: `Ada transfer ${order.paymentReference}` }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'confirmed' });

    expect(await env.DB.prepare('SELECT status FROM orders WHERE reference = ?').bind(order.reference).first<string>('status'))
      .toBe('paid');
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id = ? AND action = 'order_paid' AND source = 'system'",
    ).bind(id).first<number>('count')).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id = ?').bind(id).first<number>('count'))
      .toBe(0);
    expect(await receiptCount()).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_email_jobs WHERE order_id = ? AND kind = 'payment_confirmed'",
    ).bind(id).first<number>('count')).toBe(1);

    const detailResponse = await consoleRequest(`/api/console/orders/${order.reference}`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as {
      order: {
        payment: Record<string, unknown>;
        providerEvents: Array<Record<string, unknown>>;
        providerPayments: Array<Record<string, unknown>>;
      };
    };
    expect(detail.order.payment).toEqual(expect.objectContaining({
      source: 'payfs', amountMinor: 14_000, currency: 'VND', status: 'succeeded',
    }));
    expect(detail.order.providerEvents).toEqual([expect.objectContaining({
      type: 'payment',
      provider: 'payfs',
      providerEventId: '1418108930751619072',
      payloadJson: JSON.stringify(credit({ content: `Ada transfer ${order.paymentReference}` })),
    })]);
    expect(detail.order.providerPayments).toEqual([expect.objectContaining({
      gateway: 'payfs',
      providerTransactionId: '1418108930751619072',
      amountMinor: 14_000,
      currency: 'VND',
      status: 'succeeded',
    })]);

    const replay = await payfsRequest(credit({ content: `Ada transfer ${order.paymentReference}` }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ status: 'already_processed' });
    expect(await receiptCount()).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id = ? AND action = 'order_paid'",
    ).bind(id).first<number>('count')).toBe(1);
  });

  it('returns provider audit summaries to assigned Staff without raw payload JSON', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const staff = await createConsoleSession({ email: 'payfs-audit-staff@example.test', role: 'staff' });
    await assignOrder({
      database: env.DB,
      identity: await getConsoleIdentity(),
      orderId: id,
      body: { assigneeUserId: staff.userId },
      idempotencyKey: 'payfs-audit-assignment',
    });
    expect(await (await payfsRequest(credit({
      content: `Ada transfer ${order.paymentReference}`,
      transaction_id: 'payfs-staff-audit',
    }))).json()).toEqual({ status: 'confirmed' });
    const response = await workerRequest(`/api/console/orders/${order.reference}`, {
      headers: {
        Cookie: staff.cookie,
        Origin: TEST_CONSOLE_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        'X-Nexus-Order-Contract': '2',
      },
    });
    expect(response.status).toBe(200);
    const detail = await response.json() as {
      order: { providerEvents: Array<Record<string, unknown>>; providerPayments: Array<Record<string, unknown>> };
    };
    expect(detail.order.providerEvents).toEqual([expect.objectContaining({
      provider: 'payfs',
      providerEventId: 'payfs-staff-audit',
    })]);
    expect(detail.order.providerEvents[0]).not.toHaveProperty('payloadJson');
    expect(detail.order.providerPayments).toEqual([expect.objectContaining({
      gateway: 'payfs',
      providerTransactionId: 'payfs-staff-audit',
      amountMinor: 14_000,
    })]);
  });

  it('reconciles an ignored recipient mismatch after the webhook account is corrected', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const body = credit({
      content: `Ada transfer ${order.paymentReference}`,
      transaction_id: 'payfs-recipient-reconciled',
    });
    const ignored = await payfsRequest(body, {}, {
      ...PAYFS_BINDINGS,
      PAYFS_FEFAULT_ACCOUNT: 'VIRTUAL-ACCOUNT',
    });
    expect(await ignored.json()).toEqual({ status: 'ignored' });
    const eventBefore = await env.DB.prepare(
      `SELECT id, store_id, order_id, payload_json, received_at
         FROM provider_events WHERE provider = 'payfs' AND provider_event_id = ?`,
    ).bind('payfs-recipient-reconciled').first();
    expect(eventBefore).toMatchObject({ store_id: null, order_id: null, payload_json: JSON.stringify(body) });

    const reconciled = await payfsRequest(body);
    expect(await reconciled.json()).toEqual({ status: 'confirmed' });
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<string>('status')).toBe('paid');
    const eventAfter = await env.DB.prepare(
      `SELECT id, store_id, order_id, payload_json, received_at
         FROM provider_events WHERE provider = 'payfs' AND provider_event_id = ?`,
    ).bind('payfs-recipient-reconciled').first();
    expect(eventAfter).toEqual(eventBefore);
    expect(await env.DB.prepare(
      'SELECT outcome, ignored_reason FROM payfs_payment_receipts WHERE transaction_id = ?',
    ).bind('payfs-recipient-reconciled').first()).toEqual({ outcome: 'confirmed', ignored_reason: null });
  });

  it('rejects conflicting transaction facts and ignores semantic mismatches without settlement', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const mismatch = await payfsRequest(credit({ content: `Ada transfer ${order.paymentReference}`, amount: 13_999 }));
    expect(mismatch.status).toBe(200);
    expect(await mismatch.json()).toEqual({ status: 'ignored' });
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<string>('status')).toBe('pending');
    expect(await receiptCount()).toBe(1);

    const conflict = await payfsRequest(credit({ content: `Ada transfer ${order.paymentReference}`, amount: 14_000 }));
    expect(conflict.status).toBe(400);
    expect(await receiptCount()).toBe(1);
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<string>('status')).toBe('pending');
  });

  it('enforces the public boundary without CORS, Console credentials, or financial writes', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const noKey = await workerRequest('/api/payfs/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credit({ content: `Ada transfer ${order.paymentReference}` })),
    }, PAYFS_BINDINGS);
    expect(noKey.status).toBe(401);
    expect(noKey.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const malformed = await payfsRequest({ transaction_id: 'missing-fields' });
    expect(malformed.status).toBe(400);
    expect(await receiptCount()).toBe(0);

    const options = await payfsRequest({}, { method: 'OPTIONS' });
    expect(options.status).toBe(405);
    expect(options.headers.get('Allow')).toBe('POST');
    expect(options.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const unavailable = await workerRequest('/api/payfs/webhook', { method: 'POST' });
    expect(unavailable.status).toBe(503);
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<string>('status')).toBe('pending');
  });

  it('normalizes repeated reference tokens and recovers concurrent duplicate delivery', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const content = `Ada transfer ${order.paymentReference.toUpperCase()} ${order.paymentReference}`;
    const race = batchGate();
    const request = {
      body: credit({ content, transaction_id: 'payfs-duplicate-race' }),
      merchantBank: PAYFS_BINDINGS.PAYFS_MERCHANT_BANK,
      merchantAccount: PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
    };
    const first = confirmPayfsCredit({ database: race.database, ...request });
    const second = confirmPayfsCredit({ database: race.database, ...request });
    await race.started;
    race.release();
    expect((await Promise.all([first, second])).sort()).toEqual(['already_processed', 'confirmed']);
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<string>('status')).toBe('paid');
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id = ? AND action = 'order_paid'",
    ).bind(id).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM payfs_payment_receipts WHERE order_id = ? AND outcome = 'confirmed'",
    ).bind(id).first<number>('count')).toBe(1);
  });

  it('rejects concurrent conflicting facts for one transaction without retargeting it', async () => {
    const firstOrder = await createVndOrder();
    const firstId = await orderId(firstOrder.reference);
    const secondOrder = await createSiblingOrder(firstId);
    const secondId = await orderId(secondOrder.reference);
    const firstBody = credit({
      content: `Ada transfer ${firstOrder.paymentReference}`,
      transaction_id: 'payfs-conflicting-race',
    });
    const secondBody = credit({
      content: `Ada transfer ${secondOrder.paymentReference}`,
      transaction_id: 'payfs-conflicting-race',
    });
    const race = batchGate();
    const request = {
      database: race.database,
      merchantBank: PAYFS_BINDINGS.PAYFS_MERCHANT_BANK,
      merchantAccount: PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
    };
    const deliveries = Promise.allSettled([
      confirmPayfsCredit({ ...request, body: firstBody }),
      confirmPayfsCredit({ ...request, body: secondBody }),
    ]);
    await race.started;
    race.release();
    const [firstResult, secondResult] = await deliveries;
    const firstWon = firstResult!.status === 'fulfilled';
    const winner = firstWon
      ? { id: firstId, body: firstBody, result: firstResult!, losing: secondResult!, losingId: secondId, losingBody: secondBody }
      : { id: secondId, body: secondBody, result: secondResult!, losing: firstResult!, losingId: firstId, losingBody: firstBody };
    expect(winner.result).toMatchObject({ status: 'fulfilled', value: 'confirmed' });
    expect(winner.losing).toMatchObject({
      status: 'rejected',
      reason: { code: 'payfs_transaction_conflict', status: 400 },
    });
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(winner.id).first<string>('status')).toBe('paid');
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(winner.losingId).first<string>('status'))
      .toBe('pending');
    const receipt = await env.DB.prepare(
      'SELECT order_id, history_id, facts_fingerprint, outcome FROM payfs_payment_receipts WHERE transaction_id = ?',
    ).bind('payfs-conflicting-race').first<{ order_id: string; history_id: string; facts_fingerprint: string; outcome: string }>();
    const history = (await env.DB.prepare(
      "SELECT id, order_id, action, source, status FROM order_history WHERE order_id IN (?, ?) AND action = 'order_paid' ORDER BY order_id",
    ).bind(firstId, secondId).all<{ id: string; order_id: string; action: string; source: string; status: string }>()).results;
    const graph = { receipt, history };
    expect(graph.receipt).toMatchObject({ order_id: winner.id, outcome: 'confirmed' });
    expect(graph.history).toEqual([expect.objectContaining({ order_id: winner.id, action: 'order_paid', source: 'system' })]);
    expect(graph.receipt?.history_id).toBe(graph.history[0]?.id);
    expect(await confirmPayfsCredit({
      database: env.DB,
      body: winner.body,
      merchantBank: PAYFS_BINDINGS.PAYFS_MERCHANT_BANK,
      merchantAccount: PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
    })).toBe('already_processed');
    await expect(confirmPayfsCredit({
      database: env.DB,
      body: winner.losingBody,
      merchantBank: PAYFS_BINDINGS.PAYFS_MERCHANT_BANK,
      merchantAccount: PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
    })).rejects.toMatchObject({ code: 'payfs_transaction_conflict', status: 400 });
    const graphAfterReplay = {
      receipt: await env.DB.prepare(
        'SELECT order_id, history_id, facts_fingerprint, outcome FROM payfs_payment_receipts WHERE transaction_id = ?',
      ).bind('payfs-conflicting-race').first<{ order_id: string; history_id: string; facts_fingerprint: string; outcome: string }>(),
      history: (await env.DB.prepare(
        "SELECT id, order_id, action, source, status FROM order_history WHERE order_id IN (?, ?) AND action = 'order_paid' ORDER BY order_id",
      ).bind(firstId, secondId).all<{ id: string; order_id: string; action: string; source: string; status: string }>()).results,
    };
    expect(graphAfterReplay).toEqual(graph);
  });

  it('ignores debit, recipient, reference, total, and currency mismatches without settling', async () => {
    const vnd = await createVndOrder();
    const id = await orderId(vnd.reference);
    const otherReference = 'NPffffffffffffffffff';
    for (const overrides of [
      { transfer_type: 'debit', transaction_id: 'payfs-debit-1' },
      { bank_account_number: '0000000000', transaction_id: 'payfs-recipient-1' },
      { content: 'Ada transfer without a payment reference', transaction_id: 'payfs-missing-1' },
      { content: `Ada x${vnd.paymentReference}`, transaction_id: 'payfs-prefix-boundary-1' },
      { content: `Ada ${vnd.paymentReference}x`, transaction_id: 'payfs-suffix-boundary-1' },
      { content: `Ada ${vnd.paymentReference} ${otherReference}`, transaction_id: 'payfs-ambiguous-1' },
      { amount: 13_999, transaction_id: 'payfs-total-1' },
    ]) {
      const response = await payfsRequest(credit({
        content: `Ada transfer ${vnd.paymentReference}`,
        ...overrides,
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ignored' });
    }
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<string>('status')).toBe('pending');
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id = ? AND action = 'order_paid'",
    ).bind(id).first<number>('count')).toBe(0);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM provider_events WHERE type = 'payment' AND provider = 'payfs'",
    ).first<number>('count')).toBe(7);
    expect(await env.DB.prepare(
      `SELECT provider_event_id, payload_json, store_id, order_id
         FROM provider_events WHERE provider_event_id = 'payfs-total-1'`,
    ).first()).toEqual({
      provider_event_id: 'payfs-total-1',
      payload_json: JSON.stringify(credit({
        content: `Ada transfer ${vnd.paymentReference}`,
        amount: 13_999,
        transaction_id: 'payfs-total-1',
      })),
      store_id: null,
      order_id: null,
    });

    await resetCatalog();
    const usd = await createUsdOrder();
    const usdResponse = await payfsRequest(credit({
      content: `Ada transfer ${usd.paymentReference}`,
      transaction_id: 'payfs-usd-1',
    }));
    expect(usdResponse.status).toBe(200);
    expect(await usdResponse.json()).toEqual({ status: 'ignored' });
    expect(await env.DB.prepare('SELECT status FROM orders WHERE reference = ?').bind(usd.reference).first<string>('status'))
      .toBe('pending');
  });
  it('does not settle an Order already paid manually or canceled', async () => {
    const paidManually = await createVndOrder();
    expect((await recordManualPayment(paidManually.reference)).status).toBe(200);
    const afterManual = await payfsRequest(credit({
      content: `Ada transfer ${paidManually.paymentReference}`,
      transaction_id: 'payfs-after-manual',
    }));
    expect(await afterManual.json()).toEqual({ status: 'ignored' });

    await resetCatalog();
    const canceled = await createVndOrder();
    expect((await cancelViaConsole(canceled.reference)).status).toBe(200);
    const afterCancel = await payfsRequest(credit({
      content: `Ada transfer ${canceled.paymentReference}`,
      transaction_id: 'payfs-after-cancel',
    }));
    expect(await afterCancel.json()).toEqual({ status: 'ignored' });
    expect(await env.DB.prepare('SELECT status FROM orders WHERE reference = ?').bind(canceled.reference).first<string>('status'))
      .toBe('canceled');
  });


  it('makes concurrent PayFS and manual payment choose one paid evidence graph', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const race = batchGate();
    const context = await ownerContext();
    const payfs = confirmPayfsCredit({
      database: race.database,
      body: credit({ content: `Ada transfer ${order.paymentReference}`, transaction_id: 'payfs-manual-race' }),
      merchantBank: PAYFS_BINDINGS.PAYFS_MERCHANT_BANK,
      merchantAccount: PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
    });
    const manual = markPaid({
      database: race.database,
      context,
      orderId: id,
      body: { method: 'Bank transfer', reference: 'MANUAL-RACE' },
      idempotencyKey: 'payfs-manual-race-key',
    });
    const settled = Promise.allSettled([payfs, manual]);
    await race.started;
    race.release();
    const [payfsResult, manualResult] = await settled;
    expect(payfsResult).toMatchObject({ status: 'fulfilled' });
    if (payfsResult.status === 'fulfilled' && payfsResult.value === 'confirmed') {
      expect(manualResult).toMatchObject({
        status: 'rejected',
        reason: { code: 'order_state_conflict', status: 409 },
      });
    } else {
      expect(payfsResult).toMatchObject({ value: 'ignored' });
      expect(manualResult).toMatchObject({ status: 'fulfilled', value: { action: 'mark_paid' } });
    }
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<string>('status')).toBe('paid');
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id = ? AND action = 'order_paid'",
    ).bind(id).first<number>('count')).toBe(1);
    const [manualPayments, confirmedReceipts] = await Promise.all([
      env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id = ?').bind(id).first<number>('count'),
      env.DB.prepare(

        "SELECT count(*) AS count FROM payfs_payment_receipts WHERE order_id = ? AND outcome = 'confirmed'",
      ).bind(id).first<number>('count'),
    ]);
    expect((manualPayments ?? 0) + (confirmedReceipts ?? 0)).toBe(1);
  });

  it('records an ignored provider event when cancellation wins after PayFS target lookup', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const context = await ownerContext();
    let settlementBatchStarted = false;
    const database = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            if (!settlementBatchStarted) {
              settlementBatchStarted = true;
              await cancelOrder({
                database: target,
                context,
                orderId: id,
                body: {},
                idempotencyKey: 'payfs-late-cancel',
              });
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;
    const body = credit({
      content: `Ada transfer ${order.paymentReference}`,
      transaction_id: 'payfs-late-cancel',
    });
    expect(await confirmPayfsCredit({
      database,
      body,
      merchantBank: PAYFS_BINDINGS.PAYFS_MERCHANT_BANK,
      merchantAccount: PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
    })).toBe('ignored');
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<string>('status')).toBe('canceled');
    expect(await env.DB.prepare(
      `SELECT outcome, ignored_reason FROM payfs_payment_receipts WHERE transaction_id = 'payfs-late-cancel'`,
    ).first()).toEqual({ outcome: 'ignored', ignored_reason: 'order_not_eligible' });
    expect(await env.DB.prepare(
      `SELECT store_id, order_id, payload_json FROM provider_events WHERE provider_event_id = 'payfs-late-cancel'`,
    ).first()).toEqual({ store_id: null, order_id: null, payload_json: JSON.stringify(body) });
    expect(await confirmPayfsCredit({
      database: env.DB,
      body,
      merchantBank: PAYFS_BINDINGS.PAYFS_MERCHANT_BANK,
      merchantAccount: PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
    })).toBe('already_processed');
  });

  it('makes concurrent PayFS and cancellation choose one terminal order transition', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const race = batchGate();
    const context = await ownerContext();
    const payfs = confirmPayfsCredit({
      database: race.database,
      body: credit({ content: `Ada transfer ${order.paymentReference}`, transaction_id: 'payfs-cancel-race' }),
      merchantBank: PAYFS_BINDINGS.PAYFS_MERCHANT_BANK,
      merchantAccount: PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
    });
    const cancellation = cancelOrder({
      database: race.database,
      context,
      orderId: id,
      body: {},
      idempotencyKey: 'payfs-cancel-race-key',
    });
    const settled = Promise.allSettled([payfs, cancellation]);
    await race.started;
    race.release();
    const [payfsResult, cancellationResult] = await settled;
    expect(payfsResult).toMatchObject({ status: 'fulfilled' });
    if (payfsResult.status === 'fulfilled' && payfsResult.value === 'confirmed') {
      expect(cancellationResult).toMatchObject({
        status: 'rejected',
        reason: { code: 'order_state_conflict', status: 409 },
      });
    } else {
      expect(payfsResult).toMatchObject({ value: 'ignored' });
      expect(cancellationResult).toMatchObject({ status: 'fulfilled', value: { action: 'cancel' } });
    }
    const status = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<string>('status');
    expect(['paid', 'canceled']).toContain(status);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id = ? AND action IN ('order_paid', 'order_canceled')",
    ).bind(id).first<number>('count')).toBe(1);
    const receipt = await env.DB.prepare(
      'SELECT outcome FROM payfs_payment_receipts WHERE transaction_id = ?',
    ).bind('payfs-cancel-race').first<string>('outcome');
    expect(receipt).toBe(status === 'paid' ? 'confirmed' : 'ignored');
  });
  it('rolls a failed confirmation batch back without a partial financial graph', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const before = await payfsFinancialGraph(id);
    const failingDatabase = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === 'batch') {
          return (statements: D1PreparedStatement[]) => target.batch([
            ...statements,
            target.prepare('INSERT INTO orders (id) VALUES (NULL)'),
          ]);
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;
    await expect(confirmPayfsCredit({
      database: failingDatabase,
      body: credit({ content: `Ada transfer ${order.paymentReference}`, transaction_id: 'payfs-batch-failure' }),
      merchantBank: PAYFS_BINDINGS.PAYFS_MERCHANT_BANK,
      merchantAccount: PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
    })).rejects.toMatchObject({ code: 'order_persistence_failed' });
    expect(await payfsFinancialGraph(id)).toEqual(before);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM payfs_payment_receipts WHERE transaction_id = 'payfs-batch-failure'",
    ).first<number>('count')).toBe(0);
  });


  it('returns a generic retryable 500 without CORS or financial writes when settlement persistence fails', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const failingDatabase = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === 'batch') {
          return (statements: D1PreparedStatement[]) => target.batch([
            ...statements,
            target.prepare('INSERT INTO orders (id) VALUES (NULL)'),
          ]);
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;
    const response = await workerRequest('/api/payfs/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-API-Key': PAYFS_BINDINGS.PAYFS_WEBHOOK_API_KEY,
      },
      body: JSON.stringify(credit({
        content: `Ada transfer ${order.paymentReference}`,
        transaction_id: 'payfs-dispatcher-failure',
      })),
    }, { ...PAYFS_BINDINGS, DB: failingDatabase });
    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('payfs_persistence_failed');
    const serialized = JSON.stringify(body);
    for (const secret of [
      PAYFS_BINDINGS.PAYFS_WEBHOOK_API_KEY,
      PAYFS_BINDINGS.PAYFS_MERCHANT_ACCOUNT,
      order.reference,
      order.paymentReference,
      'payfs-dispatcher-failure',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(await payfsFinancialGraph(id)).toEqual({
      status: 'pending',
      history: [expect.objectContaining({ action: 'order_created' })],
      receipts: [],
    });
  });
  it('rejects an oversized streamed credit without a durable payment effect', async () => {
    const order = await createVndOrder();
    const id = await orderId(order.reference);
    const payload = new TextEncoder().encode(`${' '.repeat(17_000)}${JSON.stringify(credit({
      content: `Ada transfer ${order.paymentReference}`,
      transaction_id: 'payfs-oversized-stream',
    }))}`);
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = payload.subarray(offset, offset + 9_000);
        offset += chunk.byteLength;
        controller.enqueue(chunk);
        if (offset === payload.byteLength) controller.close();
      },
    });
    const response = await workerRequest('/api/payfs/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-API-Key': PAYFS_BINDINGS.PAYFS_WEBHOOK_API_KEY,
      },
      body,
    }, PAYFS_BINDINGS);
    expect(response.status).toBe(400);
    expect(await payfsFinancialGraph(id)).toEqual({
      status: 'pending',
      history: [expect.objectContaining({ action: 'order_created' })],
      receipts: [],
    });
  });
});
