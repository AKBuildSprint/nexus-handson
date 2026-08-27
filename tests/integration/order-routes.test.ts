import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '../../src/catalog/catalog-types';
import {
  resetCatalog,
  SIMPLE_CORE,
  workerRequest,
} from '../support/catalog-test-env';

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
});
