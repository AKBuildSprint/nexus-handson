import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '../../src/catalog/catalog-types';
import {
  resetCatalog,
  SIMPLE_CORE,
  TEST_STOREFRONT_ORIGIN,
  workerRequest,
} from '../support/catalog-test-env';

beforeEach(resetCatalog);

async function createOrder(): Promise<Record<string, unknown>> {
  const productResponse = await workerRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
  });
  const product = (await productResponse.json() as { product: ProductDetailResponse }).product;
  const orderResponse = await workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'console-order-list-0001',
      'X-Nexus-Order-Capability': 'A'.repeat(43),
    },
    body: JSON.stringify({
      customer: { name: '  Grace   Hopper  ', email: 'GRACE@Example.COM' },
      productId: product.id,
      variantId: null,
      quantity: 2,
    }),
  });
  expect(orderResponse.status).toBe(201);
  return await orderResponse.json() as Record<string, unknown>;
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}

describe('Console Orders route', () => {
  it('returns the reduced persisted projection and never adds Storefront CORS', async () => {
    const created = await createOrder();
    const response = await workerRequest('/api/console/orders', {
      headers: { Origin: TEST_STOREFRONT_ORIGIN },
    });
    const body = await response.json() as { orders: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
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
    });
    expect(body.orders[0]).not.toHaveProperty('paymentNextStep');
    expect(allKeys(body).filter((key) =>
      /(access|capability|delivery|digest|file|idempotency|private)/i.test(key)
    )).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('A'.repeat(43));
  });

  it('returns an empty safe envelope when no Orders exist', async () => {
    const response = await workerRequest('/api/console/orders');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orders: [] });
  });
});
