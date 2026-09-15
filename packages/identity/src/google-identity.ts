import { NEXUS_STORE_ID, type GoogleOwnerProfile } from './identity-types';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export function normalizeGoogleOwnerProfile(input: {
  email: unknown;
  name: unknown;
  googleSubject: unknown;
  emailVerified: unknown;
}): GoogleOwnerProfile | null {
  if (input.emailVerified !== true) return null;
  if (typeof input.email !== 'string' || typeof input.name !== 'string' || typeof input.googleSubject !== 'string') {
    return null;
  }
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  const googleSubject = input.googleSubject.trim();
  if (
    email === null
    || name.length < 1
    || name.length > 128
    || googleSubject.length < 1
    || googleSubject.length > 255
    || /\s/.test(googleSubject)
  ) {
    return null;
  }
  return { email, name, googleSubject };
}

export function newAuthId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let id = '';
  for (const byte of bytes) id += ID_ALPHABET[byte % 62];
  return id;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface BoundGoogleIdentity {
  userId: string;
  email: string;
  name: string;
  googleSubject: string | null;
  membershipId: string | null;
  membershipStoreId: string | null;
  membershipRole: 'owner' | 'staff' | null;
  membershipStatus: 'active' | 'revoked' | null;
}

interface BoundGoogleIdentityRow {
  user_id: string;
  email: string;
  name: string;
  google_subject: string | null;
  membership_id: string | null;
  store_id: string | null;
  role: 'owner' | 'staff' | null;
  status: 'active' | 'revoked' | null;
}

function identityFromRow(row: BoundGoogleIdentityRow): BoundGoogleIdentity {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    googleSubject: row.google_subject,
    membershipId: row.membership_id,
    membershipStoreId: row.store_id,
    membershipRole: row.role,
    membershipStatus: row.status,
  };
}

const IDENTITY_SELECT = `SELECT user.id AS user_id,
        user.email AS email,
        user.name AS name,
        account.accountId AS google_subject,
        membership.id AS membership_id,
        membership.store_id AS store_id,
        membership.role AS role,
        membership.status AS status
   FROM "user" user
   LEFT JOIN account
     ON account.userId = user.id AND account.providerId = 'google'
   LEFT JOIN store_memberships membership
     ON membership.user_id = user.id AND membership.status = 'active'`;

export async function readIdentityByGoogleSubject(
  database: D1Database,
  googleSubject: string,
): Promise<BoundGoogleIdentity | null> {
  const row = await database.prepare(
    `${IDENTITY_SELECT}
      WHERE account.providerId = 'google' AND account.accountId = ?`,
  ).bind(googleSubject).first<BoundGoogleIdentityRow>();
  return row ? identityFromRow(row) : null;
}

export async function readIdentityByEmail(
  database: D1Database,
  email: string,
): Promise<BoundGoogleIdentity | null> {
  const row = await database.prepare(
    `${IDENTITY_SELECT}
      WHERE user.email = ?`,
  ).bind(email).first<BoundGoogleIdentityRow>();
  return row ? identityFromRow(row) : null;
}

export function hasActiveNexusMembership(identity: BoundGoogleIdentity): boolean {
  return identity.membershipId !== null
    && identity.membershipStoreId === NEXUS_STORE_ID
    && identity.membershipStatus === 'active';
}

export function identitiesConflict(
  profile: GoogleOwnerProfile,
  bySubject: BoundGoogleIdentity | null,
  byEmail: BoundGoogleIdentity | null,
): boolean {
  if (bySubject && bySubject.email !== profile.email) return true;
  if (byEmail && byEmail.googleSubject !== null && byEmail.googleSubject !== profile.googleSubject) return true;
  if (bySubject && byEmail && bySubject.userId !== byEmail.userId) return true;
  return false;
}

export function matchingBoundIdentity(
  profile: GoogleOwnerProfile,
  bySubject: BoundGoogleIdentity | null,
  byEmail: BoundGoogleIdentity | null,
): BoundGoogleIdentity | null {
  const identity = bySubject ?? byEmail;
  if (!identity) return null;
  if (identity.email !== profile.email) return null;
  if (identity.googleSubject !== profile.googleSubject) return null;
  return identity;
}

export function ownerBindingStatements(
  database: D1Database,
  profile: GoogleOwnerProfile,
  eligibilitySql: string,
  eligibilityBinds: unknown[],
): { userId: string; accountRowId: string; membershipId: string; statements: D1PreparedStatement[] } {
  const userId = newAuthId();
  const accountRowId = newAuthId();
  const membershipId = newAuthId();
  const now = new Date().toISOString();
  return {
    userId,
    accountRowId,
    membershipId,
    statements: [
      database.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (CASE WHEN ${eligibilitySql} THEN ? ELSE NULL END, ?, ?, 1, ?, ?)`,
      ).bind(...eligibilityBinds, userId, profile.name, profile.email, now, now),
      database.prepare(
        `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
         VALUES (?, ?, 'google', ?, ?, ?)`,
      ).bind(accountRowId, profile.googleSubject, userId, now, now),
      database.prepare(
        `INSERT INTO store_memberships (id, store_id, user_id, role, status, revoked_at)
         VALUES (?, ?, ?, 'owner', 'active', NULL)`,
      ).bind(membershipId, NEXUS_STORE_ID, userId),
    ],
  };
}
