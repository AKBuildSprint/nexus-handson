export type StoreRole = 'owner' | 'staff';
export type MembershipStatus = 'active' | 'revoked';

export interface ConsoleIdentityContext {
  kind: 'console';
  userId: string;
  storeId: string;
  membershipId: string;
  role: StoreRole;
  membershipStatus: MembershipStatus;
}

export interface CustomerIdentityContext {
  kind: 'customer';
  storeId: string;
  customerId: string;
}

export interface PublicIdentityContext {
  kind: 'public';
}

export type IdentityContext = ConsoleIdentityContext | CustomerIdentityContext | PublicIdentityContext;

export type PermissionAction =
  | 'catalog:read'
  | 'catalog:write'
  | 'catalog:import'
  | 'catalog:file:read'
  | 'catalog:file:write'
  | 'catalog:remove'
  | 'order:read'
  | 'order:process'
  | 'order:assign'
  | 'staff:list'
  | 'refund:request'
  | 'refund:decide';

export interface PermissionResource {
  storeId: string;
  assignedUserId?: string | null;
  customerId?: string | null;
}

export interface ActiveMembership {
  id: string;
  storeId: string;
  storeName: string;
  userId: string;
  role: StoreRole;
  status: 'active';
  createdAt: string;
  updatedAt: string;
}

export type ActiveMembershipResolution =
  | { kind: 'resolved'; membership: ActiveMembership }
  | { kind: 'absent' }
  | { kind: 'ambiguous' };
