import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionConsoleApp } from '../../src/console/production-console-app';
import { OrdersScreen, type OrdersScreenProps } from '../../src/console/orders/orders-screen';
import type { ConsoleOrderDetailView, ConsoleOrderView } from '../../src/console/orders/order-ui-types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const safeOrder: ConsoleOrderView = {
  reference: 'NX-260827-ABCD1234',
  status: 'pending_payment',
  product: { id: 'prod_simple1234', name: 'Field Notes', variant: null },
  customer: { name: 'Ada Rivera', email: 'ada@example.com' },
  quantity: 2,
  unitPriceMinor: 2400,
  totalMinor: 4701,
  currency: 'USD',
  createdAt: '2026-08-27T12:00:00.000Z',
  refundRequestStatus: null,
};

const otherOrder: ConsoleOrderView = {
  ...safeOrder,
  reference: 'NX-260827-FFFF0000',
  customer: { name: 'Bea Nguyen', email: 'bea@example.com' },
  product: { ...safeOrder.product, name: 'Other Notes' },
};

const pendingDetail: ConsoleOrderDetailView = {
  ...safeOrder,
  allowedActions: ['complete', 'cancel'],
  refundRequest: null,
  history: [{
    action: 'order_created',
    source: 'customer_capability',
    fromStatus: null,
    toStatus: 'pending_payment',
    createdAt: '2026-08-27T12:00:00.000Z',
  }],
};

const zeroDetail: ConsoleOrderDetailView = {
  ...pendingDetail,
  reference: 'NX-260827-00000000',
  unitPriceMinor: 0,
  totalMinor: 0,
};

const completedDetail: ConsoleOrderDetailView = {
  ...pendingDetail,
  status: 'completed',
  allowedActions: [],
  history: [
    pendingDetail.history[0],
    {
      action: 'order_completed',
      source: 'console',
      fromStatus: 'pending_payment',
      toStatus: 'completed',
      createdAt: '2026-08-27T12:05:00.000Z',
    },
  ],
};

const screenDefaults: Omit<OrdersScreenProps, 'state' | 'orders'> = {
  searchDraft: '',
  statusFilter: 'all',
  refundPendingOnly: false,
  hasPreviousPage: false,
  hasNextPage: false,
  onSearchDraftChange: () => undefined,
  onSearchSubmit: () => undefined,
  onStatusFilterChange: () => undefined,
  onRefundPendingOnlyChange: () => undefined,
  onRetry: () => undefined,
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

function paymentCheckbox(): HTMLInputElement | undefined {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((input) => (
    input.closest('label')?.textContent?.includes('I confirm the full payment has been received.')
  ));
}

function stubConsoleFetch(handler: (url: URL, init?: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(requestUrl(input), init)));
}

async function renderApp() {
  await act(async () => { root.render(createElement(ProductionConsoleApp)); });
}

async function openCompletePanel() {
  await waitUntil(() => Boolean(buttonByName('Complete')));
  await act(async () => { buttonByName('Complete')?.click(); });
  await waitUntil(() => Boolean(buttonByName('Confirm Complete')));
}

async function confirmComplete() {
  const checkbox = paymentCheckbox();
  if (!checkbox) throw new Error('missing checkbox');
  await act(async () => { checkbox.click(); });
  await act(async () => { buttonByName('Confirm Complete')?.click(); });
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
    expect(container.querySelector('.order-list-mobile')?.textContent).toContain('ada@example.com');
    expect(container.querySelector('.order-list-mobile')?.textContent).toContain('$47.01');
    expect(container.textContent).not.toContain('opaque-secret');
    expect(container.textContent).not.toContain('private-file');
    expect(container.textContent).not.toContain('internal delivery');
  });

  it('provides durable loading, empty, no-results, and error regions', async () => {
    await act(async () => root.render(createElement(OrdersScreen, { ...screenDefaults, state: 'loading', orders: [] })));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => root.render(createElement(OrdersScreen, { ...screenDefaults, state: 'empty', orders: [] })));
    expect(container.textContent).toContain('No Orders have been placed.');
    await act(async () => root.render(createElement(OrdersScreen, { ...screenDefaults, state: 'no-results', orders: [] })));
    expect(container.textContent).toContain('No Orders match these filters.');
    const retry = vi.fn();
    await act(async () => root.render(createElement(OrdersScreen, { ...screenDefaults, state: 'error', orders: [], onRetry: retry })));
    await act(async () => buttonByName('Retry loading Orders')?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it('supports direct Orders URLs, destination navigation, and popstate restoration', async () => {
    stubConsoleFetch(async (url) => {
      if (url.pathname === '/api/console/orders') return response({ orders: [safeOrder], nextCursor: null, hasOrders: true });
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
      if (url.pathname === '/api/console/orders') return response({ orders: [], nextCursor: null, hasOrders: true });
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
      if (url.pathname === '/api/console/orders') return response({ orders: [safeOrder], nextCursor: null, hasOrders: true });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await waitUntil(() => container.querySelector('h1')?.textContent === pendingDetail.reference);
    expect(container.textContent).toContain('Ada Rivera');
    expect(container.textContent).toContain('Field Notes');
    await act(async () => { buttonByName('Back to Orders')?.click(); });
    await waitUntil(() => container.querySelector('h1')?.textContent === 'Orders');
    expect(window.location.pathname).toBe('/console/orders');
    window.history.pushState({}, '', `/console/orders/${pendingDetail.reference}`);
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitUntil(() => container.querySelector('h1')?.textContent === pendingDetail.reference);
  });

  it('submits search on Enter and applies status and refund filters immediately', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.pathname === '/api/console/orders') return response({ orders: [safeOrder], nextCursor: null, hasOrders: true });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderApp();
    await waitUntil(() => Boolean(container.querySelector('#order-search')));
    const search = container.querySelector<HTMLInputElement>('#order-search');
    if (!search) throw new Error('missing search');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'Ada');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(fetchMock.mock.calls.filter((call) => requestUrl(call[0] as RequestInfo | URL).pathname === '/api/console/orders')).toHaveLength(1);
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitUntil(() => fetchMock.mock.calls.some((call) => requestUrl(call[0] as RequestInfo | URL).searchParams.get('q') === 'Ada'));
    const completedTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.trim() === 'Completed');
    await act(async () => { completedTab?.click(); });
    await waitUntil(() => fetchMock.mock.calls.some((call) => requestUrl(call[0] as RequestInfo | URL).searchParams.get('status') === 'completed'));
    const refund = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((input) => (
      input.closest('label')?.textContent?.includes('Pending refund requests')
    ));
    await act(async () => { refund?.click(); });
    await waitUntil(() => fetchMock.mock.calls.some((call) => requestUrl(call[0] as RequestInfo | URL).searchParams.get('refund') === 'pending'));
  });

  it('uses the same Complete confirmation panel for a zero-total Order', async () => {
    stubConsoleFetch(async (url) => {
      if (url.pathname === `/api/console/orders/${zeroDetail.reference}`) return response({ order: zeroDetail });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${zeroDetail.reference}`);
    await renderApp();
    await openCompletePanel();
    expect(container.textContent).toContain('I confirm the full payment has been received.');
    expect(container.textContent).toContain('USD');
    expect(buttonByName('Confirm Complete')?.disabled).toBe(true);
    await act(async () => { paymentCheckbox()?.click(); });
    expect(buttonByName('Confirm Complete')?.disabled).toBe(false);
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
        return response({
          order: { ...pendingDetail, ...otherOrder, allowedActions: ['complete', 'cancel'], refundRequest: null, history: pendingDetail.history },
        });
      }
      if (url.pathname === '/api/console/orders') return response({ orders: [safeOrder, otherOrder], nextCursor: null, hasOrders: true });
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

  it('retries Complete with the same idempotency key after an unknown outcome', async () => {
    const keys: string[] = [];
    let completes = 0;
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        return response({ order: pendingDetail });
      }
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}/complete`) {
        completes += 1;
        keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        expect(init?.body).toBe(JSON.stringify({ paymentConfirmed: true }));
        expect(new Headers(init?.headers).get('If-Match')).toBeNull();
        if (completes === 1) return errorResponse(503, 'order_operation_failed', 'The Order operation could not be completed.');
        return response({
          reference: pendingDetail.reference,
          action: 'complete',
          status: 'completed',
          occurredAt: '2026-08-27T12:05:00.000Z',
          refundRequest: null,
        });
      }
      if (url.pathname === '/api/console/orders') return response({ orders: [], nextCursor: null, hasOrders: true });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await openCompletePanel();
    await confirmComplete();
    await waitUntil(() => (container.textContent ?? '').includes('The outcome is not confirmed. Retry the same action.'));
    expect(buttonByName('Cancel')?.closest('.inline-actions')?.getAttribute('style')).toContain('display: none');
    await act(async () => { buttonByName('Retry Complete')?.click(); });
    await waitUntil(() => keys.length === 2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]?.length).toBeGreaterThanOrEqual(16);
  });

  it('shows conflict copy and refetches after a stale opposing action', async () => {
    let detail = pendingDetail;
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        return response({ order: detail });
      }
      if (url.pathname.endsWith('/cancel')) {
        detail = completedDetail;
        return errorResponse(409, 'order_state_conflict', 'The Order state does not allow this action.');
      }
      if (url.pathname === '/api/console/orders') return response({ orders: [], nextCursor: null, hasOrders: true });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await waitUntil(() => Boolean(buttonByName('Cancel')));
    await act(async () => { buttonByName('Cancel')?.click(); });
    await waitUntil(() => Boolean(buttonByName('Confirm Cancel')));
    await act(async () => { buttonByName('Confirm Cancel')?.click(); });
    await waitUntil(() => (container.textContent ?? '').includes('The action was not applied. The Order has changed.'));
    expect(container.textContent).toContain('Completed');
    expect(buttonByName('Cancel')).toBeUndefined();
  });

  it('keeps the write acknowledgement when follow-up GET fails', async () => {
    let getCount = 0;
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        getCount += 1;
        if (getCount === 1) return response({ order: pendingDetail });
        return errorResponse(500, 'order_operation_failed', 'The Order operation could not be completed.');
      }
      if (url.pathname.endsWith('/complete')) {
        return response({
          reference: pendingDetail.reference,
          action: 'complete',
          status: 'completed',
          occurredAt: '2026-08-27T12:05:00.000Z',
          refundRequest: null,
        });
      }
      if (url.pathname === '/api/console/orders') return response({ orders: [], nextCursor: null, hasOrders: true });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await openCompletePanel();
    await confirmComplete();
    await waitUntil(() => (container.textContent ?? '').includes('The action succeeded, but the latest Order could not be loaded.'));
    expect(container.textContent).toContain('Retry loading Order');
    expect(container.textContent).not.toContain('The outcome is not confirmed');
  });

  it('does not apply optimistic status before the server response', async () => {
    let releaseComplete: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releaseComplete = resolve; });
    stubConsoleFetch(async (url, init) => {
      if (url.pathname === `/api/console/orders/${pendingDetail.reference}` && (!init || !init.method || init.method === 'GET')) {
        return response({ order: pendingDetail });
      }
      if (url.pathname.endsWith('/complete')) {
        await gate;
        return response({
          reference: pendingDetail.reference,
          action: 'complete',
          status: 'completed',
          occurredAt: '2026-08-27T12:05:00.000Z',
          refundRequest: null,
        });
      }
      if (url.pathname === '/api/console/orders') return response({ orders: [], nextCursor: null, hasOrders: true });
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    window.history.replaceState({}, '', `/console/orders/${pendingDetail.reference}`);
    await renderApp();
    await openCompletePanel();
    await confirmComplete();
    expect(container.textContent).toContain('Pending payment');
    expect(container.textContent).not.toContain('Completed');
    releaseComplete?.();
    await flush();
  });
});
