import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionConsoleApp } from '../../apps/console/src/production-console-app';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const ownerSession = {
  user: { id: 'user_owner_logs', name: 'Owner Logs' },
  store: { id: 'store_nexus', name: 'Nexus' },
  role: 'owner',
  allowedActions: ['catalog:read', 'order:read', 'provider-events:read'],
};

const staffSession = {
  user: { id: 'user_staff_logs', name: 'Staff Logs' },
  store: { id: 'store_nexus', name: 'Nexus' },
  role: 'staff',
  allowedActions: ['catalog:read', 'order:read'],
};

const logResponse = {
  events: [{
    id: 'provider_event_01',
    type: 'payment',
    provider: 'payfs',
    providerEventId: 'transaction_01',
    payloadJson: '{"transaction_id":"transaction_01","amount":14000}',
    order: { reference: 'NX-LOG-ORDER-01', status: 'paid' },
    receivedAt: '2026-09-15T10:00:00.000Z',
  }],
  nextCursor: null,
  hasEvents: true,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, 'http://console.test').pathname;
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

beforeEach(() => {
  window.history.replaceState({}, '', '/console/provider-events');
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

describe('Console third-party log navigation', () => {
  it('gives the Owner a dedicated direct route, desktop destination, and compact menu', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path === '/api/console/session') return response(ownerSession);
      if (path === '/api/console/provider-events') return response(logResponse);
      throw new Error(`Unexpected request ${path}`);
    }));

    await act(async () => root.render(createElement(ProductionConsoleApp)));
    await waitUntil(() => (container.textContent ?? '').includes('provider_event_01'), 'provider event payload');
    await waitUntil(() => container.querySelector('h1')?.textContent === 'Third-party logs', 'third-party log screen');
    expect(window.location.pathname).toBe('/console/provider-events');
    expect(container.querySelector('.console-nav [aria-current="page"]')?.textContent).toContain('Third-party logs');
    expect(container.textContent).toContain('provider_event_01');
    expect(container.textContent).toContain('"transaction_id":"transaction_01"');
    expect(container.querySelector('.provider-event-mobile')?.textContent).toContain('NX-LOG-ORDER-01 · paid');

    const menu = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Menu');
    await act(async () => menu?.click());
    expect(container.querySelector('#compact-console-nav')?.textContent).toContain('Third-party logs');
  });

  it('returns Staff direct navigation to Products without requesting or exposing provider logs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path === '/api/console/session') return response(staffSession);
      if (path === '/api/console/products') return response({ products: [] });
      if (path === '/api/console/provider-events') throw new Error('Staff must not request provider logs.');
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => root.render(createElement(ProductionConsoleApp)));
    await waitUntil(() => container.querySelector('h1')?.textContent === 'Products', 'staff Product redirect');
    expect(window.location.pathname).toBe('/console/products');
    expect(container.textContent).not.toContain('Third-party logs');
    expect(fetchMock.mock.calls.map(([input]) => pathOf(input as RequestInfo | URL))).not.toContain('/api/console/provider-events');
  });
});
