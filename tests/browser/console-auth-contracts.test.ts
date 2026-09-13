import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionConsoleApp } from '../../apps/console/src/production-console-app';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const ownerSession = {
  user: { id: 'user_owner_alpha', name: 'Owner Alpha' },
  store: { id: 'store_alpha', name: 'Alpha Store' },
  role: 'owner',
  allowedActions: [
    'catalog:read', 'catalog:write', 'catalog:import', 'catalog:file:read', 'catalog:file:write',
    'catalog:remove', 'order:read', 'order:process', 'order:assign', 'staff:list', 'refund:request',
    'refund:decide',
  ],
};

const staffSession = {
  user: { id: 'user_staff_alpha', name: 'Staff Alpha' },
  store: { id: 'store_alpha', name: 'Alpha Store' },
  role: 'staff',
  allowedActions: ['catalog:read', 'catalog:file:read', 'order:read', 'order:process', 'refund:request'],
};

const oldOrder = {
  reference: 'NX-OLD-IDENTITY-01',
  paymentReference: 'NPOLDIDENTITY001',
  status: 'pending',
  items: [{
    id: 'line_old', position: 0, product: { id: 'prod_old', name: 'Old private product', variant: null },
    quantity: 1, unitPriceMinor: 2400, lineTotalMinor: 2400, currency: 'USD',
  }],
  customer: { name: 'Old Identity Customer', email: 'old-identity@example.test' },
  totalMinor: 2400,
  currency: 'USD',
  createdAt: '2026-09-12T08:00:00.000Z',
  refundRequestStatus: null,
};

const oldOrderDetail = {
  ...oldOrder,
  allowedActions: ['mark_paid', 'cancel'],
  refundRequest: null,
  history: [{
    action: 'order_created', source: 'storefront', actorId: 'customer_old', actorLabel: 'Customer',
    contractVersion: 2, fromStatus: null, toStatus: 'pending', createdAt: oldOrder.createdAt,
  }],
  payment: null,
  paymentRecordState: 'none',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authError(status = 401, code = 'unauthenticated'): Response {
  return json({ error: { code, message: 'Sign in to continue.', fields: [], incidentId: null } }, status);
}

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, 'http://console.local');
  return `${url.pathname}${url.search}`;
}

function stubFetch(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(requestPath(input), init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`Timed out waiting for ${message}.`);
}

function buttonNamed(pattern: RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => pattern.test(button.textContent?.trim() ?? ''));
}

async function renderApp(): Promise<void> {
  await act(async () => root.render(createElement(ProductionConsoleApp)));
}

async function enter(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/console/products');
  container = document.createElement('div');
  container.style.width = '375px';
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await act(async () => root.unmount());
  container.remove();
});

describe('Console authentication and role contracts', () => {
  it('shows the signed-out form and performs no private reads before session success', async () => {
    const calls: string[] = [];
    stubFetch((path) => {
      calls.push(path);
      if (path === '/api/console/session') return authError();
      if (path.startsWith('/api/console/products')) return json({ products: [] });
      if (path.startsWith('/api/console/orders')) return json({
        orders: [], summary: { totalOrders: 0, byStatus: { pending: 0, paid: 0, fulfilled: 0, canceled: 0 }, openRefundRequests: 0 },
        nextCursor: null, hasOrders: false,
      });
      return json({ error: { code: 'route_not_found' } }, 404);
    });

    await renderApp();
    await flush();

    expect(calls).toEqual(['/api/console/session']);
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(buttonNamed(/^continue with google$/i)).toBeDefined();
    expect(container.textContent).not.toContain('Store operator');
  });

  it('starts Google OAuth without loading private data before the callback session exists', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    stubFetch((path, init) => {
      calls.push({ path, init });
      if (path === '/api/console/session') return authError();
      if (path === '/api/auth/sign-in/social') return json({
        url: 'https://accounts.google.com/o/oauth2/v2/auth?state=test-state',
        redirect: true,
      });
      if (path.startsWith('/api/console/products')) return json({ products: [] });
      return json({ error: { code: 'route_not_found' } }, 404);
    });

    await renderApp();
    await waitUntil(() => Boolean(buttonNamed(/^continue with google$/i)), 'the Google sign-in action');
    expect(calls.filter(({ path }) => path.startsWith('/api/console/products') || path.startsWith('/api/console/orders'))).toHaveLength(0);
    await act(async () => buttonNamed(/^continue with google$/i)?.click());
    await waitUntil(() => calls.some(({ path }) => path === '/api/auth/sign-in/social'), 'the OAuth request');
    expect(calls.map(({ path }) => path)).toEqual(['/api/console/session', '/api/auth/sign-in/social']);
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      provider: 'google',
      callbackURL: '/console/products',
      errorCallbackURL: '/console/login?error=google_sign_in_failed',
    });
    expect(calls.filter(({ path }) => path.startsWith('/api/console/products'))).toHaveLength(0);
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  });

  it('keeps Unicode identity and Store text readable without 375px overflow', async () => {
    const unicodeSession = {
      ...ownerSession,
      user: { ...ownerSession.user, name: 'Nguyễn Ánh · 東京' },
      store: { ...ownerSession.store, name: 'Cửa hàng Sách Điện tử' },
    };
    stubFetch((path) => {
      if (path === '/api/console/session') return json(unicodeSession);
      if (path === '/api/console/products') return json({ products: [] });
      return json({ error: { code: 'route_not_found' } }, 404);
    });

    await renderApp();
    await waitUntil(() => container.textContent?.includes('Nguyễn Ánh · 東京') ?? false, 'the Unicode identity');

    expect(container.textContent).toContain('Cửa hàng Sách Điện tử');
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    expect(buttonNamed(/^add product$/i)?.classList.contains('button-primary')).toBe(true);
  });

  it('clears private content on sign-out and ignores a delayed response from the old identity', async () => {
    window.history.replaceState({}, '', '/console/orders');
    let resolveOldDetail!: (response: Response) => void;
    const oldDetail = new Promise<Response>((resolve) => { resolveOldDetail = resolve; });
    stubFetch((path) => {
      if (path === '/api/console/session') return json(ownerSession);
      if (path.startsWith('/api/console/orders?')) return json({
        orders: [oldOrder],
        summary: { totalOrders: 1, byStatus: { pending: 1, paid: 0, fulfilled: 0, canceled: 0 }, openRefundRequests: 0 },
        nextCursor: null,
        hasOrders: true,
      });
      if (path === `/api/console/orders/${oldOrder.reference}`) return oldDetail;
      if (path === '/api/auth/sign-out') return json({ ok: true });
      return json({ error: { code: 'route_not_found' } }, 404);
    });

    await renderApp();
    await waitUntil(() => container.textContent?.includes('Old Identity Customer') ?? false, 'old private Order content');
    const orderLink = Array.from(container.querySelectorAll<HTMLAnchorElement>('a'))
      .find((link) => link.textContent?.trim() === oldOrder.reference);
    if (!orderLink) throw new Error('Expected the old private Order link.');
    await act(async () => orderLink.click());
    await waitUntil(() => Boolean(buttonNamed(/^sign out$/i)), 'the sign-out control');
    await act(async () => buttonNamed(/^sign out$/i)?.click());
    await waitUntil(() => Boolean(buttonNamed(/^continue with google$/i)), 'signed-out UI');

    resolveOldDetail(json({ order: oldOrderDetail }));
    await flush();
    expect(container.textContent).not.toContain(oldOrder.reference);
    expect(container.textContent).not.toContain('Old Identity Customer');
    expect(container.textContent).not.toContain('old-identity@example.test');
    expect(buttonNamed(/^continue with google$/i)).toBeDefined();
  });

  it('does not commit a delayed Product create after sign-out changes identity generation', async () => {
    window.history.replaceState({}, '', '/console/products/new');
    let resolveCreate!: (response: Response) => void;
    const deferredCreate = new Promise<Response>((resolve) => { resolveCreate = resolve; });
    stubFetch((path) => {
      if (path === '/api/console/session') return json(ownerSession);
      if (path === '/api/console/products') return deferredCreate;
      if (path === '/api/auth/sign-out') return json({ ok: true });
      return json({ error: { code: 'route_not_found', message: 'Not found', fields: [], incidentId: null } }, 404);
    });

    await renderApp();
    await waitUntil(() => container.querySelector('#product-name') !== null, 'the Product editor');
    for (const [labelText, value] of [
      ['Product name', 'Old identity draft'],
      ['Base price', '12.00'],
      ['Private access title', 'Download'],
      ['Private access instructions', 'Open the file'],
    ] as const) {
      const label = Array.from(container.querySelectorAll('label')).find((candidate) => candidate.textContent?.includes(labelText));
      const input = label?.htmlFor ? container.querySelector(`#${CSS.escape(label.htmlFor)}`) as HTMLInputElement | HTMLTextAreaElement | null : null;
      if (!input) throw new Error(`Missing ${labelText}`);
      await enter(input, value);
    }
    await act(async () => buttonNamed(/^save product$/i)?.click());
    await waitUntil(() => container.textContent?.includes('Saving Product') ?? false, 'the pending Product create');
    await act(async () => buttonNamed(/^sign out$/i)?.click());
    await waitUntil(() => Boolean(buttonNamed(/^continue with google$/i)), 'signed-out UI');

    resolveCreate(json({ product: {
      id: 'prod_old_identity', slug: 'old-identity-draft', name: 'Old identity draft', status: 'draft', type: 'simple',
      currency: 'USD', basePriceMinor: 1200, publicDescription: '', delivery: { accessTitle: 'Download', accessInstructions: 'Open the file', file: { present: false } },
      optionGroups: [], variants: [], updatedAt: '2026-09-12T00:00:00.000Z', revision: 1,
    } }));
    await flush();
    expect(window.location.pathname).toBe('/console/products');
    expect(container.textContent).not.toContain('Old identity draft');
  });

  it('quarantines old private data and revalidates identity when the page becomes visible', async () => {
    let currentSession = ownerSession;
    stubFetch((path) => {
      if (path === '/api/console/session') return json(currentSession);
      if (path === '/api/console/products') return json({ products: currentSession.role === 'owner' ? [{
        id: 'private_owner_product', slug: 'owner-only', name: 'Owner private Product', status: 'draft', type: 'simple', currency: 'USD',
        minimumEffectivePriceMinor: 100, maximumEffectivePriceMinor: 100, enabledVariantCount: null, updatedAt: '2026-09-12T00:00:00.000Z', revision: 1,
      }] : [] });
      return json({});
    });
    await renderApp();
    await waitUntil(() => container.textContent?.includes('Owner private Product') ?? false, 'Owner private data');
    currentSession = staffSession;
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await waitUntil(() => container.textContent?.includes('Staff Alpha') ?? false, 'the replacement identity');
    expect(container.textContent).not.toContain('Owner private Product');
    expect(container.textContent).toContain('Read-only Product catalog');
  });

  it('waits for sign-out cookie deletion before exposing a replacement sign-in form', async () => {
    let resolveSignOut!: (response: Response) => void;
    const delayedSignOut = new Promise<Response>((resolve) => { resolveSignOut = resolve; });
    let sessionReads = 0;
    stubFetch((path) => {
      if (path === '/api/console/session') {
        sessionReads += 1;
        return json(ownerSession);
      }
      if (path === '/api/console/products') return json({ products: [] });
      if (path === '/api/auth/sign-out') return delayedSignOut;
      return json({});
    });
    await renderApp();
    await waitUntil(() => Boolean(buttonNamed(/^sign out$/i)), 'sign-out');
    await act(async () => buttonNamed(/^sign out$/i)?.click());
    expect(buttonNamed(/^continue with google$/i)).toBeUndefined();
    expect(container.textContent).toContain('Checking Console session');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await flush();
    expect(sessionReads).toBe(1);
    expect(container.textContent).toContain('Checking Console session');
    resolveSignOut(json({ ok: true }));
    await waitUntil(() => Boolean(buttonNamed(/^continue with google$/i)), 'sign-in after logout completion');
    expect(container.textContent).not.toContain('Owner Alpha');
  });

  it('ignores a delayed Owner Product denial after revalidation activates Staff', async () => {
    window.history.replaceState({}, '', '/console/products/new');
    let currentSession = ownerSession;
    let resolveCreate!: (response: Response) => void;
    const deferredCreate = new Promise<Response>((resolve) => { resolveCreate = resolve; });
    stubFetch((path) => {
      if (path === '/api/console/session') return json(currentSession);
      if (path === '/api/console/products' && currentSession.role === 'owner') return deferredCreate;
      if (path === '/api/console/products') return json({ products: [] });
      return json({ error: { code: 'route_not_found', message: 'Not found', fields: [], incidentId: null } }, 404);
    });

    await renderApp();
    await waitUntil(() => container.querySelector('#product-name') !== null, 'the Owner Product editor');
    for (const [labelText, value] of [
      ['Product name', 'Owner pending draft'],
      ['Base price', '12.00'],
      ['Private access title', 'Download'],
      ['Private access instructions', 'Open the file'],
    ] as const) {
      const label = Array.from(container.querySelectorAll('label')).find((candidate) => candidate.textContent?.includes(labelText));
      const input = label?.htmlFor ? container.querySelector(`#${CSS.escape(label.htmlFor)}`) as HTMLInputElement | HTMLTextAreaElement | null : null;
      if (!input) throw new Error(`Missing ${labelText}`);
      await enter(input, value);
    }
    await act(async () => buttonNamed(/^save product$/i)?.click());
    await waitUntil(() => container.textContent?.includes('Saving Product') ?? false, 'the pending Owner Product create');

    currentSession = staffSession;
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await waitUntil(() => container.textContent?.includes('Staff Alpha') ?? false, 'Staff identity activation');
    resolveCreate(authError());
    await flush();

    expect(window.location.pathname).toBe('/console/products');
    expect(container.textContent).toContain('Staff Alpha');
    expect(container.textContent).toContain('Read-only Product catalog');
    expect(buttonNamed(/^continue with google$/i)).toBeUndefined();
    expect(container.textContent).not.toContain('Owner pending draft');
  });

  it('clears Product and CSV private state when a private endpoint denies the session', async () => {
    window.history.replaceState({}, '', '/console/products/import');
    stubFetch((path) => {
      if (path === '/api/console/session') return json(ownerSession);
      if (path === '/api/console/products') return authError();
      return json({});
    });
    await renderApp();
    await waitUntil(() => Boolean(buttonNamed(/^continue with google$/i)), 'session reset after private denial');
    expect(container.textContent).not.toContain('Import Products from CSV');
    expect(container.textContent).not.toContain('Retry catalog identities');
    expect(window.location.pathname).toBe('/console/products/import');
  });

  it.each([
    '/console/products/private-owner-draft',
    '/console/products/import',
  ])('recovers Staff direct route %s to read-only Products', async (directPath) => {
    window.history.replaceState({}, '', directPath);
    const calls: string[] = [];
    stubFetch((path) => {
      calls.push(path);
      if (path === '/api/console/session') return json(staffSession);
      if (path === '/api/console/products') return json({ products: [] });
      if (path.startsWith('/api/console/products/')) return json({ error: { code: 'forbidden' } }, 403);
      return json({ error: { code: 'route_not_found' } }, 404);
    });

    await renderApp();
    await waitUntil(() => window.location.pathname === '/console/products', 'Staff route recovery');
    await flush();

    expect(calls[0]).toBe('/api/console/session');
    expect(calls).toContain('/api/console/products');
    expect(calls.some((path) => path.startsWith('/api/console/products/private-owner-draft'))).toBe(false);
    expect(container.textContent).toContain('Staff Alpha');
    expect(container.textContent).toContain('Alpha Store');
    expect(container.textContent).toMatch(/read.only/i);
    expect(buttonNamed(/add product/i)).toBeUndefined();
    expect(buttonNamed(/import csv/i)).toBeUndefined();
    expect(buttonNamed(/^edit$/i)).toBeUndefined();
    expect(container.textContent).not.toContain('Create your first Product or import a prepared CSV.');
  });
});
