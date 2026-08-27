import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '../../src/catalog/catalog-types';
import { createOrderItemCatalogSnapshotResolver } from '../../src/catalog/private-order-snapshot';
import { listConsoleOrders } from '../../src/orders/order-read';
import { createOrder } from '../../src/orders/order-write';
import { digestOrderCapability, readPrivateOrder } from '../../src/orders/private-access';
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

async function createSimple(): Promise<ProductDetailResponse> {
  const response = await workerRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
  });
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
  return (await response.json() as { product: ProductDetailResponse }).product;
}

function orderBody(productId: string, variantId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: 'Ada Lovelace', email: ' ADA@Example.test ' },
    productId,
    variantId,
    quantity: 2,
    ...overrides,
  };
}

async function orderTableCounts(): Promise<number[]> {
  return Promise.all([
    'customers',
    'orders',
    'order_lines',
    'order_history',
    'order_access',
    'order_idempotency',
  ].map(async (table) => await env.DB.prepare(`SELECT count(*) AS count FROM ${table}`).first<number>('count') ?? 0));
}

describe('Order aggregate persistence', () => {
  it('persists one Simple line with server money, capability digest, and safe projections', async () => {
    const product = await createSimple();
    const order = await createOrder({
      database: env.DB,
      body: orderBody(product.id, null),
      idempotencyKey: 'request-simple-0001',
      capability: CAPABILITY_A,
    });

    expect(order).toMatchObject({
      status: 'pending_payment',
      product: { id: product.id, name: 'Field Notes', variant: null },
      quantity: 2,
      unitPriceMinor: 2400,
      totalMinor: 4800,
      currency: 'USD',
    });
    expect(await orderTableCounts()).toEqual([1, 1, 1, 1, 1, 1]);
    const access = await env.DB.prepare(
      'SELECT capability_digest FROM order_access',
    ).first<{ capability_digest: string }>();
    expect(access?.capability_digest).toBe(await digestOrderCapability(CAPABILITY_A));
    expect(access?.capability_digest).not.toContain(CAPABILITY_A);

    expect(await readPrivateOrder({ database: env.DB, reference: order.reference, capability: CAPABILITY_A })).toEqual(order);
    expect(await readPrivateOrder({ database: env.DB, reference: order.reference, capability: CAPABILITY_B })).toBeNull();
    const consoleOrders = await listConsoleOrders(env.DB);
    expect(consoleOrders).toHaveLength(1);
    expect(JSON.stringify({ order, consoleOrders })).not.toMatch(/capability|accessTitle|accessInstructions|privateFileKey/);
  });

  it('uses enabled Variant selection and rejects missing, disabled, or mismatched selection without writes', async () => {
    const product = await createActiveVariant();
    const variant = product.variants[0];
    const order = await createOrder({
      database: env.DB,
      body: orderBody(product.id, variant.id, { quantity: 3 }),
      idempotencyKey: 'request-variant-0001',
      capability: CAPABILITY_A,
    });
    expect(order).toMatchObject({
      product: {
        id: product.id,
        variant: {
          id: variant.id,
          sku: variant.sku,
          selectedOptions: [{ groupName: 'Theme', valueLabel: 'Dark' }],
        },
      },
      unitPriceMinor: 3600,
      totalMinor: 10800,
    });

    await expect(createOrder({
      database: env.DB,
      body: orderBody(product.id, null),
      idempotencyKey: 'request-variant-0002',
      capability: CAPABILITY_B,
    })).rejects.toMatchObject({ code: 'variant_not_found' });
    await env.DB.prepare(
      "UPDATE product_variants SET status='disabled', current_schema=0 WHERE id=?",
    ).bind(variant.id).run();
    await expect(createOrder({
      database: env.DB,
      body: orderBody(product.id, variant.id),
      idempotencyKey: 'request-variant-0003',
      capability: CAPABILITY_B,
    })).rejects.toMatchObject({ code: 'variant_not_found' });
    expect(await orderTableCounts()).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('reuses normalized Customer identity, updates the latest name, and keeps historic snapshots immutable', async () => {
    const product = await createSimple();
    const first = await createOrder({
      database: env.DB,
      body: orderBody(product.id, null, { quantity: 1 }),
      idempotencyKey: 'request-customer-0001',
      capability: CAPABILITY_A,
    });
    await createOrder({
      database: env.DB,
      body: {
        ...orderBody(product.id, null, { quantity: 1 }),
        customer: { name: 'Grace Hopper', email: 'ada@example.test' },
      },
      idempotencyKey: 'request-customer-0002',
      capability: CAPABILITY_B,
    });

    expect(await env.DB.prepare('SELECT count(*) AS count FROM customers').first<number>('count')).toBe(1);
    expect(await env.DB.prepare('SELECT name, email_normalized FROM customers').first()).toEqual({
      name: 'Grace Hopper',
      email_normalized: 'ada@example.test',
    });
    const names = await env.DB.prepare('SELECT customer_name FROM orders ORDER BY created_at, id').all<{ customer_name: string }>();
    expect(names.results.map((row) => row.customer_name).sort()).toEqual(['Ada Lovelace', 'Grace Hopper']);

    const replay = await createOrder({
      database: env.DB,
      body: orderBody(product.id, null, { quantity: 1 }),
      idempotencyKey: 'request-customer-0001',
      capability: CAPABILITY_A,
    });
    expect(replay.reference).toBe(first.reference);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count')).toBe(2);
    await expect(createOrder({
      database: env.DB,
      body: orderBody(product.id, null, { quantity: 1 }),
      idempotencyKey: 'request-customer-0001',
      capability: CAPABILITY_B,
    })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('rolls back the complete aggregate when the captured Product revision changes before assertion', async () => {
    const product = await createSimple();
    const baseResolver = createOrderItemCatalogSnapshotResolver(env.DB);
    await expect(createOrder({
      database: env.DB,
      body: orderBody(product.id, null),
      idempotencyKey: 'request-conflict-0001',
      capability: CAPABILITY_A,
      resolveCatalogSnapshot: async (selection) => {
        const resolution = await baseResolver(selection);
        await env.DB.prepare(
          "UPDATE products SET base_price_minor=9999, revision=revision+1 WHERE id=?",
        ).bind(product.id).run();
        return resolution;
      },
    })).rejects.toMatchObject({ code: 'catalog_revision_conflict' });
    expect(await orderTableCounts()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('rejects out-of-range quantity before persistence and retains the purchased private-file snapshot', async () => {
    const product = await createSimple();
    await expect(createOrder({
      database: env.DB,
      body: orderBody(product.id, null, { quantity: 100 }),
      idempotencyKey: 'request-invalid-0001',
      capability: CAPABILITY_A,
    })).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await orderTableCounts()).toEqual([0, 0, 0, 0, 0, 0]);

    await env.DB.prepare(
      `UPDATE products SET delivery_file_key='delivery/original.pdf', delivery_file_filename='original.pdf',
       delivery_file_size=20, delivery_file_kind='pdf', delivery_file_checksum='original-checksum', revision=revision+1
       WHERE id=?`,
    ).bind(product.id).run();
    await createOrder({
      database: env.DB,
      body: orderBody(product.id, null, { quantity: 1 }),
      idempotencyKey: 'request-retention-0001',
      capability: CAPABILITY_A,
    });
    await env.DB.prepare(
      `UPDATE products SET delivery_file_key=NULL, delivery_file_filename=NULL, delivery_file_size=NULL,
       delivery_file_kind=NULL, delivery_file_checksum=NULL, revision=revision+1 WHERE id=?`,
    ).bind(product.id).run();
    expect(await env.DB.prepare('SELECT private_file_key FROM order_lines').first<string>('private_file_key'))
      .toBe('delivery/original.pdf');
  });
});
