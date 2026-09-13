import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import { PUBLIC_STORE_ID as BOOTSTRAP_STORE_ID } from '@nexus/catalog/public-store';
import { routeStorefrontOrderRequest } from '../../apps/worker/src/storefront-order-routes';
import { digestOrderCapability } from '@nexus/orders/private-access';
import { createOrder as persistStorefrontOrder } from '@nexus/orders/commands/order-write';
import worker from '../../apps/worker/src';
import {
  consoleRequest,
  getConsoleSession,
  resetCatalog,
  SIMPLE_CORE,
  TEST_STOREFRONT_ORIGIN,
  VARIANT_CORE,
  oneVariantSchema,
  workerRequest,
} from '../support/catalog-test-env';
import {
  createConsoleSession,
  TEST_BETTER_AUTH_SECRET,
  TEST_CONSOLE_ORIGIN,
} from '../support/identity-test-env';

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
const CONTRACT_OUTDATED = {
  error: {
    code: 'client_contract_outdated',
    message: 'This client is out of date. Reload the page and try again.',
    fields: [],
    incidentId: null,
  },
};
const EMPTY_SUMMARY = {
  totalOrders: 0,
  byStatus: { pending: 0, paid: 0, fulfilled: 0, canceled: 0 },
  openRefundRequests: 0,
};
const FORBIDDEN_KEY = /(access|capability|delivery|digest|file|idempotency|private)/i;
const ALLOWED_KEYS: Record<string, true> = {
  action: true,
  actorId: true,
  actorLabel: true,
  allowedActions: true,
  assignment: true,
  assigneeUserId: true,
  amountMinor: true,
  byStatus: true,
  canceled: true,
  code: true,
  contractVersion: true,
  createdAt: true,
  decidedAt: true,
  decidedByUserId: true,
  currency: true,
  customer: true,
  email: true,
  error: true,
  externalReference: true,
  fields: true,
  fromStatus: true,
  fulfilled: true,
  groupId: true,
  groupName: true,
  hasOrders: true,
  history: true,
  id: true,
  incidentId: true,
  items: true,
  lineTotalMinor: true,
  message: true,
  method: true,
  name: true,
  nextCursor: true,
  occurredAt: true,
  openRefundRequests: true,
  order: true,
  orders: true,
  paid: true,
  path: true,
  payment: true,
  paymentId: true,
  paymentNextStep: true,
  paymentRecordState: true,
  paymentReference: true,
  pending: true,
  position: true,
  product: true,
  quantity: true,
  reason: true,
  recordedAt: true,
  reference: true,
  refundRequest: true,
  refundRequestStatus: true,
  selectedOptions: true,
  sku: true,
  source: true,
  status: true,
  summary: true,
  toStatus: true,
  totalMinor: true,
  totalOrders: true,
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

function unversionedRequest(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://local.invalid${path}`, init), {
    DB: env.DB,
    FILES: env.FILES,
    STOREFRONT_ORIGIN: TEST_STOREFRONT_ORIGIN,
    CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN,
    BETTER_AUTH_SECRET: TEST_BETTER_AUTH_SECRET,
    ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
  });
}

async function unversionedConsoleRequest(path: string, init?: RequestInit): Promise<Response> {
  const session = await getConsoleSession();
  const headers = new Headers(init?.headers);
  headers.set('Cookie', session.cookie);
  headers.set('Origin', TEST_CONSOLE_ORIGIN);
  headers.set('Sec-Fetch-Site', 'same-origin');
  return unversionedRequest(path, { ...init, headers });
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
  },
): D1Database {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'batch' && intercept.batch) {
        return (statements: D1PreparedStatement[]) => intercept.batch!(statements, target);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function racingRequest(path: string, init: RequestInit, database: D1Database): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('X-Nexus-Order-Contract')) {
    headers.set('X-Nexus-Order-Contract', '2');
  }
  return worker.fetch(new Request(`https://local.invalid${path}`, { ...init, headers }), {
    DB: database,
    FILES: env.FILES,
    STOREFRONT_ORIGIN: TEST_STOREFRONT_ORIGIN,
    CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN,
    BETTER_AUTH_SECRET: TEST_BETTER_AUTH_SECRET,
    ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
  });
}


async function createSimpleProduct(): Promise<ProductDetailResponse> {
  const response = await consoleRequest('/api/console/products', {
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
  const preview = await consoleRequest('/api/console/products/schema/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: null, productSlug: 'focus-pack', product, schema }),
  });
  const previewHash = (await preview.json() as { previewHash: string }).previewHash;
  const response = await consoleRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product, schema, previewHash }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { product: ProductDetailResponse }).product;
}

async function createOrder(input: {
  items: Array<{ productId: string; variantId?: string | null; quantity?: number }>;
  key: string;
  capability: string;
  customer?: { name: string; email: string };
}): Promise<Record<string, unknown> & { reference: string; createdAt: string; paymentReference: string }> {
  const response = await workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.key,
      'X-Nexus-Order-Capability': input.capability,
    },
    body: JSON.stringify({
      customer: input.customer ?? { name: 'Ada Lovelace', email: 'ada@example.test' },
      items: input.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity ?? 1,
      })),
    }),
  });
  expect(response.status).toBe(201);
  return await response.json() as Record<string, unknown> & {
    reference: string;
    createdAt: string;
    paymentReference: string;
  };
}

async function markPaid(reference: string, key: string, paymentRef = 'WIRE-1', method = 'Bank transfer'): Promise<Response> {
  return consoleRequest(`/api/console/orders/${reference}/payments/manual`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      Origin: TEST_STOREFRONT_ORIGIN,
    },
    body: JSON.stringify({ method, reference: paymentRef }),
  });
}

async function fulfill(reference: string, key: string): Promise<Response> {
  return consoleRequest(`/api/console/orders/${reference}/fulfill`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      Origin: TEST_STOREFRONT_ORIGIN,
    },
    body: JSON.stringify({}),
  });
}

async function cancel(reference: string, key: string): Promise<Response> {
  return consoleRequest(`/api/console/orders/${reference}/cancel`, {
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

async function consoleRefund(reference: string, key: string, reason: string): Promise<Response> {
  return consoleRequest(`/api/console/orders/${reference}/refund-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ reason }),
  });
}

async function list(query = ''): Promise<Response> {
  return consoleRequest(`/api/console/orders${query}`);
}

async function tableCounts(): Promise<Record<string, number>> {
  const names = ['orders', 'order_history', 'order_refund_requests', 'order_commands', 'order_idempotency', 'payments'] as const;
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

async function plantOtherStoreOrder(input: {
  reference: string;
  email: string;
  name: string;
  paymentReference: string;
}): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO stores (id, slug, name) VALUES ('order_other', 'order-other', 'Order Other')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO customers (id, store_id, name, email_normalized) VALUES ('cust_other', 'order_other', ?, ?)",
  ).bind(input.name, input.email).run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO order_lines (
         id, store_id, order_id, product_id, product_name, selected_options_json, quantity,
         unit_price_minor, line_total_minor, currency, access_title, access_instructions, position
       ) VALUES ('line_other', 'order_other', 'ord_other', 'prod_other', 'Other Notes', '[]', 1, 100, 100, 'USD', '', '', 0)`,
    ),
    env.DB.prepare(
      `INSERT INTO orders (
         id, store_id, reference, customer_id, customer_name, customer_email_normalized,
         status, currency, total_minor, payment_reference
       ) VALUES ('ord_other', 'order_other', ?, 'cust_other', ?, ?, 'paid', 'USD', 100, ?)`,
    ).bind(input.reference, input.name, input.email, input.paymentReference),
  ]);
}

async function plantTenLineOrder(): Promise<string> {
  const lines = Array.from({ length: 10 }, (_, position) => env.DB.prepare(
    `INSERT INTO order_lines (
       id, store_id, order_id, product_id, product_name, selected_options_json, quantity,
       unit_price_minor, line_total_minor, currency, access_title, access_instructions, position
     ) VALUES (?, ?, 'ord_ten', 'prod_ten', 'Ten Pack', '[]', 1, 100, 100, 'USD', '', '', ?)`,
  ).bind(`line_ten_${position}`, BOOTSTRAP_STORE_ID, position));
  await env.DB.prepare(
    "INSERT INTO customers (id, store_id, name, email_normalized) VALUES ('cust_ten', ?, 'Ten Buyer', 'ten@example.test')",
  ).bind(BOOTSTRAP_STORE_ID).run();
  await env.DB.batch([
    ...lines,
    env.DB.prepare(
      `INSERT INTO orders (
         id, store_id, reference, customer_id, customer_name, customer_email_normalized,
         status, currency, total_minor, payment_reference
       ) VALUES ('ord_ten', ?, 'NX-ABCDEF0123456789', 'cust_ten', 'Ten Buyer', 'ten@example.test', 'pending', 'USD', 1000, 'NPaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')`,
    ).bind(BOOTSTRAP_STORE_ID),
  ]);
  return 'NX-ABCDEF0123456789';
}

describe('Order operations HTTP', () => {
  it('pages, filters, and treats percent and underscore as literals', async () => {
    const product = await createSimpleProduct();
    const variantProduct = await createActiveVariant();
    const created: Array<{ reference: string; capability: string }> = [];
    for (let index = 0; index < 28; index += 1) {
      const capability = capabilityFor(index);
      const customer = index === 0
        ? { name: 'Percent % Holder', email: 'percent@example.test' }
        : index === 1
          ? { name: 'Underscore _ Holder', email: 'under@example.test' }
          : { name: `Seed Buyer ${index.toString().padStart(2, '0')}`, email: `seed${index}@example.test` };
      const order = await createOrder({
        items: [{ productId: product.id }],
        key: keyFor(`seed-${index.toString().padStart(2, '0')}`),
        capability,
        customer,
      });
      created.push({ reference: order.reference, capability });
    }
    const twoLine = await createOrder({
      items: [
        { productId: product.id, quantity: 1 },
        { productId: variantProduct.id, variantId: variantProduct.variants[0].id, quantity: 2 },
      ],
      key: keyFor('seed-two-line'),
      capability: capabilityFor(28),
      customer: { name: 'Seed Buyer two', email: 'seedtwo@example.test' },
    });
    created.push({ reference: twoLine.reference, capability: capabilityFor(28) });
    const tenRef = await plantTenLineOrder();
    created.push({ reference: tenRef, capability: capabilityFor(29) });

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
    const firstBody = await first.json() as {
      orders: Array<{ reference: string; items: unknown[] }>;
      nextCursor: string;
      hasOrders: boolean;
      summary: typeof EMPTY_SUMMARY;
    };
    expect(first.status).toBe(200);
    expect(firstBody.hasOrders).toBe(true);
    expect(firstBody.summary.totalOrders).toBe(30);
    expect(firstBody.orders.map((order) => order.reference)).toEqual(expected.slice(0, 25));
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const seen = [...firstBody.orders.map((order) => order.reference)];
    const itemCounts = Object.fromEntries(firstBody.orders.map((order) => [order.reference, order.items.length]));
    let cursor: string | null = firstBody.nextCursor;
    while (cursor !== null) {
      const page = await list(`?limit=25&cursor=${encodeURIComponent(cursor)}`);
      const body = await page.json() as {
        orders: Array<{ reference: string; items: unknown[] }>;
        nextCursor: string | null;
        summary: typeof EMPTY_SUMMARY;
      };
      expect(page.status).toBe(200);
      expect(body.summary).toEqual(firstBody.summary);
      for (const order of body.orders) itemCounts[order.reference] = order.items.length;
      seen.push(...body.orders.map((order) => order.reference));
      cursor = body.nextCursor;
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(30);
    expect(itemCounts[twoLine.reference]).toBe(2);
    expect(itemCounts[tenRef]).toBe(10);
    expect(Object.values(itemCounts).filter((count) => count === 1)).toHaveLength(28);

    const insert = await createOrder({
      items: [{ productId: product.id }],
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
    expect(await missing.json()).toEqual({
      orders: [],
      summary: EMPTY_SUMMARY,
      nextCursor: null,
      hasOrders: true,
    });

    expect((await markPaid(created[2].reference, keyFor('pay-filter'), 'WIRE-FILTER-2')).status).toBe(200);
    expect((await markPaid(created[3].reference, keyFor('pay-refund-a'), 'WIRE-FILTER-3')).status).toBe(200);
    expect((await markPaid(created[4].reference, keyFor('pay-refund-b'), 'WIRE-FILTER-4')).status).toBe(200);
    expect((await refund(created[3].reference, created[3].capability, keyFor('refund-a'), 'Need a refund now.')).status).toBe(200);
    expect((await refund(created[4].reference, created[4].capability, keyFor('refund-b'), 'Second pending refund.')).status).toBe(200);
    expect((await cancel(created[5].reference, keyFor('cancel-filter'))).status).toBe(200);

    const combined = await list('?q=Seed&status=paid&refund=pending&limit=1');
    const combinedBody = await combined.json() as {
      orders: Array<{ reference: string; refundRequestStatus: string | null }>;
      summary: typeof EMPTY_SUMMARY;
      nextCursor: string;
    };
    expect(combined.status).toBe(200);
    expect(combinedBody.orders).toHaveLength(1);
    expect(combinedBody.orders[0]?.refundRequestStatus).toBe('pending');
    expect(combinedBody.summary).toEqual({
      totalOrders: 2,
      byStatus: { pending: 0, paid: 2, fulfilled: 0, canceled: 0 },
      openRefundRequests: 2,
    });
    const combinedNext = await list(
      `?q=Seed&status=paid&refund=pending&limit=1&cursor=${encodeURIComponent(combinedBody.nextCursor)}`,
    );
    const combinedNextBody = await combinedNext.json() as {
      orders: Array<{ reference: string }>;
      summary: typeof EMPTY_SUMMARY;
      nextCursor: string | null;
    };
    expect(combinedNextBody.summary).toEqual(combinedBody.summary);
    expect(combinedNextBody.nextCursor).toBeNull();
    expect(
      [combinedBody.orders[0]?.reference, combinedNextBody.orders[0]?.reference].sort(),
    ).toEqual([created[3].reference, created[4].reference].sort());

    const wide = await list('?limit=100');
    const wideBody = await wide.json() as { orders: unknown[]; nextCursor: string | null; summary: typeof EMPTY_SUMMARY };
    expect(wide.status).toBe(200);
    expect(wideBody.orders).toHaveLength(31);
    expect(wideBody.nextCursor).toBeNull();
    expect(wideBody.summary.totalOrders).toBe(31);

    const invalidQuery = {
      error: { code: 'invalid_query', message: 'The Order query is invalid.', fields: [], incidentId: null },
    };
    const invalid = await Promise.all([
      list('?status=completed'),
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

  it('keeps multi-line Orders as one row and isolates a second Store', async () => {
    const simple = await createSimpleProduct();
    const variantProduct = await createActiveVariant();
    const one = await createOrder({
      items: [{ productId: simple.id }],
      key: keyFor('one-line'),
      capability: capabilityFor(1),
    });
    const two = await createOrder({
      items: [
        { productId: simple.id, quantity: 1 },
        { productId: variantProduct.id, variantId: variantProduct.variants[0].id, quantity: 2 },
      ],
      key: keyFor('two-line'),
      capability: capabilityFor(2),
    });
    const tenRef = await plantTenLineOrder();
    await plantOtherStoreOrder({
      reference: 'NX-1111222233334444',
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      paymentReference: 'NPbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });

    const listed = await list('?limit=25');
    const listBody = await listed.json() as {
      orders: Array<{ reference: string; items: unknown[] }>;
      summary: typeof EMPTY_SUMMARY;
    };
    expect(listBody.summary.totalOrders).toBe(3);
    expect(listBody.orders.map((order) => order.reference).sort()).toEqual([one.reference, two.reference, tenRef].sort());
    const byRef = Object.fromEntries(listBody.orders.map((order) => [order.reference, order.items.length]));
    expect(byRef[one.reference]).toBe(1);
    expect(byRef[two.reference]).toBe(2);
    expect(byRef[tenRef]).toBe(10);

    const tenDetail = await consoleRequest(`/api/console/orders/${tenRef}`);
    expect(tenDetail.status).toBe(200);
    expect((await tenDetail.json() as { order: { items: unknown[] } }).order.items).toHaveLength(10);

    const foreignDetail = await consoleRequest('/api/console/orders/NX-1111222233334444');
    expect(foreignDetail.status).toBe(404);
    expect((await markPaid('NX-1111222233334444', keyFor('pay-foreign'), 'WIRE-FOREIGN')).status).toBe(404);

    const foreignPay = await markPaid(one.reference, keyFor('pay-bootstrap'), 'WIRE-BOOT');
    expect(foreignPay.status).toBe(200);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM payments WHERE store_id = 'order_other'",
    ).first<number>('count')).toBe(0);

    const otherSearch = await list(`?q=${encodeURIComponent(one.paymentReference)}`);
    expect((await otherSearch.json() as { orders: Array<{ reference: string }> }).orders.map((order) => order.reference))
      .toEqual([one.reference]);
    const foreignRefSearch = await list('?q=NPbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect((await foreignRefSearch.json() as { orders: unknown[] }).orders).toHaveLength(0);
  });

  it('searches name, email, refs, fullwidth evidence, and mixed-case independently', async () => {
    const product = await createSimpleProduct();
    const named = await createOrder({
      items: [{ productId: product.id }],
      key: keyFor('search-name'),
      capability: capabilityFor(1),
      customer: { name: 'Grace Hopper', email: 'grace@example.test' },
    });
    expect((await markPaid(named.reference, keyFor('pay-fullwidth'), 'ＡＢ１２', 'Wire')).status).toBe(200);

    const byName = await list(`?q=${encodeURIComponent('gRaCe hOpPeR')}`);
    expect((await byName.json() as { orders: Array<{ reference: string }> }).orders.map((order) => order.reference))
      .toEqual([named.reference]);
    const byEmail = await list(`?q=${encodeURIComponent('GRACE@Example.TEST')}`);
    expect((await byEmail.json() as { orders: Array<{ reference: string }> }).orders).toHaveLength(1);
    const byOrderRef = await list(`?q=${encodeURIComponent(named.reference.toLowerCase())}`);
    expect((await byOrderRef.json() as { orders: Array<{ reference: string }> }).orders).toHaveLength(1);
    const byPayRef = await list(`?q=${encodeURIComponent(named.paymentReference)}`);
    expect((await byPayRef.json() as { orders: Array<{ reference: string }> }).orders).toHaveLength(1);
    const byExternal = await list(`?q=${encodeURIComponent('ＡＢ１２')}&limit=1`);
    const byExternalBody = await byExternal.json() as {
      orders: Array<{ reference: string }>;
      nextCursor: string | null;
    };
    expect(byExternalBody.orders.map((order) => order.reference)).toEqual([named.reference]);
    const asciiExternal = await list('?q=AB12');
    expect((await asciiExternal.json() as { orders: Array<{ reference: string }> }).orders).toHaveLength(0);
    const nfkcName = await list(`?q=${encodeURIComponent('Ｇｒａｃｅ')}`);
    expect((await nfkcName.json() as { orders: Array<{ reference: string }> }).orders.map((order) => order.reference))
      .toEqual([named.reference]);
    if (byExternalBody.nextCursor !== null) {
      expect(byExternalBody.nextCursor).not.toContain('AB12');
    }
    const mismatched = await list(
      `?q=${encodeURIComponent('ＡＢ１２')}&limit=1&cursor=${encodeURIComponent(encodeCursor(['2026-01-01T12:00:00.000Z', 'id', 'AB12', null, null, 1]))}`,
    );
    expect(mismatched.status).toBe(400);
  });

  it('marks paid, fulfills, cancels, refunds, and replays Create after later state', async () => {
    const product = await createSimpleProduct();
    const createKey = keyFor('create-replay');
    const created = await createOrder({
      items: [{ productId: product.id, quantity: 2 }],
      key: createKey,
      capability: CAPABILITY_A,
      customer: { name: 'Replay Customer', email: 'replay@example.test' },
    });

    const payKey = keyFor('pay-once');
    const firstPaid = await markPaid(created.reference, payKey, 'WIRE-REPLAY');
    const firstPaidBody = await firstPaid.json() as Record<string, unknown>;
    expect(firstPaid.status).toBe(200);
    expect(firstPaid.headers.get('Cache-Control')).toBe('no-store');
    expect(firstPaid.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(firstPaidBody).toMatchObject({
      reference: created.reference,
      action: 'mark_paid',
      status: 'paid',
      refundRequest: null,
    });
    expect(firstPaidBody.paymentId).toEqual(expect.any(String));
    assertSafeJson(firstPaidBody);
    const countsAfterPaid = await tableCounts();
    const lostPaid = await markPaid(created.reference, payKey, 'WIRE-REPLAY');
    expect(lostPaid.status).toBe(200);
    expect(await lostPaid.json()).toEqual(firstPaidBody);
    expect(await tableCounts()).toEqual(countsAfterPaid);

    const fulfillKey = keyFor('fulfill-once');
    const firstFulfill = await fulfill(created.reference, fulfillKey);
    const firstFulfillBody = await firstFulfill.json();
    expect(firstFulfill.status).toBe(200);
    expect(firstFulfillBody).toMatchObject({
      reference: created.reference,
      action: 'fulfill',
      status: 'fulfilled',
    });
    const replayPaid = await markPaid(created.reference, payKey, 'WIRE-REPLAY');
    expect(replayPaid.status).toBe(200);
    expect(await replayPaid.json()).toEqual(firstPaidBody);

    const refundKey = keyFor('refund-once');
    const firstRefund = await refund(created.reference, CAPABILITY_A, refundKey, 'Please reverse this.');
    const firstRefundBody = await firstRefund.json() as {
      refundRequest: { id: string; reason: string; createdAt: string; status: 'pending' };
      paymentId?: string;
    };
    expect(firstRefund.status).toBe(200);
    expect(firstRefund.headers.get('Access-Control-Allow-Origin')).toBe(TEST_STOREFRONT_ORIGIN);
    expect(firstRefund.headers.get('Vary')).toContain('Origin');
    expect(firstRefund.headers.get('Cache-Control')).toBe('no-store');
    expect(firstRefundBody.refundRequest.reason).toBe('Please reverse this.');
    expect(firstRefundBody).not.toHaveProperty('paymentId');
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
        items: [{ productId: product.id, variantId: null, quantity: 2 }],
      }),
    });
    const replayBody = await replay.json() as Record<string, unknown>;
    expect(replay.status).toBe(201);
    expect(replayBody).toMatchObject({
      reference: created.reference,
      status: 'fulfilled',
      paymentNextStep: null,
      refundRequest: firstRefundBody.refundRequest,
    });
    assertSafeJson(replayBody);

    const detail = await consoleRequest(`/api/console/orders/${created.reference}`);
    const detailBody = await detail.json() as { order: Record<string, unknown> };
    expect(detail.status).toBe(200);
    expect(detail.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(detailBody.order).toMatchObject({
      reference: created.reference,
      status: 'fulfilled',
      allowedActions: ['approve_refund', 'reject_refund'],
      refundRequestStatus: 'pending',
      refundRequest: firstRefundBody.refundRequest,
      paymentRecordState: 'recorded',
      payment: { source: 'manual', method: 'Bank transfer', externalReference: 'WIRE-REPLAY' },
    });
    expect(detailBody.order).not.toHaveProperty('paymentNextStep');
    assertSafeJson(detailBody);
    const history = detailBody.order.history as Array<{ action: string; source: string; actorLabel: string }>;
    expect(history.map((event) => event.action)).toEqual(['order_created', 'order_paid', 'order_fulfilled', 'refund_requested']);
    expect(history[3]?.source).toBe('storefront');
    expect(history[1]?.actorLabel).toBe('Nexus Owner');

    const privateGet = await workerRequest(`/api/storefront/orders/${created.reference}`, {
      headers: { 'X-Nexus-Order-Capability': CAPABILITY_A },
    });
    const privateBody = await privateGet.json() as Record<string, unknown>;
    expect(privateBody).toMatchObject({
      status: 'fulfilled',
      paymentNextStep: null,
      refundRequest: firstRefundBody.refundRequest,
    });
    expect(privateBody).not.toHaveProperty('payment');
    expect(privateBody).not.toHaveProperty('history');
    expect(privateBody).not.toHaveProperty('customer');
    expect(JSON.stringify(privateBody)).not.toContain('WIRE-REPLAY');

    const cancelTarget = await createOrder({
      items: [{ productId: product.id }],
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
    const cancelDetail = await consoleRequest(`/api/console/orders/${cancelTarget.reference}`);
    expect(await cancelDetail.json()).toMatchObject({
      order: { status: 'canceled', allowedActions: [], refundRequest: null, paymentRecordState: 'none' },
    });
    expect((await fulfill(cancelTarget.reference, keyFor('fulfill-canceled'))).status).toBe(409);

    const pendingPay = await createOrder({
      items: [{ productId: product.id }],
      key: keyFor('direct-fulfill'),
      capability: capabilityFor(8),
    });
    const directFulfill = await fulfill(pendingPay.reference, keyFor('direct-fulfill-now'));
    expect(directFulfill.status).toBe(409);
  });

  it('shares one Console/Customer refund request and races to the first reason', async () => {
    const product = await createSimpleProduct();
    const created = await createOrder({
      items: [{ productId: product.id }],
      key: keyFor('shared-refund'),
      capability: CAPABILITY_A,
    });
    expect((await markPaid(created.reference, keyFor('shared-pay'), 'WIRE-SHARED')).status).toBe(200);

    const customer = await refund(created.reference, CAPABILITY_A, keyFor('cust-refund'), 'Customer asked first.');
    const customerBody = await customer.json() as { refundRequest: { id: string; reason: string } };
    expect(customer.status).toBe(200);
    const owner = await consoleRefund(created.reference, keyFor('owner-refund'), 'Owner asked later.');
    const ownerBody = await owner.json() as { refundRequest: { id: string; reason: string }; paymentId?: string };
    expect(owner.status).toBe(200);
    expect(ownerBody.refundRequest).toEqual(customerBody.refundRequest);
    expect(ownerBody.refundRequest.reason).toBe('Customer asked first.');
    expect(ownerBody.paymentId).toBeNull();
    expect(await env.DB.prepare(
      'SELECT actor_source, reason FROM order_refund_requests WHERE id = ?',
    ).bind(customerBody.refundRequest.id).first()).toEqual({
      actor_source: 'storefront',
      reason: 'Customer asked first.',
    });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_refund_requests').first<number>('count')).toBe(1);

    const replayOwner = await consoleRefund(created.reference, keyFor('owner-refund'), 'Owner asked later.');
    expect(await replayOwner.json()).toEqual(ownerBody);
  });

  it('concurrent Customer and Console refund HTTP keep one request and winner', async () => {
    const product = await createSimpleProduct();
    const created = await createOrder({
      items: [{ productId: product.id }],
      key: keyFor('http-race-create'),
      capability: CAPABILITY_A,
    });
    expect((await markPaid(created.reference, keyFor('http-race-pay'), 'WIRE-RACE')).status).toBe(200);
    const before = await tableCounts();
    const orderBefore = await env.DB.prepare(
      'SELECT id, status, total_minor, currency, customer_id FROM orders WHERE reference = ?',
    ).bind(created.reference).first<{
      id: string;
      status: string;
      total_minor: number;
      currency: string;
      customer_id: string;
    }>();
    expect(orderBefore).toMatchObject({ status: 'paid' });

    const customerReason = 'Customer race reason.';
    const ownerReason = 'Owner race reason.';
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

    const customer = racingRequest(`/api/storefront/orders/${created.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': keyFor('cust-race'),
        'X-Nexus-Order-Capability': CAPABILITY_A,
        Origin: TEST_STOREFRONT_ORIGIN,
      },
      body: JSON.stringify({ reason: customerReason }),
    }, racing);
    const ownerSession = await createConsoleSession();
    const owner = racingRequest(`/api/console/orders/${created.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': keyFor('owner-race'),
        Cookie: ownerSession.cookie,
        Origin: TEST_CONSOLE_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      },
      body: JSON.stringify({ reason: ownerReason }),
    }, racing);
    await started.promise;
    gate.resolve();
    const [customerRes, ownerRes] = await Promise.all([customer, owner]);
    expect(customerRes.status).toBe(200);
    expect(ownerRes.status).toBe(200);

    type RefundBody = {
      reference: string;
      action: string;
      status: string;
      refundRequest: { id: string; reason: string; status: 'pending'; createdAt: string };
      paymentId?: string | null;
    };
    const customerBody = await customerRes.json() as RefundBody;
    const ownerBody = await ownerRes.json() as RefundBody;
    expect(customerBody.refundRequest).toEqual(ownerBody.refundRequest);
    expect(customerBody).not.toHaveProperty('paymentId');
    expect(ownerBody.paymentId).toBeNull();
    expect(customerBody.action).toBe('request_refund');
    expect(ownerBody.action).toBe('request_refund');
    expect(customerBody.status).toBe('paid');
    expect(ownerBody.status).toBe('paid');
    expect([customerReason, ownerReason]).toContain(customerBody.refundRequest.reason);
    assertSafeJson(customerBody);
    assertSafeJson(ownerBody);

    const stored = await env.DB.prepare(
      'SELECT reason, actor_source, actor_id FROM order_refund_requests WHERE id = ?',
    ).bind(customerBody.refundRequest.id).first<{
      reason: string;
      actor_source: string;
      actor_id: string | null;
    }>();
    expect(stored?.reason).toBe(customerBody.refundRequest.reason);
    expect(['storefront', 'bootstrap_owner']).toContain(stored?.actor_source);
    if (stored?.actor_source === 'storefront') {
      expect(stored.reason).toBe(customerReason);
      expect(stored.actor_id).toBe(orderBefore?.customer_id);
    } else {
      expect(stored?.reason).toBe(ownerReason);
      expect(stored?.actor_id).toBeNull();
    }

    expect(await env.DB.prepare(
      'SELECT count(*) AS count FROM order_refund_requests',
    ).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      `SELECT count(*) AS count FROM order_history WHERE action = 'refund_requested'`,
    ).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      'SELECT status, total_minor, currency FROM orders WHERE reference = ?',
    ).bind(created.reference).first()).toEqual({
      status: orderBefore?.status,
      total_minor: orderBefore?.total_minor,
      currency: orderBefore?.currency,
    });
    expect(await tableCounts()).toEqual({
      ...before,
      order_refund_requests: before.order_refund_requests + 1,
      order_history: before.order_history + 1,
      order_commands: before.order_commands + 2,
    });

    const privateGet = await workerRequest(`/api/storefront/orders/${created.reference}`, {
      headers: { 'X-Nexus-Order-Capability': CAPABILITY_A },
    });
    const privateBody = await privateGet.json() as Record<string, unknown>;
    expect(privateGet.status).toBe(200);
    expect(privateBody).toMatchObject({
      status: 'paid',
      paymentNextStep: null,
      refundRequest: customerBody.refundRequest,
    });
    expect(privateBody).not.toHaveProperty('payment');
    expect(privateBody).not.toHaveProperty('history');
    expect(privateBody).not.toHaveProperty('customer');
    expect(privateBody).not.toHaveProperty('allowedActions');
    expect(JSON.stringify(privateBody)).not.toContain('WIRE-RACE');
    assertSafeJson(privateBody);

    const detail = await consoleRequest(`/api/console/orders/${created.reference}`);
    const detailBody = await detail.json() as {
      order: {
        status: string;
        refundRequest: RefundBody['refundRequest'] & { decidedByUserId: string | null };
        history: Array<{ action: string; source: string }>;
      };
    };
    expect(detail.status).toBe(200);
    expect(detailBody.order.status).toBe('paid');
    expect(detailBody.order.refundRequest).toMatchObject(customerBody.refundRequest);
    expect(detailBody.order.refundRequest.decidedByUserId).toBeNull();
    const refundEvents = detailBody.order.history.filter((event) => event.action === 'refund_requested');
    expect(refundEvents).toHaveLength(1);
    expect(refundEvents[0]?.source).toBe(stored?.actor_source);
  });


  it('collapses private refund denials and surfaces post-auth errors', async () => {
    const product = await createSimpleProduct();
    const created = await createOrder({
      items: [{ productId: product.id }],
      key: keyFor('privacy'),
      capability: CAPABILITY_A,
    });
    expect((await markPaid(created.reference, keyFor('privacy-pay'), 'WIRE-PRIV')).status).toBe(200);
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
      items: [{ productId: product.id }],
      key: keyFor('pending-refund'),
      capability: capabilityFor(7),
    });
    const ineligible = await refund(pending.reference, capabilityFor(7), keyFor('ineligible'), 'Too early.');
    expect(ineligible.status).toBe(409);
    expect(await ineligible.json()).toMatchObject({ error: { code: 'order_state_conflict' } });
    const afterIneligible = await tableCounts();

    const oldRefund = await unversionedRequest(`/api/storefront/orders/${created.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': keyFor('old-refund'),
        'X-Nexus-Order-Capability': CAPABILITY_A,
        Origin: TEST_STOREFRONT_ORIGIN,
      },
      body: JSON.stringify({ reason: 'Old client.' }),
    });
    expect(oldRefund.status).toBe(409);
    expect(await oldRefund.json()).toEqual(CONTRACT_OUTDATED);
    expect(oldRefund.headers.get('Access-Control-Allow-Origin')).toBe(TEST_STOREFRONT_ORIGIN);
    expect(await tableCounts()).toEqual(afterIneligible);

    const wrongCapOld = await unversionedRequest(`/api/storefront/orders/${created.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': keyFor('old-wrong'),
        'X-Nexus-Order-Capability': CAPABILITY_B,
      },
      body: JSON.stringify({ reason: 'Old wrong cap.' }),
    });
    expect(wrongCapOld.status).toBe(404);
    expect(await wrongCapOld.json()).toEqual(PRIVATE_DENIAL);
  });

  it('omits nested option sentinels and fail-closes unsupported routes', async () => {
    const product = await createActiveVariant();
    const variant = product.variants[0];
    const created = await createOrder({
      items: [{ productId: product.id, variantId: variant.id }],
      key: keyFor('variant-sentinel'),
      capability: CAPABILITY_A,
    });
    const sentinelDigest = await digestOrderCapability(CAPABILITY_B);
    await env.DB.prepare(
      "INSERT INTO customers (id, store_id, name, email_normalized) VALUES ('cust_sent', ?, 'Sentinel', 'sentinel@example.test')",
    ).bind(BOOTSTRAP_STORE_ID).run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO order_lines (
           id, store_id, order_id, product_id, product_name, variant_id, variant_sku, selected_options_json, quantity,
           unit_price_minor, line_total_minor, currency, access_title, access_instructions, position
         ) VALUES ('line_sent', ?, 'ord_sent', ?, 'Sentinel', ?, ?, ?, 1, 100, 100, 'USD', 'Download Field Notes', 'Open the PDF from your order', 0)`,
      ).bind(
        BOOTSTRAP_STORE_ID,
        product.id,
        variant.id,
        variant.sku,
        JSON.stringify([{
          groupId: 'g1',
          groupName: 'Theme',
          valueId: 'v1',
          valueLabel: 'Dark',
          privateFileKey: 'secret-file-key',
          accessTitle: 'Download Field Notes',
        }]),
      ),
      env.DB.prepare(
        `INSERT INTO orders (
           id, store_id, reference, customer_id, customer_name, customer_email_normalized,
           status, currency, total_minor, payment_reference
         ) VALUES ('ord_sent', ?, 'NX-FEDCBA9876543210', 'cust_sent', 'Sentinel', 'sentinel@example.test', 'pending', 'USD', 100, 'NPcccccccccccccccccccccccccccccccc')`,
      ).bind(BOOTSTRAP_STORE_ID),
      env.DB.prepare(
        `INSERT INTO order_access (id, store_id, order_id, capability_digest)
         VALUES ('access_sent', ?, 'ord_sent', ?)`,
      ).bind(BOOTSTRAP_STORE_ID, sentinelDigest),
    ]);

    const listed = await list();
    const listBody = await listed.json();
    const detail = await consoleRequest(`/api/console/orders/${created.reference}`);
    const detailBody = await detail.json();
    const sentinelDetail = await consoleRequest('/api/console/orders/NX-FEDCBA9876543210');
    const sentinelBody = await sentinelDetail.json() as {
      order: { items: Array<{ product: { variant: { selectedOptions: Array<Record<string, unknown>> } } }> };
    };
    const privateGet = await workerRequest(`/api/storefront/orders/${created.reference}`, {
      headers: { 'X-Nexus-Order-Capability': CAPABILITY_A },
    });
    const privateBody = await privateGet.json() as {
      items: Array<{ product: { variant: { selectedOptions: Array<Record<string, unknown>> } } }>;
    };
    const sentinelPrivate = await workerRequest('/api/storefront/orders/NX-FEDCBA9876543210', {
      headers: { 'X-Nexus-Order-Capability': CAPABILITY_B },
    });
    const sentinelPrivateBody = await sentinelPrivate.json() as {
      items: Array<{ product: { variant: { selectedOptions: Array<Record<string, unknown>> } } }>;
    };
    assertSafeJson(listBody);
    assertSafeJson(detailBody);
    assertSafeJson(sentinelBody);
    assertSafeJson(privateBody);
    assertSafeJson(sentinelPrivateBody);
    expect(sentinelDetail.status).toBe(200);
    expect(sentinelPrivate.status).toBe(200);
    expect(JSON.stringify(sentinelBody)).not.toContain('secret-file-key');
    expect(sentinelPrivateBody.items[0]?.product.variant.selectedOptions[0]).toEqual({
      groupId: 'g1',
      groupName: 'Theme',
      valueId: 'v1',
      valueLabel: 'Dark',
    });
    expect(privateBody.items[0]?.product.variant.selectedOptions[0]).toEqual({
      groupId: expect.any(String),
      groupName: 'Theme',
      valueId: expect.any(String),
      valueLabel: 'Dark',
    });
    expect(privateBody.items[0]?.product.variant.selectedOptions[0]).not.toHaveProperty('privateFileKey');
    expect(detailBody).toMatchObject({
      order: { allowedActions: ['mark_paid', 'cancel'], paymentRecordState: 'none' },
    });

    const unsupported = [
      `/api/storefront/orders/${created.reference}/complete`,
      `/api/storefront/orders/${created.reference}/cancel`,
      `/api/storefront/orders/${created.reference}/payments/manual`,
      `/api/storefront/orders/${created.reference}/fulfill`,
      `/api/console/orders/${created.reference}/complete`,
      `/api/console/orders/${created.reference}/approve`,
      `/api/console/orders/${created.reference}/reject`,
      `/api/storefront/orders/${created.reference}/refund-requests/approve`,
    ];
    const before = await tableCounts();
    for (const path of unsupported) {
      const request = path.startsWith('/api/console/') ? consoleRequest : workerRequest;
      const response = await request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('unsupported') },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'route_not_found' } });
    }
    const patched = await consoleRequest(`/api/console/orders/${created.reference}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paid' }),
    });
    expect(patched.status).toBe(404);
    expect(await tableCounts()).toEqual(before);

    const oldCancel = await unversionedConsoleRequest(`/api/console/orders/${created.reference}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': keyFor('old-cancel'),
      },
      body: JSON.stringify({}),
    });
    expect(oldCancel.status).toBe(409);
    expect(await oldCancel.json()).toEqual(CONTRACT_OUTDATED);

    const staleMarker = { 'X-Nexus-Order-Contract': '1' };
    const outdated = await Promise.all([
      unversionedRequest('/api/storefront/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': keyFor('old-create'),
          'X-Nexus-Order-Capability': CAPABILITY_A,
          ...staleMarker,
        },
        body: JSON.stringify({
          customer: { name: 'Old', email: 'old@example.test' },
          items: [{ productId: product.id, variantId: variant.id, quantity: 1 }],
        }),
      }),
      unversionedConsoleRequest('/api/console/orders'),
      unversionedConsoleRequest(`/api/console/orders/${created.reference}`),
      unversionedConsoleRequest(`/api/console/orders/${created.reference}/payments/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('old-pay'), ...staleMarker },
        body: JSON.stringify({ method: 'Wire', reference: 'WIRE-OLD' }),
      }),
      unversionedConsoleRequest(`/api/console/orders/${created.reference}/fulfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('old-fulfill'), ...staleMarker },
        body: JSON.stringify({}),
      }),
      unversionedRequest(`/api/storefront/orders/${created.reference}`, {
        headers: { 'X-Nexus-Order-Capability': CAPABILITY_A },
      }),
    ]);
    for (const response of outdated) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual(CONTRACT_OUTDATED);
    }
    const missingCap = await unversionedRequest(`/api/storefront/orders/${created.reference}`);
    expect(missingCap.status).toBe(404);
    expect(await missingCap.json()).toEqual(PRIVATE_DENIAL);
    expect(await tableCounts()).toEqual(before);
  });

  it('returns 500 rather than 404 when capability lookup infrastructure fails', async () => {
    const product = await createSimpleProduct();
    const created = await createOrder({
      items: [{ productId: product.id }],
      key: keyFor('lookup-fail'),
      capability: CAPABILITY_A,
    });
    expect((await markPaid(created.reference, keyFor('lookup-fail-pay'), 'WIRE-FAIL')).status).toBe(200);
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
          'X-Nexus-Order-Contract': '2',
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
      context: {
        storeId: BOOTSTRAP_STORE_ID,
        actor: { source: 'storefront', id: null },
        identity: { kind: 'public' },
      },
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
          'X-Nexus-Order-Contract': '2',
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
