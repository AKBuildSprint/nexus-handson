import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { preflightExactMatch, type ImportWritePlan } from '../../src/import/exact-match';
import { executeImportWrite } from '../../src/import/import-write';
import { parseCsvBytes } from '../../src/import/csv-parser';
import { validateCsvRows } from '../../src/import/csv-validator';
import template from '../fixtures/import/unified-template.csv?raw';
import { resetCatalog } from '../support/catalog-test-env';

function validation(source = template) {
  return validateCsvRows(parseCsvBytes(new TextEncoder().encode(source)).rows);
}

async function commit(plan: ImportWritePlan, suffix: string) {
  return executeImportWrite({
    database: env.DB,
    plan,
    importId: `imp_exact_${suffix}`,
    filename: 'unified-template.csv',
    sizeBytes: new TextEncoder().encode(template).byteLength,
    privateObjectKey: `imports/exact-${suffix}.csv`,
  });
}

describe('additive CSV exact match', () => {
  beforeEach(resetCatalog);

  it('plans all-new simple and Variant records, then re-imports with zero additions', async () => {
    const first = await preflightExactMatch(env.DB, validation());
    expect(first.products).toHaveLength(2);
    expect(first.groups).toHaveLength(2);
    expect(first.values).toHaveLength(3);
    expect(first.variants).toHaveLength(2);
    expect(first.memberships).toHaveLength(4);
    const firstResult = await commit(first, 'first');
    expect(firstResult.counts).toEqual({ added: 3, duplicate: 0, rejected: 0 });

    const before = await env.DB.prepare("SELECT revision, import_fingerprint FROM products WHERE slug='focus-pack'").first<{ revision: number; import_fingerprint: string }>();
    const second = await preflightExactMatch(env.DB, validation());
    expect(second.variants).toHaveLength(0);
    const secondResult = await commit(second, 'second');
    expect(secondResult.counts).toEqual({ added: 0, duplicate: 3, rejected: 0 });
    const after = await env.DB.prepare("SELECT revision, import_fingerprint FROM products WHERE slug='focus-pack'").first<{ revision: number; import_fingerprint: string }>();
    expect(after).toEqual(before);
  });

  it('adds a missing new SKU and combination under an otherwise exact Product/schema', async () => {
    await commit(await preflightExactMatch(env.DB, validation()), 'seed');
    const light = await env.DB.prepare("SELECT id, product_id FROM product_variants WHERE sku='FOCUS-LIGHT'").first<{ id: string; product_id: string }>();
    if (!light) throw new Error('Seed Variant was not created.');
    await env.DB.batch([
      env.DB.prepare("UPDATE product_variants SET status='disabled', current_schema=0 WHERE id=?").bind(light.id),
      env.DB.prepare('DELETE FROM product_variant_values WHERE variant_id=?').bind(light.id),
      env.DB.prepare('DELETE FROM product_variants WHERE id=?').bind(light.id),
    ]);
    const additive = await preflightExactMatch(env.DB, validation());
    expect(additive.variants.map((variant) => variant.sku)).toEqual(['FOCUS-LIGHT']);
    const result = await commit(additive, 'additive');
    expect(result.counts).toEqual({ added: 1, duplicate: 2, rejected: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS count FROM product_variants WHERE product_id=? AND current_schema=1").bind(light.product_id).first<number>('count')).toBe(2);
  });

  it('rejects SKU/combination reassignment without writing an update', async () => {
    await commit(await preflightExactMatch(env.DB, validation()), 'identity-seed');
    const swapped = template
      .replace('FOCUS-DARK,,enabled,Theme,Dark', 'TEMP-SKU,,enabled,Theme,Dark')
      .replace('FOCUS-LIGHT,,enabled,Theme,Light', 'FOCUS-DARK,,enabled,Theme,Light')
      .replace('TEMP-SKU,,enabled,Theme,Dark', 'FOCUS-LIGHT,,enabled,Theme,Dark');
    const conflict = await preflightExactMatch(env.DB, validation(swapped));
    expect(conflict.resultGroups.find((group) => group.productSlug === 'focus-pack')).toMatchObject({ outcome: 'rejected' });
    expect(conflict.variants).toHaveLength(0);
  });
});
