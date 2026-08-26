import { BOOTSTRAP_STORE_ID } from '../catalog/catalog-read';
import type { CsvDetectedType, ImportResultResponse } from '../shared/csv-contract';
import type { ImportWritePlan } from './exact-match';

export const IMPORT_LOOKUP_STATEMENTS = 4;
export const IMPORT_WRITE_STATEMENTS = 41;
export const IMPORT_TOTAL_STATEMENTS = 45;
export const IMPORT_CHUNKS = {
  products: { size: 100, statements: 5 },
  groups: { size: 250, statements: 10 },
  values: { size: 250, statements: 10 },
  variants: { size: 100, statements: 5 },
  memberships: { size: 250, statements: 10 },
} as const;

export class ImportPersistenceError extends Error {
  readonly statementCount = IMPORT_TOTAL_STATEMENTS;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The guarded import batch failed.', { cause });
    this.name = 'ImportPersistenceError';
  }
}

function exactChunks<T>(records: readonly T[], size: number, statementCount: number): T[][] {
  if (records.length > size * statementCount) throw new Error('The import exceeds the fixed D1 batch capacity.');
  return Array.from({ length: statementCount }, (_, index) => records.slice(index * size, (index + 1) * size));
}

function resultCounts(groups: ImportResultResponse['groups']): ImportResultResponse['counts'] {
  return groups.flatMap((group) => group.rows).reduce((counts, row) => {
    counts[row.outcome] += 1;
    return counts;
  }, { added: 0, duplicate: 0, rejected: 0 });
}

function detectedType(groups: ImportResultResponse['groups']): CsvDetectedType | 'mixed' {
  const types = new Set(groups.map((group) => group.detectedType));
  return types.size === 1 ? groups[0].detectedType : 'mixed';
}

export async function executeImportWrite(input: {
  database: D1Database;
  plan: ImportWritePlan;
  importId: string;
  filename: string;
  sizeBytes: number;
  privateObjectKey: string;
}): Promise<ImportResultResponse> {
  const statements: D1PreparedStatement[] = [];
  const addJsonStatement = (sql: string, records: unknown) => {
    statements.push(input.database.prepare(sql).bind(JSON.stringify(records)));
  };

  for (const chunk of exactChunks(input.plan.products, IMPORT_CHUNKS.products.size, IMPORT_CHUNKS.products.statements)) {
    addJsonStatement(
      `INSERT INTO products
         (id, store_id, slug, name, name_search_key, slug_search_key, status, product_type, currency,
          base_price_minor, public_description, delivery_access_title, delivery_access_instructions,
          revision, import_fingerprint)
       SELECT json_extract(value, '$.idPayload'), '${BOOTSTRAP_STORE_ID}', json_extract(value, '$.slug'),
              json_extract(value, '$.name'), json_extract(value, '$.nameSearchKey'), json_extract(value, '$.slugSearchKey'),
              json_extract(value, '$.status'), json_extract(value, '$.productType'), json_extract(value, '$.currency'),
              json_extract(value, '$.basePriceMinor'), json_extract(value, '$.publicDescription'),
              json_extract(value, '$.accessTitle'), json_extract(value, '$.accessInstructions'),
              json_extract(value, '$.revision'), json_extract(value, '$.importFingerprint')
         FROM json_each(?) WHERE true
       ON CONFLICT(store_id, slug) DO UPDATE SET
              revision=excluded.revision,
              import_fingerprint=excluded.import_fingerprint,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE products.id=json_extract(excluded.id, '$.id')
          AND products.revision=json_extract(excluded.id, '$.preRevision')
          AND products.import_fingerprint=json_extract(excluded.id, '$.preFingerprint')
          AND (products.revision<>excluded.revision OR products.import_fingerprint<>excluded.import_fingerprint)`,
      chunk,
    );
  }
  for (const chunk of exactChunks(input.plan.groups, IMPORT_CHUNKS.groups.size, IMPORT_CHUNKS.groups.statements)) {
    addJsonStatement(
      `INSERT INTO product_option_groups
         (id, store_id, product_id, name, comparison_key, position, participating, active)
       SELECT json_extract(value, '$.id'), '${BOOTSTRAP_STORE_ID}', json_extract(value, '$.productId'),
              json_extract(value, '$.name'), json_extract(value, '$.comparisonKey'),
              json_extract(value, '$.position'), 1, 0
         FROM json_each(?)`,
      chunk,
    );
  }
  for (const chunk of exactChunks(input.plan.values, IMPORT_CHUNKS.values.size, IMPORT_CHUNKS.values.statements)) {
    addJsonStatement(
      `INSERT INTO product_option_values
         (id, store_id, product_id, group_id, label, comparison_key, position, active)
       SELECT json_extract(value, '$.id'), '${BOOTSTRAP_STORE_ID}', json_extract(value, '$.productId'),
              json_extract(value, '$.groupId'), json_extract(value, '$.label'),
              json_extract(value, '$.comparisonKey'), json_extract(value, '$.position'), 1
         FROM json_each(?)`,
      chunk,
    );
  }
  for (const chunk of exactChunks(input.plan.variants, IMPORT_CHUNKS.variants.size, IMPORT_CHUNKS.variants.statements)) {
    addJsonStatement(
      `INSERT INTO product_variants
         (id, store_id, product_id, combination_key, sku, status, current_schema,
          price_override_minor, delivery_source)
       SELECT json_extract(value, '$.id'), '${BOOTSTRAP_STORE_ID}', json_extract(value, '$.productId'),
              json_extract(value, '$.combinationKey'), json_extract(value, '$.sku'), json_extract(value, '$.status'),
              json_extract(value, '$.initialCurrentSchema'), json_extract(value, '$.priceOverrideMinor'), 'product_default'
         FROM json_each(?)`,
      chunk,
    );
  }
  for (const chunk of exactChunks(input.plan.memberships, IMPORT_CHUNKS.memberships.size, IMPORT_CHUNKS.memberships.statements)) {
    addJsonStatement(
      `INSERT INTO product_variant_values (variant_id, value_id, group_id, product_id, store_id)
       SELECT json_extract(value, '$.variantId'), json_extract(value, '$.valueId'),
              json_extract(value, '$.groupId'), json_extract(value, '$.productId'), '${BOOTSTRAP_STORE_ID}'
         FROM json_each(?)`,
      chunk,
    );
  }

  const counts = resultCounts(input.plan.resultGroups);
  const metadata = {
    importId: input.importId,
    storeId: BOOTSTRAP_STORE_ID,
    filename: input.filename,
    sizeBytes: input.sizeBytes,
    detectedType: detectedType(input.plan.resultGroups),
    ...counts,
    privateObjectKey: input.privateObjectKey,
    poststates: input.plan.guardedPoststates,
  };
  addJsonStatement(
    `WITH input(payload) AS (VALUES (?))
     INSERT INTO imports
       (id, store_id, original_filename, size_bytes, detected_type,
        added_count, duplicate_count, rejected_count, private_object_key)
     SELECT CASE WHEN NOT EXISTS (
              SELECT 1
                FROM input, json_each(input.payload, '$.poststates') AS expected
                LEFT JOIN products
                  ON products.id=json_extract(expected.value, '$.id')
                 AND products.store_id=json_extract(input.payload, '$.storeId')
                 AND products.revision=json_extract(expected.value, '$.postRevision')
                 AND products.import_fingerprint=json_extract(expected.value, '$.postImportFingerprint')
               WHERE products.id IS NULL
            ) THEN json_extract(input.payload, '$.importId') ELSE NULL END,
            json_extract(input.payload, '$.storeId'), json_extract(input.payload, '$.filename'),
            json_extract(input.payload, '$.sizeBytes'), json_extract(input.payload, '$.detectedType'),
            json_extract(input.payload, '$.added'), json_extract(input.payload, '$.duplicate'),
            json_extract(input.payload, '$.rejected'), json_extract(input.payload, '$.privateObjectKey')
       FROM input`,
    metadata,
  );

  if (statements.length !== IMPORT_WRITE_STATEMENTS) {
    throw new Error(`The import batch must contain exactly ${IMPORT_WRITE_STATEMENTS} write statements.`);
  }
  try {
    await input.database.batch(statements);
  } catch (error) {
    throw new ImportPersistenceError(error);
  }
  return { importId: input.importId, filename: input.filename, counts, groups: input.plan.resultGroups };
}
