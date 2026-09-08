import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ProductionConsoleApp } from '../../apps/console/src/production-console-app';
import { OrdersScreen } from '../../apps/console/src/orders/orders-screen';
import type {
  ConsoleOrderDetailView,
  ConsoleOrderListCriteria,
  ConsoleOrderView,
} from '../../apps/console/src/orders/order-ui-types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const PAGE_TWO_CURSOR = 'page-2-cursor';
const PAGE_THREE_CURSOR = 'page-3-cursor';

const safeOrder: ConsoleOrderView = {
  reference: 'NX-260827-ABCD',
  status: 'pending_payment',
  product: { id: 'prod_simple1234', name: 'Field Notes', variant: null },
  customer: { name: 'Ada Rivera', email: 'ada@example.com' },
  quantity: 2,
  unitPriceMinor: 2400,
  totalMinor: 4701,
  currency: 'USD',
  createdAt: '2026-08-27T12:00:00.000Z',
  hasPendingRefund: false,
};

function listOrder(reference: string, createdAt: string): ConsoleOrderView {
  return { ...safeOrder, reference, createdAt };
}

function detailFrom(order: ConsoleOrderView, patch: Partial<ConsoleOrderDetailView> = {}): ConsoleOrderDetailView {
  return {
    reference: order.reference,
    status: order.status,
    product: order.product,
    customer: order.customer,
    quantity: order.quantity,
    unitPriceMinor: order.unitPriceMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    createdAt: order.createdAt,
    history: [{
      sequence: 0,
      action: 'order_created',
      fromStatus: null,
      toStatus: 'pending_payment',
      source: 'storefront',
      refundRequestId: null,
      createdAt: order.createdAt,
    }],
    refundRequest: null,
    allowedActions: order.status === 'pending_payment'
      ? ['mark_paid', 'cancel']
      : order.status === 'paid'
        ? ['mark_fulfilled']
        : [],
    ...patch,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function errorEnvelope(status: number, code: string, message: string): Response {
  return json({ error: { code, message, fields: [], incidentId: null } }, status);
}

function buttonNamed(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label);
}

function actionButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="Order actions"] button')).find((button) => button.textContent === label);
}

function dialogButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('dialog button')).find((button) => button.textContent === label);
}

async function confirmOpenDialog(label: string): Promise<void> {
  await flush();
  expect(container.querySelector('dialog')?.open).toBe(true);
  await act(async () => { dialogButton(label)?.click(); });
  await flush();
}


function linkNamed(label: string): HTMLAnchorElement | undefined {
  return Array.from(container.querySelectorAll('a')).find((anchor) => anchor.textContent?.includes(label));
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderApp(): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(ProductionConsoleApp)));
  });
  await flush();
}

const historyOriginals = {
  pushState: window.history.pushState.bind(window.history),
  replaceState: window.history.replaceState.bind(window.history),
  back: window.history.back.bind(window.history),
  forward: window.history.forward.bind(window.history),
};

function installHistoryShim() {
  const entries: Array<{ url: string; state: unknown }> = [{ url: window.location.href, state: window.history.state }];
  let index = 0;
  window.history.pushState = (state, title, url) => {
    historyOriginals.pushState(state, title, url);
    entries.splice(index + 1);
    entries.push({ url: window.location.href, state: window.history.state });
    index = entries.length - 1;
  };
  window.history.replaceState = (state, title, url) => {
    historyOriginals.replaceState(state, title, url);
    entries[index] = { url: window.location.href, state: window.history.state };
  };
  window.history.back = () => {
    if (index === 0) return;
    index -= 1;
    historyOriginals.replaceState(entries[index].state, '', entries[index].url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: entries[index].state }));
  };
  window.history.forward = () => {
    if (index >= entries.length - 1) return;
    index += 1;
    historyOriginals.replaceState(entries[index].state, '', entries[index].url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: entries[index].state }));
  };
}

function restoreHistoryShim() {
  window.history.pushState = historyOriginals.pushState;
  window.history.replaceState = historyOriginals.replaceState;
  window.history.back = historyOriginals.back;
  window.history.forward = historyOriginals.forward;
}

async function traverseHistory(direction: 'back' | 'forward') {
  const previous = window.location.href;
  await act(async () => {
    if (direction === 'back') window.history.back();
    else window.history.forward();
  });
  await flush();
  if (window.location.href === previous) {
    throw new Error(`history.${direction} was a no-op (length=${window.history.length} href=${previous})`);
  }
}

async function remountApp(): Promise<void> {
  await act(async () => root.unmount());
  root = createRoot(container);
  await renderApp();
}

function installConsoleFetch(options: {
  list?: (criteria: ConsoleOrderListCriteria) => { orders: ConsoleOrderView[]; nextCursor: string | null; hasAnyOrders: boolean };
  detail?: (reference: string) => ConsoleOrderDetailView | Promise<ConsoleOrderDetailView>;
  action?: (input: { reference: string; body: unknown; key: string | null }) => Response | Promise<Response>;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    const method = init?.method ?? 'GET';
    if (url.pathname.startsWith('/api/console/products')) return json({ products: [] });
    if (url.pathname === '/api/console/orders' && method === 'GET') {
      const statusParam = url.searchParams.get('status');
      const criteria: ConsoleOrderListCriteria = {
        q: url.searchParams.get('q') ?? '',
        status: statusParam === 'pending_payment' || statusParam === 'paid' || statusParam === 'fulfilled' || statusParam === 'cancelled'
          ? statusParam
          : 'all',
        refund: url.searchParams.get('refund') === 'pending' ? 'pending' : 'all',
        cursor: url.searchParams.get('cursor') || null,
      };
      return json(options.list?.(criteria) ?? { orders: [safeOrder], nextCursor: null, hasAnyOrders: true });
    }
    const actionMatch = /^\/api\/console\/orders\/([^/]+)\/actions$/.exec(url.pathname);
    if (actionMatch && method === 'POST') {
      const body = init?.body ? JSON.parse(String(init.body)) as unknown : null;
      const headers = new Headers(init?.headers);
      return options.action?.({
        reference: decodeURIComponent(actionMatch[1]),
        body,
        key: headers.get('Idempotency-Key'),
      }) ?? errorEnvelope(500, 'order_operation_failed', 'The Orders could not be loaded.');
    }
    const detailMatch = /^\/api\/console\/orders\/([^/]+)$/.exec(url.pathname);
    if (detailMatch && method === 'GET') {
      const reference = decodeURIComponent(detailMatch[1]);
      const detail = options.detail
        ? await options.detail(reference)
        : detailFrom(safeOrder);
      return json(detail);
    }
    throw new Error(`Unexpected request ${url.href}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function pagedList(criteria: ConsoleOrderListCriteria) {
  const pageOne = [listOrder('NX-PAGE1-ORDER01', '2026-08-27T12:00:03.000Z'), listOrder('NX-PAGE1-ORDER02', '2026-08-27T12:00:02.000Z')];
  const pageTwo = [listOrder('NX-PAGE2-ORDER01', '2026-08-27T12:00:01.000Z'), listOrder('NX-PAGE2-ORDER02', '2026-08-27T12:00:00.000Z')];
  const pageThree = [listOrder('NX-PAGE3-ORDER01', '2026-08-26T12:00:00.000Z'), listOrder('NX-PAGE3-ORDER02', '2026-08-26T11:00:00.000Z')];
  if (criteria.cursor === PAGE_THREE_CURSOR) {
    return { orders: pageThree, nextCursor: null, hasAnyOrders: true };
  }
  if (criteria.cursor === PAGE_TWO_CURSOR) {
    return { orders: pageTwo, nextCursor: PAGE_THREE_CURSOR, hasAnyOrders: true };
  }
  return { orders: pageOne, nextCursor: PAGE_TWO_CURSOR, hasAnyOrders: true };
}

beforeEach(() => {
  installHistoryShim();
  window.history.pushState({ harness: 'prior' }, '', '/__harness');
  window.history.pushState({}, '', '/console/orders');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreHistoryShim();
  await page.viewport(1280, 800);
  await act(async () => root.unmount());
  container.remove();
});

describe('Console Order contracts', () => {
  it('renders all safe fields in desktop and compact structures without internal content', async () => {
    const unsafe = {
      ...safeOrder,
      capability: 'opaque-secret',
      privateFileKey: 'private-file',
      accessInstructions: 'internal delivery',
    };
    await act(async () => root.render(createElement(OrdersScreen, {
      state: 'ready',
      orders: [unsafe],
      criteria: { q: '', status: 'all', refund: 'all', cursor: null },
      nextCursor: null,
      canGoPrevious: false,
      showFirstPage: false,
      onRetry: () => undefined,
      onCriteriaChange: () => undefined,
      onClearFilters: () => undefined,
      onNext: () => undefined,
      onPrevious: () => undefined,
      onFirstPage: () => undefined,
      onOpenOrder: () => undefined,
    })));
    expect(container.querySelector('.orders-table')?.textContent).toContain('NX-260827-ABCD');
    expect(container.querySelector('.order-list-mobile')?.textContent).toContain('ada@example.com');
    expect(container.querySelector('.order-list-mobile')?.textContent).toContain('$47.01');
    expect(container.textContent).not.toContain('opaque-secret');
    expect(container.textContent).not.toContain('private-file');
    expect(container.textContent).not.toContain('internal delivery');
  });

  it('provides durable loading, empty, and error regions', async () => {
    const idle = {
      criteria: { q: '', status: 'all' as const, refund: 'all' as const, cursor: null },
      orders: [] as ConsoleOrderView[],
      nextCursor: null,
      canGoPrevious: false,
      showFirstPage: false,
      onCriteriaChange: () => undefined,
      onClearFilters: () => undefined,
      onNext: () => undefined,
      onPrevious: () => undefined,
      onFirstPage: () => undefined,
      onOpenOrder: () => undefined,
    };
    await act(async () => root.render(createElement(OrdersScreen, { ...idle, state: 'loading', onRetry: () => undefined })));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => root.render(createElement(OrdersScreen, { ...idle, state: 'empty', onRetry: () => undefined })));
    expect(container.textContent).toContain('No Orders have been placed.');
    const retry = vi.fn();
    await act(async () => root.render(createElement(OrdersScreen, { ...idle, state: 'error', onRetry: retry })));
    const retryButton = buttonNamed('Retry loading Orders');
    await act(async () => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it('supports direct Orders URLs, destination navigation, and popstate restoration', async () => {
    installConsoleFetch({});
    await renderApp();
    expect(container.querySelector('h1')?.textContent).toBe('Orders');
    expect(container.querySelector('.console-nav [aria-current="page"]')?.textContent).toContain('Orders');
    const products = buttonNamed('Products');
    await act(async () => { products?.click(); });
    await flush();
    expect(window.location.pathname).toBe('/console/products');
    expect(container.querySelector('h1')?.textContent).toBe('Products');
    window.history.pushState(window.history.state ?? {}, '', '/console/orders');
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
    await flush();
    expect(container.querySelector('h1')?.textContent).toBe('Orders');
  });

  it('restores search, status, refund filter, and cursor from the URL after Back from detail', async () => {
    installConsoleFetch({
      list: (criteria) => {
        if (criteria.q === 'ada' && criteria.status === 'paid' && criteria.refund === 'pending' && criteria.cursor === PAGE_TWO_CURSOR) {
          return { orders: [listOrder('NX-FILTERED-01', '2026-08-27T12:00:00.000Z')], nextCursor: PAGE_THREE_CURSOR, hasAnyOrders: true };
        }
        return { orders: [safeOrder], nextCursor: PAGE_TWO_CURSOR, hasAnyOrders: true };
      },
      detail: (reference) => detailFrom({ ...safeOrder, reference }),
    });
    window.history.replaceState({}, '', '/console/orders?q=ada&status=paid&refund=pending&cursor=page-2-cursor');
    await renderApp();
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('ada');
    expect(container.textContent).toContain('NX-FILTERED-01');
    await act(async () => { linkNamed('NX-FILTERED-01')?.click(); });
    await flush();
    expect(window.location.pathname).toBe('/console/orders/NX-FILTERED-01');
    expect(container.textContent).toContain('NX-FILTERED-01');
    await traverseHistory('back');
    expect(window.location.search).toContain('q=ada');
    expect(window.location.search).toContain('status=paid');
    expect(window.location.search).toContain('refund=pending');
    expect(window.location.search).toContain('cursor=page-2-cursor');
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('ada');
    expect(container.textContent).toContain('NX-FILTERED-01');
  });

  it('renders real statuses and only server-provided actions', async () => {
    const paid = { ...safeOrder, reference: 'NX-PAID-ORDER0001', status: 'paid' as const, hasPendingRefund: true };
    installConsoleFetch({
      list: () => ({ orders: [safeOrder, paid], nextCursor: null, hasAnyOrders: true }),
      detail: (reference) => reference === paid.reference
        ? detailFrom(paid, {
          status: 'paid',
          allowedActions: ['mark_fulfilled'],
          refundRequest: {
            id: 'refund_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            reason: 'Need a reprint',
            status: 'pending',
            createdAt: '2026-08-28T12:00:00.000Z',
          },
        })
        : detailFrom(safeOrder),
    });
    await renderApp();
    expect(container.textContent).toContain('Pending payment');
    expect(container.textContent).toContain('Paid');
    await act(async () => { linkNamed(paid.reference)?.click(); });
    await flush();
    expect(actionButton('Mark fulfilled')).toBeTruthy();
    expect(actionButton('Mark paid')).toBeUndefined();
    expect(actionButton('Cancel')).toBeUndefined();
    expect(container.textContent).toContain('Received — awaiting response');
    expect(container.textContent).toContain('manual confirmation');
    expect(Array.from(container.querySelectorAll('.status-tag')).some((tag) => tag.textContent === 'Refunded')).toBe(false);
  });

  it('ignores a delayed pending GET after Mark paid succeeds', async () => {
    let releaseStale: () => void = () => undefined;
    const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
    let holdNextDetail = false;
    let paid = false;
    const posts: Array<{ key: string | null; body: unknown }> = [];
    const paidDetail = detailFrom({ ...safeOrder, status: 'paid' }, {
      status: 'paid',
      allowedActions: ['mark_fulfilled'],
    });
    installConsoleFetch({
      list: () => ({ orders: [safeOrder], nextCursor: null, hasAnyOrders: true }),
      detail: async () => {
        if (holdNextDetail) {
          holdNextDetail = false;
          await staleGate;
          return detailFrom(safeOrder);
        }
        return paid ? paidDetail : detailFrom(safeOrder);
      },
      action: ({ key, body }) => {
        posts.push({ key, body });
        paid = true;
        return json({
          order: paidDetail,
          command: { outcome: 'applied', replayed: false, resultStatus: 'paid' },
        });
      },
    });
    window.history.replaceState({}, '', `/console/orders/${safeOrder.reference}`);
    await renderApp();
    expect(actionButton('Mark paid')).toBeTruthy();
    holdNextDetail = true;
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    });
    await flush();
    await act(async () => { actionButton('Mark paid')?.click(); });
    await confirmOpenDialog('Confirm payment');
    releaseStale();
    await flush();
    expect(container.textContent).toContain('Paid');
    expect(actionButton('Cancel')).toBeUndefined();
    expect(actionButton('Mark fulfilled')).toBeTruthy();
    expect(posts).toHaveLength(1);
  });

  it('retries a 5xx action with the same idempotency key', async () => {
    const keys: Array<string | null> = [];
    let attempts = 0;
    let paid = false;
    const paidDetail = detailFrom({ ...safeOrder, status: 'paid' }, { status: 'paid', allowedActions: ['mark_fulfilled'] });
    installConsoleFetch({
      list: () => ({ orders: [safeOrder], nextCursor: null, hasAnyOrders: true }),
      detail: () => paid ? paidDetail : detailFrom(safeOrder),
      action: ({ key }) => {
        keys.push(key);
        attempts += 1;
        if (attempts === 1) return errorEnvelope(503, 'order_operation_failed', 'The Orders could not be loaded.');
        paid = true;
        return json({
          order: paidDetail,
          command: { outcome: 'applied', replayed: false, resultStatus: 'paid' },
        });
      },
    });
    window.history.replaceState({}, '', `/console/orders/${safeOrder.reference}`);
    await renderApp();
    await act(async () => { actionButton('Mark paid')?.click(); });
    await confirmOpenDialog('Confirm payment');
    await act(async () => { buttonNamed('Retry Mark paid')?.click(); });
    await flush();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual(keys[1]);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(container.textContent).toContain('Paid');
  });

  it('refetches after a state conflict and does not rewrite Cancel into another action', async () => {
    const posts: unknown[] = [];
    let current: 'pending' | 'paid' = 'pending';
    installConsoleFetch({
      list: () => ({ orders: [safeOrder], nextCursor: null, hasAnyOrders: true }),
      detail: () => current === 'pending'
        ? detailFrom(safeOrder)
        : detailFrom({ ...safeOrder, status: 'paid' }, { status: 'paid', allowedActions: ['mark_fulfilled'] }),
      action: ({ body }) => {
        posts.push(body);
        current = 'paid';
        return errorEnvelope(409, 'order_state_conflict', 'The Order could not be updated.');
      },
    });
    window.history.replaceState({}, '', `/console/orders/${safeOrder.reference}`);
    await renderApp();
    await act(async () => { actionButton('Cancel')?.click(); });
    await confirmOpenDialog('Confirm cancellation');
    expect(posts).toEqual([{ action: 'cancel', acknowledgedRefundRequestId: null }]);
    expect(container.textContent).toContain('Paid');
    expect(actionButton('Mark fulfilled')).toBeTruthy();
    expect(actionButton('Cancel')).toBeUndefined();
  });

  it('displays hostile refund HTML as inert text', async () => {
    const hostile = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
    installConsoleFetch({
      detail: () => detailFrom({ ...safeOrder, status: 'paid' }, {
        status: 'paid',
        allowedActions: ['mark_fulfilled'],
        refundRequest: {
          id: 'refund_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          reason: hostile,
          status: 'pending',
          createdAt: '2026-08-28T12:00:00.000Z',
        },
      }),
    });
    window.history.replaceState({}, '', `/console/orders/${safeOrder.reference}`);
    await renderApp();
    const reason = container.querySelector('[data-refund-reason]');
    expect(reason?.textContent).toContain(hostile);
    expect(reason?.querySelector('img')).toBeNull();
    expect(reason?.querySelector('script')).toBeNull();
    expect(Object.hasOwn(window, '__xss')).toBe(false);
  });

  it('sends no mutation when fulfillment confirmation is cancelled or dismissed with Escape, including at 375px', async () => {
    const refundId = 'refund_cccccccccccccccccccccccccccccccc';
    const posts: unknown[] = [];
    installConsoleFetch({
      detail: () => detailFrom({ ...safeOrder, status: 'paid' }, {
        status: 'paid',
        allowedActions: ['mark_fulfilled'],
        refundRequest: {
          id: refundId,
          reason: 'Please reverse this charge',
          status: 'pending',
          createdAt: '2026-08-28T12:00:00.000Z',
        },
      }),
      action: ({ body }) => {
        posts.push(body);
        return json({
          order: detailFrom({ ...safeOrder, status: 'fulfilled' }, { status: 'fulfilled', allowedActions: [] }),
          command: { outcome: 'applied', replayed: false, resultStatus: 'fulfilled' },
        });
      },
    });
    window.history.replaceState({}, '', `/console/orders/${safeOrder.reference}`);
    await renderApp();
    const fulfill = actionButton('Mark fulfilled');
    await act(async () => { fulfill?.click(); });
    await flush();
    const dialog = container.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain('Please reverse this charge');
    const dialogCancel = Array.from(dialog?.querySelectorAll('button') ?? []).find((button) => button.textContent === 'Cancel');
    await act(async () => { dialogCancel?.click(); });
    await flush();
    expect(dialog?.open).toBeFalsy();
    expect(posts).toEqual([]);
    expect(document.activeElement).toBe(fulfill);

    await act(async () => { fulfill?.click(); });
    await flush();
    const openDialog = container.querySelector('dialog');
    await act(async () => {
      openDialog?.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    await flush();
    expect(openDialog?.open).toBeFalsy();
    expect(posts).toEqual([]);
    expect(document.activeElement).toBe(fulfill);

    await page.viewport(375, 812);
    await act(async () => { fulfill?.click(); });
    await flush();
    const mobileDialog = container.querySelector('dialog');
    expect(mobileDialog?.open).toBe(true);
    const reasonBox = mobileDialog?.querySelector('[data-refund-reason]')?.getBoundingClientRect();
    const cancelBox = Array.from(mobileDialog?.querySelectorAll('button') ?? []).find((button) => button.textContent === 'Cancel')?.getBoundingClientRect();
    const confirmBox = Array.from(mobileDialog?.querySelectorAll('button') ?? []).find((button) => button.textContent === 'Confirm fulfillment')?.getBoundingClientRect();
    expect(reasonBox && reasonBox.width > 0 && reasonBox.bottom <= 812).toBe(true);
    expect(cancelBox && cancelBox.width > 0 && cancelBox.bottom <= 812).toBe(true);
    expect(confirmBox && confirmBox.width > 0 && confirmBox.bottom <= 812).toBe(true);
    const mobileCancel = Array.from(mobileDialog?.querySelectorAll('button') ?? []).find((button) => button.textContent === 'Cancel');
    await act(async () => { mobileCancel?.click(); });
    await flush();
    expect(posts).toEqual([]);
    expect(document.activeElement).toBe(fulfill);

    await act(async () => { fulfill?.click(); });
    await flush();
    const confirm = container.querySelector<HTMLButtonElement>('dialog .button-primary');
    await act(async () => { confirm?.click(); });
    await flush();
    expect(posts).toEqual([{ action: 'mark_fulfilled', acknowledgedRefundRequestId: refundId }]);
  });

  it('sends no mutation when Mark paid or Cancel confirmation is dismissed', async () => {
    const posts: unknown[] = [];
    installConsoleFetch({
      detail: () => detailFrom(safeOrder),
      action: ({ body }) => {
        posts.push(body);
        return json({
          order: detailFrom({ ...safeOrder, status: 'paid' }, { status: 'paid', allowedActions: ['mark_fulfilled'] }),
          command: { outcome: 'applied', replayed: false, resultStatus: 'paid' },
        });
      },
    });
    window.history.replaceState({}, '', `/console/orders/${safeOrder.reference}`);
    await renderApp();
    const paid = actionButton('Mark paid');
    await act(async () => { paid?.click(); });
    await flush();
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector('dialog')?.textContent).toContain('Confirm payment');
    expect(container.querySelector('[data-refund-reason]')).toBeNull();
    await act(async () => { dialogButton('Cancel')?.click(); });
    await flush();
    expect(container.querySelector('dialog')?.open).toBeFalsy();
    expect(posts).toEqual([]);
    expect(document.activeElement).toBe(paid);

    const cancel = actionButton('Cancel');
    await act(async () => { cancel?.click(); });
    await flush();
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector('dialog')?.textContent).toContain('Confirm cancellation');
    await act(async () => { dialogButton('Cancel')?.click(); });
    await flush();
    expect(posts).toEqual([]);
    expect(document.activeElement).toBe(cancel);

    await act(async () => { paid?.click(); });
    await confirmOpenDialog('Confirm payment');
    expect(posts).toEqual([{ action: 'mark_paid', acknowledgedRefundRequestId: null }]);
  });

  it('keeps a reopened confirmation when a delayed close from the previous dialog arrives', async () => {
    const posts: unknown[] = [];
    installConsoleFetch({
      detail: () => detailFrom(safeOrder),
      action: ({ body }) => {
        posts.push(body);
        return json({
          order: detailFrom({ ...safeOrder, status: 'cancelled' }, { status: 'cancelled', allowedActions: [] }),
          command: { outcome: 'applied', replayed: false, resultStatus: 'cancelled' },
        });
      },
    });
    window.history.replaceState({}, '', `/console/orders/${safeOrder.reference}`);
    await renderApp();
    await act(async () => { actionButton('Mark paid')?.click(); });
    await flush();
    const dialog = container.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    await act(async () => { dialogButton('Cancel')?.click(); });
    await flush();
    expect(dialog?.open).toBeFalsy();

    await act(async () => { actionButton('Cancel')?.click(); });
    await flush();
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain('Confirm cancellation');

    await act(async () => {
      dialog?.dispatchEvent(new Event('close'));
    });
    await flush();
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain('Confirm cancellation');
    expect(posts).toEqual([]);

    await confirmOpenDialog('Confirm cancellation');
    expect(posts).toEqual([{ action: 'cancel', acknowledgedRefundRequestId: null }]);
  });


  it('confirms fulfillment without a refund using a null acknowledgement', async () => {
    const posts: unknown[] = [];
    installConsoleFetch({
      detail: () => detailFrom({ ...safeOrder, status: 'paid' }, { status: 'paid', allowedActions: ['mark_fulfilled'] }),
      action: ({ body }) => {
        posts.push(body);
        return json({
          order: detailFrom({ ...safeOrder, status: 'fulfilled' }, { status: 'fulfilled', allowedActions: [] }),
          command: { outcome: 'applied', replayed: false, resultStatus: 'fulfilled' },
        });
      },
    });
    window.history.replaceState({}, '', `/console/orders/${safeOrder.reference}`);
    await renderApp();
    await act(async () => { actionButton('Mark fulfilled')?.click(); });
    await confirmOpenDialog('Confirm fulfillment');
    expect(posts).toEqual([{ action: 'mark_fulfilled', acknowledgedRefundRequestId: null }]);
  });


  it('recovers page 2 ancestry after page 3, detail, remount, Back, then Previous', async () => {
    const seenCursors: Array<string | null> = [];
    installConsoleFetch({
      list: (criteria) => {
        seenCursors.push(criteria.cursor);
        return pagedList(criteria);
      },
      detail: (reference) => detailFrom({ ...safeOrder, reference }),
    });
    await renderApp();
    await act(async () => { buttonNamed('Next')?.click(); });
    await flush();
    await act(async () => { buttonNamed('Next')?.click(); });
    await flush();
    expect(container.textContent).toContain('NX-PAGE3-ORDER01');
    expect(container.textContent).not.toContain('NX-PAGE2-ORDER01');
    await act(async () => { linkNamed('NX-PAGE3-ORDER01')?.click(); });
    await flush();
    await remountApp();
    expect(window.location.pathname).toBe('/console/orders/NX-PAGE3-ORDER01');
    await traverseHistory('back');
    expect(window.location.search).toContain(`cursor=${PAGE_THREE_CURSOR}`);
    expect(container.textContent).toContain('NX-PAGE3-ORDER01');
    await act(async () => { buttonNamed('Previous')?.click(); });
    await flush();
    expect(window.location.search).toContain(`cursor=${PAGE_TWO_CURSOR}`);
    expect(container.textContent).toContain('NX-PAGE2-ORDER01');
    expect(container.textContent).toContain('NX-PAGE2-ORDER02');
    expect(container.textContent).not.toContain('NX-PAGE1-ORDER01');
    expect(container.textContent).not.toContain('NX-PAGE3-ORDER01');
    expect(seenCursors).toContain(PAGE_TWO_CURSOR);
  });

  it('restores list pages through browser Back and Forward', async () => {
    installConsoleFetch({ list: pagedList });
    await renderApp();
    expect(container.textContent).toContain('NX-PAGE1-ORDER01');
    await act(async () => { buttonNamed('Next')?.click(); });
    await flush();
    expect(container.textContent).toContain('NX-PAGE2-ORDER01');
    await traverseHistory('back');
    expect(window.location.search).not.toContain('cursor=');
    expect(container.textContent).toContain('NX-PAGE1-ORDER01');
    await traverseHistory('forward');
    expect(window.location.search).toContain(`cursor=${PAGE_TWO_CURSOR}`);
    expect(container.textContent).toContain('NX-PAGE2-ORDER01');
  });

  it('keeps a history entry for filter reset so Back restores the prior criteria', async () => {
    installConsoleFetch({
      list: (criteria) => {
        if (criteria.status === 'cancelled') {
          return { orders: [listOrder('NX-CANCELLED-01', '2026-08-27T12:00:00.000Z')], nextCursor: null, hasAnyOrders: true };
        }
        return { orders: [safeOrder], nextCursor: null, hasAnyOrders: true };
      },
    });
    await renderApp();
    const cancelledTab = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Cancelled');
    await act(async () => { cancelledTab?.click(); });
    await flush();
    expect(container.textContent).toContain('NX-CANCELLED-01');
    await traverseHistory('back');
    expect(window.location.search).not.toContain('status=cancelled');
    expect(container.textContent).toContain('NX-260827-ABCD');
  });

  it('fetches a direct cursor URL without inventing ancestry', async () => {
    installConsoleFetch({ list: pagedList });
    window.history.replaceState({}, '', `/console/orders?cursor=${PAGE_TWO_CURSOR}`);
    await renderApp();
    expect(container.textContent).toContain('NX-PAGE2-ORDER01');
    expect(buttonNamed('Previous')?.disabled).toBe(true);
    expect(buttonNamed('First page')).toBeTruthy();
    await act(async () => { buttonNamed('First page')?.click(); });
    await flush();
    expect(window.location.search).not.toContain('cursor=');
    expect(container.textContent).toContain('NX-PAGE1-ORDER01');
  });

  it('distinguishes empty, no-match, loading, and error without treating a failed fetch as empty', async () => {
    const fetchMock = installConsoleFetch({
      list: () => ({ orders: [], nextCursor: null, hasAnyOrders: false }),
    });
    await renderApp();
    expect(container.textContent).toContain('No Orders have been placed.');

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname.startsWith('/api/console/products')) return json({ products: [] });
      if (url.pathname === '/api/console/orders') {
        if (url.searchParams.get('q') === 'absent') {
          return json({ orders: [], nextCursor: null, hasAnyOrders: true });
        }
        return errorEnvelope(500, 'order_operation_failed', 'The Orders could not be loaded.');
      }
      throw new Error(`Unexpected request ${url.href}`);
    });
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    await act(async () => {
      if (!search) return;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(search, 'absent');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    expect(container.textContent).toContain('No Orders match these filters.');
    expect(buttonNamed('Clear filters')).toBeTruthy();
    expect(container.textContent).not.toContain('No Orders have been placed.');

    await act(async () => { buttonNamed('Clear filters')?.click(); });
    await flush();
    expect(container.textContent).toContain('Orders could not be loaded');
    expect(container.textContent).not.toContain('No Orders have been placed.');
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
