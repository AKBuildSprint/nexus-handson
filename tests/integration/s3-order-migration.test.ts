import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createOrder } from '@nexus/orders/order-write';
import { digestOrderCapability, readPrivateOrder } from '@nexus/orders/private-access';
import { applyCatalogMigrations, applyS2Migrations } from '../support/catalog-test-env';

const CAPABILITY = 'A'.repeat(43);
const CREATED_AT = '2026-01-15T12:00:00.000Z';
const DOMAIN_TABLES = [
  'customers',
  'imports',
  'order_access',
  'order_commands',
  'order_history',
  'order_idempotency',
  'order_lines',
  'orders',
  'product_option_groups',
  'product_option_values',
  'product_variant_values',
  'product_variants',
  'products',
  'refund_requests',
  'stores',
] as const;

const RESET_TABLES = [
  'order_commands',
  'order_idempotency',
  'order_access',
  'order_history',
  'refund_requests',
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
  'orders_s3',
  'order_lines_s3',
  'order_access_s3',
  'order_idempotency_s3',
  'order_history_s3',
  '_s2_history_cardinality_guard',
];

async function domainTableNames(): Promise<string[]> {
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations', '_cf_METADATA') ORDER BY name",
  ).all<{ name: string }>();
  return tables.results.map((row) => row.name);
}

async function tableRows(table: string): Promise<Record<string, unknown>[]> {
  const rows = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY id`).all<Record<string, unknown>>();
  return rows.results;
}

async function seedValidS2Order(): Promise<{ digest: string }> {
  const digest = await digestOrderCapability(CAPABILITY);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customers (id,store_id,name,email_normalized,created_at,updated_at) VALUES ('cust_s2','store_nexus','Ada Lovelace','ada@example.test',?,?)",
    ).bind(CREATED_AT, CREATED_AT),
    env.DB.prepare(
      `INSERT INTO order_lines (
         id,store_id,order_id,product_id,product_name,variant_id,variant_sku,selected_options_json,
         quantity,unit_price_minor,line_total_minor,currency,access_title,access_instructions,private_file_key
       ) VALUES (
         'line_s2','store_nexus','ord_s2','prod_snapshot','Field Notes',NULL,NULL,'[]',
         2,2400,4800,'USD','Download','Use the private page','delivery/original.pdf'
       )`,
    ),
    env.DB.prepare(
      `INSERT INTO orders (
         id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,currency,total_minor,created_at
       ) VALUES (
         'ord_s2','store_nexus','NX-S2-PRESERVE-01','cust_s2','Ada Lovelace','ada@example.test','pending_payment','USD',4800,?
       )`,
    ).bind(CREATED_AT),
    env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,status,created_at) VALUES ('hist_s2','store_nexus','ord_s2','pending_payment',?)",
    ).bind(CREATED_AT),
    env.DB.prepare(
      'INSERT INTO order_access (id,store_id,order_id,capability_digest,created_at) VALUES (\'access_s2\',\'store_nexus\',\'ord_s2\',?,?)',
    ).bind(digest, CREATED_AT),
    env.DB.prepare(
      'INSERT INTO order_idempotency (id,store_id,request_key,order_id,capability_digest,created_at) VALUES (\'idem_s2\',\'store_nexus\',\'s2-create-key-0001\',\'ord_s2\',?,?)',
    ).bind(digest, CREATED_AT),
  ]);
  return { digest };
}

async function seedLineAndOrder(ids: {
  lineId: string;
  orderId: string;
  reference: string;
  status: 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled';
}): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO order_lines (
         id,store_id,order_id,product_id,product_name,selected_options_json,quantity,unit_price_minor,line_total_minor,
         currency,access_title,access_instructions
       ) VALUES (?, 'store_nexus', ?, 'prod_snapshot', 'Snapshot', '[]', 1, 100, 100, 'USD', '', '')`,
    ).bind(ids.lineId, ids.orderId),
    env.DB.prepare(
      `INSERT INTO orders (
         id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,currency,total_minor
       ) VALUES (?, 'store_nexus', ?, 'cust_s2', 'Ada Lovelace', 'ada@example.test', ?, 'USD', 100)`,
    ).bind(ids.orderId, ids.reference, ids.status),
  ]);
}

beforeEach(async () => {
  await env.DB.batch(RESET_TABLES.map((table) => env.DB.prepare(`DROP TABLE IF EXISTS ${table}`)));
  await applyS2Migrations();
});

describe('S3 order migration from real S2 data', () => {
  it('copies every S2 order row through 0005 and keeps private replay identities', async () => {
    const { digest } = await seedValidS2Order();
    const before = {
      customers: await tableRows('customers'),
      orders: await tableRows('orders'),
      order_lines: await tableRows('order_lines'),
      order_access: await tableRows('order_access'),
      order_idempotency: await tableRows('order_idempotency'),
      order_history: await tableRows('order_history'),
    };

    await applyCatalogMigrations();

    expect(await domainTableNames()).toEqual([...DOMAIN_TABLES]);
    expect(
      (await env.DB.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%\\_s3%' ESCAPE '\\'").all<{ name: string }>())
        .results,
    ).toEqual([]);
    expect(await env.DB.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });
    const tableSql = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('orders','order_lines','order_access','order_idempotency','order_history','refund_requests','order_commands')",
    ).all<{ sql: string }>();
    expect(tableSql.results.map((row) => row.sql).join('\n')).not.toMatch(/_s3/);

    expect(await tableRows('customers')).toEqual(before.customers);
    expect(await tableRows('orders')).toEqual(before.orders);
    expect(await tableRows('order_lines')).toEqual(before.order_lines);
    expect(await tableRows('order_access')).toEqual(before.order_access);
    expect(await tableRows('order_idempotency')).toEqual(before.order_idempotency);
    expect(await tableRows('order_history')).toEqual([
      {
        id: 'hist_s2',
        store_id: 'store_nexus',
        order_id: 'ord_s2',
        sequence: 0,
        action: 'order_created',
        previous_status: null,
        status: 'pending_payment',
        source: 'storefront',
        refund_request_id: null,
        created_at: CREATED_AT,
      },
    ]);
    expect(before.order_history).toEqual([
      {
        id: 'hist_s2',
        store_id: 'store_nexus',
        order_id: 'ord_s2',
        status: 'pending_payment',
        created_at: CREATED_AT,
      },
    ]);
    expect(before.order_access[0]?.capability_digest).toBe(digest);

    const privateOrder = await readPrivateOrder({
      database: env.DB,
      reference: 'NX-S2-PRESERVE-01',
      capability: CAPABILITY,
    });
    expect(privateOrder).toMatchObject({
      reference: 'NX-S2-PRESERVE-01',
      status: 'pending_payment',
      quantity: 2,
      unitPriceMinor: 2400,
      totalMinor: 4800,
      currency: 'USD',
      product: { name: 'Field Notes', variant: null },
    });
    const replay = await createOrder({
      database: env.DB,
      body: {
        productId: 'prod_snapshot',
        variantId: null,
        quantity: 2,
        customer: { name: 'Ada Lovelace', email: 'ada@example.test' },
      },
      idempotencyKey: 's2-create-key-0001',
      capability: CAPABILITY,
    });
    expect(replay.reference).toBe('NX-S2-PRESERVE-01');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count')).toBe(1);
  });

  it('aborts zero-history and two-history S2 drift without rewriting the original graph', async () => {
    await seedValidS2Order();
    await env.DB.prepare("DELETE FROM order_history WHERE id='hist_s2'").run();
    const zeroBefore = {
      tables: await domainTableNames(),
      orders: await tableRows('orders'),
      history: await tableRows('order_history'),
    };
    await expect(applyCatalogMigrations()).rejects.toThrow();
    expect(await domainTableNames()).toEqual(zeroBefore.tables);
    expect(await tableRows('orders')).toEqual(zeroBefore.orders);
    expect(await tableRows('order_history')).toEqual(zeroBefore.history);

    await env.DB.batch(RESET_TABLES.map((table) => env.DB.prepare(`DROP TABLE IF EXISTS ${table}`)));
    await applyS2Migrations();
    await seedValidS2Order();
    await env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,status,created_at) VALUES ('hist_s2_extra','store_nexus','ord_s2','pending_payment',?)",
    ).bind(CREATED_AT).run();
    const twoBefore = {
      tables: await domainTableNames(),
      history: await tableRows('order_history'),
      access: await tableRows('order_access'),
    };
    await expect(applyCatalogMigrations()).rejects.toThrow();
    expect(await domainTableNames()).toEqual(twoBefore.tables);
    expect(await tableRows('order_history')).toEqual(twoBefore.history);
    expect(await tableRows('order_access')).toEqual(twoBefore.access);
  });

  it('accepts the four Order statuses, rejects garbage and illegal edges, and keeps one-line rules', async () => {
    await seedValidS2Order();
    await applyCatalogMigrations();

    await seedLineAndOrder({
      lineId: 'line_paid',
      orderId: 'ord_paid',
      reference: 'NX-PAID',
      status: 'paid',
    });
    await seedLineAndOrder({
      lineId: 'line_fulfilled',
      orderId: 'ord_fulfilled',
      reference: 'NX-FULFILLED',
      status: 'fulfilled',
    });
    await seedLineAndOrder({
      lineId: 'line_cancelled',
      orderId: 'ord_cancelled',
      reference: 'NX-CANCELLED',
      status: 'cancelled',
    });

    await expect(env.DB.prepare(
      "INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,currency,total_minor) VALUES ('ord_garbage','store_nexus','NX-GARBAGE','cust_s2','Ada Lovelace','ada@example.test','refunded','USD',100)",
    ).run()).rejects.toThrow(/CHECK/);

    await expect(env.DB.prepare("UPDATE orders SET status='fulfilled' WHERE id='ord_s2'").run())
      .rejects.toThrow(/order_status_transition/);
    await expect(env.DB.prepare("UPDATE orders SET status='pending_payment' WHERE id='ord_s2'").run())
      .rejects.toThrow(/order_status_transition/);
    await expect(env.DB.prepare("UPDATE orders SET status='cancelled' WHERE id='ord_paid'").run())
      .rejects.toThrow(/order_status_transition/);
    await env.DB.prepare("UPDATE orders SET status='paid' WHERE id='ord_s2'").run();
    await expect(env.DB.prepare("UPDATE orders SET status='paid' WHERE id='ord_s2'").run())
      .rejects.toThrow(/order_status_transition/);
    await env.DB.prepare("UPDATE orders SET status='fulfilled' WHERE id='ord_s2'").run();

    await expect(env.DB.prepare(
      "INSERT INTO order_lines (id,store_id,order_id,product_id,product_name,selected_options_json,quantity,unit_price_minor,line_total_minor,currency,access_title,access_instructions) VALUES ('line_second','store_nexus','ord_paid','prod_snapshot','Snapshot','[]',1,100,100,'USD','','')",
    ).run()).rejects.toThrow(/UNIQUE/);
    await expect(env.DB.prepare("DELETE FROM order_lines WHERE id='line_paid'").run())
      .rejects.toThrow(/order_line_required/);
    await expect(env.DB.prepare("UPDATE order_lines SET order_id='ord_s2' WHERE id='line_paid'").run())
      .rejects.toThrow(/order_line_parent_immutable/);
    await expect(env.DB.batch([
      env.DB.prepare(
        "INSERT INTO order_lines (id,store_id,order_id,product_id,product_name,selected_options_json,quantity,unit_price_minor,line_total_minor,currency,access_title,access_instructions) VALUES ('line_wrong','store_nexus','ord_wrong','prod_snapshot','Snapshot','[]',1,100,999,'USD','','')",
      ),
      env.DB.prepare(
        "INSERT INTO orders (id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,currency,total_minor) VALUES ('ord_wrong','store_nexus','NX-WRONG','cust_s2','Ada Lovelace','ada@example.test','pending_payment','USD',100)",
      ),
    ])).rejects.toThrow();
  });

  it('rejects non-create history with a NULL previous status', async () => {
    await seedValidS2Order();
    await applyCatalogMigrations();
    await seedLineAndOrder({
      lineId: 'line_paid',
      orderId: 'ord_paid',
      reference: 'NX-PAID',
      status: 'paid',
    });
    await env.DB.prepare(
      "INSERT INTO refund_requests (id,store_id,order_id,reason) VALUES ('refund_s2','store_nexus','ord_s2','Need a recorded request')",
    ).run();

    const illegal = [
      ['hist_paid_null', 'ord_s2', 'mark_paid', 'paid', 'console', null],
      ['hist_cancel_null', 'ord_s2', 'cancel', 'cancelled', 'console', null],
      ['hist_fulfilled_null', 'ord_paid', 'mark_fulfilled', 'fulfilled', 'console', null],
      ['hist_refund_null', 'ord_s2', 'refund_requested', 'paid', 'storefront', 'refund_s2'],
    ] as const;
    for (const [id, orderId, action, status, source, refundId] of illegal) {
      await expect(env.DB.prepare(
        `INSERT INTO order_history (
           id,store_id,order_id,sequence,action,previous_status,status,source,refund_request_id
         ) VALUES (?, 'store_nexus', ?, 1, ?, NULL, ?, ?, ?)`,
      ).bind(id, orderId, action, status, source, refundId).run()).rejects.toThrow(/CHECK/);
    }
  });

  it('rejects same-Store cross-Order history and command links', async () => {
    const digest = 'ab'.repeat(32);
    await seedValidS2Order();
    await applyCatalogMigrations();
    await seedLineAndOrder({
      lineId: 'line_paid',
      orderId: 'ord_paid',
      reference: 'NX-PAID',
      status: 'paid',
    });
    await env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,sequence,action,previous_status,status,source) VALUES ('hist_paid','store_nexus','ord_paid',0,'order_created',NULL,'pending_payment','storefront')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO refund_requests (id,store_id,order_id,reason) VALUES ('refund_s2','store_nexus','ord_s2','Need a recorded request')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO refund_requests (id,store_id,order_id,reason) VALUES ('refund_paid','store_nexus','ord_paid','Need a second recorded request')",
    ).run();

    await expect(env.DB.prepare(
      "INSERT INTO order_history (id,store_id,order_id,sequence,action,previous_status,status,source,refund_request_id) VALUES ('hist_cross','store_nexus','ord_paid',1,'refund_requested','paid','paid','storefront','refund_s2')",
    ).run()).rejects.toThrow(/FOREIGN KEY/);
    await expect(env.DB.prepare(
      "INSERT INTO order_commands (id,store_id,request_key,order_id,action,payload_digest,outcome,result_status,history_id) VALUES ('cmd_hist_cross','store_nexus','request-key-cross01','ord_s2','mark_paid',?,'applied','paid','hist_paid')",
    ).bind(digest).run()).rejects.toThrow(/FOREIGN KEY/);
    await expect(env.DB.prepare(
      "INSERT INTO order_commands (id,store_id,request_key,order_id,action,payload_digest,outcome,result_status,history_id,refund_request_id) VALUES ('cmd_refund_cross','store_nexus','request-key-cross02','ord_s2','request_refund',?,'already_applied','paid',NULL,'refund_paid')",
    ).bind(digest).run()).rejects.toThrow(/FOREIGN KEY/);
  });
});
