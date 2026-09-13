import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionConsoleApp } from '../../apps/console/src/production-console-app';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;

const detail = {
  reference: 'NX-REFUND-01', paymentReference: 'NP-01', status: 'paid',
  items: [], customer: { name: 'Customer', email: 'customer@example.test' },
  totalMinor: 1200, currency: 'USD', createdAt: '2026-09-12T00:00:00.000Z',
  refundRequestStatus: 'pending',
  refundRequest: { id: 'rrq_11111111111111111111111111111111', status: 'pending', reason: 'Duplicate', createdAt: '2026-09-12T00:00:00.000Z', decidedAt: null, decidedByUserId: null },
  assignment: { assigneeUserId: 'staff_1' },
  allowedActions: ['approve_refund', 'reject_refund'], history: [], payment: null, paymentRecordState: 'none',
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/console/orders/NX-REFUND-01');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  container.remove();
});

describe('Console role-aware Order controls', () => {
  it('lets an Owner reassign and make a final refund decision from server-provided actions', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://console.local').pathname;
      calls.push(path);
      if (path === '/api/console/session') return json({ user: { id: 'owner_1', name: 'Owner One' }, store: { id: 'store_nexus', name: 'Store A' }, role: 'owner', allowedActions: ['catalog:read', 'order:read', 'order:assign', 'staff:list', 'refund:decide'] });
      if (path === '/api/console/staff') return json({ staff: [{ userId: 'staff_1', name: 'Staff One' }, { userId: 'staff_2', name: 'Staff Two' }] });
      if (path.endsWith('/assignment')) return json({ action: 'assign', reference: detail.reference, status: 'paid', occurredAt: '2026-09-12T01:00:00.000Z', paymentId: null, refundRequest: null, assignment: { assigneeUserId: 'staff_2', eventId: 'event_2' } });
      if (path.endsWith('/approve')) return json({ action: 'approve_refund', reference: detail.reference, status: 'paid', occurredAt: '2026-09-12T01:00:00.000Z', paymentId: null, refundRequest: { ...detail.refundRequest, status: 'approved', decidedAt: '2026-09-12T01:00:00.000Z' } });
      if (path === `/api/console/orders/${detail.reference}`) return json({ order: detail });
      return json({});
    }));

    await act(async () => root.render(createElement(ProductionConsoleApp)));
    for (let i = 0; i < 20 && !container.querySelector('select[aria-label="Assign Order"]'); i += 1) await flush();
    const select = container.querySelector('select[aria-label="Assign Order"]') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.value).toBe('staff_1');
    expect(container.textContent).toContain('Staff Two');
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Approve refund')).toBe(true);
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Reject refund')).toBe(true);
    expect(calls).toContain('/api/console/staff');
  });
});
