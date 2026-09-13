import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionGoogleAccount } from '../../apps/worker/src/auth';
import { withConsoleAuthHeaders } from '../../apps/worker/src/http-response';
import worker from '../../apps/worker/src';
import type { Env } from '../../apps/worker/src/environment';
import { consoleRequest, resetCatalog, SIMPLE_CORE, workerRequest } from '../support/catalog-test-env';
import {
  createConsoleSession,
  createPersistedTestSession,
  createTestAuth,
  TEST_CONSOLE_ORIGIN,
} from '../support/identity-test-env';

beforeEach(resetCatalog);

describe('Console authentication boundary', () => {
  it('denies the former anonymous Console bootstrap path before private disclosure', async () => {
    for (const path of [
      '/api/console/products',
      '/api/console/imports/template',
      '/api/console/orders',
      '/api/console/session',
    ]) {
      const response = await workerRequest(path);
      expect(response.status, path).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toMatchObject({
        error: { code: 'unauthenticated' },
      });
    }
    const fileMutation = await workerRequest('/api/console/products/product_missing/delivery-file', {
      method: 'PUT',
    });
    expect(fileMutation.status).toBe(401);
    expect(await fileMutation.json()).toMatchObject({ error: { code: 'unauthenticated' } });
  });

  it('keeps unknown Console routes as route-not-found before auth and origin checks', async () => {
    const anonymous = await workerRequest('/api/console/missing');
    expect(anonymous.status).toBe(404);
    expect(await anonymous.json()).toMatchObject({ error: { code: 'route_not_found' } });

    const session = await createConsoleSession();
    const authenticated = await workerRequest('/api/console/missing', {
      method: 'POST',
      headers: { Cookie: session.cookie },
      body: '{}',
    });
    expect(authenticated.status).toBe(404);
    expect(await authenticated.json()).toMatchObject({ error: { code: 'route_not_found' } });
  });

  it('checks session and membership before the Order contract marker', async () => {
    const anonymous = await workerRequest('/api/console/orders', {
      headers: { 'X-Nexus-Order-Contract': '' },
    });
    expect(anonymous.status).toBe(401);

    const revoked = await createConsoleSession({ email: 'contract-revoked@example.test' });
    await env.DB.prepare(
      "UPDATE store_memberships SET status='revoked', revoked_at=? WHERE user_id=?",
    ).bind(new Date().toISOString(), revoked.userId).run();
    const denied = await workerRequest('/api/console/orders', {
      headers: { Cookie: revoked.cookie, 'X-Nexus-Order-Contract': '' },
    });
    expect(denied.status).toBe(403);

    const active = await createConsoleSession({ email: 'contract-owner@example.test' });
    const outdated = await workerRequest('/api/console/orders', {
      headers: { Cookie: active.cookie, 'X-Nexus-Order-Contract': '' },
    });
    expect(outdated.status).toBe(409);
    expect(await outdated.json()).toMatchObject({ error: { code: 'client_contract_outdated' } });

    const concealed = await workerRequest('/api/console/orders/NX-FFFFFFFFFFFFFFFF', {
      headers: { Cookie: active.cookie, 'X-Nexus-Order-Contract': '1' },
    });
    expect(concealed.status).toBe(404);
    expect(await concealed.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('mounts Google sign-in and sign-out without exposing email/password endpoints', async () => {
    const session = await createConsoleSession();
    const started = await workerRequest('/api/auth/sign-in/social', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: TEST_CONSOLE_ORIGIN,
        'cf-connecting-ip': '203.0.113.10',
      },
      body: JSON.stringify({ provider: 'google', callbackURL: '/console/products' }),
    });
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ redirect: true, url: expect.stringContaining('accounts.google.com') });
    expect(started.headers.get('set-cookie')).toContain('HttpOnly');

    for (const [path, method] of [
      ['/api/auth/get-session', 'GET'],
      ['/api/auth/sign-up/email', 'POST'],
      ['/api/auth/sign-in/email', 'POST'],
      ['/api/auth/callback/github', 'GET'],
    ] as const) {
      const response = await workerRequest(path, { method });
      expect(response.status, path).toBe(404);
    }

    const signedOut = await workerRequest('/api/auth/sign-out', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        Origin: TEST_CONSOLE_ORIGIN,
        'cf-connecting-ip': '203.0.113.10',
      },
      body: '{}',
    });
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('returns the projected session for one active membership without credential fields', async () => {
    const session = await createConsoleSession();
    const response = await workerRequest('/api/console/session', {
      headers: { Cookie: session.cookie },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      user: { id: session.userId, name: 'Nexus Owner' },
      store: { id: 'store_nexus', name: 'Nexus' },
      role: 'owner',
    });
    expect(body).toHaveProperty('allowedActions');
    expect(JSON.stringify(body)).not.toMatch(/token|password|account/i);
  });

  it('distinguishes missing or revoked Store access from an expired session', async () => {
    const auth = createTestAuth();
    const withoutMembership = await provisionGoogleAccount(auth, {
      email: 'unassigned@example.test',
      name: 'Unassigned',
      googleSubject: 'google-subject-unassigned',
    });
    const denied = await workerRequest('/api/console/session', {
      headers: { Cookie: await createPersistedTestSession(auth, withoutMembership.userId) },
    });
    expect(withoutMembership.userId).toEqual(expect.any(String));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: 'store_access_denied' } });

    const active = await createConsoleSession({ email: 'revoked@example.test', name: 'Revoked Owner' });
    await env.DB.prepare(
      "UPDATE session SET updatedAt='2000-01-01T00:00:00.000Z', expiresAt=? WHERE userId=?",
    ).bind(new Date(Date.now() + 60 * 60 * 1000).toISOString(), active.userId).run();
    await env.DB.prepare(
      "UPDATE store_memberships SET status='revoked', revoked_at=? WHERE user_id=?",
    ).bind(new Date().toISOString(), active.userId).run();
    const revoked = await workerRequest('/api/console/products', {
      headers: { Cookie: active.cookie },
    });
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toMatchObject({ error: { code: 'store_access_denied' } });
    expect(revoked.headers.get('set-cookie')).toContain('better-auth.session_token=');
    expect(revoked.headers.get('set-cookie') ?? '').not.toMatch(/Max-Age=0/i);

    await env.DB.prepare("UPDATE session SET expiresAt='2000-01-01T00:00:00.000Z'").run();
    const expired = await workerRequest('/api/console/products', {
      headers: { Cookie: active.cookie },
    });
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ error: { code: 'unauthenticated' } });
    expect(expired.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('requires exact origin proof for Console mutations after authentication', async () => {
    const session = await createConsoleSession();
    const deniedHeaders: HeadersInit[] = [
      { Cookie: session.cookie },
      { Cookie: session.cookie, Origin: 'null' },
      { Cookie: session.cookie, Origin: 'https://hostile.invalid' },
      { Cookie: session.cookie, Origin: TEST_CONSOLE_ORIGIN, 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of deniedHeaders) {
      const response = await workerRequest('/api/console/products', {
        method: 'POST',
        headers,
        body: '{}',
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'origin_not_allowed' } });
    }
    const originOnly = await workerRequest('/api/console/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        Origin: TEST_CONSOLE_ORIGIN,
      },
      body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
    });
    expect(originOnly.status).toBe(201);
  });

  it('returns a safe outage without manufacturing a logout cookie', async () => {
    const session = await createConsoleSession();
    await env.DB.prepare('ALTER TABLE session RENAME TO session_unavailable').run();
    try {
      const response = await workerRequest('/api/console/products', {
        headers: { Cookie: session.cookie },
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: 'service_unavailable' } });
      expect(response.headers.get('set-cookie') ?? '').not.toMatch(/Max-Age=0/i);
    } finally {
      await env.DB.prepare('ALTER TABLE session_unavailable RENAME TO session').run();
    }
  });

  it('keeps Storefront public when a Console cookie is present', async () => {
    const created = await consoleRequest('/api/console/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
    });
    expect(created.status).toBe(201);
    await env.DB.prepare("INSERT INTO stores (id, slug, name) VALUES ('store_other', 'other', 'Other Store')").run();
    const session = await createConsoleSession({
      email: 'owner-b@example.test',
      name: 'Store B Owner',
      storeId: 'store_other',
    });
    const response = await workerRequest('/api/storefront/products', {
      headers: { Cookie: session.cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ products: [{ slug: 'field-notes' }] });
  });

  it('forwards multiple auth cookies as separate response headers', () => {
    const authHeaders = new Headers();
    authHeaders.append('Set-Cookie', 'session=one; Path=/; HttpOnly');
    authHeaders.append('Set-Cookie', 'state=two; Path=/; HttpOnly');
    const response = withConsoleAuthHeaders(new Response('{}'), authHeaders);
    expect(response.headers.getSetCookie()).toEqual([
      'session=one; Path=/; HttpOnly',
      'state=two; Path=/; HttpOnly',
    ]);
  });

  it('keeps public Storefront reads independent from Console auth configuration', async () => {
    const response = await worker.fetch(
      new Request('https://local.invalid/api/storefront/products'),
      {
        DB: env.DB,
        STOREFRONT_ORIGIN: 'https://storefront.test',
        ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
      } as unknown as Env,
    );
    expect(response.status).toBe(200);
  });
});
