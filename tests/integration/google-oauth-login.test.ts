import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GoogleProvisioningError,
  provisionGoogleAccount,
} from '../../apps/worker/src/auth';
import { resetCatalog, workerRequest } from '../support/catalog-test-env';
import { createTestAuth, TEST_CONSOLE_ORIGIN } from '../support/identity-test-env';

const GOOGLE_IDENTITY = {
  email: 'google-owner@example.test',
  name: 'Google Owner',
  googleSubject: 'google-subject-owner-001',
};

beforeEach(resetCatalog);

async function completeGoogleCallback(
  auth: ReturnType<typeof createTestAuth>,
  profile: { email: string; emailVerified: boolean; name: string; sub: string },
): Promise<Response> {
  const context = await auth.$context;
  const google = context.socialProviders.find((provider) => provider.id === 'google');
  if (!google) throw new Error('Expected the Google provider.');
  google.validateAuthorizationCode = async () => ({ accessToken: 'test-google-access-token' });
  google.getUserInfo = async () => ({
    user: { email: profile.email, emailVerified: profile.emailVerified, name: profile.name },
    data: { sub: profile.sub },
  });
  const started = await auth.handler(new Request(`${TEST_CONSOLE_ORIGIN}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { Origin: TEST_CONSOLE_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'google',
      callbackURL: '/console/products',
      errorCallbackURL: '/console/login?error=google_sign_in_failed',
    }),
  }));
  const state = new URL((await started.json() as { url: string }).url).searchParams.get('state');
  const stateCookies = started.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
  return auth.handler(new Request(
    `${TEST_CONSOLE_ORIGIN}/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state ?? '')}`,
    { headers: { Cookie: stateCookies } },
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
});
