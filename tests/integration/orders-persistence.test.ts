import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import { PUBLIC_STORE_ID as BOOTSTRAP_STORE_ID } from '@nexus/catalog/public-store';
import { resolveOrderItemCatalogSnapshots } from '@nexus/catalog/private-order-snapshot';
import { listConsoleOrders } from '@nexus/orders/queries/order-read';
import { createRefundRequest, markPaid } from '@nexus/orders/commands/order-commands';
import { createOrder } from '@nexus/orders/commands/order-write';
import { digestOrderCapability, readPrivateOrder } from '@nexus/orders/private-access';
import {
  catalogMigrations,
  consoleRequest,
  getConsoleIdentity,
  resetCatalog,
  resetCatalogThrough,
  SIMPLE_CORE,
  VARIANT_CORE,
  oneVariantSchema,
  workerRequest,
} from '../support/catalog-test-env';

const CAPABILITY_A = 'A'.repeat(43);
const CAPABILITY_B = 'B'.repeat(43);
const STOREFRONT_CONTEXT = {
  storeId: BOOTSTRAP_STORE_ID,
  actor: { source: 'storefront' as const, id: null },
  identity: { kind: 'public' as const },
};

beforeEach(resetCatalog);

async function createSimple(name = SIMPLE_CORE.name): Promise<ProductDetailResponse> {
  const response = await consoleRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: { ...SIMPLE_CORE, name }, schema: null, previewHash: null }),
  });
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
  return (await response.json() as { product: ProductDetailResponse }).product;
}

function twoVariantSchema() {
  return {
    groups: [{
      draftRef: 'group-theme',
      id: null,
      name: 'Theme',
      position: 0,
      participating: true,
      values: [
        { draftRef: 'value-dark', id: null, label: 'Dark', position: 0 },
        { draftRef: 'value-light', id: null, label: 'Light', position: 1 },
      ],
    }],
    rows: [
      {
        id: null,
        selectedValueRefs: ['value-dark'],
        sku: 'FOCUS-DARK',
        status: 'enabled' as const,
        priceOverride: null,
        delivery: { source: 'product_default' as const },
      },
      {
        id: null,
        selectedValueRefs: ['value-light'],
        sku: 'FOCUS-LIGHT',
        status: 'enabled' as const,
        priceOverride: '40.00',
        delivery: { source: 'product_default' as const },
      },
    ],
    confirmCombinations: false,
  };
}

async function createTwoVariantProduct(): Promise<ProductDetailResponse> {
  const product = { ...VARIANT_CORE, status: 'active' as const };
  const schema = twoVariantSchema();
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
  return (await response.json() as { product: ProductDetailResponse }).product;
}

function orderBody(
  items: Array<{ productId: string; variantId: string | null; quantity?: number }>,
  overrides: Record<string, unknown> = {},
) {
  return {
    customer: { name: 'Ada Lovelace', email: ' ADA@Example.test ' },
    items: items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity ?? 2,
    })),
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
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null }]),
      idempotencyKey: 'request-simple-0001',
      capability: CAPABILITY_A,
    });

    expect(order).toMatchObject({
      status: 'pending',
      items: [{
        position: 0,
        product: { id: product.id, name: 'Field Notes', variant: null },
        quantity: 2,
        unitPriceMinor: 2400,
        lineTotalMinor: 4800,
        currency: 'USD',
      }],
      totalMinor: 4800,
      currency: 'USD',
    });
    expect(order.paymentReference).toMatch(/^NP[a-f0-9]{32}$/);
    expect(order.items[0].id).toMatch(/^line_/);
    expect(await orderTableCounts()).toEqual([1, 1, 1, 1, 1, 1]);
    expect(await env.DB.prepare(
      'SELECT action, source, from_status FROM order_history',
    ).first()).toEqual({
      action: 'order_created',
      source: 'storefront',
      from_status: null,
    });
    const access = await env.DB.prepare(
      'SELECT capability_digest FROM order_access',
    ).first<{ capability_digest: string }>();
    expect(access?.capability_digest).toBe(await digestOrderCapability(CAPABILITY_A));
    expect(access?.capability_digest).not.toContain(CAPABILITY_A);

    expect(await readPrivateOrder({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      reference: order.reference,
      capability: CAPABILITY_A,
    })).toEqual(order);
    expect(await readPrivateOrder({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      reference: order.reference,
      capability: CAPABILITY_B,
    })).toBeNull();
    const identity = await getConsoleIdentity();
    const consoleOrders = await listConsoleOrders(env.DB, {
      storeId: BOOTSTRAP_STORE_ID,
      actor: { source: 'user', id: identity.userId },
      identity,
    }, {
      q: '',
      status: null,
      refund: null,
      limit: 25,
      cursor: null,
    });
    expect(consoleOrders.orders).toHaveLength(1);
    expect(JSON.stringify({ order, consoleOrders })).not.toMatch(/capability|accessTitle|accessInstructions|privateFileKey/);
  });

  it('accepts one simple Product and one enabled Variant in a single Order', async () => {
    const simple = await createSimple();
    const variantProduct = await createActiveVariant();
    const variant = variantProduct.variants[0];
    const order = await createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([
        { productId: simple.id, variantId: null, quantity: 2 },
        { productId: variantProduct.id, variantId: variant.id, quantity: 3 },
      ]),
      idempotencyKey: 'request-multi-0001',
      capability: CAPABILITY_A,
    });
    expect(order.items).toHaveLength(2);
    expect(order.items[0]).toMatchObject({
      position: 0,
      product: { id: simple.id, variant: null },
      quantity: 2,
      unitPriceMinor: 2400,
      lineTotalMinor: 4800,
    });
    expect(order.items[1]).toMatchObject({
      position: 1,
      product: {
        id: variantProduct.id,
        variant: {
          id: variant.id,
          sku: variant.sku,
          selectedOptions: [{ groupName: 'Theme', valueLabel: 'Dark' }],
        },
      },
      quantity: 3,
      unitPriceMinor: 3600,
      lineTotalMinor: 10800,
    });
    expect(order.totalMinor).toBe(15600);
    expect(await env.DB.prepare(
      'SELECT position, access_title FROM order_lines ORDER BY position',
    ).all<{ position: number; access_title: string }>()).toMatchObject({
      results: [
        { position: 0, access_title: SIMPLE_CORE.delivery.accessTitle },
        { position: 1, access_title: VARIANT_CORE.delivery.accessTitle },
      ],
    });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_lines').first<number>('count')).toBe(2);
  });

  it('uses enabled Variant selection and rejects missing, disabled, or mismatched selection without writes', async () => {
    const product = await createActiveVariant();
    const variant = product.variants[0];
    const order = await createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: variant.id, quantity: 3 }]),
      idempotencyKey: 'request-variant-0001',
      capability: CAPABILITY_A,
    });
    expect(order).toMatchObject({
      items: [{
        product: {
          id: product.id,
          variant: {
            id: variant.id,
            sku: variant.sku,
            selectedOptions: [{ groupName: 'Theme', valueLabel: 'Dark' }],
          },
        },
        unitPriceMinor: 3600,
        lineTotalMinor: 10800,
      }],
      totalMinor: 10800,
    });

    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null }]),
      idempotencyKey: 'request-variant-0002',
      capability: CAPABILITY_B,
    })).rejects.toMatchObject({ code: 'variant_not_found' });
    await env.DB.prepare(
      "UPDATE product_variants SET status='disabled', current_schema=0 WHERE id=?",
    ).bind(variant.id).run();
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: variant.id }]),
      idempotencyKey: 'request-variant-0003',
      capability: CAPABILITY_B,
    })).rejects.toMatchObject({ code: 'variant_not_found' });
    expect(await orderTableCounts()).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('reuses normalized Customer identity, updates the latest name, and keeps historic snapshots immutable', async () => {
    const product = await createSimple();
    const first = await createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null, quantity: 1 }]),
      idempotencyKey: 'request-customer-0001',
      capability: CAPABILITY_A,
    });
    await createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: {
        ...orderBody([{ productId: product.id, variantId: null, quantity: 1 }]),
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
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null, quantity: 1 }]),
      idempotencyKey: 'request-customer-0001',
      capability: CAPABILITY_A,
    });
    expect(replay.reference).toBe(first.reference);
    expect(replay.items).toEqual(first.items);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count')).toBe(2);
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null, quantity: 1 }]),
      idempotencyKey: 'request-customer-0001',
      capability: CAPABILITY_B,
    })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('rolls back the complete aggregate when the captured Product revision changes before assertion', async () => {
    const product = await createSimple();
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null }]),
      idempotencyKey: 'request-conflict-0001',
      capability: CAPABILITY_A,
      resolveCatalogSnapshots: async (input) => {
        const resolutions = await resolveOrderItemCatalogSnapshots(input);
        await env.DB.prepare(
          "UPDATE products SET base_price_minor=9999, revision=revision+1 WHERE id=?",
        ).bind(product.id).run();
        return resolutions;
      },
    })).rejects.toMatchObject({ code: 'catalog_revision_conflict' });
    expect(await orderTableCounts()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('rolls back when a non-first Product changes between resolution and commit', async () => {
    const first = await createSimple();
    const second = await createActiveVariant();
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([
        { productId: first.id, variantId: null },
        { productId: second.id, variantId: second.variants[0].id },
      ]),
      idempotencyKey: 'request-conflict-0002',
      capability: CAPABILITY_A,
      resolveCatalogSnapshots: async (input) => {
        const resolutions = await resolveOrderItemCatalogSnapshots(input);
        await env.DB.prepare(
          "UPDATE products SET name='Stale', revision=revision+1 WHERE id=?",
        ).bind(second.id).run();
        return resolutions;
      },
    })).rejects.toMatchObject({ code: 'catalog_revision_conflict' });
    expect(await orderTableCounts()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('rejects a valid first Product plus inactive, cross-Store, or disabled second Product without Customer mutation', async () => {
    const first = await createSimple();
    const inactive = await createSimple('Inactive Notes');
    await env.DB.prepare("UPDATE products SET status='archived' WHERE id=?").bind(inactive.id).run();
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([
        { productId: first.id, variantId: null },
        { productId: inactive.id, variantId: null },
      ]),
      idempotencyKey: 'request-inactive-0001',
      capability: CAPABILITY_A,
    })).rejects.toMatchObject({ code: 'product_not_found' });

    await env.DB.prepare("INSERT INTO stores (id, slug, name) VALUES ('store_other', 'other', 'Other')").run();
    const foreign = await createSimple('Foreign Notes');
    await env.DB.prepare("UPDATE products SET store_id='store_other' WHERE id=?").bind(foreign.id).run();
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([
        { productId: first.id, variantId: null },
        { productId: foreign.id, variantId: null },
      ]),
      idempotencyKey: 'request-foreign-0001',
      capability: CAPABILITY_A,
    })).rejects.toMatchObject({ code: 'product_not_found' });

    const variantProduct = await createActiveVariant();
    await env.DB.prepare(
      "UPDATE product_variants SET status='disabled' WHERE id=?",
    ).bind(variantProduct.variants[0].id).run();
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([
        { productId: first.id, variantId: null },
        { productId: variantProduct.id, variantId: variantProduct.variants[0].id },
      ]),
      idempotencyKey: 'request-disabled-0001',
      capability: CAPABILITY_A,
    })).rejects.toMatchObject({ code: 'variant_not_found' });
    expect(await orderTableCounts()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('rejects mixed currency, empty or oversized items, duplicates, invalid quantity, and overflow', async () => {
    const first = await createSimple();
    const second = await createSimple('Euro Notes');
    await env.DB.prepare("UPDATE products SET currency='EUR' WHERE id=?").bind(second.id).run();
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([
        { productId: first.id, variantId: null },
        { productId: second.id, variantId: null },
      ]),
      idempotencyKey: 'request-currency-0001',
      capability: CAPABILITY_A,
    })).rejects.toMatchObject({ code: 'currency_mismatch' });

    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([]),
      idempotencyKey: 'request-empty-0001',
      capability: CAPABILITY_A,
    })).rejects.toMatchObject({ code: 'validation_failed' });

    const oversized = Array.from({ length: 11 }, (_, index) => ({
      productId: `prod_${index.toString().padStart(8, '0')}`,
      variantId: null,
      quantity: 1,
    }));
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody(oversized),
      idempotencyKey: 'request-oversize-0001',
      capability: CAPABILITY_A,
    })).rejects.toMatchObject({ code: 'validation_failed' });

    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([
        { productId: first.id, variantId: null },
        { productId: first.id, variantId: null },
      ]),
      idempotencyKey: 'request-duplicate-0001',
      capability: CAPABILITY_A,
    })).rejects.toMatchObject({ code: 'validation_failed' });

    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: first.id, variantId: null, quantity: 100 }]),
      idempotencyKey: 'request-invalid-0001',
      capability: CAPABILITY_A,
    })).rejects.toMatchObject({ code: 'validation_failed' });

    await env.DB.prepare('UPDATE products SET base_price_minor=? WHERE id=?')
      .bind(Number.MAX_SAFE_INTEGER, first.id).run();
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: first.id, variantId: null, quantity: 2 }]),
      idempotencyKey: 'request-overflow-0001',
      capability: CAPABILITY_A,
    })).rejects.toMatchObject({ code: 'money_out_of_range' });
    expect(await orderTableCounts()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('allows the same Product with two distinct enabled Variants', async () => {
    const product = await createTwoVariantProduct();
    const dark = product.variants.find((variant) => variant.sku === 'FOCUS-DARK');
    const light = product.variants.find((variant) => variant.sku === 'FOCUS-LIGHT');
    expect(dark && light).toBeTruthy();
    const order = await createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([
        { productId: product.id, variantId: dark!.id, quantity: 1 },
        { productId: product.id, variantId: light!.id, quantity: 2 },
      ]),
      idempotencyKey: 'request-two-variant-0001',
      capability: CAPABILITY_A,
    });
    expect(order.items.map((item) => item.product.variant?.sku)).toEqual(['FOCUS-DARK', 'FOCUS-LIGHT']);
    expect(order.totalMinor).toBe(3600 + 8000);
  });

  it('rejects out-of-range quantity before persistence and retains the purchased private-file snapshot', async () => {
    const product = await createSimple();
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null, quantity: 100 }]),
      idempotencyKey: 'request-invalid-qty-0001',
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
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null, quantity: 1 }]),
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

  it('replays the current aggregate after payment and refund, and keeps snapshots after catalog edits', async () => {
    const product = await createSimple();
    const variantProduct = await createActiveVariant();
    const variant = variantProduct.variants.find((row) => row.status === 'enabled');
    expect(variant).toBeTruthy();
    const created = await createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([
        { productId: product.id, variantId: null, quantity: 1 },
        { productId: variantProduct.id, variantId: variant!.id, quantity: 1 },
      ]),
      idempotencyKey: 'request-replay-0001',
      capability: CAPABILITY_A,
    });
    expect(created.items).toHaveLength(2);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?')
      .bind(created.reference).first<string>('id') as string;
    const ownerIdentity = await getConsoleIdentity();
    await markPaid({
      database: env.DB,
      context: {
        storeId: ownerIdentity.storeId,
        actor: { source: 'user', id: ownerIdentity.userId },
        identity: ownerIdentity,
      },
      orderId,
      body: { method: 'Bank transfer', reference: 'REPLAY-PAY-1' },
      idempotencyKey: 'pay-replay-00000001',
    });
    const customerId = await env.DB.prepare('SELECT customer_id FROM orders WHERE id=?')
      .bind(orderId).first<string>('customer_id');
    if (customerId === null) throw new Error('Expected the created Order to retain its Customer.');
    await createRefundRequest({
      database: env.DB,
      context: {
        storeId: BOOTSTRAP_STORE_ID,
        actor: { source: 'storefront', id: customerId },
        identity: { kind: 'customer', storeId: BOOTSTRAP_STORE_ID, customerId },
      },
      orderId,
      body: { reason: 'Need a refund' },
      idempotencyKey: 'refund-replay-00001',
    });
    await env.DB.prepare("UPDATE products SET name='Live rename', base_price_minor=1, revision=revision+1 WHERE id=?")
      .bind(product.id).run();

    const replay = await createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null, quantity: 9 }]),
      idempotencyKey: 'request-replay-0001',
      capability: CAPABILITY_A,
    });
    expect(replay.reference).toBe(created.reference);
    expect(replay.status).toBe('paid');
    expect(replay.items).toHaveLength(2);
    expect(replay.items[0].product.name).toBe('Field Notes');
    expect(replay.items[0].unitPriceMinor).toBe(2400);
    expect(replay.refundRequest).toMatchObject({ status: 'pending', reason: 'Need a refund' });
    await expect(createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null, quantity: 1 }]),
      idempotencyKey: 'request-replay-0001',
      capability: CAPABILITY_B,
    })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('creates on a populated schema5 database after 0006/0007 and reopens old and new private Orders', async () => {
    await resetCatalogThrough(5);
    const digest = await digestOrderCapability(CAPABILITY_B);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customers (id,store_id,name,email_normalized) VALUES ('cust_legacy','store_nexus','Ada Historic','ada@example.test')",
      ),
      env.DB.prepare(
        `INSERT INTO order_lines (
           id, store_id, order_id, product_id, product_name, variant_id, variant_sku,
           selected_options_json, quantity, unit_price_minor, line_total_minor, currency,
           access_title, access_instructions, private_file_key
         ) VALUES ('line_legacy','store_nexus','ord_legacy','prod_notes','Field Notes',NULL,NULL,'[]',1,2400,2400,'USD','Download Field Notes','Open the PDF',NULL)`,
      ),
      env.DB.prepare(
        `INSERT INTO orders (
           id, store_id, reference, customer_id, customer_name, customer_email_normalized,
           status, currency, total_minor, created_at
         ) VALUES ('ord_legacy','store_nexus','NX-0000000000000001','cust_legacy','Ada Historic','ada@example.test','pending_payment','USD',2400,'2026-01-01T10:00:00.000Z')`,
      ),
      env.DB.prepare(
        "INSERT INTO order_history (id, store_id, order_id, status, created_at) VALUES ('hist_legacy','store_nexus','ord_legacy','pending_payment','2026-01-01T10:00:00.100Z')",
      ),
      env.DB.prepare(
        'INSERT INTO order_access (id, store_id, order_id, capability_digest) VALUES (?,?,?,?)',
      ).bind('access_legacy', 'store_nexus', 'ord_legacy', digest),
      env.DB.prepare(
        `INSERT INTO order_idempotency (id, store_id, request_key, order_id, capability_digest)
         VALUES ('idem_legacy','store_nexus','legacy-request-01','ord_legacy',?)`,
      ).bind(digest),
    ]);
    await applyD1Migrations(env.DB, catalogMigrations.slice(5));

    const legacy = await readPrivateOrder({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      reference: 'NX-0000000000000001',
      capability: CAPABILITY_B,
    });
    expect(legacy).toMatchObject({
      reference: 'NX-0000000000000001',
      status: 'pending',
      items: [{ id: 'line_legacy', position: 0, product: { name: 'Field Notes', variant: null }, quantity: 1 }],
      totalMinor: 2400,
    });
    expect(legacy?.paymentReference).toMatch(/^NP/);

    const product = await createSimple();
    const created = await createOrder({
      database: env.DB,
      context: STOREFRONT_CONTEXT,
      body: orderBody([{ productId: product.id, variantId: null, quantity: 1 }]),
      idempotencyKey: 'request-after-migration-0001',
      capability: CAPABILITY_A,
    });
    expect(created.items[0].product.id).toBe(product.id);
    expect(await readPrivateOrder({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      reference: created.reference,
      capability: CAPABILITY_A,
    })).toEqual(created);
    expect(await readPrivateOrder({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      reference: 'NX-0000000000000001',
      capability: CAPABILITY_B,
    })).toMatchObject({ items: [{ id: 'line_legacy' }] });
    const httpLegacy = await workerRequest('/api/storefront/orders/NX-0000000000000001', {
      headers: { 'X-Nexus-Order-Capability': CAPABILITY_B },
    });
    expect(httpLegacy.status).toBe(200);
    expect(await httpLegacy.json()).toMatchObject({
      reference: 'NX-0000000000000001',
      items: [{ id: 'line_legacy', position: 0 }],
      paymentNextStep: 'Payment instructions will be provided separately.',
    });
  });
});
