import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GoogleProvisioningError,
  provisionGoogleAccount,
  type NexusAuth,
} from '../../apps/worker/src/auth';
import { digestInvitationToken, invitationContextHmac } from '@nexus/identity/invitations';
import { OWNER_INVITATION_CONTEXT_FIELD } from '@nexus/identity/identity-types';
import { consoleRequest, resetCatalog, workerRequest } from '../support/catalog-test-env';
import { createTestAuth, TEST_BETTER_AUTH_SECRET, TEST_CONSOLE_ORIGIN } from '../support/identity-test-env';

const GOOGLE_IDENTITY = {
  email: 'google-owner@example.test',
  name: 'Google Owner',
  googleSubject: 'google-subject-owner-001',
};

beforeEach(resetCatalog);

function encodeJwtSection(value: object): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function googleIdToken(profile: { email: string; emailVerified: boolean; name: string; sub: string }): string {
  return `${encodeJwtSection({ alg: 'none', typ: 'JWT' })}.${encodeJwtSection({
    sub: profile.sub,
    email: profile.email,
    email_verified: profile.emailVerified,
    name: profile.name,
  })}.`;
}

async function stubGoogleAuthorization(
  auth: NexusAuth,
  profile: { email: string; emailVerified: boolean; name: string; sub: string },
): Promise<void> {
  const context = await auth.$context;
  const google = context.socialProviders.find((provider) => provider.id === 'google');
  if (!google) throw new Error('Expected the Google provider.');
  google.validateAuthorizationCode = async () => ({
    accessToken: 'test-google-access-token',
    idToken: googleIdToken(profile),
  });
}

async function startGoogleSignIn(
  auth: NexusAuth,
  invitationAdditionalData?: Record<string, unknown>,
): Promise<{ authorizationURL: URL; state: string | null; cookies: string }> {
  const started = await auth.handler(new Request(`${TEST_CONSOLE_ORIGIN}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { Origin: TEST_CONSOLE_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'google',
      callbackURL: '/console/products',
      errorCallbackURL: '/console/login?error=google_sign_in_failed',
      ...(invitationAdditionalData === undefined ? {} : { additionalData: invitationAdditionalData }),
    }),
  }));
  const authorizationURL = new URL((await started.json() as { url: string }).url);
  return {
    authorizationURL,
    state: authorizationURL.searchParams.get('state'),
    cookies: started.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; '),
  };
}

async function completeGoogleCallback(
  auth: NexusAuth,
  profile: { email: string; emailVerified: boolean; name: string; sub: string },
  invitationToken?: string,
): Promise<Response> {
  await stubGoogleAuthorization(auth, profile);
  const started = await startGoogleSignIn(
    auth,
    invitationToken === undefined ? undefined : { invitationToken },
  );
  if (invitationToken !== undefined) expect(started.authorizationURL.href).not.toContain(invitationToken);
  return auth.handler(new Request(
    `${TEST_CONSOLE_ORIGIN}/api/auth/callback/google?code=test-code&state=${encodeURIComponent(started.state ?? '')}`,
    { headers: { Cookie: started.cookies } },
  ));
}

describe('Google-only Console authentication', () => {
  it('prebinds one Google subject to the provisioned Nexus user without a password', async () => {
    const auth = createTestAuth();
    const created = await provisionGoogleAccount(auth, GOOGLE_IDENTITY);
    const repeated = await provisionGoogleAccount(auth, GOOGLE_IDENTITY);

    expect(created).toMatchObject({ created: true, recovered: false });
    expect(repeated).toEqual({ created: false, recovered: false, userId: created.userId });
    expect(await env.DB.prepare(
      'SELECT providerId,accountId,userId,password FROM account WHERE userId=?',
    ).bind(created.userId).first()).toEqual({
      providerId: 'google',
      accountId: GOOGLE_IDENTITY.googleSubject,
      userId: created.userId,
      password: null,
    });
  });

  it('rejects a Google subject already bound to another Nexus user', async () => {
    const auth = createTestAuth();
    await provisionGoogleAccount(auth, GOOGLE_IDENTITY);
    await expect(provisionGoogleAccount(auth, {
      ...GOOGLE_IDENTITY,
      email: 'other-owner@example.test',
      name: 'Other Owner',
    })).rejects.toMatchObject({ code: 'identity_conflict' } satisfies Partial<GoogleProvisioningError>);
  });

  it('keeps one canonical Google binding under concurrent conflicting provisioning', async () => {
    const auth = createTestAuth();
    const sameSubject = await Promise.allSettled([
      provisionGoogleAccount(auth, GOOGLE_IDENTITY),
      provisionGoogleAccount(auth, {
        ...GOOGLE_IDENTITY,
        email: 'concurrent-owner@example.test',
        name: 'Concurrent Owner',
      }),
    ]);
    expect(sameSubject.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(sameSubject.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM account WHERE providerId='google' AND accountId=?",
    ).bind(GOOGLE_IDENTITY.googleSubject).first<number>('count')).toBe(1);

    await resetCatalog();
    const sameEmail = await Promise.allSettled([
      provisionGoogleAccount(createTestAuth(), GOOGLE_IDENTITY),
      provisionGoogleAccount(createTestAuth(), { ...GOOGLE_IDENTITY, googleSubject: 'concurrent-google-subject' }),
    ]);
    expect(sameEmail.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(sameEmail.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM account WHERE providerId='google'",
    ).first<number>('count')).toBe(1);
  });

  it('exposes only Google sign-in, Google callback, and sign-out', async () => {
    const started = await workerRequest('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { Origin: TEST_CONSOLE_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: '/console/products',
        errorCallbackURL: '/console/login?error=google_sign_in_failed',
      }),
    });
    expect(started.status).toBe(200);
    const body = await started.json() as { url: string };
    const authorizationURL = new URL(body.url);
    expect(authorizationURL.origin).toBe('https://accounts.google.com');
    expect(authorizationURL.searchParams.get('state')).toBeTruthy();
    expect(authorizationURL.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationURL.searchParams.get('redirect_uri')).toBe(
      `${TEST_CONSOLE_ORIGIN}/api/auth/callback/google`,
    );
    expect(started.headers.get('set-cookie')).toMatch(/HttpOnly/i);

    for (const [path, method] of [
      ['/api/auth/sign-in/email', 'POST'],
      ['/api/auth/sign-up/email', 'POST'],
      ['/api/auth/get-session', 'GET'],
      ['/api/auth/callback/github', 'GET'],
    ] as const) {
      expect((await workerRequest(path, { method })).status, `${method} ${path}`).toBe(404);
    }
  });

  it('returns the prebound user Store and Owner role after the Google callback', async () => {
    const auth = createTestAuth();
    const provisioned = await provisionGoogleAccount(auth, GOOGLE_IDENTITY);
    await env.DB.prepare(
      `INSERT INTO store_memberships (id,store_id,user_id,role,status,revoked_at)
       VALUES (?, 'store_nexus', ?, 'owner', 'active', NULL)`,
    ).bind(`membership_${provisioned.userId}`, provisioned.userId).run();

    const callback = await completeGoogleCallback(auth, {
      email: GOOGLE_IDENTITY.email,
      emailVerified: true,
      name: GOOGLE_IDENTITY.name,
      sub: GOOGLE_IDENTITY.googleSubject,
    });
    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get('Location') ?? '', TEST_CONSOLE_ORIGIN).pathname).toBe('/console/products');
    const signedSession = callback.headers.getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .find((value) => value.includes('session_token='));
    expect(signedSession).toBeTruthy();

    const session = await workerRequest('/api/console/session', {
      headers: { Cookie: signedSession ?? '' },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      user: { id: provisioned.userId, name: GOOGLE_IDENTITY.name },
      store: { id: 'store_nexus', name: 'Nexus' },
      role: 'owner',
    });
  });

  it('rejects a prebound Google subject when its membership is absent or provider email changes', async () => {
    for (const profile of [
      { email: GOOGLE_IDENTITY.email, emailVerified: true, name: GOOGLE_IDENTITY.name, sub: GOOGLE_IDENTITY.googleSubject },
      { email: 'changed@example.test', emailVerified: true, name: GOOGLE_IDENTITY.name, sub: GOOGLE_IDENTITY.googleSubject },
      { email: GOOGLE_IDENTITY.email, emailVerified: false, name: GOOGLE_IDENTITY.name, sub: GOOGLE_IDENTITY.googleSubject },
    ]) {
      await resetCatalog();
      const auth = createTestAuth();
      await provisionGoogleAccount(auth, GOOGLE_IDENTITY);
      const callback = await completeGoogleCallback(auth, profile);
      expect(callback.status).toBe(302);
      const location = new URL(callback.headers.get('Location') ?? '', TEST_CONSOLE_ORIGIN);
      expect(location.pathname).toBe('/console/login');
      expect(location.searchParams.get('error')).toBeTruthy();
      expect(await env.DB.prepare('SELECT count(*) AS count FROM session').first<number>('count')).toBe(0);
    }
  });

  it('carries an issued fragment invitation through Google OAuth to an active Owner session', async () => {
    const issued = await consoleRequest('/api/console/owner-invitations', {
      method: 'POST',
      body: JSON.stringify({ targetEmail: 'invited-google-owner@example.test' }),
    });
    expect(issued.status).toBe(201);
    const invitation = await issued.json() as { id: string; invitationUrl: string };
    const token = new URLSearchParams(new URL(invitation.invitationUrl).hash.slice(1)).get('invite');
    if (!token) throw new Error('Expected the issued invitation fragment.');
    const callback = await completeGoogleCallback(createTestAuth(), {
      email: 'invited-google-owner@example.test',
      emailVerified: true,
      name: 'Invited Google Owner',
      sub: 'google-subject-invited-owner',
    }, token);
    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get('Location') ?? '', TEST_CONSOLE_ORIGIN).pathname).toBe('/console/products');
    const cookie = callback.headers.getSetCookie().map((value) => value.split(';', 1)[0])
      .find((value) => value.includes('session_token='));
    expect(cookie).toBeTruthy();
    const session = await workerRequest('/api/console/session', { headers: { Cookie: cookie ?? '' } });
    expect(session.status).toBe(200);
    const body = await session.json() as { user: { id: string } };
    expect(body).toMatchObject({
      user: { name: 'Invited Google Owner' },
      store: { id: 'store_nexus', name: 'Nexus' },
      role: 'owner',
    });
    expect(await env.DB.prepare('SELECT consumed_user_id, consumed_at FROM owner_invitations WHERE id=?')
      .bind(invitation.id).first()).toMatchObject({ consumed_user_id: body.user.id, consumed_at: expect.any(String) });
  });

  it('persists only a server-derived invitation context after OAuth initiation', async () => {
    const issued = await consoleRequest('/api/console/owner-invitations', {
      method: 'POST',
      body: JSON.stringify({ targetEmail: 'context-owner@example.test' }),
    });
    expect(issued.status).toBe(201);
    const invitation = await issued.json() as { invitationUrl: string };
    const token = new URLSearchParams(new URL(invitation.invitationUrl).hash.slice(1)).get('invite');
    if (!token) throw new Error('Expected the issued invitation fragment.');
    const stolenContext = await invitationContextHmac(TEST_BETTER_AUTH_SECRET, token);
    const auth = createTestAuth();
    await startGoogleSignIn(auth, { invitationToken: token, invitationContext: stolenContext });
    const rows = await env.DB.prepare('SELECT value FROM verification').all<{ value: string }>();
    expect(rows.results).toHaveLength(1);
    const serialized = rows.results[0]?.value ?? '';
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('invitationToken');
    const stored = JSON.parse(serialized) as {
      invitationToken?: unknown;
      invitationContext?: unknown;
      serverContext?: Record<string, unknown>;
    };
    expect(stored.invitationToken).toBeUndefined();
    expect(stored.invitationContext).toBeUndefined();
    expect(stored.serverContext?.[OWNER_INVITATION_CONTEXT_FIELD]).toBe(stolenContext);
    expect(stored.serverContext?.[OWNER_INVITATION_CONTEXT_FIELD]).not.toBe(await digestInvitationToken(token));
  });

  it('does not accept a client-supplied invitation context as an OAuth credential', async () => {
    const issued = await consoleRequest('/api/console/owner-invitations', {
      method: 'POST',
      body: JSON.stringify({ targetEmail: 'context-replay@example.test' }),
    });
    const invitation = await issued.json() as { invitationUrl: string };
    const token = new URLSearchParams(new URL(invitation.invitationUrl).hash.slice(1)).get('invite');
    if (!token) throw new Error('Expected the issued invitation fragment.');
    const stolenContext = await invitationContextHmac(TEST_BETTER_AUTH_SECRET, token);
    const auth = createTestAuth();
    await stubGoogleAuthorization(auth, {
      email: 'context-replay@example.test',
      emailVerified: true,
      name: 'Context Replay',
      sub: 'google-subject-context-replay',
    });
    const started = await startGoogleSignIn(auth, { invitationContext: stolenContext });
    const stored = JSON.parse(
      (await env.DB.prepare('SELECT value FROM verification').first<string>('value')) ?? '{}',
    ) as { serverContext?: Record<string, unknown> };
    expect(stored.serverContext).toBeUndefined();
    const callback = await auth.handler(new Request(
      `${TEST_CONSOLE_ORIGIN}/api/auth/callback/google?code=test-code&state=${encodeURIComponent(started.state ?? '')}`,
      { headers: { Cookie: started.cookies } },
    ));
    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get('Location') ?? '', TEST_CONSOLE_ORIGIN).pathname).toBe('/console/login');
    expect(await env.DB.prepare('SELECT consumed_at FROM owner_invitations').first()).toMatchObject({ consumed_at: null });
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM \"user\" WHERE email='context-replay@example.test'",
    ).first<number>('count')).toBe(0);
  });
});
