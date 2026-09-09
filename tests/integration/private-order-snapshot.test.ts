import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '../../src/catalog/catalog-types';
import { resolveOrderItemCatalogSnapshots } from '../../src/catalog/private-order-snapshot';
import { BOOTSTRAP_STORE_ID } from '../../src/catalog/catalog-read';
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
    const product = await createSimple();
    const [resolution] = await resolveOrderItemCatalogSnapshots({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      items: [{ productId: product.id, variantId: null }],
    });
    const snapshot = resolution.snapshot;
    expect(resolution.productRevision).toBe(product.revision);
    expect(snapshot).toMatchObject({ productId: product.id, variantId: null, unitPriceMinor: 2400, accessTitle: SIMPLE_CORE.delivery.accessTitle });
    await env.DB.prepare("UPDATE products SET name='Changed', base_price_minor=9999, delivery_access_title='Changed' WHERE id=?").bind(product.id).run();
    expect(snapshot).toMatchObject({ productName: 'Field Notes', unitPriceMinor: 2400, accessTitle: SIMPLE_CORE.delivery.accessTitle });
    await expect(resolveOrderItemCatalogSnapshots({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      items: [{ productId: product.id, variantId: 'wrong' }],
    })).rejects.toMatchObject({ code: 'variant_not_found' });
  });

  it('resolves Variant default and complete override, and rejects missing or disabled selection', async () => {
    let product = await createActiveVariant();
    const variant = product.variants[0];
    await expect(resolveOrderItemCatalogSnapshots({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      items: [{ productId: product.id, variantId: null }],
    })).rejects.toMatchObject({ code: 'variant_not_found' });
    const [inherited] = await resolveOrderItemCatalogSnapshots({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      items: [{ productId: product.id, variantId: variant.id }],
    });
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
    const [overridden] = await resolveOrderItemCatalogSnapshots({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      items: [{ productId: product.id, variantId: variant.id }],
    });
    expect(overridden).toMatchObject({
      productRevision: product.revision,
      snapshot: { unitPriceMinor: 4000, accessTitle: 'Private Variant', accessInstructions: 'Open Variant' },
    });

    await env.DB.prepare("UPDATE product_variants SET current_schema=0, status='disabled' WHERE id=?").bind(variant.id).run();
    await expect(resolveOrderItemCatalogSnapshots({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      items: [{ productId: product.id, variantId: variant.id }],
    })).rejects.toMatchObject({ code: 'variant_not_found' });
  });

  it('batches simple and variant selections in request order', async () => {
    const simple = await createSimple();
    const variantProduct = await createActiveVariant();
    const variant = variantProduct.variants[0];
    const resolutions = await resolveOrderItemCatalogSnapshots({
      database: env.DB,
      storeId: BOOTSTRAP_STORE_ID,
      items: [
        { productId: simple.id, variantId: null },
        { productId: variantProduct.id, variantId: variant.id },
      ],
    });
    expect(resolutions.map((resolution) => resolution.snapshot.productId)).toEqual([simple.id, variantProduct.id]);
    expect(resolutions[0].snapshot.unitPriceMinor).toBe(2400);
    expect(resolutions[1].snapshot.variantId).toBe(variant.id);
    expect(resolutions[1].snapshot.accessTitle).toBe(VARIANT_CORE.delivery.accessTitle);
  });
});
