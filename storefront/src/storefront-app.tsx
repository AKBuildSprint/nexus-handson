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
  CustomerOrderItemView,
  CustomerOrderView,
  FrozenCreateAttempt,
  StorefrontCatalog,
  StorefrontProduct,
} from './storefront-view-types';

type CatalogState = 'loading' | 'ready' | 'empty' | 'error';
type OrderRoute = { kind: 'catalog' } | { kind: 'order'; reference: string; capability: string | null };
type FieldErrors = Partial<Record<'variant' | 'quantity' | 'name' | 'email' | 'cart', string>>;
type CatalogFilter = 'all' | 'simple' | 'variant';

interface CartLine {
  key: string;
  productId: string;
  productName: string;
  currency: string;
  variantId: string | null;
  variantLabel: string;
  quantity: number;
  unitPriceMinor: number;
}

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

function readCatalogCriteria(): { query: string; filter: CatalogFilter } {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');
  const filter: CatalogFilter = type === 'simple' || type === 'variant' ? type : 'all';
  return { query: params.get('q') ?? '', filter };
}

function writeCatalogCriteria(query: string, filter: CatalogFilter): void {
  const params = new URLSearchParams(window.location.search);
  const trimmed = query.trim();
  if (trimmed) params.set('q', trimmed);
  else params.delete('q');
  if (filter === 'all') params.delete('type');
  else params.set('type', filter);
  const search = params.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== next) window.history.replaceState(window.history.state, '', next);
}

const STATUS_LABEL = {
  pending: 'Pending',
  paid: 'Paid',
  fulfilled: 'Fulfilled',
  canceled: 'Canceled',
} as const;

const REASON_INVALID = 'Enter a reason using 1 to 1000 characters.';
const MIXED_CURRENCY = 'This cart mixes currencies. Remove lines until every Product uses one currency. The server remains the final authority.';
const PAID_STATUS_COPY = 'This Order is paid. This page does not deliver files or pay out a refund.';
const FULFILLED_STATUS_COPY = 'This Order is fulfilled. This page does not deliver files or pay out a refund.';
const REFUND_REQUEST_INTRO = 'You can send one refund request. Sending a request does not issue a refund.';
const CATALOG_PAGE_SIZE = 24;


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

function itemSelection(item: CustomerOrderItemView): string {
  if (!item.product.variant) return 'Simple Product';
  const options = item.product.variant.selectedOptions.map((option) => `${option.groupName}: ${option.valueLabel}`).join(', ');
  return options ? `${options} · SKU ${item.product.variant.sku}` : `SKU ${item.product.variant.sku}`;
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
        <span className="catalog-media" aria-hidden="true">{product.name.slice(0, 1)}</span>
        <span className="catalog-type">{product.optionGroups.length === 0 ? 'Simple Product' : 'Variant Product'}</span>
        <span className="catalog-name">{product.name}</span>
        <span className="catalog-price numeric">{price}</span>
      </button>
      <p>{product.publicDescription}</p>
    </article>
  );
}

function CatalogPager({
  position,
  rangeStart,
  rangeEnd,
  matchingCount,
  page,
  totalPages,
  onPrevious,
  onNext,
}: {
  position: 'top' | 'bottom';
  rangeStart: number;
  rangeEnd: number;
  matchingCount: number;
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className="catalog-pager" aria-label={`Catalog pages, ${position}`}>
      <p>
        Showing <span className="numeric">{rangeStart}–{rangeEnd}</span> of <span className="numeric">{matchingCount}</span>
        {' · '}
        Page <span className="numeric">{page}</span> of <span className="numeric">{totalPages}</span>
      </p>
      <div className="inline-actions">
        <button
          className="secondary-action"
          type="button"
          disabled={page <= 1}
          aria-label={`Previous catalog page, ${position}`}
          onClick={onPrevious}
        >
          Previous
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={page >= totalPages}
          aria-label={`Next catalog page, ${position}`}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </nav>
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
  const [contractOutdated, setContractOutdated] = useState(false);
  const attemptRef = useRef<{ reference: string; key: string; reason: string } | null>(null);
  const readAbortRef = useRef<AbortController | null>(null);
  const readEpochRef = useRef(0);
  const pageAbortRef = useRef<AbortController | null>(null);
  const submitStateRef = useRef(submitState);
  submitStateRef.current = submitState;
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const load = useCallback((mode: 'page' | 'refresh' | 'ack-refresh' = 'page') => {
    if (!route.capability) {
      setState('missing-capability');
      return;
    }
    if (mode === 'page') {
      setState('loading');
      setOrder(null);
      setLoadedGeneration(null);
    }
    readAbortRef.current?.abort();
    const controller = new AbortController();
    readAbortRef.current = controller;
    const epoch = readEpochRef.current + 1;
    readEpochRef.current = epoch;
    void fetchStorefrontOrder(route.reference, route.capability, controller.signal)
      .then((result) => {
        if (epoch !== readEpochRef.current) return;
        setOrder(result);
        setLoadedGeneration(generation);
        setState('ready');
        setRefreshFailed(false);
        setContractOutdated(false);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (epoch !== readEpochRef.current) return;
        if (error instanceof StorefrontApiError && error.code === 'client_contract_outdated') {
          setContractOutdated(true);
          if (mode === 'ack-refresh') {
            setRefreshFailed(true);
            return;
          }
          setState('error');
          return;
        }
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
    setContractOutdated(false);
    load('page');
    return () => {
      controller.abort();
      readAbortRef.current?.abort();
      readEpochRef.current += 1;
      if (pageAbortRef.current === controller) pageAbortRef.current = null;
    };
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (submitStateRef.current === 'submitting') return;
      load('refresh');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const refundEligible = (candidate: CustomerOrderView) => (
    (candidate.status === 'paid' || candidate.status === 'fulfilled') && candidate.refundRequest == null
  );

  const submitRefund = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!route.capability || !order || !refundEligible(order) || contractOutdated || submitState === 'submitting') return;
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
    readAbortRef.current?.abort();
    readEpochRef.current += 1;
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
      load('ack-refresh');
    } catch (error) {
      if (pageAbortRef.current?.signal.aborted) return;
      if (error instanceof StorefrontApiError && error.code === 'client_contract_outdated') {
        setContractOutdated(true);
        setSubmitState('idle');
        setSubmitMessage('This Storefront is out of date. Reload the page and try again.');
        return;
      }
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
        load('refresh');
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
      {state === 'error' ? (
        <div className="storefront-notice storefront-error" role="alert">
          <h1>{contractOutdated ? 'This Storefront is out of date' : 'Order could not be loaded'}</h1>
          <p>{contractOutdated ? 'Reload the page and try again. This client will not retry the previous Order request.' : 'The private Order is unavailable. Retry without changing the link.'}</p>
          {contractOutdated
            ? <button className="secondary-action" type="button" onClick={() => { window.location.reload(); }}>Reload Storefront</button>
            : <button className="secondary-action" type="button" onClick={() => load()}>Retry Order</button>}
        </div>
      ) : null}
      {visibleOrder ? (
        <article className="order-ledger" aria-labelledby="order-title">
          <header>
            <div>
              <p className="ledger-label">Order {visibleOrder.reference}</p>
              <h1 id="order-title">{visibleOrder.items[0]?.product.name ?? 'Order'}</h1>
            </div>
            <span className="order-status">{STATUS_LABEL[visibleOrder.status]}</span>
          </header>
          <section>
            <h2>Items</h2>
            <ul className="order-item-list">
              {visibleOrder.items.map((item) => (
                <li key={item.id}>
                  <strong>{item.product.name}</strong>
                  <p>{itemSelection(item)}</p>
                  <p className="numeric">{item.quantity} × {money(item.unitPriceMinor, item.currency)} = {money(item.lineTotalMinor, item.currency)} {item.currency}</p>
                </li>
              ))}
            </ul>
          </section>
          <section className="amount-ledger">
            <dl>
              <div><dt>Payment reference</dt><dd>{visibleOrder.paymentReference}</dd></div>
              <div className="total-line"><dt>Total</dt><dd className="numeric">{money(visibleOrder.totalMinor, visibleOrder.currency)} {visibleOrder.currency}</dd></div>
            </dl>
          </section>
          {visibleOrder.status === 'paid' ? (
            <section>
              <h2>Order status</h2>
              <p>{PAID_STATUS_COPY}</p>
            </section>
          ) : null}
          {visibleOrder.status === 'fulfilled' ? (
            <section>
              <h2>Order status</h2>
              <p>{FULFILLED_STATUS_COPY}</p>
            </section>
          ) : null}
          {visibleOrder.status === 'canceled' ? (
            <section>
              <h2>Order status</h2>
              <p>This Order has been canceled.</p>
            </section>
          ) : null}
          {visibleOrder.paymentNextStep !== null && visibleOrder.status === 'pending' ? (
            <section>
              <h2>Payment next step</h2>
              <p>{visibleOrder.paymentNextStep}</p>
            </section>
          ) : null}
          {refundEligible(visibleOrder) ? (
            <section>
              <h2>Refund request</h2>
              <p>{REFUND_REQUEST_INTRO}</p>
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
                <button className="primary-action" type="submit" disabled={submitState === 'submitting' || contractOutdated}>
                  {submitState === 'submitting' ? 'Sending refund request' : submitState === 'retry' ? 'Retry refund request' : 'Send refund request'}
                </button>
                {contractOutdated ? <button className="secondary-action" type="button" onClick={() => { window.location.reload(); }}>Reload Storefront</button> : null}
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
              <button className="secondary-action" type="button" onClick={() => load('ack-refresh')}>Retry loading Order</button>
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
  const catalogStart = readCatalogCriteria();
  const [catalogQuery, setCatalogQuery] = useState(catalogStart.query);
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>(catalogStart.filter);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogState, setCatalogState] = useState<CatalogState>('loading');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState('1');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'retry'>('idle');
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [contractOutdated, setContractOutdated] = useState(false);
  const attemptRef = useRef<FrozenCreateAttempt | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const catalogRequestRef = useRef<AbortController | null>(null);
  const lineFocusRef = useRef<string | null>(null);
  const catalogResultsRef = useRef<HTMLDivElement>(null);
  const scrollCatalogFromBottomRef = useRef(false);

  const checkoutLocked = submitState === 'retry' || submitState === 'submitting' || contractOutdated;
  const placeLocked = submitState === 'submitting' || contractOutdated;

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
      const criteria = readCatalogCriteria();
      setCatalogQuery(criteria.query);
      setCatalogFilter(criteria.filter);
      setCatalogPage(1);
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

  useEffect(() => {
    if (route.kind !== 'catalog') return;
    writeCatalogCriteria(catalogQuery, catalogFilter);
  }, [catalogFilter, catalogQuery, route.kind]);

  useEffect(() => {
    if (!lineFocusRef.current) return;
    document.getElementById(lineFocusRef.current)?.focus();
    lineFocusRef.current = null;
  }, [fieldErrors]);

  useEffect(() => {
    if (!scrollCatalogFromBottomRef.current) return;
    scrollCatalogFromBottomRef.current = false;
    catalogResultsRef.current?.scrollIntoView?.({ block: 'start' });
  }, [catalogPage]);


  const selectedProduct = catalog?.products.find((product) => product.id === selectedProductId) ?? null;
  const visibleProducts = useMemo(() => {
    if (!catalog) return [];
    const needle = catalogQuery.trim().toLowerCase();
    return catalog.products.filter((product) => {
      const matchesType = catalogFilter === 'all'
        || (catalogFilter === 'simple' ? product.optionGroups.length === 0 : product.optionGroups.length > 0);
      return matchesType && (!needle || product.name.toLowerCase().includes(needle) || product.publicDescription.toLowerCase().includes(needle));
    });
  }, [catalog, catalogFilter, catalogQuery]);
  const matchingCount = visibleProducts.length;
  const totalCatalogPages = Math.max(1, Math.ceil(matchingCount / CATALOG_PAGE_SIZE));
  const currentCatalogPage = Math.min(Math.max(1, catalogPage), totalCatalogPages);
  const catalogPageStart = (currentCatalogPage - 1) * CATALOG_PAGE_SIZE;
  const pagedProducts = visibleProducts.slice(catalogPageStart, catalogPageStart + CATALOG_PAGE_SIZE);
  const rangeStart = matchingCount === 0 ? 0 : catalogPageStart + 1;
  const rangeEnd = matchingCount === 0 ? 0 : catalogPageStart + pagedProducts.length;

  useEffect(() => {
    setCatalogPage((current) => {
      const maxPage = Math.max(1, Math.ceil(visibleProducts.length / CATALOG_PAGE_SIZE));
      const next = Math.min(Math.max(1, current), maxPage);
      return next === current ? current : next;
    });
  }, [visibleProducts.length]);

  const goCatalogPage = (nextPage: number, origin: 'top' | 'bottom') => {
    const maxPage = Math.max(1, Math.ceil(visibleProducts.length / CATALOG_PAGE_SIZE));
    const next = Math.min(Math.max(1, nextPage), maxPage);
    if (origin === 'bottom') scrollCatalogFromBottomRef.current = true;
    setCatalogPage(next);
  };

  const matchingVariant = useMemo(() => {
    if (!selectedProduct || selectedProduct.optionGroups.length === 0) return null;
    return selectedProduct.variants.find((variant) => selectedProduct.optionGroups.every((group) =>
      variant.selectedOptions.some((option) => option.groupId === group.id && option.valueId === selectedOptions[group.id]),
    )) ?? null;
  }, [selectedOptions, selectedProduct]);

  const mixedCurrency = cart.length > 1 && cart.some((line) => line.currency !== cart[0].currency);
  const cartTotalMinor = mixedCurrency ? 0 : cart.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  const cartCurrency = mixedCurrency ? null : cart[0]?.currency ?? selectedProduct?.currency ?? null;
  const simpleCount = catalog?.products.filter((product) => product.optionGroups.length === 0).length ?? 0;
  const variantCount = catalog?.products.filter((product) => product.optionGroups.length > 0).length ?? 0;

  const resetAttempt = () => {
    if (checkoutLocked) return;
    attemptRef.current = null;
    setSubmitState('idle');
  };

  const addCurrentSelection = () => {
    if (checkoutLocked || !selectedProduct) return;
    const parsedQuantity = Number(quantity);
    const errors: FieldErrors = {};
    if (selectedProduct.optionGroups.length > 0 && !matchingVariant) errors.variant = 'Select one available value in every option group.';
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 99) errors.quantity = 'Enter a whole number from 1 to 99.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...errors }));
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    const variantId = matchingVariant?.id ?? null;
    if (cart.some((line) => line.productId === selectedProduct.id && line.variantId === variantId)) {
      setFieldErrors((current) => ({ ...current, cart: 'This Product selection is already in the Order. Change quantity on that line instead.' }));
      return;
    }
    if (cart.length >= 10) {
      setFieldErrors((current) => ({ ...current, cart: 'An Order can include at most 10 Product lines.' }));
      return;
    }
    const nextLine: CartLine = {
      key: crypto.randomUUID(),
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      currency: selectedProduct.currency,
      variantId,
      variantLabel: matchingVariant
        ? selectedProduct.optionGroups.map((group) => {
          const valueId = matchingVariant.selectedOptions.find((option) => option.groupId === group.id)?.valueId;
          const value = group.values.find((entry) => entry.id === valueId);
          return `${group.name}: ${value?.label ?? valueId}`;
        }).join(', ')
        : 'Simple Product',
      quantity: parsedQuantity,
      unitPriceMinor: matchingVariant?.effectivePriceMinor ?? selectedProduct.basePriceMinor,
    };
    setCart((current) => [...current, nextLine]);
    setFieldErrors((current) => ({ ...current, cart: undefined, variant: undefined, quantity: undefined }));
    resetAttempt();
  };

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (cart.length < 1) errors.cart = 'Add at least one Product before placing the Order.';
    if (cart.length > 10) errors.cart = 'An Order can include at most 10 Product lines.';
    if (mixedCurrency) errors.cart = MIXED_CURRENCY;
    if (cart.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99)) {
      errors.quantity = 'Enter a whole number from 1 to 99.';
    }
    if (!name.trim() || name.trim().length > 120) errors.name = 'Enter your name using 1 to 120 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    return errors;
  }, [cart, email, mixedCurrency, name]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitState === 'submitting' || contractOutdated) return;
    const frozen = attemptRef.current;
    if (!frozen) {
      const errors = validate();
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) {
        requestAnimationFrame(() => errorSummaryRef.current?.focus());
        return;
      }
    }
    const nextAttempt = frozen ?? {
      identity: createOrderAttemptIdentity(),
      input: {
        customer: { name: name.trim(), email: email.trim() },
        items: cart.map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: line.quantity })),
      },
    };
    attemptRef.current = nextAttempt;
    setName(nextAttempt.input.customer.name);
    setEmail(nextAttempt.input.customer.email);
    setSubmitState('submitting');
    setSubmitMessage(null);
    try {
      const order = await createStorefrontOrder(nextAttempt.input, nextAttempt.identity);
      const next = `/orders/${encodeURIComponent(order.reference)}#capability=${encodeURIComponent(nextAttempt.identity.capability)}`;
      attemptRef.current = null;
      setCart([]);
      setQuantity('1');
      setFieldErrors({});
      setSubmitState('idle');
      setSubmitMessage(null);
      window.history.pushState({}, '', next);
      setRoute(parseRoute());
    } catch (error) {
      if (error instanceof StorefrontApiError && error.code === 'client_contract_outdated') {
        setContractOutdated(true);
        setSubmitState('idle');
        setSubmitMessage('This Storefront is out of date. Reload the page and try again.');
        return;
      }
      if (error instanceof StorefrontApiError && error.status === 422) {
        attemptRef.current = null;
        setSubmitState('idle');
        const nextErrors: FieldErrors = {};
        for (const field of error.fields ?? []) {
          const itemMatch = /^\/items\/(\d+)\//.exec(field.path);
          if (itemMatch) {
            nextErrors.cart = field.message;
            lineFocusRef.current = `cart-qty-${cart[Number(itemMatch[1])]?.key ?? ''}`;
          } else if (field.path.includes('name')) nextErrors.name = field.message;
          else if (field.path.includes('email')) nextErrors.email = field.message;
          else nextErrors.cart = field.message;
        }
        setFieldErrors(nextErrors);
        requestAnimationFrame(() => errorSummaryRef.current?.focus());
        setSubmitMessage('Checkout could not be completed. Review your selection and details.');
        return;
      }
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
        <header className="catalog-hero">
          <div className="catalog-heading">
            <p className="catalog-kicker">Published catalog · Digital products</p>
            <h1>{catalog?.store.name ?? 'Digital products'}</h1>
            <p>{selectedProduct && selectedProduct.optionGroups.length > 0
              ? 'Choose Products, confirm each format, review the Order, then complete checkout.'
              : 'Choose Products, review the Order, then complete checkout.'}</p>
            <a className="hero-cta" href="#featured-products">Explore Catalog</a>
          </div>
          {catalog ? (
            <aside className="catalog-benchmark">
              <div className="catalog-benchmark-head">
                <span>Catalog snapshot</span>
                <span className="order-status">{catalog.store.name}</span>
              </div>
              <dl>
                <div><dt>Published Products</dt><dd className="numeric">{catalog.products.length}</dd></div>
                <div><dt>Simple</dt><dd className="numeric">{simpleCount}</dd></div>
                <div><dt>Variant</dt><dd className="numeric">{variantCount}</dd></div>
              </dl>
            </aside>
          ) : null}
        </header>
        {catalogState === 'loading' ? <div className="catalog-loading" aria-label="Loading catalog" aria-busy="true"><span /><span /><span /></div> : null}
        {catalogState === 'error' ? <div className="storefront-notice storefront-error" role="alert"><h2>Catalog could not be loaded</h2><p>Check your connection and try again.</p><button className="secondary-action" type="button" onClick={loadCatalog}>Retry catalog</button></div> : null}
        {catalogState === 'empty' ? <div className="storefront-notice"><h2>No Products are available</h2><p>Return later. Published Products will appear here.</p></div> : null}
        {catalogState === 'ready' && catalog ? (
          <>
            {catalog.products.length > 1 || catalogQuery.trim().length > 0 || catalogFilter !== 'all' ? (
              <section className="catalog-toolbar" aria-label="Catalog filters">
                <div className="status-pills">
                  <button className={catalogFilter === 'all' ? 'is-active' : undefined} type="button" onClick={() => { setCatalogFilter('all'); setCatalogPage(1); }}>All Products</button>
                  <button className={catalogFilter === 'simple' ? 'is-active' : undefined} type="button" onClick={() => { setCatalogFilter('simple'); setCatalogPage(1); }}>Simple</button>
                  <button className={catalogFilter === 'variant' ? 'is-active' : undefined} type="button" onClick={() => { setCatalogFilter('variant'); setCatalogPage(1); }}>Variant</button>
                </div>
                <div className="field catalog-search">
                  <label htmlFor="catalog-search">Search Products</label>
                  <input
                    id="catalog-search"
                    type="search"
                    name="q"
                    autoComplete="off"
                    value={catalogQuery}
                    onChange={(event) => { setCatalogQuery(event.target.value); setCatalogPage(1); }}
                  />
                </div>
              </section>
            ) : null}
            <div className="storefront-workspace">
              <div className="catalog-featured" id="featured-products" ref={catalogResultsRef}>
                <div>
                  <h2>Published Products</h2>
                  <p>Active catalog from this Store.</p>
                </div>
              </div>
              <div className="catalog-column">
                {matchingCount > 0 ? (
                  <CatalogPager
                    position="top"
                    rangeStart={rangeStart}
                    rangeEnd={rangeEnd}
                    matchingCount={matchingCount}
                    page={currentCatalogPage}
                    totalPages={totalCatalogPages}
                    onPrevious={() => goCatalogPage(currentCatalogPage - 1, 'top')}
                    onNext={() => goCatalogPage(currentCatalogPage + 1, 'top')}
                  />
                ) : null}
                <section className="catalog-list" aria-label="Available Products">
                  {matchingCount === 0 ? (
                    <div>
                      <p>No Products match this search.</p>
                      <button className="secondary-action" type="button" onClick={() => { setCatalogQuery(''); setCatalogFilter('all'); setCatalogPage(1); }}>Clear filters</button>
                    </div>
                  ) : null}
                  {pagedProducts.map((product) => (
                    <CatalogProduct
                      key={product.id}
                      product={product}
                      selected={product.id === selectedProductId}
                      onSelect={() => {
                        if (checkoutLocked) return;
                        setSelectedProductId(product.id);
                        setSelectedOptions({});
                        setFieldErrors((current) => ({ ...current, variant: undefined, quantity: undefined }));
                      }}
                    />
                  ))}
                </section>
                {matchingCount > 0 ? (
                  <CatalogPager
                    position="bottom"
                    rangeStart={rangeStart}
                    rangeEnd={rangeEnd}
                    matchingCount={matchingCount}
                    page={currentCatalogPage}
                    totalPages={totalCatalogPages}
                    onPrevious={() => goCatalogPage(currentCatalogPage - 1, 'bottom')}
                    onNext={() => goCatalogPage(currentCatalogPage + 1, 'bottom')}
                  />
                ) : null}
              </div>
              {selectedProduct ? <form className="purchase-ledger" onSubmit={submit} noValidate>
                <header><p className="ledger-label">Purchase ledger</p><h2>{selectedProduct.name}</h2><p>{selectedProduct.publicDescription}</p></header>
                {Object.values(fieldErrors).some(Boolean) ? <div ref={errorSummaryRef} className="error-summary" role="alert" tabIndex={-1}><strong>Review checkout details</strong><ul>{Object.entries(fieldErrors).filter((entry): entry is [string, string] => Boolean(entry[1])).map(([field, message]) => <li key={field}><a href={`#checkout-${field === 'cart' ? 'cart' : field}`}>{message}</a></li>)}</ul></div> : null}
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
                          disabled={checkoutLocked}
                          aria-invalid={Boolean(fieldErrors.variant)}
                          aria-describedby={fieldErrors.variant ? 'variant-error' : undefined}
                          onBlur={() => setFieldErrors((current) => ({ ...current, variant: matchingVariant ? undefined : 'Select one available value in every option group.' }))}
                          onChange={(event) => {
                            if (checkoutLocked) return;
                            setSelectedOptions((current) => ({ ...current, [group.id]: event.target.value }));
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
                  <div className="field">
                    <label htmlFor="checkout-quantity">Quantity</label>
                    <input
                      id="checkout-quantity"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="99"
                      step="1"
                      value={quantity}
                      disabled={checkoutLocked}
                      aria-invalid={Boolean(fieldErrors.quantity)}
                      aria-describedby={fieldErrors.quantity ? 'quantity-error' : undefined}
                      onBlur={() => setFieldErrors((current) => ({ ...current, quantity: Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 99 ? undefined : 'Enter a whole number from 1 to 99.' }))}
                      onChange={(event) => {
                        if (checkoutLocked) return;
                        setQuantity(event.target.value);
                      }}
                    />
                    {fieldErrors.quantity ? <span id="quantity-error" className="field-error">{fieldErrors.quantity}</span> : null}
                  </div>
                  <div className="field"><label htmlFor="checkout-name">Name</label><input id="checkout-name" autoComplete="name" value={name} disabled={checkoutLocked} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'name-error' : undefined} onBlur={() => setFieldErrors((current) => ({ ...current, name: name.trim() && name.trim().length <= 120 ? undefined : 'Enter your name using 1 to 120 characters.' }))} onChange={(event) => { if (checkoutLocked) return; setName(event.target.value); }} />{fieldErrors.name ? <span id="name-error" className="field-error">{fieldErrors.name}</span> : null}</div>
                  <div className="field"><label htmlFor="checkout-email">Email</label><input id="checkout-email" type="email" autoComplete="email" value={email} disabled={checkoutLocked} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'email-error' : undefined} onBlur={() => setFieldErrors((current) => ({ ...current, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'Enter a valid email address.' }))} onChange={(event) => { if (checkoutLocked) return; setEmail(event.target.value); }} />{fieldErrors.email ? <span id="email-error" className="field-error">{fieldErrors.email}</span> : null}</div>
                </div>
                <div className="inline-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={checkoutLocked || (selectedProduct.optionGroups.length > 0 && !matchingVariant)}
                    onClick={addCurrentSelection}
                  >
                    Add to Order
                  </button>
                </div>
                <section id="checkout-cart" className="cart-review" aria-labelledby="cart-title">
                  <h3 id="cart-title">Order review</h3>
                  {cart.length === 0 ? <p>No Products have been added yet.</p> : (
                    <ul className="cart-lines">
                      {cart.map((line) => (
                        <li key={line.key}>
                          <div>
                            <strong>{line.productName}</strong>
                            <p>{line.variantLabel}</p>
                            <p className="numeric">{money(line.unitPriceMinor * line.quantity, line.currency)} {line.currency}</p>
                          </div>
                          <div className="field">
                            <label htmlFor={`cart-qty-${line.key}`}>Quantity</label>
                            <input
                              id={`cart-qty-${line.key}`}
                              type="number"
                              min="1"
                              max="99"
                              step="1"
                              value={line.quantity}
                              disabled={checkoutLocked}
                              onChange={(event) => {
                                if (checkoutLocked) return;
                                const nextQuantity = Number(event.target.value);
                                setCart((current) => current.map((entry) => entry.key === line.key ? { ...entry, quantity: nextQuantity } : entry));
                                resetAttempt();
                              }}
                            />
                          </div>
                          <button
                            className="text-action"
                            type="button"
                            disabled={checkoutLocked}
                            onClick={() => {
                              if (checkoutLocked) return;
                              setCart((current) => current.filter((entry) => entry.key !== line.key));
                              resetAttempt();
                            }}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {mixedCurrency ? <p className="field-error" role="alert">{MIXED_CURRENCY}</p> : null}
                  {fieldErrors.cart ? <p id="cart-error" className="field-error">{fieldErrors.cart}</p> : null}
                </section>
                <div className="purchase-total">
                  <span>Order total</span>
                  <strong className="numeric">{cartCurrency ? money(cartTotalMinor, cartCurrency) : '—'}</strong>
                </div>
                {submitMessage ? <p className="submit-message" role="alert">{submitMessage}</p> : null}
                {contractOutdated ? <button className="secondary-action" type="button" onClick={() => { window.location.reload(); }}>Reload Storefront</button> : null}
                <button className="primary-action" type="submit" disabled={placeLocked || cart.length === 0 || mixedCurrency}>{submitState === 'submitting' ? 'Placing Order' : submitState === 'retry' ? 'Retry checkout' : 'Place Order'}</button>
              </form> : null}
            </div>
            <section className="editorial-band">
              <div>
                <p className="catalog-kicker">Private delivery</p>
                <h2>Checkout creates a private Order link.</h2>
                <p>Payment instructions stay off this catalog. Open the complete link after placing an Order.</p>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </StorefrontFrame>
  );
}

function StorefrontFrame({ children }: { children: ReactNode }) {
  return (
    <div className="storefront-shell">
      <a className="skip-link" href="#storefront-content">Skip to main content</a>
      <p className="storefront-banner">
        <span className="icon-glyph" aria-hidden="true">verified</span>
        Shop digital products from this store · Checkout creates an Order link
      </p>
      <header className="storefront-header">
        <div className="storefront-header-row">
          <a className="storefront-brand" href="/">
            <span className="storefront-brand-mark">Nexus</span>
            <span className="storefront-brand-meta">/ STOREFRONT</span>
          </a>
          <nav className="storefront-nav" aria-label="Storefront">
            <a className="storefront-nav-current" href="/" aria-current="page">Catalog</a>
          </nav>
        </div>
      </header>
      {children}
      <footer className="storefront-footer">
        <div className="storefront-footer-inner">
          <div>
            <div className="storefront-footer-brand">Nexus</div>
            <p>Digital products from this Store. Checkout creates an Order link.</p>
          </div>
          <div>
            <p className="footer-heading">Catalog</p>
            <p>Published Products appear here when Active.</p>
          </div>
          <div>
            <p className="footer-heading">Orders</p>
            <p>Checkout creates an Order link for the Customer.</p>
          </div>
          <div>
            <p className="footer-heading">Console</p>
            <p>Operators manage Products and Orders.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
