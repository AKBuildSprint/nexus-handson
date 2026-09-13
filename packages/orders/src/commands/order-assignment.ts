import { stableId } from '@nexus/catalog/slug';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';
import { evaluatePermission } from '@nexus/identity/permissions';
import {
  OrderPersistenceError,
  OrderValidationError,
  type OrderAssignmentCommandResult,
  type StaffCandidateProjection,
} from '../order-types';
import { parseAssignmentInput } from '../order-validation';
import { keyConflict, legacyKeyConflict, readCommandResult, readLedger } from '../persistence/command-store';

const encoder = new TextEncoder();

async function assignmentHash(orderId: string, ownerId: string, assigneeUserId: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(JSON.stringify(['assign', orderId, 'user', ownerId, assigneeUserId])),
  );
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function ownerRequired(identity: ConsoleIdentityContext): void {
  if (!evaluatePermission(identity, 'order:assign', { storeId: identity.storeId })) {
    throw new OrderValidationError('forbidden', 'You do not have permission to assign Orders.', [], 403);
  }
}

async function assertCurrentOwner(database: D1Database, identity: ConsoleIdentityContext): Promise<void> {
  const active = await database.prepare(
    `SELECT 1 AS active FROM store_memberships
      WHERE id = ? AND store_id = ? AND user_id = ? AND role = 'owner' AND status = 'active'`,
  ).bind(identity.membershipId, identity.storeId, identity.userId).first<number>('active');
  if (active !== 1) {
    throw new OrderValidationError('store_access_denied', 'Your Store access is no longer active.', [], 403);
  }
}

export async function listActiveStaffCandidates(
  database: D1Database,
  identity: ConsoleIdentityContext,
): Promise<StaffCandidateProjection[]> {
  ownerRequired(identity);
  await assertCurrentOwner(database, identity);
  const rows = await database.prepare(
    `SELECT membership.user_id, account.name
       FROM store_memberships membership
       JOIN "user" account ON account.id = membership.user_id
      WHERE membership.store_id = ? AND membership.role = 'staff' AND membership.status = 'active'
      ORDER BY lower(account.name), membership.user_id`,
  ).bind(identity.storeId).all<{ user_id: string; name: string }>();
  await assertCurrentOwner(database, identity);
  return rows.results.map((row) => ({ userId: row.user_id, name: row.name }));
}

export async function assignOrder(input: {
  database: D1Database;
  identity: ConsoleIdentityContext;
  orderId: string;
  body: unknown;
  idempotencyKey: unknown;
}): Promise<OrderAssignmentCommandResult> {
  ownerRequired(input.identity);
  await assertCurrentOwner(input.database, input.identity);
  const parsed = parseAssignmentInput(input.body, input.idempotencyKey);
  const hash = await assignmentHash(input.orderId, input.identity.userId, parsed.assigneeUserId);
  const existingLedger = await readLedger(input.database, input.identity.storeId, parsed.idempotencyKey);
  if (existingLedger) {
    await assertCurrentOwner(input.database, input.identity);
    if (existingLedger.contract_version === 1) legacyKeyConflict();
    if (existingLedger.action !== 'assign' || existingLedger.order_id !== input.orderId || existingLedger.payload_hash !== hash) keyConflict();
    const result = await readCommandResult(input.database, input.identity.storeId, parsed.idempotencyKey) as OrderAssignmentCommandResult;
    await assertCurrentOwner(input.database, input.identity);
    return result;
  }

  const current = await input.database.prepare(
    `SELECT assignment.history_id, assignment.assignee_user_id
       FROM order_assignments assignment
       JOIN orders ON orders.id = assignment.order_id AND orders.store_id = assignment.store_id
      WHERE assignment.store_id = ? AND assignment.order_id = ?`,
  ).bind(input.identity.storeId, input.orderId).first<{ history_id: string; assignee_user_id: string }>();
  const historyId = current?.assignee_user_id === parsed.assigneeUserId ? current.history_id : stableId('hist');
  const commandId = stableId('cmd');
  const assignedAt = new Date().toISOString();
  const ownerArgs = [input.identity.membershipId, input.identity.storeId, input.identity.userId];
  const targetArgs = [input.identity.storeId, parsed.assigneeUserId];
  const statements: D1PreparedStatement[] = [];

  if (current?.assignee_user_id !== parsed.assigneeUserId) {
    statements.push(input.database.prepare(
      `INSERT INTO order_history (
         id, store_id, order_id, status, created_at, action, source, from_status,
         actor_id, contract_version, refund_request_id, assignee_user_id
       ) SELECT ?, orders.store_id, orders.id, orders.status, ?, 'assigned', 'user', orders.status,
                ?, 2, NULL, ?
           FROM orders
          WHERE orders.store_id = ? AND orders.id = ?
            AND EXISTS (SELECT 1 FROM store_memberships owner
                         WHERE owner.id = ? AND owner.store_id = ? AND owner.user_id = ?
                           AND owner.role = 'owner' AND owner.status = 'active')
            AND EXISTS (SELECT 1 FROM store_memberships staff
                         WHERE staff.store_id = ? AND staff.user_id = ?
                           AND staff.role = 'staff' AND staff.status = 'active')
            AND NOT EXISTS (
              SELECT 1 FROM order_assignments current_assignment
               WHERE current_assignment.store_id = orders.store_id
                 AND current_assignment.order_id = orders.id
                 AND current_assignment.assignee_user_id = ?
            )`,
    ).bind(
      historyId, assignedAt, input.identity.userId, parsed.assigneeUserId,
      input.identity.storeId, input.orderId, ...ownerArgs, ...targetArgs, parsed.assigneeUserId,
    ));
    statements.push(input.database.prepare(
      `INSERT INTO order_assignments (
         store_id, order_id, assignee_user_id, assigned_by_user_id, history_id, assigned_at
       ) SELECT ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM order_history WHERE id = ? AND store_id = ? AND order_id = ?)
       ON CONFLICT(order_id, store_id) DO UPDATE SET
         assignee_user_id = excluded.assignee_user_id,
         assigned_by_user_id = excluded.assigned_by_user_id,
         history_id = excluded.history_id,
         assigned_at = excluded.assigned_at,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(
      input.identity.storeId, input.orderId, parsed.assigneeUserId, input.identity.userId,
      historyId, assignedAt, historyId, input.identity.storeId, input.orderId,
    ));
  }

  statements.push(input.database.prepare(
    `INSERT INTO order_commands (
       id, store_id, request_key, order_id, action, payload_hash,
       result_history_id, contract_version, result_refund_request_id
     ) VALUES (
       CASE WHEN EXISTS (
         SELECT 1 FROM order_assignments assignment
         JOIN order_history history
           ON history.id = assignment.history_id
          AND history.store_id = assignment.store_id
          AND history.order_id = assignment.order_id
        WHERE assignment.store_id = ? AND assignment.order_id = ?
          AND assignment.assignee_user_id = ? AND assignment.history_id = ?
          AND history.action = 'assigned'
          AND history.source = 'user'
          AND history.assignee_user_id = assignment.assignee_user_id
          AND EXISTS (SELECT 1 FROM store_memberships owner
                       WHERE owner.id = ? AND owner.store_id = ? AND owner.user_id = ?
                         AND owner.role = 'owner' AND owner.status = 'active')
          AND EXISTS (SELECT 1 FROM store_memberships staff
                       WHERE staff.store_id = ? AND staff.user_id = ?
                         AND staff.role = 'staff' AND staff.status = 'active')
       ) THEN ? ELSE NULL END,
       ?, ?, ?, 'assign', ?, ?, 2, NULL
     )`,
  ).bind(
    input.identity.storeId, input.orderId, parsed.assigneeUserId, historyId,
    ...ownerArgs, ...targetArgs, commandId, input.identity.storeId, parsed.idempotencyKey,
    input.orderId, hash, historyId,
  ));

  try {
    await input.database.batch(statements);
  } catch (cause) {
    await assertCurrentOwner(input.database, input.identity);
    const ledger = await readLedger(input.database, input.identity.storeId, parsed.idempotencyKey);
    await assertCurrentOwner(input.database, input.identity);
    if (ledger) {
      if (ledger.contract_version === 1) legacyKeyConflict();
      if (ledger.action !== 'assign' || ledger.order_id !== input.orderId || ledger.payload_hash !== hash) keyConflict();
      const recovered = await readCommandResult(input.database, input.identity.storeId, parsed.idempotencyKey) as OrderAssignmentCommandResult;
      await assertCurrentOwner(input.database, input.identity);
      return recovered;
    }
    const orderExists = await input.database.prepare(
      'SELECT 1 AS present FROM orders WHERE store_id = ? AND id = ?',
    ).bind(input.identity.storeId, input.orderId).first<number>('present');
    await assertCurrentOwner(input.database, input.identity);
    if (orderExists !== 1) {
      throw new OrderValidationError('not_found', 'Order not found.', [], 404);
    }
    const target = await input.database.prepare(
      `SELECT 1 AS valid FROM store_memberships
        WHERE store_id = ? AND user_id = ? AND role = 'staff' AND status = 'active'`,
    ).bind(input.identity.storeId, parsed.assigneeUserId).first<number>('valid');
    await assertCurrentOwner(input.database, input.identity);
    if (target !== 1) throw new OrderValidationError('validation_failed', 'The request is invalid.', [{
      path: '/assigneeUserId', code: 'assignee_invalid', message: 'Choose an active Staff member.',
    }]);
    const currentNow = await input.database.prepare(
      `SELECT history_id, assignee_user_id FROM order_assignments
        WHERE store_id = ? AND order_id = ?`,
    ).bind(input.identity.storeId, input.orderId).first<{ history_id: string; assignee_user_id: string }>();
    await assertCurrentOwner(input.database, input.identity);
    if (currentNow?.assignee_user_id === parsed.assigneeUserId && currentNow.history_id !== historyId) {
      return assignOrder(input);
    }
    throw new OrderPersistenceError(cause);
  }
  await assertCurrentOwner(input.database, input.identity);
  const result = await readCommandResult(input.database, input.identity.storeId, parsed.idempotencyKey) as OrderAssignmentCommandResult;
  await assertCurrentOwner(input.database, input.identity);
  return result;
}
