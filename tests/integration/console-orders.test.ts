import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import { executeConsoleOrderAction, requestOrderRefund } from '@nexus/orders/order-operations';
import { listConsoleOrders } from '@nexus/orders/order-read';
import {
  resetCatalog,
  SIMPLE_CORE,
  TEST_STOREFRONT_ORIGIN,
  workerRequest,
} from '../support/catalog-test-env';
import { routeConsoleOrderRequest } from '../../apps/worker/src/console-order-routes';
import worker from '../../apps/worker/src';

beforeEach(resetCatalog);

const CAPABILITY = 'A'.repeat(43);
const PRIVATE_KEY = /(access|capability|delivery|digest|file|idempotency|private)/i;
const SECRET_TEXT = /(capability|delivery|privateFile|accessTitle|accessInstructions|idempotency)/i;

async function createProduct(): Promise<ProductDetailResponse> {
  const productResponse = await workerRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
  });
  expect(productResponse.status).toBe(201);
  return (await productResponse.json() as { product: ProductDetailResponse }).product;
}

async function createOrder(input: {
  productId: string;
  key: string;
  name?: string;
  email?: string;
  capability?: string;
}): Promise<Record<string, unknown> & { reference: string; createdAt: string }> {
  const orderResponse = await workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.key,
      'X-Nexus-Order-Capability': input.capability ?? CAPABILITY,
    },
    body: JSON.stringify({
      customer: { name: input.name ?? '  Grace   Hopper  ', email: input.email ?? 'GRACE@Example.COM' },
      productId: input.productId,
      variantId: null,
      quantity: 2,
    }),
  });
  expect(orderResponse.status).toBe(201);
  return await orderResponse.json() as Record<string, unknown> & { reference: string; createdAt: string };
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}

function paddedJson(payload: Record<string, unknown>, size: number): Uint8Array {
  const json = JSON.stringify(payload);
  if (json.length > size) throw new Error('Payload already exceeds target size.');
  const padded = `${json.slice(0, -1)}${' '.repeat(size - json.length)}}`;
  return new TextEncoder().encode(padded);
}

function streamRequest(path: string, headers: HeadersInit, body: Uint8Array): Request {
  return new Request(`https://local.invalid${path}`, {
    method: 'POST',
    headers,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit);
}

async function workerFetch(request: Request): Promise<Response> {
  return worker.fetch(request, {
    DB: env.DB,
    FILES: env.FILES,
    STOREFRONT_ORIGIN: TEST_STOREFRONT_ORIGIN,
    ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
  });
}

async function seedStaticOrders(input: {
  count: number;
  storeId?: string;
  nameFor?: (index: number) => string;
  emailFor?: (index: number) => string;
  createdAtFor?: (index: number) => string;
  statusFor?: (index: number) => 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled';
}): Promise<void> {
  const storeId = input.storeId ?? 'store_nexus';
  if (storeId !== 'store_nexus') {
    await env.DB.prepare('INSERT INTO stores (id, slug, name) VALUES (?, ?, ?)').bind(storeId, storeId, storeId).run();
  }
  const customerId = `cust_${storeId.replace(/[^a-z0-9]/gi, '')}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO customers (id, store_id, name, email_normalized) VALUES (?, ?, 'Seed', ?)`,
  ).bind(customerId, storeId, `seed-${storeId}@example.test`).run();

  for (let start = 0; start < input.count; start += 40) {
    const statements = [];
    const end = Math.min(input.count, start + 40);
    for (let index = start; index < end; index += 1) {
      const id = `ord_${storeId}_${String(index).padStart(5, '0')}`;
      const lineId = `line_${storeId}_${String(index).padStart(5, '0')}`;
      const reference = `NX-${index.toString(16).toUpperCase().padStart(16, '0')}`;
      const createdAt = input.createdAtFor?.(index) ?? '2026-01-01T00:00:00.000Z';
      const name = input.nameFor?.(index) ?? 'Seed Customer';
      const email = input.emailFor?.(index) ?? 'seed@example.test';
      const status = input.statusFor?.(index) ?? 'pending_payment';
      statements.push(
        env.DB.prepare(
          `INSERT INTO order_lines (
             id, store_id, order_id, product_id, product_name, selected_options_json, quantity,
             unit_price_minor, line_total_minor, currency, access_title, access_instructions
           ) VALUES (?, ?, ?, 'prod_seed', 'Seed Product', '[]', 1, 100, 100, 'USD', 'Private file', 'Keep this secret')`,
        ).bind(lineId, storeId, id),
        env.DB.prepare(
          `INSERT INTO orders (
             id, store_id, reference, customer_id, customer_name, customer_email_normalized, status, currency, total_minor, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', 100, ?)`,
        ).bind(id, storeId, reference, customerId, name, email, status, createdAt),
      );
    }
    await env.DB.batch(statements);
  }
}

function countingDatabase(database: D1Database): { database: D1Database; calls: () => number } {
  let calls = 0;
  const wrap = {
    prepare(query: string) {
      calls += 1;
      return database.prepare(query);
    },
    batch(statements: D1PreparedStatement[]) {
      calls += 1;
      return database.batch(statements);
    },
    exec: database.exec.bind(database),
    dump: database.dump?.bind(database),
  } as unknown as D1Database;
  return { database: wrap, calls: () => calls };
}

describe('Console Orders route', () => {
  it('returns the paged reduced projection and never adds Storefront CORS', async () => {
    const product = await createProduct();
    const created = await createOrder({ productId: product.id, key: 'console-order-list-0001' });
    const response = await workerRequest('/api/console/orders', {
      headers: { Origin: TEST_STOREFRONT_ORIGIN },
    });
    const body = await response.json() as {
      orders: Array<Record<string, unknown>>;
      nextCursor: string | null;
      hasAnyOrders: boolean;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(body.hasAnyOrders).toBe(true);
    expect(body.nextCursor).toBeNull();
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0]).toMatchObject({
      reference: created.reference,
      status: 'pending_payment',
      customer: { name: 'Grace Hopper', email: 'grace@example.com' },
      product: { name: SIMPLE_CORE.name, variant: null },
      quantity: 2,
      unitPriceMinor: 2400,
      totalMinor: 4800,
      currency: 'USD',
      createdAt: created.createdAt,
      hasPendingRefund: false,
    });
    expect(body.orders[0]).not.toHaveProperty('paymentNextStep');
    expect(body.orders[0]).not.toHaveProperty('refundRequest');
    expect(body.orders[0]).not.toHaveProperty('reason');
    expect(body.orders[0]).not.toHaveProperty('history');
    expect(body.orders[0]).not.toHaveProperty('command');
    expect(allKeys(body).filter((key) => PRIVATE_KEY.test(key))).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('A'.repeat(43));
    expect(JSON.stringify(body)).not.toMatch(SECRET_TEXT);
  });

  it('returns an empty safe envelope when no Orders exist', async () => {
    const response = await workerRequest('/api/console/orders');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orders: [], nextCursor: null, hasAnyOrders: false });
  });

  it('matches Unicode and literal %/_ search, AND filters, and isolates another Store', async () => {
    const product = await createProduct();
    const unicode = await createOrder({
      productId: product.id,
      key: 'console-search-unicode-01',
      name: 'Élodie Dupont',
      email: 'elodie@example.test',
      capability: 'U'.repeat(43),
    });
    const literal = await createOrder({
      productId: product.id,
      key: 'console-search-literal-01',
      name: '100%_off Club',
      email: 'percent@example.test',
      capability: 'L'.repeat(43),
    });
    const paid = await createOrder({
      productId: product.id,
      key: 'console-search-paid-0001',
      name: 'Paid Person',
      email: 'paid@example.test',
      capability: 'P'.repeat(43),
    });
    await executeConsoleOrderAction({
      database: env.DB,
      reference: paid.reference,
      body: { action: 'mark_paid', acknowledgedRefundRequestId: null },
      idempotencyKey: 'console-search-mark-paid01',
    });
    const refundable = await env.DB.prepare('SELECT id FROM orders WHERE reference = ?')
      .bind(paid.reference)
      .first<{ id: string }>();
    await requestOrderRefund({
      database: env.DB,
      orderId: refundable!.id,
      body: { reason: 'keep this reason off the list' },
      idempotencyKey: 'console-search-refund-001',
    });
    await seedStaticOrders({
      count: 1,
      storeId: 'store_other',
      nameFor: () => 'Élodie Dupont',
    });

    const unicodeSearch = await workerRequest(`/api/console/orders?q=${encodeURIComponent('élodie')}`);
    const unicodeBody = await unicodeSearch.json() as { orders: Array<{ reference: string }>; hasAnyOrders: boolean };
    expect(unicodeSearch.status).toBe(200);
    expect(unicodeBody.hasAnyOrders).toBe(true);
    expect(unicodeBody.orders.map((order) => order.reference)).toEqual([unicode.reference]);

    const literalSearch = await workerRequest('/api/console/orders?q=100%25_');
    const literalBody = await literalSearch.json() as { orders: Array<{ reference: string }> };
    expect(literalBody.orders.map((order) => order.reference)).toEqual([literal.reference]);

    const filtered = await workerRequest('/api/console/orders?status=paid&refund=pending');
    const filteredBody = await filtered.json() as {
      orders: Array<Record<string, unknown>>;
    };
    expect(filteredBody.orders).toHaveLength(1);
    expect(filteredBody.orders[0]).toMatchObject({
      reference: paid.reference,
      hasPendingRefund: true,
    });
    expect(JSON.stringify(filteredBody)).not.toContain('keep this reason off the list');
    expect(JSON.stringify(filteredBody)).not.toContain('refundRequest');
    expect(allKeys(filteredBody).filter((key) => key === 'reason' || key === 'history' || key === 'command')).toEqual([]);
  });

  it('pages 25 Orders with duplicate timestamps and a stable keyset cursor', async () => {
    await seedStaticOrders({
      count: 30,
      nameFor: () => 'Paged Customer',
      createdAtFor: () => '2026-02-02T00:00:00.000Z',
    });
    const first = await workerRequest('/api/console/orders?q=Paged');
    const firstBody = await first.json() as {
      orders: Array<{ reference: string; createdAt: string }>;
      nextCursor: string | null;
      hasAnyOrders: boolean;
    };
    expect(first.status).toBe(200);
    expect(firstBody.hasAnyOrders).toBe(true);
    expect(firstBody.orders).toHaveLength(25);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    const firstRefs = firstBody.orders.map((order) => order.reference);
    expect(new Set(firstRefs).size).toBe(25);

    const second = await workerRequest(`/api/console/orders?q=Paged&cursor=${firstBody.nextCursor}`);
    const secondBody = await second.json() as {
      orders: Array<{ reference: string }>;
      nextCursor: string | null;
    };
    expect(secondBody.orders).toHaveLength(5);
    expect(secondBody.nextCursor).toBeNull();
    const secondRefs = secondBody.orders.map((order) => order.reference);
    expect(firstRefs.some((reference) => secondRefs.includes(reference))).toBe(false);
    expect(new Set([...firstRefs, ...secondRefs]).size).toBe(30);
  });

  it('scans 201 duplicate-timestamp candidates across three chunks without losing sparse matches', async () => {
    await seedStaticOrders({
      count: 201,
      createdAtFor: () => '2026-03-03T00:00:00.000Z',
      nameFor: (index) => (index === 0 || index === 100 || index === 200 ? 'Sparse Match' : 'Other Customer'),
    });
    const counted = countingDatabase(env.DB);
    const listed = await listConsoleOrders(counted.database, { q: 'sparse', status: 'all', refund: 'all', cursor: null });
    expect(listed.orders.map((order) => order.customer.name)).toEqual(['Sparse Match', 'Sparse Match', 'Sparse Match']);
    expect(listed.nextCursor).toBeNull();
    expect(listed.hasAnyOrders).toBe(true);
    expect(counted.calls()).toBeGreaterThanOrEqual(4);
  });

  it('completes a 5001-candidate no-match scan without silent truncation', async () => {
    await seedStaticOrders({ count: 5001, nameFor: () => 'No Match Customer' });
    const counted = countingDatabase(env.DB);
    const listed = await listConsoleOrders(counted.database, { q: 'absent-term', status: 'all', refund: 'all', cursor: null });
    expect(listed.orders).toEqual([]);
    expect(listed.hasAnyOrders).toBe(true);
    expect(listed.nextCursor).toBeNull();
    expect(counted.calls()).toBe(52);
  });

  it('returns a coherent Console detail snapshot and valid actions', async () => {
    const product = await createProduct();
    const created = await createOrder({ productId: product.id, key: 'console-detail-create-01' });
    const paid = await executeConsoleOrderAction({
      database: env.DB,
      reference: created.reference,
      body: { action: 'mark_paid', acknowledgedRefundRequestId: null },
      idempotencyKey: 'console-detail-mark-paid01',
    });
    const refund = await requestOrderRefund({
      database: env.DB,
      orderId: (await env.DB.prepare('SELECT id FROM orders WHERE reference = ?').bind(created.reference).first<{ id: string }>())!.id,
      body: { reason: 'detail visible reason' },
      idempotencyKey: 'console-detail-refund-0001',
    });

    const response = await workerRequest(`/api/console/orders/${created.reference}`);
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toMatchObject({
      reference: created.reference,
      status: 'paid',
      customer: { name: 'Grace Hopper', email: 'grace@example.com' },
      quantity: 2,
      unitPriceMinor: 2400,
      totalMinor: 4800,
      refundRequest: { reason: 'detail visible reason', status: 'pending' },
      allowedActions: ['mark_fulfilled'],
    });
    expect(body).not.toHaveProperty('paymentNextStep');
    expect(body).not.toHaveProperty('hasPendingRefund');
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'order_created', toStatus: 'pending_payment' }),
      expect.objectContaining({ action: 'mark_paid', toStatus: 'paid' }),
      expect.objectContaining({ action: 'refund_requested', refundRequestId: refund.order.refundRequest?.id }),
    ]));
    expect(allKeys(body).filter((key) => PRIVATE_KEY.test(key))).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(CAPABILITY);
    expect(paid.order.product).toEqual(body.product);
  });

  it('applies Console actions with no-store envelopes and rejects oversized bodies before writes', async () => {
    const product = await createProduct();
    const created = await createOrder({ productId: product.id, key: 'console-action-create-01' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const applied = await workerRequest(`/api/console/orders/${created.reference}/actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'console-action-mark-paid001',
      },
      body: JSON.stringify({ action: 'mark_paid', acknowledgedRefundRequestId: null }),
    });
    const appliedBody = await applied.json() as { order: { status: string }; command: { outcome: string; replayed: boolean } };
    expect(applied.status).toBe(200);
    expect(applied.headers.get('Cache-Control')).toBe('no-store');
    expect(appliedBody.order.status).toBe('paid');
    expect(appliedBody.order).not.toHaveProperty('hasPendingRefund');
    expect(appliedBody.command).toMatchObject({ outcome: 'applied', replayed: false, resultStatus: 'paid' });

    const replay = await workerRequest(`/api/console/orders/${created.reference}/actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'console-action-mark-paid001',
      },
      body: JSON.stringify({ action: 'mark_paid', acknowledgedRefundRequestId: null }),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      order: { status: 'paid' },
      command: { replayed: true, outcome: 'applied' },
    });

    const commandsBefore = await env.DB.prepare('SELECT count(*) AS count FROM order_commands').first<number>('count');
    const oversize = paddedJson({ action: 'mark_fulfilled', acknowledgedRefundRequestId: null }, 16_385);
    const rejected = await workerFetch(streamRequest(
      `/api/console/orders/${created.reference}/actions`,
      {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'console-action-oversize-001',
        'Content-Length': '10',
      },
      oversize,
    ));
    expect(rejected.status).toBe(413);
    expect(rejected.headers.get('Cache-Control')).toBe('no-store');
    expect(await rejected.json()).toEqual({
      error: {
        code: 'payload_too_large',
        message: 'The request body is too large.',
        fields: [],
        incidentId: null,
      },
    });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_commands').first<number>('count')).toBe(commandsBefore);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('console-action-oversize-001');
    spy.mockRestore();

    const exact = paddedJson({ action: 'mark_fulfilled', acknowledgedRefundRequestId: null }, 16_384);
    const accepted = await workerFetch(streamRequest(
      `/api/console/orders/${created.reference}/actions`,
      {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'console-action-exact-size01',
      },
      exact,
    ));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ order: { status: 'fulfilled' } });
  });

  it('keeps detail snapshots coherent across an overlapping write', async () => {
    const product = await createProduct();

    function wrapDatabase(database: D1Database, gate: {
      markArrived: () => void;
      released: Promise<void>;
      markSettled: () => void;
    }): D1Database {
      return {
        prepare: database.prepare.bind(database),
        exec: database.exec.bind(database),
        dump: database.dump?.bind(database),
        batch: async (statements: D1PreparedStatement[]) => {
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

    type DetailBody = {
      reference: string;
      status: string;
      product: {
        id: string;
        name: string;
        variant: { id: string; sku: string; selectedOptions: unknown[] } | null;
      };
      quantity: number;
      unitPriceMinor: number;
      totalMinor: number;
      currency: string;
      createdAt: string;
      customer: { name: string; email: string };
      history: Array<{ action: string }>;
      refundRequest: { reason: string; status: string } | null;
      allowedActions: string[];
    };

    for (const first of ['read', 'write'] as const) {
      const created = await createOrder({
        productId: product.id,
        key: `console-overlap-create-${first}01`,
        capability: first === 'read' ? CAPABILITY : 'B'.repeat(43),
        email: first === 'read' ? 'grace@example.com' : 'overlap2@example.test',
      });
      await executeConsoleOrderAction({
        database: env.DB,
        reference: created.reference,
        body: { action: 'mark_paid', acknowledgedRefundRequestId: null },
        idempotencyKey: `console-overlap-paid-${first}01`,
      });
      const orderId = (await env.DB.prepare('SELECT id FROM orders WHERE reference = ?')
        .bind(created.reference)
        .first<{ id: string }>())!.id;
      const baselineResponse = await routeConsoleOrderRequest(
        new Request(`https://local.invalid/api/console/orders/${created.reference}`),
        env.DB,
      );
      expect(baselineResponse?.status).toBe(200);
      const baseline = await baselineResponse!.json() as DetailBody;
      const {
        status: _baselineStatus,
        history: _baselineHistory,
        refundRequest: _baselineRefund,
        allowedActions: _baselineActions,
        ...purchase
      } = baseline;

      const readGate = createGate();
      const writeGate = createGate();
      const readPromise = routeConsoleOrderRequest(
        new Request(`https://local.invalid/api/console/orders/${created.reference}`),
        wrapDatabase(env.DB, readGate),
      );
      const writePromise = requestOrderRefund({
        database: wrapDatabase(env.DB, writeGate),
        orderId,
        body: { reason: 'overlap refund reason' },
        idempotencyKey: `console-overlap-refund-${first}01`,
      });

      await Promise.all([readGate.arrived, writeGate.arrived]);
      expect(await Promise.race([
        readPromise.then(() => 'read-done' as const),
        writePromise.then(() => 'write-done' as const),
        Promise.resolve('still-in-flight' as const),
      ])).toBe('still-in-flight');

      if (first === 'read') {
        readGate.release();
        await readGate.settled;
        writeGate.release();
      } else {
        writeGate.release();
        await writeGate.settled;
        readGate.release();
      }

      const [readResponse, writeResult] = await Promise.all([readPromise, writePromise]);
      expect(readResponse?.status).toBe(200);
      expect(writeResult.order.status).toBe('paid');
      expect(writeResult.order.refundRequest).toMatchObject({
        reason: 'overlap refund reason',
        status: 'pending',
      });

      const body = await readResponse!.json() as DetailBody;
      const {
        status,
        history,
        refundRequest,
        allowedActions,
        ...observedPurchase
      } = body;
      expect(observedPurchase).toEqual(purchase);
      expect(status).toBe('paid');
      expect(allowedActions).toEqual(['mark_fulfilled']);
      if (first === 'read') {
        expect(history.map((entry) => entry.action)).toEqual(['order_created', 'mark_paid']);
        expect(refundRequest).toBeNull();
      } else {
        expect(history.map((entry) => entry.action)).toEqual([
          'order_created',
          'mark_paid',
          'refund_requested',
        ]);
        expect(refundRequest).toMatchObject({
          reason: 'overlap refund reason',
          status: 'pending',
        });
      }
    }
  });
});
