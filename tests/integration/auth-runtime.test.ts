import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { GoogleProvisioningError, createAuth, provisionGoogleAccount } from '../../apps/worker/src/auth';
import { resetCatalog, workerRequest } from '../support/catalog-test-env';
import {
  TEST_BETTER_AUTH_SECRET,
  authRequest,
  createConsoleSession,
  createTestAuth,
  testAuthEnv,
} from '../support/identity-test-env';

const GOOGLE_IDENTITY = {
  email: 'owner@example.test',
  name: 'Nexus Owner',
  googleSubject: 'google-subject-owner',
};

beforeEach(resetCatalog);

describe('Better Auth workerd runtime', () => {
  it('installs the exact selected Better Auth schema', async () => {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user','session','account','verification','rateLimit') ORDER BY name",
    ).all<{ name: string }>();
    expect(rows.results.map(({ name }) => name)).toEqual(['account', 'rateLimit', 'session', 'user', 'verification']);

    const expectedColumns = {
      account: ['id', 'accountId', 'providerId', 'userId', 'accessToken', 'refreshToken', 'idToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt', 'scope', 'password', 'createdAt', 'updatedAt'],
      rateLimit: ['id', 'key', 'count', 'lastRequest'],
      session: ['id', 'expiresAt', 'token', 'createdAt', 'updatedAt', 'ipAddress', 'userAgent', 'userId'],
      user: ['id', 'name', 'email', 'emailVerified', 'image', 'createdAt', 'updatedAt'],
      verification: ['id', 'identifier', 'value', 'expiresAt', 'createdAt', 'updatedAt'],
    };
    for (const [table, columns] of Object.entries(expectedColumns)) {
      const info = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>();
      expect(info.results.map(({ name }) => name), table).toEqual(columns);
    }
    const accountIndexes = await env.DB.prepare("PRAGMA index_list('account')").all<{ name: string; unique: number }>();
    expect(accountIndexes.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'account_provider_subject_unique', unique: 1 }),
      expect.objectContaining({ name: 'account_user_provider_unique', unique: 1 }),
    ]));
  });

  it('prebinds Google without password data and completes a persisted session lifecycle', async () => {
    const auth = createTestAuth();
    const provisioned = await provisionGoogleAccount(auth, GOOGLE_IDENTITY);
    expect(provisioned).toMatchObject({ created: true, recovered: false });
    expect(await env.DB.prepare('SELECT providerId,accountId,password FROM account WHERE userId=?')
      .bind(provisioned.userId).first()).toEqual({
        providerId: 'google', accountId: GOOGLE_IDENTITY.googleSubject, password: null,
      });

    const signedIn = await createConsoleSession(GOOGLE_IDENTITY);
    const current = await authRequest(createTestAuth(), '/api/auth/get-session', {
      headers: { Cookie: signedIn.cookie },
    });
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ user: { email: GOOGLE_IDENTITY.email, name: GOOGLE_IDENTITY.name } });

    const signedOut = await authRequest(createTestAuth(), '/api/auth/sign-out', {
      method: 'POST', headers: { Cookie: signedIn.cookie }, body: '{}',
    });
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    expect(await (await authRequest(auth, '/api/auth/get-session', {
      headers: { Cookie: signedIn.cookie },
    })).json()).toBeNull();
  });

  it('does not reuse origin or secret configuration for the same D1 binding', async () => {
    const first = createTestAuth();
    const session = await createConsoleSession(GOOGLE_IDENTITY);
    const secondOrigin = 'https://console-two.invalid';
    const second = createAuth(testAuthEnv({
      CONSOLE_ORIGIN: secondOrigin,
      BETTER_AUTH_SECRET: `${TEST_BETTER_AUTH_SECRET}-different`,
    }));
    expect(await (await authRequest(second, '/api/auth/get-session', {
      headers: { Cookie: session.cookie },
    }, secondOrigin)).json()).toBeNull();
    expect(await (await authRequest(first, '/api/auth/get-session', {
      headers: { Cookie: session.cookie },
    })).json()).toMatchObject({ user: { email: GOOGLE_IDENTITY.email } });
  });

  it('trusts only the exact configured Console origin when starting Google sign-in', async () => {
    for (const origin of ['https://storefront.test', 'https://localhost.invalid', 'null']) {
      const response = await workerRequest('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, 'cf-connecting-ip': '203.0.113.11' },
        body: JSON.stringify({ provider: 'google', callbackURL: '/console/products' }),
      });
      expect(response.status, origin).toBe(403);
    }
  });

  it('persists rate limits in D1 across fresh auth instances', async () => {
    const path = '/api/auth/sign-out';
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect((await authRequest(createTestAuth(), path, { method: 'POST', body: '{}' })).status).not.toBe(429);
    }
    const limited = await authRequest(createTestAuth(), path, { method: 'POST', body: '{}' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('x-retry-after')).toMatch(/^\d+$/);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM "rateLimit"').first<number>('count')).toBeGreaterThan(0);
  });

  it('rejects invalid and conflicting Google provisioning', async () => {
    const auth = createTestAuth();
    await expect(provisionGoogleAccount(auth, { ...GOOGLE_IDENTITY, email: 'invalid' }))
      .rejects.toMatchObject({ code: 'invalid_identity' } satisfies Partial<GoogleProvisioningError>);
    const created = await provisionGoogleAccount(auth, GOOGLE_IDENTITY);
    expect(await provisionGoogleAccount(auth, GOOGLE_IDENTITY)).toEqual({
      created: false, recovered: false, userId: created.userId,
    });
    await expect(provisionGoogleAccount(auth, { ...GOOGLE_IDENTITY, googleSubject: 'different-subject' }))
      .rejects.toMatchObject({ code: 'identity_conflict' } satisfies Partial<GoogleProvisioningError>);
    await expect(provisionGoogleAccount(auth, { ...GOOGLE_IDENTITY, name: 'Another Owner' }))
      .rejects.toMatchObject({ code: 'identity_conflict' } satisfies Partial<GoogleProvisioningError>);
  });

  it('compensates a partial Google account-link failure before a clean retry', async () => {
    const auth = createTestAuth();
    const context = await auth.$context;
    const realLinkAccount = context.internalAdapter.linkAccount;
    context.internalAdapter.linkAccount = async () => { throw new Error('injected account failure'); };
    await expect(provisionGoogleAccount(auth, GOOGLE_IDENTITY))
      .rejects.toMatchObject({ code: 'provisioning_failed' } satisfies Partial<GoogleProvisioningError>);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM "user"').first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM account').first<number>('count')).toBe(0);
    context.internalAdapter.linkAccount = realLinkAccount;
    expect(await provisionGoogleAccount(auth, GOOGLE_IDENTITY)).toMatchObject({ created: true, recovered: false });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM account').first<number>('count')).toBe(1);
  });

  it('expires persisted sessions instead of falling back to memory state', async () => {
    const session = await createConsoleSession(GOOGLE_IDENTITY);
    await env.DB.prepare("UPDATE session SET expiresAt = '2000-01-01T00:00:00.000Z'").run();
    const expired = await authRequest(createTestAuth(), '/api/auth/get-session', {
      headers: { Cookie: session.cookie },
    });
    expect(await expired.json()).toBeNull();
  });
});
