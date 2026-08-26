import type { CsvRow } from '../../src/shared/csv-contract';

const PRODUCT_CHUNK = 100;
const GROUP_CHUNK = 250;
const VALUE_CHUNK = 250;
const VARIANT_CHUNK = 100;
const MEMBERSHIP_CHUNK = 250;

interface ExistingProduct {
  id: string;
  slug: string;
  revision: number;
  import_fingerprint: string;
}

interface BulkRecord {
  id: string;
  [key: string]: string | number;
}

export interface BulkFeasibilityResult {
  statementCount: number;
  bindingCounts: number[];
  parameterByteLengths: number[];
  chunkSizes: {
    products: number;
    groups: number;
    values: number;
    variants: number;
    memberships: number;
  };
}

export class BulkFeasibilityError extends Error {
  readonly statementCount: number;
  readonly bindingCounts: number[];

  constructor(cause: unknown, statementCount: number, bindingCounts: number[]) {
    super(cause instanceof Error ? cause.message : 'The guarded D1 batch failed.', { cause });
    this.name = 'BulkFeasibilityError';
    this.statementCount = statementCount;
    this.bindingCounts = bindingCounts;
  }
}

function chunks<T>(records: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < records.length; offset += size) {
    result.push(records.slice(offset, offset + size));
  }
  return result;
}

export async function resetFeasibilitySchema(database: D1Database): Promise<void> {
  const statements = [
    'DROP TABLE IF EXISTS product_variant_values',
    'DROP TABLE IF EXISTS product_variants',
    'DROP TABLE IF EXISTS product_option_values',
    'DROP TABLE IF EXISTS product_option_groups',
    'DROP TABLE IF EXISTS imports',
    'DROP TABLE IF EXISTS products',
    `CREATE TABLE products (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      revision INTEGER NOT NULL,
      import_fingerprint TEXT NOT NULL
    )`,
    `CREATE TABLE product_option_groups (
      id TEXT PRIMARY KEY NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id),
      name TEXT NOT NULL
    )`,
    `CREATE TABLE product_option_values (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL REFERENCES product_option_groups(id),
      label TEXT NOT NULL
    )`,
    `CREATE TABLE product_variants (
      id TEXT PRIMARY KEY NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id),
      sku TEXT UNIQUE NOT NULL,
      combination_key TEXT NOT NULL
    )`,
    `CREATE TABLE product_variant_values (
      id TEXT PRIMARY KEY NOT NULL,
      variant_id TEXT NOT NULL REFERENCES product_variants(id),
      value_id TEXT NOT NULL REFERENCES product_option_values(id)
    )`,
    `CREATE TABLE imports (
      id TEXT PRIMARY KEY NOT NULL,
      filename TEXT NOT NULL
    )`,
  ];

  for (const statement of statements) {
    await database.prepare(statement).run();
  }
}

export async function runBulkFeasibility(
  database: D1Database,
  rows: CsvRow[],
  afterReads?: (matchedProducts: ExistingProduct[]) => Promise<void>,
): Promise<BulkFeasibilityResult> {
  if (rows.length !== 500) {
    throw new Error('The feasibility import requires exactly 500 data rows.');
  }

  const bindingCounts: number[] = [];
  const parameterByteLengths: number[] = [];
  let statementCount = 0;
  const executeLookup = async <T>(sql: string, input: unknown): Promise<T[]> => {
    const parameter = JSON.stringify(input);
    statementCount += 1;
    bindingCounts.push(1);
    parameterByteLengths.push(new TextEncoder().encode(parameter).byteLength);
    const result = await database.prepare(sql).bind(parameter).all<T>();
    return result.results;
  };

  const slugs = rows.map((row) => row.product_slug);
  const skus = rows.map((row) => row.variant_sku);
  const combinationKeys = rows.map((_row, rowIndex) => {
    const serial = String(rowIndex + 1).padStart(4, '0');
    return Array.from(
      { length: 5 },
      (_unused, optionIndex) =>
        `fixture_group_${serial}_${optionIndex + 1}:fixture_value_${serial}_${optionIndex + 1}`,
    ).join('|');
  });
  const matchedProducts = await executeLookup<ExistingProduct>(
    `SELECT id, slug, revision, import_fingerprint
       FROM products
      WHERE slug IN (SELECT json_extract(value, '$.key') FROM json_each(?))`,
    slugs.map((key) => ({ key })),
  );
  const matchedSkus = await executeLookup<{ product_id: string; identity: string }>(
    `SELECT product_id, sku AS identity FROM product_variants
      WHERE sku IN (SELECT json_extract(value, '$.key') FROM json_each(?))`,
    skus.map((key) => ({ key })),
  );
  const matchedCombinations = await executeLookup<{ product_id: string; identity: string }>(
    `SELECT product_id, combination_key AS identity FROM product_variants
      WHERE combination_key IN (SELECT json_extract(value, '$.key') FROM json_each(?))`,
    combinationKeys.map((key) => ({ key })),
  );
  await executeLookup<{ id: string }>(
    `SELECT product_option_groups.id
       FROM product_option_groups
       JOIN products ON products.id = product_option_groups.product_id
      WHERE products.slug IN (SELECT json_extract(value, '$.key') FROM json_each(?))`,
    slugs.map((key) => ({ key })),
  );

  if (afterReads) {
    await afterReads(matchedProducts);
  }

  const existingBySlug = new Map(matchedProducts.map((product) => [product.slug, product]));
  const skuIdentity = new Set(matchedSkus.map((variant) => `${variant.product_id}\u0000${variant.identity}`));
  const combinationIdentity = new Set(
    matchedCombinations.map((variant) => `${variant.product_id}\u0000${variant.identity}`),
  );
  const matchedPoststateById = new Map<string, { postRevision: number; postImportFingerprint: string }>();
  const products: BulkRecord[] = [];
  const groups: BulkRecord[] = [];
  const values: BulkRecord[] = [];
  const variants: BulkRecord[] = [];
  const memberships: BulkRecord[] = [];

  rows.forEach((row, rowIndex) => {
    const serial = String(rowIndex + 1).padStart(4, '0');
    const existing = existingBySlug.get(row.product_slug);
    const productId = existing?.id ?? `fixture_product_${serial}`;
    const duplicateOnly =
      existing !== undefined &&
      skuIdentity.has(`${existing.id}\u0000${row.variant_sku}`) &&
      combinationIdentity.has(`${existing.id}\u0000${combinationKeys[rowIndex]}`);
    const postRevision = existing ? (duplicateOnly ? existing.revision : existing.revision + 1) : 1;
    const postImportFingerprint = existing && duplicateOnly ? existing.import_fingerprint : `post:${row.product_slug}`;
    if (existing) {
      matchedPoststateById.set(existing.id, { postRevision, postImportFingerprint });
    }
    products.push({
      id: existing
        ? JSON.stringify({
            id: existing.id,
            preRevision: existing.revision,
            preFingerprint: existing.import_fingerprint,
          })
        : productId,
      slug: row.product_slug,
      revision: postRevision,
      importFingerprint: postImportFingerprint,
    });

    if (duplicateOnly) return;

    const valueIds: string[] = [];
    for (let option = 1; option <= 5; option += 1) {
      const groupId = `fixture_group_${serial}_${option}`;
      const valueId = `fixture_value_${serial}_${option}`;
      groups.push({ id: groupId, productId, name: row[`option_${option}_name` as keyof CsvRow] });
      values.push({ id: valueId, groupId, label: row[`option_${option}_value` as keyof CsvRow] });
      valueIds.push(valueId);
    }

    const variantId = `fixture_variant_${serial}`;
    variants.push({
      id: variantId,
      productId,
      sku: row.variant_sku,
      combinationKey: combinationKeys[rowIndex],
    });
    valueIds.forEach((valueId, index) => {
      memberships.push({ id: `fixture_membership_${serial}_${index + 1}`, variantId, valueId });
    });
  });

  const writeStatements: D1PreparedStatement[] = [];
  const prepareJsonWrite = (sql: string, records: unknown) => {
    const parameter = JSON.stringify(records);
    statementCount += 1;
    bindingCounts.push(1);
    parameterByteLengths.push(new TextEncoder().encode(parameter).byteLength);
    writeStatements.push(database.prepare(sql).bind(parameter));
  };

  for (const chunk of chunks(products, PRODUCT_CHUNK)) {
    prepareJsonWrite(
      `INSERT INTO products (id, slug, revision, import_fingerprint)
       SELECT json_extract(value, '$.id'),
              json_extract(value, '$.slug'),
              json_extract(value, '$.revision'),
              json_extract(value, '$.importFingerprint')
         FROM json_each(?)
        WHERE true
       ON CONFLICT(slug) DO UPDATE SET
              revision = excluded.revision,
              import_fingerprint = excluded.import_fingerprint
        WHERE products.id = json_extract(excluded.id, '$.id')
          AND products.revision = json_extract(excluded.id, '$.preRevision')
          AND products.import_fingerprint = json_extract(excluded.id, '$.preFingerprint')`,
      chunk,
    );
  }
  for (const chunk of chunks(groups, GROUP_CHUNK)) {
    prepareJsonWrite(
      `INSERT INTO product_option_groups (id, product_id, name)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.productId'), json_extract(value, '$.name')
         FROM json_each(?)`,
      chunk,
    );
  }
  for (const chunk of chunks(values, VALUE_CHUNK)) {
    prepareJsonWrite(
      `INSERT INTO product_option_values (id, group_id, label)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.groupId'), json_extract(value, '$.label')
         FROM json_each(?)`,
      chunk,
    );
  }
  for (const chunk of chunks(variants, VARIANT_CHUNK)) {
    prepareJsonWrite(
      `INSERT INTO product_variants (id, product_id, sku, combination_key)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.productId'),
              json_extract(value, '$.sku'), json_extract(value, '$.combinationKey')
         FROM json_each(?)`,
      chunk,
    );
  }
  for (const chunk of chunks(memberships, MEMBERSHIP_CHUNK)) {
    prepareJsonWrite(
      `INSERT INTO product_variant_values (id, variant_id, value_id)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.variantId'), json_extract(value, '$.valueId')
         FROM json_each(?)`,
      chunk,
    );
  }

  prepareJsonWrite(
    `WITH payload AS (SELECT value FROM json_each(?))
     INSERT INTO imports (id, filename)
     SELECT CASE
              WHEN NOT EXISTS (
                SELECT 1
                  FROM payload, json_each(json_extract(payload.value, '$.matchedProducts')) AS expected
                  LEFT JOIN products
                    ON products.id = json_extract(expected.value, '$.id')
                   AND products.revision = json_extract(expected.value, '$.postRevision')
                   AND products.import_fingerprint = json_extract(expected.value, '$.postImportFingerprint')
                 WHERE products.id IS NULL
              )
              THEN json_extract(payload.value, '$.importId')
              ELSE NULL
            END,
            json_extract(payload.value, '$.filename')
       FROM payload`,
    [
      {
        importId: 'fixture_import_0001',
        filename: 'worst-case-500-rows.csv',
        matchedProducts: matchedProducts.map((product) => {
          const poststate = matchedPoststateById.get(product.id);
          if (!poststate) {
            throw new Error(`Matched Product ${product.id} has no computed poststate.`);
          }
          return { id: product.id, ...poststate };
        }),
      },
    ],
  );

  if (statementCount !== 45 || writeStatements.length !== 41) {
    throw new Error(`Expected four lookups and 41 writes, observed ${statementCount} statements.`);
  }

  try {
    await database.batch(writeStatements);
  } catch (cause) {
    throw new BulkFeasibilityError(cause, statementCount, bindingCounts);
  }

  return {
    statementCount,
    bindingCounts,
    parameterByteLengths,
    chunkSizes: {
      products: PRODUCT_CHUNK,
      groups: GROUP_CHUNK,
      values: VALUE_CHUNK,
      variants: VARIANT_CHUNK,
      memberships: MEMBERSHIP_CHUNK,
    },
  };
}
