import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConsoleAuth } from '@nexus/auth/auth';
import { resetCatalog } from '../support/catalog-test-env';
import {
  authWorkerRequest,
  createTestSession,
  TEST_AUTH_CONFIGURATION,
  TEST_AUTH_EMAIL,
  TEST_CONSOLE_ORIGIN,
} from '../support/auth-test-env';

beforeEach(resetCatalog);

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ error: { code } });
}

const privateRoutes = [
  ['GET', '/api/console/session'],
  ['GET', '/api/console/products'],
  ['POST', '/api/console/products'],
  ['GET', '/api/console/products/product-missing'],
  ['PATCH', '/api/console/products/product-missing'],
  ['POST', '/api/console/products/schema/preview'],
  ['GET', '/api/console/imports/template'],
  ['POST', '/api/console/imports'],
  ['PUT', '/api/console/products/product-missing/delivery-file'],
  ['DELETE', '/api/console/products/product-missing/variants/variant-missing/delivery-file'],
  ['GET', '/api/console/orders'],
  ['GET', '/api/console/orders/NX-0123456789ABCDEF'],
  ['POST', '/api/console/orders/NX-0123456789ABCDEF/payments/manual'],
  ['POST', '/api/console/orders/NX-0123456789ABCDEF/fulfill'],
  ['POST', '/api/console/orders/NX-0123456789ABCDEF/cancel'],
  ['POST', '/api/console/orders/NX-0123456789ABCDEF/refund-requests'],
] as const;

describe('Console session boundary', () => {
  it('runs the provider session API in the Worker runtime', async () => {
    const auth = createConsoleAuth(env.DB, TEST_AUTH_CONFIGURATION);
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
  });

  it.each(privateRoutes)('requires a session before dispatching %s %s', async (method, path) => {
    await expectError(await authWorkerRequest(path, {
      method,
      headers: { Origin: TEST_CONSOLE_ORIGIN, 'X-Nexus-Order-Contract': '2' },
    }), 401, 'authentication_required');
  });

  it('rejects a forged cookie and client-supplied identity', async () => {
    const legitimate = await createTestSession();
    const cookieName = legitimate.cookie.split('=')[0];
    await expectError(await authWorkerRequest('/api/console/products', {
      method: 'POST',
      headers: {
        Cookie: `${cookieName}=forged-token.forged-signature`,
        Origin: TEST_CONSOLE_ORIGIN,
        'Content-Type': 'application/json',
        'X-User-Id': legitimate.user.id,
      },
      body: JSON.stringify({ storeId: 'store_nexus', actor: { source: 'user', id: legitimate.user.id } }),
    }), 401, 'authentication_required');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM products').first<number>('count')).toBe(0);
  });

  it('loads the persisted session on independent requests and exposes only the account summary', async () => {
    const { user, cookie, serializedCookie } = await createTestSession();
    expect(serializedCookie).toMatch(/HttpOnly/i);
    expect(serializedCookie).toMatch(/Secure/i);
    expect(serializedCookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/^__Secure-nexus\./);
    for (const path of ['/api/console/session', '/api/auth/get-session', '/api/console/session']) {
      const response = await authWorkerRequest(path, { headers: { Cookie: cookie } });
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ user: { id: user.id, name: user.name, email: TEST_AUTH_EMAIL } });
    }
  });

  it.each(['expired', 'revoked', 'deleted-user'] as const)('rejects a %s session', async (state) => {
    const { user, session, cookie, context } = await createTestSession({
      expiresAt: state === 'expired' ? new Date(Date.now() - 60_000) : undefined,
    });
    if (state === 'revoked') await context.internalAdapter.deleteSession(session.token);
    if (state === 'deleted-user') await context.internalAdapter.deleteUser(user.id);
    await expectError(await authWorkerRequest('/api/console/session', { headers: { Cookie: cookie } }), 401, 'authentication_required');
  });

  it('rechecks the current allowlist for an existing session', async () => {
    const { cookie } = await createTestSession();
    await expectError(await authWorkerRequest('/api/console/session', { headers: { Cookie: cookie } }, {
      ...TEST_AUTH_CONFIGURATION,
      CONSOLE_ALLOWED_EMAILS: 'someone-else@example.test',
    }), 403, 'access_denied');
  });

  it('rejects an existing session when its user becomes unverified', async () => {
    const { user, cookie, context } = await createTestSession();
    await context.internalAdapter.updateUser(user.id, { emailVerified: false });
    await expectError(await authWorkerRequest('/api/console/session', { headers: { Cookie: cookie } }), 403, 'access_denied');
  });

  it.each(Object.keys(TEST_AUTH_CONFIGURATION))('fails closed when %s is missing', async (key) => {
    const configuration = { ...TEST_AUTH_CONFIGURATION, [key]: undefined };
    await expectError(await authWorkerRequest('/api/console/session', undefined, configuration), 503, 'auth_not_configured');
  });

  it.each([undefined, 'https://storefront.test', 'https://attacker.test', 'null'])('rejects mutation origin %s', async (origin) => {
    const { cookie } = await createTestSession();
    const headers = new Headers({ Cookie: cookie });
    if (origin !== undefined) headers.set('Origin', origin);
    for (const path of ['/api/console/products', '/api/console/imports', '/api/auth/sign-out']) {
      await expectError(await authWorkerRequest(path, { method: 'POST', headers }), 403, 'invalid_origin');
    }
  });

  it('rejects cross-site fetch metadata even with a matching origin', async () => {
    const { cookie } = await createTestSession();
    await expectError(await authWorkerRequest('/api/console/products', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_CONSOLE_ORIGIN, 'Sec-Fetch-Site': 'cross-site' },
    }), 403, 'invalid_origin');
  });

  it('signs out by revoking the server session and clearing its cookie', async () => {
    const { cookie, session, context } = await createTestSession();
    const response = await authWorkerRequest('/api/auth/sign-out', {
      method: 'POST', headers: { Cookie: cookie, Origin: TEST_CONSOLE_ORIGIN },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await context.internalAdapter.findSession(session.token)).toBeNull();
    await expectError(await authWorkerRequest('/api/console/session', { headers: { Cookie: cookie } }), 401, 'authentication_required');
  });

  it('keeps public catalog routes available without Console configuration or sessions', async () => {
    const response = await authWorkerRequest('/api/storefront/products', undefined, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ products: [] });
  });
});

describe('Google-only OAuth surface', () => {
  it.each([
    ['POST', '/api/auth/sign-up/email'],
    ['POST', '/api/auth/sign-in/email'],
    ['POST', '/api/auth/forget-password'],
    ['GET', '/api/auth/list-sessions'],
    ['GET', '/api/auth/callback/github'],
  ])('does not expose %s %s', async (method, path) => {
    await expectError(await authWorkerRequest(path, { method, headers: { Origin: TEST_CONSOLE_ORIGIN } }), 404, 'route_not_found');
  });

  it('starts Google consent with state, PKCE and the exact Console callback', async () => {
    const response = await authWorkerRequest('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { Origin: TEST_CONSOLE_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: `${TEST_CONSOLE_ORIGIN}/console/products` }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string; redirect: boolean };
    const url = new URL(body.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe(TEST_AUTH_CONFIGURATION.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(`${TEST_CONSOLE_ORIGIN}/api/auth/callback/google`);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(response.headers.get('Set-Cookie')).toMatch(/HttpOnly/i);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps the same Google identity accessible after its allowed email changes', async () => {
    const previous = await createTestSession();
    const googleId = 'google-stable-operator';
    await previous.context.internalAdapter.createAccount({
      userId: previous.user.id,
      providerId: 'google',
      accountId: googleId,
    });
    const email = 'renamed@example.test';
    const configuration = { ...TEST_AUTH_CONFIGURATION, CONSOLE_ALLOWED_EMAILS: email };
    const auth = createConsoleAuth(env.DB, configuration);
    const context = await auth.$context;
    const google = context.socialProviders.find((provider) => provider.id === 'google')!;
    google.validateAuthorizationCode = async () => ({ accessToken: 'test-google-access-token' });
    google.getUserInfo = async () => ({
      user: { email, emailVerified: true, name: 'Renamed Operator' },
      data: { sub: googleId },
    });

    const started = await auth.handler(new Request(`${TEST_CONSOLE_ORIGIN}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { Origin: TEST_CONSOLE_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/console/products' }),
    }));
    expect(started.status).toBe(200);
    const state = new URL((await started.json() as { url: string }).url).searchParams.get('state')!;
    const cookie = started.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const callback = await auth.handler(new Request(
      `${TEST_CONSOLE_ORIGIN}/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: cookie } },
    ));
    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get('Location')!, TEST_CONSOLE_ORIGIN).pathname).toBe('/console/products');
    const sessionCookie = callback.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const session = await authWorkerRequest('/api/console/session', {
      headers: { Cookie: sessionCookie },
    }, configuration);
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({
      user: { id: previous.user.id, name: 'Renamed Operator', email },
    });
  });

  it('rejects an external post-login redirect', async () => {
    const response = await authWorkerRequest('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { Origin: TEST_CONSOLE_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: 'https://attacker.test/take-session' }),
    });
    expect(response.status).toBe(403);
  });

  it.each(['?code=untrusted', '?code=untrusted&state=forged'])(
    'returns invalid OAuth state to the login screen for %s', async (query) => {
      const response = await authWorkerRequest(`/api/auth/callback/google${query}`);
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get('Location')!);
      expect(location.origin).toBe(TEST_CONSOLE_ORIGIN);
      expect(location.pathname).toBe('/console/login');
      expect(location.searchParams.get('error')).toBeTruthy();
      expect(response.headers.get('Set-Cookie') ?? '').not.toMatch(/nexus\.session_token=[^;]/);
      expect(await env.DB.prepare('SELECT count(*) AS count FROM nexus_auth_session').first<number>('count')).toBe(0);
    },
  );

  it.each(['expired', 'replayed'] as const)('rejects %s OAuth state and returns to login', async (stateStatus) => {
    const started = await authWorkerRequest('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { Origin: TEST_CONSOLE_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: `${TEST_CONSOLE_ORIGIN}/console/products` }),
    });
    expect(started.status).toBe(200);
    const state = new URL((await started.json() as { url: string }).url).searchParams.get('state')!;
    const cookie = started.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const callbackPath = `/api/auth/callback/google?state=${encodeURIComponent(state)}&error=access_denied`;
    const context = await createConsoleAuth(env.DB, TEST_AUTH_CONFIGURATION).$context;
    if (stateStatus === 'expired') {
      const verification = await context.internalAdapter.findVerificationValue(state);
      expect(verification).not.toBeNull();
      await context.internalAdapter.updateVerificationByIdentifier(state, {
        value: JSON.stringify({ ...JSON.parse(verification!.value), expiresAt: Date.now() - 60_000 }),
        expiresAt: new Date(Date.now() - 60_000),
      });
    } else {
      const denied = await authWorkerRequest(callbackPath, { headers: { Cookie: cookie } });
      expect(denied.status).toBe(302);
      expect(new URL(denied.headers.get('Location')!).searchParams.get('error')).toBe('access_denied');
    }
    const response = await authWorkerRequest(callbackPath, { headers: { Cookie: cookie } });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location')!);
    expect(location.origin).toBe(TEST_CONSOLE_ORIGIN);
    expect(location.pathname).toBe('/console/login');
    expect(location.searchParams.get('error')).toBe('state_mismatch');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM nexus_auth_session').first<number>('count')).toBe(0);
  });

  it('rejects unverified, unlisted and non-Google provider identity before persistence', async () => {
    const validate = createConsoleAuth(env.DB, TEST_AUTH_CONFIGURATION).options.user!.validateUserInfo!;
    const user = { email: TEST_AUTH_EMAIL, emailVerified: true };
    const source = { oauth: { providerId: 'google' } };
    expect(await validate({ user, source } as Parameters<typeof validate>[0])).toBeUndefined();
    for (const input of [
      { user: { ...user, emailVerified: false }, source },
      { user: { ...user, email: 'outsider@example.test' }, source },
      { user, source: { oauth: { providerId: 'github' } } },
    ]) {
      expect(await validate(input as Parameters<typeof validate>[0])).toMatchObject({ error: 'access_denied' });
    }
  });
});
