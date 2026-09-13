import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionConsoleApp } from '../../apps/console/src/production-console-app';
import { OrderDetailScreen } from '../../apps/console/src/orders/order-detail-screen';

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

const detailB = {
  ...detail,
  reference: 'NX-REFUND-02',
  paymentReference: 'NP-02',
  refundRequest: { id: 'rrq_22222222222222222222222222222222', status: 'pending', reason: 'Wrong item', createdAt: '2026-09-12T00:00:00.000Z', decidedAt: null, decidedByUserId: null },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function fail(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message, fields: [], incidentId: null } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://console.local').pathname;
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
}

function buttonByName(name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === name);
}

async function renderDetail(reference: string, routeGeneration: number, canAssign = false) {
  await act(async () => {
    root.render(createElement(OrderDetailScreen, {
      reference,
      routeGeneration,
      canAssign,
      onInvalidateList: () => undefined,
      onBack: () => undefined,
    }));
  });
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
      const path = pathOf(input);
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

  it('re-enables role controls on the next Order after navigating away from a pending refund decision', async () => {
    let releaseDecision = () => {};
    const decision = new Promise<void>((resolve) => { releaseDecision = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path.endsWith('/approve')) {
        await decision;
        return json({ action: 'approve_refund', reference: detail.reference, status: 'paid', occurredAt: '2026-09-12T01:00:00.000Z', paymentId: null, refundRequest: { ...detail.refundRequest, status: 'approved', decidedAt: '2026-09-12T01:00:00.000Z' } });
      }
      if (path === `/api/console/orders/${detailB.reference}`) return json({ order: detailB });
      if (path === `/api/console/orders/${detail.reference}`) return json({ order: detail });
      return json({});
    }));

    await renderDetail(detail.reference, 1);
    await waitUntil(() => Boolean(buttonByName('Approve refund')));
    await act(async () => { buttonByName('Approve refund')?.click(); });
    expect(buttonByName('Approve refund')?.disabled).toBe(true);

    await renderDetail(detailB.reference, 2);
    await waitUntil(() => container.querySelector('h1')?.textContent === detailB.reference);
    expect(buttonByName('Approve refund')?.disabled).toBe(false);
    expect(buttonByName('Reject refund')?.disabled).toBe(false);

    releaseDecision();
    await flush();
    await flush();
    expect(buttonByName('Approve refund')?.disabled).toBe(false);
    expect(container.textContent).not.toContain('The action succeeded');
    expect(container.querySelector('h1')?.textContent).toBe(detailB.reference);
  });

  it('keeps a definitive refund decision failure visible when the follow-up read also fails', async () => {
    let gets = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path.endsWith('/approve')) return fail(422, 'refund_request_not_pending', 'This refund request was already decided.');
      if (path === `/api/console/orders/${detail.reference}`) {
        gets += 1;
        return gets === 1 ? json({ order: detail }) : fail(503, 'upstream_unavailable', 'The Order could not be read.');
      }
      return json({});
    }));

    await renderDetail(detail.reference, 1);
    await waitUntil(() => Boolean(buttonByName('Approve refund')));
    await act(async () => { buttonByName('Approve refund')?.click(); });
    await waitUntil(() => gets >= 2);

    expect(container.textContent).toContain('This refund request was already decided.');
    expect(container.textContent).not.toContain('The action succeeded, but the latest Order could not be loaded.');
  });

  it('keeps a definitive assignment failure visible when the follow-up read also fails', async () => {
    let gets = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path === '/api/console/staff') return json({ staff: [{ userId: 'staff_1', name: 'Staff One' }, { userId: 'staff_2', name: 'Staff Two' }] });
      if (path.endsWith('/assignment')) return fail(409, 'order_assignment_conflict', 'The Order was assigned by someone else.');
      if (path === `/api/console/orders/${detail.reference}`) {
        gets += 1;
        return gets === 1 ? json({ order: detail }) : fail(503, 'upstream_unavailable', 'The Order could not be read.');
      }
      return json({});
    }));

    await renderDetail(detail.reference, 1, true);
    await waitUntil(() => Boolean(container.querySelector('select[aria-label="Assign Order"]')));
    const select = container.querySelector('select[aria-label="Assign Order"]') as HTMLSelectElement | null;
    if (!select) throw new Error('missing assignment select');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, 'staff_2');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { buttonByName('Assign')?.click(); });
    await waitUntil(() => gets >= 2);

    expect(container.textContent).toContain('The Order was assigned by someone else.');
    expect(container.textContent).not.toContain('The action succeeded, but the latest Order could not be loaded.');
    expect(buttonByName('Assign')?.disabled).toBe(false);
  });

  it('requires a reload when a failed command is followed by an outdated-client read', async () => {
    let gets = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path.endsWith('/approve')) return fail(422, 'refund_request_not_pending', 'This refund request was already decided.');
      if (path === `/api/console/orders/${detail.reference}`) {
        gets += 1;
        return gets === 1 ? json({ order: detail }) : fail(409, 'client_contract_outdated', 'Reload the Console.');
      }
      return json({});
    }));

    await renderDetail(detail.reference, 1);
    await waitUntil(() => Boolean(buttonByName('Approve refund')));
    await act(async () => { buttonByName('Approve refund')?.click(); });
    await waitUntil(() => (container.textContent ?? '').includes('This Console is out of date.'));

    expect(container.textContent).toContain('Reload the page and try again.');
    expect(container.textContent).toContain('This refund request was already decided.');
  });

  it('still acknowledges a successful refund decision whose follow-up read fails', async () => {
    let gets = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path.endsWith('/approve')) return json({ action: 'approve_refund', reference: detail.reference, status: 'paid', occurredAt: '2026-09-12T01:00:00.000Z', paymentId: null, refundRequest: { ...detail.refundRequest, status: 'approved', decidedAt: '2026-09-12T01:00:00.000Z' } });
      if (path === `/api/console/orders/${detail.reference}`) {
        gets += 1;
        return gets === 1 ? json({ order: detail }) : fail(503, 'upstream_unavailable', 'The Order could not be read.');
      }
      return json({});
    }));

    await renderDetail(detail.reference, 1);
    await waitUntil(() => Boolean(buttonByName('Approve refund')));
    await act(async () => { buttonByName('Approve refund')?.click(); });
    await waitUntil(() => (container.textContent ?? '').includes('The action succeeded, but the latest Order could not be loaded.'));

    expect(container.textContent).toContain('The action succeeded, but the latest Order could not be loaded.');
  });
});
