import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDetailResponse } from '../../src/catalog/catalog-types';
import { BOOTSTRAP_STORE_ID } from '../../src/catalog/catalog-read';
import { routeStorefrontOrderRequest } from '../../src/worker/storefront-order-routes';
import { createOrder as persistStorefrontOrder } from '../../src/orders/order-write';
import {
  resetCatalog,
  SIMPLE_CORE,
  TEST_STOREFRONT_ORIGIN,
  VARIANT_CORE,
  oneVariantSchema,
  workerRequest,
} from '../support/catalog-test-env';

const CAPABILITY_A = 'A'.repeat(43);
const CAPABILITY_B = 'B'.repeat(43);
const PRIVATE_DENIAL = {
  error: {
    code: 'not_found',
    message: 'Order not found.',
    fields: [],
    incidentId: null,
  },
};
const FORBIDDEN_KEY = /(access|capability|delivery|digest|file|idempotency|private)/i;
const ALLOWED_KEYS: Record<string, true> = {
  action: true,
  allowedActions: true,
  code: true,
  createdAt: true,
  currency: true,
  customer: true,
  email: true,
  error: true,
  fields: true,
  fromStatus: true,
  groupId: true,
  groupName: true,
  hasOrders: true,
  history: true,
  id: true,
  incidentId: true,
  message: true,
  name: true,
  nextCursor: true,
  occurredAt: true,
  order: true,
  orders: true,
  path: true,
  paymentNextStep: true,
  product: true,
  quantity: true,
  reason: true,
  reference: true,
  refundRequest: true,
  refundRequestStatus: true,
  selectedOptions: true,
  sku: true,
  source: true,
  status: true,
  toStatus: true,
  totalMinor: true,
  unitPriceMinor: true,
  valueId: true,
  valueLabel: true,
  variant: true,
};

beforeEach(resetCatalog);
afterEach(() => {
  vi.restoreAllMocks();
});

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}

function encodeCursor(tuple: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(tuple));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function capabilityFor(index: number): string {
  return `cap${index.toString().padStart(2, '0')}${'x'.repeat(32)}`;
}

function keyFor(label: string): string {
  return `${label}-${'k'.repeat(16)}`.slice(0, 128);
}

async function createSimpleProduct(): Promise<ProductDetailResponse> {
  const response = await workerRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { product: ProductDetailResponse }).product;
}

async function createActiveVariant(): Promise<ProductDetailResponse> {
  const product = { ...VARIANT_CORE, status: 'active' as const };
  const schema = oneVariantSchema();
  const preview = await workerRequest('/api/console/products/schema/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: null, productSlug: 'focus-pack', product, schema }),
  });
  const previewHash = (await preview.json() as { previewHash: string }).previewHash;
  const response = await workerRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product, schema, previewHash }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { product: ProductDetailResponse }).product;
}

async function createOrder(input: {
  productId: string;
  variantId?: string | null;
  key: string;
  capability: string;
  customer?: { name: string; email: string };
  quantity?: number;
}): Promise<Record<string, unknown> & { reference: string; createdAt: string }> {
  const response = await workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.key,
      'X-Nexus-Order-Capability': input.capability,
    },
    body: JSON.stringify({
      customer: input.customer ?? { name: 'Ada Lovelace', email: 'ada@example.test' },
      productId: input.productId,
      variantId: input.variantId ?? null,
      quantity: input.quantity ?? 1,
    }),
  });
  expect(response.status).toBe(201);
  return await response.json() as Record<string, unknown> & { reference: string; createdAt: string };
}

async function complete(reference: string, key: string): Promise<Response> {
  return workerRequest(`/api/console/orders/${reference}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      Origin: TEST_STOREFRONT_ORIGIN,
    },
    body: JSON.stringify({ paymentConfirmed: true }),
  });
}

async function cancel(reference: string, key: string): Promise<Response> {
  return workerRequest(`/api/console/orders/${reference}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      Origin: TEST_STOREFRONT_ORIGIN,
    },
    body: JSON.stringify({}),
  });
}

async function refund(reference: string, capability: string, key: string, reason: string): Promise<Response> {
  return workerRequest(`/api/storefront/orders/${reference}/refund-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      'X-Nexus-Order-Capability': capability,
      Origin: TEST_STOREFRONT_ORIGIN,
    },
    body: JSON.stringify({ reason }),
  });
}

async function list(query = ''): Promise<Response> {
  return workerRequest(`/api/console/orders${query}`);
}

async function tableCounts(): Promise<Record<string, number>> {
  const names = ['orders', 'order_history', 'order_refund_requests', 'order_commands', 'order_idempotency'] as const;
  const counts = await Promise.all(names.map(async (table) => ({
    table,
    count: await env.DB.prepare(`SELECT count(*) AS count FROM ${table}`).first<number>('count') ?? 0,
  })));
  return Object.fromEntries(counts.map((row) => [row.table, row.count]));
}

function assertSafeJson(body: unknown, extraForbidden: string[] = []): void {
  const keys = allKeys(body);
  expect(keys.filter((key) => FORBIDDEN_KEY.test(key))).toEqual([]);
  expect(keys.filter((key) => ALLOWED_KEYS[key] !== true)).toEqual([]);
  const serialized = JSON.stringify(body);
  for (const sentinel of [
    CAPABILITY_A,
    CAPABILITY_B,
    'Download Field Notes',
    'Open the PDF from your order',
    'secret-file-key',
    ...extraForbidden,
  ]) {
    expect(serialized).not.toContain(sentinel);
  }
}

describe('Order operations HTTP', () => {
  it('pages, filters, and treats percent and underscore as literals', async () => {
    const product = await createSimpleProduct();
    const created: Array<{ reference: string; capability: string }> = [];
    for (let index = 0; index < 30; index += 1) {
      const capability = capabilityFor(index);
      const customer = index === 0
        ? { name: 'Percent % Holder', email: 'percent@example.test' }
        : index === 1
          ? { name: 'Underscore _ Holder', email: 'under@example.test' }
          : { name: `Seed Buyer ${index.toString().padStart(2, '0')}`, email: `seed${index}@example.test` };
      const order = await createOrder({
        productId: product.id,
        key: keyFor(`seed-${index.toString().padStart(2, '0')}`),
        capability,
        customer,
      });
      created.push({ reference: order.reference, capability });
    }

    const ranked = await env.DB.prepare(
      `SELECT reference FROM orders WHERE store_id = ? ORDER BY created_at DESC, id DESC`,
    ).bind(BOOTSTRAP_STORE_ID).all<{ reference: string }>();
    const refs = ranked.results.map((row) => row.reference);
    for (const [index, reference] of refs.entries()) {
      await env.DB.prepare('UPDATE orders SET created_at = ? WHERE reference = ?').bind(
        `2026-01-01T12:00:00.${String(900 - index).padStart(3, '0')}Z`,
        reference,
      ).run();
    }
    const tie = '2026-01-01T12:00:00.876Z';
    await env.DB.prepare('UPDATE orders SET created_at = ? WHERE reference = ?').bind(tie, refs[24]).run();
    await env.DB.prepare('UPDATE orders SET created_at = ? WHERE reference = ?').bind(tie, refs[25]).run();
    const expected = (await env.DB.prepare(
      `SELECT reference FROM orders WHERE store_id = ? ORDER BY created_at DESC, id DESC`,
    ).bind(BOOTSTRAP_STORE_ID).all<{ reference: string }>()).results.map((row) => row.reference);

    const first = await list('?limit=25');
    const firstBody = await first.json() as { orders: Array<{ reference: string }>; nextCursor: string; hasOrders: boolean };
    expect(first.status).toBe(200);
    expect(firstBody.hasOrders).toBe(true);
    expect(firstBody.orders.map((order) => order.reference)).toEqual(expected.slice(0, 25));
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const seen = [...firstBody.orders.map((order) => order.reference)];
    let cursor: string | null = firstBody.nextCursor;
    while (cursor !== null) {
      const page = await list(`?limit=25&cursor=${encodeURIComponent(cursor)}`);
      const body = await page.json() as { orders: Array<{ reference: string }>; nextCursor: string | null };
      expect(page.status).toBe(200);
      seen.push(...body.orders.map((order) => order.reference));
      cursor = body.nextCursor;
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(30);

    const insert = await createOrder({
      productId: product.id,
      key: keyFor('insert-before'),
      capability: capabilityFor(99),
      customer: { name: 'Inserted Ahead', email: 'insert@example.test' },
    });
    const afterInsertFirst = await list('?limit=25');
    const afterInsertBody = await afterInsertFirst.json() as { orders: Array<{ reference: string }>; nextCursor: string };
    expect(afterInsertBody.orders[0]?.reference).toBe(insert.reference);
    const continued = await list(`?limit=25&cursor=${encodeURIComponent(firstBody.nextCursor)}`);
    const continuedBody = await continued.json() as { orders: Array<{ reference: string }> };
    const continuedRefs = continuedBody.orders.map((order) => order.reference);
    expect(continuedRefs).not.toContain(insert.reference);
    expect(continuedRefs.filter((reference) => seen.includes(reference)).length).toBe(continuedRefs.length);

    const percent = await list(`?q=${encodeURIComponent('%')}`);
    const percentBody = await percent.json() as { orders: Array<{ reference: string; customer: { name: string } }>; hasOrders: boolean };
    expect(percentBody.hasOrders).toBe(true);
    expect(percentBody.orders).toHaveLength(1);
    expect(percentBody.orders[0]?.customer.name).toBe('Percent % Holder');

    const underscore = await list('?q=_');
    const underscoreBody = await underscore.json() as { orders: Array<{ customer: { name: string } }> };
    expect(underscoreBody.orders).toHaveLength(1);
    expect(underscoreBody.orders[0]?.customer.name).toBe('Underscore _ Holder');

    const missing = await list('?q=no-such-order-token');
    expect(await missing.json()).toEqual({ orders: [], nextCursor: null, hasOrders: true });

    await complete(created[2].reference, keyFor('complete-filter'));
    await complete(created[3].reference, keyFor('complete-refund-a'));
    await complete(created[4].reference, keyFor('complete-refund-b'));
    expect((await refund(created[3].reference, created[3].capability, keyFor('refund-a'), 'Need a refund now.')).status).toBe(200);
    expect((await refund(created[4].reference, created[4].capability, keyFor('refund-b'), 'Second pending refund.')).status).toBe(200);
    expect((await cancel(created[5].reference, keyFor('cancel-filter'))).status).toBe(200);

    const combined = await list('?status=completed&refund=pending');
    const combinedBody = await combined.json() as { orders: Array<{ reference: string; refundRequestStatus: string | null }> };
    expect(combined.status).toBe(200);
    expect(combinedBody.orders.map((order) => order.reference).sort()).toEqual(
      [created[3].reference, created[4].reference].sort(),
    );
    expect(combinedBody.orders.every((order) => order.refundRequestStatus === 'pending')).toBe(true);

    const invalidQuery = {
      error: { code: 'invalid_query', message: 'The Order query is invalid.', fields: [], incidentId: null },
    };
    const invalid = await Promise.all([
      list('?status=all'),
      list('?limit=0'),
      list('?limit=101'),
      list('?q=a&q=b'),
      list('?unknown=1'),
      list(`?cursor=${encodeURIComponent('%%%')}`),
      list(`?limit=25&cursor=${encodeURIComponent(encodeCursor(['2026-01-01T12:00:00.000Z', 'id', '', null, null, 10]))}`),
    ]);
    for (const response of invalid) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(invalidQuery);
    }
  });

  it('completes, cancels, refunds, and replays Create after terminal state', async () => {
    const product = await createSimpleProduct();
    const createKey = keyFor('create-replay');
    const created = await createOrder({
      productId: product.id,
      key: createKey,
      capability: CAPABILITY_A,
      customer: { name: 'Replay Customer', email: 'replay@example.test' },
      quantity: 2,
    });

    const completeKey = keyFor('complete-once');
    const firstComplete = await complete(created.reference, completeKey);
    const firstCompleteBody = await firstComplete.json();
    expect(firstComplete.status).toBe(200);
    expect(firstComplete.headers.get('Cache-Control')).toBe('no-store');
    expect(firstComplete.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(firstCompleteBody).toMatchObject({
      reference: created.reference,
      action: 'complete',
      status: 'completed',
      refundRequest: null,
    });
    assertSafeJson(firstCompleteBody);
    const countsAfterComplete = await tableCounts();
    const lostComplete = await complete(created.reference, completeKey);
    expect(lostComplete.status).toBe(200);
    expect(await lostComplete.json()).toEqual(firstCompleteBody);
    expect(await tableCounts()).toEqual(countsAfterComplete);

    const refundKey = keyFor('refund-once');
    const firstRefund = await refund(created.reference, CAPABILITY_A, refundKey, 'Please reverse this.');
    const firstRefundBody = await firstRefund.json() as {
      refundRequest: { id: string; reason: string; createdAt: string; status: 'pending' };
    };
    expect(firstRefund.status).toBe(200);
    expect(firstRefund.headers.get('Access-Control-Allow-Origin')).toBe(TEST_STOREFRONT_ORIGIN);
    expect(firstRefund.headers.get('Vary')).toContain('Origin');
    expect(firstRefund.headers.get('Cache-Control')).toBe('no-store');
    expect(firstRefundBody.refundRequest.reason).toBe('Please reverse this.');
    assertSafeJson(firstRefundBody);
    const countsAfterRefund = await tableCounts();
    const lostRefund = await refund(created.reference, CAPABILITY_A, refundKey, 'Please reverse this.');
    expect(lostRefund.status).toBe(200);
    expect(await lostRefund.json()).toEqual(firstRefundBody);
    expect(await tableCounts()).toEqual(countsAfterRefund);

    const replay = await workerRequest('/api/storefront/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': createKey,
        'X-Nexus-Order-Capability': CAPABILITY_A,
      },
      body: JSON.stringify({
        customer: { name: 'Replay Customer', email: 'replay@example.test' },
        productId: product.id,
        variantId: null,
        quantity: 2,
      }),
    });
    const replayBody = await replay.json() as Record<string, unknown>;
    expect(replay.status).toBe(201);
    expect(replayBody).toMatchObject({
      reference: created.reference,
      status: 'completed',
      paymentNextStep: null,
      refundRequest: firstRefundBody.refundRequest,
    });
    assertSafeJson(replayBody);

    const detail = await workerRequest(`/api/console/orders/${created.reference}`);
    const detailBody = await detail.json() as { order: Record<string, unknown> };
    expect(detail.status).toBe(200);
    expect(detail.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(detailBody.order).toMatchObject({
      reference: created.reference,
      status: 'completed',
      allowedActions: [],
      refundRequestStatus: 'pending',
      refundRequest: firstRefundBody.refundRequest,
    });
    expect(detailBody.order).not.toHaveProperty('paymentNextStep');
    assertSafeJson(detailBody);
    const history = detailBody.order.history as Array<{ action: string; source: string }>;
    expect(history.map((event) => event.action)).toEqual(['order_created', 'order_completed', 'refund_requested']);
    expect(history[2]?.source).toBe('customer_capability');

    const privateGet = await workerRequest(`/api/storefront/orders/${created.reference}`, {
      headers: { 'X-Nexus-Order-Capability': CAPABILITY_A },
    });
    expect(await privateGet.json()).toMatchObject({
      status: 'completed',
      paymentNextStep: null,
      refundRequest: firstRefundBody.refundRequest,
    });

    const cancelTarget = await createOrder({
      productId: product.id,
      key: keyFor('cancel-target'),
      capability: CAPABILITY_B,
    });
    const cancelKey = keyFor('cancel-once');
    const firstCancel = await cancel(cancelTarget.reference, cancelKey);
    const firstCancelBody = await firstCancel.json();
    expect(firstCancel.status).toBe(200);
    assertSafeJson(firstCancelBody);
    const countsAfterCancel = await tableCounts();
    const lostCancel = await cancel(cancelTarget.reference, cancelKey);
    expect(await lostCancel.json()).toEqual(firstCancelBody);
    expect(await tableCounts()).toEqual(countsAfterCancel);
    const cancelDetail = await workerRequest(`/api/console/orders/${cancelTarget.reference}`);
    expect(await cancelDetail.json()).toMatchObject({
      order: { status: 'cancelled', allowedActions: [], refundRequest: null },
    });
  });

  it('collapses private refund denials and surfaces post-auth errors', async () => {
    const product = await createSimpleProduct();
    const created = await createOrder({
      productId: product.id,
      key: keyFor('privacy'),
      capability: CAPABILITY_A,
    });
    expect((await complete(created.reference, keyFor('privacy-complete'))).status).toBe(200);
    expect((await refund(created.reference, CAPABILITY_A, keyFor('privacy-refund'), 'Canonical reason.')).status).toBe(200);
    const before = await tableCounts();
    const missingReference = `${created.reference.slice(0, -1)}${created.reference.endsWith('F') ? 'E' : 'F'}`;
    const denied = await Promise.all([
      refund(created.reference, 'invalid', keyFor('bad-key'), ''),
      workerRequest(`/api/storefront/orders/${created.reference}/refund-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'short', 'X-Nexus-Order-Capability': CAPABILITY_B },
        body: '{',
      }),
      refund(created.reference, CAPABILITY_B, keyFor('wrong-cap'), 'Wrong order.'),
      refund(missingReference, CAPABILITY_A, keyFor('missing-ref'), 'Missing.'),
      workerRequest(`/api/storefront/orders/${created.reference}/refund-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'no capability' }),
      }),
    ]);
    for (const response of denied) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(PRIVATE_DENIAL);
    }
    assertSafeJson(PRIVATE_DENIAL);
    expect(await tableCounts()).toEqual(before);

    const malformed = await workerRequest(`/api/storefront/orders/${created.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': keyFor('valid-cap-json'),
        'X-Nexus-Order-Capability': CAPABILITY_A,
      },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: 'invalid_json' } });

    const shortKey = await workerRequest(`/api/storefront/orders/${created.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'short',
        'X-Nexus-Order-Capability': CAPABILITY_A,
      },
      body: JSON.stringify({ reason: 'Valid after auth.' }),
    });
    expect(shortKey.status).toBe(400);
    expect(await shortKey.json()).toMatchObject({
      error: { code: 'validation_failed', fields: [{ code: 'idempotency_key_invalid' }] },
    });

    const badReason = await refund(created.reference, CAPABILITY_A, keyFor('bad-reason'), '   ');
    expect(badReason.status).toBe(422);
    expect(await badReason.json()).toMatchObject({ error: { code: 'validation_failed' } });

    const pending = await createOrder({
      productId: product.id,
      key: keyFor('pending-refund'),
      capability: capabilityFor(7),
    });
    const ineligible = await refund(pending.reference, capabilityFor(7), keyFor('ineligible'), 'Too early.');
    expect(ineligible.status).toBe(409);
    expect(await ineligible.json()).toMatchObject({ error: { code: 'order_state_conflict' } });
  });

  it('omits nested option sentinels and fail-closes unsupported routes', async () => {
    const product = await createActiveVariant();
    const variant = product.variants[0];
    const created = await createOrder({
      productId: product.id,
      variantId: variant.id,
      key: keyFor('variant-sentinel'),
      capability: CAPABILITY_A,
    });
    const line = await env.DB.prepare(
      'SELECT selected_options_json FROM order_lines WHERE store_id = ?',
    ).bind(BOOTSTRAP_STORE_ID).first<{ selected_options_json: string }>();
    const options = JSON.parse(line?.selected_options_json ?? '[]') as Array<Record<string, unknown>>;
    options[0] = { ...options[0], privateFileKey: 'secret-file-key', accessTitle: 'Download Field Notes' };
    await env.DB.prepare('UPDATE order_lines SET selected_options_json = ? WHERE store_id = ?').bind(
      JSON.stringify(options),
      BOOTSTRAP_STORE_ID,
    ).run();

    const listed = await list();
    const listBody = await listed.json();
    const detail = await workerRequest(`/api/console/orders/${created.reference}`);
    const detailBody = await detail.json();
    const privateGet = await workerRequest(`/api/storefront/orders/${created.reference}`, {
      headers: { 'X-Nexus-Order-Capability': CAPABILITY_A },
    });
    const privateBody = await privateGet.json() as {
      product: { variant: { selectedOptions: Array<Record<string, unknown>> } };
    };
    assertSafeJson(listBody);
    assertSafeJson(detailBody);
    assertSafeJson(privateBody);
    expect(privateBody.product.variant.selectedOptions[0]).toEqual({
      groupId: expect.any(String),
      groupName: 'Theme',
      valueId: expect.any(String),
      valueLabel: 'Dark',
    });
    expect(privateBody.product.variant.selectedOptions[0]).not.toHaveProperty('privateFileKey');

    const pendingDetail = await workerRequest(`/api/console/orders/${created.reference}`);
    expect(await pendingDetail.json()).toMatchObject({
      order: { allowedActions: ['complete', 'cancel'] },
    });

    const unsupported = [
      `/api/storefront/orders/${created.reference}/complete`,
      `/api/storefront/orders/${created.reference}/cancel`,
      `/api/console/orders/${created.reference}/refund-requests`,
      `/api/console/orders/${created.reference}/approve`,
      `/api/console/orders/${created.reference}/reject`,
      `/api/storefront/orders/${created.reference}/refund-requests/approve`,
    ];
    const before = await tableCounts();
    for (const path of unsupported) {
      const response = await workerRequest(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('unsupported') },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'route_not_found' } });
    }
    const patched = await workerRequest(`/api/console/orders/${created.reference}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    expect(patched.status).toBe(404);
    expect(await tableCounts()).toEqual(before);
  });

  it('returns 500 rather than 404 when capability lookup infrastructure fails', async () => {
    const product = await createSimpleProduct();
    const created = await createOrder({
      productId: product.id,
      key: keyFor('lookup-fail'),
      capability: CAPABILITY_A,
    });
    expect((await complete(created.reference, keyFor('lookup-fail-complete'))).status).toBe(200);
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
    const database = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === 'prepare') {
          return (sql: string) => {
            if (sql.includes('order_access.capability_digest')) {
              throw new Error('simulated d1 failure');
            }
            return target.prepare(sql);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as D1Database;
    const response = await routeStorefrontOrderRequest(
      new Request(`https://local.invalid/api/storefront/orders/${created.reference}/refund-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': keyFor('lookup-fail-refund'),
          'X-Nexus-Order-Capability': CAPABILITY_A,
          Origin: TEST_STOREFRONT_ORIGIN,
        },
        body: JSON.stringify({ reason: 'Should not persist.' }),
      }),
      database,
      TEST_STOREFRONT_ORIGIN,
    );
    expect(response?.status).toBe(500);
    const body = await response?.json() as { error: { code: string; incidentId: string } };
    expect(body.error.code).toBe('order_operation_failed');
    expect(JSON.stringify(errors)).not.toContain(created.reference);
    expect(JSON.stringify(errors)).not.toContain(CAPABILITY_A);
    expect(JSON.stringify(errors)).not.toContain('Should not persist.');
    expect(JSON.stringify(errors)).toContain(body.error.incidentId);
  });

  it('returns sanitized 500 with CORS when storefront refund customer lookup fails', async () => {
    const product = await createSimpleProduct();
    const created = await persistStorefrontOrder({
      database: env.DB,
      context: { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'storefront', id: null } },
      body: {
        customer: { name: 'Ada Lovelace', email: 'ada@example.test' },
        items: [{ productId: product.id, variantId: null, quantity: 1 }],
      },
      idempotencyKey: keyFor('customer-lookup-fail'),
      capability: CAPABILITY_A,
    });
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
    const database = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === 'prepare') {
          return (sql: string) => {
            if (sql.includes('SELECT customer_id FROM orders')) {
              throw new Error('simulated customer lookup failure');
            }
            return target.prepare(sql);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as D1Database;
    const response = await routeStorefrontOrderRequest(
      new Request(`https://local.invalid/api/storefront/orders/${created.reference}/refund-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': keyFor('customer-lookup-fail-refund'),
          'X-Nexus-Order-Capability': CAPABILITY_A,
          Origin: TEST_STOREFRONT_ORIGIN,
        },
        body: JSON.stringify({ reason: 'Should not persist.' }),
      }),
      database,
      TEST_STOREFRONT_ORIGIN,
    );
    expect(response?.status).toBe(500);
    expect(response?.headers.get('Access-Control-Allow-Origin')).toBe(TEST_STOREFRONT_ORIGIN);
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    const body = await response?.json() as { error: { code: string; incidentId: string } };
    expect(body.error.code).toBe('order_operation_failed');
    expect(body.error.incidentId).toBeTruthy();
    expect(JSON.stringify(errors)).not.toContain(created.reference);
    expect(JSON.stringify(errors)).not.toContain(CAPABILITY_A);
    expect(JSON.stringify(errors)).not.toContain('Should not persist.');
    expect(JSON.stringify(errors)).toContain(body.error.incidentId);
  });
});
