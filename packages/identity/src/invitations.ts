import type {
  ConsoleIdentityContext,
  CreatedOwnerInvitation,
  ParsedInvitationContext,
  ParsedInvitationToken,
} from './identity-types';
import { NEXUS_STORE_ID, OWNER_INVITATION_TTL_MS } from './identity-types';
import { newAuthId, normalizeEmail, sha256Hex } from './google-identity';

const INVITATION_CONTEXT_KEY_INFO = 'nexus.owner-invitation.context.v1';

export class OwnerInvitationError extends Error {
  constructor(
    readonly code:
      | 'invalid_email'
      | 'issuer_not_owner'
      | 'store_unavailable'
      | 'target_unavailable'
      | 'create_failed',
  ) {
    super(code);
    this.name = 'OwnerInvitationError';
  }
}

export function parseUntrustedInvitationToken(value: unknown): ParsedInvitationToken {
  if (value === undefined || value === null) return { kind: 'absent' };
  if (typeof value !== 'string') return { kind: 'invalid' };
  const token = value.trim();
  if (token.length === 0) return { kind: 'absent' };
  if (token.length < 16 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return { kind: 'invalid' };
  return { kind: 'present', token };
}

export function parseUntrustedInvitationContext(value: unknown): ParsedInvitationContext {
  if (value === undefined || value === null) return { kind: 'absent' };
  if (typeof value !== 'string') return { kind: 'invalid' };
  const context = value.trim();
  if (context.length === 0) return { kind: 'absent' };
  if (context.length !== 64 || /[^0-9a-f]/.test(context)) return { kind: 'invalid' };
  return { kind: 'present', context };
}

export async function digestInvitationToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export async function invitationContextHmac(secret: string, token: string): Promise<string> {
  const derived = await hmacSha256(new TextEncoder().encode(secret), INVITATION_CONTEXT_KEY_INFO);
  return Array.from(await hmacSha256(derived, token), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomInvitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function hexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array<ArrayBuffer>> {
  const keyMaterial = new Uint8Array(keyBytes.byteLength);
  keyMaterial.set(keyBytes);
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export type StoredOwnerInvitation = {
  id: string;
  storeId: string;
  targetEmail: string;
  expiresAt: string;
  revokedAt: string | null;
  consumedAt: string | null;
  consumedUserId: string | null;
  consumedMembershipId: string | null;
  tokenDigest: string;
  contextHmac: string;
};

export async function createOwnerInvitation(input: {
  database: D1Database;
  secret: string;
  issuer: Pick<ConsoleIdentityContext, 'userId' | 'storeId' | 'membershipId' | 'role' | 'membershipStatus'>;
  targetEmail: string;
  now?: Date;
}): Promise<CreatedOwnerInvitation> {
  if (
    input.issuer.storeId !== NEXUS_STORE_ID
    || input.issuer.role !== 'owner'
    || input.issuer.membershipStatus !== 'active'
  ) {
    throw new OwnerInvitationError('issuer_not_owner');
  }
  if (input.secret.length < 32) throw new OwnerInvitationError('create_failed');
  const targetEmail = normalizeEmail(input.targetEmail);
  if (targetEmail === null) throw new OwnerInvitationError('invalid_email');

  const store = await input.database.prepare('SELECT id FROM stores WHERE id = ?')
    .bind(NEXUS_STORE_ID).first();
  if (!store) throw new OwnerInvitationError('store_unavailable');

  const existingTarget = await input.database.prepare(
    'SELECT id FROM "user" WHERE email = ?',
  ).bind(targetEmail).first();
  if (existingTarget) throw new OwnerInvitationError('target_unavailable');

  const token = randomInvitationToken();
  const tokenDigest = await digestInvitationToken(token);
  const contextHmac = await invitationContextHmac(input.secret, token);
  if (hexEqual(contextHmac, tokenDigest) || contextHmac === token) {
    throw new OwnerInvitationError('create_failed');
  }
  const id = newAuthId();
  const createdAt = input.now ?? new Date();
  const expiresAt = new Date(createdAt.getTime() + OWNER_INVITATION_TTL_MS).toISOString();

  try {
    await input.database.batch([
      input.database.prepare(
        `INSERT INTO owner_invitations (
           id, store_id, token_digest, context_hmac, target_email, role,
           issuer_membership_id, issuer_user_id, expires_at
         ) VALUES (
           CASE WHEN EXISTS (
             SELECT 1 FROM store_memberships
              WHERE id = ? AND user_id = ? AND store_id = ? AND role = 'owner' AND status = 'active'
           ) AND NOT EXISTS (
             SELECT 1 FROM "user" WHERE email = ?
           ) THEN ? ELSE NULL END,
           ?, ?, ?, ?, 'owner', ?, ?, ?
         )`,
      ).bind(
        input.issuer.membershipId,
        input.issuer.userId,
        NEXUS_STORE_ID,
        targetEmail,
        id,
        NEXUS_STORE_ID,
        tokenDigest,
        contextHmac,
        targetEmail,
        input.issuer.membershipId,
        input.issuer.userId,
        expiresAt,
      ),
    ]);
  } catch {
    const issuer = await input.database.prepare(
      `SELECT id FROM store_memberships
        WHERE id = ? AND user_id = ? AND store_id = ? AND role = 'owner' AND status = 'active'`,
    ).bind(input.issuer.membershipId, input.issuer.userId, NEXUS_STORE_ID).first();
    if (!issuer) throw new OwnerInvitationError('issuer_not_owner');
    const racedTarget = await input.database.prepare(
      'SELECT id FROM "user" WHERE email = ?',
    ).bind(targetEmail).first();
    if (racedTarget) throw new OwnerInvitationError('target_unavailable');
    throw new OwnerInvitationError('create_failed');
  }

  const stored = await input.database.prepare(
    `SELECT id, target_email, expires_at, token_digest, context_hmac
       FROM owner_invitations WHERE id = ?`,
  ).bind(id).first<{
    id: string;
    target_email: string;
    expires_at: string;
    token_digest: string;
    context_hmac: string;
  }>();
  if (
    !stored
    || stored.token_digest !== tokenDigest
    || stored.context_hmac !== contextHmac
  ) {
    throw new OwnerInvitationError('create_failed');
  }

  return {
    id: stored.id,
    token,
    expiresAt: stored.expires_at,
    targetEmail: stored.target_email,
  };
}

function invitationFromRow(row: {
  id: string;
  store_id: string;
  target_email: string;
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
  consumed_user_id: string | null;
  consumed_membership_id: string | null;
  token_digest: string;
  context_hmac: string;
}): StoredOwnerInvitation {
  return {
    id: row.id,
    storeId: row.store_id,
    targetEmail: row.target_email,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    consumedAt: row.consumed_at,
    consumedUserId: row.consumed_user_id,
    consumedMembershipId: row.consumed_membership_id,
    tokenDigest: row.token_digest,
    contextHmac: row.context_hmac,
  };
}

const INVITATION_SELECT = `SELECT id, store_id, target_email, expires_at, revoked_at, consumed_at,
            consumed_user_id, consumed_membership_id, token_digest, context_hmac
       FROM owner_invitations`;

export async function readInvitationByDigest(
  database: D1Database,
  tokenDigest: string,
): Promise<StoredOwnerInvitation | null> {
  const row = await database.prepare(
    `${INVITATION_SELECT}
      WHERE token_digest = ? AND store_id = ?`,
  ).bind(tokenDigest, NEXUS_STORE_ID).first<Parameters<typeof invitationFromRow>[0]>();
  return row ? invitationFromRow(row) : null;
}

export async function readInvitationByContextHmac(
  database: D1Database,
  contextHmac: string,
): Promise<StoredOwnerInvitation | null> {
  const row = await database.prepare(
    `${INVITATION_SELECT}
      WHERE context_hmac = ? AND store_id = ?`,
  ).bind(contextHmac, NEXUS_STORE_ID).first<Parameters<typeof invitationFromRow>[0]>();
  return row ? invitationFromRow(row) : null;
}

export async function resolveInvitationOAuthContext(input: {
  database: D1Database;
  secret: string;
  token: string;
  now?: Date;
}): Promise<string | null> {
  if (input.secret.length < 32) return null;
  const parsed = parseUntrustedInvitationToken(input.token);
  if (parsed.kind !== 'present') return null;

  const tokenDigest = await digestInvitationToken(parsed.token);
  const invitation = await readInvitationByDigest(input.database, tokenDigest);
  if (invitation === null) return null;
  if (invitation.revokedAt !== null || invitation.consumedAt !== null) return null;
  const nowIso = (input.now ?? new Date()).toISOString();
  if (invitation.expiresAt <= nowIso) return null;

  const expected = await invitationContextHmac(input.secret, parsed.token);
  if (!hexEqual(expected, invitation.contextHmac)) return null;
  return invitation.contextHmac;
}
