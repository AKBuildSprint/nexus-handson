import { evaluatePermission } from '@nexus/identity/permissions';
import type { PermissionAction } from '@nexus/identity/identity-types';
import type { ConsoleRequestContext } from './auth';
import { jsonResponse } from './http-response';

const SESSION_ACTIONS: PermissionAction[] = [
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
];

export function routeConsoleSessionRequest(
  request: Request,
  context: ConsoleRequestContext,
): Response | null {
  if (request.method !== 'GET' || new URL(request.url).pathname !== '/api/console/session') return null;
  const allowedActions = SESSION_ACTIONS.filter((action) => evaluatePermission(
    context.identity,
    action,
    { storeId: context.store.id, assignedUserId: context.user.id },
  ));
  return jsonResponse({
    user: context.user,
    store: context.store,
    role: context.identity.role,
    allowedActions,
  });
}
