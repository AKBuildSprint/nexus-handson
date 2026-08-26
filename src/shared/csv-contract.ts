import { CSV_BYTES_MAX, CSV_DATA_ROWS_MAX } from './catalog-limits';

export const CSV_FILENAME = 'nexus-product-import-template.csv';
export const CSV_PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export const CSV_VARIANT_STATUSES = ['enabled', 'disabled'] as const;
export const CSV_HEADER = [
  'product_slug',
  'product_name',
  'base_price',
  'currency',
  'product_status',
  'public_description',
  'access_title',
  'access_instructions',
  'variant_sku',
  'variant_price_override',
  'variant_status',
  'option_1_name',
  'option_1_value',
  'option_2_name',
  'option_2_value',
  'option_3_name',
  'option_3_value',
  'option_4_name',
  'option_4_value',
  'option_5_name',
  'option_5_value',
] as const;

export type CsvHeader = (typeof CSV_HEADER)[number];
export type CsvProductStatus = (typeof CSV_PRODUCT_STATUSES)[number];
export type CsvVariantStatus = (typeof CSV_VARIANT_STATUSES)[number];
export type CsvRow = Record<CsvHeader, string>;
export type CsvSourceRow = CsvRow & { sourceRow: number };

export const CSV_HEADER_LINE = CSV_HEADER.join(',');
export const CSV_HEADER_COLUMNS = CSV_HEADER.length;
export const CSV_MAX_BYTES = CSV_BYTES_MAX;
export const CSV_MAX_DATA_ROWS = CSV_DATA_ROWS_MAX;
export const CSV_OPTION_GROUPS_MAX = 5;
export const CSV_OPTION_VALUES_MAX = 10;
export const CSV_CONFIRMATION_MIN = 11;
export const CSV_VARIANTS_MAX = 30;
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
export const CSV_CONFIRMATION_HEADER = 'X-Nexus-Confirm-Variants';
export const CSV_FILENAME_HEADER = 'X-Nexus-Filename';

export const CSV_PAPA_PARSE_OPTIONS = {
  delimiter: ',',
  quoteChar: '"',
  escapeChar: '"',
  header: false,
  dynamicTyping: false,
  skipEmptyLines: false,
} as const;

const blankRow = (): CsvRow => Object.fromEntries(CSV_HEADER.map((column) => [column, ''])) as CsvRow;

export const CSV_EXAMPLE_ROWS: readonly CsvRow[] = [
  {
    ...blankRow(),
    product_slug: 'field-notes',
    product_name: 'Field Notes',
    base_price: '24.00',
    currency: 'USD',
    product_status: 'active',
    public_description: 'A concise guide',
    access_title: 'Download Field Notes',
    access_instructions: 'Open the PDF from your order',
  },
  {
    ...blankRow(),
    product_slug: 'focus-pack',
    product_name: 'Focus Pack',
    base_price: '36.00',
    currency: 'USD',
    product_status: 'draft',
    public_description: 'Desktop focus templates',
    access_title: 'Download Focus Pack',
    access_instructions: 'Open the ZIP from your order',
    variant_sku: 'FOCUS-DARK',
    variant_status: 'enabled',
    option_1_name: 'Theme',
    option_1_value: 'Dark',
    option_2_name: 'License',
    option_2_value: 'Personal',
  },
  {
    ...blankRow(),
    product_slug: 'focus-pack',
    product_name: 'Focus Pack',
    base_price: '36.00',
    currency: 'USD',
    product_status: 'draft',
    public_description: 'Desktop focus templates',
    access_title: 'Download Focus Pack',
    access_instructions: 'Open the ZIP from your order',
    variant_sku: 'FOCUS-LIGHT',
    variant_status: 'enabled',
    option_1_name: 'Theme',
    option_1_value: 'Light',
    option_2_name: 'License',
    option_2_value: 'Personal',
  },
] as const;

function encodeCsvField(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function serializeCsvRow(row: CsvRow): string {
  return CSV_HEADER.map((column) => encodeCsvField(row[column])).join(',');
}

export const CSV_EXAMPLE_LINES = CSV_EXAMPLE_ROWS.map(serializeCsvRow);
export const CSV_TEMPLATE = `${CSV_HEADER_LINE}\n${CSV_EXAMPLE_LINES.join('\n')}\n`;

export type CsvDetectedType = 'simple' | 'variant';
export type CsvPreviewOutcome = 'ready' | 'duplicate_candidate' | 'rejected';
export type CsvImportOutcome = 'added' | 'duplicate' | 'rejected';
export type CsvImportGroupOutcome = CsvImportOutcome | 'mixed';

export interface CsvResultRow {
  row: number;
  productSlug: string;
  variantSku: string | null;
  outcome: CsvImportOutcome;
  field: CsvHeader | null;
  code: string | null;
  reason: string | null;
}

export interface CsvResultGroup {
  productSlug: string;
  detectedType: CsvDetectedType;
  derivedCombinationCount: number;
  outcome: CsvImportGroupOutcome;
  rows: CsvResultRow[];
}

export interface ImportResultResponse {
  importId: string;
  filename: string;
  counts: { added: number; duplicate: number; rejected: number };
  groups: CsvResultGroup[];
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(record, key)) ? record : null;
}

export function isImportResultResponse(value: unknown): value is ImportResultResponse {
  const result = exactRecord(value, ['importId', 'filename', 'counts', 'groups']);
  if (!result || typeof result.importId !== 'string' || result.importId === '' || typeof result.filename !== 'string' || !Array.isArray(result.groups)) return false;
  const counts = exactRecord(result.counts, ['added', 'duplicate', 'rejected']);
  if (!counts || !(['added', 'duplicate', 'rejected'] as const).every((outcome) => Number.isSafeInteger(counts[outcome]) && (counts[outcome] as number) >= 0)) return false;

  const observed = { added: 0, duplicate: 0, rejected: 0 };
  let previousGroupFirstRow = 0;
  for (const groupValue of result.groups) {
    const group = exactRecord(groupValue, ['productSlug', 'detectedType', 'derivedCombinationCount', 'outcome', 'rows']);
    if (!group || typeof group.productSlug !== 'string' || group.productSlug === ''
      || (group.detectedType !== 'simple' && group.detectedType !== 'variant')
      || !Number.isSafeInteger(group.derivedCombinationCount) || (group.derivedCombinationCount as number) < 0
      || !['added', 'duplicate', 'rejected', 'mixed'].includes(group.outcome as string)
      || !Array.isArray(group.rows) || group.rows.length === 0) return false;
    let previousGroupRow = 0;
    let firstGroupRow = 0;
    const groupOutcomes = new Set<CsvImportOutcome>();
    for (const rowValue of group.rows) {
      const row = exactRecord(rowValue, ['row', 'productSlug', 'variantSku', 'outcome', 'field', 'code', 'reason']);
      if (!row || !Number.isSafeInteger(row.row) || (row.row as number) <= previousGroupRow
        || row.productSlug !== group.productSlug
        || (row.variantSku !== null && typeof row.variantSku !== 'string')
        || !['added', 'duplicate', 'rejected'].includes(row.outcome as string)
        || (row.field !== null && !(CSV_HEADER as readonly string[]).includes(row.field as string))
        || (row.code !== null && typeof row.code !== 'string')
        || (row.reason !== null && typeof row.reason !== 'string')) return false;
      previousGroupRow = row.row as number;
      if (firstGroupRow === 0) firstGroupRow = previousGroupRow;
      const outcome = row.outcome as CsvImportOutcome;
      observed[outcome] += 1;
      groupOutcomes.add(outcome);
    }
    const expectedGroupOutcome: CsvImportGroupOutcome = groupOutcomes.size === 1 ? [...groupOutcomes][0] : 'mixed';
    if (group.outcome !== expectedGroupOutcome) return false;
    if (firstGroupRow <= previousGroupFirstRow) return false;
    previousGroupFirstRow = firstGroupRow;
  }
  return observed.added === counts.added
    && observed.duplicate === counts.duplicate
    && observed.rejected === counts.rejected;
}

export const CSV_PREVIEW_LABELS: Record<CsvPreviewOutcome, 'Ready' | 'Duplicate candidate' | 'Rejected'> = {
  ready: 'Ready',
  duplicate_candidate: 'Duplicate candidate',
  rejected: 'Rejected',
};

export const CSV_RESULT_LABELS: Record<CsvImportOutcome, 'Added' | 'Duplicate' | 'Rejected'> = {
  added: 'Added',
  duplicate: 'Duplicate',
  rejected: 'Rejected',
};
