import type { IdentityContext, PermissionAction, PermissionResource } from './identity-types';

const OWNER_ACTIONS = new Set<PermissionAction>([
  'catalog:read',
  'catalog:write',
  'catalog:import',
  'catalog:file:read',
  'catalog:file:write',
  'catalog:remove',
  'order:read',
  'order:process',
  'order:assign',
  'staff:list',
  'refund:request',
  'refund:decide',
]);

const STAFF_STORE_ACTIONS = new Set<PermissionAction>(['catalog:read', 'catalog:file:read']);
const STAFF_ASSIGNED_ACTIONS = new Set<PermissionAction>(['order:read', 'order:process', 'refund:request']);
const CUSTOMER_ACTIONS = new Set<PermissionAction>(['order:read', 'refund:request']);

function isKnownAction(action: string): action is PermissionAction {
  return OWNER_ACTIONS.has(action as PermissionAction);
}

export function evaluatePermission(
  context: IdentityContext,
  action: string,
  resource: PermissionResource,
): boolean {
  if (!isKnownAction(action)) return false;
  if (context.kind === 'public') return false;
  if (context.storeId !== resource.storeId) return false;

  if (context.kind === 'customer') {
    return resource.customerId === context.customerId && CUSTOMER_ACTIONS.has(action);
  }
  if (context.membershipStatus !== 'active') return false;
  if (context.role === 'owner') return OWNER_ACTIONS.has(action);
  if (context.role === 'staff') {
    if (STAFF_STORE_ACTIONS.has(action)) return true;
    return resource.assignedUserId === context.userId && STAFF_ASSIGNED_ACTIONS.has(action);
  }
  return false;
}
