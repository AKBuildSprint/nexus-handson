import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '../../src/catalog/catalog-types';
import { createOrderItemCatalogSnapshotResolver } from '../../src/catalog/private-order-snapshot';
import { env } from 'cloudflare:test';
import { resetCatalog, SIMPLE_CORE, VARIANT_CORE, oneVariantSchema, workerRequest } from '../support/catalog-test-env';

beforeEach(resetCatalog);

async function createSimple(): Promise<ProductDetailResponse> {
  const response = await workerRequest('/api/console/products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
  });
  return (await response.json() as { product: ProductDetailResponse }).product;
}

async function createActiveVariant(): Promise<ProductDetailResponse> {
  const product = { ...VARIANT_CORE, status: 'active' as const };
  const schema = oneVariantSchema();
  const preview = await workerRequest('/api/console/products/schema/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: null, productSlug: 'focus-pack', product, schema }),
  });
  const hash = (await preview.json() as { previewHash: string }).previewHash;
  const created = await workerRequest('/api/console/products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product, schema, previewHash: hash }),
  });
  return (await created.json() as { product: ProductDetailResponse }).product;
}

describe('private Order item snapshot resolver', () => {
  it('resolves simple Product defaults and returns an immutable copied value', async () => {
    const resolveOrderItemCatalogSnapshot = createOrderItemCatalogSnapshotResolver(env.DB);
    const product = await createSimple();
    const resolution = await resolveOrderItemCatalogSnapshot({ productId: product.id, variantId: null });
    const snapshot = resolution.snapshot;
    expect(resolution.productRevision).toBe(product.revision);
    expect(snapshot).toMatchObject({ productId: product.id, variantId: null, unitPriceMinor: 2400, accessTitle: SIMPLE_CORE.delivery.accessTitle });
    await env.DB.prepare("UPDATE products SET name='Changed', base_price_minor=9999, delivery_access_title='Changed' WHERE id=?").bind(product.id).run();
    expect(snapshot).toMatchObject({ productName: 'Field Notes', unitPriceMinor: 2400, accessTitle: SIMPLE_CORE.delivery.accessTitle });
    await expect(resolveOrderItemCatalogSnapshot({ productId: product.id, variantId: 'wrong' })).rejects.toMatchObject({ code: 'variant_not_found' });
  });

  it('resolves Variant default and complete override, and rejects missing or disabled selection', async () => {
    const resolveOrderItemCatalogSnapshot = createOrderItemCatalogSnapshotResolver(env.DB);
    let product = await createActiveVariant();
    const variant = product.variants[0];
    await expect(resolveOrderItemCatalogSnapshot({ productId: product.id, variantId: null })).rejects.toMatchObject({ code: 'variant_not_found' });
    const inherited = await resolveOrderItemCatalogSnapshot({ productId: product.id, variantId: variant.id });
    expect(inherited).toMatchObject({
      productRevision: product.revision,
      snapshot: {
        variantSku: variant.sku,
        selectedOptions: [{ groupName: 'Theme', valueLabel: 'Dark' }],
        unitPriceMinor: 3600,
      },
    });

    const update = {
      product: { ...VARIANT_CORE, status: 'active' },
      optionLabels: { groups: product.optionGroups.map((group) => ({ id: group.id, name: group.name, values: group.values.map((value) => ({ id: value.id, label: value.label })) })) },
      variantEdits: [{ id: variant.id, sku: variant.sku, status: 'enabled', priceOverride: '40.00', delivery: { source: 'variant_override', accessTitle: 'Private Variant', accessInstructions: 'Open Variant' } }],
    };
    const updated = await workerRequest(`/api/console/products/${product.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify(update),
    });
    product = (await updated.json() as { product: ProductDetailResponse }).product;
    const overridden = await resolveOrderItemCatalogSnapshot({ productId: product.id, variantId: variant.id });
    expect(overridden).toMatchObject({
      productRevision: product.revision,
      snapshot: { unitPriceMinor: 4000, accessTitle: 'Private Variant', accessInstructions: 'Open Variant' },
    });

    await env.DB.prepare("UPDATE product_variants SET current_schema=0, status='disabled' WHERE id=?").bind(variant.id).run();
    await expect(resolveOrderItemCatalogSnapshot({ productId: product.id, variantId: variant.id })).rejects.toMatchObject({ code: 'variant_not_found' });
  });
});
