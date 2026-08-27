import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { preflightExactMatch } from '../../src/import/exact-match';
import { ImportPersistenceError, executeImportWrite, IMPORT_TOTAL_STATEMENTS } from '../../src/import/import-write';
import { parseCsvBytes } from '../../src/import/csv-parser';
import { validateCsvRows } from '../../src/import/csv-validator';
import { CSV_CONTENT_TYPE, CSV_FILENAME_HEADER, CSV_HEADER, CSV_HEADER_LINE, serializeCsvRow, type CsvRow, type ImportResultResponse } from '../../src/shared/csv-contract';
import identityConflicts from '../fixtures/import/identity-conflicts.csv?raw';
import mixedShapes from '../fixtures/import/mixed-shapes.csv?raw';
import templateFixture from '../fixtures/import/unified-template.csv?raw';
import worstCase from '../fixtures/import/worst-case-500-rows.csv?raw';
import { resetCatalog, workerRequest } from '../support/catalog-test-env';

const template = templateFixture.replaceAll('\r\n', '\n');

function simpleRow(slug: string): CsvRow {
  const row = Object.fromEntries(CSV_HEADER.map((column) => [column, ''])) as CsvRow;
  return {
    ...row,
    product_slug: slug,
    product_name: slug,
    base_price: '1.00',
    currency: 'USD',
    product_status: 'active',
    access_title: 'Download',
    access_instructions: 'Open',
  };
}

async function clearImportObjects() {
  const objects = await env.FILES.list({ prefix: 'imports/' });
  if (objects.objects.length > 0) await env.FILES.delete(objects.objects.map((object) => object.key));
}

async function postCsv(source: string | Uint8Array, confirm = false) {
  let body: string | ArrayBuffer;
  if (typeof source === 'string') {
    body = source;
  } else {
    body = new ArrayBuffer(source.byteLength);
    new Uint8Array(body).set(source);
  }
  const response = await workerRequest('/api/console/imports', {
    method: 'POST',
    headers: {
      'Content-Type': CSV_CONTENT_TYPE,
      [CSV_FILENAME_HEADER]: encodeURIComponent('products.csv'),
      ...(confirm ? { 'X-Nexus-Confirm-Variants': 'true' } : {}),
    },
    body,
  });
  return response;
}

function parsedValidation(source: string) {
  return validateCsvRows(parseCsvBytes(new TextEncoder().encode(source)).rows);
}

describe('CSV R2 and D1 lifecycle', () => {
  beforeEach(async () => {
    await resetCatalog();
    await clearImportObjects();
  });

  it('serves and imports the exact template, retains the original, then re-imports as Duplicate', async () => {
    const templateResponse = await workerRequest('/api/console/imports/template');
    expect(templateResponse.headers.get('Content-Type')).toBe(CSV_CONTENT_TYPE);
    expect(templateResponse.headers.get('Content-Disposition')).toBe('attachment; filename="nexus-product-import-template.csv"');
    expect(await templateResponse.text()).toBe(template);

    const firstResponse = await postCsv(template);
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as ImportResultResponse;
    expect(first.counts).toEqual({ added: 3, duplicate: 0, rejected: 0 });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM imports').first<number>('count')).toBe(1);
    expect((await env.FILES.list({ prefix: 'imports/' })).objects).toHaveLength(1);

    const before = await env.DB.prepare("SELECT revision, import_fingerprint FROM products WHERE slug='focus-pack'").first();
    const repeat = await (await postCsv(template)).json() as ImportResultResponse;
    expect(repeat.counts).toEqual({ added: 0, duplicate: 3, rejected: 0 });
    expect(await env.DB.prepare("SELECT revision, import_fingerprint FROM products WHERE slug='focus-pack'").first()).toEqual(before);
    expect((await env.FILES.list({ prefix: 'imports/' })).objects).toHaveLength(2);
  });

  it('retains expected rejected groups and commits eligible peers from the unchanged original', async () => {
    const response = await postCsv(mixedShapes);
    expect(response.status).toBe(200);
    const result = await response.json() as ImportResultResponse;
    expect(result.counts).toEqual({ added: 1, duplicate: 0, rejected: 2 });
    expect(result.groups.map((group) => [group.productSlug, group.outcome])).toEqual([
      ['eligible-simple', 'added'],
      ['mixed-shape', 'rejected'],
    ]);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM products WHERE slug='eligible-simple'").first<number>('count')).toBe(1);
    expect((await env.FILES.list({ prefix: 'imports/' })).objects).toHaveLength(1);
  });

  it('rejects only a title-cased status group while an eligible peer commits in source order', async () => {
    const invalidStatus = simpleRow('invalid-status');
    invalidStatus.product_status = 'Active';
    const eligible = simpleRow('status-peer');
    const source = `${CSV_HEADER_LINE}\n${[invalidStatus, eligible].map(serializeCsvRow).join('\n')}\n`;
    const response = await postCsv(source);
    expect(response.status).toBe(200);
    const result = await response.json() as ImportResultResponse;
    expect(result.groups.map((group) => [group.productSlug, group.outcome, group.rows[0].code])).toEqual([
      ['invalid-status', 'rejected', 'status_invalid'],
      ['status-peer', 'added', null],
    ]);
    expect((await env.FILES.list({ prefix: 'imports/' })).objects).toHaveLength(1);
  });

  it('rejects a 31-plus Product group while committing and retaining an eligible peer', async () => {
    const rows = [simpleRow('eligible-peer')];
    for (let theme = 1; theme <= 4; theme += 1) {
      for (let license = 1; license <= 8; license += 1) {
        const row = simpleRow('over-limit-pack');
        row.product_name = 'Over Limit Pack';
        row.variant_sku = `OVER-${theme}-${license}`;
        row.variant_status = 'enabled';
        row.option_1_name = 'Theme';
        row.option_1_value = `Theme ${theme}`;
        row.option_2_name = 'License';
        row.option_2_value = `License ${license}`;
        rows.push(row);
      }
    }
    const source = `${CSV_HEADER_LINE}\n${rows.map(serializeCsvRow).join('\n')}\n`;
    const response = await postCsv(source);
    expect(response.status).toBe(200);
    const result = await response.json() as ImportResultResponse;
    expect(result.counts).toEqual({ added: 1, duplicate: 0, rejected: 32 });
    expect(result.groups.find((group) => group.productSlug === 'over-limit-pack')).toMatchObject({
      derivedCombinationCount: 32,
      outcome: 'rejected',
    });
    expect(await env.DB.prepare("SELECT count(*) AS count FROM products WHERE slug='eligible-peer'").first<number>('count')).toBe(1);
    expect((await env.FILES.list({ prefix: 'imports/' })).objects).toHaveLength(1);
  });

  it('retains server-side identity rejection metadata without catalog writes', async () => {
    const response = await postCsv(identityConflicts);
    expect(response.status).toBe(200);
    const result = await response.json() as ImportResultResponse;
    expect(result.counts).toEqual({ added: 0, duplicate: 0, rejected: 2 });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM products').first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM imports').first<number>('count')).toBe(1);
    expect((await env.FILES.list({ prefix: 'imports/' })).objects).toHaveLength(1);
  });

  it('deletes or avoids the original for fatal UTF-8, byte, row-limit, and missing-confirmation failures', async () => {
    const invalidUtf = await postCsv(Uint8Array.of(0xff));
    expect(invalidUtf.status).toBe(400);
    expect((await postCsv(new Uint8Array(1_000_001))).status).toBe(413);
    const rows501 = `${CSV_HEADER_LINE}\n${Array.from({ length: 501 }, (_, index) => serializeCsvRow(simpleRow(`row-${index + 1}`))).join('\n')}\n`;
    expect((await postCsv(rows501)).status).toBe(413);

    const warningRows: CsvRow[] = [];
    for (let theme = 1; theme <= 2; theme += 1) {
      for (let license = 1; license <= 6; license += 1) {
        const row = simpleRow('warning-pack');
        row.variant_sku = `WARN-${theme}-${license}`;
        row.variant_status = 'enabled';
        row.option_1_name = 'Theme';
        row.option_1_value = `Theme ${theme}`;
        row.option_2_name = 'License';
        row.option_2_value = `License ${license}`;
        warningRows.push(row);
      }
    }
    const warning = `${CSV_HEADER_LINE}\n${warningRows.map(serializeCsvRow).join('\n')}\n`;
    const missingConfirmation = await postCsv(warning);
    expect(missingConfirmation.status).toBe(422);
    expect((await missingConfirmation.json() as { error: { code: string } }).error.code).toBe('variant_confirmation_required');
    expect((await env.FILES.list({ prefix: 'imports/' })).objects).toHaveLength(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM imports').first<number>('count')).toBe(0);
    expect((await postCsv(warning, true)).status).toBe(200);
    expect((await env.FILES.list({ prefix: 'imports/' })).objects).toHaveLength(1);
  });

  it('deletes the original and rolls back catalog rows on a D1 batch failure', async () => {
    await env.DB.prepare("CREATE TRIGGER force_import_failure BEFORE INSERT ON imports BEGIN SELECT RAISE(ABORT, 'forced'); END").run();
    const response = await postCsv(template);
    expect(response.status).toBe(500);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM products').first<number>('count')).toBe(0);
    expect((await env.FILES.list({ prefix: 'imports/' })).objects).toHaveLength(0);
  });

  it('imports the all-new 500-row fixture as 8,501 records with the fixed 45-statement architecture', async () => {
    const plan = await preflightExactMatch(env.DB, parsedValidation(worstCase));
    expect([plan.products.length, plan.groups.length, plan.values.length, plan.variants.length, plan.memberships.length]).toEqual([500, 2500, 2500, 500, 2500]);
    const result = await executeImportWrite({
      database: env.DB,
      plan,
      importId: 'imp_worst_case',
      filename: 'worst-case-500-rows.csv',
      sizeBytes: new TextEncoder().encode(worstCase).byteLength,
      privateObjectKey: 'imports/worst-case.csv',
    });
    expect(result.counts).toEqual({ added: 500, duplicate: 0, rejected: 0 });
    expect(IMPORT_TOTAL_STATEMENTS).toBe(45);
    const counts = await Promise.all(['products', 'product_option_groups', 'product_option_values', 'product_variants', 'product_variant_values', 'imports'].map((table) => env.DB.prepare(`SELECT count(*) AS count FROM ${table}`).first<number>('count')));
    expect(counts).toEqual([500, 2500, 2500, 500, 2500, 1]);
  });

  it('fails guarded statement 45 on concurrent drift and rolls back every batch-created row', async () => {
    expect((await postCsv(template)).status).toBe(200);
    const extra = serializeCsvRow(simpleRow('batch-new-peer'));
    const source = `${template.trimEnd()}\n${extra}\n`;
    const plan = await preflightExactMatch(env.DB, parsedValidation(source));
    await env.DB.prepare("UPDATE products SET revision=revision+1 WHERE slug='focus-pack'").run();
    let failure: unknown;
    try {
      await executeImportWrite({ database: env.DB, plan, importId: 'imp_drift', filename: 'drift.csv', sizeBytes: source.length, privateObjectKey: 'imports/drift.csv' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ImportPersistenceError);
    expect((failure as ImportPersistenceError).statementCount).toBe(45);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM products WHERE slug='batch-new-peer'").first<number>('count')).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM imports WHERE id='imp_drift'").first<number>('count')).toBe(0);
  });
});
