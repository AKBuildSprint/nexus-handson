import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { digestOrderCapability, findOrderIdByCapability } from '@nexus/orders/private-access';
import {
  applyCatalogMigrations,
  catalogMigrations,
  resetCatalog,
  resetCatalogThrough,
} from '../support/catalog-test-env';

const STORE = 'store_nexus';
const CUSTOMER_ID = 'cust_brief_ada';
const HASH = 'ab'.repeat(32);
const CAPABILITIES = {
  pending: 'D'.repeat(43),
  paid: 'E'.repeat(43),
  canceled: 'F'.repeat(43),
  refund: 'G'.repeat(43),
} as const;

type SeededGraph = {
  pendingId: string;
  completedId: string;
  cancelledId: string;
  refundedId: string;
  refundId: string;
  completedHistoryId: string;
  refundHistoryId: string;
  completeCommandId: string;
  refundCommandId: string;
  createKey: string;
  capability: string;
  digest: string;
  lineId: string;
  lineSnapshot: string;
  createdAt: string;
  refundReason: string;
  refundCreatedAt: string;
  totalMinor: number;
};

async function appliedMigrationNames(): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

async function tableColumns(table: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT name FROM pragma_table_info(?) ORDER BY cid',
  ).bind(table).all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

async function seedSchema5Graph(): Promise<SeededGraph> {
  const digests = {
    pending: await digestOrderCapability(CAPABILITIES.pending),
    paid: await digestOrderCapability(CAPABILITIES.paid),
    canceled: await digestOrderCapability(CAPABILITIES.canceled),
    refund: await digestOrderCapability(CAPABILITIES.refund),
  };
  await env.DB.prepare(
    "INSERT INTO customers (id,store_id,name,email_normalized,created_at,updated_at) VALUES (?,?,?,?,?,?)",
  ).bind(
    CUSTOMER_ID,
    STORE,
    'Ada Brief',
    'ada-brief@example.test',
    '2026-02-01T09:00:00.000Z',
    '2026-02-01T09:00:00.000Z',
  ).run();

  const orders = [
    {
      id: 'ord_brief_pending',
      reference: 'NX-BRIEF-PENDING',
      status: 'pending_payment',
      lineId: 'line_brief_pending',
      historyId: 'hist_brief_pending_created',
      accessId: 'access_brief_pending',
      idemId: 'idem_brief_pending',
      requestKey: 'brief-create-key01',
      digest: digests.pending,
    },
    {
      id: 'ord_brief_paid',
      reference: 'NX-BRIEF-PAID',
      status: 'completed',
      lineId: 'line_brief_paid',
      historyId: 'hist_brief_paid_created',
      accessId: 'access_brief_paid',
      idemId: 'idem_brief_paid',
      requestKey: 'brief-create-key02',
      digest: digests.paid,
      variantId: 'var_focus_dark',
      variantSku: 'FOCUS-DARK',
    },
    {
      id: 'ord_brief_canceled',
      reference: 'NX-BRIEF-CANCELED',
      status: 'cancelled',
      lineId: 'line_brief_canceled',
      historyId: 'hist_brief_canceled_created',
      accessId: 'access_brief_canceled',
      idemId: 'idem_brief_canceled',
      requestKey: 'brief-create-key03',
      digest: digests.canceled,
    },
    {
      id: 'ord_brief_refund',
      reference: 'NX-BRIEF-REFUND',
      status: 'completed',
      lineId: 'line_brief_refund',
      historyId: 'hist_brief_refund_created',
      accessId: 'access_brief_refund',
      idemId: 'idem_brief_refund',
      requestKey: 'brief-create-key04',
      digest: digests.refund,
    },
  ];

  for (const order of orders) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO order_lines (
           id, store_id, order_id, product_id, product_name, variant_id, variant_sku, selected_options_json,
           quantity, unit_price_minor, line_total_minor, currency, access_title, access_instructions,
           private_file_key
         ) VALUES (?, ?, ?, 'prod_notes', 'Field Notes', ?, ?, '[{"name":"Tone","value":"Quiet"}]', 2, 1200, 2400, 'USD',
           'Download Field Notes', 'Open the PDF from your order', 'private/files/brief-sentinel')`,
      ).bind(order.lineId, STORE, order.id, order.variantId ?? null, order.variantSku ?? null),
      env.DB.prepare(
        `INSERT INTO orders (
           id, store_id, reference, customer_id, customer_name, customer_email_normalized,
           status, currency, total_minor, created_at
         ) VALUES (?, ?, ?, ?, 'Ada Historic', 'ada-brief@example.test', ?, 'USD', 2400, '2026-02-01T10:00:00.000Z')`,
      ).bind(order.id, STORE, order.reference, CUSTOMER_ID, order.status),
      env.DB.prepare(
        `INSERT INTO order_history (id, store_id, order_id, status, created_at, action, source, from_status)
         VALUES (?, ?, ?, 'pending_payment', '2026-02-01T10:00:00.100Z', 'order_created', 'customer_capability', NULL)`,
      ).bind(order.historyId, STORE, order.id),
      env.DB.prepare(
        'INSERT INTO order_access (id, store_id, order_id, capability_digest, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(order.accessId, STORE, order.id, order.digest, '2026-02-01T10:00:00.200Z'),
      env.DB.prepare(
        `INSERT INTO order_idempotency (id, store_id, request_key, order_id, capability_digest, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(order.idemId, STORE, order.requestKey, order.id, order.digest, '2026-02-01T10:00:00.300Z'),
    ]);
  }

  await env.DB.prepare(
    `INSERT INTO order_history (id, store_id, order_id, status, created_at, action, source, from_status)
     VALUES ('hist_brief_paid_done', ?, 'ord_brief_paid', 'completed', '2026-02-01T11:00:00.000Z',
       'order_completed', 'console', 'pending_payment')`,
  ).bind(STORE).run();
  await env.DB.prepare(
    `INSERT INTO order_history (id, store_id, order_id, status, created_at, action, source, from_status)
     VALUES ('hist_brief_canceled_done', ?, 'ord_brief_canceled', 'cancelled', '2026-02-01T11:05:00.000Z',
       'order_cancelled', 'console', 'pending_payment')`,
  ).bind(STORE).run();
  await env.DB.prepare(
    `INSERT INTO order_history (id, store_id, order_id, status, created_at, action, source, from_status)
     VALUES ('hist_brief_refund_done', ?, 'ord_brief_refund', 'completed', '2026-02-01T11:10:00.000Z',
       'order_completed', 'console', 'pending_payment')`,
  ).bind(STORE).run();
  await env.DB.prepare(
    `INSERT INTO order_refund_requests (id, store_id, order_id, reason, created_at)
     VALUES ('refund_brief_open', ?, 'ord_brief_refund', 'Need a review', '2026-02-01T12:00:00.000Z')`,
  ).bind(STORE).run();
  await env.DB.prepare(
    `INSERT INTO order_history (id, store_id, order_id, status, created_at, action, source, from_status)
     VALUES ('hist_brief_refund_asked', ?, 'ord_brief_refund', 'completed', '2026-02-01T12:00:00.100Z',
       'refund_requested', 'customer_capability', 'completed')`,
  ).bind(STORE).run();
  await env.DB.prepare(
    `INSERT INTO order_commands (id, store_id, request_key, order_id, action, payload_hash, result_history_id, created_at)
     VALUES ('cmd_brief_complete', ?, 'brief-complete-0001', 'ord_brief_paid', 'complete', ?, 'hist_brief_paid_done',
       '2026-02-01T11:00:00.050Z')`,
  ).bind(STORE, HASH).run();
  await env.DB.prepare(
    `INSERT INTO order_commands (id, store_id, request_key, order_id, action, payload_hash, result_history_id, created_at)
     VALUES ('cmd_brief_refund', ?, 'brief-refund-000001', 'ord_brief_refund', 'request_refund', ?, 'hist_brief_refund_asked',
       '2026-02-01T12:00:00.150Z')`,
  ).bind(STORE, HASH).run();

  return {
    pendingId: 'ord_brief_pending',
    completedId: 'ord_brief_paid',
    cancelledId: 'ord_brief_canceled',
    refundedId: 'ord_brief_refund',
    refundId: 'refund_brief_open',
    completedHistoryId: 'hist_brief_paid_done',
    refundHistoryId: 'hist_brief_refund_asked',
    completeCommandId: 'cmd_brief_complete',
    refundCommandId: 'cmd_brief_refund',
    createKey: 'brief-create-key02',
    capability: CAPABILITIES.paid,
    digest: digests.paid,
    lineId: 'line_brief_paid',
    lineSnapshot: '[{"name":"Tone","value":"Quiet"}]',
    createdAt: '2026-02-01T10:00:00.000Z',
    refundReason: 'Need a review',
    refundCreatedAt: '2026-02-01T12:00:00.000Z',
    totalMinor: 2400,
  };
}

async function insertCustomer(id = CUSTOMER_ID) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO customers (id,store_id,name,email_normalized) VALUES (?,'store_nexus','Ada','ada-brief@example.test')",
  ).bind(id).run();
}

function lineInsert(id: string, orderId: string, position: number, total: number, currency = 'USD') {
  return env.DB.prepare(
    `INSERT INTO order_lines (
       id, store_id, order_id, product_id, product_name, selected_options_json, quantity,
       unit_price_minor, line_total_minor, currency, access_title, access_instructions, position
     ) VALUES (?, 'store_nexus', ?, 'prod_notes', 'Field Notes', '[]', 1, ?, ?, ?, '', '', ?)`,
  ).bind(id, orderId, total, total, currency, position);
}

function orderInsert(id: string, reference: string, total: number, currency = 'USD') {
  return env.DB.prepare(
    `INSERT INTO orders (
       id, store_id, reference, customer_id, customer_name, customer_email_normalized, currency, total_minor
     ) VALUES (?, 'store_nexus', ?, ?, 'Ada', 'ada-brief@example.test', ?, ?)`,
  ).bind(id, reference, CUSTOMER_ID, currency, total);
}

describe('order brief contract migration', () => {
  it('keeps 0006 and 0007 under the D1 Free statement budget', () => {
    for (const name of ['0006-order-brief-contract.sql', '0007-manual-payments.sql']) {
      const migration = catalogMigrations.find((entry) => entry.name === name);
      expect(migration).toBeDefined();
      expect((migration?.queries.length ?? 0) + 1).toBeLessThanOrEqual(50);
    }
  });

  it('upgrades populated 0005 Orders without inventing payments or fulfillment', async () => {
    await resetCatalogThrough(5);
    const seeded = await seedSchema5Graph();
    await applyCatalogMigrations(7);

    expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_s6_%'").all())
      .toMatchObject({ results: [] });
    expect(await env.DB.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });
    expect(await appliedMigrationNames()).toEqual(expect.arrayContaining([
      '0006-order-brief-contract.sql',
      '0007-manual-payments.sql',
    ]));
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments').first<number>('count')).toBe(0);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE action = 'order_fulfilled'",
    ).first<number>('count')).toBe(0);

    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?')
      .bind(seeded.pendingId).first<string>('status')).toBe('pending');
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?')
      .bind(seeded.completedId).first<string>('status')).toBe('paid');
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?')
      .bind(seeded.cancelledId).first<string>('status')).toBe('canceled');
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?')
      .bind(seeded.refundedId).first<string>('status')).toBe('paid');

    const paid = await env.DB.prepare(
      `SELECT id, reference, total_minor, created_at, payment_reference FROM orders WHERE id = ?`,
    ).bind(seeded.completedId).first<{
      id: string;
      reference: string;
      total_minor: number;
      created_at: string;
      payment_reference: string;
    }>();
    expect(paid?.id).toBe(seeded.completedId);
    expect(paid?.reference).toBe('NX-BRIEF-PAID');
    expect(paid?.total_minor).toBe(seeded.totalMinor);
    expect(paid?.created_at).toBe(seeded.createdAt);
    expect(paid?.payment_reference.startsWith('NP')).toBe(true);

    const reread = await env.DB.prepare('SELECT payment_reference FROM orders WHERE id = ?')
      .bind(seeded.completedId).first<string>('payment_reference');
    await applyCatalogMigrations(7);
    expect(await env.DB.prepare('SELECT payment_reference FROM orders WHERE id = ?')
      .bind(seeded.completedId).first<string>('payment_reference')).toBe(reread);

    const refs = await env.DB.prepare('SELECT payment_reference FROM orders').all<{ payment_reference: string }>();
    const uniqueRefs: Record<string, true> = {};
    for (const row of refs.results) uniqueRefs[row.payment_reference] = true;
    expect(Object.keys(uniqueRefs).length).toBe(refs.results.length);
    const line = await env.DB.prepare(
      `SELECT selected_options_json, private_file_key, position, line_total_minor, variant_id, variant_sku,
              access_title, access_instructions, quantity, unit_price_minor, product_name
       FROM order_lines WHERE id = ?`,
    ).bind(seeded.lineId).first<{
      selected_options_json: string;
      private_file_key: string;
      position: number;
      line_total_minor: number;
      variant_id: string;
      variant_sku: string;
      access_title: string;
      access_instructions: string;
      quantity: number;
      unit_price_minor: number;
      product_name: string;
    }>();
    expect(line).toEqual({
      selected_options_json: seeded.lineSnapshot,
      private_file_key: 'private/files/brief-sentinel',
      position: 0,
      line_total_minor: 2400,
      variant_id: 'var_focus_dark',
      variant_sku: 'FOCUS-DARK',
      access_title: 'Download Field Notes',
      access_instructions: 'Open the PDF from your order',
      quantity: 2,
      unit_price_minor: 1200,
      product_name: 'Field Notes',
    });

    const access = await env.DB.prepare(
      'SELECT id, capability_digest, created_at FROM order_access WHERE order_id = ?',
    ).bind(seeded.completedId).first<{ id: string; capability_digest: string; created_at: string }>();
    expect(access).toEqual({
      id: 'access_brief_paid',
      capability_digest: seeded.digest,
      created_at: '2026-02-01T10:00:00.200Z',
    });
    expect(await findOrderIdByCapability({
      database: env.DB,
      storeId: STORE,
      reference: 'NX-BRIEF-PAID',
      capability: seeded.capability,
    })).toBe(seeded.completedId);

    const createKey = await env.DB.prepare(
      'SELECT id, request_key, created_at FROM order_idempotency WHERE order_id = ?',
    ).bind(seeded.completedId).first<{ id: string; request_key: string; created_at: string }>();
    expect(createKey).toEqual({
      id: 'idem_brief_paid',
      request_key: seeded.createKey,
      created_at: '2026-02-01T10:00:00.300Z',
    });

    const completedHistory = await env.DB.prepare(
      'SELECT id, action, source, from_status, status, contract_version, actor_id, refund_request_id, created_at FROM order_history WHERE id = ?',
    ).bind(seeded.completedHistoryId).first<{
      id: string;
      action: string;
      source: string;
      from_status: string;
      status: string;
      contract_version: number;
      actor_id: string | null;
      refund_request_id: string | null;
      created_at: string;
    }>();
    expect(completedHistory).toEqual({
      id: seeded.completedHistoryId,
      action: 'order_completed',
      source: 'console',
      from_status: 'pending',
      status: 'paid',
      contract_version: 1,
      actor_id: null,
      refund_request_id: null,
      created_at: '2026-02-01T11:00:00.000Z',
    });

    const refund = await env.DB.prepare(
      'SELECT id, reason, created_at, status, actor_source, actor_id FROM order_refund_requests WHERE id = ?',
    ).bind(seeded.refundId).first<{
      id: string;
      reason: string;
      created_at: string;
      status: string;
      actor_source: string;
      actor_id: string | null;
    }>();
    expect(refund).toEqual({
      id: seeded.refundId,
      reason: seeded.refundReason,
      created_at: seeded.refundCreatedAt,
      status: 'pending',
      actor_source: 'storefront',
      actor_id: null,
    });

    const refundHistory = await env.DB.prepare(
      'SELECT refund_request_id, status, from_status, contract_version FROM order_history WHERE id = ?',
    ).bind(seeded.refundHistoryId).first<{
      refund_request_id: string;
      status: string;
      from_status: string;
      contract_version: number;
    }>();
    expect(refundHistory).toEqual({
      refund_request_id: seeded.refundId,
      status: 'paid',
      from_status: 'paid',
      contract_version: 1,
    });

    const completeCommand = await env.DB.prepare(
      'SELECT action, payload_hash, result_history_id, contract_version, result_refund_request_id, request_key, created_at FROM order_commands WHERE id = ?',
    ).bind(seeded.completeCommandId).first<{
      action: string;
      payload_hash: string;
      result_history_id: string;
      contract_version: number;
      result_refund_request_id: string | null;
      request_key: string;
      created_at: string;
    }>();
    expect(completeCommand).toEqual({
      action: 'complete',
      payload_hash: HASH,
      result_history_id: seeded.completedHistoryId,
      contract_version: 1,
      result_refund_request_id: null,
      request_key: 'brief-complete-0001',
      created_at: '2026-02-01T11:00:00.050Z',
    });

    const refundCommand = await env.DB.prepare(
      'SELECT result_refund_request_id, contract_version FROM order_commands WHERE id = ?',
    ).bind(seeded.refundCommandId).first<{
      result_refund_request_id: string;
      contract_version: number;
    }>();
    expect(refundCommand).toEqual({
      result_refund_request_id: seeded.refundId,
      contract_version: 1,
    });
  });

  it('rolls a faulty 0006 apply back to populated 0005 then retries', async () => {
    await resetCatalogThrough(5);
    const seeded = await seedSchema5Graph();
    const original = catalogMigrations.find((entry) => entry.name === '0006-order-brief-contract.sql');
    expect(original).toBeDefined();
    const queries = [...original!.queries];
    const restoreIndex = queries.findIndex((query) => (
      /^INSERT INTO orders\b/i.test(query.trim()) && query.includes('_s6_orders')
    ));
    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    queries.splice(restoreIndex + 1, 0, 'INSERT INTO orders (id) VALUES (NULL)');

    await expect(applyD1Migrations(env.DB, [
      ...catalogMigrations.slice(0, 5),
      { name: '0006-order-brief-contract.sql', queries },
    ])).rejects.toThrow();

    expect(await appliedMigrationNames()).not.toContain('0006-order-brief-contract.sql');
    expect(await tableColumns('orders')).not.toContain('payment_reference');
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?')
      .bind(seeded.completedId).first<string>('status')).toBe('completed');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_refund_requests').first<number>('count')).toBe(1);
    expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_s6_%'").all())
      .toMatchObject({ results: [] });

    await applyCatalogMigrations(7);
    expect(await appliedMigrationNames()).toContain('0006-order-brief-contract.sql');
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?')
      .bind(seeded.completedId).first<string>('status')).toBe('paid');
  });

  it('keeps 0006 applied when 0007 fails and retries 0007 without reset', async () => {
    await resetCatalogThrough(5);
    const seeded = await seedSchema5Graph();
    await applyCatalogMigrations(6);
    const original = catalogMigrations.find((entry) => entry.name === '0007-manual-payments.sql');
    expect(original).toBeDefined();
    const queries = [...original!.queries];
    queries.splice(1, 0, 'INSERT INTO payments (id) VALUES (NULL)');

    await expect(applyD1Migrations(env.DB, [
      ...catalogMigrations.slice(0, 6),
      { name: '0007-manual-payments.sql', queries },
    ])).rejects.toThrow();

    expect(await appliedMigrationNames()).toContain('0006-order-brief-contract.sql');
    expect(await appliedMigrationNames()).not.toContain('0007-manual-payments.sql');
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id = ?')
      .bind(seeded.completedId).first<string>('status')).toBe('paid');
    expect(await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'payments'",
    ).first()).toBeNull();

    await applyCatalogMigrations(7);
    expect(await appliedMigrationNames()).toContain('0007-manual-payments.sql');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments').first<number>('count')).toBe(0);
  });

  it('resets a schema7 graph that already has refunds, commands, and a payment', async () => {
    await resetCatalogThrough(5);
    const seeded = await seedSchema5Graph();
    await applyCatalogMigrations(7);
    await env.DB.prepare(
      `INSERT INTO payments (
         id, store_id, order_id, source, method, external_reference, amount_minor, currency, status,
         history_id, recorded_actor_source, recorded_actor_id
       ) VALUES ('pay_brief_1', ?, ?, 'manual', 'bank transfer', 'EXT-1', 2400, 'USD', 'succeeded', ?,
         'bootstrap_owner', NULL)`,
    ).bind(STORE, seeded.completedId, seeded.completedHistoryId).run();

    await expect(resetCatalog()).resolves.toBeUndefined();
    expect(await appliedMigrationNames()).toContain('0007-manual-payments.sql');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count')).toBe(0);
  });

  it('enforces 1-10 line aggregate, freeze, and currency parent rules on schema7', async () => {
    await resetCatalog();
    await insertCustomer();

    await env.DB.batch([
      lineInsert('line_ok_0', 'ord_two', 0, 100),
      lineInsert('line_ok_1', 'ord_two', 1, 150),
      orderInsert('ord_two', 'NX-TWO', 250),
    ]);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_lines WHERE order_id='ord_two'")
      .first<number>('count')).toBe(2);

    await expect(env.DB.prepare(
      "INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,currency,total_minor) VALUES ('ord_zero','store_nexus','NX-ZERO',?,'Ada','ada-brief@example.test','USD',0)",
    ).bind(CUSTOMER_ID).run()).rejects.toThrow(/order_lines_aggregate_invalid/);

    const eleven = Array.from({ length: 11 }, (_, index) => lineInsert(`line_11_${index}`, 'ord_eleven', index, 10));
    eleven.push(orderInsert('ord_eleven', 'NX-ELEVEN', 110));
    await expect(env.DB.batch(eleven)).rejects.toThrow(/order_lines_aggregate_invalid/);

    await expect(env.DB.batch([
      lineInsert('line_sum_0', 'ord_sum', 0, 100),
      orderInsert('ord_sum', 'NX-SUM', 150),
    ])).rejects.toThrow(/order_lines_aggregate_invalid/);

    await expect(env.DB.batch([
      lineInsert('line_cur_0', 'ord_cur', 0, 100, 'EUR'),
      orderInsert('ord_cur', 'NX-CUR', 100, 'USD'),
    ])).rejects.toThrow(/order_lines_aggregate_invalid|FOREIGN KEY/);

    await env.DB.prepare("INSERT INTO stores (id,slug,name) VALUES ('order_other','order-other','Order Other')").run();
    await env.DB.prepare(
      "INSERT INTO customers (id,store_id,name,email_normalized) VALUES ('cust_other','order_other','Other','other@example.test')",
    ).run();
    await expect(env.DB.batch([
      lineInsert('line_cross', 'ord_cross', 0, 100),
      env.DB.prepare(
        "INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,currency,total_minor) VALUES ('ord_cross','store_nexus','NX-CROSS','cust_other','Other','other@example.test','USD',100)",
      ),
    ])).rejects.toThrow(/FOREIGN KEY/);
    await expect(env.DB.batch([
      lineInsert('line_xstore_ok', 'ord_xstore', 0, 100),
      env.DB.prepare(
        `INSERT INTO order_lines (
           id, store_id, order_id, product_id, product_name, selected_options_json, quantity,
           unit_price_minor, line_total_minor, currency, access_title, access_instructions, position
         ) VALUES ('line_xstore', 'order_other', 'ord_xstore', 'prod_notes', 'Field Notes', '[]', 1, 100, 100, 'USD', '', '', 0)`,
      ),
      orderInsert('ord_xstore', 'NX-XSTORE', 100),
    ])).rejects.toThrow(/FOREIGN KEY/);

    await expect(lineInsert('line_late', 'ord_two', 2, 10).run()).rejects.toThrow(/order_line_frozen/);
    await expect(env.DB.prepare("UPDATE order_lines SET quantity=2, line_total_minor=200 WHERE id='line_ok_0'").run())
      .rejects.toThrow(/order_line_immutable/);
    await expect(env.DB.prepare("UPDATE order_lines SET order_id='ord_other' WHERE id='line_ok_0'").run())
      .rejects.toThrow(/order_line_immutable/);
    await expect(env.DB.prepare("DELETE FROM order_lines WHERE id='line_ok_0'").run())
      .rejects.toThrow(/order_line_immutable/);
    await expect(env.DB.prepare("UPDATE orders SET total_minor=1 WHERE id='ord_two'").run())
      .rejects.toThrow(/order_money_immutable/);

    await expect(env.DB.prepare(
      "UPDATE orders SET payment_reference=(SELECT payment_reference FROM orders WHERE id='ord_two') WHERE id='ord_two'",
    ).run()).rejects.toThrow(/order_money_immutable/);
  });

  it('lets paid and fulfilled history coexist while blocking duplicate decision events', async () => {
    await resetCatalogThrough(5);
    const seeded = await seedSchema5Graph();
    await applyCatalogMigrations(7);

    await env.DB.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status, contract_version)
       VALUES ('hist_brief_fulfill', ?, ?, 'fulfilled', 'order_fulfilled', 'bootstrap_owner', 'paid', 2)`,
    ).bind(STORE, seeded.completedId).run();

    await expect(env.DB.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status, contract_version)
       VALUES ('hist_brief_paid_dup', ?, ?, 'paid', 'order_paid', 'bootstrap_owner', 'pending', 2)`,
    ).bind(STORE, seeded.completedId).run()).rejects.toThrow(/UNIQUE/);
    await expect(env.DB.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status, contract_version)
       VALUES ('hist_brief_fulfill_dup', ?, ?, 'fulfilled', 'order_fulfilled', 'bootstrap_owner', 'paid', 2)`,
    ).bind(STORE, seeded.completedId).run()).rejects.toThrow(/UNIQUE/);

    await resetCatalog();
    await insertCustomer();
    await env.DB.batch([
      lineInsert('line_hist', 'ord_hist', 0, 100),
      orderInsert('ord_hist', 'NX-HIST', 100),
    ]);
    await env.DB.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status, contract_version)
       VALUES ('hist_new_created', 'store_nexus', 'ord_hist', 'pending', 'order_created', 'storefront', NULL, 2)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status, contract_version)
       VALUES ('hist_new_paid', 'store_nexus', 'ord_hist', 'paid', 'order_paid', 'bootstrap_owner', 'pending', 2)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status, contract_version)
       VALUES ('hist_new_fulfill', 'store_nexus', 'ord_hist', 'fulfilled', 'order_fulfilled', 'bootstrap_owner', 'paid', 2)`,
    ).run();
    await expect(env.DB.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status, contract_version)
       VALUES ('hist_new_paid_dup', 'store_nexus', 'ord_hist', 'paid', 'order_paid', 'bootstrap_owner', 'pending', 2)`,
    ).run()).rejects.toThrow(/UNIQUE/);
    await expect(env.DB.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status, contract_version)
       VALUES ('hist_null_paid', 'store_nexus', 'ord_hist', 'paid', 'order_paid', 'bootstrap_owner', NULL, 2)`,
    ).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(
      `INSERT INTO order_commands (id, store_id, request_key, order_id, action, payload_hash, result_history_id, contract_version)
       VALUES ('cmd_v2_complete', 'store_nexus', 'brief-complete-v200', 'ord_hist', 'complete', ?, 'hist_new_paid', 2)`,
    ).bind(HASH).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(
      `INSERT INTO order_commands (id, store_id, request_key, order_id, action, payload_hash, result_history_id, contract_version)
       VALUES ('cmd_v1_paid', 'store_nexus', 'brief-mark-paid-v100', 'ord_hist', 'mark_paid', ?, 'hist_new_paid', 1)`,
    ).bind(HASH).run()).rejects.toThrow(/CHECK/);
  });

  it('enforces global payment_reference uniqueness', async () => {
    await resetCatalog();
    await insertCustomer();
    await env.DB.batch([
      lineInsert('line_ref_a', 'ord_ref_a', 0, 100),
      orderInsert('ord_ref_a', 'NX-REF-A', 100),
    ]);
    const reference = await env.DB.prepare(
      "SELECT payment_reference FROM orders WHERE id='ord_ref_a'",
    ).first<string>('payment_reference');
    await expect(env.DB.batch([
      lineInsert('line_ref_b', 'ord_ref_b', 0, 100),
      env.DB.prepare(
        `INSERT INTO orders (
           id, store_id, reference, customer_id, customer_name, customer_email_normalized,
           currency, total_minor, payment_reference
         ) VALUES ('ord_ref_b', 'store_nexus', 'NX-REF-B', ?, 'Ada', 'ada-brief@example.test', 'USD', 100, ?)`,
      ).bind(CUSTOMER_ID, reference),
    ])).rejects.toThrow(/UNIQUE/);
  });
});
