import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import { approveRefundRequest } from '@nexus/orders/commands/order-commands';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';
import { resetCatalog, SIMPLE_CORE, TEST_STOREFRONT_ORIGIN, workerRequest } from '../support/catalog-test-env';
import { createConsoleSession, TEST_CONSOLE_ORIGIN } from '../support/identity-test-env';

beforeEach(resetCatalog);

const CAPABILITY = 'R'.repeat(43);

function key(label: string): string {
  return `${label}-${'k'.repeat(32)}`.slice(0, 64);
}

async function asConsole(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  headers.set('Origin', TEST_CONSOLE_ORIGIN);
  headers.set('Sec-Fetch-Site', 'same-origin');
  if (!headers.has('X-Nexus-Order-Contract')) headers.set('X-Nexus-Order-Contract', '2');
  return workerRequest(path, { ...init, headers });
}

async function pendingRefundFixture(): Promise<{
  owner: { cookie: string; userId: string };
  reference: string;
  requestId: string;
  orderId: string;
}> {
  const owner = await createConsoleSession({ email: 'refund-owner@example.test', name: 'Refund Owner' });
  const productResponse = await asConsole(owner.cookie, '/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
  });
  expect(productResponse.status).toBe(201);
  const product = (await productResponse.json() as { product: ProductDetailResponse }).product;
  const placed = await workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key('refund-create'),
      'X-Nexus-Order-Capability': CAPABILITY,
      Origin: TEST_STOREFRONT_ORIGIN,
    },
    body: JSON.stringify({
      customer: { name: 'Refund Buyer', email: 'refund@example.test' },
      items: [{ productId: product.id, variantId: null, quantity: 1 }],
    }),
  });
  expect(placed.status).toBe(201);
  const { reference } = await placed.json() as { reference: string };
  const paid = await asConsole(owner.cookie, `/api/console/orders/${reference}/payments/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('refund-pay') },
    body: JSON.stringify({ method: 'Bank transfer', reference: 'REFUND-PAYMENT-1' }),
  });
  expect(paid.status).toBe(200);
  const requested = await asConsole(owner.cookie, `/api/console/orders/${reference}/refund-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('refund-request') },
    body: JSON.stringify({ reason: 'The item no longer fits the intended use.' }),
  });
  expect(requested.status).toBe(200);
  const request = (await requested.json() as { refundRequest: { id: string } }).refundRequest;
  const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(reference).first<string>('id');
  if (!orderId) throw new Error('Expected Refund Order.');
  return { owner, reference, requestId: request.id, orderId };
}

async function ownerIdentity(userId: string): Promise<ConsoleIdentityContext> {
  const membership = await env.DB.prepare(
    'SELECT id,store_id,role,status FROM store_memberships WHERE user_id=?',
  ).bind(userId).first<{ id: string; store_id: string; role: 'owner'; status: 'active' }>();
  if (!membership) throw new Error('Expected Owner membership.');
  return {
    kind: 'console', userId, storeId: membership.store_id, membershipId: membership.id,
    role: membership.role, membershipStatus: membership.status,
  };
}

function interceptBatch(
  database: D1Database,
  run: (statements: D1PreparedStatement[], real: D1Database) => Promise<D1Result[]>,
): D1Database {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'batch') return (statements: D1PreparedStatement[]) => run(statements, target);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('terminal Refund decisions', () => {
  it('lets the active Owner approve a pending request without changing Order or payment evidence', async () => {
    const { owner, reference, requestId } = await pendingRefundFixture();
    const before = await env.DB.prepare(
      `SELECT orders.status, payments.id AS payment_id, payments.external_reference
         FROM orders JOIN payments ON payments.order_id=orders.id AND payments.store_id=orders.store_id
        WHERE orders.reference=?`,
    ).bind(reference).first<{ status: string; payment_id: string; external_reference: string }>();
    const response = await asConsole(
      owner.cookie,
      `/api/console/orders/${reference}/refund-requests/${requestId}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('refund-approve') },
        body: '{}',
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reference,
      action: 'approve_refund',
      status: 'paid',
      refundRequest: { id: requestId, status: 'approved' },
    });
    expect(await env.DB.prepare(
      `SELECT orders.status, payments.id AS payment_id, payments.external_reference
         FROM orders JOIN payments ON payments.order_id=orders.id AND payments.store_id=orders.store_id
        WHERE orders.reference=?`,
    ).bind(reference).first()).toEqual(before);
  });

  it('persists one winner for competing approve and reject commands', async () => {
    const { owner, reference, requestId, orderId } = await pendingRefundFixture();
    const call = (decision: 'approve' | 'reject', requestKey: string) => asConsole(
      owner.cookie,
      `/api/console/orders/${reference}/refund-requests/${requestId}/${decision}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
        body: '{}',
      },
    );
    const responses = await Promise.all([
      call('approve', key('refund-race-approve')),
      call('reject', key('refund-race-reject')),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const stored = await env.DB.prepare(
      'SELECT status,decided_at,decided_by_user_id FROM order_refund_requests WHERE id=?',
    ).bind(requestId).first<{ status: string; decided_at: string; decided_by_user_id: string }>();
    expect(['approved', 'rejected']).toContain(stored?.status);
    expect(stored?.decided_at).toBeTruthy();
    expect(stored?.decided_by_user_id).toBe(owner.userId);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id=? AND action IN ('refund_approved','refund_rejected')",
    ).bind(orderId).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_commands WHERE order_id=? AND action IN ('approve_refund','reject_refund')",
    ).bind(orderId).first<number>('count')).toBe(1);
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(orderId).first<string>('status')).toBe('paid');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id=?')
      .bind(orderId).first<number>('count')).toBe(1);
  });

  it('replays the same key exactly and rejects every fresh terminal decision', async () => {
    const { owner, reference, requestId, orderId } = await pendingRefundFixture();
    const requestKey = key('refund-replay');
    const call = (decision: 'approve' | 'reject', currentKey = requestKey) => asConsole(
      owner.cookie,
      `/api/console/orders/${reference}/refund-requests/${requestId}/${decision}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': currentKey },
        body: '{}',
      },
    );
    const first = await call('reject');
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const replay = await call('reject');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect((await call('approve')).status).toBe(409);
    expect((await call('reject', key('refund-fresh-same'))).status).toBe(409);
    expect((await call('approve', key('refund-fresh-opposite'))).status).toBe(409);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id=? AND action IN ('refund_approved','refund_rejected')",
    ).bind(orderId).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_commands WHERE order_id=? AND action IN ('approve_refund','reject_refund')",
    ).bind(orderId).first<number>('count')).toBe(1);
  });

  it('returns only the safe terminal decision to the Customer and keeps request occupancy final', async () => {
    const { owner, reference, requestId, orderId } = await pendingRefundFixture();
    const approved = await asConsole(owner.cookie, `/api/console/orders/${reference}/refund-requests/${requestId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('refund-safe-approve') },
      body: '{}',
    });
    expect(approved.status).toBe(200);
    const customer = await workerRequest(`/api/storefront/orders/${reference}`, {
      headers: {
        Origin: TEST_STOREFRONT_ORIGIN,
        'X-Nexus-Order-Capability': CAPABILITY,
        'X-Nexus-Order-Contract': '2',
      },
    });
    expect(customer.status).toBe(200);
    const customerBody = await customer.json() as { refundRequest: Record<string, unknown> };
    expect(Object.keys(customerBody.refundRequest).sort()).toEqual(['createdAt', 'decidedAt', 'id', 'reason', 'status']);
    expect(customerBody.refundRequest).toMatchObject({ id: requestId, status: 'approved' });
    expect(customerBody.refundRequest).not.toHaveProperty('decidedByUserId');
    expect(customerBody.refundRequest).not.toHaveProperty('payment');
    const resubmitted = await asConsole(owner.cookie, `/api/console/orders/${reference}/refund-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('refund-resubmit') },
      body: JSON.stringify({ reason: 'A changed reason must not replace the original.' }),
    });
    expect(resubmitted.status).toBe(200);
    expect(await resubmitted.json()).toMatchObject({ refundRequest: { id: requestId, status: 'approved' } });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_refund_requests WHERE order_id=?')
      .bind(orderId).first<number>('count')).toBe(1);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE order_id=? AND action='refund_requested'")
      .bind(orderId).first<number>('count')).toBe(1);
  });

  it('rejects Staff decisions and conceals an Owner replay after membership revocation', async () => {
    const { owner, reference, requestId, orderId } = await pendingRefundFixture();
    const staff = await createConsoleSession({ email: 'refund-staff@example.test', name: 'Refund Staff', role: 'staff' });
    expect((await asConsole(owner.cookie, `/api/console/orders/${reference}/assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('refund-assign-staff') },
      body: JSON.stringify({ assigneeUserId: staff.userId }),
    })).status).toBe(200);
    const denied = await asConsole(staff.cookie, `/api/console/orders/${reference}/refund-requests/${requestId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('refund-staff-denied') },
      body: '{}',
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: 'forbidden' } });
    const requestKey = key('refund-revoked-replay');
    expect((await asConsole(owner.cookie, `/api/console/orders/${reference}/refund-requests/${requestId}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey }, body: '{}',
    })).status).toBe(200);
    await env.DB.prepare(
      "UPDATE store_memberships SET status='revoked',revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=?",
    ).bind(owner.userId).run();
    const replay = await asConsole(owner.cookie, `/api/console/orders/${reference}/refund-requests/${requestId}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey }, body: '{}',
    });
    expect(replay.status).toBe(403);
    expect(await replay.json()).toMatchObject({ error: { code: 'store_access_denied' } });
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_commands WHERE order_id=? AND action IN ('approve_refund','reject_refund')",
    ).bind(orderId).first<number>('count')).toBe(1);
  });

  it('conceals absent requests before parsing and rejects non-empty decision bodies without effects', async () => {
    const { owner, reference, requestId, orderId } = await pendingRefundFixture();
    const absentWithStaleContract = await asConsole(
      owner.cookie,
      `/api/console/orders/${reference}/refund-requests/rrq_${'0'.repeat(32)}/approve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'bad',
          'X-Nexus-Order-Contract': '1',
        },
        body: '{}',
      },
    );
    expect(absentWithStaleContract.status).toBe(404);
    const absentWithMalformedJson = await asConsole(
      owner.cookie,
      `/api/console/orders/${reference}/refund-requests/rrq_${'0'.repeat(32)}/reject`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('refund-absent-json') },
        body: '{',
      },
    );
    expect(absentWithMalformedJson.status).toBe(404);
    const invalid = await asConsole(
      owner.cookie,
      `/api/console/orders/${reference}/refund-requests/${requestId}/reject`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('refund-invalid-body') },
        body: JSON.stringify({ unexpected: true }),
      },
    );
    expect(invalid.status).toBe(422);
    expect(await env.DB.prepare('SELECT status FROM order_refund_requests WHERE id=?')
      .bind(requestId).first<string>('status')).toBe('pending');
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_commands WHERE order_id=? AND action IN ('approve_refund','reject_refund')",
    ).bind(orderId).first<number>('count')).toBe(0);
  });

  it('rolls back all decision effects after a fault at every statement boundary', async () => {
    const { owner, requestId, orderId } = await pendingRefundFixture();
    const identity = await ownerIdentity(owner.userId);
    for (const boundary of [0, 1, 2, 3]) {
      let injected = false;
      const faulty = interceptBatch(env.DB, async (statements, real) => {
        if (injected) return real.batch(statements);
        injected = true;
        return real.batch([
          ...statements.slice(0, boundary),
          real.prepare('INSERT INTO order_commands (id) VALUES (NULL)'),
          ...statements.slice(boundary),
        ]);
      });
      await expect(approveRefundRequest({
        database: faulty,
        context: { storeId: identity.storeId, actor: { source: 'user', id: owner.userId }, identity },
        orderId,
        requestId,
        body: {},
        idempotencyKey: key(`refund-fault-${boundary}`),
      })).rejects.toMatchObject({ code: 'order_persistence_failed' });
      expect(await env.DB.prepare('SELECT status FROM order_refund_requests WHERE id=?')
        .bind(requestId).first<string>('status')).toBe('pending');
      expect(await env.DB.prepare(
        "SELECT count(*) AS count FROM order_history WHERE order_id=? AND action IN ('refund_approved','refund_rejected')",
      ).bind(orderId).first<number>('count')).toBe(0);
      expect(await env.DB.prepare(
        "SELECT count(*) AS count FROM order_commands WHERE order_id=? AND action IN ('approve_refund','reject_refund')",
      ).bind(orderId).first<number>('count')).toBe(0);
    }
  });

  it('rolls back when Owner access is revoked before the decision batch commits', async () => {
    const { owner, requestId, orderId } = await pendingRefundFixture();
    const identity = await ownerIdentity(owner.userId);
    let intercepted = false;
    const racing = interceptBatch(env.DB, async (statements, real) => {
      if (!intercepted) {
        intercepted = true;
        await real.prepare(
          "UPDATE store_memberships SET status='revoked',revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        ).bind(identity.membershipId).run();
      }
      return real.batch(statements);
    });
    await expect(approveRefundRequest({
      database: racing,
      context: { storeId: identity.storeId, actor: { source: 'user', id: owner.userId }, identity },
      orderId,
      requestId,
      body: {},
      idempotencyKey: key('refund-owner-race'),
    })).rejects.toMatchObject({ code: 'store_access_denied', status: 403 });
    expect(await env.DB.prepare('SELECT status FROM order_refund_requests WHERE id=?')
      .bind(requestId).first<string>('status')).toBe('pending');
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id=? AND action IN ('refund_approved','refund_rejected')",
    ).bind(orderId).first<number>('count')).toBe(0);
  });

  it('preserves a committed decision but conceals its response after Owner access loss', async () => {
    const { owner, requestId, orderId } = await pendingRefundFixture();
    const identity = await ownerIdentity(owner.userId);
    let intercepted = false;
    const racing = interceptBatch(env.DB, async (statements, real) => {
      const result = await real.batch(statements);
      if (!intercepted) {
        intercepted = true;
        await real.prepare(
          "UPDATE store_memberships SET status='revoked',revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        ).bind(identity.membershipId).run();
      }
      return result;
    });
    await expect(approveRefundRequest({
      database: racing,
      context: { storeId: identity.storeId, actor: { source: 'user', id: owner.userId }, identity },
      orderId,
      requestId,
      body: {},
      idempotencyKey: key('refund-commit-conceal'),
    })).rejects.toMatchObject({ code: 'store_access_denied', status: 403 });
    expect(await env.DB.prepare('SELECT status FROM order_refund_requests WHERE id=?')
      .bind(requestId).first<string>('status')).toBe('approved');
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id=? AND action='refund_approved'",
    ).bind(orderId).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_commands WHERE order_id=? AND action='approve_refund'",
    ).bind(orderId).first<number>('count')).toBe(1);
  });
});
