import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionConsoleApp } from '../../src/console/production-console-app';
import { OrdersScreen, type OrdersScreenProps } from '../../src/console/orders/orders-screen';
import type { ConsoleOrderDetailView, ConsoleOrderSummary, ConsoleOrderView } from '../../src/console/orders/order-ui-types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const emptySummary: ConsoleOrderSummary = {
  totalOrders: 0,
  byStatus: { pending: 0, paid: 0, fulfilled: 0, canceled: 0 },
  openRefundRequests: 0,
};

function listResponse(orders: ConsoleOrderView[], extra: Partial<{ summary: ConsoleOrderSummary; nextCursor: string | null; hasOrders: boolean }> = {}) {
  return {
    orders,
    summary: extra.summary ?? {
      ...emptySummary,
      totalOrders: orders.length,
      byStatus: { ...emptySummary.byStatus, pending: orders.filter((order) => order.status === 'pending').length },
    },
    nextCursor: extra.nextCursor ?? null,
    hasOrders: extra.hasOrders ?? true,
  };
}

const simpleItem = {
  id: 'line_1',
  position: 0,
  product: { id: 'prod_simple1234', name: 'Field Notes', variant: null },
  quantity: 2,
  unitPriceMinor: 2400,
  lineTotalMinor: 4800,
  currency: 'USD',
};

const safeOrder: ConsoleOrderView = {
  reference: 'NX-260827-ABCD1234',
  paymentReference: 'NPABCDEF12345678',
  status: 'pending',
  items: [simpleItem],
  customer: { name: 'Ada Rivera', email: 'ada@example.com' },
  totalMinor: 4701,
  currency: 'USD',
  createdAt: '2026-08-27T12:00:00.000Z',
  refundRequestStatus: null,
};

const otherOrder: ConsoleOrderView = {
  ...safeOrder,
  reference: 'NX-260827-FFFF0000',
  paymentReference: 'NPFFFF0000111111',
  customer: { name: 'Bea Nguyen', email: 'bea@example.com' },
  items: [{ ...simpleItem, id: 'line_other', product: { ...simpleItem.product, name: 'Other Notes' } }],
};

const createdHistory = {
  action: 'order_created' as const,
  source: 'storefront' as const,
  actorId: 'cust_1',
  actorLabel: 'Customer',
  contractVersion: 2 as const,
  fromStatus: null,
  toStatus: 'pending' as const,
  createdAt: '2026-08-27T12:00:00.000Z',
};

const pendingDetail: ConsoleOrderDetailView = {
  ...safeOrder,
  allowedActions: ['mark_paid', 'cancel'],
  refundRequest: null,
  history: [createdHistory],
  payment: null,
  paymentRecordState: 'none',
};

const zeroDetail: ConsoleOrderDetailView = {
  ...pendingDetail,
  reference: 'NX-260827-00000000',
  paymentReference: 'NP00000000000000',
  items: [{ ...simpleItem, quantity: 1, unitPriceMinor: 0, lineTotalMinor: 0 }],
  totalMinor: 0,
};

const paidDetail: ConsoleOrderDetailView = {
  ...pendingDetail,
  status: 'paid',
  allowedActions: ['fulfill', 'request_refund'],
  paymentRecordState: 'recorded',
  payment: {
    id: 'pay_1',
    source: 'manual',
    method: 'Bank transfer',
    externalReference: 'WIRE-1',
    amountMinor: 4701,
    currency: 'USD',
    status: 'succeeded',
    recordedAt: '2026-08-27T12:05:00.000Z',
  },
  history: [
    createdHistory,
    {
      action: 'order_paid',
      source: 'bootstrap_owner',
      actorId: null,
      actorLabel: 'Bootstrap Owner (demo)',
      contractVersion: 2,
      fromStatus: 'pending',
      toStatus: 'paid',
      createdAt: '2026-08-27T12:05:00.000Z',
    },
  ],
};

const screenDefaults: Omit<OrdersScreenProps, 'state' | 'orders'> = {
  summary: emptySummary,
  searchDraft: '',
  statusFilter: 'all',
  refundPendingOnly: false,
  contractOutdated: false,
  hasPreviousPage: false,
  hasNextPage: false,
  pageIndex: 0,
  onSearchDraftChange: () => undefined,
  onSearchSubmit: () => undefined,
  onStatusFilterChange: () => undefined,
  onRefundPendingOnlyChange: () => undefined,
  onRetry: () => undefined,
  onReload: () => undefined,
  onClearFilters: () => undefined,
  onFirstPage: () => undefined,
  onPreviousPage: () => undefined,
  onNextPage: () => undefined,
  onOpenOrder: () => undefined,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(status: number, code: string, message: string): Response {
  return response({ error: { code, message, fields: [], incidentId: null } }, status);
}

function requestUrl(input: RequestInfo | URL): URL {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, 'http://console.local');
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error('Timed out waiting for Console Order UI.');
}

function buttonByName(name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === name);
}

function paymentAck(): HTMLInputElement | undefined {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((input) => (
    (input.closest('label')?.textContent ?? '').includes('external receipt')
    || (input.closest('label')?.textContent ?? '').includes('zero-total')
  ));
}

function stubConsoleFetch(handler: (url: URL, init?: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(requestUrl(input), init)));
}

async function renderApp() {
  await act(async () => { root.render(createElement(ProductionConsoleApp)); });
}

async function openMarkPaidPanel() {
  await waitUntil(() => Boolean(buttonByName('Record manual payment')));
  await act(async () => { buttonByName('Record manual payment')?.click(); });
  await waitUntil(() => Boolean(buttonByName('Mark Paid')));
}

async function confirmMarkPaid() {
  const method = container.querySelector<HTMLInputElement>('#payment-method');
  const reference = container.querySelector<HTMLInputElement>('#payment-reference');
  if (!method || !reference) throw new Error('missing payment fields');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(method, 'Bank transfer');
    method.dispatchEvent(new Event('input', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(reference, 'WIRE-1');
    reference.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const checkbox = paymentAck();
  if (!checkbox) throw new Error('missing checkbox');
  await act(async () => { checkbox.click(); });
  await act(async () => { buttonByName('Mark Paid')?.click(); });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/console/orders');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await act(async () => root.unmount());
  container.remove();
});

describe('Console Order contracts', () => {
  it('renders all safe fields in desktop and compact structures without internal content', async () => {
    const unsafe = { ...safeOrder, capability: 'opaque-secret', privateFileKey: 'private-file', accessInstructions: 'internal delivery' };
    await act(async () => root.render(createElement(OrdersScreen, { ...screenDefaults, state: 'ready', orders: [unsafe] })));
    expect(container.querySelector('.orders-table')?.textContent).toContain(safeOrder.reference);
    expect(container.querySelector('.orders-table')?.textContent).toContain('NPABCDEF12345678');
    expect(container.querySelector('.order-list-mobile')?.textContent).toContain('ada@example.com');
    expect(container.querySelector('.order-list-mobile')?.textContent).toContain('$47.01');
    expect(container.querySelector('.orders-table')?.textContent).not.toContain('$24.00');
    expect(container.textContent).not.toContain('opaque-secret');
    expect(container.textContent).not.toContain('private-file');
    expect(container.textContent).not.toContain('internal delivery');
  });

  it('provides durable loading, empty, no-results, and error regions', async () => {
    await act(async () => root.render(createElement(OrdersScreen, { ...screenDefaults, state: 'loading', orders: [], summary: null })));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Matching Orders');
    await act(async () => root.render(createElement(OrdersScreen, { ...screenDefaults, state: 'empty', orders: [] })));
    expect(container.textContent).toContain('No Orders have been placed.');
    await act(async () => root.render(createElement(OrdersScreen, { ...screenDefaults, state: 'no-results', orders: [] })));
    expect(container.textContent).toContain('No Orders match these filters.');
    const retry = vi.fn();
    await act(async () => root.render(createElement(OrdersScreen, { ...screenDefaults, state: 'error', orders: [], summary: null, onRetry: retry })));
    expect(container.textContent).not.toContain('Matching Orders');
    await act(async () => buttonByName('Retry loading Orders')?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it('supports direct Orders URLs, destination navigation, and popstate restoration', async () => {
    stubConsoleFetch(async (url) => {
      if (url.pathname === '/api/console/orders') return response(listResponse([safeOrder]));
      if (url.pathname.startsWith('/api/console/products')) return response({ products: [] });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    await renderApp();
    await waitUntil(() => container.querySelector('h1')?.textContent === 'Orders');
    expect(container.querySelector('.console-nav [aria-current="page"]')?.textContent).toContain('Orders');
    const products = Array.from(container.querySelectorAll<HTMLButtonElement>('.console-nav button')).find((button) => button.textContent?.trim() === 'Products');
    await act(async () => { products?.click(); await flush(); });
    expect(window.location.pathname).toBe('/console/products');
    expect(container.querySelector('h1')?.textContent).toBe('Products');
    window.history.pushState({}, '', '/console/orders');
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); await flush(); });
    await waitUntil(() => container.querySelector('h1')?.textContent === 'Orders');
  });

  it('keeps malformed Order detail URLs on Orders instead of Products', async () => {
    window.history.replaceState({}, '', '/console/orders/not-a-reference');
    stubConsoleFetch(async (url) => {
      if (url.pathname === '/api/console/orders/not-a-reference') return errorResponse(404, 'not_found', 'Order not found.');
      if (url.pathname === '/api/console/orders') return response(listResponse([], { hasOrders: true }));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    await renderApp();
    await waitUntil(() => (container.textContent ?? '').includes('Order not found'));
    expect(container.querySelector('.console-nav [aria-current="page"]')?.textContent).toContain('Orders');
    expect(container.querySelector('h1')?.textContent).not.toBe('Products');
  });

  it('loads Order detail from a direct URL, reload-equivalent remount, and popstate', async () => {
    stubConsoleFetch(async (url) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}`) return response({ order: pendingDetail });
      if (url.pathname === '/api/console/orders') return response(listResponse([safeOrder]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await waitUntil(() => container.querySelector('h1')?.textContent === pendingDetail.reference);
    expect(container.textContent).toContain('Ada Rivera');
    expect(container.textContent).toContain('Field Notes');
    expect(container.textContent).toContain('NPABCDEF12345678');
    await act(async () => { buttonByName('Back to Orders')?.click(); });
    await waitUntil(() => container.querySelector('h1')?.textContent === 'Orders');
    expect(window.location.pathname).toBe('/console/orders');
    window.history.pushState({}, '', `/console/orders/${pendingDetail.reference}`);
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitUntil(() => container.querySelector('h1')?.textContent === pendingDetail.reference);
  });

  it('submits trimmed raw search and applies status and refund filters immediately', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.pathname === '/api/console/orders') return response(listResponse([safeOrder]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderApp();
    await waitUntil(() => Boolean(container.querySelector('#order-search')));
    const search = container.querySelector<HTMLInputElement>('#order-search');
    if (!search) throw new Error('missing search');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, '  ＡＢ１２  ');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(fetchMock.mock.calls.filter((call) => requestUrl(call[0] as RequestInfo | URL).pathname === '/api/console/orders')).toHaveLength(1);
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitUntil(() => fetchMock.mock.calls.some((call) => requestUrl(call[0] as RequestInfo | URL).searchParams.get('q') === 'ＡＢ１２'));
    const paidTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.trim() === 'Paid');
    await act(async () => { paidTab?.click(); });
    await waitUntil(() => fetchMock.mock.calls.some((call) => requestUrl(call[0] as RequestInfo | URL).searchParams.get('status') === 'paid'));
    const refund = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((input) => (
      input.closest('label')?.textContent?.includes('Pending refund requests')
    ));
    await act(async () => { refund?.click(); });
    await waitUntil(() => fetchMock.mock.calls.some((call) => requestUrl(call[0] as RequestInfo | URL).searchParams.get('refund') === 'pending'));
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers as HeadersInit).get('X-Nexus-Order-Contract')).toBe('2');
  });

  it('uses the same Mark Paid panel for a zero-total Order without claiming a bank transfer', async () => {
    stubConsoleFetch(async (url) => {
      if (url.pathname === `/api/console/orders/${zeroDetail.reference}`) return response({ order: zeroDetail });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${zeroDetail.reference}`);
    await renderApp();
    await openMarkPaidPanel();
    expect(container.textContent).toContain('does not claim a bank transfer');
    expect(container.textContent).toContain('USD');
    expect(buttonByName('Mark Paid')?.disabled).toBe(true);
    await act(async () => { paymentAck()?.click(); });
    expect(buttonByName('Mark Paid')?.disabled).toBe(false);
  });

  it('does not paint a stale Order after navigating to another reference', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    stubConsoleFetch(async (url) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}`) {
        await firstGate;
        return response({ order: pendingDetail });
      }
      if (url.pathname === `/api/console/orders/${otherOrder.reference}`) {
        return response({ order: { ...pendingDetail, ...otherOrder } });
      }
      if (url.pathname === '/api/console/orders') return response(listResponse([safeOrder, otherOrder]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    window.history.pushState({}, '', `/console/orders/${otherOrder.reference}`);
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
    releaseFirst?.();
    await waitUntil(() => container.querySelector('h1')?.textContent === otherOrder.reference);
    expect(container.textContent).toContain('Bea Nguyen');
    expect(container.textContent).not.toContain('Ada Rivera');
  });

  it('does not apply a late Mark Paid of Order A onto Order B', async () => {
    let releasePaid: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releasePaid = resolve; });
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        return response({ order: pendingDetail });
      }
      if (url.pathname === `/api/console/orders/${otherOrder.reference}` && (!init || !init.method || init.method === 'GET')) {
        return response({ order: { ...pendingDetail, ...otherOrder } });
      }
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}/payments/manual`) {
        await gate;
        return response({
          reference: pendingDetail.reference,
          action: 'mark_paid',
          status: 'paid',
          occurredAt: '2026-08-27T12:05:00.000Z',
          paymentId: 'pay_1',
          refundRequest: null,
        });
      }
      if (url.pathname === '/api/console/orders') return response(listResponse([safeOrder, otherOrder]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await openMarkPaidPanel();
    await confirmMarkPaid();
    window.history.pushState({}, '', `/console/orders/${otherOrder.reference}`);
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitUntil(() => container.querySelector('h1')?.textContent === otherOrder.reference);
    releasePaid?.();
    await flush();
    await flush();
    expect(container.querySelector('h1')?.textContent).toBe(otherOrder.reference);
    expect(container.textContent).toContain('Bea Nguyen');
    expect(container.textContent).not.toContain('Ada Rivera');
    expect(container.textContent).toContain('Pending');
    expect(container.textContent).not.toContain('The outcome is not confirmed');
    expect(container.textContent).not.toContain('The action succeeded, but the latest Order could not be loaded.');
  });

  it('retries Mark Paid with the same key and frozen method/reference after an unknown outcome', async () => {
    const keys: string[] = [];
    const bodies: string[] = [];
    let posts = 0;
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        return response({ order: pendingDetail });
      }
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}/payments/manual`) {
        posts += 1;
        keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        bodies.push(String(init?.body ?? ''));
        expect(new Headers(init?.headers).get('X-Nexus-Order-Contract')).toBe('2');
        expect(new Headers(init?.headers).get('If-Match')).toBeNull();
        if (posts === 1) return errorResponse(503, 'order_operation_failed', 'The Order operation could not be completed.');
        return response({
          reference: pendingDetail.reference,
          action: 'mark_paid',
          status: 'paid',
          occurredAt: '2026-08-27T12:05:00.000Z',
          paymentId: 'pay_1',
          refundRequest: null,
        });
      }
      if (url.pathname === '/api/console/orders') return response(listResponse([]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await openMarkPaidPanel();
    await confirmMarkPaid();
    await waitUntil(() => (container.textContent ?? '').includes('The outcome is not confirmed. Retry the same action.'));
    expect(buttonByName('Cancel')?.closest('.inline-actions')?.getAttribute('style')).toContain('display: none');
    expect(container.querySelector<HTMLInputElement>('#payment-method')?.disabled).toBe(true);
    await act(async () => { buttonByName('Retry Mark Paid')?.click(); });
    await waitUntil(() => keys.length === 2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]?.length).toBeGreaterThanOrEqual(16);
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).toBe(JSON.stringify({ method: 'Bank transfer', reference: 'WIRE-1' }));
  });

  it('shows conflict copy and refetches after a stale opposing action', async () => {
    let detail = pendingDetail;
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        return response({ order: detail });
      }
      if (url.pathname.endsWith('/cancel')) {
        detail = paidDetail;
        return errorResponse(409, 'order_state_conflict', 'The Order state does not allow this action.');
      }
      if (url.pathname === '/api/console/orders') return response(listResponse([]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await waitUntil(() => Boolean(buttonByName('Cancel')));
    await act(async () => { buttonByName('Cancel')?.click(); });
    await waitUntil(() => Boolean(buttonByName('Confirm Cancel')));
    await act(async () => { buttonByName('Confirm Cancel')?.click(); });
    await waitUntil(() => (container.textContent ?? '').includes('The action was not applied. The Order has changed.'));
    await waitUntil(() => Boolean(buttonByName('Fulfill')));
    expect(container.textContent).toContain('Paid');
    expect(buttonByName('Cancel')).toBeUndefined();
    expect(buttonByName('Fulfill')).not.toBeUndefined();
  });

  it('keeps the write acknowledgement when follow-up GET fails', async () => {
    let getCount = 0;
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        getCount += 1;
        if (getCount === 1) return response({ order: pendingDetail });
        return errorResponse(500, 'order_operation_failed', 'The Order operation could not be completed.');
      }
      if (url.pathname.endsWith('/payments/manual')) {
        return response({
          reference: pendingDetail.reference,
          action: 'mark_paid',
          status: 'paid',
          occurredAt: '2026-08-27T12:05:00.000Z',
          paymentId: 'pay_1',
          refundRequest: null,
        });
      }
      if (url.pathname === '/api/console/orders') return response(listResponse([]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await openMarkPaidPanel();
    await confirmMarkPaid();
    await waitUntil(() => (container.textContent ?? '').includes('The action succeeded, but the latest Order could not be loaded.'));
    expect(container.textContent).toContain('Retry loading Order');
    expect(container.textContent).not.toContain('The outcome is not confirmed');
  });

  it('does not apply optimistic status before the server response', async () => {
    let releasePaid: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releasePaid = resolve; });
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        return response({ order: pendingDetail });
      }
      if (url.pathname.endsWith('/payments/manual')) {
        await gate;
        return response({
          reference: pendingDetail.reference,
          action: 'mark_paid',
          status: 'paid',
          occurredAt: '2026-08-27T12:05:00.000Z',
          paymentId: 'pay_1',
          refundRequest: null,
        });
      }
      if (url.pathname === '/api/console/orders') return response(listResponse([]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await openMarkPaidPanel();
    await confirmMarkPaid();
    expect(container.querySelector('.status-tag')?.textContent).toBe('Pending');
    expect(container.querySelector('.page-actions .status-tag')?.textContent).not.toBe('Paid');
    releasePaid?.();
    await flush();
  });

  it('describes pending payment and Cancel only while the Order is pending', async () => {
    stubConsoleFetch(async (url) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}`) return response({ order: pendingDetail });
      if (url.pathname === '/api/console/orders') return response(listResponse([safeOrder]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await waitUntil(() => Boolean(buttonByName('Record manual payment')));
    expect(container.textContent).toContain('Record a manual payment or Cancel only while the Order is still pending.');
  });

  it('refreshes a hidden Console detail and drops stale payment actions', async () => {
    let gets = 0;
    stubConsoleFetch(async (url) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}`) {
        gets += 1;
        return response({ order: gets === 1 ? pendingDetail : paidDetail });
      }
      if (url.pathname === '/api/console/orders') return response(listResponse([safeOrder]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await waitUntil(() => Boolean(buttonByName('Record manual payment')));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitUntil(() => buttonByName('Record manual payment') == null);
    expect(container.textContent).toContain('This Order is paid.');
    expect(buttonByName('Fulfill')).not.toBeUndefined();
  });

  it('ignores a deferred pre-write GET that resolves after Mark Paid', async () => {
    let gets = 0;
    let releaseStale: (() => void) | undefined;
    const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        gets += 1;
        if (gets === 2) {
          await staleGate;
          return response({ order: pendingDetail });
        }
        return response({ order: gets === 1 ? pendingDetail : paidDetail });
      }
      if (url.pathname.endsWith('/payments/manual')) {
        return response({
          reference: pendingDetail.reference,
          action: 'mark_paid',
          status: 'paid',
          occurredAt: '2026-08-27T12:05:00.000Z',
          paymentId: 'pay_1',
          refundRequest: null,
        });
      }
      if (url.pathname === '/api/console/orders') return response(listResponse([safeOrder]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await waitUntil(() => Boolean(buttonByName('Record manual payment')));
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitUntil(() => gets >= 2);
    await openMarkPaidPanel();
    await confirmMarkPaid();
    await waitUntil(() => (container.textContent ?? '').includes('This Order is paid.'));
    releaseStale?.();
    await flush();
    await flush();
    expect(buttonByName('Record manual payment')).toBeUndefined();
    expect(container.textContent).toContain('Paid');
  });

  it('shows reload guidance for an outdated contract and does not retry the mutation', async () => {
    const posts: string[] = [];
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        return response({ order: pendingDetail });
      }
      if (url.pathname.endsWith('/payments/manual')) {
        posts.push(String(init?.body ?? ''));
        return errorResponse(409, 'client_contract_outdated', 'This client is out of date. Reload the page and try again.');
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await openMarkPaidPanel();
    await confirmMarkPaid();
    await waitUntil(() => (container.textContent ?? '').includes('This Console is out of date'));
    expect(buttonByName('Mark Paid')).toBeUndefined();
    expect(buttonByName('Retry Mark Paid')).toBeUndefined();
    expect(posts).toHaveLength(1);
  });

  it('closes an open Mark Paid panel when refresh drops the action', async () => {
    let gets = 0;
    stubConsoleFetch(async (url) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}`) {
        gets += 1;
        return response({ order: gets === 1 ? pendingDetail : paidDetail });
      }
      if (url.pathname === '/api/console/orders') return response(listResponse([safeOrder]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await openMarkPaidPanel();
    expect(container.querySelector('#mark-paid-title')).not.toBeNull();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitUntil(() => container.querySelector('#mark-paid-title') == null);
    expect(buttonByName('Mark Paid')).toBeUndefined();
    expect(buttonByName('Record manual payment')).toBeUndefined();
    expect(buttonByName('Fulfill')).not.toBeUndefined();
  });

  it('closes the open panel on GET contract-outdated and does not POST', async () => {
    const posts: string[] = [];
    let gets = 0;
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        gets += 1;
        if (gets === 1) return response({ order: pendingDetail });
        return errorResponse(409, 'client_contract_outdated', 'This client is out of date. Reload the page and try again.');
      }
      if (url.pathname.endsWith('/payments/manual') || url.pathname.endsWith('/fulfill') || url.pathname.endsWith('/cancel')) {
        posts.push(url.pathname);
        return errorResponse(409, 'client_contract_outdated', 'This client is out of date. Reload the page and try again.');
      }
      if (url.pathname === '/api/console/orders') return response(listResponse([safeOrder]));
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await openMarkPaidPanel();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitUntil(() => (container.textContent ?? '').includes('This Console is out of date'));
    expect(container.querySelector('#mark-paid-title')).toBeNull();
    expect(buttonByName('Mark Paid')).toBeUndefined();
    expect(buttonByName('Confirm Fulfill')).toBeUndefined();
    expect(buttonByName('Confirm Cancel')).toBeUndefined();
    await act(async () => { buttonByName('Fulfill')?.click(); buttonByName('Cancel')?.click(); });
    expect(posts).toHaveLength(0);
  });

  it('shows cursor range at top and bottom without numbered random access', async () => {
    const previous = vi.fn();
    const next = vi.fn();
    const orders = Array.from({ length: 5 }, (_, index) => ({
      ...safeOrder,
      reference: `NX-260827-PAGE2${index}`,
      paymentReference: `NPPAGE2${index}00000000`.slice(0, 16),
    }));
    await act(async () => root.render(createElement(OrdersScreen, {
      ...screenDefaults,
      state: 'ready',
      orders,
      summary: { ...emptySummary, totalOrders: 30 },
      pageIndex: 1,
      hasPreviousPage: true,
      hasNextPage: false,
      onPreviousPage: previous,
      onNextPage: next,
    })));
    const top = container.querySelector('[aria-label="Order pages top"]');
    const bottom = container.querySelector('[aria-label="Order pages bottom"]');
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
    expect(top?.textContent).toContain('Showing 26–30 of 30');
    expect(top?.textContent).toContain('Page 2 of 2');
    expect(bottom?.textContent).toContain('Showing 26–30 of 30');
    expect(container.querySelector('[aria-label="Order pages"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('button')).filter((button) => /^\d+$/.test(button.textContent?.trim() ?? ''))).toHaveLength(0);
    const matching = Array.from(container.querySelectorAll('.metric-card')).find((card) => card.textContent?.includes('Matching Orders'));
    expect(matching?.textContent).toContain('30');
    const topPrevious = Array.from(top?.querySelectorAll('button') ?? []).find((button) => button.textContent?.trim() === 'Previous');
    const topNext = Array.from(top?.querySelectorAll('button') ?? []).find((button) => button.textContent?.trim() === 'Next');
    expect(topPrevious?.disabled).toBe(false);
    expect(topNext?.disabled).toBe(true);
    await act(async () => { topPrevious?.click(); });
    expect(previous).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    const bottomNext = Array.from(bottom?.querySelectorAll('button') ?? []).find((button) => button.textContent?.trim() === 'Next');
    await act(async () => { bottomNext?.click(); });
    expect(next).not.toHaveBeenCalled();
  });
});
