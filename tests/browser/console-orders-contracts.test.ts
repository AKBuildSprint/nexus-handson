import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionConsoleApp } from '../../src/console/production-console-app';
import { OrdersScreen } from '../../src/console/orders/orders-screen';
import type { ConsoleOrderView } from '../../src/console/orders/order-ui-types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const safeOrder: ConsoleOrderView = {
  reference: 'NX-260827-ABCD', status: 'pending_payment',
  product: { id: 'prod_simple1234', name: 'Field Notes', variant: null },
  customer: { name: 'Ada Rivera', email: 'ada@example.com' },
  quantity: 2, unitPriceMinor: 2400, totalMinor: 4701, currency: 'USD', createdAt: '2026-08-27T12:00:00.000Z',
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    await act(async () => root.render(createElement(OrdersScreen, { state: 'ready', orders: [unsafe], onRetry: () => undefined })));
    expect(container.querySelector('.orders-table')?.textContent).toContain('NX-260827-ABCD');
    expect(container.querySelector('.order-list-mobile')?.textContent).toContain('ada@example.com');
    expect(container.querySelector('.order-list-mobile')?.textContent).toContain('$47.01');
    expect(container.textContent).not.toContain('opaque-secret');
    expect(container.textContent).not.toContain('private-file');
    expect(container.textContent).not.toContain('internal delivery');
  });

  it('provides durable loading, empty, and error regions', async () => {
    await act(async () => root.render(createElement(OrdersScreen, { state: 'loading', orders: [], onRetry: () => undefined })));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => root.render(createElement(OrdersScreen, { state: 'empty', orders: [], onRetry: () => undefined })));
    expect(container.textContent).toContain('No Orders have been placed.');
    const retry = vi.fn();
    await act(async () => root.render(createElement(OrdersScreen, { state: 'error', orders: [], onRetry: retry })));
    const retryButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Retry loading Orders');
    await act(async () => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it('supports direct Orders URLs, destination navigation, and popstate restoration', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/console/orders') return response({ orders: [safeOrder] });
      if (url.startsWith('/api/console/products')) return response({ products: [] });
      throw new Error(`Unexpected request ${url}`);
    }));
    await act(async () => { root.render(createElement(ProductionConsoleApp)); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('h1')?.textContent).toBe('Orders');
    expect(container.querySelector('.console-nav [aria-current="page"]')?.textContent).toContain('Orders');
    const products = Array.from(container.querySelectorAll<HTMLButtonElement>('.console-nav button')).find((button) => button.textContent === 'Products');
    await act(async () => { products?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(window.location.pathname).toBe('/console/products');
    expect(container.querySelector('h1')?.textContent).toBe('Products');
    window.history.pushState({}, '', '/console/orders');
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('h1')?.textContent).toBe('Orders');
  });
});
