import worstCaseFixture from '../fixtures/import/worst-case-500-rows.csv?raw';
import unifiedTemplateFixture from '../fixtures/import/unified-template.csv?raw';
import { CSV_HEADER_LINE } from '../../src/shared/csv-contract';
import type { ParsedCsv } from '../../src/import/csv-parser';

export interface NormalizedCsvObservation {
  rowCount: number;
  firstRow: {
    productSlug: string;
    productName: string;
    productStatus: string;
    variantSku: string;
    variantStatus: string;
    option1Value: string;
    option5Value: string;
    publicDescription: string;
  };
  lastProductSlug: string;
}

export interface CsvParserCorpusCase {
  name: string;
  source: string;
  expected: NormalizedCsvObservation;
}

const quotedFields = [
  'quoted-product',
  'Quoted, Product',
  '1.00',
  'USD',
  'draft',
  'Line one\r\nLine "two"',
  'Download',
  'Open the file',
  'QUOTED-1',
  '',
  'enabled',
  'Theme',
  'Dark, High Contrast',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
];
const quotedRow = quotedFields
  .map((field) => (/[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field))
  .join(',');

export const CSV_PARSER_CORPUS: CsvParserCorpusCase[] = [
  {
    name: 'exact unified template fixture',
    source: unifiedTemplateFixture,
    expected: {
      rowCount: 3,
      firstRow: {
        productSlug: 'field-notes',
        productName: 'Field Notes',
        productStatus: 'active',
        variantSku: '',
        variantStatus: '',
        option1Value: '',
        option5Value: '',
        publicDescription: 'A concise guide',
      },
      lastProductSlug: 'focus-pack',
    },
  },
  {
    name: 'exact LF 500-row fixture',
    source: worstCaseFixture,
    expected: {
      rowCount: 500,
      firstRow: {
        productSlug: 'bulk-0001',
        productName: 'Bulk Product 0001',
        productStatus: 'active',
        variantSku: 'BULK-0001',
        variantStatus: 'enabled',
        option1Value: 'Value 0001-1',
        option5Value: 'Value 0001-5',
        publicDescription: '',
      },
      lastProductSlug: 'bulk-0500',
    },
  },
  {
    name: 'BOM CRLF quoted comma and multiline fixture',
    source: `\uFEFF${CSV_HEADER_LINE}\r\n${quotedRow}\r\n`,
    expected: {
      rowCount: 1,
      firstRow: {
        productSlug: 'quoted-product',
        productName: 'Quoted, Product',
        productStatus: 'draft',
        variantSku: 'QUOTED-1',
        variantStatus: 'enabled',
        option1Value: 'Dark, High Contrast',
        option5Value: '',
        publicDescription: 'Line one\r\nLine "two"',
      },
      lastProductSlug: 'quoted-product',
    },
  },
];

export function normalizeCsvObservation(parsed: ParsedCsv): NormalizedCsvObservation {
  const first = parsed.rows[0];
  const last = parsed.rows.at(-1);
  if (!first || !last) {
    throw new Error('The shared parser corpus must contain at least one normalized row.');
  }

  return {
    rowCount: parsed.rows.length,
    firstRow: {
      productSlug: first.product_slug,
      productName: first.product_name,
      productStatus: first.product_status,
      variantSku: first.variant_sku,
      variantStatus: first.variant_status,
      option1Value: first.option_1_value,
      option5Value: first.option_5_value,
      publicDescription: first.public_description,
    },
    lastProductSlug: last.product_slug,
  };
}
