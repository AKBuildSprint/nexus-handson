import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { admitGoogleOwner } from '@nexus/identity/admission';
import {
  createOwnerInvitation,
  digestInvitationToken,
  invitationContextHmac,
} from '@nexus/identity/invitations';
import { getConsoleIdentity, resetCatalog } from '../support/catalog-test-env';
import { TEST_BETTER_AUTH_SECRET } from '../support/identity-test-env';

const BOOTSTRAP = {
  email: 'bootstrap-owner@example.test',
  name: 'Bootstrap Owner',
  googleSubject: 'google-subject-bootstrap',
  emailVerified: true,
};

beforeEach(resetCatalog);

describe('Google owner bootstrap admission', () => {
  it('admits the configured verified Google email once and is idempotent on retry', async () => {
    const first = await admitGoogleOwner({
      database: env.DB,
      profile: BOOTSTRAP,
      initialOwnerEmail: BOOTSTRAP.email,
    });
    expect(first).toMatchObject({ kind: 'admitted', created: true });
    const retry = await admitGoogleOwner({
      database: env.DB,
      profile: BOOTSTRAP,
      initialOwnerEmail: BOOTSTRAP.email,
    });
    expect(retry).toEqual({
      kind: 'admitted',
      created: false,
      userId: first.kind === 'admitted' ? first.userId : '',
      membershipId: first.kind === 'admitted' ? first.membershipId : '',
    });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM store_bootstrap_claims').first<number>('count')).toBe(1);
  });

  it('denies a verified mismatch, unverified profile, and unconfigured secret', async () => {
    expect(await admitGoogleOwner({
      database: env.DB,
      profile: BOOTSTRAP,
      initialOwnerEmail: 'other-owner@example.test',
    })).toEqual({ kind: 'denied' });
    expect(await admitGoogleOwner({
      database: env.DB,
      profile: { ...BOOTSTRAP, emailVerified: false },
      initialOwnerEmail: BOOTSTRAP.email,
    })).toEqual({ kind: 'denied' });
    expect(await admitGoogleOwner({
      database: env.DB,
      profile: BOOTSTRAP,
    })).toEqual({ kind: 'denied' });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM "user"').first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM store_bootstrap_claims').first<number>('count')).toBe(0);
  });

  it('cannot establish two bootstrap owners under concurrent callbacks', async () => {
    const results = await Promise.all([
      admitGoogleOwner({
        database: env.DB,
        profile: BOOTSTRAP,
        initialOwnerEmail: BOOTSTRAP.email,
      }),
      admitGoogleOwner({
        database: env.DB,
        profile: { ...BOOTSTRAP, googleSubject: 'google-subject-bootstrap-race' },
        initialOwnerEmail: BOOTSTRAP.email,
      }),
    ]);
    expect(results.filter((result) => result.kind === 'admitted')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'denied')).toHaveLength(1);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM store_bootstrap_claims').first<number>('count')).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM store_memberships').first<number>('count')).toBe(1);
  });
});

describe('Google owner invitation admission', () => {
  async function issueInvitation(targetEmail: string, now?: Date) {
    const issuer = await getConsoleIdentity();
    const invitation = await createOwnerInvitation({
      database: env.DB,
      secret: TEST_BETTER_AUTH_SECRET,
      issuer,
      targetEmail,
      now,
    });
    return {
      invitation,
      context: await invitationContextHmac(TEST_BETTER_AUTH_SECRET, invitation.token),
    };
  }

  it('redeems a matching pending invitation into one Owner binding', async () => {
    const { invitation, context } = await issueInvitation('invited-owner@example.test');
    const admitted = await admitGoogleOwner({
      database: env.DB,
      profile: {
        email: 'invited-owner@example.test',
        name: 'Invited Owner',
        googleSubject: 'google-subject-invited',
        emailVerified: true,
      },
      invitationContext: context,
    });
    expect(admitted).toMatchObject({ kind: 'admitted', created: true });
    expect(await env.DB.prepare('SELECT consumed_user_id, consumed_membership_id FROM owner_invitations WHERE id=?')
      .bind(invitation.id).first()).toMatchObject({
      consumed_user_id: admitted.kind === 'admitted' ? admitted.userId : null,
      consumed_membership_id: admitted.kind === 'admitted' ? admitted.membershipId : null,
    });
  });

  it('rejects expiration, revocation, replay, and email mismatch without partial authority', async () => {
    const expired = await issueInvitation('expired-owner@example.test', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
    expect(await admitGoogleOwner({
      database: env.DB,
      profile: {
        email: 'expired-owner@example.test',
        name: 'Expired Owner',
        googleSubject: 'google-subject-expired',
        emailVerified: true,
      },
      invitationContext: expired.context,
    })).toEqual({ kind: 'denied' });

    const revoked = await issueInvitation('revoked-invite@example.test');
    await env.DB.prepare('UPDATE owner_invitations SET revoked_at=? WHERE id=?')
      .bind(new Date().toISOString(), revoked.invitation.id).run();
    expect(await admitGoogleOwner({
      database: env.DB,
      profile: {
        email: 'revoked-invite@example.test',
        name: 'Revoked Invite',
        googleSubject: 'google-subject-revoked-invite',
        emailVerified: true,
      },
      invitationContext: revoked.context,
    })).toEqual({ kind: 'denied' });

    const mismatch = await issueInvitation('matching-owner@example.test');
    expect(await admitGoogleOwner({
      database: env.DB,
      profile: {
        email: 'other-owner@example.test',
        name: 'Other Owner',
        googleSubject: 'google-subject-mismatch',
        emailVerified: true,
      },
      invitationContext: mismatch.context,
    })).toEqual({ kind: 'denied' });

    const replay = await issueInvitation('replay-owner@example.test');
    const first = await admitGoogleOwner({
      database: env.DB,
      profile: {
        email: 'replay-owner@example.test',
        name: 'Replay Owner',
        googleSubject: 'google-subject-replay',
        emailVerified: true,
      },
      invitationContext: replay.context,
    });
    expect(first.kind).toBe('admitted');
    expect(await admitGoogleOwner({
      database: env.DB,
      profile: {
        email: 'replay-owner@example.test',
        name: 'Replay Owner',
        googleSubject: 'google-subject-replay',
        emailVerified: true,
      },
      invitationContext: replay.context,
    })).toMatchObject({ kind: 'admitted', created: false });
    expect(await admitGoogleOwner({
      database: env.DB,
      profile: {
        email: 'replay-owner@example.test',
        name: 'Replay Owner',
        googleSubject: 'google-subject-replay-other',
        emailVerified: true,
      },
      invitationContext: replay.context,
    })).toEqual({ kind: 'denied' });

    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM \"user\" WHERE email IN ('expired-owner@example.test','revoked-invite@example.test','other-owner@example.test')",
    ).first<number>('count')).toBe(0);
    expect(await env.DB.prepare(
      'SELECT consumed_at FROM owner_invitations WHERE id=?',
    ).bind(expired.invitation.id).first()).toMatchObject({ consumed_at: null });
    expect(await env.DB.prepare(
      'SELECT consumed_at FROM owner_invitations WHERE id=?',
    ).bind(revoked.invitation.id).first()).toMatchObject({ consumed_at: null });
    expect(await env.DB.prepare(
      'SELECT consumed_at FROM owner_invitations WHERE id=?',
    ).bind(mismatch.invitation.id).first()).toMatchObject({ consumed_at: null });
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM store_memberships membership JOIN \"user\" user ON user.id = membership.user_id WHERE user.email = 'replay-owner@example.test'",
    ).first<number>('count')).toBe(1);
  });

  it('does not treat a token digest or raw token as invitation context', async () => {
    const { invitation } = await issueInvitation('digest-owner@example.test');
    const digest = await digestInvitationToken(invitation.token);
    expect(await admitGoogleOwner({
      database: env.DB,
      profile: {
        email: 'digest-owner@example.test',
        name: 'Digest Owner',
        googleSubject: 'google-subject-digest',
        emailVerified: true,
      },
      invitationContext: digest,
    })).toEqual({ kind: 'denied' });
    expect(await admitGoogleOwner({
      database: env.DB,
      profile: {
        email: 'digest-owner@example.test',
        name: 'Digest Owner',
        googleSubject: 'google-subject-digest',
        emailVerified: true,
      },
      invitationContext: invitation.token,
    })).toEqual({ kind: 'denied' });
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM \"user\" WHERE email='digest-owner@example.test'",
    ).first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT consumed_at FROM owner_invitations WHERE id=?')
      .bind(invitation.id).first()).toMatchObject({ consumed_at: null });
  });
});
