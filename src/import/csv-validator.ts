import { decimalToMinor, MoneyError } from '../catalog/money';
import { normalizeComparisonKey } from '../catalog/slug';
import {
  CSV_CONFIRMATION_MIN,
  CSV_OPTION_GROUPS_MAX,
  CSV_OPTION_VALUES_MAX,
  CSV_PRODUCT_STATUSES,
  CSV_VARIANTS_MAX,
  CSV_VARIANT_STATUSES,
  type CsvDetectedType,
  type CsvHeader,
  type CsvPreviewOutcome,
  type CsvProductStatus,
  type CsvSourceRow,
  type CsvVariantStatus,
} from '../shared/csv-contract';

export interface CsvValidationIssue {
  field: CsvHeader | null;
  code: string;
  reason: string;
}

export interface NormalizedCsvProduct {
  slug: string;
  name: string;
  basePriceMinor: number;
  currency: string;
  status: CsvProductStatus;
  publicDescription: string;
  accessTitle: string;
  accessInstructions: string;
}

export interface NormalizedCsvOption {
  position: number;
  name: string;
  nameKey: string;
  value: string;
  valueKey: string;
}

export interface NormalizedCsvVariant {
  sourceRow: number;
  sku: string;
  status: CsvVariantStatus;
  priceOverrideMinor: number | null;
  options: NormalizedCsvOption[];
  combinationSignature: string;
}

export interface ValidatedCsvRow {
  source: CsvSourceRow;
  normalizedSlug: string;
  variant: NormalizedCsvVariant | null;
  outcome: CsvPreviewOutcome;
  issue: CsvValidationIssue | null;
}

export interface ValidatedCsvGroup {
  productSlug: string;
  detectedType: CsvDetectedType;
  derivedCombinationCount: number;
  eligible: boolean;
  confirmationRequired: boolean;
  product: NormalizedCsvProduct | null;
  optionSchema: Array<{
    position: number;
    name: string;
    nameKey: string;
    values: Array<{ label: string; valueKey: string }>;
  }>;
  rows: ValidatedCsvRow[];
  issue: CsvValidationIssue | null;
}

export interface CsvValidationResult {
  groups: ValidatedCsvGroup[];
  eligibleGroupCount: number;
  confirmationRequired: boolean;
}

function normalizedDisplay(value: string): string {
  return value.normalize('NFKC').trim();
}

function groupIssue(field: CsvHeader | null, code: string, reason: string): CsvValidationIssue {
  return { field, code, reason };
}

function variantColumnsPresent(row: CsvSourceRow): boolean {
  if (row.variant_sku.trim() !== '' || row.variant_price_override.trim() !== '' || row.variant_status.trim() !== '') return true;
  for (let position = 1; position <= CSV_OPTION_GROUPS_MAX; position += 1) {
    if (row[`option_${position}_name` as CsvHeader].trim() !== '' || row[`option_${position}_value` as CsvHeader].trim() !== '') return true;
  }
  return false;
}

function normalizedProduct(row: CsvSourceRow, slug: string): { product: NormalizedCsvProduct | null; issue: CsvValidationIssue | null } {
  const required: Array<[CsvHeader, string]> = [
    ['product_slug', 'Product slug'],
    ['product_name', 'Product name'],
    ['base_price', 'Base price'],
    ['currency', 'Currency'],
    ['product_status', 'Product status'],
    ['access_title', 'Access title'],
    ['access_instructions', 'Access instructions'],
  ];
  const missing = required.find(([field]) => normalizedDisplay(row[field]) === '');
  if (missing) return { product: null, issue: groupIssue(missing[0], 'value_required', `${missing[1]} is required on data row ${row.sourceRow}.`) };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    return { product: null, issue: groupIssue('product_slug', 'slug_invalid', `Data row ${row.sourceRow} has an invalid normalized Product slug.`) };
  }
  if (!(CSV_PRODUCT_STATUSES as readonly string[]).includes(row.product_status)) {
    return { product: null, issue: groupIssue('product_status', 'status_invalid', `Data row ${row.sourceRow} must use draft, active, or archived.`) };
  }
  const currency = normalizedDisplay(row.currency);
  let basePriceMinor: number;
  try {
    basePriceMinor = decimalToMinor(normalizedDisplay(row.base_price), currency);
  } catch (error) {
    const money = error as MoneyError;
    return { product: null, issue: groupIssue(money.code === 'currency_invalid' ? 'currency' : 'base_price', money.code, money.message) };
  }
  return {
    product: {
      slug,
      name: normalizedDisplay(row.product_name),
      basePriceMinor,
      currency,
      status: row.product_status as CsvProductStatus,
      publicDescription: normalizedDisplay(row.public_description),
      accessTitle: normalizedDisplay(row.access_title),
      accessInstructions: normalizedDisplay(row.access_instructions),
    },
    issue: null,
  };
}

function productSignature(product: NormalizedCsvProduct): string {
  return JSON.stringify(product);
}

function parseVariant(row: CsvSourceRow, currency: string): { variant: NormalizedCsvVariant | null; issue: CsvValidationIssue | null } {
  const sku = normalizedDisplay(row.variant_sku);
  if (sku === '') return { variant: null, issue: groupIssue('variant_sku', 'value_required', `Variant SKU is required on data row ${row.sourceRow}.`) };
  if (!(CSV_VARIANT_STATUSES as readonly string[]).includes(row.variant_status)) {
    return { variant: null, issue: groupIssue('variant_status', 'status_invalid', `Data row ${row.sourceRow} must use enabled or disabled.`) };
  }
  let priceOverrideMinor: number | null = null;
  const priceOverride = normalizedDisplay(row.variant_price_override);
  if (priceOverride !== '') {
    try {
      priceOverrideMinor = decimalToMinor(priceOverride, currency);
    } catch (error) {
      const money = error as MoneyError;
      return { variant: null, issue: groupIssue('variant_price_override', money.code, money.message) };
    }
  }

  const options: NormalizedCsvOption[] = [];
  let foundBlank = false;
  const optionNames = new Set<string>();
  for (let position = 1; position <= CSV_OPTION_GROUPS_MAX; position += 1) {
    const nameField = `option_${position}_name` as CsvHeader;
    const valueField = `option_${position}_value` as CsvHeader;
    const name = normalizedDisplay(row[nameField]);
    const value = normalizedDisplay(row[valueField]);
    if ((name === '') !== (value === '')) {
      return { variant: null, issue: groupIssue(name === '' ? nameField : valueField, 'option_pair_incomplete', `Data row ${row.sourceRow} has an incomplete option ${position} name/value pair.`) };
    }
    if (name === '') {
      foundBlank = true;
      continue;
    }
    if (foundBlank) {
      return { variant: null, issue: groupIssue(nameField, 'option_pair_gapped', `Data row ${row.sourceRow} has a gap before option ${position}. Option pairs must be contiguous from option 1.`) };
    }
    const nameKey = normalizeComparisonKey(name);
    if (optionNames.has(nameKey)) {
      return { variant: null, issue: groupIssue(nameField, 'option_name_duplicate', `Data row ${row.sourceRow} repeats an option group name after normalization.`) };
    }
    optionNames.add(nameKey);
    options.push({ position: position - 1, name, nameKey, value, valueKey: normalizeComparisonKey(value) });
  }
  if (options.length === 0) {
    return { variant: null, issue: groupIssue('option_1_name', 'matrix_incomplete', `Variant data row ${row.sourceRow} requires at least one complete option pair.`) };
  }

  return {
    variant: {
      sourceRow: row.sourceRow,
      sku,
      status: row.variant_status as CsvVariantStatus,
      priceOverrideMinor,
      options,
      combinationSignature: options.map((option) => option.valueKey).join('\u0000'),
    },
    issue: null,
  };
}

function reject(group: ValidatedCsvGroup, issue: CsvValidationIssue): void {
  group.eligible = false;
  group.confirmationRequired = false;
  group.issue = issue;
  group.rows.forEach((row) => {
    row.outcome = 'rejected';
    row.issue = issue;
  });
}

export function validateCsvRows(
  sourceRows: readonly CsvSourceRow[],
  duplicateCandidateSlugs: ReadonlySet<string> = new Set(),
): CsvValidationResult {
  const grouped = new Map<string, CsvSourceRow[]>();
  for (const row of sourceRows) {
    const slug = normalizeComparisonKey(row.product_slug);
    const rows = grouped.get(slug);
    if (rows) rows.push(row);
    else grouped.set(slug, [row]);
  }

  const groups: ValidatedCsvGroup[] = [];
  for (const [slug, rows] of grouped) {
    const kinds = rows.map((row) => variantColumnsPresent(row) ? 'variant' as const : 'simple' as const);
    const detectedType: CsvDetectedType = kinds.includes('variant') ? 'variant' : 'simple';
    const previewOutcome: CsvPreviewOutcome = duplicateCandidateSlugs.has(slug) ? 'duplicate_candidate' : 'ready';
    const group: ValidatedCsvGroup = {
      productSlug: slug || '(missing product_slug)',
      detectedType,
      derivedCombinationCount: detectedType === 'simple' ? 0 : rows.length,
      eligible: true,
      confirmationRequired: false,
      product: null,
      optionSchema: [],
      rows: rows.map((source) => ({ source, normalizedSlug: slug, variant: null, outcome: previewOutcome, issue: null })),
      issue: null,
    };
    groups.push(group);

    const parsedProducts = rows.map((row) => normalizedProduct(row, slug));
    const productFailure = parsedProducts.find((entry) => entry.issue !== null);
    if (productFailure?.issue) {
      reject(group, productFailure.issue);
      continue;
    }
    const product = parsedProducts[0]?.product;
    if (!product) {
      reject(group, groupIssue(null, 'validation_failed', 'The Product fields could not be normalized.'));
      continue;
    }
    group.product = product;
    const expectedProduct = productSignature(product);
    const conflictingRow = parsedProducts.findIndex((entry) => entry.product && productSignature(entry.product) !== expectedProduct);
    if (conflictingRow >= 0) {
      reject(group, groupIssue(null, 'product_field_conflict', `Product fields conflict between data rows ${rows[0].sourceRow} and ${rows[conflictingRow].sourceRow}. No value was selected as the winner.`));
      continue;
    }
    if (new Set(kinds).size > 1) {
      reject(group, groupIssue(null, 'mixed_product_shape', `Product ${group.productSlug} mixes simple and Variant rows.`));
      continue;
    }
    if (detectedType === 'simple') {
      if (rows.length !== 1) {
        reject(group, groupIssue(null, 'duplicate_product_row', `Simple Product ${group.productSlug} must appear exactly once.`));
      }
      continue;
    }

    const parsedVariants = rows.map((row) => parseVariant(row, product.currency));
    const variantFailure = parsedVariants.find((entry) => entry.issue !== null);
    if (variantFailure?.issue) {
      reject(group, variantFailure.issue);
      continue;
    }
    parsedVariants.forEach((entry, index) => { group.rows[index].variant = entry.variant; });
    const variants = parsedVariants.map((entry) => entry.variant).filter((variant): variant is NormalizedCsvVariant => variant !== null);
    const first = variants[0];
    if (!first) {
      reject(group, groupIssue(null, 'matrix_incomplete', 'A Variant Product requires Variant rows.'));
      continue;
    }
    const schemaSignature = first.options.map((option) => option.nameKey).join('\u0000');
    const mismatchedSchema = variants.find((variant) => variant.options.map((option) => option.nameKey).join('\u0000') !== schemaSignature);
    if (mismatchedSchema) {
      reject(group, groupIssue(null, 'schema_conflict', `Option schema conflicts on data row ${mismatchedSchema.sourceRow}.`));
      continue;
    }

    group.optionSchema = first.options.map((option) => ({
      position: option.position,
      name: option.name,
      nameKey: option.nameKey,
      values: [],
    }));
    for (let position = 0; position < group.optionSchema.length; position += 1) {
      const seen = new Map<string, string>();
      for (const variant of variants) {
        const option = variant.options[position];
        if (!seen.has(option.valueKey)) seen.set(option.valueKey, option.value);
      }
      group.optionSchema[position].values = [...seen].map(([valueKey, label]) => ({ label, valueKey }));
    }
    const derived = group.optionSchema.reduce((count, schema) => count * schema.values.length, 1);
    group.derivedCombinationCount = derived;
    if (derived > CSV_VARIANTS_MAX) {
      reject(group, groupIssue(null, 'variant_limit_exceeded', `${derived} combinations exceeds the maximum of ${CSV_VARIANTS_MAX}. This Product group is rejected.`));
      continue;
    }
    const overValueLimit = group.optionSchema.find((schema) => schema.values.length > CSV_OPTION_VALUES_MAX);
    if (overValueLimit) {
      reject(group, groupIssue(
        `option_${overValueLimit.position + 1}_value` as CsvHeader,
        'option_value_limit_exceeded',
        `${overValueLimit.name} has ${overValueLimit.values.length} values; the maximum is ${CSV_OPTION_VALUES_MAX}.`,
      ));
      continue;
    }
    if (!group.eligible) continue;

    const skuRows = new Map<string, number>();
    const combinationRows = new Map<string, number>();
    let identityIssue: CsvValidationIssue | null = null;
    for (const variant of variants) {
      const firstSkuRow = skuRows.get(variant.sku);
      if (firstSkuRow !== undefined) {
        identityIssue = groupIssue('variant_sku', 'duplicate_sku', `SKU ${variant.sku} is repeated on data rows ${firstSkuRow} and ${variant.sourceRow}.`);
        break;
      }
      skuRows.set(variant.sku, variant.sourceRow);
      const firstCombinationRow = combinationRows.get(variant.combinationSignature);
      if (firstCombinationRow !== undefined) {
        identityIssue = groupIssue(null, 'duplicate_combination', `The same option combination is repeated on data rows ${firstCombinationRow} and ${variant.sourceRow}.`);
        break;
      }
      combinationRows.set(variant.combinationSignature, variant.sourceRow);
    }
    if (identityIssue) {
      reject(group, identityIssue);
      continue;
    }

    if (combinationRows.size !== derived || variants.length !== derived) {
      reject(group, groupIssue(null, 'matrix_incomplete', `The supplied rows cover ${combinationRows.size} of ${derived} derived combinations. Every combination must appear exactly once.`));
      continue;
    }
    group.confirmationRequired = derived >= CSV_CONFIRMATION_MIN;
  }

  const skuOwners = new Map<string, ValidatedCsvGroup[]>();
  for (const group of groups.filter((candidate) => candidate.eligible && candidate.detectedType === 'variant')) {
    for (const row of group.rows) {
      const sku = row.variant?.sku;
      if (!sku) continue;
      const owners = skuOwners.get(sku);
      if (owners && !owners.includes(group)) owners.push(group);
      else if (!owners) skuOwners.set(sku, [group]);
    }
  }
  for (const [sku, owners] of skuOwners) {
    if (owners.length < 2) continue;
    const reason = `SKU ${sku} appears in more than one Product group. SKU identity is Store-wide.`;
    owners.forEach((group) => reject(group, groupIssue('variant_sku', 'identity_conflict', reason)));
  }

  return {
    groups,
    eligibleGroupCount: groups.filter((group) => group.eligible).length,
    confirmationRequired: groups.some((group) => group.eligible && group.confirmationRequired),
  };
}
