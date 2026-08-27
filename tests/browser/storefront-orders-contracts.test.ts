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
      return response({ reference: 'NX-260827-ABCD', status: 'pending_payment', product: { id: simpleProduct.id, name: simpleProduct.name, variant: null }, quantity: 1, unitPriceMinor: 2400, totalMinor: 2400, currency: 'USD', createdAt: '2026-08-27T12:00:00.000Z', paymentNextStep: 'Payment instructions will be provided separately.' });
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ reference: 'NX-260827-ABCD', status: 'pending_payment', product: { id: simpleProduct.id, name: simpleProduct.name, variant: null }, quantity: 2, unitPriceMinor: 2400, totalMinor: 4701, currency: 'USD', createdAt: '2026-08-27T12:00:00.000Z', paymentNextStep: 'Payment instructions will be provided separately.', accessInstructions: 'private', privateFileKey: 'secret-key' })));
    await act(async () => root.render(createElement(StorefrontApp)));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('$47.01');
    expect(container.textContent).toContain('Payment instructions will be provided separately.');
    expect(container.textContent).not.toContain('private');
    expect(container.textContent).not.toContain('secret-key');
    expect(container.textContent).not.toContain('opaque_capability');
  });
});
