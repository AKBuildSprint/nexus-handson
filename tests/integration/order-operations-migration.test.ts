import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { digestOrderCapability, findOrderIdByCapability } from '../../src/orders/private-access';
import {
  applyCatalogMigrations,
  catalogMigrations,
  resetCatalogThrough,
} from '../support/catalog-test-env';

const STORE = 'store_nexus';
const CUSTOMER_ID = 'cust_legacy_ada';
const SENTINEL_FILE = 'private/files/s3-upgrade-sentinel';
const CAPABILITY_SIMPLE = 'A'.repeat(43);
const CAPABILITY_VARIANT = 'B'.repeat(43);
const CAPABILITY_ZERO = 'C'.repeat(43);

type LegacyOrder = {
  id: string;
  reference: string;
  customerName: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  line: {
    id: string;
    productId: string;
    productName: string;
    variantId: string | null;
    variantSku: string | null;
    selectedOptionsJson: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    accessTitle: string;
    accessInstructions: string;
    privateFileKey: string | null;
  };
  history: { id: string; createdAt: string };
  access: { id: string; createdAt: string };
  idempotency: { id: string; requestKey: string; createdAt: string };
  capability: string;
  digest: string;
};

async function historyColumns(): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT name FROM pragma_table_info('order_history') ORDER BY cid",
  ).all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

async function appliedMigrationNames(): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

async function seedLegacyOrders(): Promise<LegacyOrder[]> {
  const digestSimple = await digestOrderCapability(CAPABILITY_SIMPLE);
  const digestVariant = await digestOrderCapability(CAPABILITY_VARIANT);
  const digestZero = await digestOrderCapability(CAPABILITY_ZERO);

  const orders: LegacyOrder[] = [
    {
      id: 'ord_legacy_simple',
      reference: 'NX-LEGACY-SIMPLE',
      customerName: 'Ada Historic',
      totalMinor: 2400,
      currency: 'USD',
      createdAt: '2026-01-01T10:00:00.000Z',
      line: {
        id: 'line_legacy_simple',
        productId: 'prod_notes',
        productName: 'Field Notes',
        variantId: null,
        variantSku: null,
        selectedOptionsJson: '[]',
        quantity: 1,
        unitPriceMinor: 2400,
        lineTotalMinor: 2400,
        accessTitle: 'Download Field Notes',
        accessInstructions: 'Open the PDF from your order',
        privateFileKey: null,
      },
      history: { id: 'hist_legacy_simple', createdAt: '2026-01-01T10:00:00.100Z' },
      access: { id: 'access_legacy_simple', createdAt: '2026-01-01T10:00:00.200Z' },
      idempotency: {
        id: 'idem_legacy_simple',
        requestKey: 'legacy-request-01',
        createdAt: '2026-01-01T10:00:00.300Z',
      },
      capability: CAPABILITY_SIMPLE,
      digest: digestSimple,
    },
    {
      id: 'ord_legacy_variant',
      reference: 'NX-LEGACY-VARIANT',
      customerName: 'Ada Later',
      totalMinor: 3600,
      currency: 'USD',
      createdAt: '2026-01-02T10:00:00.000Z',
      line: {
        id: 'line_legacy_variant',
        productId: 'prod_focus',
        productName: 'Focus Pack',
        variantId: 'var_focus_dark',
        variantSku: 'FOCUS-DARK',
        selectedOptionsJson: '[{"name":"Theme","value":"Dark"}]',
        quantity: 1,
        unitPriceMinor: 3600,
        lineTotalMinor: 3600,
        accessTitle: 'Download Focus Pack',
        accessInstructions: 'Use the private file from your order',
        privateFileKey: SENTINEL_FILE,
      },
      history: { id: 'hist_legacy_variant', createdAt: '2026-01-02T10:00:00.100Z' },
      access: { id: 'access_legacy_variant', createdAt: '2026-01-02T10:00:00.200Z' },
      idempotency: {
        id: 'idem_legacy_variant',
        requestKey: 'legacy-request-02',
        createdAt: '2026-01-02T10:00:00.300Z',
      },
      capability: CAPABILITY_VARIANT,
      digest: digestVariant,
    },
    {
      id: 'ord_legacy_zero',
      reference: 'NX-LEGACY-ZERO',
      customerName: 'Ada Zero',
      totalMinor: 0,
      currency: 'USD',
      createdAt: '2026-01-03T10:00:00.000Z',
      line: {
        id: 'line_legacy_zero',
        productId: 'prod_notes',
        productName: 'Field Notes',
        variantId: null,
        variantSku: null,
        selectedOptionsJson: '[]',
        quantity: 1,
        unitPriceMinor: 0,
        lineTotalMinor: 0,
        accessTitle: 'Download Field Notes',
        accessInstructions: 'Open the PDF from your order',
        privateFileKey: null,
      },
      history: { id: 'hist_legacy_zero', createdAt: '2026-01-03T10:00:00.100Z' },
      access: { id: 'access_legacy_zero', createdAt: '2026-01-03T10:00:00.200Z' },
      idempotency: {
        id: 'idem_legacy_zero',
        requestKey: 'legacy-request-03',
        createdAt: '2026-01-03T10:00:00.300Z',
      },
      capability: CAPABILITY_ZERO,
      digest: digestZero,
    },
  ];

  await env.DB.prepare(
    "INSERT INTO customers (id,store_id,name,email_normalized,created_at,updated_at) VALUES (?,?,?,?,?,?)",
  ).bind(
    CUSTOMER_ID,
    STORE,
    'Ada Live',
    'ada@example.test',
    '2026-01-01T09:00:00.000Z',
    '2026-01-03T09:00:00.000Z',
  ).run();

  for (const order of orders) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO order_lines (
           id, store_id, order_id, product_id, product_name, variant_id, variant_sku,
           selected_options_json, quantity, unit_price_minor, line_total_minor, currency,
           access_title, access_instructions, private_file_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        order.line.id,
        STORE,
        order.id,
        order.line.productId,
        order.line.productName,
        order.line.variantId,
        order.line.variantSku,
        order.line.selectedOptionsJson,
        order.line.quantity,
        order.line.unitPriceMinor,
        order.line.lineTotalMinor,
        order.currency,
        order.line.accessTitle,
        order.line.accessInstructions,
        order.line.privateFileKey,
      ),
      env.DB.prepare(
        `INSERT INTO orders (
           id, store_id, reference, customer_id, customer_name, customer_email_normalized,
           status, currency, total_minor, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?)`,
      ).bind(
        order.id,
        STORE,
        order.reference,
        CUSTOMER_ID,
        order.customerName,
        'ada@example.test',
        order.currency,
        order.totalMinor,
        order.createdAt,
      ),
      env.DB.prepare(
        'INSERT INTO order_history (id, store_id, order_id, status, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(order.history.id, STORE, order.id, 'pending_payment', order.history.createdAt),
      env.DB.prepare(
        'INSERT INTO order_access (id, store_id, order_id, capability_digest, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(order.access.id, STORE, order.id, order.digest, order.access.createdAt),
      env.DB.prepare(
        `INSERT INTO order_idempotency (
           id, store_id, request_key, order_id, capability_digest, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        order.idempotency.id,
        STORE,
        order.idempotency.requestKey,
        order.id,
        order.digest,
        order.idempotency.createdAt,
      ),
    ]);
  }

  return orders;
}

async function readUpgradedOrder(id: string) {
  return env.DB.prepare(
    `SELECT id, store_id, reference, customer_id, customer_name, customer_email_normalized,
            status, currency, total_minor, created_at
       FROM orders WHERE id = ?`,
  ).bind(id).first<{
    id: string;
    store_id: string;
    reference: string;
    customer_id: string;
    customer_name: string;
    customer_email_normalized: string;
    status: string;
    currency: string;
    total_minor: number;
    created_at: string;
  }>();
}

async function readUpgradedLine(id: string) {
  return env.DB.prepare(
    `SELECT id, product_id, product_name, variant_id, variant_sku, selected_options_json,
            quantity, unit_price_minor, line_total_minor, currency,
            access_title, access_instructions, private_file_key
       FROM order_lines WHERE id = ?`,
  ).bind(id).first<{
    id: string;
    product_id: string;
    product_name: string;
    variant_id: string | null;
    variant_sku: string | null;
    selected_options_json: string;
    quantity: number;
    unit_price_minor: number;
    line_total_minor: number;
    currency: string;
    access_title: string;
    access_instructions: string;
    private_file_key: string | null;
  }>();
}

describe('order operations migration', () => {
  it('keeps 0005 under the D1 Free statement budget', () => {
    const migration = catalogMigrations.find((entry) => entry.name === '0005-order-operations.sql');
    expect(migration).toBeDefined();
    expect((migration?.queries.length ?? 0) + 1).toBeLessThanOrEqual(50);
  });

  it('upgrades populated 0004 Orders without changing identity, snapshots, or lookup', async () => {
    await resetCatalogThrough(4);
    const seeded = await seedLegacyOrders();
    await applyCatalogMigrations(5);

    const staging = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE '_s3_%'",
    ).all<{ name: string }>();
    expect(staging.results).toEqual([]);
    expect(await env.DB.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });

    for (const order of seeded) {
      const upgraded = await readUpgradedOrder(order.id);
      expect(upgraded?.id === order.id).toBe(true);
      expect(upgraded?.reference === order.reference).toBe(true);
      expect(upgraded?.customer_id === CUSTOMER_ID).toBe(true);
      expect(upgraded?.customer_name === order.customerName).toBe(true);
      expect(upgraded?.status).toBe('pending_payment');
      expect(upgraded?.currency === order.currency).toBe(true);
      expect(upgraded?.total_minor === order.totalMinor).toBe(true);
      expect(upgraded?.created_at === order.createdAt).toBe(true);

      const line = await readUpgradedLine(order.line.id);
      expect(line?.product_id === order.line.productId).toBe(true);
      expect(line?.product_name === order.line.productName).toBe(true);
      expect(line?.variant_id === order.line.variantId).toBe(true);
      expect(line?.variant_sku === order.line.variantSku).toBe(true);
      expect(line?.selected_options_json === order.line.selectedOptionsJson).toBe(true);
      expect(line?.quantity === order.line.quantity).toBe(true);
      expect(line?.unit_price_minor === order.line.unitPriceMinor).toBe(true);
      expect(line?.line_total_minor === order.line.lineTotalMinor).toBe(true);
      expect(line?.access_title === order.line.accessTitle).toBe(true);
      expect(line?.access_instructions === order.line.accessInstructions).toBe(true);
      expect(line?.private_file_key === order.line.privateFileKey).toBe(true);

      const history = await env.DB.prepare(
        'SELECT id, status, created_at, action, source, from_status FROM order_history WHERE id = ?',
      ).bind(order.history.id).first<{
        id: string;
        status: string;
        created_at: string;
        action: string;
        source: string;
        from_status: string | null;
      }>();
      expect(history?.id === order.history.id).toBe(true);
      expect(history?.status).toBe('pending_payment');
      expect(history?.created_at === order.history.createdAt).toBe(true);
      expect(history?.action).toBe('order_created');
      expect(history?.source).toBe('customer_capability');
      expect(history?.from_status).toBeNull();

      const access = await env.DB.prepare(
        'SELECT id, capability_digest, created_at FROM order_access WHERE id = ?',
      ).bind(order.access.id).first<{ id: string; capability_digest: string; created_at: string }>();
      expect(access?.id === order.access.id).toBe(true);
      expect(access?.capability_digest === order.digest).toBe(true);
      expect(access?.created_at === order.access.createdAt).toBe(true);

      const idempotency = await env.DB.prepare(
        'SELECT id, request_key, order_id, capability_digest, created_at FROM order_idempotency WHERE id = ?',
      ).bind(order.idempotency.id).first<{
        id: string;
        request_key: string;
        order_id: string;
        capability_digest: string;
        created_at: string;
      }>();
      expect(idempotency?.id === order.idempotency.id).toBe(true);
      expect(idempotency?.request_key === order.idempotency.requestKey).toBe(true);
      expect(idempotency?.order_id === order.id).toBe(true);
      expect(idempotency?.capability_digest === order.digest).toBe(true);
      expect(idempotency?.created_at === order.idempotency.createdAt).toBe(true);

      expect(await findOrderIdByCapability({
        database: env.DB,
        reference: order.reference,
        capability: order.capability,
      })).toBe(order.id);
    }

    const before = await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count');
    await applyCatalogMigrations(5);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count')).toBe(before);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_refund_requests').first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_commands').first<number>('count')).toBe(0);
  });

  it('rejects illegal Order graph mutations on the upgraded schema', async () => {
    await resetCatalogThrough(5);
    await env.DB.prepare(
      "INSERT INTO customers (id,store_id,name,email_normalized) VALUES ('cust_a','store_nexus','Ada','ada@example.test')",
    ).run();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO order_lines (id,store_id,order_id,product_id,product_name,selected_options_json,quantity,unit_price_minor,line_total_minor,currency,access_title,access_instructions) VALUES ('line_a','store_nexus','ord_a','prod_snapshot','Snapshot','[]',1,100,100,'USD','','')",
      ),
      env.DB.prepare(
        "INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,currency,total_minor) VALUES ('ord_a','store_nexus','NX-ORDER-A','cust_a','Ada','ada@example.test','USD',100)",
      ),
    ]);

    await expect(env.DB.prepare(
      "INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,currency,total_minor) VALUES ('bad_paid','store_nexus','NX-PAID','cust_a','Ada','ada@example.test','paid','USD',100)",
    ).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(
      "INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,currency,total_minor) VALUES ('bad_refunded','store_nexus','NX-REFUNDED','cust_a','Ada','ada@example.test','refunded','USD',100)",
    ).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(
      "INSERT INTO order_lines (id,store_id,order_id,product_id,product_name,selected_options_json,quantity,unit_price_minor,line_total_minor,currency,access_title,access_instructions) VALUES ('line_b','store_nexus','ord_a','prod_snapshot','Snapshot','[]',1,100,100,'USD','','')",
    ).run()).rejects.toThrow(/UNIQUE/);
    await expect(env.DB.prepare("DELETE FROM order_lines WHERE id='line_a'").run()).rejects.toThrow(/order_line_required/);
    await expect(env.DB.prepare("UPDATE order_lines SET order_id='ord_other' WHERE id='line_a'").run())
      .rejects.toThrow(/order_line_parent_immutable/);

    await env.DB.prepare("INSERT INTO stores (id,slug,name) VALUES ('order_other','order-other','Order Other')").run();
    await env.DB.prepare(
      "INSERT INTO customers (id,store_id,name,email_normalized) VALUES ('cust_other','order_other','Other','other@example.test')",
    ).run();
    await expect(env.DB.batch([
      env.DB.prepare(
        "INSERT INTO order_lines (id,store_id,order_id,product_id,product_name,selected_options_json,quantity,unit_price_minor,line_total_minor,currency,access_title,access_instructions) VALUES ('line_cross','store_nexus','ord_cross','prod_snapshot','Snapshot','[]',1,100,100,'USD','','')",
      ),
      env.DB.prepare(
        "INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,currency,total_minor) VALUES ('ord_cross','store_nexus','NX-CROSS','cust_other','Other','other@example.test','USD',100)",
      ),
    ])).rejects.toThrow(/FOREIGN KEY/);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_lines WHERE id='line_cross'").first<number>('count')).toBe(0);

    await env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,status) VALUES ('hist_created','store_nexus','ord_a','pending_payment')",
    ).run();
    await expect(env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,status,action,source,from_status) VALUES ('hist_created_from','store_nexus','ord_a','pending_payment','order_created','customer_capability','pending_payment')",
    ).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,status,action,source,from_status) VALUES ('hist_completed_null','store_nexus','ord_a','completed','order_completed','console',NULL)",
    ).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,status,action,source,from_status) VALUES ('hist_wrong_source','store_nexus','ord_a','completed','order_completed','customer_capability','pending_payment')",
    ).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,status,action,source,from_status) VALUES ('hist_refund_from_pending','store_nexus','ord_a','completed','refund_requested','customer_capability','pending_payment')",
    ).run()).rejects.toThrow(/CHECK/);

    await env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,status,action,source,from_status) VALUES ('hist_completed','store_nexus','ord_a','completed','order_completed','console','pending_payment')",
    ).run();
    await expect(env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,status,action,source,from_status) VALUES ('hist_cancelled','store_nexus','ord_a','cancelled','order_cancelled','console','pending_payment')",
    ).run()).rejects.toThrow(/UNIQUE/);

    await env.DB.prepare(
      "INSERT INTO order_refund_requests (id,store_id,order_id,reason) VALUES ('refund_a','store_nexus','ord_a','Need a review')",
    ).run();
    await expect(env.DB.prepare(
      "INSERT INTO order_refund_requests (id,store_id,order_id,reason) VALUES ('refund_b','store_nexus','ord_a','Another reason')",
    ).run()).rejects.toThrow(/UNIQUE/);
    await expect(env.DB.prepare(
      "INSERT INTO order_refund_requests (id,store_id,order_id,status,reason) VALUES ('refund_bad','store_nexus','ord_a','approved','Need a review')",
    ).run()).rejects.toThrow(/CHECK/);
  });

  it('rolls a faulty 0005 apply back to populated 0004 then applies the real migration', async () => {
    await resetCatalogThrough(4);
    const seeded = await seedLegacyOrders();
    const original = catalogMigrations.find((entry) => entry.name === '0005-order-operations.sql');
    expect(original).toBeDefined();
    const queries = [...original!.queries];
    const restoreIndex = queries.findIndex((query) => (
      /^INSERT INTO orders\b/i.test(query.trim()) && query.includes('_s3_orders')
    ));
    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    queries.splice(restoreIndex + 1, 0, 'INSERT INTO orders (id) VALUES (NULL)');

    await expect(applyD1Migrations(env.DB, [
      ...catalogMigrations.slice(0, 4),
      { name: '0005-order-operations.sql', queries },
    ])).rejects.toThrow();

    expect(await historyColumns()).toEqual(['id', 'store_id', 'order_id', 'status', 'created_at']);
    expect(await appliedMigrationNames()).not.toContain('0005-order-operations.sql');
    expect(await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE name IN ('order_refund_requests','order_commands')",
    ).all()).toMatchObject({ results: [] });
    for (const order of seeded) {
      const row = await env.DB.prepare(
        'SELECT id, reference, status, total_minor, created_at FROM orders WHERE id = ?',
      ).bind(order.id).first<{
        id: string;
        reference: string;
        status: string;
        total_minor: number;
        created_at: string;
      }>();
      expect(row?.id === order.id).toBe(true);
      expect(row?.reference === order.reference).toBe(true);
      expect(row?.status).toBe('pending_payment');
      expect(row?.total_minor === order.totalMinor).toBe(true);
      expect(row?.created_at === order.createdAt).toBe(true);

      const line = await readUpgradedLine(order.line.id);
      expect(line?.id === order.line.id).toBe(true);
      expect(line?.private_file_key === order.line.privateFileKey).toBe(true);
      expect(line?.variant_id === order.line.variantId).toBe(true);
      expect(line?.line_total_minor === order.line.lineTotalMinor).toBe(true);

      const history = await env.DB.prepare(
        'SELECT id, status, created_at FROM order_history WHERE id = ?',
      ).bind(order.history.id).first<{ id: string; status: string; created_at: string }>();
      expect(history?.id === order.history.id).toBe(true);
      expect(history?.status).toBe('pending_payment');
      expect(history?.created_at === order.history.createdAt).toBe(true);

      const access = await env.DB.prepare(
        'SELECT id, capability_digest, created_at FROM order_access WHERE id = ?',
      ).bind(order.access.id).first<{ id: string; capability_digest: string; created_at: string }>();
      expect(access?.id === order.access.id).toBe(true);
      expect(access?.capability_digest === order.digest).toBe(true);

      const idempotency = await env.DB.prepare(
        'SELECT id, request_key, order_id FROM order_idempotency WHERE id = ?',
      ).bind(order.idempotency.id).first<{ id: string; request_key: string; order_id: string }>();
      expect(idempotency?.request_key === order.idempotency.requestKey).toBe(true);
      expect(idempotency?.order_id === order.id).toBe(true);

      expect(await findOrderIdByCapability({
        database: env.DB,
        reference: order.reference,
        capability: order.capability,
      })).toBe(order.id);
    }

    await applyCatalogMigrations(5);
    expect(await appliedMigrationNames()).toContain('0005-order-operations.sql');
    expect(await historyColumns()).toEqual([
      'id', 'store_id', 'order_id', 'status', 'created_at', 'action', 'source', 'from_status',
    ]);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM orders WHERE status='pending_payment'").first<number>('count')).toBe(3);
  });

});
