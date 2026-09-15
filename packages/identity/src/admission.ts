import type { GoogleOwnerProfile, OwnerAdmissionResult } from './identity-types';
import { NEXUS_STORE_ID } from './identity-types';
import {
  hasActiveNexusMembership,
  identitiesConflict,
  matchingBoundIdentity,
  normalizeEmail,
  normalizeGoogleOwnerProfile,
  ownerBindingStatements,
  readIdentityByEmail,
  readIdentityByGoogleSubject,
  type BoundGoogleIdentity,
} from './google-identity';
import {
  parseUntrustedInvitationContext,
  readInvitationByContextHmac,
} from './invitations';

export async function admitGoogleOwner(input: {
  database: D1Database;
  profile: {
    email: unknown;
    name: unknown;
    googleSubject: unknown;
    emailVerified: unknown;
  };
  initialOwnerEmail?: string;
  invitationContext?: unknown;
  now?: Date;
}): Promise<OwnerAdmissionResult> {
  const profile = normalizeGoogleOwnerProfile(input.profile);
  if (profile === null) return { kind: 'denied' };

  const [bySubject, byEmail] = await Promise.all([
    readIdentityByGoogleSubject(input.database, profile.googleSubject),
    readIdentityByEmail(input.database, profile.email),
  ]);
  if (identitiesConflict(profile, bySubject, byEmail)) return { kind: 'denied' };

  const existing = matchingBoundIdentity(profile, bySubject, byEmail);
  if (existing && hasActiveNexusMembership(existing) && existing.membershipId) {
    return { kind: 'admitted', userId: existing.userId, membershipId: existing.membershipId, created: false };
  }

  const invitation = parseUntrustedInvitationContext(input.invitationContext);
  if (invitation.kind === 'invalid') return { kind: 'denied' };
  if (invitation.kind === 'present') {
    return redeemInvitation(input.database, profile, invitation.context, input.now ?? new Date());
  }

  const initialOwnerEmail = typeof input.initialOwnerEmail === 'string'
    ? normalizeEmail(input.initialOwnerEmail)
    : null;
  if (initialOwnerEmail === null || initialOwnerEmail !== profile.email) return { kind: 'denied' };
  return claimBootstrap(input.database, profile, existing);
}

async function claimBootstrap(
  database: D1Database,
  profile: GoogleOwnerProfile,
  existing: BoundGoogleIdentity | null,
): Promise<OwnerAdmissionResult> {
  if (existing) return { kind: 'denied' };

  const binding = ownerBindingStatements(
    database,
    profile,
    'EXISTS (SELECT 1 FROM stores WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM store_bootstrap_claims WHERE store_id = ?)',
    [NEXUS_STORE_ID, NEXUS_STORE_ID],
  );
  try {
    await database.batch([
      ...binding.statements,
      database.prepare(
        `INSERT INTO store_bootstrap_claims (store_id, membership_id, user_id)
         VALUES (
           CASE WHEN EXISTS (
             SELECT 1 FROM store_memberships
              WHERE id = ? AND user_id = ? AND store_id = ? AND role = 'owner' AND status = 'active'
           ) THEN ? ELSE NULL END,
           ?, ?
         )`,
      ).bind(
        binding.membershipId,
        binding.userId,
        NEXUS_STORE_ID,
        NEXUS_STORE_ID,
        binding.membershipId,
        binding.userId,
      ),
    ]);
  } catch {
    return reconcileAdmission(database, profile, 'bootstrap', undefined, false);
  }
  return reconcileAdmission(database, profile, 'bootstrap', undefined, true);
}

async function redeemInvitation(
  database: D1Database,
  profile: GoogleOwnerProfile,
  contextHmac: string,
  now: Date,
): Promise<OwnerAdmissionResult> {
  const nowIso = now.toISOString();
  const binding = ownerBindingStatements(
    database,
    profile,
    `EXISTS (SELECT 1 FROM stores WHERE id = ?)
     AND EXISTS (
       SELECT 1 FROM owner_invitations
        WHERE context_hmac = ?
          AND store_id = ?
          AND target_email = ?
          AND revoked_at IS NULL
          AND consumed_at IS NULL
          AND expires_at > ?
     )`,
    [NEXUS_STORE_ID, contextHmac, NEXUS_STORE_ID, profile.email, nowIso],
  );
  try {
    await database.batch([
      ...binding.statements,
      database.prepare(
        `UPDATE owner_invitations
            SET consumed_at = CASE
                  WHEN revoked_at IS NULL
                   AND consumed_at IS NULL
                   AND target_email = ?
                   AND expires_at > ?
                   AND EXISTS (
                     SELECT 1 FROM store_memberships
                      WHERE id = ?
                        AND user_id = ?
                        AND store_id = owner_invitations.store_id
                        AND role = 'owner'
                        AND status = 'active'
                   )
                  THEN ?
                  ELSE NULL
                END,
                consumed_membership_id = ?,
                consumed_user_id = ?
          WHERE context_hmac = ? AND store_id = ?`,
      ).bind(
        profile.email,
        nowIso,
        binding.membershipId,
        binding.userId,
        nowIso,
        binding.membershipId,
        binding.userId,
        contextHmac,
        NEXUS_STORE_ID,
      ),
    ]);
  } catch {
    return reconcileAdmission(database, profile, 'invite', contextHmac, false);
  }
  return reconcileAdmission(database, profile, 'invite', contextHmac, true);
}

async function reconcileAdmission(
  database: D1Database,
  profile: GoogleOwnerProfile,
  reason: 'bootstrap' | 'invite',
  contextHmac: string | undefined,
  created: boolean,
): Promise<OwnerAdmissionResult> {
  const [bySubject, byEmail] = await Promise.all([
    readIdentityByGoogleSubject(database, profile.googleSubject),
    readIdentityByEmail(database, profile.email),
  ]);
  if (identitiesConflict(profile, bySubject, byEmail)) return { kind: 'denied' };
  const identity = matchingBoundIdentity(profile, bySubject, byEmail);
  if (!identity || !identity.membershipId || !hasActiveNexusMembership(identity)) return { kind: 'denied' };

  if (reason === 'bootstrap') {
    const claim = await database.prepare(
      'SELECT user_id FROM store_bootstrap_claims WHERE store_id = ?',
    ).bind(NEXUS_STORE_ID).first<{ user_id: string }>();
    if (!claim || claim.user_id !== identity.userId) return { kind: 'denied' };
    return { kind: 'admitted', userId: identity.userId, membershipId: identity.membershipId, created };
  }

  if (contextHmac === undefined) return { kind: 'denied' };
  const invitation = await readInvitationByContextHmac(database, contextHmac);
  if (invitation === null || invitation.consumedUserId !== identity.userId) return { kind: 'denied' };
  if (invitation.consumedMembershipId !== identity.membershipId) return { kind: 'denied' };
  return { kind: 'admitted', userId: identity.userId, membershipId: identity.membershipId, created };
}
