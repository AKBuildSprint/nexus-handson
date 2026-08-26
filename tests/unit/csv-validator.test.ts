import { describe, expect, it } from 'vitest';
import { parseCsvBytes } from '../../src/import/csv-parser';
import { validateCsvRows } from '../../src/import/csv-validator';
import { CSV_HEADER, CSV_HEADER_LINE, serializeCsvRow, type CsvRow } from '../../src/shared/csv-contract';
import identityConflicts from '../fixtures/import/identity-conflicts.csv?raw';
import mixedShapes from '../fixtures/import/mixed-shapes.csv?raw';

function variantRow(slug: string, sku: string, values: string[]): CsvRow {
  const row = Object.fromEntries(CSV_HEADER.map((column) => [column, ''])) as CsvRow;
  row.product_slug = slug;
  row.product_name = slug;
  row.base_price = '1.00';
  row.currency = 'USD';
  row.product_status = 'active';
  row.access_title = 'Download';
  row.access_instructions = 'Open';
  row.variant_sku = sku;
  row.variant_status = 'enabled';
  values.forEach((value, index) => {
    row[`option_${index + 1}_name` as keyof CsvRow] = `Option ${index + 1}`;
    row[`option_${index + 1}_value` as keyof CsvRow] = value;
  });
  return row;
}

function matrix(slug: string, dimensions: number[]): string {
  const rows: CsvRow[] = [];
  const visit = (selected: string[], position: number) => {
    if (position === dimensions.length) {
      rows.push(variantRow(slug, `${slug.toUpperCase()}-${rows.length + 1}`, selected));
      return;
    }
    for (let value = 0; value < dimensions[position]; value += 1) visit([...selected, `V${position + 1}-${value + 1}`], position + 1);
  };
  visit([], 0);
  return `${CSV_HEADER_LINE}\n${rows.map(serializeCsvRow).join('\n')}\n`;
}

function validation(source: string) {
  return validateCsvRows(parseCsvBytes(new TextEncoder().encode(source)).rows);
}

describe('CSV Product group classifier', () => {
  it('keeps an eligible peer when another Product mixes simple and Variant shape', () => {
    const result = validation(mixedShapes);
    expect(result.eligibleGroupCount).toBe(1);
    expect(result.groups.map((group) => [group.productSlug, group.eligible, group.issue?.code])).toEqual([
      ['eligible-simple', true, undefined],
      ['mixed-shape', false, 'mixed_product_shape'],
    ]);
  });

  it('rejects Store-wide duplicate SKU identities across Product groups', () => {
    const result = validation(identityConflicts);
    expect(result.eligibleGroupCount).toBe(0);
    expect(result.groups.every((group) => group.issue?.code === 'identity_conflict')).toBe(true);
  });

  it('derives Cartesian confirmation and hard-cap behavior from distinct option values', () => {
    const ten = validation(matrix('ten', [2, 5])).groups[0];
    const twelve = validation(matrix('twelve', [2, 6])).groups[0];
    const thirty = validation(matrix('thirty', [5, 6])).groups[0];
    const thirtyOne = validation(matrix('thirty-one', [31])).groups[0];
    const thirtyTwo = validation(matrix('thirty-two', [4, 8])).groups[0];
    expect([ten.derivedCombinationCount, ten.confirmationRequired, ten.eligible]).toEqual([10, false, true]);
    expect([twelve.derivedCombinationCount, twelve.confirmationRequired, twelve.eligible]).toEqual([12, true, true]);
    expect([thirty.derivedCombinationCount, thirty.confirmationRequired, thirty.eligible]).toEqual([30, true, true]);
    expect([thirtyOne.derivedCombinationCount, thirtyOne.confirmationRequired, thirtyOne.eligible, thirtyOne.issue?.code]).toEqual([31, false, false, 'variant_limit_exceeded']);
    expect([thirtyTwo.derivedCombinationCount, thirtyTwo.confirmationRequired, thirtyTwo.eligible, thirtyTwo.issue?.code]).toEqual([32, false, false, 'variant_limit_exceeded']);
  });

  it('rejects sparse and duplicate Cartesian coverage and gapped option pairs', () => {
    const sparseRows = matrix('sparse', [2, 2]).trimEnd().split('\n');
    sparseRows.pop();
    const sparse = validation(`${sparseRows.join('\n')}\n`).groups[0];
    expect(sparse.issue?.code).toBe('matrix_incomplete');

    const duplicateRows = matrix('duplicate', [2]).trimEnd().split('\n');
    duplicateRows.push(duplicateRows[1]);
    const duplicate = validation(`${duplicateRows.join('\n')}\n`).groups[0];
    expect(duplicate.issue?.code).toBe('duplicate_sku');

    const gap = variantRow('gap', 'GAP-1', ['Dark']);
    gap.option_3_name = 'License';
    gap.option_3_value = 'Personal';
    const gapped = validation(`${CSV_HEADER_LINE}\n${serializeCsvRow(gap)}\n`).groups[0];
    expect(gapped.issue?.code).toBe('option_pair_gapped');
  });
});
