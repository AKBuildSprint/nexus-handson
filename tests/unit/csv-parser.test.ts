import { describe, expect, it } from 'vitest';
import { CsvContractError, parseCsvBytes } from '../../src/import/csv-parser';
import {
  CSV_HEADER,
  CSV_HEADER_LINE,
  CSV_MAX_BYTES,
  CSV_TEMPLATE,
  isImportResultResponse,
  serializeCsvRow,
  type CsvRow,
} from '../../src/shared/csv-contract';
import unifiedTemplate from '../fixtures/import/unified-template.csv?raw';

function simpleRow(slug: string): CsvRow {
  const row = Object.fromEntries(CSV_HEADER.map((column) => [column, ''])) as CsvRow;
  return {
    ...row,
    product_slug: slug,
    product_name: 'Boundary Product',
    base_price: '1.00',
    currency: 'USD',
    product_status: 'active',
    access_title: 'Download',
    access_instructions: 'Open',
  };
}

describe('unified CSV parser contract', () => {
  it('round-trips the exact generated template and fixture', () => {
    expect(CSV_TEMPLATE).toBe(unifiedTemplate);
    const parsed = parseCsvBytes(new TextEncoder().encode(CSV_TEMPLATE));
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.map((row) => row.sourceRow)).toEqual([1, 2, 3]);
    expect(parsed.rows[2].variant_sku).toBe('FOCUS-LIGHT');
  });

  it('accepts exactly 1,000,000 actual bytes and rejects byte 1,000,001', () => {
    const row = simpleRow('byte-boundary');
    const initial = `${CSV_HEADER_LINE}\n${serializeCsvRow(row)}\n`;
    row.public_description = 'x'.repeat(CSV_MAX_BYTES - new TextEncoder().encode(initial).byteLength);
    const boundary = new TextEncoder().encode(`${CSV_HEADER_LINE}\n${serializeCsvRow(row)}\n`);
    expect(boundary.byteLength).toBe(CSV_MAX_BYTES);
    expect(parseCsvBytes(boundary).byteLength).toBe(CSV_MAX_BYTES);
    expect(() => parseCsvBytes(new Uint8Array(CSV_MAX_BYTES + 1))).toThrowError(
      expect.objectContaining({ code: 'csv_size_exceeded' }) as CsvContractError,
    );
  });

  it('accepts 500 data rows and rejects row 501', () => {
    const fiveHundred = `${CSV_HEADER_LINE}\n${Array.from({ length: 500 }, (_, index) => serializeCsvRow(simpleRow(`row-${index + 1}`))).join('\n')}\n`;
    expect(parseCsvBytes(new TextEncoder().encode(fiveHundred)).rows).toHaveLength(500);
    const fiveHundredOne = `${fiveHundred}${serializeCsvRow(simpleRow('row-501'))}\n`;
    expect(() => parseCsvBytes(new TextEncoder().encode(fiveHundredOne))).toThrowError(
      expect.objectContaining({ code: 'csv_row_limit_exceeded', row: 501 }) as CsvContractError,
    );
  });

  it('rejects bare CR and malformed UTF-8 while accepting BOM CRLF quoting', () => {
    expect(() => parseCsvBytes(new TextEncoder().encode(`${CSV_HEADER_LINE}\r${serializeCsvRow(simpleRow('bare-cr'))}`))).toThrowError(
      expect.objectContaining({ code: 'invalid_csv' }) as CsvContractError,
    );
    expect(() => parseCsvBytes(Uint8Array.of(0xff))).toThrowError(
      expect.objectContaining({ code: 'invalid_utf8' }) as CsvContractError,
    );
    const quoted = simpleRow('quoted');
    quoted.public_description = 'Line one\r\nLine "two", exact';
    const source = `\uFEFF${CSV_HEADER_LINE}\r\n${serializeCsvRow(quoted)}\r\n`;
    expect(parseCsvBytes(new TextEncoder().encode(source)).rows[0].public_description).toBe(quoted.public_description);
  });

  it('runtime-validates exact authoritative result shape, order, outcomes, and counts', () => {
    const result = {
      importId: 'imp_1',
      filename: 'products.csv',
      counts: { added: 1, duplicate: 0, rejected: 0 },
      groups: [{
        productSlug: 'field-notes',
        detectedType: 'simple',
        derivedCombinationCount: 0,
        outcome: 'added',
        rows: [{
          row: 1,
          productSlug: 'field-notes',
          variantSku: null,
          outcome: 'added',
          field: null,
          code: null,
          reason: 'Added.',
        }],
      }],
    };
    expect(isImportResultResponse(result)).toBe(true);
    expect(isImportResultResponse({ ...result, counts: { added: 0, duplicate: 0, rejected: 0 } })).toBe(false);
    expect(isImportResultResponse({ ...result, unexpected: true })).toBe(false);
  });
});
