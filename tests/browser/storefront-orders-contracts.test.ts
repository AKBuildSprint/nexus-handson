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
    status: 'pending_payment',
    product: { id: simpleProduct.id, name: simpleProduct.name, variant: null },
    quantity: 1,
    unitPriceMinor: 2400,
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
    const submit = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Place Order');
    expect(submit?.disabled).toBe(true);
    const select = container.querySelector('select');
    await act(async () => { if (select) { select.value = 'value_zip'; select.dispatchEvent(new Event('change', { bubbles: true })); } });
    expect(submit?.disabled).toBe(true);
    await act(async () => { if (select) { select.value = 'value_pdf'; select.dispatchEvent(new Event('change', { bubbles: true })); } });
    expect(submit?.disabled).toBe(false);
    const quantity = container.querySelector<HTMLInputElement>('#checkout-quantity');
    await act(async () => { if (quantity) setInput(quantity, '100'); });
    await act(async () => submit?.click());
    expect(quantity?.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('Enter a whole number from 1 to 99.');
  });

  it('reuses one in-memory capability and idempotency key for a lost-response retry', async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    let postCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/storefront/products')) return response({ store: { id: 'store_nexus', slug: 'nexus', name: 'Nexus Store' }, products: [simpleProduct] });
      if (init?.method === 'POST') {
        calls.push({ url, headers: new Headers(init.headers) });
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
    const place = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Place Order');
    await act(async () => { place?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('Retry to safely continue');
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Retry checkout');
    await act(async () => { retry?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.get('Idempotency-Key')).toBe(calls[0].headers.get('Idempotency-Key'));
    expect(calls[1].headers.get('X-Nexus-Order-Capability')).toBe(calls[0].headers.get('X-Nexus-Order-Capability'));
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/orders/NX-260827-ABCD');
    expect(window.location.hash).toMatch(/^#capability=/);
    expect(container.textContent).not.toContain(calls[0].headers.get('X-Nexus-Order-Capability'));
  });

  it('renders only the Customer-safe private projection and server-returned money', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(customerOrder({
      quantity: 2,
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
    expect(container.textContent).toContain('Pending payment');
    expect(container.textContent).toContain('Payment instructions will be provided separately.');
    expect(container.querySelector('#refund-reason')).toBeNull();
    expect(container.textContent).not.toContain('Send refund request');
  });

  it('refreshes a hidden private Order and offers a refund after Complete', async () => {
    let gets = 0;
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn(async () => {
      gets += 1;
      return response(customerOrder(gets === 1 ? {} : { status: 'completed', paymentNextStep: null }));
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
    const completed = customerOrder({ status: 'completed', paymentNextStep: null });
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
          status: 'completed',
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
    expect(container.textContent).toContain('Choose a Product, then complete checkout.');
    expect(container.textContent).not.toContain('Choose a Product, confirm the format, then complete checkout.');
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

  it('lets completed Orders of any total request a refund and omits payment copy', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ZERO#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(customerOrder({
      reference: 'NX-260827-ZERO',
      status: 'completed',
      unitPriceMinor: 0,
      totalMinor: 0,
      paymentNextStep: null,
    }))));
    await renderApp();
    expect(container.textContent).toContain('This Order has been completed. This page does not deliver files or pay out a refund.');
    expect(container.textContent).toContain('You can send one refund request. Sending a request does not issue a refund.');
    expect(container.textContent).not.toContain('Payment next step');
    expect(container.querySelector('#refund-reason')).not.toBeNull();
    expect(container.textContent).toContain('$0.00');
  });

  it('does not offer a refund form on a cancelled Order', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(customerOrder({
      status: 'cancelled',
      paymentNextStep: null,
    }))));
    await renderApp();
    expect(container.textContent).toContain('This Order has been cancelled.');
    expect(container.querySelector('#refund-reason')).toBeNull();
  });

  it('replaces the form with the stored pending refund request', async () => {
    window.history.replaceState({}, '', '/orders/NX-260827-ABCD#capability=opaque_capability_value_1234567890');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(customerOrder({
      status: 'completed',
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
      status: 'completed',
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
          status: 'completed',
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
        status: 'completed',
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
          status: 'completed',
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
        status: 'completed',
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
        status: 'completed',
        product: { id: simpleProduct.id, name: 'Order B', variant: null },
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
      status: 'completed',
      product: { id: simpleProduct.id, name: 'Order A', variant: null },
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
      return response(customerOrder({ status: 'completed', paymentNextStep: null }));
    }));
    await renderApp();
    const textarea = container.querySelector<HTMLTextAreaElement>('#refund-reason');
    await act(async () => { if (textarea) setTextarea(textarea, 'Please reverse this.'); });
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Send refund request');
    await act(async () => { send?.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('The request was not applied. The Order has changed.');
    expect(container.textContent).not.toContain('The request succeeded, but the latest Order could not be loaded.');
  });
});
