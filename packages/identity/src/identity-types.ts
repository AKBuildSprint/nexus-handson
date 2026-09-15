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

export const NEXUS_STORE_ID = 'store_nexus';
export const OWNER_INVITATION_TOKEN_FIELD = 'invitationToken';
export const OWNER_INVITATION_CONTEXT_FIELD = 'invitationContext';
export const OWNER_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface GoogleOwnerProfile {
  email: string;
  name: string;
  googleSubject: string;
}

export type OwnerAdmissionResult =
  | { kind: 'admitted'; userId: string; membershipId: string; created: boolean }
  | { kind: 'denied' };

export type ParsedInvitationToken =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'present'; token: string };

export type ParsedInvitationContext =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'present'; context: string };

export interface CreatedOwnerInvitation {
  id: string;
  token: string;
  expiresAt: string;
  targetEmail: string;
}
