import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '../../src/catalog/catalog-types';
import { resetCatalog, VARIANT_CORE, oneVariantSchema, workerRequest } from '../support/catalog-test-env';

beforeEach(resetCatalog);

async function createVariantProduct(): Promise<ProductDetailResponse> {
  const schema = oneVariantSchema();
  const preview = await workerRequest('/api/console/products/schema/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: null, productSlug: 'focus-pack', product: VARIANT_CORE, schema }),
  });
  const hash = (await preview.json() as { previewHash: string }).previewHash;
  const response = await workerRequest('/api/console/products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: VARIANT_CORE, schema, previewHash: hash }),
  });
  return (await response.json() as { product: ProductDetailResponse }).product;
}

async function previewAndApply(product: ProductDetailResponse, schema: unknown): Promise<ProductDetailResponse> {
  const preview = await workerRequest('/api/console/products/schema/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': `"${product.revision}"` },
    body: JSON.stringify({ productId: product.id, productSlug: product.slug, product: VARIANT_CORE, schema }),
  });
  expect(preview.status, JSON.stringify(await preview.clone().json())).toBe(200);
  const previewBody = await preview.json() as { previewHash: string };
  const applied = await workerRequest(`/api/console/products/${product.id}/schema`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': `"${product.revision}"` },
    body: JSON.stringify({ product: VARIANT_CORE, schema, previewHash: previewBody.previewHash }),
  });
  expect(applied.status, JSON.stringify(await applied.clone().json())).toBe(200);
  return (await applied.json() as { product: ProductDetailResponse }).product;
}

describe('schema regeneration lifecycle', () => {
  it('disables obsolete combinations and reactivates the same historical Variant ID', async () => {
    let product = await createVariantProduct();
    const structuralPayload = await workerRequest(`/api/console/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' },
      body: JSON.stringify({
        product: VARIANT_CORE,
        optionLabels: {
          groups: product.optionGroups.map((optionGroup) => ({
            id: optionGroup.id,
            name: optionGroup.name,
            participating: optionGroup.participating,
            values: optionGroup.values.map((value) => ({ id: value.id, label: value.label })),
          })),
        },
        variantEdits: product.variants.map((variant) => ({
          id: variant.id, sku: variant.sku, status: variant.status, priceOverride: null, delivery: { source: 'product_default' },
        })),
      }),
    });
    expect(structuralPayload.status).toBe(422);
    expect(await structuralPayload.json()).toMatchObject({
      error: { code: 'schema_preview_required', fields: [{ code: 'schema_preview_required' }] },
    });
    const fingerprintBefore = await env.DB.prepare('SELECT import_fingerprint FROM products WHERE id=?')
      .bind(product.id).first<string>('import_fingerprint');
    const equivalentUpdate = await workerRequest(`/api/console/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' },
      body: JSON.stringify({
        product: VARIANT_CORE,
        optionLabels: {
          groups: product.optionGroups.map((optionGroup) => ({
            id: optionGroup.id,
            name: optionGroup.name,
            values: optionGroup.values.map((value) => ({ id: value.id, label: value.label })),
          })),
        },
        variantEdits: product.variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          status: variant.status,
          priceOverride: variant.priceOverrideMinor === null ? null : String(variant.priceOverrideMinor / 100),
          delivery: { source: 'product_default' },
        })),
      }),
    });
    product = (await equivalentUpdate.json() as { product: ProductDetailResponse }).product;
    const fingerprintAfter = await env.DB.prepare('SELECT import_fingerprint FROM products WHERE id=?')
      .bind(product.id).first<string>('import_fingerprint');
    expect(fingerprintAfter).toBe(fingerprintBefore);
    const group = product.optionGroups[0];
    const dark = group.values[0];
    const darkVariant = product.variants[0];
    const twoValueSchema = {
      groups: [{ draftRef: 'g', id: group.id, name: group.name, position: 0, participating: true, values: [
        { draftRef: 'dark', id: dark.id, label: dark.label, position: 0 },
        { draftRef: 'light', id: null, label: 'Light', position: 1 },
      ] }],
      rows: [
        { id: darkVariant.id, selectedValueRefs: ['dark'], sku: darkVariant.sku, status: 'enabled', priceOverride: null, delivery: { source: 'product_default' } },
        { id: null, selectedValueRefs: ['light'], sku: 'FOCUS-LIGHT', status: 'enabled', priceOverride: null, delivery: { source: 'product_default' } },
      ],
      confirmCombinations: false,
    };
    product = await previewAndApply(product, twoValueSchema);
    const lightVariant = product.variants.find((variant) => variant.sku === 'FOCUS-LIGHT');
    const lightValue = product.optionGroups[0].values.find((value) => value.label === 'Light');
    if (!lightVariant || !lightValue) throw new Error('Expected regenerated Light identities.');
    expect(lightVariant).toBeDefined();
    expect(lightValue).toBeDefined();

    const oneValueAgain = {
      groups: [{ draftRef: 'g', id: group.id, name: 'Theme renamed', position: 0, participating: true, values: [
        { draftRef: 'dark', id: dark.id, label: 'Dark renamed', position: 0 },
      ] }],
      rows: [{ id: darkVariant.id, selectedValueRefs: ['dark'], sku: darkVariant.sku, status: 'enabled', priceOverride: null, delivery: { source: 'product_default' } }],
      confirmCombinations: false,
    };
    product = await previewAndApply(product, oneValueAgain);
    expect(await env.DB.prepare('SELECT current_schema FROM product_variants WHERE id=?').bind(lightVariant.id).first<number>('current_schema')).toBe(0);

    const restore = {
      groups: [{ draftRef: 'g', id: group.id, name: 'Theme renamed', position: 0, participating: true, values: [
        { draftRef: 'dark', id: dark.id, label: 'Dark renamed', position: 0 },
        { draftRef: 'light', id: lightValue.id, label: 'Light', position: 1 },
      ] }],
      rows: [
        { id: darkVariant.id, selectedValueRefs: ['dark'], sku: darkVariant.sku, status: 'enabled', priceOverride: null, delivery: { source: 'product_default' } },
        { id: lightVariant.id, selectedValueRefs: ['light'], sku: 'FOCUS-LIGHT', status: 'enabled', priceOverride: null, delivery: { source: 'product_default' } },
      ],
      confirmCombinations: false,
    };
    product = await previewAndApply(product, restore);
    expect(product.variants.find((variant) => variant.sku === 'FOCUS-LIGHT')?.id).toBe(lightVariant.id);
  });
});
