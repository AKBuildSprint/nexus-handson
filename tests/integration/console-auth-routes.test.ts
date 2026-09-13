import { inspect } from 'node:util';
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionGoogleAccount } from '../../apps/worker/src/auth';
import { withConsoleAuthHeaders } from '../../apps/worker/src/http-response';
import worker from '../../apps/worker/src';
import type { Env } from '../../apps/worker/src/environment';
import { consoleRequest, resetCatalog, SIMPLE_CORE, TEST_STOREFRONT_ORIGIN, workerRequest } from '../support/catalog-test-env';
import {
  createConsoleSession,
  createPersistedTestSession,
  createTestAuth,
  TEST_CONSOLE_ORIGIN,
} from '../support/identity-test-env';

beforeEach(resetCatalog);

async function boundaryProduct(): Promise<string> {
  const response = await consoleRequest('/api/console/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }) });
  expect(response.status).toBe(201);
  return (await response.json() as { product: { id: string } }).product.id;
}

async function publicBoundaryOrder(productId: string): Promise<{ reference: string; capability: string }> {
  const capability = btoa(crypto.randomUUID().replaceAll('-', '')).replaceAll('=', '');
  const response = await workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'X-Nexus-Order-Capability': capability, Origin: TEST_STOREFRONT_ORIGIN },
    body: JSON.stringify({ customer: { name: 'Boundary Customer', email: 'private-boundary@example.test' }, items: [{ productId, variantId: null, quantity: 1 }] }),
  });
  expect(response.status).toBe(201);
  return { reference: (await response.json() as { reference: string }).reference, capability };
}

describe('Console authentication boundary', () => {
  it('bounds invalid sign-ins and submissions while authorized and public operations continue', async () => {
    const owner = await createConsoleSession({ email: 'abuse-owner@example.test' });
    const staff = await createConsoleSession({ email: 'abuse-staff@example.test', role: 'staff' });
    const productId = await boundaryProduct();
    const placed = await publicBoundaryOrder(productId);
    const invalidSignIns = async () => {
      const statuses: number[] = [];
      for (let index = 0; index < 105; index += 1) {
        const response = await workerRequest('/api/auth/sign-in/social', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: TEST_CONSOLE_ORIGIN, 'cf-connecting-ip': '203.0.113.33' }, body: JSON.stringify({ provider: 'github', callbackURL: '/console/products' }) });
        statuses.push(response.status);
      }
      expect(statuses.every(status => status === 404 || status === 429)).toBe(true);
      expect(statuses).toContain(429);
    };
    const invalidOrders = async () => {
      for (let index = 0; index < 20; index += 1) {
        const response = await workerRequest('/api/storefront/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'X-Nexus-Order-Capability': 'Q'.repeat(43), Origin: TEST_STOREFRONT_ORIGIN }, body: '{' });
        expect(response.status).toBe(400);
      }
    };
    const legitimateWork = async () => {
      const assigned = await workerRequest(`/api/console/orders/${placed.reference}/assignment`, { method: 'POST', headers: { Cookie: owner.cookie, Origin: TEST_CONSOLE_ORIGIN, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'X-Nexus-Order-Contract': '2' }, body: JSON.stringify({ assigneeUserId: staff.userId }) });
      expect(assigned.status).toBe(200);
      const inbox = await workerRequest('/api/console/orders', { headers: { Cookie: staff.cookie, 'X-Nexus-Order-Contract': '2' } });
      expect(inbox.status).toBe(200);
      expect(await inbox.json()).toMatchObject({ orders: [{ reference: placed.reference }], summary: { totalOrders: 1 } });
      const publicOrder = await publicBoundaryOrder(productId);
      expect(publicOrder.reference).not.toBe(placed.reference);
      const catalog = await workerRequest('/api/console/products', { headers: { Cookie: owner.cookie } });
      expect(catalog.status).toBe(200);
    };
    await Promise.all([invalidSignIns(), invalidOrders(), legitimateWork()]);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM orders').first<number>('count')).toBe(2);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_assignments').first<number>('count')).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments').first<number>('count')).toBe(0);
  });

  it('keeps credentials and Customer PII out of auth and capability failure diagnostics', async () => {
    const owner = await createConsoleSession({ email: 'diagnostic-owner@example.test' });
    const placed = await publicBoundaryOrder(await boundaryProduct());
    const logs: string[] = [];
    const spies = (['error', 'warn', 'log', 'info'] as const).map(method => vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logs.push(inspect(args, { depth: null, maxStringLength: null, maxArrayLength: null })); }));
    let renamed: 'session' | 'order_access' | null = null;
    try {
      await env.DB.prepare('ALTER TABLE session RENAME TO session_unavailable').run();
      renamed = 'session';
      const failedAuth = await workerRequest('/api/console/products', { headers: { Cookie: owner.cookie } });
      expect(failedAuth.status).toBe(503);
      const authBody = await failedAuth.text();
      await env.DB.prepare('ALTER TABLE session_unavailable RENAME TO session').run();
      renamed = null;
      await env.DB.prepare('ALTER TABLE order_access RENAME TO order_access_unavailable').run();
      renamed = 'order_access';
      const failedLookup = await workerRequest(`/api/storefront/orders/${placed.reference}`, { headers: { Origin: TEST_STOREFRONT_ORIGIN, 'X-Nexus-Order-Capability': placed.capability, 'X-Nexus-Order-Contract': '2' } });
      expect(failedLookup.status).toBe(500);
      const diagnosticOutput = [authBody, await failedLookup.text(), ...logs].join('\n');
      for (const sensitive of [owner.cookie, owner.cookie.split('=', 2)[1], placed.capability, 'private-boundary@example.test', `${placed.reference}#capability=`]) {
        expect(diagnosticOutput.includes(sensitive), 'Failure diagnostics leaked private data.').toBe(false);
      }
    } finally {
      if (renamed === 'session') await env.DB.prepare('ALTER TABLE session_unavailable RENAME TO session').run();
      if (renamed === 'order_access') await env.DB.prepare('ALTER TABLE order_access_unavailable RENAME TO order_access').run();
      for (const spy of spies) spy.mockRestore();
    }
  });

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
