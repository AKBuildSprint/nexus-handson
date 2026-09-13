import { describe, expect, it } from 'vitest';
import { evaluatePermission } from '@nexus/identity/permissions';
import type { ConsoleIdentityContext, IdentityContext, PermissionAction } from '@nexus/identity/identity-types';

const STORE_A = 'store_nexus';
const STORE_B = 'store_other';
const OWNER: ConsoleIdentityContext = {
  kind: 'console',
  userId: 'user_owner_a',
  storeId: STORE_A,
  membershipId: 'membership_owner_a',
  role: 'owner',
  membershipStatus: 'active',
};
const STAFF: ConsoleIdentityContext = {
  kind: 'console',
  userId: 'user_staff_a',
  storeId: STORE_A,
  membershipId: 'membership_staff_a',
  role: 'staff',
  membershipStatus: 'active',
};
const ACTIONS: PermissionAction[] = [
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

describe('Nexus permission policy', () => {
  it('allows an active same-Store Owner to perform every private action', () => {
    for (const action of ACTIONS) {
      expect(evaluatePermission(OWNER, action, { storeId: STORE_A }), action).toBe(true);
    }
  });

  it('limits Staff to read-only Products and assigned Order work', () => {
    const assigned = { storeId: STORE_A, assignedUserId: STAFF.userId };
    for (const action of ['catalog:read', 'catalog:file:read', 'order:read', 'order:process', 'refund:request'] satisfies PermissionAction[]) {
      expect(evaluatePermission(STAFF, action, assigned), action).toBe(true);
    }
    for (const action of ['catalog:write', 'catalog:import', 'catalog:file:write', 'catalog:remove', 'order:assign', 'staff:list', 'refund:decide'] satisfies PermissionAction[]) {
      expect(evaluatePermission(STAFF, action, assigned), action).toBe(false);
    }
    expect(evaluatePermission(STAFF, 'order:read', { storeId: STORE_A, assignedUserId: null })).toBe(false);
    expect(evaluatePermission(STAFF, 'order:process', { storeId: STORE_A, assignedUserId: OWNER.userId })).toBe(false);
  });

  it('allows a matching Customer capability context only its Order and Refund request', () => {
    const customer: IdentityContext = { kind: 'customer', storeId: STORE_A, customerId: 'customer_a' };
    const matching = { storeId: STORE_A, customerId: 'customer_a' };
    expect(evaluatePermission(customer, 'order:read', matching)).toBe(true);
    expect(evaluatePermission(customer, 'refund:request', matching)).toBe(true);
    expect(evaluatePermission(customer, 'order:process', matching)).toBe(false);
    expect(evaluatePermission(customer, 'order:read', { ...matching, customerId: 'customer_b' })).toBe(false);
  });

  it('denies foreign Store, revoked, public, and unknown actions', () => {
    expect(evaluatePermission(OWNER, 'catalog:read', { storeId: STORE_B })).toBe(false);
    expect(evaluatePermission({ ...STAFF, membershipStatus: 'revoked' }, 'catalog:read', { storeId: STORE_A })).toBe(false);
    expect(evaluatePermission({ kind: 'public' }, 'order:read', { storeId: STORE_A })).toBe(false);
    expect(evaluatePermission(OWNER, 'catalog:super-admin', { storeId: STORE_A })).toBe(false);
    expect(evaluatePermission(
      { ...STAFF, role: 'future-role' } as unknown as ConsoleIdentityContext,
      'catalog:read',
      { storeId: STORE_A },
    )).toBe(false);
  });
});
