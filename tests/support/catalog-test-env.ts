import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import migrationOne from '../../migrations/0001-store-products.sql?raw';
import migrationTwo from '../../migrations/0002-product-variants.sql?raw';
import migrationThree from '../../migrations/0003-imports.sql?raw';
import migrationFour from '../../migrations/0004-orders.sql?raw';
import migrationFive from '../../migrations/0005-order-operations.sql?raw';
import migrationSix from '../../migrations/0006-order-brief-contract.sql?raw';
import migrationSeven from '../../migrations/0007-manual-payments.sql?raw';
import worker from '../../src/worker';

function splitMigrationSql(sql: string): string[] {
  const queries: string[] = [];
  let statement = '';
  let quote: "'" | '"' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    statement += character;

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        statement += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote !== null) {
      if (character === quote && next === quote) {
        statement += next;
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '-' && next === '-') {
      statement += next;
      index += 1;
      lineComment = true;
      continue;
    }
    if (character === '/' && next === '*') {
      statement += next;
      index += 1;
      blockComment = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character !== ';') continue;

    const trimmed = statement.trim();
    const trigger = /^CREATE\s+TRIGGER\b/i.test(trimmed);
    if (trigger && !/\bEND;$/i.test(trimmed)) continue;
    if (trimmed !== '' && !/^PRAGMA\b/i.test(trimmed)) queries.push(trimmed);
    statement = '';
  }

  const trailing = statement.trim();
  if (trailing !== '' && !/^PRAGMA\b/i.test(trailing)) queries.push(trailing);
  return queries;
}

export const catalogMigrations: D1Migration[] = [
  { name: '0001-store-products.sql', queries: splitMigrationSql(migrationOne) },
  { name: '0002-product-variants.sql', queries: splitMigrationSql(migrationTwo) },
  { name: '0003-imports.sql', queries: splitMigrationSql(migrationThree) },
  { name: '0004-orders.sql', queries: splitMigrationSql(migrationFour) },
  { name: '0005-order-operations.sql', queries: splitMigrationSql(migrationFive) },
  { name: '0006-order-brief-contract.sql', queries: splitMigrationSql(migrationSix) },
  { name: '0007-manual-payments.sql', queries: splitMigrationSql(migrationSeven) },
];

export type CatalogMigrationThrough = 4 | 5 | 6 | 7;

export function applyCatalogMigrations(through: CatalogMigrationThrough = 7): Promise<void> {
  return applyD1Migrations(env.DB, catalogMigrations.slice(0, through));
}

export async function resetCatalogThrough(through: CatalogMigrationThrough): Promise<void> {
  const tables = [
    'order_commands',
    'payments',
    'order_history',
    'order_refund_requests',
    'order_idempotency',
    'order_access',
    'order_lines',
    'orders',
    'customers',
    'product_variant_values',
    'product_variants',
    'product_option_values',
    'product_option_groups',
    'imports',
    'products',
    'stores',
    'd1_migrations',
  ];
  await env.DB.batch(tables.map((table) => env.DB.prepare(`DROP TABLE IF EXISTS ${table}`)));
  await applyCatalogMigrations(through);
}

export async function resetCatalog(): Promise<void> {
  return resetCatalogThrough(7);
}

export const TEST_STOREFRONT_ORIGIN = 'https://storefront.test';

export function workerRequest(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://local.invalid${path}`, init), {
    DB: env.DB,
    FILES: env.FILES,
    STOREFRONT_ORIGIN: TEST_STOREFRONT_ORIGIN,
    ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
  });
}

export const SIMPLE_CORE = {
  name: 'Field Notes',
  basePrice: '24.00',
  currency: 'USD',
  status: 'active' as const,
  publicDescription: 'A concise guide',
  delivery: { accessTitle: 'Download Field Notes', accessInstructions: 'Open the PDF from your order' },
};

export const VARIANT_CORE = {
  ...SIMPLE_CORE,
  name: 'Focus Pack',
  basePrice: '36.00',
  status: 'draft' as const,
};

export function oneVariantSchema() {
  return {
    groups: [{
      draftRef: 'group-theme',
      id: null,
      name: 'Theme',
      position: 0,
      participating: true,
      values: [{ draftRef: 'value-dark', id: null, label: 'Dark', position: 0 }],
    }],
    rows: [{
      id: null,
      selectedValueRefs: ['value-dark'],
      sku: 'FOCUS-DARK',
      status: 'enabled' as const,
      priceOverride: null,
      delivery: { source: 'product_default' as const },
    }],
    confirmCombinations: false,
  };
}
