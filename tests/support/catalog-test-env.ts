import {
  createConsoleSession,
  TEST_BETTER_AUTH_SECRET,
  TEST_CONSOLE_ORIGIN,
} from './identity-test-env';
import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import migrationOne from '../../migrations/0001-store-products.sql?raw';
import migrationTwo from '../../migrations/0002-product-variants.sql?raw';
import migrationThree from '../../migrations/0003-imports.sql?raw';
import migrationFour from '../../migrations/0004-orders.sql?raw';
import migrationFive from '../../migrations/0005-order-operations.sql?raw';
import migrationSix from '../../migrations/0006-order-brief-contract.sql?raw';
import migrationSeven from '../../migrations/0007-manual-payments.sql?raw';
import migrationEight from '../../migrations/0008-better-auth.sql?raw';
import migrationNine from '../../migrations/0009-store-memberships.sql?raw';
import migrationTen from '../../migrations/0010-refund-decisions.sql?raw';
import migrationEleven from '../../migrations/0011-google-account-binding-uniqueness.sql?raw';
import worker from '../../apps/worker/src';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';

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
  { name: '0008-better-auth.sql', queries: splitMigrationSql(migrationEight) },
  { name: '0009-store-memberships.sql', queries: splitMigrationSql(migrationNine) },
  { name: '0010-refund-decisions.sql', queries: splitMigrationSql(migrationTen) },
  { name: '0011-google-account-binding-uniqueness.sql', queries: splitMigrationSql(migrationEleven) },
];

export type CatalogMigrationThrough = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export function applyCatalogMigrations(through: CatalogMigrationThrough = 11): Promise<void> {
  return applyD1Migrations(env.DB, catalogMigrations.slice(0, through));
}

export async function resetCatalogThrough(through: CatalogMigrationThrough): Promise<void> {
  const tables = [
    'order_assignments',
    'order_commands',
    'payments',
    'order_history',
    'order_refund_requests',
    'store_memberships',
    'account',
    'session',
    'verification',
    'rateLimit',
    'user',
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
  return resetCatalogThrough(11);
}

export const TEST_STOREFRONT_ORIGIN = 'https://storefront.test';

export function workerRequest(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const pathname = path.split('?')[0] ?? path;
  if (
    !headers.has('X-Nexus-Order-Contract')
    && (pathname.startsWith('/api/console/orders') || pathname.startsWith('/api/storefront/orders'))
  ) {
    headers.set('X-Nexus-Order-Contract', '2');
  }
  return worker.fetch(new Request(`https://local.invalid${path}`, { ...init, headers }), {
    DB: env.DB,
    FILES: env.FILES,
    STOREFRONT_ORIGIN: TEST_STOREFRONT_ORIGIN,
    CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN,
    BETTER_AUTH_SECRET: TEST_BETTER_AUTH_SECRET,
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
  });
}

let cachedConsoleSession: { cookie: string; userId: string } | null = null;

export async function getConsoleSession(): Promise<{ cookie: string; userId: string }> {
  if (cachedConsoleSession !== null) {
    const exists = await env.DB.prepare(
      `SELECT EXISTS(
         SELECT 1 FROM session
         JOIN store_memberships membership ON membership.user_id = session.userId
        WHERE session.userId = ? AND membership.status = 'active'
       ) AS present`,
    ).bind(cachedConsoleSession.userId).first<number>('present');
    if (exists !== 1) cachedConsoleSession = null;
  }
  const session = cachedConsoleSession ?? await createConsoleSession();
  cachedConsoleSession = session;
  return session;
}

export async function getConsoleIdentity(): Promise<ConsoleIdentityContext> {
  const session = await getConsoleSession();
  const membership = await env.DB.prepare(
    `SELECT id, store_id AS storeId, role, status
       FROM store_memberships WHERE user_id=? AND status='active'`,
  ).bind(session.userId).first<{ id: string; storeId: string; role: 'owner' | 'staff'; status: 'active' }>();
  if (!membership) throw new Error('Expected the default Console membership.');
  return {
    kind: 'console', userId: session.userId, storeId: membership.storeId,
    membershipId: membership.id, role: membership.role, membershipStatus: membership.status,
  };
}

export async function consoleRequest(path: string, init?: RequestInit): Promise<Response> {
  const session = await getConsoleSession();
  const headers = new Headers(init?.headers);
  headers.set('Cookie', session.cookie);
  headers.set('Origin', TEST_CONSOLE_ORIGIN);
  headers.set('Sec-Fetch-Site', 'same-origin');
  return workerRequest(path, { ...init, headers });
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
