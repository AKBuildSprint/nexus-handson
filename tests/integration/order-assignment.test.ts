import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import {
  bindExistingResult,
  readCommandResult,
  readOrderTarget,
  runCommandBatch,
} from '@nexus/orders/persistence/command-store';
import { listConsoleOrders } from '@nexus/orders/queries/order-read';
import { assignOrder } from '@nexus/orders/commands/order-assignment';
import { markPaid } from '@nexus/orders/commands/order-commands';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';
import { provisionGoogleAccount } from '../../apps/worker/src/auth';
import {
  resetCatalog,
  SIMPLE_CORE,
  TEST_STOREFRONT_ORIGIN,
  workerRequest,
} from '../support/catalog-test-env';
import { createConsoleSession, createTestAuth, TEST_CONSOLE_ORIGIN } from '../support/identity-test-env';

beforeEach(resetCatalog);

function key(label: string): string {
  return `${label}-${'k'.repeat(24)}`.slice(0, 64);
}

function interceptBatch(
  database: D1Database,
  beforeBatch: (statements: D1PreparedStatement[], real: D1Database) => Promise<D1Result[]>,
): D1Database {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'batch') return (statements: D1PreparedStatement[]) => beforeBatch(statements, target);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function interceptLedgerReads(
  database: D1Database,
  afterRead: (count: number, result: unknown, real: D1Database) => Promise<void>,
): D1Database {
  let count = 0;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
    get(target, property, receiver) {
      if (property === 'bind') {
        return (...values: unknown[]) => wrap(target.bind(...values));
      }
      if (property === 'first') {
        return async (columnName?: string) => {
          const result = columnName === undefined ? await target.first() : await target.first(columnName);
          count += 1;
          await afterRead(count, result, database);
          return result;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => sql.includes('SELECT order_id, action, payload_hash, contract_version')
          ? wrap(target.prepare(sql))
          : target.prepare(sql);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function insertConflictingLedger(orderId: string, requestKey: string): Promise<void> {
  const historyId = await env.DB.prepare(
    "SELECT id FROM order_history WHERE order_id=? AND action='order_created'",
  ).bind(orderId).first<string>('id');
  if (!historyId) throw new Error('Expected Order creation history.');
  await env.DB.prepare(
    `INSERT INTO order_commands (
       id,store_id,request_key,order_id,action,payload_hash,result_history_id,contract_version
     ) VALUES (?,?,?,?,'cancel',?,?,2)`,
  ).bind(`cmd_conflict_${requestKey}`, 'store_nexus', requestKey, orderId, 'f'.repeat(64), historyId).run();
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function consoleIdentity(userId: string): Promise<ConsoleIdentityContext> {
  const membership = await env.DB.prepare(
    `SELECT id, store_id, role, status FROM store_memberships WHERE user_id=?`,
  ).bind(userId).first<{ id: string; store_id: string; role: 'owner' | 'staff'; status: 'active' }>();
  if (!membership) throw new Error('Expected membership.');
  return {
    kind: 'console', userId, storeId: membership.store_id, membershipId: membership.id,
    role: membership.role, membershipStatus: membership.status,
  };
}

async function asConsole(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  headers.set('Origin', TEST_CONSOLE_ORIGIN);
  headers.set('Sec-Fetch-Site', 'same-origin');
  headers.set('X-Nexus-Order-Contract', '2');
  return workerRequest(path, { ...init, headers });
}

async function fixture() {
  const owner = await createConsoleSession({ email: 'phase5-owner@example.test', name: 'Phase 5 Owner' });
  const staff = await createConsoleSession({ email: 'phase5-staff@example.test', name: 'Phase 5 Staff', role: 'staff' });
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
      'Idempotency-Key': key('phase5-create'),
      'X-Nexus-Order-Capability': 'A'.repeat(43),
      Origin: TEST_STOREFRONT_ORIGIN,
    },
    body: JSON.stringify({
      customer: { name: 'Assigned Buyer', email: 'assigned@example.test' },
      items: [{ productId: product.id, variantId: null, quantity: 1 }],
    }),
  });
  expect(placed.status).toBe(201);
  return { owner, staff, order: await placed.json() as { reference: string } };
}

async function placeAdditionalOrder(index: number): Promise<{ reference: string }> {
  const productId = await env.DB.prepare('SELECT id FROM products LIMIT 1').first<string>('id');
  if (!productId) throw new Error('Expected Product fixture.');
  const response = await workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key(`phase5-create-${index}`),
      'X-Nexus-Order-Capability': `${index}`.repeat(43).slice(0, 43),
      Origin: TEST_STOREFRONT_ORIGIN,
    },
    body: JSON.stringify({
      customer: { name: `Assigned Buyer ${index}`, email: `assigned-${index}@example.test` },
      items: [{ productId, variantId: null, quantity: 1 }],
    }),
  });
  expect(response.status).toBe(201);
  return await response.json() as { reference: string };
}

describe('assigned-only Order access', () => {
  it('keeps Staff inbox empty until an Owner assigns the Order', async () => {
    const { owner, staff, order } = await fixture();
    const before = await asConsole(staff.cookie, '/api/console/orders');
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ orders: [], hasOrders: false, summary: { totalOrders: 0 } });
    const concealed = await asConsole(staff.cookie, `/api/console/orders/${order.reference}`);
    expect(concealed.status).toBe(404);

    const candidates = await asConsole(owner.cookie, '/api/console/staff');
    expect(candidates.status).toBe(200);
    expect(await candidates.json()).toEqual({ staff: [{ userId: staff.userId, name: 'Phase 5 Staff' }] });
    expect((await asConsole(staff.cookie, '/api/console/staff')).status).toBe(403);

    const assigned = await asConsole(owner.cookie, `/api/console/orders/${order.reference}/assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('phase5-assign') },
      body: JSON.stringify({ assigneeUserId: staff.userId }),
    });
    expect(assigned.status).toBe(200);
    const result = await assigned.json() as Record<string, unknown>;
    expect(result).toMatchObject({
      reference: order.reference,
      action: 'assign',
      status: 'pending',
      paymentId: null,
      refundRequest: null,
      assignment: { assigneeUserId: staff.userId },
    });
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(1);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_commands WHERE action='assign'").first<number>('count')).toBe(1);

    const after = await asConsole(staff.cookie, '/api/console/orders');
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({
      orders: [{ reference: order.reference }],
      hasOrders: true,
      summary: { totalOrders: 1 },
    });
    const detail = await asConsole(staff.cookie, `/api/console/orders/${order.reference}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ order: { reference: order.reference, allowedActions: ['mark_paid', 'cancel'] } });
  });

  it('replays the exact assignment and rejects Staff assignment attempts', async () => {
    const { owner, staff, order } = await fixture();
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('phase5-replay') },
      body: JSON.stringify({ assigneeUserId: staff.userId }),
    } satisfies RequestInit;
    const first = await asConsole(owner.cookie, `/api/console/orders/${order.reference}/assignment`, request);
    const firstBody = await first.json();
    const replay = await asConsole(owner.cookie, `/api/console/orders/${order.reference}/assignment`, request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);

    const denied = await asConsole(staff.cookie, `/api/console/orders/${order.reference}/assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('phase5-staff-denied') },
      body: JSON.stringify({ assigneeUserId: staff.userId }),
    });
    expect(denied.status).toBe(403);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(1);
  });

  it('keeps assignment history stable across no-op, reassignment, and original replay', async () => {
    const { owner, staff, order } = await fixture();
    const second = await createConsoleSession({ email: 'phase5-staff-2@example.test', name: 'Phase 5 Staff 2', role: 'staff' });
    const assign = (assigneeUserId: string, requestKey: string) => asConsole(
      owner.cookie,
      `/api/console/orders/${order.reference}/assignment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
        body: JSON.stringify({ assigneeUserId }),
      },
    );
    const originalKey = key('phase5-original');
    const originalResponse = await assign(staff.userId, originalKey);
    expect(originalResponse.status).toBe(200);
    const original = await originalResponse.json() as { occurredAt: string; assignment: { eventId: string } };

    const noop = await assign(staff.userId, key('phase5-noop'));
    expect(noop.status).toBe(200);
    expect(await noop.json()).toMatchObject({
      occurredAt: original.occurredAt,
      assignment: { eventId: original.assignment.eventId, assigneeUserId: staff.userId },
    });
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(1);

    const reassigned = await assign(second.userId, key('phase5-second'));
    expect(reassigned.status).toBe(200);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(2);
    expect((await asConsole(staff.cookie, `/api/console/orders/${order.reference}`)).status).toBe(404);
    expect((await asConsole(second.cookie, `/api/console/orders/${order.reference}`)).status).toBe(200);

    const replay = await assign(staff.userId, originalKey);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      occurredAt: original.occurredAt,
      assignment: { eventId: original.assignment.eventId, assigneeUserId: staff.userId },
    });
    expect((await asConsole(staff.cookie, `/api/console/orders/${order.reference}`)).status).toBe(404);

    const conflict = await assign(second.userId, originalKey);
    expect(conflict.status).toBe(409);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(2);
  });

  it('lets assigned Staff process an Order and rejects invalid targets without partial writes', async () => {
    const { owner, staff, order } = await fixture();
    const revoked = await provisionGoogleAccount(createTestAuth(), {
      email: 'phase5-revoked@example.test', name: 'Revoked Staff', googleSubject: 'google-subject-phase5-revoked',
    });
    await env.DB.prepare(
      `INSERT INTO store_memberships (id,store_id,user_id,role,status,revoked_at)
       VALUES ('membership_phase5_revoked','store_nexus',?,'staff','revoked',strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ).bind(revoked.userId).run();
    await env.DB.prepare("INSERT INTO stores (id,slug,name) VALUES ('store_other','other','Other Store')").run();
    const foreign = await provisionGoogleAccount(createTestAuth(), {
      email: 'phase5-foreign@example.test', name: 'Foreign Staff', googleSubject: 'google-subject-phase5-foreign',
    });
    await env.DB.prepare(
      `INSERT INTO store_memberships (id,store_id,user_id,role,status)
       VALUES ('membership_phase5_foreign','store_other',?,'staff','active')`,
    ).bind(foreign.userId).run();
    const before = {
      history: await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count'),
      commands: await env.DB.prepare("SELECT count(*) AS count FROM order_commands WHERE action='assign'").first<number>('count'),
    };
    for (const [index, assigneeUserId] of [
      owner.userId,
      revoked.userId,
      foreign.userId,
      'missing-user-id',
    ].entries()) {
      const invalid = await asConsole(owner.cookie, `/api/console/orders/${order.reference}/assignment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key(`phase5-invalid-${index}`) },
        body: JSON.stringify({ assigneeUserId }),
      });
      expect(invalid.status).toBe(422);
    }
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(before.history);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_commands WHERE action='assign'").first<number>('count')).toBe(before.commands);

    expect((await asConsole(owner.cookie, `/api/console/orders/${order.reference}/assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('phase5-process-assign') },
      body: JSON.stringify({ assigneeUserId: staff.userId }),
    })).status).toBe(200);
    expect(await env.DB.prepare(
      `SELECT assignment.assignee_user_id FROM order_assignments assignment
       JOIN orders ON orders.id=assignment.order_id AND orders.store_id=assignment.store_id
       WHERE orders.reference=?`,
    ).bind(order.reference).first<string>('assignee_user_id')).toBe(staff.userId);
    const staffDetail = await asConsole(staff.cookie, `/api/console/orders/${order.reference}`);
    expect(await staffDetail.json()).toMatchObject({ order: { allowedActions: ['mark_paid', 'cancel'] } });
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id');
    expect(await readOrderTarget(env.DB, 'store_nexus', orderId as string)).toMatchObject({ assignee_user_id: staff.userId });
    const paid = await asConsole(staff.cookie, `/api/console/orders/${order.reference}/payments/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('phase5-staff-pay') },
      body: JSON.stringify({ method: 'Bank transfer', reference: 'PHASE5-STAFF-PAY' }),
    });
    const paidBody = await paid.json() as Record<string, unknown>;
    expect(paid.status).toBe(200);
    expect(paidBody).not.toHaveProperty('assignment');
  });

  it('rolls back assignment when its target loses active Staff status at batch time', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id');
    let intercepted = false;
    const racing = interceptBatch(env.DB, async (statements, real) => {
      if (!intercepted) {
        intercepted = true;
        await real.prepare(
          "UPDATE store_memberships SET status='revoked', revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id=?",
        ).bind(staff.userId).run();
      }
      return real.batch(statements);
    });
    await expect(assignOrder({
      database: racing,
      identity: ownerIdentity,
      orderId: orderId as string,
      body: { assigneeUserId: staff.userId },
      idempotencyKey: key('phase5-revoke-target'),
    })).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_commands WHERE action='assign'").first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_assignments').first<number>('count')).toBe(0);
  });

  it('rolls back assignment when the assigning Owner is revoked before commit', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    let intercepted = false;
    const racing = interceptBatch(env.DB, async (statements, real) => {
      if (!intercepted) {
        intercepted = true;
        await real.prepare(
          "UPDATE store_memberships SET status='revoked', revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?",
        ).bind(ownerIdentity.membershipId).run();
      }
      return real.batch(statements);
    });
    await expect(assignOrder({
      database: racing,
      identity: ownerIdentity,
      orderId,
      body: { assigneeUserId: staff.userId },
      idempotencyKey: key('phase5-revoke-owner'),
    })).rejects.toMatchObject({ code: 'store_access_denied', status: 403 });
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_commands WHERE action='assign'").first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_assignments').first<number>('count')).toBe(0);
  });

  it('rolls back Staff processing when assignment disappears before the batch', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const staffIdentity = await consoleIdentity(staff.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    await assignOrder({
      database: env.DB, identity: ownerIdentity, orderId,
      body: { assigneeUserId: staff.userId }, idempotencyKey: key('phase5-race-assign'),
    });
    let intercepted = false;
    const racing = interceptBatch(env.DB, async (statements, real) => {
      if (!intercepted) {
        intercepted = true;
        await real.prepare('DELETE FROM order_assignments WHERE store_id=? AND order_id=?')
          .bind(staffIdentity.storeId, orderId).run();
      }
      return real.batch(statements);
    });
    await expect(markPaid({
      database: racing,
      context: { storeId: staffIdentity.storeId, actor: { source: 'user', id: staff.userId }, identity: staffIdentity },
      orderId,
      body: { method: 'Bank transfer', reference: 'PHASE5-RACE-PAY' },
      idempotencyKey: key('phase5-race-pay'),
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(orderId).first<string>('status')).toBe('pending');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id=?').bind(orderId).first<number>('count')).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE order_id=? AND action='order_paid'").bind(orderId).first<number>('count')).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_commands WHERE order_id=? AND action='mark_paid'").bind(orderId).first<number>('count')).toBe(0);
  });

  it('preserves a committed Staff command but conceals its result after access loss', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const staffIdentity = await consoleIdentity(staff.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    await assignOrder({
      database: env.DB, identity: ownerIdentity, orderId,
      body: { assigneeUserId: staff.userId }, idempotencyKey: key('phase5-commit-assign'),
    });
    let intercepted = false;
    const racing = interceptBatch(env.DB, async (statements, real) => {
      const result = await real.batch(statements);
      if (!intercepted) {
        intercepted = true;
        await real.prepare('DELETE FROM order_assignments WHERE store_id=? AND order_id=?')
          .bind(staffIdentity.storeId, orderId).run();
      }
      return result;
    });
    await expect(markPaid({
      database: racing,
      context: { storeId: staffIdentity.storeId, actor: { source: 'user', id: staff.userId }, identity: staffIdentity },
      orderId,
      body: { method: 'Bank transfer', reference: 'PHASE5-COMMIT-PAY' },
      idempotencyKey: key('phase5-commit-pay'),
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(orderId).first<string>('status')).toBe('paid');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id=?').bind(orderId).first<number>('count')).toBe(1);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE order_id=? AND action='order_paid'").bind(orderId).first<number>('count')).toBe(1);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_commands WHERE order_id=? AND action='mark_paid'").bind(orderId).first<number>('count')).toBe(1);
  });

  it('binds cursors to the Staff principal and continues after the seek row is reassigned', async () => {
    const { owner, staff, order } = await fixture();
    const second = await createConsoleSession({ email: 'phase5-cursor-2@example.test', name: 'Cursor Staff 2', role: 'staff' });
    const orders = [order, await placeAdditionalOrder(2), await placeAdditionalOrder(3)];
    for (const [index, current] of orders.entries()) {
      const response = await asConsole(owner.cookie, `/api/console/orders/${current.reference}/assignment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key(`phase5-page-assign-${index}`) },
        body: JSON.stringify({ assigneeUserId: staff.userId }),
      });
      expect(response.status).toBe(200);
    }
    const first = await asConsole(staff.cookie, '/api/console/orders?limit=1');
    const firstBody = await first.json() as { orders: Array<{ reference: string }>; nextCursor: string };
    expect(firstBody.orders).toHaveLength(1);
    expect(firstBody.nextCursor).toBeTruthy();
    expect((await asConsole(second.cookie, `/api/console/orders?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`)).status)
      .toBe(400);

    const moved = firstBody.orders[0];
    expect((await asConsole(owner.cookie, `/api/console/orders/${moved.reference}/assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key('phase5-page-move') },
      body: JSON.stringify({ assigneeUserId: second.userId }),
    })).status).toBe(200);
    const next = await asConsole(
      staff.cookie,
      `/api/console/orders?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    );
    expect(next.status).toBe(200);
    const nextBody = await next.json() as { orders: Array<{ reference: string }>; summary: { totalOrders: number } };
    expect(nextBody.orders).toHaveLength(1);
    expect(nextBody.orders[0]?.reference).not.toBe(moved.reference);
    expect(nextBody.summary.totalOrders).toBe(2);
  });

  it('fails a list with store_access_denied when membership is revoked after its query', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const staffIdentity = await consoleIdentity(staff.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    await assignOrder({
      database: env.DB, identity: ownerIdentity, orderId,
      body: { assigneeUserId: staff.userId }, idempotencyKey: key('phase5-list-revoke-assign'),
    });
    let intercepted = false;
    const racing = interceptBatch(env.DB, async (statements, real) => {
      const result = await real.batch(statements);
      if (!intercepted) {
        intercepted = true;
        await real.prepare(
          "UPDATE store_memberships SET status='revoked', revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?",
        ).bind(staffIdentity.membershipId).run();
      }
      return result;
    });
    await expect(listConsoleOrders(racing, {
      storeId: staffIdentity.storeId,
      actor: { source: 'user', id: staffIdentity.userId },
      identity: staffIdentity,
    }, { q: '', status: null, refund: null, limit: 25, cursor: null }))
      .rejects.toMatchObject({ code: 'store_access_denied', status: 403 });
  });

  it('does not return stale Staff rows or summary after reassignment follows the list batch', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const staffIdentity = await consoleIdentity(staff.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    await assignOrder({
      database: env.DB, identity: ownerIdentity, orderId,
      body: { assigneeUserId: staff.userId }, idempotencyKey: key('phase5-list-drift-assign'),
    });
    let intercepted = false;
    const racing = interceptBatch(env.DB, async (statements, real) => {
      const result = await real.batch(statements);
      if (!intercepted) {
        intercepted = true;
        await real.prepare('DELETE FROM order_assignments WHERE store_id=? AND order_id=?')
          .bind(staffIdentity.storeId, orderId).run();
      }
      return result;
    });
    await expect(listConsoleOrders(racing, {
      storeId: staffIdentity.storeId,
      actor: { source: 'user', id: staffIdentity.userId },
      identity: staffIdentity,
    }, { q: '', status: null, refund: null, limit: 25, cursor: null })).resolves.toEqual({
      orders: [],
      summary: { totalOrders: 0, byStatus: { pending: 0, paid: 0, fulfilled: 0, canceled: 0 }, openRefundRequests: 0 },
      nextCursor: null,
      hasOrders: false,
    });
  });

  it('rejects a command ledger whose action does not match its history event', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    const assigned = await assignOrder({
      database: env.DB, identity: ownerIdentity, orderId,
      body: { assigneeUserId: staff.userId }, idempotencyKey: key('phase5-event-match'),
    });
    await env.DB.prepare(
      `INSERT INTO order_commands (
         id, store_id, request_key, order_id, action, payload_hash, result_history_id, contract_version
       ) VALUES ('cmd_bad_event','store_nexus','bad-event-key-0001',?,'cancel',? ,?,2)`,
    ).bind(orderId, 'a'.repeat(64), assigned.assignment.eventId).run();
    await expect(readCommandResult(env.DB, 'store_nexus', 'bad-event-key-0001'))
      .rejects.toMatchObject({ code: 'order_persistence_failed' });
  });

  it('concurrent fresh keys for the same Staff bind one durable assignment event', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    const bothReady = deferred();
    const release = deferred();
    let waiting = 0;
    const racing = interceptBatch(env.DB, async (statements, real) => {
      waiting += 1;
      if (waiting === 2) bothReady.resolve();
      await release.promise;
      return real.batch(statements);
    });
    const first = assignOrder({
      database: racing, identity: ownerIdentity, orderId,
      body: { assigneeUserId: staff.userId }, idempotencyKey: key('phase5-concurrent-a'),
    });
    const second = assignOrder({
      database: racing, identity: ownerIdentity, orderId,
      body: { assigneeUserId: staff.userId }, idempotencyKey: key('phase5-concurrent-b'),
    });
    await bothReady.promise;
    release.resolve();
    const results = await Promise.all([first, second]);
    expect(results[0].assignment.eventId).toBe(results[1].assignment.eventId);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(1);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_commands WHERE action='assign'").first<number>('count')).toBe(2);
  });

  it('rolls back every assignment statement boundary on an arbitrary D1 fault', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    for (const boundary of [0, 1, 2, 3]) {
      let injected = false;
      const faulty = interceptBatch(env.DB, async (statements, real) => {
        if (injected) return real.batch(statements);
        injected = true;
        const failure = real.prepare('INSERT INTO order_commands (id) VALUES (NULL)');
        return real.batch([
          ...statements.slice(0, boundary), failure, ...statements.slice(boundary),
        ]);
      });
      await expect(assignOrder({
        database: faulty, identity: ownerIdentity, orderId,
        body: { assigneeUserId: staff.userId }, idempotencyKey: key(`phase5-fault-${boundary}`),
      })).rejects.toMatchObject({ code: 'order_persistence_failed' });
      expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(0);
      expect(await env.DB.prepare("SELECT count(*) AS count FROM order_commands WHERE action='assign'").first<number>('count')).toBe(0);
      expect(await env.DB.prepare('SELECT count(*) AS count FROM order_assignments').first<number>('count')).toBe(0);
    }
  });

  it('reauthorizes Owner assignment recovery after reading a conflicting ledger', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    const requestKey = key('phase5-ledger-assign');
    const racing = interceptLedgerReads(env.DB, async (count, result, real) => {
      if (count === 1 && result === null) await insertConflictingLedger(orderId, requestKey);
      if (count === 2) {
        await real.prepare(
          "UPDATE store_memberships SET status='revoked', revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?",
        ).bind(ownerIdentity.membershipId).run();
      }
    });
    await expect(assignOrder({
      database: racing, identity: ownerIdentity, orderId,
      body: { assigneeUserId: staff.userId }, idempotencyKey: requestKey,
    })).rejects.toMatchObject({ code: 'store_access_denied', status: 403 });
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_history WHERE action='assigned'").first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_assignments').first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_commands WHERE request_key=?')
      .bind(requestKey).first<number>('count')).toBe(1);
  });

  it('reauthorizes ledger-only binding recovery before classifying a conflict', async () => {
    const { owner, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    const historyId = await env.DB.prepare("SELECT id FROM order_history WHERE order_id=? AND action='order_created'")
      .bind(orderId).first<string>('id') as string;
    const requestKey = key('phase5-ledger-bind');
    await insertConflictingLedger(orderId, requestKey);
    const racing = interceptLedgerReads(env.DB, async (_count, _result, real) => {
      await real.prepare(
        "UPDATE store_memberships SET status='revoked', revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?",
      ).bind(ownerIdentity.membershipId).run();
    });
    await expect(bindExistingResult({
      database: racing,
      storeId: ownerIdentity.storeId,
      requestKey,
      orderId,
      action: 'mark_paid',
      hash: 'a'.repeat(64),
      historyId,
      refundRequestId: null,
      context: { storeId: ownerIdentity.storeId, actor: { source: 'user', id: owner.userId }, identity: ownerIdentity },
    })).rejects.toMatchObject({ code: 'store_access_denied', status: 403 });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_commands WHERE request_key=?')
      .bind(requestKey).first<number>('count')).toBe(1);
  });

  it('conceals failed command recovery when Staff assignment is lost during ledger read', async () => {
    const { owner, staff, order } = await fixture();
    const ownerIdentity = await consoleIdentity(owner.userId);
    const staffIdentity = await consoleIdentity(staff.userId);
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?').bind(order.reference).first<string>('id') as string;
    await assignOrder({
      database: env.DB, identity: ownerIdentity, orderId,
      body: { assigneeUserId: staff.userId }, idempotencyKey: key('phase5-ledger-staff-assign'),
    });
    const requestKey = key('phase5-ledger-command');
    await insertConflictingLedger(orderId, requestKey);
    const racing = interceptLedgerReads(env.DB, async (_count, _result, real) => {
      await real.prepare('DELETE FROM order_assignments WHERE store_id=? AND order_id=?')
        .bind(staffIdentity.storeId, orderId).run();
    });
    await expect(runCommandBatch({
      database: racing,
      storeId: staffIdentity.storeId,
      requestKey,
      action: 'mark_paid',
      orderId,
      hash: 'a'.repeat(64),
      eligible: (status) => status === 'pending',
      statements: [env.DB.prepare('INSERT INTO order_commands (id) VALUES (NULL)')],
      context: { storeId: staffIdentity.storeId, actor: { source: 'user', id: staff.userId }, identity: staffIdentity },
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_commands WHERE request_key=?')
      .bind(requestKey).first<number>('count')).toBe(1);
  });
});
