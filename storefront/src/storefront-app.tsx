import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  createOrderAttemptIdentity,
  createStorefrontOrder,
  createStorefrontRefundRequest,
  fetchCatalog,
  fetchStorefrontOrder,
  StorefrontApiError,
} from './api-client';
import type {
  CustomerOrderView,
  OrderAttemptIdentity,
  StorefrontCatalog,
  StorefrontProduct,
} from './storefront-view-types';


type CatalogState = 'loading' | 'ready' | 'empty' | 'error';
type OrderRoute = { kind: 'catalog' } | { kind: 'order'; reference: string; capability: string | null };
type FieldErrors = Partial<Record<'variant' | 'quantity' | 'name' | 'email', string>>;

function parseRoute(): OrderRoute {
  const match = /^\/orders\/([^/]+)\/?$/.exec(window.location.pathname);
  if (!match) return { kind: 'catalog' };
  let reference: string;
  try { reference = decodeURIComponent(match[1]); } catch { return { kind: 'catalog' }; }
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  return { kind: 'order', reference, capability: fragment.get('capability') };
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

const STATUS_LABEL = {
  pending_payment: 'Pending payment',
  completed: 'Completed',
  cancelled: 'Cancelled',
} as const;

const REASON_INVALID = 'Enter a reason using 1 to 1000 characters.';

function validateRefundReason(value: string): string | null {
  const normalized = value.replace(/\r\n|\r/g, '\n').trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > 1000) return REASON_INVALID;
  for (const char of normalized) {
    if (/\p{Cf}/u.test(char)) return REASON_INVALID;
    if (/\p{Cc}/u.test(char) && char !== '\t' && char !== '\n') return REASON_INVALID;
  }
  return null;
}


function CatalogProduct({
  product,
  selected,
  onSelect,
}: {
  product: StorefrontProduct;
  selected: boolean;
  onSelect: () => void;
}) {
  const price = product.minimumEffectivePriceMinor === product.maximumEffectivePriceMinor
    ? money(product.minimumEffectivePriceMinor, product.currency)
    : `${money(product.minimumEffectivePriceMinor, product.currency)} to ${money(product.maximumEffectivePriceMinor, product.currency)}`;
  return (
    <article className={`catalog-row${selected ? ' catalog-row-selected' : ''}`}>
      <button className="catalog-choice" type="button" aria-pressed={selected} onClick={onSelect}>
        <span className="catalog-name">{product.name}</span>
        <span className="catalog-type">{product.optionGroups.length === 0 ? 'Simple Product' : 'Variant Product'}</span>
        <span className="catalog-price numeric">{price}</span>
      </button>
      <p>{product.publicDescription}</p>
    </article>
  );
}

function PrivateOrderPage({
  route,
  generation,
  onBack,
}: {
  route: Extract<OrderRoute, { kind: 'order' }>;
  generation: number;
  onBack: () => void;
}) {
  const [order, setOrder] = useState<CustomerOrderView | null>(null);
  const [loadedGeneration, setLoadedGeneration] = useState<number | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'missing-capability'>('loading');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'retry' | 'conflict'>('idle');
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const attemptRef = useRef<{ reference: string; key: string; reason: string } | null>(null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const load = useCallback((signal?: AbortSignal, mode: 'page' | 'refresh' | 'ack-refresh' = 'page') => {
    if (!route.capability) {
      setState('missing-capability');
      return;
    }
    if (mode === 'page') {
      setState('loading');
      setOrder(null);
      setLoadedGeneration(null);
    }
    void fetchStorefrontOrder(route.reference, route.capability, signal)
      .then((result) => {
        if (signal?.aborted) return;
        setOrder(result);
        setLoadedGeneration(generation);
        setState('ready');
        setRefreshFailed(false);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (mode === 'ack-refresh') {
          setRefreshFailed(true);
          return;
        }
        if (mode === 'refresh') return;
        setState('error');
      });
  }, [generation, route.capability, route.reference]);

  useEffect(() => {
    const controller = new AbortController();
    pageAbortRef.current = controller;
    attemptRef.current = null;
    setReason('');
    setReasonError(null);
    setSubmitState('idle');
    setSubmitMessage(null);
    setRefreshFailed(false);
    load(controller.signal);
    return () => {
      controller.abort();
      if (pageAbortRef.current === controller) pageAbortRef.current = null;
    };
  }, [load]);

  const submitRefund = async (event: FormEvent) => {
    event.preventDefault();
    if (!route.capability || !order || order.status !== 'completed' || order.refundRequest) return;
    const existing = attemptRef.current;
    const candidate = existing?.reason ?? reason;
    if (!existing) {
      const error = validateRefundReason(candidate);
      if (error) {
        setReasonError(error);
        requestAnimationFrame(() => errorSummaryRef.current?.focus());
        return;
      }
    }
    const frozen = existing ?? {
      reference: route.reference,
      key: crypto.randomUUID(),
      reason: candidate.replace(/\r\n|\r/g, '\n').trim(),
    };
    attemptRef.current = frozen;
    setReason(frozen.reason);
    setReasonError(null);
    setSubmitState('submitting');
    setSubmitMessage(null);
    try {
      const result = await createStorefrontRefundRequest(
        frozen.reference,
        route.capability,
        frozen.reason,
        frozen.key,
        pageAbortRef.current?.signal,
      );
      if (pageAbortRef.current?.signal.aborted) return;
      attemptRef.current = null;
      setOrder((current) => {
        if (!current || current.reference !== route.reference) return current;
        return { ...current, refundRequest: result.refundRequest };
      });
      setSubmitState('idle');
      load(pageAbortRef.current?.signal, 'ack-refresh');
    } catch (error) {
      if (pageAbortRef.current?.signal.aborted) return;
      if (error instanceof StorefrontApiError && error.status === 422) {
        attemptRef.current = null;
        setSubmitState('idle');
        const reasonField = error.fields?.find((field) => field.path === '/reason');
        setReasonError(reasonField?.message ?? REASON_INVALID);
        requestAnimationFrame(() => errorSummaryRef.current?.focus());
        return;
      }
      if (error instanceof StorefrontApiError && error.status === 409) {
        attemptRef.current = null;
        setSubmitState('conflict');
        setSubmitMessage('The request was not applied. The Order has changed.');
        load(pageAbortRef.current?.signal, 'refresh');
        return;
      }
      const unknownOutcome = !(error instanceof StorefrontApiError) || error.retryable;
      setSubmitState('retry');
      setSubmitMessage(unknownOutcome
        ? 'The outcome is not confirmed. Retry the same request.'
        : 'The request could not be completed. Review your details and try again.');
    }
  };

  const visibleOrder = state === 'ready'
    && order
    && loadedGeneration === generation
    && order.reference === route.reference
    ? order
    : null;
  const reasonLocked = submitState === 'submitting' || submitState === 'retry';
  const displayedReason = reasonLocked && attemptRef.current ? attemptRef.current.reason : reason;
  const codePoints = Array.from(displayedReason).length;

  return (
    <main id="storefront-content" className="order-page" tabIndex={-1}>
      <button className="text-action" type="button" onClick={onBack}>Back to catalog</button>
      {state === 'loading' ? <div className="order-ledger loading-ledger" aria-label="Loading Order" aria-busy="true"><span /><span /><span /></div> : null}
      {state === 'missing-capability' ? <div className="storefront-notice storefront-error" role="alert"><h1>Private Order link required</h1><p>Open the complete link provided after checkout to view this Order.</p></div> : null}
      {state === 'error' ? <div className="storefront-notice storefront-error" role="alert"><h1>Order could not be loaded</h1><p>The private Order is unavailable. Retry without changing the link.</p><button className="secondary-action" type="button" onClick={() => load(pageAbortRef.current?.signal)}>Retry Order</button></div> : null}
      {visibleOrder ? (
        <article className="order-ledger" aria-labelledby="order-title">
          <header>
            <div>
              <p className="ledger-label">Order {visibleOrder.reference}</p>
              <h1 id="order-title">{visibleOrder.product.name}</h1>
            </div>
            <span className="order-status">{STATUS_LABEL[visibleOrder.status]}</span>
          </header>
          {visibleOrder.product.variant ? (
            <section>
              <h2>Selection</h2>
              <p className="variant-sku">SKU {visibleOrder.product.variant.sku}</p>
              <dl>{visibleOrder.product.variant.selectedOptions.map((option) => <div key={option.groupId}><dt>{option.groupName}</dt><dd>{option.valueLabel}</dd></div>)}</dl>
            </section>
          ) : (
            <section><h2>Selection</h2><p>Simple Product</p></section>
          )}
          <section className="amount-ledger">
            <dl>
              <div><dt>Quantity</dt><dd className="numeric">{visibleOrder.quantity}</dd></div>
              <div><dt>Unit price</dt><dd className="numeric">{money(visibleOrder.unitPriceMinor, visibleOrder.currency)}</dd></div>
              <div className="total-line"><dt>Total</dt><dd className="numeric">{money(visibleOrder.totalMinor, visibleOrder.currency)}</dd></div>
            </dl>
          </section>
          {visibleOrder.status === 'completed' ? (
            <section>
              <h2>Order status</h2>
              <p>This Order has been completed. No delivery or refund is performed by this page.</p>
            </section>
          ) : null}
          {visibleOrder.status === 'cancelled' ? (
            <section>
              <h2>Order status</h2>
              <p>This Order has been cancelled.</p>
            </section>
          ) : null}
          {visibleOrder.paymentNextStep !== null ? (
            <section>
              <h2>Payment next step</h2>
              <p>{visibleOrder.paymentNextStep}</p>
            </section>
          ) : null}
          {visibleOrder.status === 'completed' && visibleOrder.refundRequest == null ? (
            <section>
              <h2>Refund request</h2>
              <form className="refund-form" onSubmit={submitRefund} noValidate>
                {reasonError ? (
                  <div ref={errorSummaryRef} className="error-summary" role="alert" tabIndex={-1}>
                    <strong>Review refund request details</strong>
                    <ul><li><a href="#refund-reason" onClick={(event) => { event.preventDefault(); document.getElementById('refund-reason')?.focus(); }}>{reasonError}</a></li></ul>
                  </div>
                ) : null}
                <div className="field">
                  <label htmlFor="refund-reason">Reason for refund request</label>
                  <textarea
                    id="refund-reason"
                    value={displayedReason}
                    disabled={reasonLocked}
                    aria-invalid={Boolean(reasonError)}
                    aria-describedby={`refund-reason-count${reasonError ? ' refund-reason-error' : ''}`}
                    onChange={(event) => {
                      if (reasonLocked) return;
                      setReason(event.target.value);
                    }}
                  />
                  <span id="refund-reason-count" className="character-count">{codePoints} / 1000</span>
                  {reasonError ? <span id="refund-reason-error" className="field-error">{reasonError}</span> : null}
                </div>
                {submitMessage ? <p className="submit-message" role="alert">{submitMessage}</p> : null}
                <button className="primary-action" type="submit" disabled={submitState === 'submitting'}>
                  {submitState === 'submitting' ? 'Sending refund request' : submitState === 'retry' ? 'Retry refund request' : 'Send refund request'}
                </button>
              </form>
            </section>
          ) : null}
          {visibleOrder.refundRequest ? (
            <section>
              <h2>Refund request pending</h2>
              <p className="refund-reason">{visibleOrder.refundRequest.reason}</p>
              <p>Requested {new Date(visibleOrder.refundRequest.createdAt).toLocaleString()}</p>
              <p>Your request is pending. No refund has been issued.</p>
            </section>
          ) : null}
          {refreshFailed ? (
            <div className="storefront-notice" role="status">
              <p>The request succeeded, but the latest Order could not be loaded.</p>
              <button className="secondary-action" type="button" onClick={() => load(pageAbortRef.current?.signal, 'ack-refresh')}>Retry loading Order</button>
            </div>
          ) : null}
          <footer>Created {new Date(visibleOrder.createdAt).toLocaleString()}</footer>
        </article>
      ) : null}
    </main>
  );
}

export function StorefrontApp() {
  const [route, setRoute] = useState<OrderRoute>(parseRoute);
  const [capabilityGeneration, setCapabilityGeneration] = useState(0);
  const [catalog, setCatalog] = useState<StorefrontCatalog | null>(null);
  const [catalogState, setCatalogState] = useState<CatalogState>('loading');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState('1');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'retry'>('idle');
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const attemptRef = useRef<OrderAttemptIdentity | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const catalogRequestRef = useRef<AbortController | null>(null);

  const loadCatalog = useCallback(() => {
    catalogRequestRef.current?.abort();
    const controller = new AbortController();
    catalogRequestRef.current = controller;
    setCatalogState('loading');
    void fetchCatalog(controller.signal).then((response) => {
      setCatalog(response);
      setCatalogState(response.products.length === 0 ? 'empty' : 'ready');
      setSelectedProductId((current) => response.products.some((product) => product.id === current) ? current : response.products[0]?.id ?? null);
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setCatalogState('error');
    }).finally(() => {
      if (catalogRequestRef.current === controller) catalogRequestRef.current = null;
    });
  }, []);

  useEffect(() => {
    const updateRoute = () => {
      setCapabilityGeneration((current) => current + 1);
      setRoute(parseRoute());
    };
    window.addEventListener('popstate', updateRoute);
    window.addEventListener('hashchange', updateRoute);
    return () => { window.removeEventListener('popstate', updateRoute); window.removeEventListener('hashchange', updateRoute); };
  }, []);

  useEffect(() => {
    if (route.kind !== 'catalog') return;
    loadCatalog();
    const onVisibility = () => { if (document.visibilityState === 'visible') loadCatalog(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      catalogRequestRef.current?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadCatalog, route.kind]);

  const selectedProduct = catalog?.products.find((product) => product.id === selectedProductId) ?? null;
  const matchingVariant = useMemo(() => {
    if (!selectedProduct || selectedProduct.optionGroups.length === 0) return null;
    return selectedProduct.variants.find((variant) => selectedProduct.optionGroups.every((group) =>
      variant.selectedOptions.some((option) => option.groupId === group.id && option.valueId === selectedOptions[group.id]),
    )) ?? null;
  }, [selectedOptions, selectedProduct]);

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    const parsedQuantity = Number(quantity);
    if (!selectedProduct || (selectedProduct.optionGroups.length > 0 && !matchingVariant)) errors.variant = 'Select one available value in every option group.';
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 99) errors.quantity = 'Enter a whole number from 1 to 99.';
    if (!name.trim() || name.trim().length > 120) errors.name = 'Enter your name using 1 to 120 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    return errors;
  }, [email, matchingVariant, name, quantity, selectedProduct]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) { requestAnimationFrame(() => errorSummaryRef.current?.focus()); return; }
    if (!selectedProduct) return;
    const identity = attemptRef.current ?? createOrderAttemptIdentity();
    attemptRef.current = identity;
    setSubmitState('submitting');
    setSubmitMessage(null);
    try {
      const order = await createStorefrontOrder({ customer: { name: name.trim(), email: email.trim() }, productId: selectedProduct.id, variantId: matchingVariant?.id ?? null, quantity: Number(quantity) }, identity);
      const next = `/orders/${encodeURIComponent(order.reference)}#capability=${encodeURIComponent(identity.capability)}`;
      attemptRef.current = null;
      window.history.pushState({}, '', next);
      setRoute(parseRoute());
    } catch (error) {
      const retryable = !(error instanceof StorefrontApiError) || error.retryable;
      if (!retryable) attemptRef.current = null;
      setSubmitState(retryable ? 'retry' : 'idle');
      setSubmitMessage(retryable ? 'Checkout did not complete. Retry to safely continue this same attempt.' : 'Checkout could not be completed. Review your selection and details.');
    }
  };

  const navigateCatalog = () => {
    window.history.pushState({}, '', '/');
    setRoute({ kind: 'catalog' });
  };

  if (route.kind === 'order') {
    return (
      <StorefrontFrame>
        <PrivateOrderPage
          key={`${route.reference}:${capabilityGeneration}`}
          route={route}
          generation={capabilityGeneration}
          onBack={navigateCatalog}
        />
      </StorefrontFrame>
    );
  }

  return (
    <StorefrontFrame>
      <main id="storefront-content" className="catalog-page" tabIndex={-1}>
        <header className="catalog-heading"><h1>{catalog?.store.name ?? 'Digital products'}</h1><p>Choose a Product, confirm the format, then complete checkout.</p></header>
        {catalogState === 'loading' ? <div className="catalog-loading" aria-label="Loading catalog" aria-busy="true"><span /><span /><span /></div> : null}
        {catalogState === 'error' ? <div className="storefront-notice storefront-error" role="alert"><h2>Catalog could not be loaded</h2><p>Check your connection and try again.</p><button className="secondary-action" type="button" onClick={loadCatalog}>Retry catalog</button></div> : null}
        {catalogState === 'empty' ? <div className="storefront-notice"><h2>No Products are available</h2><p>Return later. Published Products will appear here.</p></div> : null}
        {catalogState === 'ready' && catalog ? (
          <div className="storefront-workspace">
            <section className="catalog-list" aria-label="Available Products">{catalog.products.map((product) => <CatalogProduct key={product.id} product={product} selected={product.id === selectedProductId} onSelect={() => { setSelectedProductId(product.id); setSelectedOptions({}); setFieldErrors({}); attemptRef.current = null; setSubmitState('idle'); }} />)}</section>
            {selectedProduct ? <form className="purchase-ledger" onSubmit={submit} noValidate>
              <header><p className="ledger-label">Purchase ledger</p><h2>{selectedProduct.name}</h2><p>{selectedProduct.publicDescription}</p></header>
              {Object.values(fieldErrors).some(Boolean) ? <div ref={errorSummaryRef} className="error-summary" role="alert" tabIndex={-1}><strong>Review checkout details</strong><ul>{Object.entries(fieldErrors).filter((entry): entry is [string, string] => Boolean(entry[1])).map(([field, message]) => <li key={field}><a href={`#checkout-${field}`}>{message}</a></li>)}</ul></div> : null}
              {selectedProduct.optionGroups.length === 0 ? (
                <p className="simple-selection">Simple Product. No format selection is required.</p>
              ) : (
                <fieldset id="checkout-variant" className="option-selector" aria-describedby={fieldErrors.variant ? 'variant-error' : undefined}>
                  <legend>Choose a format</legend>
                  {selectedProduct.optionGroups.map((group) => (
                    <div className="field" key={group.id}>
                      <label htmlFor={`option-${group.id}`}>{group.name}</label>
                      <select
                        id={`option-${group.id}`}
                        value={selectedOptions[group.id] ?? ''}
                        aria-invalid={Boolean(fieldErrors.variant)}
                        aria-describedby={fieldErrors.variant ? 'variant-error' : undefined}
                        onBlur={() => setFieldErrors((current) => ({ ...current, variant: matchingVariant ? undefined : 'Select one available value in every option group.' }))}
                        onChange={(event) => {
                          setSelectedOptions((current) => ({ ...current, [group.id]: event.target.value }));
                          attemptRef.current = null;
                          setSubmitState('idle');
                        }}
                      >
                        <option value="">Select {group.name}</option>
                        {group.values.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}
                      </select>
                    </div>
                  ))}
                  {fieldErrors.variant ? <p id="variant-error" className="field-error">{fieldErrors.variant}</p> : null}
                </fieldset>
              )}
              <div className="checkout-fields">
                <div className="field"><label htmlFor="checkout-quantity">Quantity</label><input id="checkout-quantity" type="number" inputMode="numeric" min="1" max="99" step="1" value={quantity} aria-invalid={Boolean(fieldErrors.quantity)} aria-describedby={fieldErrors.quantity ? 'quantity-error' : undefined} onBlur={() => setFieldErrors((current) => ({ ...current, quantity: Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 99 ? undefined : 'Enter a whole number from 1 to 99.' }))} onChange={(event) => { setQuantity(event.target.value); attemptRef.current = null; setSubmitState('idle'); }} />{fieldErrors.quantity ? <span id="quantity-error" className="field-error">{fieldErrors.quantity}</span> : null}</div>
                <div className="field"><label htmlFor="checkout-name">Name</label><input id="checkout-name" autoComplete="name" value={name} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'name-error' : undefined} onBlur={() => setFieldErrors((current) => ({ ...current, name: name.trim() && name.trim().length <= 120 ? undefined : 'Enter your name using 1 to 120 characters.' }))} onChange={(event) => { setName(event.target.value); attemptRef.current = null; setSubmitState('idle'); }} />{fieldErrors.name ? <span id="name-error" className="field-error">{fieldErrors.name}</span> : null}</div>
                <div className="field"><label htmlFor="checkout-email">Email</label><input id="checkout-email" type="email" autoComplete="email" value={email} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'email-error' : undefined} onBlur={() => setFieldErrors((current) => ({ ...current, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'Enter a valid email address.' }))} onChange={(event) => { setEmail(event.target.value); attemptRef.current = null; setSubmitState('idle'); }} />{fieldErrors.email ? <span id="email-error" className="field-error">{fieldErrors.email}</span> : null}</div>
              </div>
              <div className="purchase-total"><span>{matchingVariant ? 'Selected price' : 'Product price'}</span><strong className="numeric">{money(matchingVariant?.effectivePriceMinor ?? selectedProduct.basePriceMinor, selectedProduct.currency)}</strong></div>
              {submitMessage ? <p className="submit-message" role="alert">{submitMessage}</p> : null}
              <button className="primary-action" type="submit" disabled={submitState === 'submitting' || (selectedProduct.optionGroups.length > 0 && !matchingVariant)}>{submitState === 'submitting' ? 'Placing Order' : submitState === 'retry' ? 'Retry checkout' : 'Place Order'}</button>
            </form> : null}
          </div>
        ) : null}
      </main>
    </StorefrontFrame>
  );
}

function StorefrontFrame({ children }: { children: ReactNode }) {
  return <div className="storefront-shell"><a className="skip-link" href="#storefront-content">Skip to main content</a><header className="storefront-header"><a className="storefront-brand" href="/">Nexus</a><span>Storefront</span></header>{children}</div>;
}
