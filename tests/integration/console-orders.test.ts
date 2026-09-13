import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import {
  consoleRequest,
  resetCatalog,
  SIMPLE_CORE,
  TEST_STOREFRONT_ORIGIN,
  workerRequest,
} from '../support/catalog-test-env';

beforeEach(resetCatalog);

const EMPTY_SUMMARY = {
  totalOrders: 0,
  byStatus: { pending: 0, paid: 0, fulfilled: 0, canceled: 0 },
  openRefundRequests: 0,
};

async function createOrder(): Promise<Record<string, unknown>> {
  const productResponse = await consoleRequest('/api/console/products', {
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
      items: [{ productId: product.id, variantId: null, quantity: 2 }],
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
    const response = await consoleRequest('/api/console/orders', {
      headers: { Origin: TEST_STOREFRONT_ORIGIN },
    });
    const body = await response.json() as {
      orders: Array<Record<string, unknown>>;
      summary: typeof EMPTY_SUMMARY;
      nextCursor: string | null;
      hasOrders: boolean;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body.orders).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
    expect(body.hasOrders).toBe(true);
    expect(body.summary).toEqual({
      totalOrders: 1,
      byStatus: { pending: 1, paid: 0, fulfilled: 0, canceled: 0 },
      openRefundRequests: 0,
    });
    expect(body.orders[0]).toMatchObject({
      reference: created.reference,
      status: 'pending',
      customer: { name: 'Grace Hopper', email: 'grace@example.com' },
      items: [{
        position: 0,
        product: { name: SIMPLE_CORE.name, variant: null },
        quantity: 2,
        unitPriceMinor: 2400,
        lineTotalMinor: 4800,
        currency: 'USD',
      }],
      totalMinor: 4800,
      currency: 'USD',
      createdAt: created.createdAt,
      refundRequestStatus: null,
    });
    expect(body.orders[0]).not.toHaveProperty('paymentNextStep');
    expect(body.orders[0]).not.toHaveProperty('refundRequest');
    expect(body.orders[0]).not.toHaveProperty('product');
    expect(body.orders[0]).not.toHaveProperty('quantity');
    expect(allKeys(body).filter((key) =>
      /(access|capability|delivery|digest|file|idempotency|private)/i.test(key)
    )).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('A'.repeat(43));
  });

  it('returns an empty safe envelope when no Orders exist', async () => {
    const response = await consoleRequest('/api/console/orders');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orders: [],
      summary: EMPTY_SUMMARY,
      nextCursor: null,
      hasOrders: false,
    });
  });
});
