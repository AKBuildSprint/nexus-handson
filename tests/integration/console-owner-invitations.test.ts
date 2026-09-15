import { inspect } from 'node:util';
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { digestInvitationToken, invitationContextHmac } from '@nexus/identity/invitations';
import { routeConsoleOwnerInvitationRequest } from '../../apps/worker/src/console-owner-invitation-routes';
import { consoleRequest, getConsoleIdentity, resetCatalog, workerRequest } from '../support/catalog-test-env';
import { createConsoleSession, TEST_BETTER_AUTH_SECRET, TEST_CONSOLE_ORIGIN } from '../support/identity-test-env';

beforeEach(resetCatalog);

const invitationPath = '/api/console/owner-invitations';

interface InvitationResponse {
  id: string;
  targetEmail: string;
  expiresAt: string;
  invitationUrl: string;
}

describe('Console Owner invitation issuance', () => {
  it('returns the capability only in a one-time fragment link and keeps logs and stored rows redacted', async () => {
    const logs: string[] = [];
    const spies = (['error', 'warn', 'log', 'info'] as const).map((method) => vi.spyOn(console, method)
      .mockImplementation((...args: unknown[]) => { logs.push(inspect(args, { depth: null })); }));
    try {
      const response = await consoleRequest(invitationPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail: '  Invited.Owner@Example.Test  ' }),
      });
      expect(response.status).toBe(201);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
      const body = await response.json() as InvitationResponse;
      expect(Object.keys(body).sort()).toEqual(['expiresAt', 'id', 'invitationUrl', 'targetEmail']);
      expect(body.targetEmail).toBe('invited.owner@example.test');
      const link = new URL(body.invitationUrl);
      expect(link.origin).toBe(TEST_CONSOLE_ORIGIN);
      expect(link.pathname).toBe('/console/login');
      expect(link.search).toBe('');
      const token = new URLSearchParams(link.hash.slice(1)).get('invite');
      if (!token) throw new Error('Expected a fragment invitation capability.');
      const stored = await env.DB.prepare('SELECT * FROM owner_invitations WHERE id=?').bind(body.id)
        .first<{ token_digest: string; context_hmac: string; target_email: string; role: string; expires_at: string }>();
      expect(stored).toMatchObject({
        token_digest: await digestInvitationToken(token),
        context_hmac: await invitationContextHmac(TEST_BETTER_AUTH_SECRET, token),
        target_email: body.targetEmail,
        role: 'owner',
        expires_at: body.expiresAt,
      });
      expect(stored?.context_hmac).not.toBe(stored?.token_digest);
      expect(stored?.context_hmac).not.toBe(token);
      expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
      const session = await consoleRequest('/api/console/session');
      expect([JSON.stringify(stored), await session.text(), ...logs].join('\n').includes(token)).toBe(false);
      expect(await workerRequest(invitationPath).then((result) => result.status)).toBe(404);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('rejects anonymous, Staff, revoked membership, and cross-origin callers before issuance', async () => {
    const staff = await createConsoleSession({ email: 'invitation-staff@example.test', role: 'staff' });
    const revoked = await createConsoleSession({ email: 'invitation-revoked@example.test', status: 'revoked' });
    const owner = await createConsoleSession({ email: 'invitation-owner@example.test' });
    const cases: Array<{ headers: HeadersInit; status: number; code: string }> = [
      { headers: { Origin: TEST_CONSOLE_ORIGIN }, status: 401, code: 'unauthenticated' },
      { headers: { Cookie: staff.cookie, Origin: TEST_CONSOLE_ORIGIN }, status: 403, code: 'issuer_not_owner' },
      { headers: { Cookie: revoked.cookie, Origin: TEST_CONSOLE_ORIGIN }, status: 403, code: 'store_access_denied' },
      { headers: { Cookie: owner.cookie }, status: 403, code: 'origin_not_allowed' },
      { headers: { Cookie: owner.cookie, Origin: 'https://hostile.invalid' }, status: 403, code: 'origin_not_allowed' },
      { headers: { Cookie: owner.cookie, Origin: TEST_CONSOLE_ORIGIN, 'Sec-Fetch-Site': 'cross-site' }, status: 403, code: 'origin_not_allowed' },
    ];
    for (const testCase of cases) {
      const response = await workerRequest(invitationPath, { method: 'POST', headers: testCase.headers, body: '{' });
      expect(response.status).toBe(testCase.status);
      expect(await response.json()).toMatchObject({ error: { code: testCase.code } });
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM owner_invitations').first<number>('count')).toBe(0);
  });

  it('keeps list, revoke, and near-match paths outside the authenticated route surface', async () => {
    for (const [method, path] of [
      ['GET', invitationPath],
      ['DELETE', invitationPath],
      ['POST', `${invitationPath}/`],
      ['POST', `${invitationPath}/invitation-id/revoke`],
    ]) {
      const response = await workerRequest(path, { method });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'route_not_found' } });
    }
  });

  it('rejects malformed input and role or Store overrides without creating invitations', async () => {
    const malformed = await consoleRequest(invitationPath, { method: 'POST', body: '{' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: 'invalid_json' } });
    for (const body of [null, [], {}, { targetEmail: 42 }, { targetEmail: 'owner@example.test', role: 'staff' }, { targetEmail: 'owner@example.test', storeId: 'other' }]) {
      const response = await consoleRequest(invitationPath, { method: 'POST', body: JSON.stringify(body) });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: 'validation_failed', fields: [{ path: '/targetEmail' }] } });
    }
    const invalidEmail = await consoleRequest(invitationPath, { method: 'POST', body: JSON.stringify({ targetEmail: 'not-an-email' }) });
    expect(invalidEmail.status).toBe(422);
    expect(await invalidEmail.json()).toMatchObject({ error: { code: 'invalid_email', fields: [{ path: '/targetEmail' }] } });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM owner_invitations').first<number>('count')).toBe(0);
  });

  it('uses the configured Console origin and rechecks an already-resolved Owner before writing', async () => {
    const identity = await getConsoleIdentity();
    const context = { identity, user: { id: identity.userId, name: 'Owner' }, store: { id: identity.storeId, name: 'Nexus' } };
    const request = () => new Request(`https://untrusted-host.invalid${invitationPath}`, {
      method: 'POST', body: JSON.stringify({ targetEmail: 'invited@example.test' }),
    });
    const issued = await routeConsoleOwnerInvitationRequest(request(), env.DB, TEST_CONSOLE_ORIGIN, TEST_BETTER_AUTH_SECRET, context);
    expect(issued?.status).toBe(201);
    const body = await issued?.json() as InvitationResponse;
    expect(new URL(body.invitationUrl).origin).toBe(TEST_CONSOLE_ORIGIN);
    await env.DB.prepare("UPDATE store_memberships SET role='staff' WHERE id=?").bind(identity.membershipId).run();
    const denied = await routeConsoleOwnerInvitationRequest(request(), env.DB, TEST_CONSOLE_ORIGIN, TEST_BETTER_AUTH_SECRET, context);
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toMatchObject({ error: { code: 'issuer_not_owner' } });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM owner_invitations').first<number>('count')).toBe(1);
  });

  it('returns a safe retriable error when invitation persistence is unavailable', async () => {
    await env.DB.prepare('ALTER TABLE owner_invitations RENAME TO unavailable_owner_invitations').run();
    try {
      const response = await consoleRequest(invitationPath, { method: 'POST', body: JSON.stringify({ targetEmail: 'invited@example.test' }) });
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({ error: { code: 'create_failed', fields: [], incidentId: null } });
      expect(JSON.stringify(body)).not.toMatch(/unavailable_owner_invitations|SQLITE|targetEmail|invitationUrl/);
    } finally {
      await env.DB.prepare('ALTER TABLE unavailable_owner_invitations RENAME TO owner_invitations').run();
    }
  });

  it('rejects bound, Staff, and revoked targets without promoting or reviving them', async () => {
    await createConsoleSession({ email: 'existing-owner@example.test' });
    await createConsoleSession({ email: 'existing-staff@example.test', role: 'staff' });
    await createConsoleSession({ email: 'existing-revoked@example.test', status: 'revoked' });
    for (const email of ['existing-owner@example.test', 'existing-staff@example.test', 'existing-revoked@example.test']) {
      const response = await consoleRequest(invitationPath, {
        method: 'POST',
        body: JSON.stringify({ targetEmail: email }),
      });
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toMatchObject({ error: { code: 'target_unavailable', fields: [], incidentId: null } });
      expect(JSON.stringify(body)).not.toMatch(/staff|revoked|already|owner@|membership/i);
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM owner_invitations').first<number>('count')).toBe(0);
    expect(await env.DB.prepare(
      "SELECT role, status FROM store_memberships membership JOIN \"user\" user ON user.id = membership.user_id WHERE user.email = 'existing-staff@example.test'",
    ).first()).toMatchObject({ role: 'staff', status: 'active' });
    expect(await env.DB.prepare(
      "SELECT role, status FROM store_memberships membership JOIN \"user\" user ON user.id = membership.user_id WHERE user.email = 'existing-revoked@example.test'",
    ).first()).toMatchObject({ role: 'owner', status: 'revoked' });
  });
});
