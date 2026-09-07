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

const PAYMENT_NEXT_STEP = 'Payment instructions will be provided separately.';
const CAPABILITY_A = 'opaque_capability_value_aaaaaaaaaaaa';
const CAPABILITY_B = 'opaque_capability_value_bbbbbbbbbbbb';

function customerOrder(status: 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled', patch: Record<string, unknown> = {}) {
  return {
    reference: 'NX-260827-AAAA',
    status,
    product: { id: simpleProduct.id, name: simpleProduct.name, variant: null },
    quantity: 2,
    unitPriceMinor: 2400,
    totalMinor: 4701,
    currency: 'USD',
    createdAt: '2026-08-27T12:00:00.000Z',
    paymentNextStep: status === 'pending_payment' ? PAYMENT_NEXT_STEP : null,
    refundRequest: null,
    ...patch,
  };
}

function workerError(status: number, error: Record<string, unknown> = { code: 'order_operation_failed', message: 'The Order operation could not be completed.', fields: [], incidentId: 'inc_1' }) {
  return response({ error }, status);
}

function refundEnvelope(order: { status: string }, outcome: 'applied' | 'already_applied' = 'applied', replayed = false) {
  return { order, command: { outcome, replayed, resultStatus: order.status } };
}

function buttonNamed(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label);
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderPrivate(reference: string, capability: string | null): Promise<void> {
  const hash = capability === null ? '' : `#capability=${capability}`;
  window.history.replaceState({}, '', `/orders/${reference}${hash}`);
  await act(async () => root.render(createElement(StorefrontApp)));
  await flush();
}

async function navigatePrivate(reference: string, capability: string | null): Promise<void> {
  const hash = capability === null ? '' : `#capability=${encodeURIComponent(capability)}`;
  window.history.pushState({}, '', `/orders/${encodeURIComponent(reference)}${hash}`);
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

function refundReasonField(): HTMLTextAreaElement | null {
  return container.querySelector('textarea');
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

describe('Storefront refund contracts', () => {
  it('renders status, payment, and refund eligibility without a second form', async () => {
    const paidWithRequest = customerOrder('paid', {
      refundRequest: {
        id: 'refund_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        reason: '<script>alert(1)</script>',
        status: 'pending',
        createdAt: '2026-09-06T12:00:00.000Z',
      },
    });
    const fixtures = [
      { status: 'pending_payment' as const, order: customerOrder('pending_payment') },
      { status: 'paid' as const, order: customerOrder('paid') },
      { status: 'fulfilled' as const, order: customerOrder('fulfilled') },
      { status: 'cancelled' as const, order: customerOrder('cancelled') },
    ];
    for (const fixture of fixtures) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(fixture.order)));
      await renderPrivate(fixture.order.reference, CAPABILITY_A);
      expect(container.textContent).toContain(
        fixture.status === 'pending_payment' ? 'Pending payment' : fixture.status === 'paid' ? 'Paid' : fixture.status === 'fulfilled' ? 'Fulfilled' : 'Cancelled',
      );
      if (fixture.status === 'pending_payment') {
        expect(container.textContent).toContain(PAYMENT_NEXT_STEP);
      } else {
        expect(container.textContent).not.toContain(PAYMENT_NEXT_STEP);
      }
      if (fixture.status === 'paid' || fixture.status === 'fulfilled') {
        expect(refundReasonField()).not.toBeNull();
      } else {
        expect(refundReasonField()).toBeNull();
        expect(container.textContent).not.toContain('Received — awaiting response');
      }
      await act(async () => root.unmount());
      root = createRoot(container);
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(paidWithRequest)));
    await renderPrivate(paidWithRequest.reference, CAPABILITY_A);
    expect(refundReasonField()).toBeNull();
    expect(container.textContent).toContain('Received — awaiting response');
    expect(container.querySelector('[data-refund-reason]')?.textContent).toBe('<script>alert(1)</script>');
    expect(container.querySelectorAll('script')).toHaveLength(0);
    expect(container.textContent).not.toContain('refunded');
    expect(container.textContent).toContain('$47.01');
  });

  it('installs a committed refund if the route is still active after a semantic edit', async () => {
    let releaseFirst: (value: Response) => void = () => undefined;
    const heldFirst = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve(response(customerOrder('paid')));
      return heldFirst;
    }));
    await renderPrivate('NX-260827-AAAA', CAPABILITY_A);
    const field = refundReasonField();
    await act(async () => { if (field) setTextarea(field, 'first reason'); });
    await act(async () => { buttonNamed('Request refund')?.click(); });
    await act(async () => { if (field) setTextarea(field, 'second reason'); });
    releaseFirst(response(refundEnvelope(customerOrder('paid', {
      refundRequest: { id: 'refund_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', reason: 'first reason', status: 'pending', createdAt: '2026-09-06T12:00:00.000Z' },
    })), 201));
    await flush();
    expect(container.querySelector('[data-refund-reason]')?.textContent).toBe('first reason');
    expect(refundReasonField()).toBeNull();
  });

  it('does not revive refund retry from a late error after a semantic edit', async () => {
    let releaseError: (value: Response) => void = () => undefined;
    const heldError = new Promise<Response>((resolve) => { releaseError = resolve; });
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve(response(customerOrder('paid')));
      return heldError;
    }));
    await renderPrivate('NX-260827-AAAA', CAPABILITY_A);
    const field = refundReasonField();
    await act(async () => { if (field) setTextarea(field, 'first reason'); });
    await act(async () => { buttonNamed('Request refund')?.click(); });
    await act(async () => { if (field) setTextarea(field, 'second reason'); });
    releaseError(workerError(503));
    await flush();
    expect(buttonNamed('Retry refund')).toBeUndefined();
    expect(refundReasonField()?.value).toBe('second reason');
  });

  it('rejects reason boundaries locally and posts exact Unicode without NFKC rewrite', async () => {
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(String(init.body));
        return response(refundEnvelope(customerOrder('paid', {
          refundRequest: { id: 'refund_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', reason: JSON.parse(String(init.body)).reason, status: 'pending', createdAt: '2026-09-06T12:00:00.000Z' },
        })), 201);
      }
      return response(customerOrder('paid'));
    }));
    await renderPrivate('NX-260827-AAAA', CAPABILITY_A);
    const field = refundReasonField();
    expect(field).not.toBeNull();
    const submitInvalid = async (value: string) => {
      await act(async () => { if (field) setTextarea(field, value); });
      await act(async () => { buttonNamed('Request refund')?.click(); });
    };
    await submitInvalid('   ');
    await submitInvalid('\u0000');
    await submitInvalid('a'.repeat(1001));
    await submitInvalid('\uD800');
    await submitInvalid(`${'😀'.repeat(1000)}😀`);
    expect(posts).toEqual([]);
    expect(buttonNamed('Retry refund')).toBeUndefined();

    await act(async () => { if (field) setTextarea(field, 'a'); });
    await act(async () => { buttonNamed('Request refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPrivate('NX-260827-AAAA', CAPABILITY_A);
    const next = refundReasonField();
    await act(async () => { if (next) setTextarea(next, 'a'.repeat(1000)); });
    await act(async () => { buttonNamed('Request refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPrivate('NX-260827-AAAA', CAPABILITY_A);
    const astral = refundReasonField();
    await act(async () => { if (astral) setTextarea(astral, '😀'.repeat(1000)); });
    await act(async () => { buttonNamed('Request refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPrivate('NX-260827-AAAA', CAPABILITY_A);
    const ligature = refundReasonField();
    await act(async () => { if (ligature) setTextarea(ligature, '  ﬁ  '); });
    await act(async () => { buttonNamed('Request refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(posts.map((body) => JSON.parse(body).reason)).toEqual(['a', 'a'.repeat(1000), '😀'.repeat(1000), 'ﬁ']);
  });

  it('keeps one route-bound refund key through lost-response, network, and HTTP retryables', async () => {
    const keys: string[] = [];
    let refundCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') return response(customerOrder('paid'));
      keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
      refundCount += 1;
      if (refundCount === 1) throw new TypeError('lost response after commit');
      if (refundCount === 2) return workerError(503);
      if (refundCount === 3) return workerError(408);
      if (refundCount === 4) return workerError(429);
      return response(refundEnvelope(customerOrder('paid', {
        refundRequest: { id: 'refund_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', reason: 'need a reprint', status: 'pending', createdAt: '2026-09-06T12:00:00.000Z' },
      })), 201);
    }));
    await renderPrivate('NX-260827-AAAA', CAPABILITY_A);
    const field = refundReasonField();
    await act(async () => { if (field) setTextarea(field, '  need a reprint  '); });
    await act(async () => { buttonNamed('Request refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toMatch(/Retry/);
    await act(async () => { if (field) setTextarea(field, 'need a reprint'); });
    await act(async () => { buttonNamed('Retry refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { buttonNamed('Retry refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { buttonNamed('Retry refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { buttonNamed('Retry refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(keys).toHaveLength(5);
    expect(new Set(keys).size).toBe(1);
    expect(container.textContent).toContain('Received — awaiting response');
    expect(container.textContent).toContain('need a reprint');
    expect(refundReasonField()).toBeNull();
  });

  it('clears refund retry identity on semantic or invalid edits and mints a new key', async () => {
    const keys: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') return response(customerOrder('paid'));
      keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
      throw new TypeError('network');
    }));
    await renderPrivate('NX-260827-AAAA', CAPABILITY_A);
    const field = refundReasonField();
    await act(async () => { if (field) setTextarea(field, 'first reason'); });
    await act(async () => { buttonNamed('Request refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { if (field) setTextarea(field, 'second reason'); });
    expect(buttonNamed('Retry refund')).toBeUndefined();
    await act(async () => { buttonNamed('Request refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { if (field) setTextarea(field, ''); });
    await act(async () => { buttonNamed('Request refund')?.click(); });
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('does not let delayed order A replace B, revive retry state, or keep an old view', async () => {
    let releaseARefund: (value: Response) => void = () => undefined;
    const heldARefund = new Promise<Response>((resolve) => { releaseARefund = resolve; });
    let releaseAGet: (value: Response) => void = () => undefined;
    const heldAGet = new Promise<Response>((resolve) => { releaseAGet = resolve; });
    let releaseBGet: (value: Response) => void = () => undefined;
    const heldBGet = new Promise<Response>((resolve) => { releaseBGet = resolve; });
    const refundPosts: Array<{ url: string; key: string | null; capability: string | null; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        const headers = new Headers(init.headers);
        refundPosts.push({
          url,
          key: headers.get('Idempotency-Key'),
          capability: headers.get('X-Nexus-Order-Capability'),
          body: String(init.body),
        });
        if (url.includes('NX-260827-AAAA')) return heldARefund;
        return Promise.resolve(response(refundEnvelope(customerOrder('paid', {
          reference: 'NX-260827-BBBB',
          refundRequest: { id: 'refund_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', reason: 'need a reprint', status: 'pending', createdAt: '2026-09-06T12:00:00.000Z' },
        })), 201));
      }
      if (url.includes('NX-260827-AAAA')) return heldAGet;
      return heldBGet;
    }));
    await act(async () => {
      window.history.replaceState({}, '', `/orders/NX-260827-AAAA#capability=${CAPABILITY_A}`);
      root.render(createElement(StorefrontApp));
    });
    releaseAGet(response(customerOrder('paid', { reference: 'NX-260827-AAAA' })));
    await flush();
    const field = refundReasonField();
    await act(async () => { if (field) setTextarea(field, 'need a reprint'); });
    await act(async () => { buttonNamed('Request refund')?.click(); });
    await act(async () => {
      window.history.pushState({}, '', `/orders/NX-260827-BBBB#capability=${CAPABILITY_B}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(container.textContent).not.toContain('NX-260827-AAAA');
    expect(refundReasonField()).toBeNull();
    expect(container.textContent).not.toContain(CAPABILITY_A);
    releaseBGet(response(customerOrder('paid', { reference: 'NX-260827-BBBB' })));
    await flush();
    expect(container.textContent).toContain('NX-260827-BBBB');
    const fieldB = refundReasonField();
    await act(async () => { if (fieldB) setTextarea(fieldB, 'need a reprint'); });
    await act(async () => { buttonNamed('Request refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    releaseARefund(response(refundEnvelope(customerOrder('paid', {
      reference: 'NX-260827-AAAA',
      refundRequest: { id: 'refund_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', reason: 'need a reprint', status: 'pending', createdAt: '2026-09-06T12:00:00.000Z' },
    })), 201));
    await flush();
    expect(container.textContent).toContain('NX-260827-BBBB');
    expect(container.textContent).not.toContain('NX-260827-AAAA');
    expect(refundPosts).toHaveLength(2);
    expect(refundPosts[0].key).not.toBe(refundPosts[1].key);
    expect(refundPosts[0].url).toContain('/api/storefront/orders/NX-260827-AAAA/refund-requests');
    expect(refundPosts[1].url).toContain('/api/storefront/orders/NX-260827-BBBB/refund-requests');
    expect(refundPosts.every((post) => !post.url.includes('capability'))).toBe(true);
    expect(refundPosts.map((post) => post.capability)).toEqual([CAPABILITY_A, CAPABILITY_B]);
    expect(refundPosts.every((post) => JSON.parse(post.body).reason === 'need a reprint' && Object.keys(JSON.parse(post.body)).join() === 'reason')).toBe(true);
    expect(container.textContent).not.toContain(CAPABILITY_A);
    expect(container.textContent).not.toContain(CAPABILITY_B);
    expect(container.textContent).not.toContain(refundPosts[0].key);
  });

  it('clears the previous Order immediately on capability change and ignores delayed GET/error', async () => {
    let releaseFirstGet: (value: Response) => void = () => undefined;
    const heldFirstGet = new Promise<Response>((resolve) => { releaseFirstGet = resolve; });
    let releaseStaleError: (value: Response) => void = () => undefined;
    const heldStaleError = new Promise<Response>((resolve) => { releaseStaleError = resolve; });
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => {
      getCount += 1;
      if (getCount === 1) return heldFirstGet;
      if (getCount === 2) return heldStaleError;
      return Promise.resolve(response(customerOrder('fulfilled', { reference: 'NX-260827-AAAA' })));
    }));
    await act(async () => {
      window.history.replaceState({}, '', `/orders/NX-260827-AAAA#capability=${CAPABILITY_A}`);
      root.render(createElement(StorefrontApp));
    });
    releaseFirstGet(response(customerOrder('paid', { reference: 'NX-260827-AAAA' })));
    await flush();
    expect(container.textContent).toContain('Paid');
    await act(async () => {
      window.history.replaceState({}, '', `/orders/NX-260827-AAAA#capability=${CAPABILITY_B}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.textContent).not.toContain('Paid');
    expect(container.textContent).not.toContain('$47.01');
    await act(async () => {
      window.history.replaceState({}, '', '/orders/NX-260827-AAAA');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.textContent).toContain('Private Order link required');
    expect(container.textContent).not.toContain('$47.01');
    releaseStaleError(workerError(503));
    await flush();
    expect(container.textContent).toContain('Private Order link required');
    expect(container.textContent).not.toContain('Retry Order');
  });

  it('rejects the first A GET after A to B to A navigation', async () => {
    const releases: Array<(value: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { releases.push(resolve); })));
    await act(async () => {
      window.history.replaceState({}, '', `/orders/NX-260827-AAAA#capability=${CAPABILITY_A}`);
      root.render(createElement(StorefrontApp));
    });
    await act(async () => {
      window.history.pushState({}, '', `/orders/NX-260827-BBBB#capability=${CAPABILITY_B}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await act(async () => {
      window.history.pushState({}, '', `/orders/NX-260827-AAAA#capability=${CAPABILITY_A}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(releases).toHaveLength(3);
    releases[0](response(customerOrder('paid', { reference: 'NX-260827-AAAA', totalMinor: 1111 })));
    await flush();
    expect(container.textContent).not.toContain('$11.11');
    expect(container.textContent).not.toContain('Paid');
    releases[1](response(customerOrder('paid', { reference: 'NX-260827-BBBB' })));
    await flush();
    expect(container.textContent).not.toContain('NX-260827-BBBB');
    releases[2](response(customerOrder('fulfilled', { reference: 'NX-260827-AAAA' })));
    await flush();
    expect(container.textContent).toContain('NX-260827-AAAA');
    expect(container.textContent).toContain('Fulfilled');
    expect(container.textContent).toContain('$47.01');
  });

  it('retries checkout on Worker 5xx 408 and 429 envelopes without JSON retryable', async () => {
    const keys: string[] = [];
    let posts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/storefront/products')) {
        return response({ store: { id: 'store_nexus', slug: 'nexus', name: 'Nexus Store' }, products: [simpleProduct] });
      }
      if (init?.method !== 'POST') {
        return response(customerOrder('pending_payment', { reference: 'NX-260827-ABCD', quantity: 1, unitPriceMinor: 2400, totalMinor: 2400 }));
      }
      keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
      posts += 1;
      if (posts === 1) return workerError(503);
      if (posts === 2) return workerError(408);
      if (posts === 3) return workerError(429);
      return response(customerOrder('pending_payment', { reference: 'NX-260827-ABCD', quantity: 1, unitPriceMinor: 2400, totalMinor: 2400 }), 201);
    }));
    window.history.replaceState({}, '', '/');
    await act(async () => root.render(createElement(StorefrontApp)));
    await flush();
    const name = container.querySelector<HTMLInputElement>('#checkout-name');
    const email = container.querySelector<HTMLInputElement>('#checkout-email');
    await act(async () => { if (name) setInput(name, 'Ada Rivera'); if (email) setInput(email, 'ada@example.com'); });
    await act(async () => { buttonNamed('Place Order')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { buttonNamed('Retry checkout')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { buttonNamed('Retry checkout')?.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { buttonNamed('Retry checkout')?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(1);
    expect(window.location.pathname).toBe('/orders/NX-260827-ABCD');
  });



  it('does not treat 4xx with a Worker envelope or malformed JSON as retryable for checkout or refund', async () => {
    const checkoutKeys: string[] = [];
    let checkoutPosts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/storefront/products')) {
        return response({ store: { id: 'store_nexus', slug: 'nexus', name: 'Nexus Store' }, products: [simpleProduct] });
      }
      if (init?.method === 'POST' && url.endsWith('/api/storefront/orders')) {
        checkoutKeys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
        checkoutPosts += 1;
        if (checkoutPosts === 1) return new Response('{', { status: 400, headers: { 'Content-Type': 'application/json' } });
        return workerError(422, { code: 'validation_failed', message: 'The request is invalid.', fields: [], incidentId: null });
      }
      return response(customerOrder('pending_payment', { reference: 'NX-260827-ABCD' }), 201);
    }));
    window.history.replaceState({}, '', '/');
    await act(async () => root.render(createElement(StorefrontApp)));
    await flush();
    const name = container.querySelector<HTMLInputElement>('#checkout-name');
    const email = container.querySelector<HTMLInputElement>('#checkout-email');
    await act(async () => { if (name) setInput(name, 'Ada Rivera'); if (email) setInput(email, 'ada@example.com'); });
    await act(async () => { buttonNamed('Place Order')?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(buttonNamed('Retry checkout')).toBeUndefined();
    await act(async () => { buttonNamed('Place Order')?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(checkoutKeys).toHaveLength(2);
    expect(checkoutKeys[0]).not.toBe(checkoutKeys[1]);

    const refundKeys: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        refundKeys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
        return new Response('not-json', { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return response(customerOrder('paid'));
    }));
    await navigatePrivate('NX-260827-AAAA', CAPABILITY_A);
    await flush();
    const field = refundReasonField();
    await act(async () => { if (field) setTextarea(field, 'please review'); });
    await act(async () => { buttonNamed('Request refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(buttonNamed('Retry refund')).toBeUndefined();
    await act(async () => { buttonNamed('Request refund')?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(refundKeys).toHaveLength(2);
    expect(refundKeys[0]).not.toBe(refundKeys[1]);
  });

  it('reloads durable refund state from GET after remount and never claims refunded money', async () => {
    const persisted = customerOrder('fulfilled', {
      refundRequest: {
        id: 'refund_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        reason: 'please reprint',
        status: 'pending',
        createdAt: '2026-09-06T12:00:00.000Z',
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => response(persisted)));
    await renderPrivate(persisted.reference, CAPABILITY_A);
    expect(container.textContent).toContain('Fulfilled');
    expect(container.textContent).toContain('Received — awaiting response');
    expect(container.textContent).toContain('please reprint');
    expect(container.textContent).toContain('$47.01');
    expect(container.textContent).not.toContain('refunded');
    expect(refundReasonField()).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPrivate(persisted.reference, CAPABILITY_A);
    expect(container.textContent).toContain('Received — awaiting response');
    expect(container.querySelector('[data-refund-reason]')?.textContent).toBe('please reprint');
    expect(container.textContent).toContain('$47.01');
  });
});
