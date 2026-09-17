import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import { dispatchDueOrderEmails } from '../../apps/worker/src/order-email-service';
import { SIMPLE_CORE, consoleRequest, resetCatalog, workerRequest } from '../support/catalog-test-env';

const CAPABILITY = 'T'.repeat(43);
const RESEND_API_KEY = 'resend-delivery-test-secret';

beforeEach(resetCatalog);

describe('transactional Order email delivery', () => {
  it('sends the pending Order link once and retires reminders after payment', async () => {
    const productResponse = await consoleRequest('/api/console/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
    });
    const product = (await productResponse.json() as { product: ProductDetailResponse }).product;
    const orderResponse = await workerRequest('/api/storefront/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'email-delivery-order-0001',
        'X-Nexus-Order-Capability': CAPABILITY,
      },
      body: JSON.stringify({
        customer: { name: 'Ada Lovelace', email: 'ada@example.test' },
        items: [{ productId: product.id, variantId: null, quantity: 1 }],
      }),
    });
    expect(orderResponse.status).toBe(201);
    const order = await orderResponse.json() as { reference: string };

    const deliveries: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      deliveries.push({ input, init });
      return new Response(JSON.stringify({ id: 'email_test_1' }), { status: 200 });
    }));

    expect(await dispatchDueOrderEmails({
      DB: env.DB,
      RESEND_API_KEY,
      RESEND_FROM: 'Nexus <orders@example.test>',
      STOREFRONT_ORIGIN: 'https://storefront.test',
    })).toBe(1);
    expect(deliveries).toHaveLength(1);
    expect(String(deliveries[0]?.input)).toBe('https://api.resend.com/emails');
    const sent = JSON.parse(String(deliveries[0]?.init?.body)) as { to: string[]; text: string };
    expect(sent.to).toEqual(['ada@example.test']);
    expect(sent.text).toContain(`Order ${order.reference}`);
    expect(sent.text).toContain(`https://storefront.test/orders/${order.reference}#capability=`);
    const createdJob = await env.DB.prepare(
      "SELECT id FROM order_email_jobs WHERE kind = 'order_created' AND order_id = (SELECT id FROM orders WHERE reference = ?)",
    ).bind(order.reference).first<{ id: string }>();
    if (createdJob === null) throw new Error('Expected order-created job.');
    expect(new Headers(deliveries[0]?.init?.headers).get('Idempotency-Key')).toBe(createdJob.id);

    const dueReminder = await env.DB.prepare(
      `SELECT id FROM order_email_jobs
        WHERE kind = 'payment_reminder' AND reminder_sequence = 2
          AND order_id = (SELECT id FROM orders WHERE reference = ?)`,
    ).bind(order.reference).first<{ id: string }>();
    if (dueReminder === null) throw new Error('Expected payment reminder.');
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE order_email_jobs SET delivered_at = NULL, attempts = 12, available_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
      ).bind(createdJob.id),
      env.DB.prepare("UPDATE order_email_jobs SET available_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(dueReminder.id),
    ]);
    expect(await dispatchDueOrderEmails({
      DB: env.DB,
      RESEND_API_KEY,
      RESEND_FROM: 'Nexus <orders@example.test>',
      STOREFRONT_ORIGIN: 'https://storefront.test',
    })).toBe(1);
    expect(deliveries).toHaveLength(2);
    expect(await env.DB.prepare('SELECT last_error FROM order_email_jobs WHERE id = ?').bind(createdJob.id).first<string>('last_error'))
      .toBe('attempts_exhausted');
    const reminder = await env.DB.prepare(
      `SELECT jobs.id, orders.id AS order_id
         FROM order_email_jobs jobs
         JOIN orders ON orders.id = jobs.order_id AND orders.store_id = jobs.store_id
        WHERE orders.reference = ? AND jobs.kind = 'payment_reminder' AND jobs.reminder_sequence = 1`,
    ).bind(order.reference).first<{ id: string; order_id: string }>();
    if (reminder === null) throw new Error('Expected payment reminder.');
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").bind(reminder.order_id),
      env.DB.prepare("UPDATE order_email_jobs SET available_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(reminder.id),
    ]);

    expect(await dispatchDueOrderEmails({
      DB: env.DB,
      RESEND_API_KEY,
      RESEND_FROM: 'Nexus <orders@example.test>',
      STOREFRONT_ORIGIN: 'https://storefront.test',
    })).toBe(0);
    expect(deliveries).toHaveLength(2);
    expect(await env.DB.prepare('SELECT delivered_at FROM order_email_jobs WHERE id = ?').bind(reminder.id).first<string>('delivered_at'))
      .toEqual(expect.any(String));

    const retryOrderResponse = await workerRequest('/api/storefront/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'email-delivery-order-0002',
        'X-Nexus-Order-Capability': 'U'.repeat(43),
      },
      body: JSON.stringify({
        customer: { name: 'Grace Hopper', email: 'grace@example.test' },
        items: [{ productId: product.id, variantId: null, quantity: 1 }],
      }),
    });
    expect(retryOrderResponse.status).toBe(201);
    const retryOrder = await retryOrderResponse.json() as { reference: string };
    const retryJob = await env.DB.prepare(
      "SELECT id FROM order_email_jobs WHERE kind = 'order_created' AND order_id = (SELECT id FROM orders WHERE reference = ?)",
    ).bind(retryOrder.reference).first<{ id: string }>();
    if (retryJob === null) throw new Error('Expected retry job.');

    let failCompletion = true;
    const flakyDatabase = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== 'prepare') {
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (query: string) => {
          const statement = target.prepare(query);
          if (!failCompletion || !query.includes('SET delivered_at') || !query.includes('last_error = ?')) return statement;
          return {
            bind(...values: unknown[]) {
              const bound = statement.bind(...values);
              return new Proxy(bound, {
                get(statementTarget, statementProperty, statementReceiver) {
                  if (statementProperty === 'run') {
                    return async () => {
                      failCompletion = false;
                      throw new Error('response_lost_after_provider_accept');
                    };
                  }
                  const value = Reflect.get(statementTarget, statementProperty, statementReceiver);
                  return typeof value === 'function' ? value.bind(statementTarget) : value;
                },
              });
            },
          };
        };
      },
    }) as D1Database;
    expect(await dispatchDueOrderEmails({
      DB: flakyDatabase,
      RESEND_API_KEY,
      RESEND_FROM: 'Nexus <orders@example.test>',
      STOREFRONT_ORIGIN: 'https://storefront.test',
    })).toBe(0);
    await env.DB.prepare("UPDATE order_email_jobs SET available_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(retryJob.id).run();
    expect(await dispatchDueOrderEmails({
      DB: env.DB,
      RESEND_API_KEY,
      RESEND_FROM: 'Nexus <orders@example.test>',
      STOREFRONT_ORIGIN: 'https://storefront.test',
    })).toBe(1);
    const retriedHeaders = deliveries.slice(-2).map((delivery) => new Headers(delivery.init?.headers).get('Idempotency-Key'));
    expect(retriedHeaders).toEqual([retryJob.id, retryJob.id]);
  });
});
