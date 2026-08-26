import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import {
  CSV_CONTENT_TYPE,
  CSV_FILENAME_HEADER,
  CSV_HEADER_LINE,
  serializeCsvRow,
  type CsvRow,
} from '../../src/shared/csv-contract';

const prefix = 'verify-260826-csv015';
const baseUrl = 'https://nexus-s1-468cba.cpp-software-solutions.workers.dev';
const source = readFileSync('tests/fixtures/import/worst-case-500-rows.csv', 'utf8');
const parsed = Papa.parse<CsvRow>(source, { header: true, skipEmptyLines: true });
if (parsed.errors.length > 0 || parsed.data.length !== 500) {
  throw new Error(`Worst-case fixture is not 500 rows (${parsed.data.length}).`);
}
const rows = parsed.data.map((row, index) => ({
  ...row,
  product_slug: `${prefix}-bulk-${String(index + 1).padStart(4, '0')}`,
  product_name: `${prefix} Bulk ${String(index + 1).padStart(4, '0')}`,
  access_title: `Download ${prefix} Bulk ${String(index + 1).padStart(4, '0')}`,
  variant_sku: `${prefix.toUpperCase()}-BULK-${String(index + 1).padStart(4, '0')}`,
}));
const csv = `${CSV_HEADER_LINE}\n${rows.map(serializeCsvRow).join('\n')}\n`;
const response = await fetch(`${baseUrl}/api/console/imports`, {
  method: 'POST',
  headers: {
    'Content-Type': CSV_CONTENT_TYPE,
    [CSV_FILENAME_HEADER]: encodeURIComponent(`${prefix}-500.csv`),
  },
  body: csv,
});
const body = await response.json() as { counts?: { added?: number } };
if (response.status !== 200 || body.counts?.added !== 500) {
  throw new Error(`CSV-015 reimport failed: ${response.status} ${JSON.stringify(body).slice(0, 400)}`);
}
const directory = path.join('plans/260826-0041-nexus-s1-product-catalog/reports/evidence/remote/CSV-015');
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'remote-500-import-response.json'), `${JSON.stringify({ status: response.status, counts: body.counts }, null, 2)}\n`);
process.stdout.write(`Imported 500 rows (${Buffer.byteLength(csv)} bytes).\n`);
