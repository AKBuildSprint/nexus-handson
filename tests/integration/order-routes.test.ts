import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDetailResponse } from '../../src/catalog/catalog-types';
import { executeConsoleOrderAction } from '../../src/orders/order-operations';
import {
  resetCatalog,
  SIMPLE_CORE,
  TEST_STOREFRONT_ORIGIN,
  workerRequest,
} from '../support/catalog-test-env';
import worker from '../../src/worker';


const CAPABILITY_A = 'A'.repeat(43);
const CAPABILITY_B = 'B'.repeat(43);

beforeEach(resetCatalog);

async function createSimpleProduct(): Promise<ProductDetailResponse> {
  const response = await workerRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { product: ProductDetailResponse }).product;
}

function orderBody(productId: string) {
  return {
    customer: { name: '  Ada   Lovelace  ', email: 'ADA@Example.COM' },
    productId,
    variantId: null,
    quantity: 3,
  };
}

function createOrderRequest(productId: string, idempotencyKey: string, capability = CAPABILITY_A) {
  return workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-Nexus-Order-Capability': capability,
    },
    body: JSON.stringify(orderBody(productId)),
  });
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}

const PRIVATE_KEY = /(access|capability|delivery|digest|file|idempotency|private)/i;

describe('Storefront Order routes', () => {
  it('creates from catalog-backed money and returns only the Customer projection plus the static next step', async () => {
    const product = await createSimpleProduct();
    const clientMoney = await workerRequest('/api/storefront/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-client-money',
        'X-Nexus-Order-Capability': CAPABILITY_A,
      },
      body: JSON.stringify({ ...orderBody(product.id), totalMinor: 1 }),
    });
    expect(clientMoney.status).toBe(422);
    expect(await clientMoney.json()).toEqual({
      error: {
        code: 'validation_failed',
        message: 'The request is invalid.',
        fields: [{
          path: '/totalMinor',
          code: 'unknown_field',
          message: 'This field is not accepted.',
        }],
        incidentId: null,
      },
    });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count')).toBe(0);

    const response = await createOrderRequest(product.id, 'order-route-create-0001');
    const order = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(order).toMatchObject({
      status: 'pending_payment',
      product: { id: product.id, name: SIMPLE_CORE.name, variant: null },
      quantity: 3,
      unitPriceMinor: 2400,
      totalMinor: 7200,
      currency: 'USD',
      paymentNextStep: 'Payment instructions will be provided separately.',
    });
    expect(order.reference).toMatch(/^NX-[A-F0-9]{16}$/);
    expect(order.createdAt).toEqual(expect.any(String));
    expect(order).not.toHaveProperty('customer');
    expect(allKeys(order).filter((key) => PRIVATE_KEY.test(key))).toEqual([]);
    expect(JSON.stringify(order)).not.toContain(CAPABILITY_A);

    const stored = await env.DB.prepare(
      'SELECT total_minor, currency FROM orders WHERE reference = ?',
    ).bind(order.reference).first<{ total_minor: number; currency: string }>();
    expect(stored).toEqual({ total_minor: 7200, currency: 'USD' });
  });

  it('replays a lost-response retry without duplicating the aggregate and rejects capability rebinding', async () => {
    const product = await createSimpleProduct();
    const idempotencyKey = 'order-route-retry-0001';
    const first = await createOrderRequest(product.id, idempotencyKey);
    const firstBody = await first.json();
    const retry = await createOrderRequest(product.id, idempotencyKey);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(firstBody);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count')).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_lines').first<number>('count')).toBe(1);

    const conflict = await createOrderRequest(product.id, idempotencyKey, CAPABILITY_B);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: {
        code: 'idempotency_conflict',
        message: 'The idempotency key is already bound to another Order capability.',
        fields: [],
        incidentId: null,
      },
    });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count')).toBe(1);
  });

  it('reads with the caller-held capability and makes every private denial indistinguishable', async () => {
    const product = await createSimpleProduct();
    const create = await createOrderRequest(product.id, 'order-route-private-0001');
    const created = await create.json() as { reference: string } & Record<string, unknown>;
    const allowed = await workerRequest(`/api/storefront/orders/${created.reference}`, {
      headers: { 'X-Nexus-Order-Capability': CAPABILITY_A },
    });

    const allowedBody = await allowed.json();
    expect(allowed.status).toBe(200);
    expect(allowedBody).toEqual(created);
    expect(JSON.stringify(allowedBody)).not.toContain(CAPABILITY_A);
    expect(allKeys(allowedBody).filter((key) => PRIVATE_KEY.test(key))).toEqual([]);

    const denial = {
      error: {
        code: 'not_found',
        message: 'Order not found.',
        fields: [],
        incidentId: null,
      },
    };
    const missingReference = `${created.reference.slice(0, -1)}${created.reference.endsWith('F') ? 'E' : 'F'}`;
    const deniedRequests = [
      workerRequest(`/api/storefront/orders/${created.reference}`),
      workerRequest(`/api/storefront/orders/${created.reference}`, {
        headers: { 'X-Nexus-Order-Capability': 'invalid' },
      }),
      workerRequest(`/api/storefront/orders/${created.reference}`, {
        headers: { 'X-Nexus-Order-Capability': CAPABILITY_B },
      }),
      workerRequest(`/api/storefront/orders/${missingReference}`, {
        headers: { 'X-Nexus-Order-Capability': CAPABILITY_A },
      }),
    ];

    for (const denied of await Promise.all(deniedRequests)) {
      expect(denied.status).toBe(404);
      expect(await denied.json()).toEqual(denial);
    }
  });

  it('authorizes refunds before reading the body and keeps private denials uniform', async () => {
    const product = await createSimpleProduct();
    const created = await createOrderRequest(product.id, 'order-route-refund-create');
    const order = await created.json() as { reference: string };
    await executeConsoleOrderAction({
      database: env.DB,
      reference: order.reference,
      body: { action: 'mark_paid', acknowledgedRefundRequestId: null },
      idempotencyKey: 'order-route-refund-paid001',
    });

    const denial = {
      error: { code: 'not_found', message: 'Order not found.', fields: [], incidentId: null },
    };
    const oversized = new TextEncoder().encode(`${'{"reason":"x"'.padEnd(16_386, ' ')}}`);
    const unauthorizedOversize = await worker.fetch(new Request(`https://local.invalid/api/storefront/orders/${order.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-refund-unauth01',
        'X-Nexus-Order-Capability': CAPABILITY_B,
        'Content-Length': '10',
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(oversized);
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit), {
      DB: env.DB,
      FILES: env.FILES,
      STOREFRONT_ORIGIN: TEST_STOREFRONT_ORIGIN,
      ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
    });
    expect(unauthorizedOversize.status).toBe(404);
    expect(await unauthorizedOversize.json()).toEqual(denial);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM refund_requests').first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_commands').first<number>('count')).toBe(1);

    const unauthorized = await workerRequest(`/api/storefront/orders/${order.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-refund-unauth02',
        'X-Nexus-Order-Capability': CAPABILITY_B,
      },
      body: '{',
    });
    expect(unauthorized.status).toBe(404);
    expect(await unauthorized.json()).toEqual(denial);

    const malformedCapability = await workerRequest(`/api/storefront/orders/${order.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-refund-badcap01',
        'X-Nexus-Order-Capability': 'not-valid',
      },
      body: '{',
    });
    expect(malformedCapability.status).toBe(404);
    expect(await malformedCapability.json()).toEqual(denial);

    const authorizedMalformed = await workerRequest(`/api/storefront/orders/${order.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-refund-badjson1',
        'X-Nexus-Order-Capability': CAPABILITY_A,
      },
      body: '{',
    });
    expect(authorizedMalformed.status).toBe(400);
    expect(await authorizedMalformed.json()).toMatchObject({ error: { code: 'invalid_json' } });

    const winner = await workerRequest(`/api/storefront/orders/${order.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-refund-winner01',
        'X-Nexus-Order-Capability': CAPABILITY_A,
      },
      body: JSON.stringify({ reason: '<script>alert(1)</script>' }),
    });
    const winnerBody = await winner.json() as {
      order: { status: string; paymentNextStep: string | null; refundRequest: { reason: string } };
      command: { outcome: string; replayed: boolean };
    };
    expect(winner.status).toBe(201);
    expect(winner.headers.get('Cache-Control')).toBe('no-store');
    expect(winnerBody.order.status).toBe('paid');
    expect(winnerBody.order.paymentNextStep).toBeNull();
    expect(winnerBody.order.refundRequest.reason).toBe('<script>alert(1)</script>');
    expect(winnerBody.command).toMatchObject({ outcome: 'applied', replayed: false });
    expect(allKeys(winnerBody).filter((key) => PRIVATE_KEY.test(key))).toEqual([]);

    const replay = await workerRequest(`/api/storefront/orders/${order.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-refund-winner01',
        'X-Nexus-Order-Capability': CAPABILITY_A,
      },
      body: JSON.stringify({ reason: '<script>alert(1)</script>' }),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      order: { refundRequest: { reason: '<script>alert(1)</script>' }, paymentNextStep: null },
      command: { replayed: true },
    });

    const cachedDenied = await workerRequest(`/api/storefront/orders/${order.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-refund-winner01',
        'X-Nexus-Order-Capability': CAPABILITY_B,
      },
      body: '{',
    });
    expect(cachedDenied.status).toBe(404);
    expect(await cachedDenied.json()).toEqual(denial);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM refund_requests').first<number>('count')).toBe(1);

    const privateGet = await workerRequest(`/api/storefront/orders/${order.reference}`, {
      headers: { 'X-Nexus-Order-Capability': CAPABILITY_A },
    });
    expect(await privateGet.json()).toMatchObject({
      status: 'paid',
      paymentNextStep: null,
      refundRequest: { reason: '<script>alert(1)</script>' },
    });

    const commandsBefore = await env.DB.prepare('SELECT count(*) AS count FROM order_commands').first<number>('count');
    const oversizeAuthorized = new TextEncoder().encode(`${'{"reason":"ok"'.padEnd(16_386, ' ')}}`);
    const rejected = await worker.fetch(new Request(`https://local.invalid/api/storefront/orders/${order.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-refund-oversize1',
        'X-Nexus-Order-Capability': CAPABILITY_A,
        'Content-Length': '10',
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(oversizeAuthorized);
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit), {
      DB: env.DB,
      FILES: env.FILES,
      STOREFRONT_ORIGIN: TEST_STOREFRONT_ORIGIN,
      ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
    });
    expect(rejected.status).toBe(413);
    expect(await rejected.json()).toMatchObject({ error: { code: 'payload_too_large' } });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_commands').first<number>('count')).toBe(commandsBefore);

    const astralCapability = 'C'.repeat(43);
    const astralCreated = await createOrderRequest(product.id, 'order-route-refund-astral-c', astralCapability);
    const astralOrder = await astralCreated.json() as { reference: string };
    await executeConsoleOrderAction({
      database: env.DB,
      reference: astralOrder.reference,
      body: { action: 'mark_paid', acknowledgedRefundRequestId: null },
      idempotencyKey: 'order-route-refund-astral-p',
    });
    const escapedReason = `{"reason":"${'\\uD83D\\uDE00'.repeat(1000)}"}`;
    const astral = await workerRequest(`/api/storefront/orders/${astralOrder.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-refund-astral-w',
        'X-Nexus-Order-Capability': astralCapability,
      },
      body: escapedReason,
    });
    expect(astral.status).toBe(201);
    expect(await astral.json()).toMatchObject({
      order: { refundRequest: { reason: '😀'.repeat(1000) } },
      command: { outcome: 'applied', replayed: false },
    });
  });

  it('does not log private refund data on unexpected failures', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await workerRequest('/api/storefront/orders/NX-DEADBEEFDEADBEEF/refund-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-route-refund-missing1',
        'X-Nexus-Order-Capability': CAPABILITY_A,
      },
      body: JSON.stringify({ reason: 'secret-reason-text' }),
    });
    expect(response.status).toBe(404);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret-reason-text');
    expect(JSON.stringify(spy.mock.calls)).not.toContain(CAPABILITY_A);
    spy.mockRestore();
  });
});
