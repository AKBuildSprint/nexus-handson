import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveActiveMembership } from '@nexus/identity/membership-store';
import { provisionGoogleAccount } from '../../apps/worker/src/auth';
import {
  applyCatalogMigrations,
  catalogMigrations,
  resetCatalog,
  resetCatalogThrough,
} from '../support/catalog-test-env';
import { createTestAuth } from '../support/identity-test-env';

const STORE_A = 'store_nexus';
const STORE_B = 'store_other';
const HASH = 'ab'.repeat(32);

async function provisionUser(id: string, name: string): Promise<string> {
  const result = await provisionGoogleAccount(createTestAuth(), {
    email: `${id}@example.test`,
    name,
    googleSubject: `google-subject-${id}`,
  });
  return result.userId;
}

async function insertStoreB(): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO stores (id, slug, name) VALUES (?, 'other', 'Other Store')",
  ).bind(STORE_B).run();
}

async function insertMembership(input: {
  id: string;
  storeId: string;
  userId: string;
  role: 'owner' | 'staff';
  status?: 'active' | 'revoked';
}): Promise<void> {
  const status = input.status ?? 'active';
  await env.DB.prepare(
    `INSERT INTO store_memberships (
       id, store_id, user_id, role, status, created_at, updated_at, revoked_at
     ) VALUES (?, ?, ?, ?, ?, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z', ?)`,
  ).bind(
    input.id,
    input.storeId,
    input.userId,
    input.role,
    status,
    status === 'revoked' ? '2026-09-12T00:00:00.000Z' : null,
  ).run();
}

async function insertOrder(orderId: string, storeId = STORE_A): Promise<void> {
  const customerId = `customer_${orderId}`;
  await env.DB.prepare(
    `INSERT INTO customers (id, store_id, name, email_normalized)
     VALUES (?, ?, 'Ada', ?)`,
  ).bind(customerId, storeId, `${customerId}@example.test`).run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO order_lines (
         id, store_id, order_id, product_id, product_name, selected_options_json,
         quantity, unit_price_minor, line_total_minor, currency, access_title,
         access_instructions, private_file_key, position
       ) VALUES (?, ?, ?, 'prod_snapshot', 'Snapshot', '[]', 1, 100, 100, 'USD',
         'Download', 'Keep this snapshot', 'private/files/sentinel', 0)`,
    ).bind(`line_${orderId}`, storeId, orderId),
    env.DB.prepare(
      `INSERT INTO orders (
         id, store_id, reference, customer_id, customer_name, customer_email_normalized,
         status, currency, total_minor, created_at, payment_reference
       ) VALUES (?, ?, ?, ?, 'Ada', ?, 'paid', 'USD', 100,
         '2026-09-12T01:00:00.000Z', ?)`,
    ).bind(orderId, storeId, `NX-${orderId.toUpperCase()}`, customerId, `${customerId}@example.test`, `NP${orderId}`),
    env.DB.prepare(
      `INSERT INTO order_history (
         id, store_id, order_id, status, created_at, action, source, from_status,
         actor_id, contract_version, refund_request_id
       ) VALUES (?, ?, ?, 'pending', '2026-09-12T01:00:00.100Z', 'order_created',
         'storefront', NULL, NULL, 2, NULL)`,
    ).bind(`history_created_${orderId}`, storeId, orderId),
    env.DB.prepare(
      `INSERT INTO order_history (
         id, store_id, order_id, status, created_at, action, source, from_status,
         actor_id, contract_version, refund_request_id
       ) VALUES (?, ?, ?, 'paid', '2026-09-12T01:05:00.000Z', 'order_paid',
         'bootstrap_owner', 'pending', NULL, 2, NULL)`,
    ).bind(`history_paid_${orderId}`, storeId, orderId),
    env.DB.prepare(
      `INSERT INTO order_commands (
         id, store_id, request_key, order_id, action, payload_hash, result_history_id,
         created_at, contract_version, result_refund_request_id
       ) VALUES (?, ?, ?, ?, 'mark_paid', ?, ?, '2026-09-12T01:05:00.100Z', 2, NULL)`,
    ).bind(`command_${orderId}`, storeId, `request-key-${orderId}`, orderId, HASH, `history_paid_${orderId}`),
    env.DB.prepare(
      `INSERT INTO payments (
         id, store_id, order_id, source, method, external_reference, amount_minor,
         currency, status, history_id, recorded_actor_source, recorded_actor_id, recorded_at
       ) VALUES (?, ?, ?, 'manual', 'bank', ?, 100, 'USD', 'succeeded', ?,
         'bootstrap_owner', NULL, '2026-09-12T01:05:00.200Z')`,
    ).bind(`payment_${orderId}`, storeId, orderId, `external-${orderId}`, `history_paid_${orderId}`),
  ]);
}

async function rows(table: string): Promise<Record<string, unknown>[]> {
  const result = await env.DB.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all<Record<string, unknown>>();
  return result.results;
}

describe('identity migration', () => {
  it('preserves populated history, command, and payment records through schema 8 to 9', async () => {
    await resetCatalogThrough(8);
    await insertOrder('order_preserved');
    const before = {
      history: await rows('order_history'),
      commands: await rows('order_commands'),
      payments: await rows('payments'),
    };

    await applyD1Migrations(env.DB, [catalogMigrations[8]]);

    expect(await rows('order_history')).toEqual(before.history.map((row) => ({ ...row, assignee_user_id: null })));
    expect(await rows('order_commands')).toEqual(before.commands);
    expect(await rows('payments')).toEqual(before.payments);
    const foreignKeys = await env.DB.prepare('PRAGMA foreign_key_check').all();
    expect(foreignKeys.results).toEqual([]);
  });

  it('rolls an interrupted populated migration back and succeeds on a clean retry', async () => {
    await resetCatalogThrough(8);
    await insertOrder('order_retry');
    await env.DB.prepare(
      `UPDATE order_history SET source = 'user', actor_id = 'legacy-user'
       WHERE id = 'history_created_order_retry'`,
    ).run();

    const migration = catalogMigrations[8];
    await expect(applyD1Migrations(env.DB, [{
      name: '0009-interrupted-store-memberships.sql',
      queries: [...migration.queries, 'INSERT INTO missing_rehearsal_table (id) VALUES (1)'],
    }])).rejects.toThrow();
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'store_memberships'",
    ).first<number>('count')).toBe(0);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM pragma_table_info('order_history') WHERE name = 'assignee_user_id'",
    ).first<number>('count')).toBe(0);

    expect(await env.DB.prepare(
      "SELECT actor_id FROM order_history WHERE id = 'history_created_order_retry'",
    ).first<string>('actor_id')).toBe('legacy-user');
    await applyD1Migrations(env.DB, [migration]);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'store_memberships'",
    ).first<number>('count')).toBe(1);
  });
});

describe('membership and assignment constraints', () => {
  beforeEach(resetCatalog);

  it('resolves exactly one active membership and fails closed for absent or ambiguous membership', async () => {
    await insertStoreB();
    const userId = await provisionUser('membership-user', 'Membership User');
    expect(await resolveActiveMembership(env.DB, userId)).toEqual({ kind: 'absent' });

    await insertMembership({ id: 'membership_a', storeId: STORE_A, userId, role: 'staff' });
    await expect(insertMembership({ id: 'membership_b', storeId: STORE_B, userId, role: 'staff' })).rejects.toThrow();
    expect(await resolveActiveMembership(env.DB, userId)).toMatchObject({
      kind: 'resolved',
      membership: { id: 'membership_a', storeId: STORE_A, userId, role: 'staff', status: 'active' },
    });

    await env.DB.prepare('DROP INDEX store_memberships_one_active_user').run();
    try {
      await insertMembership({ id: 'membership_b', storeId: STORE_B, userId, role: 'staff' });
      expect(await resolveActiveMembership(env.DB, userId)).toEqual({ kind: 'ambiguous' });
    } finally {
      await env.DB.prepare("DELETE FROM store_memberships WHERE id = 'membership_b'").run();
      await env.DB.prepare(
        "CREATE UNIQUE INDEX store_memberships_one_active_user ON store_memberships (user_id) WHERE status = 'active'",
      ).run();
    }
  });

  it('retains revoked membership history while rejecting invalid role and status shapes', async () => {
    await insertStoreB();
    const userId = await provisionUser('revoked-user', 'Revoked User');
    await insertMembership({ id: 'membership_revoked_a', storeId: STORE_A, userId, role: 'staff', status: 'revoked' });
    await insertMembership({ id: 'membership_active_b', storeId: STORE_B, userId, role: 'staff' });
    expect(await resolveActiveMembership(env.DB, userId)).toMatchObject({
      kind: 'resolved',
      membership: { storeId: STORE_B },
    });

    await expect(env.DB.prepare(
      `INSERT INTO store_memberships (id, store_id, user_id, role, status)
       VALUES ('bad_role', ?, ?, 'admin', 'active')`,
    ).bind(STORE_A, userId).run()).rejects.toThrow();
    await expect(env.DB.prepare(
      `INSERT INTO store_memberships (id, store_id, user_id, role, status, revoked_at)
       VALUES ('bad_status_time', ?, ?, 'staff', 'revoked', NULL)`,
    ).bind(STORE_A, userId).run()).rejects.toThrow();
  });

  it('stores valid current assignment and immutable assignment events while rejecting invalid targets', async () => {
    await insertStoreB();
    const ownerId = await provisionUser('owner-a', 'Owner A');
    const staffOneId = await provisionUser('staff-one-a', 'Staff One');
    const staffTwoId = await provisionUser('staff-two-a', 'Staff Two');
    const foreignStaffId = await provisionUser('staff-b', 'Staff B');
    const revokedStaffId = await provisionUser('revoked-staff-a', 'Revoked Staff');
    await insertMembership({ id: 'owner_a', storeId: STORE_A, userId: ownerId, role: 'owner' });
    await insertMembership({ id: 'staff_one_a', storeId: STORE_A, userId: staffOneId, role: 'staff' });
    await insertMembership({ id: 'staff_two_a', storeId: STORE_A, userId: staffTwoId, role: 'staff' });
    await insertMembership({ id: 'staff_b', storeId: STORE_B, userId: foreignStaffId, role: 'staff' });
    await insertMembership({ id: 'revoked_staff_a', storeId: STORE_A, userId: revokedStaffId, role: 'staff', status: 'revoked' });
    await insertOrder('order_assignment');

    const insertEvent = (id: string, assigneeUserId: string, createdAt: string) => env.DB.prepare(
      `INSERT INTO order_history (
         id, store_id, order_id, status, created_at, action, source, from_status,
         actor_id, contract_version, refund_request_id, assignee_user_id
       ) VALUES (?, ?, 'order_assignment', 'paid', ?, 'assigned', 'user', 'paid', ?, 2, NULL, ?)`,
    ).bind(id, STORE_A, createdAt, ownerId, assigneeUserId).run();

    await insertEvent('assignment_event_one', staffOneId, '2026-09-12T02:00:00.000Z');
    await env.DB.prepare(
      `INSERT INTO order_assignments (
         store_id, order_id, assignee_user_id, assigned_by_user_id, history_id, assigned_at
       ) VALUES (?, 'order_assignment', ?, ?, 'assignment_event_one', '2026-09-12T02:00:00.000Z')`,
    ).bind(STORE_A, staffOneId, ownerId).run();
    await env.DB.prepare(
      `INSERT INTO order_commands (
         id, store_id, request_key, order_id, action, payload_hash, result_history_id,
         created_at, contract_version, result_refund_request_id
       ) VALUES ('assignment_command_one', ?, 'assignment-key-0001', 'order_assignment',
         'assign', ?, 'assignment_event_one', '2026-09-12T02:00:00.100Z', 2, NULL)`,
    ).bind(STORE_A, HASH).run();

    await insertEvent('assignment_event_two', staffTwoId, '2026-09-12T02:05:00.000Z');
    await env.DB.prepare(
      `UPDATE order_assignments
          SET assignee_user_id = ?, history_id = 'assignment_event_two',
              assigned_at = '2026-09-12T02:05:00.000Z', updated_at = '2026-09-12T02:05:00.000Z'
        WHERE store_id = ? AND order_id = 'order_assignment'`,
    ).bind(staffTwoId, STORE_A).run();

    expect(await env.DB.prepare(
      "SELECT assignee_user_id FROM order_history WHERE id = 'assignment_event_one'",
    ).first<string>('assignee_user_id')).toBe(staffOneId);
    expect(await env.DB.prepare(
      "SELECT assignee_user_id FROM order_assignments WHERE order_id = 'order_assignment'",
    ).first<string>('assignee_user_id')).toBe(staffTwoId);

    await expect(env.DB.prepare(
      `UPDATE order_history
          SET created_at = '2026-09-12T02:06:00.000Z'
        WHERE id = 'assignment_event_two'`,
    ).run()).rejects.toThrow(/assignment_event_is_immutable/);
    expect(await env.DB.prepare(
      "SELECT created_at FROM order_history WHERE id = 'assignment_event_two'",
    ).first<string>('created_at')).toBe('2026-09-12T02:05:00.000Z');
    await expect(env.DB.prepare(
      `UPDATE order_history
          SET created_at = '2026-09-12T02:02:00.000Z'
        WHERE id = 'assignment_event_one'`,
    ).run()).rejects.toThrow(/assignment_event_is_immutable/);
    expect(await env.DB.prepare(
      "SELECT created_at FROM order_history WHERE id = 'assignment_event_one'",
    ).first<string>('created_at')).toBe('2026-09-12T02:00:00.000Z');

    await insertEvent('assignment_event_owner', ownerId, '2026-09-12T02:10:00.000Z');
    await expect(env.DB.prepare(
      `UPDATE order_assignments
          SET assignee_user_id = ?, history_id = 'assignment_event_owner',
              assigned_at = '2026-09-12T02:10:00.000Z'
        WHERE store_id = ? AND order_id = 'order_assignment'`,
    ).bind(ownerId, STORE_A).run()).rejects.toThrow(/assignment_requires_active_staff/);

    await insertEvent('assignment_event_revoked', revokedStaffId, '2026-09-12T02:15:00.000Z');
    await expect(env.DB.prepare(
      `UPDATE order_assignments
          SET assignee_user_id = ?, history_id = 'assignment_event_revoked',
              assigned_at = '2026-09-12T02:15:00.000Z'
        WHERE store_id = ? AND order_id = 'order_assignment'`,
    ).bind(revokedStaffId, STORE_A).run()).rejects.toThrow(/assignment_requires_active_staff/);

    await expect(env.DB.prepare(
      `UPDATE order_assignments
          SET assignee_user_id = ?, history_id = 'assignment_event_one',
              assigned_at = '2026-09-12T02:00:00.000Z'
        WHERE store_id = ? AND order_id = 'order_assignment'`,
    ).bind(foreignStaffId, STORE_A).run()).rejects.toThrow();
  });
});

it('keeps legacy migration entrypoints through schema 8', async () => {
  for (const through of [4, 5, 6, 7, 8] as const) {
    await resetCatalogThrough(through);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM stores').first<number>('count')).toBe(1);
  }
  await applyCatalogMigrations(9);
});
