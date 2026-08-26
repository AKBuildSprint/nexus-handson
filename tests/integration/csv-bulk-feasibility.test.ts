import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worstCaseFixture from '../fixtures/import/worst-case-500-rows.csv?raw';
import { parseCsvBytes } from '../../src/import/csv-parser';
import {
  BulkFeasibilityError,
  resetFeasibilitySchema,
  runBulkFeasibility,
} from '../support/csv-bulk-feasibility';

const rows = parseCsvBytes(new TextEncoder().encode(worstCaseFixture)).rows;

async function tableCount(table: string): Promise<number> {
  const result = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<number>('count');
  return result ?? 0;
}

function fixtureCombinationKey(serial: string): string {
  return Array.from(
    { length: 5 },
    (_unused, optionIndex) =>
      `fixture_group_${serial}_${optionIndex + 1}:fixture_value_${serial}_${optionIndex + 1}`,
  ).join('|');
}

async function seedMatchedProduct(
  rowNumber: number,
  revision: number,
  importFingerprint: string,
  duplicateOnly: boolean,
): Promise<void> {
  const serial = String(rowNumber).padStart(4, '0');
  const row = rows[rowNumber - 1];
  const productId = `existing_product_bulk_${serial}`;
  const statements = [
    env.DB.prepare(
      `INSERT INTO products (id, slug, revision, import_fingerprint) VALUES (?, ?, ?, ?)`,
    ).bind(productId, row.product_slug, revision, importFingerprint),
  ];

  if (duplicateOnly) {
    const valueIds: string[] = [];
    for (let option = 1; option <= 5; option += 1) {
      const groupId = `fixture_group_${serial}_${option}`;
      const valueId = `fixture_value_${serial}_${option}`;
      statements.push(
        env.DB.prepare(`INSERT INTO product_option_groups (id, product_id, name) VALUES (?, ?, ?)`).bind(
          groupId,
          productId,
          row[`option_${option}_name` as keyof typeof row],
        ),
        env.DB.prepare(`INSERT INTO product_option_values (id, group_id, label) VALUES (?, ?, ?)`).bind(
          valueId,
          groupId,
          row[`option_${option}_value` as keyof typeof row],
        ),
      );
      valueIds.push(valueId);
    }

    const variantId = `fixture_variant_${serial}`;
    statements.push(
      env.DB.prepare(
        `INSERT INTO product_variants (id, product_id, sku, combination_key) VALUES (?, ?, ?, ?)`,
      ).bind(variantId, productId, row.variant_sku, fixtureCombinationKey(serial)),
    );
    valueIds.forEach((valueId, index) => {
      statements.push(
        env.DB.prepare(
          `INSERT INTO product_variant_values (id, variant_id, value_id) VALUES (?, ?, ?)`,
        ).bind(`fixture_membership_${serial}_${index + 1}`, variantId, valueId),
      );
    });
  }

  await env.DB.batch(statements);
}

describe('exact-45 D1 JSON bulk feasibility', () => {
  beforeEach(async () => {
    await resetFeasibilitySchema(env.DB);
  });

  it('writes 8,501 relational records using four lookups and 41 one-binding writes', async () => {
    const result = await runBulkFeasibility(env.DB, rows);

    expect(result.statementCount).toBe(45);
    expect(result.bindingCounts).toHaveLength(45);
    expect(result.bindingCounts.every((count) => count === 1)).toBe(true);
    expect(Math.max(...result.parameterByteLengths)).toBeLessThan(1_000_000);
    expect(result.chunkSizes).toEqual({
      products: 100,
      groups: 250,
      values: 250,
      variants: 100,
      memberships: 250,
    });

    const counts = await Promise.all([
      tableCount('products'),
      tableCount('product_option_groups'),
      tableCount('product_option_values'),
      tableCount('product_variants'),
      tableCount('product_variant_values'),
      tableCount('imports'),
    ]);
    expect(counts).toEqual([500, 2_500, 2_500, 500, 2_500, 1]);
    expect(counts.reduce((total, count) => total + count, 0)).toBe(8_501);
  });


  it('increments a matched Product with a new Variant and preserves a duplicate-only Product poststate', async () => {
    await seedMatchedProduct(1, 7, 'pre:bulk-0001', false);
    await seedMatchedProduct(2, 10, 'duplicate:bulk-0002', true);

    const result = await runBulkFeasibility(env.DB, rows);

    expect(result.statementCount).toBe(45);
    expect(result.bindingCounts).toHaveLength(45);
    expect(result.bindingCounts.every((count) => count === 1)).toBe(true);
    const poststates = await env.DB.prepare(
      `SELECT slug, revision, import_fingerprint
         FROM products
        WHERE slug IN ('bulk-0001', 'bulk-0002')
        ORDER BY slug`,
    ).all<{ slug: string; revision: number; import_fingerprint: string }>();
    expect(poststates.results).toEqual([
      { slug: 'bulk-0001', revision: 8, import_fingerprint: 'post:bulk-0001' },
      { slug: 'bulk-0002', revision: 10, import_fingerprint: 'duplicate:bulk-0002' },
    ]);

    const counts = await Promise.all([
      tableCount('products'),
      tableCount('product_option_groups'),
      tableCount('product_option_values'),
      tableCount('product_variants'),
      tableCount('product_variant_values'),
      tableCount('imports'),
    ]);
    expect(counts).toEqual([500, 2_500, 2_500, 500, 2_500, 1]);
  });
  it('uses counted statement 45 to roll back all fixture writes after revision/fingerprint drift', async () => {
    await seedMatchedProduct(1, 7, 'pre:bulk-0001', false);

    let observedError: BulkFeasibilityError | null = null;
    try {
      await runBulkFeasibility(env.DB, rows, async (matchedProducts) => {
        expect(matchedProducts).toEqual([
          {
            id: 'existing_product_bulk_0001',
            slug: 'bulk-0001',
            revision: 7,
            import_fingerprint: 'pre:bulk-0001',
          },
        ]);
        await env.DB.prepare(
          `UPDATE products SET revision = ?, import_fingerprint = ? WHERE id = ?`,
        )
          .bind(8, 'editor-drift', 'existing_product_bulk_0001')
          .run();
      });
    } catch (error) {
      observedError = error as BulkFeasibilityError;
    }

    expect(observedError).toBeInstanceOf(BulkFeasibilityError);
    expect(observedError?.statementCount).toBe(45);
    expect(observedError?.bindingCounts).toHaveLength(45);
    expect(observedError?.bindingCounts.every((count) => count === 1)).toBe(true);
    const underlyingCause = observedError?.cause;
    const causeMessage = underlyingCause instanceof Error ? underlyingCause.message : String(underlyingCause);
    expect(causeMessage).toMatch(/NOT NULL constraint failed:\s*imports\.id/i);

    const survivingProduct = await env.DB.prepare(
      `SELECT id, revision, import_fingerprint FROM products WHERE slug = ?`,
    )
      .bind('bulk-0001')
      .first<{ id: string; revision: number; import_fingerprint: string }>();
    expect(survivingProduct).toEqual({
      id: 'existing_product_bulk_0001',
      revision: 8,
      import_fingerprint: 'editor-drift',
    });

    const fixtureResidue = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS count FROM products WHERE id LIKE 'fixture_%'`).first<number>('count'),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM product_option_groups WHERE id LIKE 'fixture_%'`).first<number>('count'),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM product_option_values WHERE id LIKE 'fixture_%'`).first<number>('count'),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM product_variants WHERE id LIKE 'fixture_%'`).first<number>('count'),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM product_variant_values WHERE id LIKE 'fixture_%'`).first<number>('count'),
      tableCount('imports'),
    ]);
    expect(fixtureResidue).toEqual([0, 0, 0, 0, 0, 0]);
    expect(await tableCount('products')).toBe(1);
  });
});
