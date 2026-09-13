import { evaluatePermission } from '@nexus/identity/permissions';
import type { ConsoleIdentityContext, IdentityContext, PermissionAction } from '@nexus/identity/identity-types';
import { OrderValidationError } from './order-types';

export function consoleVisibilitySql(orderAlias = 'orders'): string {
  return `EXISTS (
    SELECT 1 FROM store_memberships membership
     WHERE membership.id = ?
       AND membership.user_id = ?
       AND membership.store_id = ${orderAlias}.store_id
       AND membership.role = ?
       AND membership.status = 'active'
       AND (
         membership.role = 'owner'
         OR EXISTS (
           SELECT 1 FROM order_assignments assignment
            WHERE assignment.store_id = ${orderAlias}.store_id
              AND assignment.order_id = ${orderAlias}.id
              AND assignment.assignee_user_id = membership.user_id
         )
       )
  )`;
}

export function consoleVisibilityBinds(identity: ConsoleIdentityContext): string[] {
  return [identity.membershipId, identity.userId, identity.role];
}

export function requireConsoleIdentity(identity: IdentityContext | null): ConsoleIdentityContext {
  if (identity?.kind !== 'console') {
    throw new OrderValidationError('not_found', 'Order not found.', [], 404);
  }
  return identity;
}

export function requirePermission(
  identity: IdentityContext | null,
  action: PermissionAction,
  resource: { storeId: string; assignedUserId?: string | null; customerId?: string | null },
): void {
  if (identity === null || !evaluatePermission(identity, action, resource)) {
    throw new OrderValidationError('forbidden', 'You do not have permission to perform this action.', [], 403);
  }
}

export async function assertCurrentConsoleOrderAccess(input: {
  database: D1Database;
  identity: ConsoleIdentityContext;
  orderId: string;
  action: 'order:read' | 'order:process' | 'refund:request' | 'refund:decide';
}): Promise<void> {
  const permissionRoleSql = input.action === 'order:read'
    || input.action === 'order:process'
    || input.action === 'refund:request'
    ? `AND (membership.role = 'owner' OR (
         membership.role = 'staff' AND EXISTS (
           SELECT 1 FROM order_assignments assignment
            WHERE assignment.store_id = orders.store_id
              AND assignment.order_id = orders.id
              AND assignment.assignee_user_id = membership.user_id
         )
       ))`
    : `AND membership.role = 'owner'`;
  const allowed = await input.database.prepare(
    `SELECT 1 AS allowed
       FROM orders
       JOIN store_memberships membership
         ON membership.store_id = orders.store_id
        AND membership.id = ?
        AND membership.user_id = ?
        AND membership.role = ?
        AND membership.status = 'active'
      WHERE orders.store_id = ? AND orders.id = ? ${permissionRoleSql}`,
  ).bind(
    input.identity.membershipId,
    input.identity.userId,
    input.identity.role,
    input.identity.storeId,
    input.orderId,
  ).first<number>('allowed');
  if (allowed !== 1) {
    await assertCurrentConsoleMembership(input.database, input.identity);
    throw new OrderValidationError('not_found', 'Order not found.', [], 404);
  }
}

export async function assertCurrentConsoleMembership(
  database: D1Database,
  identity: ConsoleIdentityContext,
): Promise<void> {
  const membershipActive = await database.prepare(
    `SELECT 1 AS active FROM store_memberships
      WHERE id = ? AND user_id = ? AND store_id = ? AND role = ? AND status = 'active'`,
  ).bind(identity.membershipId, identity.userId, identity.storeId, identity.role).first<number>('active');
  if (membershipActive !== 1) {
    throw new OrderValidationError('store_access_denied', 'Your Store access is no longer active.', [], 403);
  }
}
