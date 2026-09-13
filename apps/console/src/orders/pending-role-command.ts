import type { ConsoleSessionView } from '../auth-client';

export type FrozenRoleAttempt =
  | { action: 'assign'; orderReference: string; key: string; assigneeUserId: string }
  | { action: 'approve' | 'reject'; orderReference: string; requestId: string; key: string };

const PREFIX = 'nexus-console-role-command:';

export function roleCommandScope(session: ConsoleSessionView): string {
  return JSON.stringify([session.user.id, session.store.id, session.role]);
}

function storageKey(scope: string, reference: string): string {
  return `${PREFIX}${scope}:${reference}`;
}

export function readPendingRoleCommand(scope: string, reference: string): FrozenRoleAttempt | null {
  const raw = sessionStorage.getItem(storageKey(scope, reference));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (value !== null && typeof value === 'object' && 'orderReference' in value && value.orderReference === reference
    && 'key' in value && typeof value.key === 'string' && value.key.length > 0 && 'action' in value) {
    if (value.action === 'assign' && 'assigneeUserId' in value && typeof value.assigneeUserId === 'string' && value.assigneeUserId.length > 0) {
      return { action: 'assign', orderReference: reference, key: value.key, assigneeUserId: value.assigneeUserId };
    }
    if ((value.action === 'approve' || value.action === 'reject') && 'requestId' in value && typeof value.requestId === 'string' && value.requestId.length > 0) {
      return { action: value.action, orderReference: reference, key: value.key, requestId: value.requestId };
    }
  }
  throw new Error('The previous role command could not be recovered.');
}

export function savePendingRoleCommand(scope: string, attempt: FrozenRoleAttempt): void {
  // Persist before dispatch: a reload can happen before fetch resolves or rejects.
  sessionStorage.setItem(storageKey(scope, attempt.orderReference), JSON.stringify(attempt));
}

export function removePendingRoleCommand(scope: string, reference: string): void {
  sessionStorage.removeItem(storageKey(scope, reference));
}

export function clearPendingRoleCommands(keepScope?: string): void {
  // Storage failure must never stop server sign-out or expose the previous UI.
  // Restoring a record still requires its exact freshly verified identity scope.
  try {
    const keepPrefix = keepScope === undefined ? null : `${PREFIX}${keepScope}:`;
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(PREFIX) && (keepPrefix === null || !key.startsWith(keepPrefix))) sessionStorage.removeItem(key);
    }
  } catch {
    // A blocked storage area is also unreadable by the recovery path.
  }
}
