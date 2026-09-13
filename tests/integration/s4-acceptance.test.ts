import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { CSV_CONTENT_TYPE, CSV_FILENAME_HEADER, CSV_TEMPLATE } from '@nexus/catalog/shared/csv-contract';
import {
  resetCatalog,
  oneVariantSchema,
  SIMPLE_CORE,
  TEST_STOREFRONT_ORIGIN,
  workerRequest,
} from '../support/catalog-test-env';
import { createConsoleSession, TEST_CONSOLE_ORIGIN } from '../support/identity-test-env';

interface SessionFixture {
  cookie: string;
  userId: string;
}

const CAPABILITY_A = 'A'.repeat(43);
const CAPABILITY_B = 'B'.repeat(43);

function requestKey(label: string): string {
  return `${label}-${'k'.repeat(48)}`.slice(0, 64);
}

async function clearFiles(): Promise<void> {
  const objects = await env.FILES.list();
  if (objects.objects.length > 0) await env.FILES.delete(objects.objects.map((object) => object.key));
}

beforeEach(async () => {
  await resetCatalog();
  await clearFiles();
  await env.DB.prepare("INSERT INTO stores (id,slug,name) VALUES ('store_b','store-b','Store B')").run();
});

async function asConsole(session: SessionFixture, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Cookie', session.cookie);
  headers.set('Origin', TEST_CONSOLE_ORIGIN);
  headers.set('Sec-Fetch-Site', 'same-origin');
  headers.set('X-Nexus-Order-Contract', '2');
  return workerRequest(path, { ...init, headers });
}

async function createProduct(session: SessionFixture, name: string): Promise<{ id: string; slug: string }> {
  const response = await asConsole(session, '/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: { ...SIMPLE_CORE, name }, schema: null, previewHash: null }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { product: { id: string; slug: string } }).product;
}

async function uploadProductFile(
  session: SessionFixture,
  productId: string,
  filename: string,
): Promise<string> {
  const response = await asConsole(session, `/api/console/products/${productId}/delivery-file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'If-Match': '"1"',
      'X-Nexus-Filename': filename,
    },
    body: new TextEncoder().encode(`%PDF-${filename}`),
  });
  expect(response.status).toBe(200);
  const key = await env.DB.prepare('SELECT delivery_file_key FROM products WHERE id=?')
    .bind(productId).first<string>('delivery_file_key');
  if (!key) throw new Error('Expected a retained delivery object key.');
  return key;
}

async function importCatalog(session: SessionFixture, filename: string): Promise<string> {
  const response = await asConsole(session, '/api/console/imports', {
    method: 'POST',
    headers: {
      'Content-Type': CSV_CONTENT_TYPE,
      [CSV_FILENAME_HEADER]: encodeURIComponent(filename),
    },
    body: CSV_TEMPLATE,
  });
  expect(response.status).toBe(200);
  const storeId = await env.DB.prepare('SELECT store_id FROM store_memberships WHERE user_id=? AND status=\'active\'')
    .bind(session.userId).first<string>('store_id');
  const key = await env.DB.prepare(
    'SELECT private_object_key FROM imports WHERE store_id=? ORDER BY created_at DESC,id DESC LIMIT 1',
  ).bind(storeId).first<string>('private_object_key');
  if (!key) throw new Error('Expected a retained import object key.');
  return key;
}

async function placeOrder(input: {
  productId: string;
  capability: string;
  label: string;
}): Promise<{ reference: string }> {
  const response = await workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': requestKey(`create-${input.label}`),
      'X-Nexus-Order-Capability': input.capability,
      Origin: TEST_STOREFRONT_ORIGIN,
    },
    body: JSON.stringify({
      customer: {
        name: `Customer ${input.label}`,
        email: `${input.label}@example.test`,
      },
      items: [{ productId: input.productId, variantId: null, quantity: 1 }],
    }),
  });
  expect(response.status).toBe(201);
  return await response.json() as { reference: string };
}

async function customerOrder(reference: string, capability: string, cookie?: string): Promise<Response> {
  return workerRequest(`/api/storefront/orders/${reference}`, {
    headers: {
      Origin: TEST_STOREFRONT_ORIGIN,
      'X-Nexus-Order-Capability': capability,
      'X-Nexus-Order-Contract': '2',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(allStrings);
}

function expectCustomerPrivacy(body: unknown, secrets: string[]): void {
  const forbidden = /^(actor|actorId|decidedByUserId|assignment|history|payment|paymentId|externalReference|accessInstructions|privateFileKey|capability|capabilityDigest|idempotencyKey)$/i;
  expect(allKeys(body).filter((key) => forbidden.test(key))).toEqual([]);
  const strings = allStrings(body);
  for (const secret of secrets) expect(strings).not.toContain(secret);
}

describe('S4 cross-layer acceptance matrix', () => {
  it('S4-01/29/32/39 preserves Store A while crossed Store B catalog, import, file, Order, and Origin attempts fail closed', async () => {
    const ownerA = await createConsoleSession({ email: 's4-owner-a@example.test', name: 'S4 Owner A' });
    const ownerB = await createConsoleSession({
      email: 's4-owner-b@example.test', name: 'S4 Owner B', storeId: 'store_b',
    });
    const productA = await createProduct(ownerA, 'Store A Private Manual');
    const productB = await createProduct(ownerB, 'Store B Private Manual');
    const fileKeyA = await uploadProductFile(ownerA, productA.id, 'store-a-private.pdf');
    const importKeyA = await importCatalog(ownerA, 'store-a-import.csv');
    const importKeyB = await importCatalog(ownerB, 'store-b-import.csv');
    const orderA = await placeOrder({ productId: productA.id, capability: CAPABILITY_A, label: 'store-a-cross' });

    const protectedBefore = await env.DB.prepare(
      `SELECT id,store_id,slug,name,revision,delivery_file_key
         FROM products WHERE id=?`,
    ).bind(productA.id).first();
    const productCountA = await env.DB.prepare("SELECT count(*) AS count FROM products WHERE store_id='store_nexus'")
      .first<number>('count');

    const crossedResponses = [
      await asConsole(ownerB, `/api/console/products/by-slug/${productA.slug}`),
      await asConsole(ownerB, `/api/console/products/${productA.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': 'invalid' }, body: '{}',
      }),
      await asConsole(ownerB, '/api/console/products/schema/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': '"2"' },
        body: JSON.stringify({
          productId: productA.id,
          productSlug: productA.slug,
          product: { ...SIMPLE_CORE, name: 'Store A Private Manual' },
          schema: oneVariantSchema(),
        }),
      }),
      await asConsole(ownerB, `/api/console/products/${productA.id}/delivery-file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'If-Match': 'invalid', 'X-Nexus-Filename': 'crossed.pdf' },
        body: new TextEncoder().encode('%PDF-crossed'),
      }),
      await asConsole(ownerB, `/api/console/products/${productA.id}/delivery-file`, {
        method: 'DELETE', headers: { 'If-Match': 'invalid' },
      }),
      await asConsole(ownerB, `/api/console/orders/${orderA.reference}`),
    ];
    expect(crossedResponses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404]);
    for (const response of crossedResponses) {
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toMatch(/^(not_found|product_not_found)$/);
      expect(allStrings(body)).not.toContain(productA.id);
      expect(allStrings(body)).not.toContain(orderA.reference);
    }

    const deniedOrigins: Array<Record<string, string>> = [
      {},
      { Origin: 'https://hostile.invalid' },
      { Origin: TEST_CONSOLE_ORIGIN, 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of deniedOrigins) {
      const denied = await workerRequest('/api/console/products', {
        method: 'POST',
        headers: { Cookie: ownerA.cookie, 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ product: { ...SIMPLE_CORE, name: 'Origin must fail' }, schema: null, previewHash: null }),
      });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: { code: 'origin_not_allowed' } });
    }

    expect(await env.DB.prepare(
      'SELECT id,store_id,slug,name,revision,delivery_file_key FROM products WHERE id=?',
    ).bind(productA.id).first()).toEqual(protectedBefore);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM products WHERE store_id='store_nexus'")
      .first<number>('count')).toBe(productCountA);
    expect(importKeyB).not.toBe(importKeyA);
    await expect(env.FILES.get(fileKeyA)).resolves.not.toBeNull();
    await expect(env.FILES.get(importKeyA)).resolves.not.toBeNull();
    await expect(env.FILES.get(importKeyB)).resolves.not.toBeNull();

    const publicWithStoreBCookie = await workerRequest('/api/storefront/products', {
      headers: { Cookie: ownerB.cookie, Origin: TEST_STOREFRONT_ORIGIN },
    });
    expect(publicWithStoreBCookie.status).toBe(200);
    const publicCatalog = await publicWithStoreBCookie.json() as { products: Array<{ id: string }> };
    expect(publicCatalog.products.some((product) => product.id === productA.id)).toBe(true);
    expect(publicCatalog.products.some((product) => product.id === productB.id)).toBe(false);
  });

  it('S4-02/31/35/40/41/44/45/46/49 enforces assigned Staff work and Owner-only decisions while retaining Customer-safe evidence', async () => {
    const owner = await createConsoleSession({ email: 's4-flow-owner@example.test', name: 'S4 Flow Owner' });
    const staff = await createConsoleSession({
      email: 's4-flow-staff@example.test', name: 'S4 Flow Staff', role: 'staff',
    });
    const foreignStaff = await createConsoleSession({
      email: 's4-foreign-staff@example.test', name: 'S4 Foreign Staff', storeId: 'store_b', role: 'staff',
    });
    const product = await createProduct(owner, 'Assigned Retained Product');
    const retainedKey = await uploadProductFile(owner, product.id, 'assigned-retained.pdf');
    const order = await placeOrder({ productId: product.id, capability: CAPABILITY_A, label: 'assigned-flow' });
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?')
      .bind(order.reference).first<string>('id');
    if (!orderId) throw new Error('Expected assigned-flow Order.');
    const snapshotBefore = await env.DB.prepare(
      'SELECT access_title,access_instructions,private_file_key FROM order_lines WHERE order_id=?',
    ).bind(orderId).first();

    const emptyInbox = await asConsole(staff, '/api/console/orders');
    expect(emptyInbox.status).toBe(200);
    expect(await emptyInbox.json()).toMatchObject({ orders: [], hasOrders: false, summary: { totalOrders: 0 } });
    expect((await asConsole(staff, `/api/console/orders/${order.reference}`)).status).toBe(404);
    expect((await asConsole(staff, `/api/console/orders/${order.reference}/payments/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('unassigned-pay') },
      body: JSON.stringify({ method: 'Bank transfer', reference: 'UNASSIGNED-MUST-NOT-WRITE' }),
    })).status).toBe(404);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM order_commands WHERE order_id=? AND action='mark_paid'")
      .bind(orderId).first<number>('count')).toBe(0);

    const foreignAssignment = await asConsole(owner, `/api/console/orders/${order.reference}/assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('foreign-assignment') },
      body: JSON.stringify({ assigneeUserId: foreignStaff.userId }),
    });
    expect(foreignAssignment.status).toBe(422);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM order_assignments WHERE order_id=?')
      .bind(orderId).first<number>('count')).toBe(0);

    const assigned = await asConsole(owner, `/api/console/orders/${order.reference}/assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('valid-assignment') },
      body: JSON.stringify({ assigneeUserId: staff.userId }),
    });
    expect(assigned.status).toBe(200);
    const assignedInbox = await asConsole(staff, '/api/console/orders');
    expect(await assignedInbox.json()).toMatchObject({
      orders: [{ reference: order.reference }], hasOrders: true, summary: { totalOrders: 1 },
    });
    const assignedDetail = await asConsole(staff, `/api/console/orders/${order.reference}`);
    expect(await assignedDetail.json()).toMatchObject({ order: { allowedActions: ['mark_paid', 'cancel'] } });
    expect((await asConsole(staff, `/api/console/orders/${order.reference}/assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('staff-cannot-assign') },
      body: JSON.stringify({ assigneeUserId: staff.userId }),
    })).status).toBe(403);

    const paid = await asConsole(staff, `/api/console/orders/${order.reference}/payments/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('assigned-pay') },
      body: JSON.stringify({ method: 'Bank transfer', reference: 'S4-ASSIGNED-PAYMENT' }),
    });
    expect(paid.status).toBe(200);
    const requested = await asConsole(staff, `/api/console/orders/${order.reference}/refund-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('assigned-refund') },
      body: JSON.stringify({ reason: 'Keep the safe decision visible to the Customer.' }),
    });
    expect(requested.status).toBe(200);
    const requestId = (await requested.json() as { refundRequest: { id: string } }).refundRequest.id;
    const staffDecision = await asConsole(
      staff,
      `/api/console/orders/${order.reference}/refund-requests/${requestId}/approve`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('staff-decision') }, body: '{}',
      },
    );
    expect(staffDecision.status).toBe(403);
    expect(await staffDecision.json()).toMatchObject({ error: { code: 'forbidden' } });
    const financialBeforeDecision = await env.DB.prepare(
      `SELECT orders.status,payments.id AS payment_id,payments.external_reference
         FROM orders JOIN payments ON payments.order_id=orders.id AND payments.store_id=orders.store_id
        WHERE orders.id=?`,
    ).bind(orderId).first();
    const approved = await asConsole(
      owner,
      `/api/console/orders/${order.reference}/refund-requests/${requestId}/approve`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('owner-decision') }, body: '{}',
      },
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      action: 'approve_refund', status: 'paid', refundRequest: { id: requestId, status: 'approved' },
    });
    expect(await env.DB.prepare(
      `SELECT orders.status,payments.id AS payment_id,payments.external_reference
         FROM orders JOIN payments ON payments.order_id=orders.id AND payments.store_id=orders.store_id
        WHERE orders.id=?`,
    ).bind(orderId).first()).toEqual(financialBeforeDecision);
    const fulfilled = await asConsole(staff, `/api/console/orders/${order.reference}/fulfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('assigned-fulfill') },
      body: '{}',
    });
    expect(fulfilled.status).toBe(200);

    expect(await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(orderId).first<string>('status'))
      .toBe('fulfilled');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id=?')
      .bind(orderId).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM order_history WHERE order_id=? AND action='refund_approved'",
    ).bind(orderId).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      'SELECT access_title,access_instructions,private_file_key FROM order_lines WHERE order_id=?',
    ).bind(orderId).first()).toEqual(snapshotBefore);
    await expect(env.FILES.get(retainedKey)).resolves.not.toBeNull();

    const customerResponse = await customerOrder(order.reference, CAPABILITY_A);
    expect(customerResponse.status).toBe(200);
    const customerBody = await customerResponse.json() as {
      status: string;
      refundRequest: { id: string; status: string; decidedAt: string };
    };
    expect(customerBody).toMatchObject({
      status: 'fulfilled', refundRequest: { id: requestId, status: 'approved', decidedAt: expect.any(String) },
    });
    expectCustomerPrivacy(customerBody, [CAPABILITY_A, retainedKey, owner.userId, staff.userId]);

    const wrongCapability = await customerOrder(order.reference, CAPABILITY_B);
    const wrongCapabilityWithConsoleCookie = await customerOrder(order.reference, CAPABILITY_B, owner.cookie);
    expect(wrongCapability.status).toBe(404);
    expect(wrongCapabilityWithConsoleCookie.status).toBe(404);
    expect(await wrongCapabilityWithConsoleCookie.json()).toEqual(await wrongCapability.json());
  });

  it('S4-34/41/43/47 approves a legacy paid Order without fabricating payment evidence or rewriting its actor history', async () => {
    const owner = await createConsoleSession({ email: 's4-legacy-owner@example.test', name: 'Legacy Owner' });
    const product = await createProduct(owner, 'Legacy Evidence Product');
    const order = await placeOrder({ productId: product.id, capability: CAPABILITY_A, label: 'legacy-paid' });
    const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?')
      .bind(order.reference).first<string>('id');
    if (!orderId) throw new Error('Expected legacy Order.');
    const legacyOccurredAt = '2026-09-12T09:30:00.000Z';
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET status='paid' WHERE id=? AND status='pending'").bind(orderId),
      env.DB.prepare(
        `INSERT INTO order_history (
           id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,
           refund_request_id,assignee_user_id
         ) VALUES ('history_s4_legacy_paid','store_nexus',?,'paid',?,'order_completed','console','pending',NULL,1,NULL,NULL)`,
      ).bind(orderId, legacyOccurredAt),
    ]);
    const legacyBefore = await env.DB.prepare(
      "SELECT action,source,actor_id,contract_version,created_at FROM order_history WHERE id='history_s4_legacy_paid'",
    ).first();

    const requested = await workerRequest(`/api/storefront/orders/${order.reference}/refund-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': requestKey('legacy-refund-request'),
        'X-Nexus-Order-Capability': CAPABILITY_A,
        'X-Nexus-Order-Contract': '2',
        Origin: TEST_STOREFRONT_ORIGIN,
      },
      body: JSON.stringify({ reason: 'Legacy paid Order still needs a truthful decision.' }),
    });
    expect(requested.status).toBe(200);
    const requestId = (await requested.json() as { refundRequest: { id: string } }).refundRequest.id;
    const approved = await asConsole(
      owner,
      `/api/console/orders/${order.reference}/refund-requests/${requestId}/approve`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('legacy-approve') }, body: '{}',
      },
    );
    expect(approved.status).toBe(200);

    const decision = await env.DB.prepare(
      `SELECT requests.status,requests.decided_at,requests.decided_by_user_id,history.actor_id,history.created_at
         FROM order_refund_requests requests
         JOIN order_history history ON history.refund_request_id=requests.id AND history.action='refund_approved'
        WHERE requests.id=?`,
    ).bind(requestId).first<{
      status: string; decided_at: string; decided_by_user_id: string; actor_id: string; created_at: string;
    }>();
    expect(decision).toMatchObject({
      status: 'approved', decided_at: expect.any(String), decided_by_user_id: owner.userId,
      actor_id: owner.userId, created_at: expect.any(String),
    });
    await env.DB.prepare('UPDATE "user" SET name=\'Renamed Owner\' WHERE id=?').bind(owner.userId).run();
    await env.DB.prepare(
      "UPDATE store_memberships SET status='revoked',revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=?",
    ).bind(owner.userId).run();

    expect(await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(orderId).first<string>('status')).toBe('paid');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM payments WHERE order_id=?')
      .bind(orderId).first<number>('count')).toBe(0);
    expect(await env.DB.prepare(
      "SELECT action,source,actor_id,contract_version,created_at FROM order_history WHERE id='history_s4_legacy_paid'",
    ).first()).toEqual(legacyBefore);
    expect(await env.DB.prepare(
      "SELECT actor_id FROM order_history WHERE refund_request_id=? AND action='refund_approved'",
    ).bind(requestId).first<string>('actor_id')).toBe(owner.userId);

    const customerResponse = await customerOrder(order.reference, CAPABILITY_A);
    expect(customerResponse.status).toBe(200);
    const customerBody = await customerResponse.json();
    expect(customerBody).toMatchObject({
      status: 'paid', refundRequest: { id: requestId, status: 'approved', decidedAt: decision?.decided_at },
    });
    expectCustomerPrivacy(customerBody, [CAPABILITY_A, owner.userId, 'history_s4_legacy_paid']);
  });
});
