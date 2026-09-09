import { act, createElement } from 'react';
import type { ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
let StorefrontApp: ComponentType;

const simpleProduct = {
  id: 'prod_simple1234', slug: 'field-notes', name: 'Field Notes', currency: 'USD', basePriceMinor: 2400,
  minimumEffectivePriceMinor: 2400, maximumEffectivePriceMinor: 2400, publicDescription: 'A concise field guide.',
  optionGroups: [], variants: [],
};

const variantProduct = {
  ...simpleProduct,
  id: 'prod_variant1234', slug: 'signal-kit', name: 'Signal Kit', minimumEffectivePriceMinor: 2800,
  maximumEffectivePriceMinor: 3200,
  optionGroups: [{ id: 'group_format', name: 'Format', position: 0, values: [{ id: 'value_pdf', label: 'PDF', position: 0 }, { id: 'value_zip', label: 'ZIP', position: 1 }] }],
  variants: [{ id: 'var_pdf12345678', sku: 'SIGNAL-PDF', status: 'enabled' as const, selectedOptions: [{ groupId: 'group_format', valueId: 'value_pdf' }], effectivePriceMinor: 2800 }],
};

function numberedCatalogProducts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...simpleProduct,
    id: `prod_page${String(index + 1).padStart(8, '0')}`,
    slug: `catalog-item-${index + 1}`,
    name: `Catalog Item ${String(index + 1).padStart(2, '0')}`,
    publicDescription: `Public description ${index + 1}.`,
  }));
}


function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function customerOrder(overrides: Record<string, unknown> = {}) {
  return {
    reference: 'NX-260827-ABCD',
    paymentReference: 'NPABCDEF12345678',
    status: 'pending',
    items: [{
      id: 'line_1',
      position: 0,
      product: { id: simpleProduct.id, name: simpleProduct.name, variant: null },
      quantity: 1,
      unitPriceMinor: 2400,
      lineTotalMinor: 2400,
      currency: 'USD',
    }],
    totalMinor: 2400,
    currency: 'USD',
    createdAt: '2026-08-27T12:00:00.000Z',
    paymentNextStep: 'Payment instructions will be provided separately.',
    refundRequest: null,
    ...overrides,
  };
}

async function renderApp() {
  await act(async () => root.render(createElement(StorefrontApp)));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
beforeAll(async () => {
  vi.stubEnv('VITE_STOREFRONT_API_BASE_URL', 'https://store-api.example');
  // The module reads build-time Storefront configuration at evaluation, so this test imports after stubbing that boundary.
  ({ StorefrontApp } = await import('../../storefront/src/storefront-app'));
});

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  container.remove();
});

describe('Storefront Order contracts', () => {
  it('requires an enabled matching Variant and quantity from 1 to 99', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ store: { id: 'store_nexus', slug: 'nexus', name: 'Nexus Store' }, products: [variantProduct] })));
    await act(async () => root.render(createElement(StorefrontApp)));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const add = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Add to Order');
    const place = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Place Order');
    expect(add?.disabled).toBe(true);
    expect(place?.disabled).toBe(true);
    const select = container.querySelector('select');
    await act(async () => { if (select) { select.value = 'value_zip'; select.dispatchEvent(new Event('change', { bubbles: true })); } });
    expect(add?.disabled).toBe(true);
    await act(async () => { if (select) { select.value = 'value_pdf'; select.dispatchEvent(new Event('change', { bubbles: true })); } });
    expect(add?.disabled).toBe(false);
    const quantity = container.querySelector<HTMLInputElement>('#checkout-quantity');
    await act(async () => { if (quantity) setInput(quantity, '100'); });
    await act(async () => add?.click());
    expect(quantity?.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('Enter a whole number from 1 to 99.');
  });

  it('reuses one in-memory capability, payload, and cart for a lost-response retry', async () => {
    const calls: Array<{ url: string; headers: Headers; body: string }> = [];
    let postCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/storefront/products')) return response({ store: { id: 'store_nexus', slug: 'nexus', name: 'Nexus Store' }, products: [simpleProduct, variantProduct] });
      if (init?.method === 'POST') {
        calls.push({ url, headers: new Headers(init.headers), body: String(init.body ?? '') });
        postCount += 1;
        if (postCount === 1) throw new TypeError('lost response');
      }
      return response(customerOrder());
    }));
    await act(async () => root.render(createElement(StorefrontApp)));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const name = container.querySelector<HTMLInputElement>('#checkout-name');
    const email = container.querySelector<HTMLInputElement>('#checkout-email');
    await act(async () => { if (name) setInput(name, 'Ada Rivera'); if (email) setInput(email, 'ada@example.com'); });
    const add = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Add to Order');
    await act(async () => { add?.click(); await Promise.resolve(); });
    const variantChoice = Array.from(container.querySelectorAll<HTMLButtonElement>('button.catalog-choice')).find((button) => button.closest('.catalog-row')?.textContent?.includes('Signal Kit'));
    await act(async () => { variantChoice?.click(); await Promise.resolve(); });
    const select = container.querySelector('select');
    await act(async () => { if (select) { select.value = 'value_pdf'; select.dispatchEvent(new Event('change', { bubbles: true })); } });
    await act(async () => { add?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain('Field Notes');
    expect(container.textContent).toContain('Signal Kit');
    const place = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Place Order');
    await act(async () => { place?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('Retry to safely continue');
    expect(container.querySelector<HTMLInputElement>('#checkout-name')?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('#checkout-email')?.disabled).toBe(true);
    const cart = container.querySelector('#checkout-cart');
    expect(cart?.textContent).toContain('Field Notes');
    expect(cart?.textContent).toContain('Signal Kit');
    expect(Array.from(cart?.querySelectorAll<HTMLInputElement>('input') ?? []).every((input) => input.disabled)).toBe(true);
    expect(Array.from(cart?.querySelectorAll<HTMLButtonElement>('button') ?? []).every((button) => button.disabled)).toBe(true);
    const addLocked = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Add to Order');
    expect(addLocked?.disabled).toBe(true);
    await act(async () => {
      addLocked?.click();
      cart?.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.click());
    });
    expect(cart?.querySelectorAll('li')).toHaveLength(2);
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Retry checkout');
    await act(async () => { retry?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.get('Idempotency-Key')).toBe(calls[0].headers.get('Idempotency-Key'));
    expect(calls[1].headers.get('X-Nexus-Order-Capability')).toBe(calls[0].headers.get('X-Nexus-Order-Capability'));
    expect(calls[0].headers.get('X-Nexus-Order-Contract')).toBe('2');
    expect(calls[1].body).toBe(calls[0].body);
    const payload = JSON.parse(calls[0].body) as { items: Array<{ productId: string; variantId: string | null; quantity: number }> };
    expect(payload.items).toEqual([
      { productId: simpleProduct.id, variantId: null, quantity: 1 },
      { productId: variantProduct.id, variantId: 'var_pdf12345678', quantity: 1 },
    ]);
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/orders/NX-260827-ABCD');
    expect(window.location.hash).toMatch(/^#capability=/);
    expect(container.textContent).not.toContain(calls[0].headers.get('X-Nexus-Order-Capability'));
  });

  it('shows reload guidance for an outdated contract and does not retry checkout', async () => {
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/storefront/products')) return response({ store: { id: 'store_nexus', slug: 'nexus', name: 'Nexus Store' }, products: [simpleProduct] });
      if (init?.method === 'POST') {
        posts.push(String(init.body ?? ''));
        return response({ error: { code: 'client_contract_outdated', message: 'This client is out of date. Reload the page and try again.', fields: [], incidentId: null } }, 409);
      }
      return response(customerOrder());
    }));
    await renderApp();
    const name = container.querySelector<HTMLInputElement>('#checkout-name');
    const email = container.querySelector<HTMLInputElement>('#checkout-email');
    await act(async () => { if (name) setInput(name, 'Ada Rivera'); if (email) setInput(email, 'ada@example.com'); });
    const add = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Add to Order');
    await act(async () => { add?.click(); await Promise.resolve(); });
    const place = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Place Order');
    await act(async () => { place?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('This Storefront is out of date');
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Retry checkout' || button.textContent === 'Place Order');
    expect(retry?.disabled).toBe(true);
    await act(async () => { retry?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(posts).toHaveLength(1);
    expect(container.textContent).toContain('Reload Storefront');
  });

  it('renders only the Customer-safe private projection and server-returned money', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(customerOrder({
      items: [{
        id: 'line_1',
        position: 0,
        product: { id: simpleProduct.id, name: simpleProduct.name, variant: null },
        quantity: 2,
        unitPriceMinor: 2400,
        lineTotalMinor: 4701,
        currency: 'USD',
      }],
      totalMinor: 4701,
      accessInstructions: 'private',
      privateFileKey: 'secret-key',
    }))));
    await act(async () => root.render(createElement(StorefrontApp)));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('$47.01');
    expect(container.textContent).toContain('Payment instructions will be provided separately.');
    expect(container.textContent).not.toContain('private');
    expect(container.textContent).not.toContain('secret-key');
    expect(container.textContent).not.toContain('opaque_capability');
  });

  it('shows payment next step only while pending and hides the refund form', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(customerOrder())));
    await renderApp();
    expect(container.textContent).toContain('Pending');
    expect(container.textContent).toContain('Payment instructions will be provided separately.');
    expect(container.querySelector('#refund-reason')).toBeNull();
    expect(container.textContent).not.toContain('Send refund request');
  });

  it('refreshes a hidden private Order and offers a refund after Paid', async () => {
    let gets = 0;
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn(async () => {
      gets += 1;
      return response(customerOrder(gets === 1 ? {} : { status: 'paid', paymentNextStep: null }));
    }));
    await renderApp();
    expect(container.querySelector('#refund-reason')).toBeNull();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('#refund-reason')).not.toBeNull();
    expect(container.textContent).toContain('This page does not deliver files or pay out a refund.');
  });

  it('ignores a deferred pre-write GET that resolves after refund', async () => {
    let gets = 0;
    let releaseStale: (() => void) | undefined;
    const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
    const completed = customerOrder({ status: 'paid', paymentNextStep: null });
    const pendingRefund = {
      id: 'rr_ack',
      status: 'pending' as const,
      reason: 'Wrong size',
      createdAt: '2026-08-27T13:00:00.000Z',
    };
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('refund-requests')) {
        return response({
          reference: 'NX-260827-ABCD',
          action: 'request_refund',
          status: 'paid',
          occurredAt: '2026-08-27T13:00:00.000Z',
          refundRequest: pendingRefund,
        });
      }
      gets += 1;
      if (gets === 2) {
        await staleGate;
        return response(completed);
      }
      return response(gets === 1 ? completed : { ...completed, refundRequest: pendingRefund });
    }));
    await renderApp();
    expect(container.querySelector('#refund-reason')).not.toBeNull();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => {
      for (let attempt = 0; attempt < 40 && gets < 2; attempt += 1) await Promise.resolve();
    });
    expect(gets).toBeGreaterThanOrEqual(2);
    const textarea = container.querySelector<HTMLTextAreaElement>('#refund-reason');
    await act(async () => { if (textarea) setTextarea(textarea, 'Wrong size'); });
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Send refund request');
    await act(async () => { send?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('Refund request pending');
    expect(container.querySelector('#refund-reason')).toBeNull();
    releaseStale?.();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('#refund-reason')).toBeNull();
    expect(container.textContent).toContain('Refund request pending');
    expect(container.textContent).toContain('Wrong size');
  });


  it('omits format instructions for Simple Products and filters the catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      store: { id: 'store_nexus', slug: 'nexus', name: 'Nexus Store' },
      products: [simpleProduct, variantProduct],
    })));
    await renderApp();
    expect(container.textContent).toContain('Choose Products, review the Order, then complete checkout.');
    expect(container.textContent).not.toContain('Choose Products, confirm each format, review the Order, then complete checkout.');
    const search = container.querySelector<HTMLInputElement>('#catalog-search');
    expect(search).not.toBeNull();
    await act(async () => {
      if (!search) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'Signal');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('.catalog-list')?.textContent).toContain('Signal Kit');
    expect(container.querySelector('.catalog-list')?.textContent).not.toContain('Field Notes');
  });

  it('lets paid Orders of any total request a refund and omits payment copy', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ZERO#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(customerOrder({
      reference: 'NX-260827-ZERO',
      status: 'paid',
      items: [{
        id: 'line_1',
        position: 0,
        product: { id: simpleProduct.id, name: simpleProduct.name, variant: null },
        quantity: 1,
        unitPriceMinor: 0,
        lineTotalMinor: 0,
        currency: 'USD',
      }],
      totalMinor: 0,
      paymentNextStep: null,
    }))));
    await renderApp();
    expect(container.textContent).toContain('This Order is paid. This page does not deliver files or pay out a refund.');
    expect(container.textContent).toContain('You can send one refund request. Sending a request does not issue a refund.');
    expect(container.textContent).not.toContain('Payment next step');
    expect(container.querySelector('#refund-reason')).not.toBeNull();
    expect(container.textContent).toContain('$0.00');
  });

  it('does not offer a refund form on a canceled Order', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(customerOrder({
      status: 'canceled',
      paymentNextStep: null,
    }))));
    await renderApp();
    expect(container.textContent).toContain('This Order has been canceled.');
    expect(container.querySelector('#refund-reason')).toBeNull();
  });

  it('replaces the form with the stored pending refund request', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(customerOrder({
      status: 'paid',
      paymentNextStep: null,
      refundRequest: {
        id: 'rr_stored',
        status: 'pending',
        reason: 'Original stored reason',
        createdAt: '2026-08-27T13:00:00.000Z',
      },
    }))));
    await renderApp();
    expect(container.textContent).toContain('Refund request pending');
    expect(container.textContent).toContain('Original stored reason');
    expect(container.textContent).toContain('Your request is pending. No refund has been issued.');
    expect(container.querySelector('#refund-reason')).toBeNull();
  });

  it('validates refund reason by Unicode code points', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    const fetchMock = vi.fn().mockResolvedValue(response(customerOrder({
      status: 'paid',
      paymentNextStep: null,
    })));
    vi.stubGlobal('fetch', fetchMock);
    await renderApp();
    const textarea = container.querySelector<HTMLTextAreaElement>('#refund-reason');
    await act(async () => { if (textarea) setTextarea(textarea, `${'n'.repeat(1001)}`); });
    expect(container.textContent).toContain('1001 / 1000');
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Send refund request');
    await act(async () => { send?.click(); });
    await act(async () => { await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); }); });
    expect(container.textContent).toContain('Enter a reason using 1 to 1000 characters.');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('refund-requests'))).toBe(false);
    expect(document.activeElement).toBe(container.querySelector('.error-summary'));
    const summaryLink = container.querySelector<HTMLAnchorElement>('.error-summary a');
    await act(async () => { summaryLink?.click(); });
    expect(window.location.hash).toMatch(/^#capability=/);
    expect(container.querySelector('#refund-reason')).not.toBeNull();
    expect(document.activeElement).toBe(container.querySelector('#refund-reason'));
  });

  it('reuses the frozen refund identity after a lost response', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    const posts: Array<{ headers: Headers; body: string }> = [];
    let postCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('refund-requests')) {
        posts.push({ headers: new Headers(init?.headers), body: String(init?.body ?? '') });
        postCount += 1;
        if (postCount === 1) throw new TypeError('lost response');
        return response({
          reference: 'NX-260827-ABCD',
          action: 'request_refund',
          status: 'paid',
          occurredAt: '2026-08-27T13:00:00.000Z',
          refundRequest: {
            id: 'rr_one',
            status: 'pending',
            reason: 'Keep this payload',
            createdAt: '2026-08-27T13:00:00.000Z',
          },
        });
      }
      return response(customerOrder({
        status: 'paid',
        paymentNextStep: null,
        refundRequest: postCount === 0 ? null : {
          id: 'rr_one',
          status: 'pending',
          reason: 'Keep this payload',
          createdAt: '2026-08-27T13:00:00.000Z',
        },
      }));
    }));
    await renderApp();
    const textarea = container.querySelector<HTMLTextAreaElement>('#refund-reason');
    await act(async () => { if (textarea) setTextarea(textarea, 'Keep this payload'); });
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Send refund request');
    await act(async () => { send?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('Retry the same request');
    expect(textarea?.disabled).toBe(true);
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Retry refund request');
    await act(async () => { retry?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(posts).toHaveLength(2);
    expect(posts[1].headers.get('Idempotency-Key')).toBe(posts[0].headers.get('Idempotency-Key'));
    expect(posts[1].headers.get('X-Nexus-Order-Capability')).toBe('opaque_capability_value_1234567890');
    expect(posts[0].body).toBe(posts[1].body);
    expect(container.textContent).toContain('Keep this payload');
    expect(container.textContent).toContain('Refund request pending');
  });

  it('displays the stored reason when a later key would send a different reason', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    let posted = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('refund-requests')) {
        posted = true;
        expect(String(init?.body)).toContain('Second reason');
        return response({
          reference: 'NX-260827-ABCD',
          action: 'request_refund',
          status: 'paid',
          occurredAt: '2026-08-27T13:00:00.000Z',
          refundRequest: {
            id: 'rr_one',
            status: 'pending',
            reason: 'First stored reason',
            createdAt: '2026-08-27T13:00:00.000Z',
          },
        });
      }
      return response(customerOrder({
        status: 'paid',
        paymentNextStep: null,
        refundRequest: posted ? {
          id: 'rr_one',
          status: 'pending',
          reason: 'First stored reason',
          createdAt: '2026-08-27T13:00:00.000Z',
        } : null,
      }));
    }));
    await renderApp();
    const textarea = container.querySelector<HTMLTextAreaElement>('#refund-reason');
    await act(async () => { if (textarea) setTextarea(textarea, 'Second reason'); });
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Send refund request');
    await act(async () => { send?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('First stored reason');
    expect(container.textContent).not.toContain('Second reason');
    expect(container.querySelector('#refund-reason')).toBeNull();
  });

  it('ignores a late previous Order refund after popstate', async () => {
    let resolveA: (value: Response) => void = () => undefined;
    const lateA = new Promise<Response>((resolve) => {
      resolveA = resolve;
    });
    window.history.replaceState({}, '', '/orders/NX-AAAAAAA0000001#capability=capability_order_a_secret_value_32xx');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('NX-AAAAAAA0000001')) return lateA;
      return response(customerOrder({
        reference: 'NX-BBBBBBB0000002',
        status: 'paid',
        items: [{
          id: 'line_b',
          position: 0,
          product: { id: simpleProduct.id, name: 'Order B', variant: null },
          quantity: 1,
          unitPriceMinor: 2400,
          lineTotalMinor: 2400,
          currency: 'USD',
        }],
        paymentNextStep: null,
      }));
    }));
    await renderApp();
    window.history.replaceState({}, '', '/orders/NX-BBBBBBB0000002#capability=capability_order_b_secret_value_32xx');
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
      await Promise.resolve();
      await Promise.resolve();
    });
    resolveA(response(customerOrder({
      reference: 'NX-AAAAAAA0000001',
      status: 'paid',
      items: [{
        id: 'line_a',
        position: 0,
        product: { id: simpleProduct.id, name: 'Order A', variant: null },
        quantity: 1,
        unitPriceMinor: 2400,
        lineTotalMinor: 2400,
        currency: 'USD',
      }],
      paymentNextStep: null,
      refundRequest: {
        id: 'rr_a',
        status: 'pending',
        reason: 'Reason A must not leak',
        createdAt: '2026-08-27T13:00:00.000Z',
      },
    })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('Order B');
    expect(container.textContent).not.toContain('Order A');
    expect(container.textContent).not.toContain('Reason A must not leak');
  });

  it('keeps the generic private failure when capability is wrong', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=wrong_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      error: { code: 'not_found', message: 'Order not found.', fields: [], incidentId: null },
    }, 404)));
    await renderApp();
    expect(container.textContent).toContain('Order could not be loaded');
    expect(container.textContent).not.toContain('Refund request');
    expect(container.textContent).not.toContain('not_found');
  });

  it('does not claim refund success when a conflict refresh fails', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('refund-requests')) {
        return response({
          error: { code: 'order_state_conflict', message: 'The Order state does not allow this action.', fields: [], incidentId: null },
        }, 409);
      }
      getCount += 1;
      if (getCount > 1) return response({ error: { code: 'order_operation_failed', message: 'unavailable', fields: [], incidentId: null } }, 500);
      return response(customerOrder({ status: 'paid', paymentNextStep: null }));
    }));
    await renderApp();
    const textarea = container.querySelector<HTMLTextAreaElement>('#refund-reason');
    await act(async () => { if (textarea) setTextarea(textarea, 'Please reverse this.'); });
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Send refund request');
    await act(async () => { send?.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('The request was not applied. The Order has changed.');
    expect(container.textContent).not.toContain('The request succeeded, but the latest Order could not be loaded.');
  });

  it('paginates the catalog 24 Products per page with distinct top and bottom controls', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      store: { id: 'store_nexus', slug: 'nexus', name: 'Nexus Store' },
      products: numberedCatalogProducts(30),
    })));
    await renderApp();
    expect(container.querySelectorAll('.catalog-row')).toHaveLength(24);
    expect(container.querySelector('.catalog-list')?.textContent).toContain('Catalog Item 01');
    expect(container.querySelector('.catalog-list')?.textContent).toContain('Catalog Item 24');
    expect(container.querySelector('.catalog-list')?.textContent).not.toContain('Catalog Item 25');
    expect(container.querySelector('[aria-label="Catalog pages, top"]')?.textContent).toContain('Showing 1–24 of 30');
    expect(container.querySelector('[aria-label="Catalog pages, top"]')?.textContent).toContain('Page 1 of 2');
    expect(container.querySelector('[aria-label="Catalog pages, bottom"]')?.textContent).toContain('Showing 1–24 of 30');
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Previous catalog page, top"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Next catalog page, top"]')?.disabled).toBe(false);
    expect(container.querySelector('.catalog-benchmark')?.textContent).toContain('30');
    const nextBottom = container.querySelector<HTMLButtonElement>('[aria-label="Next catalog page, bottom"]');
    await act(async () => { nextBottom?.click(); await Promise.resolve(); });
    expect(container.querySelectorAll('.catalog-row')).toHaveLength(6);
    expect(container.querySelector('.catalog-list')?.textContent).toContain('Catalog Item 25');
    expect(container.querySelector('.catalog-list')?.textContent).toContain('Catalog Item 30');
    expect(container.querySelector('.catalog-list')?.textContent).not.toContain('Catalog Item 24');
    expect(container.querySelector('[aria-label="Catalog pages, bottom"]')?.textContent).toContain('Showing 25–30 of 30');
    expect(container.querySelector('[aria-label="Catalog pages, bottom"]')?.textContent).toContain('Page 2 of 2');
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Next catalog page, bottom"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Previous catalog page, bottom"]')?.disabled).toBe(false);
    expect(scrollIntoView).toHaveBeenCalled();
    const search = container.querySelector<HTMLInputElement>('#catalog-search');
    await act(async () => { if (search) setInput(search, 'no-such-product'); });
    expect(container.querySelectorAll('.catalog-row')).toHaveLength(0);
    expect(container.querySelector('[aria-label="Catalog pages, top"]')).toBeNull();
    expect(container.querySelector('[aria-label="Catalog pages, bottom"]')).toBeNull();
    expect(container.textContent).toContain('No Products match this search.');
  });

  it('keeps checkout selection and cart across catalog pages and resets page on filter changes', async () => {
    let postCount = 0;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/storefront/products')) {
        return response({
          store: { id: 'store_nexus', slug: 'nexus', name: 'Nexus Store' },
          products: [variantProduct, ...numberedCatalogProducts(30)],
        });
      }
      if (init?.method === 'POST') {
        postCount += 1;
        calls.push(String(init.body ?? ''));
        if (postCount === 1) throw new TypeError('lost response');
      }
      return response(customerOrder());
    }));
    await renderApp();
    const name = container.querySelector<HTMLInputElement>('#checkout-name');
    const email = container.querySelector<HTMLInputElement>('#checkout-email');
    const quantity = container.querySelector<HTMLInputElement>('#checkout-quantity');
    const select = container.querySelector('select');
    await act(async () => {
      if (name) setInput(name, 'Ada Rivera');
      if (email) setInput(email, 'ada@example.com');
      if (quantity) setInput(quantity, '4');
      if (select) {
        select.value = 'value_pdf';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    const add = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Add to Order');
    await act(async () => { add?.click(); await Promise.resolve(); });
    const place = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Place Order');
    await act(async () => { place?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('Retry to safely continue');
    const nextBottom = container.querySelector<HTMLButtonElement>('[aria-label="Next catalog page, bottom"]');
    await act(async () => { nextBottom?.click(); await Promise.resolve(); });
    expect(container.querySelector('.catalog-list')?.textContent).not.toContain('Signal Kit');
    expect(container.querySelector('.purchase-ledger')?.textContent).toContain('Signal Kit');
    expect(container.querySelector('select')?.value).toBe('value_pdf');
    expect(container.querySelector<HTMLInputElement>('#checkout-quantity')?.value).toBe('4');
    expect(container.querySelector<HTMLInputElement>('#checkout-name')?.value).toBe('Ada Rivera');
    expect(container.querySelector<HTMLInputElement>('#checkout-email')?.value).toBe('ada@example.com');
    expect(container.querySelector('#checkout-cart')?.textContent).toContain('Signal Kit');
    expect(container.querySelector<HTMLInputElement>('#checkout-name')?.disabled).toBe(true);
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Retry checkout');
    expect(retry).not.toBeUndefined();
    const search = container.querySelector<HTMLInputElement>('#catalog-search');
    await act(async () => { if (search) setInput(search, 'Catalog Item 30'); });
    expect(container.querySelectorAll('.catalog-row')).toHaveLength(1);
    expect(container.querySelector('[aria-label="Catalog pages, top"]')?.textContent).toContain('Showing 1–1 of 1');
    expect(container.querySelector('[aria-label="Catalog pages, top"]')?.textContent).toContain('Page 1 of 1');
    expect(container.querySelector('#checkout-cart')?.textContent).toContain('Signal Kit');
    await act(async () => { if (search) setInput(search, ''); });
    const simple = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Simple');
    await act(async () => { simple?.click(); });
    expect(container.querySelectorAll('.catalog-row')).toHaveLength(24);
    expect(container.querySelector('.catalog-list')?.textContent).not.toContain('Signal Kit');
    expect(container.querySelector('[aria-label="Catalog pages, top"]')?.textContent).toContain('Page 1 of 2');
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Next catalog page, top"]')?.click(); });
    expect(container.querySelector('[aria-label="Catalog pages, top"]')?.textContent).toContain('Page 2 of 2');
    window.history.replaceState({}, '', '/?q=Catalog%20Item%2001');
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(container.querySelectorAll('.catalog-row')).toHaveLength(1);
    expect(container.querySelector('.catalog-list')?.textContent).toContain('Catalog Item 01');
    expect(container.querySelector('[aria-label="Catalog pages, top"]')?.textContent).toContain('Page 1 of 1');
    expect(container.querySelector('#checkout-cart')?.textContent).toContain('Signal Kit');
    expect(retry?.textContent).toBe('Retry checkout');
    expect(calls).toHaveLength(1);
  });
});
