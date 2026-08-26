import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetCatalog, SIMPLE_CORE, VARIANT_CORE, oneVariantSchema, workerRequest } from '../support/catalog-test-env';

beforeEach(resetCatalog);

async function create(body: unknown) {
  return workerRequest('/api/console/products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}

describe('public catalog allow-list', () => {
  it('returns only active purchasable data and recursively excludes private vocabulary', async () => {
    await create({ product: SIMPLE_CORE, schema: null, previewHash: null });
    const schema = oneVariantSchema();
    const activeVariantCore = { ...VARIANT_CORE, status: 'active' as const };
    const preview = await workerRequest('/api/console/products/schema/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: null, productSlug: 'focus-pack', product: activeVariantCore, schema }),
    });
    const hash = (await preview.json() as { previewHash: string }).previewHash;
    await create({ product: activeVariantCore, schema, previewHash: hash });
    await env.DB.batch(Array.from({ length: 12 }, (_, index) => env.DB.prepare(
      `INSERT INTO products
         (id,store_id,slug,name,status,product_type,currency,base_price_minor,public_description,
          delivery_access_title,delivery_access_instructions)
       VALUES (?,'store_nexus',?,?,'active','simple','USD',100,'','Private','Private')`,
    ).bind(`bulk-public-${index}`, `bulk-public-${index}`, `Bulk Public ${index}`)));

    const response = await workerRequest('/api/storefront/products');
    const catalog = await response.json() as { products: Array<{ slug: string; variants: unknown[] }> };
    expect(response.status).toBe(200);
    expect(new Set(catalog.products.map((product) => product.slug))).toEqual(new Set([
      'focus-pack', 'field-notes', ...Array.from({ length: 12 }, (_, index) => `bulk-public-${index}`),
    ]));
    expect(catalog.products.find((product) => product.slug === 'field-notes')?.variants).toEqual([]);
    expect(allKeys(catalog).filter((key) => /^(access|delivery|file|filename|storage|r2|bucket|import)/i.test(key))).toEqual([]);
  });
});
