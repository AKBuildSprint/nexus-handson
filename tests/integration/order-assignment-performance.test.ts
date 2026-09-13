import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';
import { listConsoleOrders } from '@nexus/orders/queries/order-read';
import { resetCatalog } from '../support/catalog-test-env';
import { createConsoleSession } from '../support/identity-test-env';

beforeEach(resetCatalog);

async function identity(userId: string): Promise<ConsoleIdentityContext> {
  const row = await env.DB.prepare(
    'SELECT id, store_id, role, status FROM store_memberships WHERE user_id=?',
  ).bind(userId).first<{ id: string; store_id: string; role: 'owner' | 'staff'; status: 'active' }>();
  if (!row) throw new Error('Expected performance membership.');
  return {
    kind: 'console', userId, storeId: row.store_id, membershipId: row.id,
    role: row.role, membershipStatus: row.status,
  };
}

function p95(samples: number[]): number {
  return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1] ?? 0;
}

async function measure(statement: D1PreparedStatement): Promise<{ p95Ms: number; rowsRead: number | null }> {
  const samples: number[] = [];
  let rowsRead: number | null = null;
  for (let sample = 0; sample < 20; sample += 1) {
    const started = performance.now();
    const result = await statement.all();
    samples.push(performance.now() - started);
    rowsRead = typeof result.meta.rows_read === 'number' ? result.meta.rows_read : rowsRead;
  }
  return { p95Ms: p95(samples), rowsRead };
}

describe('sparse assigned Order query', () => {
  it('uses the assignee index and records the 10,000/200 local budget', async () => {
    const ownerSession = await createConsoleSession({ email: 'perf-owner@example.test', name: 'Performance Owner' });
    const staffSession = await createConsoleSession({ email: 'perf-staff@example.test', name: 'Performance Staff', role: 'staff' });
    const owner = await identity(ownerSession.userId);
    const staff = await identity(staffSession.userId);
    const productId = 'prod_performance';
    await env.DB.prepare(
      `INSERT INTO products (
         id, store_id, slug, name, status, product_type, currency, base_price_minor
       ) VALUES (?, 'store_nexus', 'performance-product', 'Performance Product', 'active', 'simple', 'USD', 100)`,
    ).bind(productId).run();
    await env.DB.prepare(
      "INSERT INTO customers (id, store_id, name, email_normalized) VALUES ('cust_perf','store_nexus','Performance Buyer','performance@example.test')",
    ).run();
    await env.DB.batch([
      env.DB.prepare(
        `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<10000)
         INSERT INTO order_lines (
           id, store_id, order_id, product_id, product_name, selected_options_json,
           quantity, unit_price_minor, line_total_minor, currency,
           access_title, access_instructions, position
         ) SELECT printf('line_perf_%05d',n), 'store_nexus', printf('ord_perf_%05d',n),
                  ?, 'Performance Product', '[]', 1, 100, 100, 'USD', '', '', 0
             FROM seq`,
      ).bind(productId),
      env.DB.prepare(
        `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<10000)
         INSERT INTO orders (
           id, store_id, reference, customer_id, customer_name, customer_email_normalized,
           status, currency, total_minor, payment_reference, created_at
         ) SELECT printf('ord_perf_%05d',n), 'store_nexus', printf('NX-%016X',n),
                  'cust_perf', 'Performance Buyer', 'performance@example.test',
                  'pending', 'USD', 100, printf('NP%032x',n),
                  printf('2026-09-12T00:%02d:%02d.000Z',(n/60)%60,n%60)
             FROM seq`,
      ),
      env.DB.prepare(
        `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<200)
         INSERT INTO order_history (
           id, store_id, order_id, status, action, source, from_status,
           actor_id, contract_version, assignee_user_id, created_at
         ) SELECT printf('hist_perf_%05d',n), 'store_nexus', printf('ord_perf_%05d',n*50),
                  'pending', 'assigned', 'user', 'pending', ?, 2, ?,
                  printf('2026-09-12T01:%02d:%02d.000Z',(n/60)%60,n%60)
             FROM seq`,
      ).bind(owner.userId, staff.userId),
      env.DB.prepare(
        `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<200)
         INSERT INTO order_assignments (
           store_id, order_id, assignee_user_id, assigned_by_user_id, history_id, assigned_at
         ) SELECT 'store_nexus', printf('ord_perf_%05d',n*50), ?, ?, printf('hist_perf_%05d',n),
                  printf('2026-09-12T01:%02d:%02d.000Z',(n/60)%60,n%60)
             FROM seq`,
      ).bind(staff.userId, owner.userId),
    ]);

    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT orders.id FROM orders
        WHERE orders.store_id='store_nexus'
          AND orders.id IN (
            SELECT assignment.order_id FROM order_assignments assignment
             WHERE assignment.store_id='store_nexus' AND assignment.assignee_user_id=?
          ) ORDER BY orders.created_at DESC, orders.id DESC LIMIT 26`,
    ).bind(staff.userId).all<{ detail: string }>();
    expect(plan.results.map((row) => row.detail).join('\n')).toContain('order_assignments_assignee_order_idx');

    const staffVisibility = `orders.store_id = ?
      AND orders.id IN (SELECT order_id FROM order_assignments WHERE store_id = ? AND assignee_user_id = ?)`;
    const ownerVisibility = `orders.store_id = ?`;
    const rawMeasurements = {
      list: {
        staff: await measure(env.DB.prepare(
          `SELECT orders.id FROM orders WHERE ${staffVisibility}
           ORDER BY orders.created_at DESC, orders.id DESC LIMIT 26`,
        ).bind(staff.storeId, staff.storeId, staff.userId)),
        owner: await measure(env.DB.prepare(
          `SELECT orders.id FROM orders WHERE ${ownerVisibility}
           ORDER BY orders.created_at DESC, orders.id DESC LIMIT 26`,
        ).bind(owner.storeId)),
      },
      search: {
        staff: await measure(env.DB.prepare(
          `SELECT orders.id FROM orders WHERE ${staffVisibility}
             AND instr(lower(orders.customer_name), lower(?)) > 0
           ORDER BY orders.created_at DESC, orders.id DESC LIMIT 26`,
        ).bind(staff.storeId, staff.storeId, staff.userId, 'Performance Buyer')),
        owner: await measure(env.DB.prepare(
          `SELECT orders.id FROM orders WHERE ${ownerVisibility}
             AND instr(lower(orders.customer_name), lower(?)) > 0
           ORDER BY orders.created_at DESC, orders.id DESC LIMIT 26`,
        ).bind(owner.storeId, 'Performance Buyer')),
      },
      summary: {
        staff: await measure(env.DB.prepare(
          `SELECT count(*) FROM orders WHERE ${staffVisibility}`,
        ).bind(staff.storeId, staff.storeId, staff.userId)),
        owner: await measure(env.DB.prepare(
          `SELECT count(*) FROM orders WHERE ${ownerVisibility}`,
        ).bind(owner.storeId)),
      },
    };

    const query = { q: '', status: null, refund: null, limit: 25, cursor: null } as const;
    const staffSamples: number[] = [];
    const ownerSamples: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      let started = performance.now();
      const staffResult = await listConsoleOrders(env.DB, {
        storeId: staff.storeId, actor: { source: 'user', id: staff.userId }, identity: staff,
      }, query);
      staffSamples.push(performance.now() - started);
      expect(staffResult.summary.totalOrders).toBe(200);
      started = performance.now();
      const ownerResult = await listConsoleOrders(env.DB, {
        storeId: owner.storeId, actor: { source: 'user', id: owner.userId }, identity: owner,
      }, query);
      ownerSamples.push(performance.now() - started);
      expect(ownerResult.summary.totalOrders).toBe(10000);
    }
    console.info('Phase 5 sparse query measurement', JSON.stringify({
      runtime: 'workerd', datasetOrders: 10000, assignedOrders: 200,
      samples: 20, staffP95Ms: p95(staffSamples), ownerP95Ms: p95(ownerSamples),
      rawMeasurements,
    }));
  }, 20_000);
});
