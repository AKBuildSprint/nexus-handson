import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import {
  resetCatalog,
  SIMPLE_CORE,
  VARIANT_CORE,
  oneVariantSchema,
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

function orderBody(items: Array<{ productId: string; variantId: string | null; quantity: number }>) {
  return {
    customer: { name: '  Ada   Lovelace  ', email: 'ADA@Example.COM' },
    items,
  };
}

function createOrderRequest(
  items: Array<{ productId: string; variantId: string | null; quantity: number }>,
  idempotencyKey: string,
  capability = CAPABILITY_A,
) {
  return workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-Nexus-Order-Capability': capability,
    },
    body: JSON.stringify(orderBody(items)),
  });
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}

const PRIVATE_KEY = /(access|actor|capability|delivery|digest|file|history|idempotency|private)/i;

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
      body: JSON.stringify({ ...orderBody([{ productId: product.id, variantId: null, quantity: 3 }]), totalMinor: 1 }),
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

    const response = await createOrderRequest(
      [{ productId: product.id, variantId: null, quantity: 3 }],
      'order-route-create-0001',
    );
    const order = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(order).toMatchObject({
      status: 'pending',
      items: [{
        position: 0,
        product: { id: product.id, name: SIMPLE_CORE.name, variant: null },
        quantity: 3,
        unitPriceMinor: 2400,
        lineTotalMinor: 7200,
        currency: 'USD',
      }],
      totalMinor: 7200,
      currency: 'USD',
      paymentNextStep: 'Payment instructions will be provided separately.',
      refundRequest: null,
    });
    expect(order.reference).toMatch(/^NX-[A-F0-9]{16}$/);
    expect(order.paymentReference).toMatch(/^NP[a-f0-9]{32}$/);
    expect(order.createdAt).toEqual(expect.any(String));
    expect(order).not.toHaveProperty('customer');
    expect(order).not.toHaveProperty('product');
    expect(order).not.toHaveProperty('quantity');
    expect(allKeys(order).filter((key) => PRIVATE_KEY.test(key))).toEqual([]);
    expect(JSON.stringify(order)).not.toContain(CAPABILITY_A);

    const stored = await env.DB.prepare(
      'SELECT total_minor, currency FROM orders WHERE reference = ?',
    ).bind(order.reference).first<{ total_minor: number; currency: string }>();
    expect(stored).toEqual({ total_minor: 7200, currency: 'USD' });
  });

  it('creates a two-Product Order and hides paymentNextStep after a paid legacy status', async () => {
    const simple = await createSimpleProduct();
    const variantProduct = await createActiveVariant();
    const response = await createOrderRequest(
      [
        { productId: simple.id, variantId: null, quantity: 1 },
        { productId: variantProduct.id, variantId: variantProduct.variants[0].id, quantity: 2 },
      ],
      'order-route-two-0001',
    );
    const order = await response.json() as { reference: string; items: unknown[]; totalMinor: number; paymentNextStep: string | null };
    expect(response.status).toBe(201);
    expect(order.items).toHaveLength(2);
    expect(order.totalMinor).toBe(2400 + 7200);
    expect(order.paymentNextStep).toBe('Payment instructions will be provided separately.');

    await env.DB.prepare("UPDATE orders SET status='paid' WHERE reference=?").bind(order.reference).run();
    const paid = await workerRequest(`/api/storefront/orders/${order.reference}`, {
      headers: { 'X-Nexus-Order-Capability': CAPABILITY_A },
    });
    const paidBody = await paid.json() as { paymentNextStep: string | null; status: string; items: unknown[] };
    expect(paid.status).toBe(200);
    expect(paidBody.status).toBe('paid');
    expect(paidBody.paymentNextStep).toBeNull();
    expect(paidBody.items).toHaveLength(2);
    expect(allKeys(paidBody).filter((key) => PRIVATE_KEY.test(key))).toEqual([]);
  });

  it('replays a lost-response retry without duplicating the aggregate and rejects capability rebinding', async () => {
    const product = await createSimpleProduct();
    const idempotencyKey = 'order-route-retry-0001';
    const items = [{ productId: product.id, variantId: null, quantity: 3 }];
    const first = await createOrderRequest(items, idempotencyKey);
    const firstBody = await first.json();
    const retry = await createOrderRequest(items, idempotencyKey);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(firstBody);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count')).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_lines').first<number>('count')).toBe(1);

    const conflict = await createOrderRequest(items, idempotencyKey, CAPABILITY_B);
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
    const create = await createOrderRequest(
      [{ productId: product.id, variantId: null, quantity: 3 }],
      'order-route-private-0001',
    );
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
