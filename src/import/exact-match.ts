import { catalogFingerprint } from '../catalog/schema-change';
import { canonicalCombination } from '../catalog/variant-matrix';
import { normalizeComparisonKey } from '../catalog/slug';
import { BOOTSTRAP_STORE_ID } from '../catalog/catalog-read';
import type {
  CsvHeader,
  CsvImportGroupOutcome,
  CsvImportOutcome,
  CsvResultGroup,
  CsvResultRow,
} from '../shared/csv-contract';
import type {
  CsvValidationIssue,
  CsvValidationResult,
  NormalizedCsvProduct,
  NormalizedCsvVariant,
  ValidatedCsvGroup,
} from './csv-validator';

interface ExistingProductRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  product_type: 'simple' | 'variant';
  currency: string;
  base_price_minor: number;
  public_description: string;
  delivery_access_title: string;
  delivery_access_instructions: string;
  revision: number;
  import_fingerprint: string;
}

interface ExistingVariantRow {
  id: string;
  product_id: string;
  sku: string;
  combination_key: string;
  status: 'enabled' | 'disabled';
  current_schema: number;
  price_override_minor: number | null;
  delivery_source: 'product_default' | 'variant_override';
}

interface ExistingSchemaRow {
  kind: 'group' | 'value';
  product_id: string;
  group_id: string;
  value_id: string | null;
  position: number;
  name: string;
  comparison_key: string;
  value_position: number | null;
  value_label: string | null;
  value_comparison_key: string | null;
  participating: number;
}

export interface ImportProductRecord {
  idPayload: string;
  id: string;
  slug: string;
  name: string;
  nameSearchKey: string;
  slugSearchKey: string;
  status: string;
  productType: 'simple' | 'variant';
  currency: string;
  basePriceMinor: number;
  publicDescription: string;
  accessTitle: string;
  accessInstructions: string;
  revision: number;
  importFingerprint: string;
}

export interface ImportGroupRecord {
  id: string;
  productId: string;
  name: string;
  comparisonKey: string;
  position: number;
}

export interface ImportValueRecord {
  id: string;
  productId: string;
  groupId: string;
  label: string;
  comparisonKey: string;
  position: number;
}

export interface ImportVariantRecord {
  id: string;
  productId: string;
  combinationKey: string;
  sku: string;
  status: 'enabled' | 'disabled';
  initialCurrentSchema: number;
  priceOverrideMinor: number | null;
}

export interface ImportMembershipRecord {
  variantId: string;
  valueId: string;
  groupId: string;
  productId: string;
}

export interface ImportGuardedPoststate {
  id: string;
  postRevision: number;
  postImportFingerprint: string;
}

export interface ImportWritePlan {
  products: ImportProductRecord[];
  groups: ImportGroupRecord[];
  values: ImportValueRecord[];
  variants: ImportVariantRecord[];
  memberships: ImportMembershipRecord[];
  guardedPoststates: ImportGuardedPoststate[];
  resultGroups: CsvResultGroup[];
}

function randomId(prefix: 'prod' | 'csvgrp' | 'csvval' | 'csvvar'): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function normalizedText(value: string): string {
  return value.normalize('NFKC').trim();
}

function exactProductMatches(existing: ExistingProductRow, product: NormalizedCsvProduct, type: 'simple' | 'variant'): boolean {
  return existing.slug === product.slug
    && normalizedText(existing.name) === product.name
    && existing.status === product.status
    && existing.product_type === type
    && existing.currency === product.currency
    && existing.base_price_minor === product.basePriceMinor
    && normalizedText(existing.public_description) === product.publicDescription
    && normalizedText(existing.delivery_access_title) === product.accessTitle
    && normalizedText(existing.delivery_access_instructions) === product.accessInstructions;
}

function rejectedRows(group: ValidatedCsvGroup, issue: CsvValidationIssue): CsvResultRow[] {
  return group.rows.map((row) => ({
    row: row.source.sourceRow,
    productSlug: group.productSlug,
    variantSku: row.variant?.sku ?? (row.source.variant_sku.trim() || null),
    outcome: 'rejected',
    field: issue.field,
    code: issue.code,
    reason: issue.reason,
  }));
}

function resultGroup(group: ValidatedCsvGroup, rows: CsvResultRow[]): CsvResultGroup {
  const outcomes = new Set(rows.map((row) => row.outcome));
  const outcome: CsvImportGroupOutcome = outcomes.size === 1 ? rows[0].outcome : 'mixed';
  return {
    productSlug: group.productSlug,
    detectedType: group.detectedType,
    derivedCombinationCount: group.derivedCombinationCount,
    outcome,
    rows,
  };
}

function rejectResult(group: ValidatedCsvGroup, issue: CsvValidationIssue): CsvResultGroup {
  return resultGroup(group, rejectedRows(group, issue));
}

function exactIssue(field: CsvHeader | null, code: string, reason: string): CsvValidationIssue {
  return { field, code, reason };
}

interface ExistingSchemaGroup {
  id: string;
  nameKey: string;
  position: number;
  participating: boolean;
  values: Array<{ id: string; labelKey: string; position: number }>;
}

function schemaForProduct(rows: ExistingSchemaRow[], productId: string): ExistingSchemaGroup[] {
  const productRows = rows.filter((row) => row.product_id === productId);
  const groupRows = productRows.filter((row) => row.kind === 'group').sort((left, right) => left.position - right.position);
  return groupRows.map((group) => ({
    id: group.group_id,
    nameKey: group.comparison_key,
    position: group.position,
    participating: group.participating === 1,
    values: productRows
      .filter((row) => row.kind === 'value' && row.group_id === group.group_id)
      .sort((left, right) => (left.value_position ?? 0) - (right.value_position ?? 0))
      .map((value) => ({
        id: value.value_id as string,
        labelKey: value.value_comparison_key as string,
        position: value.value_position as number,
      })),
  }));
}

function schemaMatches(group: ValidatedCsvGroup, existingSchema: ExistingSchemaGroup[]): boolean {
  if (existingSchema.length !== group.optionSchema.length) return false;
  return group.optionSchema.every((requested, index) => {
    const existing = existingSchema[index];
    if (!existing || !existing.participating || existing.position !== requested.position || existing.nameKey !== requested.nameKey) return false;
    return existing.values.length === requested.values.length
      && requested.values.every((value, valueIndex) => existing.values[valueIndex]?.labelKey === value.valueKey);
  });
}

function importedCombinationKey(
  variant: NormalizedCsvVariant,
  schema: ExistingSchemaGroup[],
): string | null {
  const selected: Array<{ groupId: string; valueId: string; groupPosition: number }> = [];
  for (const option of variant.options) {
    const group = schema[option.position];
    const value = group?.values.find((candidate) => candidate.labelKey === option.valueKey);
    if (!group || !value) return null;
    selected.push({ groupId: group.id, valueId: value.id, groupPosition: group.position });
  }
  return canonicalCombination(selected);
}

function fingerprintInput(group: ValidatedCsvGroup) {
  const product = group.product as NormalizedCsvProduct;
  return {
    product: {
      name: product.name,
      status: product.status,
      currency: product.currency,
      basePriceMinor: product.basePriceMinor,
      publicDescription: product.publicDescription,
      accessTitle: product.accessTitle,
      accessInstructions: product.accessInstructions,
    },
    groups: group.optionSchema.map((schema) => ({
      name: schema.nameKey,
      position: schema.position,
      participating: true,
      values: schema.values.map((value, position) => ({ label: value.valueKey, position })),
    })),
    variants: group.rows.flatMap((row) => row.variant ? [{
      selection: row.variant.options.map((option) => `${option.position}:${group.optionSchema[option.position].values.findIndex((value) => value.valueKey === option.valueKey)}`).sort(),
      sku: row.variant.sku,
      status: row.variant.status,
      priceOverrideMinor: row.variant.priceOverrideMinor,
      delivery: { source: 'product_default' },
    }] : []).sort((left, right) => left.selection.join('|').localeCompare(right.selection.join('|'))),
  };
}

function productRecord(
  product: NormalizedCsvProduct,
  type: 'simple' | 'variant',
  id: string,
  revision: number,
  fingerprint: string,
  existing?: ExistingProductRow,
): ImportProductRecord {
  return {
    idPayload: existing ? JSON.stringify({ id, preRevision: existing.revision, preFingerprint: existing.import_fingerprint }) : id,
    id,
    slug: product.slug,
    name: product.name,
    nameSearchKey: normalizeComparisonKey(product.name),
    slugSearchKey: normalizeComparisonKey(product.slug),
    status: product.status,
    productType: type,
    currency: product.currency,
    basePriceMinor: product.basePriceMinor,
    publicDescription: product.publicDescription,
    accessTitle: product.accessTitle,
    accessInstructions: product.accessInstructions,
    revision,
    importFingerprint: fingerprint,
  };
}

async function lookup<T>(database: D1Database, sql: string, payload: unknown): Promise<T[]> {
  return (await database.prepare(sql).bind(JSON.stringify(payload)).all<T>()).results;
}

export async function preflightExactMatch(database: D1Database, validation: CsvValidationResult): Promise<ImportWritePlan> {
  const eligibleGroups = validation.groups.filter((group) => group.eligible);
  const slugs = eligibleGroups.map((group) => group.productSlug);
  const skus = eligibleGroups.flatMap((group) => group.rows.flatMap((row) => row.variant ? [row.variant.sku] : []));
  const payload = { storeId: BOOTSTRAP_STORE_ID, slugs, skus };

  const existingProducts = await lookup<ExistingProductRow>(database,
    `WITH input(payload) AS (VALUES (?))
     SELECT id, slug, name, status, product_type, currency, base_price_minor, public_description,
            delivery_access_title, delivery_access_instructions, revision, import_fingerprint
       FROM products, input
      WHERE store_id=json_extract(input.payload, '$.storeId')
        AND slug IN (SELECT value FROM json_each(input.payload, '$.slugs'))`, payload);
  const variantsBySku = await lookup<ExistingVariantRow>(database,
    `WITH input(payload) AS (VALUES (?))
     SELECT id, product_id, sku, combination_key, status, current_schema, price_override_minor, delivery_source
       FROM product_variants, input
      WHERE store_id=json_extract(input.payload, '$.storeId')
        AND sku IN (SELECT value FROM json_each(input.payload, '$.skus'))`, payload);
  const variantsByProduct = await lookup<ExistingVariantRow>(database,
    `WITH input(payload) AS (VALUES (?))
     SELECT product_variants.id, product_variants.product_id, product_variants.sku,
            product_variants.combination_key, product_variants.status, product_variants.current_schema,
            product_variants.price_override_minor, product_variants.delivery_source
       FROM product_variants
       JOIN products ON products.id=product_variants.product_id AND products.store_id=product_variants.store_id
       CROSS JOIN input
      WHERE product_variants.store_id=json_extract(input.payload, '$.storeId')
        AND products.slug IN (SELECT value FROM json_each(input.payload, '$.slugs'))`, payload);
  const schemaRows = await lookup<ExistingSchemaRow>(database,
    `WITH input(payload) AS (VALUES (?))
     SELECT 'group' AS kind, product_option_groups.product_id, product_option_groups.id AS group_id,
            NULL AS value_id, product_option_groups.position, product_option_groups.name,
            product_option_groups.comparison_key, NULL AS value_position, NULL AS value_label,
            NULL AS value_comparison_key, product_option_groups.participating
       FROM product_option_groups
       JOIN products ON products.id=product_option_groups.product_id AND products.store_id=product_option_groups.store_id
       CROSS JOIN input
      WHERE product_option_groups.store_id=json_extract(input.payload, '$.storeId')
        AND product_option_groups.active=1
        AND products.slug IN (SELECT value FROM json_each(input.payload, '$.slugs'))
     UNION ALL
     SELECT 'value', product_option_values.product_id, product_option_values.group_id,
            product_option_values.id, product_option_groups.position, product_option_groups.name,
            product_option_groups.comparison_key, product_option_values.position, product_option_values.label,
            product_option_values.comparison_key, product_option_groups.participating
       FROM product_option_values
       JOIN product_option_groups ON product_option_groups.id=product_option_values.group_id
       JOIN products ON products.id=product_option_values.product_id AND products.store_id=product_option_values.store_id
       CROSS JOIN input
      WHERE product_option_values.store_id=json_extract(input.payload, '$.storeId')
        AND product_option_values.active=1 AND product_option_groups.active=1
        AND products.slug IN (SELECT value FROM json_each(input.payload, '$.slugs'))`, payload);

  const existingBySlug = new Map(existingProducts.map((product) => [product.slug, product]));
  const skuIdentity = new Map(variantsBySku.map((variant) => [variant.sku, variant]));
  const variantsByProductId = new Map<string, ExistingVariantRow[]>();
  variantsByProduct.forEach((variant) => {
    const records = variantsByProductId.get(variant.product_id);
    if (records) records.push(variant);
    else variantsByProductId.set(variant.product_id, [variant]);
  });

  const plan: ImportWritePlan = { products: [], groups: [], values: [], variants: [], memberships: [], guardedPoststates: [], resultGroups: [] };
  for (const group of validation.groups) {
    if (!group.eligible || !group.product) {
      plan.resultGroups.push(rejectResult(group, group.issue ?? exactIssue(null, 'validation_failed', 'The Product group is invalid.')));
      continue;
    }
    const existing = existingBySlug.get(group.productSlug);
    if (existing && !exactProductMatches(existing, group.product, group.detectedType)) {
      plan.resultGroups.push(rejectResult(group, exactIssue(null, 'product_conflict', 'The existing Product fields or type do not exactly match this CSV group.')));
      continue;
    }

    if (group.detectedType === 'simple') {
      if (existing) {
        plan.products.push(productRecord(group.product, 'simple', existing.id, existing.revision, existing.import_fingerprint, existing));
        plan.guardedPoststates.push({ id: existing.id, postRevision: existing.revision, postImportFingerprint: existing.import_fingerprint });
        plan.resultGroups.push(resultGroup(group, group.rows.map((row) => ({
          row: row.source.sourceRow, productSlug: group.productSlug, variantSku: null, outcome: 'duplicate', field: null, code: null,
          reason: 'The exact simple Product already exists; no records were changed.',
        }))));
      } else {
        const id = randomId('prod');
        const fingerprint = await catalogFingerprint(fingerprintInput(group));
        plan.products.push(productRecord(group.product, 'simple', id, 1, fingerprint));
        plan.guardedPoststates.push({ id, postRevision: 1, postImportFingerprint: fingerprint });
        plan.resultGroups.push(resultGroup(group, group.rows.map((row) => ({
          row: row.source.sourceRow, productSlug: group.productSlug, variantSku: null, outcome: 'added', field: null, code: null,
          reason: 'A new simple Product was added.',
        }))));
      }
      continue;
    }

    const existingSchema = existing ? schemaForProduct(schemaRows, existing.id) : [];
    if (existing && !schemaMatches(group, existingSchema)) {
      plan.resultGroups.push(rejectResult(group, exactIssue(null, 'schema_conflict', 'The existing active option schema does not exactly match this CSV group.')));
      continue;
    }

    const productId = existing?.id ?? randomId('prod');
    const groupRecordStart = plan.groups.length;
    const valueRecordStart = plan.values.length;
    const groupIdByPosition = new Map<number, string>();
    const valueIdByPositionAndKey = new Map<string, string>();
    if (existing) {
      existingSchema.forEach((schema) => {
        groupIdByPosition.set(schema.position, schema.id);
        schema.values.forEach((value) => valueIdByPositionAndKey.set(`${schema.position}\u0000${value.labelKey}`, value.id));
      });
    } else {
      group.optionSchema.forEach((schema) => {
        const groupId = randomId('csvgrp');
        groupIdByPosition.set(schema.position, groupId);
        plan.groups.push({ id: groupId, productId, name: schema.name, comparisonKey: schema.nameKey, position: schema.position });
        schema.values.forEach((value, position) => {
          const valueId = randomId('csvval');
          valueIdByPositionAndKey.set(`${schema.position}\u0000${value.valueKey}`, valueId);
          plan.values.push({ id: valueId, productId, groupId, label: value.label, comparisonKey: value.valueKey, position });
        });
      });
    }

    const existingVariants = existing ? variantsByProductId.get(existing.id) ?? [] : [];
    const existingByCombination = new Map(existingVariants.map((variant) => [variant.combination_key, variant]));
    const stagedVariants: Array<{ row: ValidatedCsvGroup['rows'][number]; variant: NormalizedCsvVariant; combinationKey: string; outcome: CsvImportOutcome }> = [];
    let conflict: CsvValidationIssue | null = null;
    for (const row of group.rows) {
      const variant = row.variant as NormalizedCsvVariant;
      const selected = variant.options.map((option) => ({
        groupId: groupIdByPosition.get(option.position) as string,
        valueId: valueIdByPositionAndKey.get(`${option.position}\u0000${option.valueKey}`) as string,
        groupPosition: option.position,
      }));
      const combinationKey = existing ? importedCombinationKey(variant, existingSchema) : canonicalCombination(selected);
      if (!combinationKey || selected.some((selection) => !selection.groupId || !selection.valueId)) {
        conflict = exactIssue(null, 'schema_conflict', 'A CSV option value could not be mapped to the exact active schema.');
        break;
      }
      const skuMatch = skuIdentity.get(variant.sku);
      const combinationMatch = existingByCombination.get(combinationKey);
      if (skuMatch || combinationMatch) {
        if (!skuMatch || !combinationMatch || skuMatch.id !== combinationMatch.id || skuMatch.product_id !== productId
          || combinationMatch.status !== variant.status
          || combinationMatch.price_override_minor !== variant.priceOverrideMinor
          || combinationMatch.delivery_source !== 'product_default') {
          conflict = exactIssue('variant_sku', 'identity_conflict', `SKU ${variant.sku} or its option combination already belongs to a different exact identity.`);
          break;
        }
        stagedVariants.push({ row, variant, combinationKey, outcome: 'duplicate' });
      } else {
        stagedVariants.push({ row, variant, combinationKey, outcome: 'added' });
      }
    }
    if (conflict) {
      plan.groups.splice(groupRecordStart);
      plan.values.splice(valueRecordStart);
      plan.resultGroups.push(rejectResult(group, conflict));
      continue;
    }

    for (const staged of stagedVariants.filter((variant) => variant.outcome === 'added')) {
      const variantId = randomId('csvvar');
      plan.variants.push({
        id: variantId,
        productId,
        combinationKey: staged.combinationKey,
        sku: staged.variant.sku,
        status: staged.variant.status,
        initialCurrentSchema: staged.variant.status === 'enabled' ? 0 : 1,
        priceOverrideMinor: staged.variant.priceOverrideMinor,
      });
      staged.variant.options.forEach((option) => {
        plan.memberships.push({
          variantId,
          productId,
          groupId: groupIdByPosition.get(option.position) as string,
          valueId: valueIdByPositionAndKey.get(`${option.position}\u0000${option.valueKey}`) as string,
        });
      });
    }

    const additions = stagedVariants.filter((variant) => variant.outcome === 'added').length;
    const fingerprint = additions === 0 && existing
      ? existing.import_fingerprint
      : await catalogFingerprint(fingerprintInput(group));
    const revision = existing ? existing.revision + (additions > 0 ? 1 : 0) : 1;
    plan.products.push(productRecord(group.product, 'variant', productId, revision, fingerprint, existing));
    plan.guardedPoststates.push({ id: productId, postRevision: revision, postImportFingerprint: fingerprint });
    plan.resultGroups.push(resultGroup(group, stagedVariants.map((staged) => ({
      row: staged.row.source.sourceRow,
      productSlug: group.productSlug,
      variantSku: staged.variant.sku,
      outcome: staged.outcome,
      field: null,
      code: null,
      reason: staged.outcome === 'added' ? 'A new exact Variant identity was added.' : 'The exact SKU and option combination already exist; no records were changed.',
    }))));
  }

  plan.resultGroups.sort((left, right) => left.rows[0].row - right.rows[0].row);
  return plan;
}
