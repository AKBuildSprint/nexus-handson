import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  applyCatalogMigrations,
  catalogMigrations,
  resetCatalog,
  resetCatalogThrough,
} from '../support/catalog-test-env';

const STORE = 'store_nexus';
const OWNER = 'user_refund_owner';
const STAFF = 'user_refund_staff';
const HASH = 'ab'.repeat(32);

async function tableColumns(table: string): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
    .bind(table).all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

async function tableRows(table: string): Promise<Record<string, unknown>[]> {
  const rows = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all<Record<string, unknown>>();
  return rows.results;
}

async function indexNames(table: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name",
  ).bind(table).all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

async function seedPopulatedSchemaNine(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?)`,
    ).bind(OWNER, 'Refund Owner', 'refund-owner@example.test', 1, '2026-09-12T01:00:00.000Z', '2026-09-12T01:00:00.000Z'),
    env.DB.prepare(
      `INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?)`,
    ).bind(STAFF, 'Refund Staff', 'refund-staff@example.test', 1, '2026-09-12T01:00:00.000Z', '2026-09-12T01:00:00.000Z'),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO store_memberships (id,store_id,user_id,role,status,created_at,updated_at)
       VALUES ('membership_refund_owner',?,?,'owner','active',?,?)`,
    ).bind(STORE, OWNER, '2026-09-12T01:01:00.000Z', '2026-09-12T01:01:00.000Z'),
    env.DB.prepare(
      `INSERT INTO store_memberships (id,store_id,user_id,role,status,created_at,updated_at)
       VALUES ('membership_refund_staff',?,?,'staff','active',?,?)`,
    ).bind(STORE, STAFF, '2026-09-12T01:01:00.000Z', '2026-09-12T01:01:00.000Z'),
    env.DB.prepare(
      `INSERT INTO customers (id,store_id,name,email_normalized,created_at,updated_at)
       VALUES ('customer_refund',?,'Refund Buyer','refund-buyer@example.test',?,?)`,
    ).bind(STORE, '2026-09-12T01:02:00.000Z', '2026-09-12T01:02:00.000Z'),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO order_lines (
         id,store_id,order_id,product_id,product_name,selected_options_json,quantity,
         unit_price_minor,line_total_minor,currency,access_title,access_instructions,private_file_key,position
       ) VALUES ('line_refund_paid',?,'order_refund_paid','product_snapshot','Refund Guide','[]',1,
         2400,2400,'USD','Download','Private evidence','private/refund-paid.pdf',0)`,
    ).bind(STORE),
    env.DB.prepare(
      `INSERT INTO orders (
         id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,
         currency,total_minor,created_at,payment_reference
       ) VALUES ('order_refund_paid',?,'NX-REFUND-PAID','customer_refund','Refund Buyer',
         'refund-buyer@example.test','paid','USD',2400,?,'NP-refund-paid')`,
    ).bind(STORE, '2026-09-12T01:03:00.000Z'),
    env.DB.prepare(
      `INSERT INTO order_lines (
         id,store_id,order_id,product_id,product_name,selected_options_json,quantity,
         unit_price_minor,line_total_minor,currency,access_title,access_instructions,private_file_key,position
       ) VALUES ('line_refund_legacy',?,'order_refund_legacy','product_snapshot','Legacy Guide','[]',1,
         1700,1700,'USD','Download','Legacy private evidence','private/refund-legacy.pdf',0)`,
    ).bind(STORE),
    env.DB.prepare(
      `INSERT INTO orders (
         id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,
         currency,total_minor,created_at,payment_reference
       ) VALUES ('order_refund_legacy',?,'NX-REFUND-LEGACY','customer_refund','Refund Buyer',
         'refund-buyer@example.test','paid','USD',1700,?,'NP-refund-legacy')`,
    ).bind(STORE, '2026-09-12T01:04:00.000Z'),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO order_access (id,store_id,order_id,capability_digest,created_at)
       VALUES ('access_refund_paid',?,'order_refund_paid',?,?)`,
    ).bind(STORE, '1'.repeat(64), '2026-09-12T01:03:01.000Z'),
    env.DB.prepare(
      `INSERT INTO order_access (id,store_id,order_id,capability_digest,created_at)
       VALUES ('access_refund_legacy',?,'order_refund_legacy',?,?)`,
    ).bind(STORE, '2'.repeat(64), '2026-09-12T01:04:01.000Z'),
    env.DB.prepare(
      `INSERT INTO order_idempotency (id,store_id,request_key,order_id,capability_digest,created_at)
       VALUES ('idem_refund_paid',?,'refund-create-paid-01','order_refund_paid',?,?)`,
    ).bind(STORE, '1'.repeat(64), '2026-09-12T01:03:02.000Z'),
    env.DB.prepare(
      `INSERT INTO order_idempotency (id,store_id,request_key,order_id,capability_digest,created_at)
       VALUES ('idem_refund_legacy',?,'refund-create-legacy-01','order_refund_legacy',?,?)`,
    ).bind(STORE, '2'.repeat(64), '2026-09-12T01:04:02.000Z'),
    env.DB.prepare(
      `INSERT INTO order_refund_requests
       (id,store_id,order_id,status,reason,created_at,actor_source,actor_id)
       VALUES ('refund_paid',?,'order_refund_paid','pending','Keep exact requester',?,'user',?)`,
    ).bind(STORE, '2026-09-12T01:08:00.000Z', OWNER),
    env.DB.prepare(
      `INSERT INTO order_refund_requests
       (id,store_id,order_id,status,reason,created_at,actor_source,actor_id)
       VALUES ('refund_legacy',?,'order_refund_legacy','pending','Legacy request',?,'storefront',NULL)`,
    ).bind(STORE, '2026-09-12T01:09:00.000Z'),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO order_history
       (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id)
       VALUES ('history_paid_created',?,'order_refund_paid','pending',?,'order_created','storefront',NULL,NULL,2,NULL,NULL)`,
    ).bind(STORE, '2026-09-12T01:03:00.000Z'),
    env.DB.prepare(
      `INSERT INTO order_history
       (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id)
       VALUES ('history_paid_payment',?,'order_refund_paid','paid',?,'order_paid','user','pending',?,2,NULL,NULL)`,
    ).bind(STORE, '2026-09-12T01:05:00.000Z', OWNER),
    env.DB.prepare(
      `INSERT INTO order_history
       (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id)
       VALUES ('history_paid_refund',?,'order_refund_paid','paid',?,'refund_requested','user','paid',?,2,'refund_paid',NULL)`,
    ).bind(STORE, '2026-09-12T01:08:00.000Z', OWNER),
    env.DB.prepare(
      `INSERT INTO order_history
       (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id)
       VALUES ('history_paid_assignment',?,'order_refund_paid','paid',?,'assigned','user','paid',?,2,NULL,?)`,
    ).bind(STORE, '2026-09-12T01:10:00.000Z', OWNER, STAFF),
    env.DB.prepare(
      `INSERT INTO order_history
       (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id)
       VALUES ('history_legacy_created',?,'order_refund_legacy','pending',?,'order_created','customer_capability',NULL,NULL,1,NULL,NULL)`,
    ).bind(STORE, '2026-09-12T01:04:00.000Z'),
    env.DB.prepare(
      `INSERT INTO order_history
       (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id)
       VALUES ('history_legacy_paid',?,'order_refund_legacy','paid',?,'order_completed','console','pending',NULL,1,NULL,NULL)`,
    ).bind(STORE, '2026-09-12T01:06:00.000Z'),
    env.DB.prepare(
      `INSERT INTO order_history
       (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id)
       VALUES ('history_legacy_refund',?,'order_refund_legacy','paid',?,'refund_requested','customer_capability','paid',NULL,1,'refund_legacy',NULL)`,
    ).bind(STORE, '2026-09-12T01:09:00.000Z'),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO order_commands
       (id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id)
       VALUES ('command_paid',?,'refund-command-paid-01','order_refund_paid','mark_paid',?,'history_paid_payment',?,2,NULL)`,
    ).bind(STORE, HASH, '2026-09-12T01:05:00.000Z'),
    env.DB.prepare(
      `INSERT INTO order_commands
       (id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id)
       VALUES ('command_refund',?,'refund-command-open-01','order_refund_paid','request_refund',?,'history_paid_refund',?,2,'refund_paid')`,
    ).bind(STORE, HASH, '2026-09-12T01:08:00.000Z'),
    env.DB.prepare(
      `INSERT INTO order_commands
       (id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id)
       VALUES ('command_assign',?,'refund-command-assign01','order_refund_paid','assign',?,'history_paid_assignment',?,2,NULL)`,
    ).bind(STORE, HASH, '2026-09-12T01:10:00.000Z'),
    env.DB.prepare(
      `INSERT INTO order_commands
       (id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id)
       VALUES ('command_legacy_paid',?,'refund-legacy-paid-01','order_refund_legacy','complete',?,'history_legacy_paid',?,1,NULL)`,
    ).bind(STORE, HASH, '2026-09-12T01:06:00.000Z'),
    env.DB.prepare(
      `INSERT INTO order_commands
       (id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id)
       VALUES ('command_legacy_refund',?,'refund-legacy-open-01','order_refund_legacy','request_refund',?,'history_legacy_refund',?,1,'refund_legacy')`,
    ).bind(STORE, HASH, '2026-09-12T01:09:00.000Z'),
    env.DB.prepare(
      `INSERT INTO payments
       (id,store_id,order_id,source,method,external_reference,amount_minor,currency,status,
        history_id,recorded_actor_source,recorded_actor_id,recorded_at)
       VALUES ('payment_refund_paid',?,'order_refund_paid','manual','bank transfer','BANK-REFUND-PAID',
         2400,'USD','succeeded','history_paid_payment','user',?,?)`,
    ).bind(STORE, OWNER, '2026-09-12T01:05:00.000Z'),
    env.DB.prepare(
      `INSERT INTO order_assignments
       (store_id,order_id,assignee_user_id,assigned_by_user_id,history_id,assigned_at,updated_at)
       VALUES (?,'order_refund_paid',?,?,'history_paid_assignment',?,?)`,
    ).bind(STORE, STAFF, OWNER, '2026-09-12T01:10:00.000Z', '2026-09-12T01:10:00.000Z'),
  ]);
}

async function protectedSnapshot() {
  return {
    orders: await tableRows('orders'),
    lines: await tableRows('order_lines'),
    access: await tableRows('order_access'),
    idempotency: await tableRows('order_idempotency'),
    refunds: await tableRows('order_refund_requests'),
    history: await tableRows('order_history'),
    commands: await tableRows('order_commands'),
    payments: await tableRows('payments'),
    assignments: await tableRows('order_assignments'),
  };
}

describe('refund decision migration', () => {
  it('stays within the D1 Free statement budget', () => {
    const migration = catalogMigrations.find((entry) => entry.name === '0010-refund-decisions.sql');
    expect(migration).toBeDefined();
    expect((migration?.queries.length ?? 0) + 1).toBeLessThanOrEqual(50);
  });

  it('preserves pending, legacy, payment, assignment, capability, and private-file evidence', async () => {
    await resetCatalogThrough(9);
    await seedPopulatedSchemaNine();
    const before = await protectedSnapshot();
    await applyCatalogMigrations(10);

    const after = await protectedSnapshot();
    expect(after).toEqual({
      ...before,
      refunds: before.refunds.map((row) => ({ ...row, decided_at: null, decided_by_user_id: null })),
    });
    expect(await tableColumns('order_refund_requests')).toEqual([
      'id', 'store_id', 'order_id', 'status', 'reason', 'created_at', 'actor_source', 'actor_id',
      'decided_at', 'decided_by_user_id',
    ]);
    expect(await env.DB.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });
    expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_s4_refund_%'").all())
      .toMatchObject({ results: [] });
    expect(await indexNames('order_history')).toEqual(expect.arrayContaining([
      'order_history_assignee_created_idx',
      'order_history_refund_event_unique',
      'order_history_refund_terminal_event_unique',
    ]));
    expect(await indexNames('payments')).toEqual(expect.arrayContaining([
      'payments_store_external_idx', 'payments_store_order_idx',
    ]));
    expect(await indexNames('order_assignments')).toContain('order_assignments_assignee_order_idx');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id=?')
      .bind('order_refund_legacy').first<number>('count')).toBe(0);
  });

  it('enforces final fields, one request, one terminal event, and decision command branches', async () => {
    await resetCatalogThrough(9);
    await seedPopulatedSchemaNine();
    await applyCatalogMigrations(10);

    await expect(env.DB.prepare(
      "UPDATE order_refund_requests SET decided_at=? WHERE id='refund_paid'",
    ).bind('2026-09-12T01:11:00.000Z').run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(
      `INSERT INTO order_refund_requests
       (id,store_id,order_id,status,reason,actor_source,decided_at,decided_by_user_id)
       VALUES ('refund_duplicate',?,'order_refund_paid','approved','Duplicate','user',?,?)`,
    ).bind(STORE, '2026-09-12T01:11:00.000Z', OWNER).run()).rejects.toThrow(/UNIQUE/);

    await env.DB.prepare(
      `INSERT INTO order_history
       (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id)
       VALUES ('history_refund_approved',?,'order_refund_paid','paid',?,'refund_approved','user','paid',?,2,'refund_paid',NULL)`,
    ).bind(STORE, '2026-09-12T01:11:00.000Z', OWNER).run();
    await env.DB.prepare(
      `UPDATE order_refund_requests SET status='approved',decided_at=?,decided_by_user_id=? WHERE id='refund_paid'`,
    ).bind('2026-09-12T01:11:00.000Z', OWNER).run();
    await env.DB.prepare(
      `INSERT INTO order_commands
       (id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id)
       VALUES ('command_refund_approved',?,'refund-decision-ok-01','order_refund_paid','approve_refund',?,
         'history_refund_approved',?,2,'refund_paid')`,
    ).bind(STORE, HASH, '2026-09-12T01:11:00.000Z').run();

    await env.DB.prepare(
      `INSERT INTO order_history
       (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id)
       VALUES ('history_refund_rejected_legacy',?,'order_refund_legacy','paid',?,'refund_rejected','user','paid',?,2,'refund_legacy',NULL)`,
    ).bind(STORE, '2026-09-12T01:11:30.000Z', OWNER).run();
    await env.DB.prepare(
      `UPDATE order_refund_requests SET status='rejected',decided_at=?,decided_by_user_id=?
       WHERE id='refund_legacy'`,
    ).bind('2026-09-12T01:11:30.000Z', OWNER).run();
    await env.DB.prepare(
      `INSERT INTO order_commands
       (id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id)
       VALUES ('command_refund_rejected',?,'refund-rejection-ok01','order_refund_legacy','reject_refund',?,
         'history_refund_rejected_legacy',?,2,'refund_legacy')`,
    ).bind(STORE, HASH, '2026-09-12T01:11:30.000Z').run();

    await expect(env.DB.prepare(
      "UPDATE order_refund_requests SET status='rejected' WHERE id='refund_paid'",
    ).run()).rejects.toThrow(/refund_decision_is_final/);
    await expect(env.DB.prepare(
      `INSERT INTO order_history
       (id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id,assignee_user_id)
       VALUES ('history_refund_rejected',?,'order_refund_paid','paid',?,'refund_rejected','user','paid',?,2,'refund_paid',NULL)`,
    ).bind(STORE, '2026-09-12T01:12:00.000Z', OWNER).run()).rejects.toThrow(/UNIQUE/);
    await expect(env.DB.prepare(
      `INSERT INTO order_commands
       (id,store_id,request_key,order_id,action,payload_hash,result_history_id,contract_version,result_refund_request_id)
       VALUES ('command_refund_missing_result',?,'refund-decision-bad01','order_refund_paid','reject_refund',?,
         'history_refund_approved',2,NULL)`,
    ).bind(STORE, HASH).run()).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare(
      `INSERT INTO order_commands
       (id,store_id,request_key,order_id,action,payload_hash,result_history_id,contract_version,result_refund_request_id)
       VALUES ('command_assignment_bad_result',?,'refund-assignment-bad1','order_refund_paid','assign',?,
         'history_paid_assignment',2,'refund_paid')`,
    ).bind(STORE, HASH).run()).rejects.toThrow(/CHECK/);

    expect(await env.DB.prepare("SELECT status FROM orders WHERE id='order_refund_paid'").first<string>('status'))
      .toBe('paid');
    expect(await env.DB.prepare("SELECT status FROM order_refund_requests WHERE id='refund_legacy'")
      .first<string>('status')).toBe('rejected');
    expect(await tableRows('payments')).toHaveLength(1);
    expect(await env.DB.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });
  });

  it('rolls back a late restore fault and then reapplies the real migration cleanly', async () => {
    await resetCatalogThrough(9);
    await seedPopulatedSchemaNine();
    const before = await protectedSnapshot();
    const migration = catalogMigrations.find((entry) => entry.name === '0010-refund-decisions.sql');
    expect(migration).toBeDefined();
    const faulty = [...migration!.queries];
    const restoreIndex = faulty.findIndex((query) => (
      /^INSERT INTO payments\b/i.test(query.trim()) && query.includes('_s4_refund_payments')
    ));
    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    faulty.splice(restoreIndex + 1, 0, 'INSERT INTO order_commands (id) VALUES (NULL)');

    await expect(applyD1Migrations(env.DB, [
      ...catalogMigrations.slice(0, 9),
      { name: '0010-refund-decisions-fault.sql', queries: faulty },
    ])).rejects.toThrow();

    expect(await protectedSnapshot()).toEqual(before);
    expect(await tableColumns('order_refund_requests')).not.toContain('decided_at');
    expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_s4_refund_%'").all())
      .toMatchObject({ results: [] });
    expect(await env.DB.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });

    await applyCatalogMigrations(10);
    expect(await tableColumns('order_refund_requests')).toContain('decided_at');
    expect(await env.DB.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });
  });

  it('keeps refund decisions in the latest reset schema', async () => {
    await resetCatalog();
    expect(await tableColumns('order_refund_requests')).toContain('decided_by_user_id');
    const migrations = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id')
      .all<{ name: string }>();
    expect(migrations.results.at(-1)?.name).toBe('0011-google-account-binding-uniqueness.sql');
  });
});
