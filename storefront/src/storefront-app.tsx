import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  createOrderAttemptIdentity,
  createStorefrontOrder,
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
type CatalogFilter = 'all' | 'simple' | 'variant';

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

function PrivateOrderPage({ route, onBack }: { route: Extract<OrderRoute, { kind: 'order' }>; onBack: () => void }) {
  const [order, setOrder] = useState<CustomerOrderView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'missing-capability'>('loading');

  const load = useCallback((signal?: AbortSignal) => {
    if (!route.capability) { setState('missing-capability'); return; }
    setState('loading');
    void fetchStorefrontOrder(route.reference, route.capability, signal)
      .then((result) => { setOrder(result); setState('ready'); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setState('error'); });
  }, [route.capability, route.reference]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <main id="storefront-content" className="order-page" tabIndex={-1}>
      <button className="text-action" type="button" onClick={onBack}>Back to catalog</button>
      {state === 'loading' ? <div className="order-ledger loading-ledger" aria-label="Loading…" aria-busy="true"><span /><span /><span /></div> : null}
      {state === 'missing-capability' ? <div className="storefront-notice storefront-error" role="alert"><h1>Private Order link required</h1><p>Open the complete link provided after checkout to view this Order.</p></div> : null}
      {state === 'error' ? <div className="storefront-notice storefront-error" role="alert"><h1>Order could not be loaded</h1><p>The private Order is unavailable. Retry without changing the link.</p><button className="secondary-action" type="button" onClick={() => load()}>Retry Order</button></div> : null}
      {state === 'ready' && order ? (
        <article className="order-ledger" aria-labelledby="order-title">
          <header><div><p className="ledger-label">Order {order.reference}</p><h1 id="order-title">{order.product.name}</h1></div><span className="order-status">Pending payment</span></header>
          {order.product.variant ? <section><h2>Selection</h2><p className="variant-sku">SKU {order.product.variant.sku}</p><dl>{order.product.variant.selectedOptions.map((option) => <div key={option.groupId}><dt>{option.groupName}</dt><dd>{option.valueLabel}</dd></div>)}</dl></section> : <section><h2>Selection</h2><p>Simple Product</p></section>}
          <section className="amount-ledger"><dl><div><dt>Quantity</dt><dd className="numeric">{order.quantity}</dd></div><div><dt>Unit price</dt><dd className="numeric">{money(order.unitPriceMinor, order.currency)}</dd></div><div className="total-line"><dt>Total</dt><dd className="numeric">{money(order.totalMinor, order.currency)}</dd></div></dl></section>
          <section><h2>Payment next step</h2><p>{order.paymentNextStep}</p></section>
          <footer>Created {new Date(order.createdAt).toLocaleString()}</footer>
        </article>
      ) : null}
    </main>
  );
}

export function StorefrontApp() {
  const [route, setRoute] = useState<OrderRoute>(parseRoute);
  const [catalog, setCatalog] = useState<StorefrontCatalog | null>(null);
  const [catalogState, setCatalogState] = useState<CatalogState>('loading');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const catalogStart = readCatalogCriteria();
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>(catalogStart.filter);
  const [catalogQuery, setCatalogQuery] = useState(catalogStart.query);
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
      setRoute(parseRoute());
      const criteria = readCatalogCriteria();
      setCatalogQuery(criteria.query);
      setCatalogFilter(criteria.filter);
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

  const visibleProducts = useMemo(() => {
    if (!catalog) return [];
    const needle = catalogQuery.trim().toLowerCase();
    return catalog.products.filter((product) => {
      const matchesType = catalogFilter === 'all'
        || (catalogFilter === 'simple' ? product.optionGroups.length === 0 : product.optionGroups.length > 0);
      return matchesType && (!needle || product.name.toLowerCase().includes(needle) || product.publicDescription.toLowerCase().includes(needle));
    });
  }, [catalog, catalogFilter, catalogQuery]);

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

  if (route.kind === 'order') return <StorefrontFrame><PrivateOrderPage route={route} onBack={navigateCatalog} /></StorefrontFrame>;

  const simpleCount = catalog?.products.filter((product) => product.optionGroups.length === 0).length ?? 0;
  const variantCount = catalog?.products.filter((product) => product.optionGroups.length > 0).length ?? 0;

  return (
    <StorefrontFrame>
      <main id="storefront-content" className="catalog-page" tabIndex={-1}>
        <header className="catalog-hero">
          <div className="catalog-heading">
            <p className="catalog-kicker">Published catalog · Digital products</p>
            <h1>Digital products from this Store.</h1>
            <p>Choose a Product, confirm the format, then complete checkout. Private delivery stays on the Order link.</p>
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
        {catalogState === 'loading' ? <div className="catalog-loading" aria-label="Loading…" aria-busy="true"><span /><span /><span /></div> : null}
        {catalogState === 'error' ? <div className="storefront-notice storefront-error" role="alert"><h2>Catalog could not be loaded</h2><p>Check your connection and try again.</p><button className="secondary-action" type="button" onClick={loadCatalog}>Retry catalog</button></div> : null}
        {catalogState === 'empty' ? <div className="storefront-notice"><h2>No Products are available</h2><p>Return later. Published Products will appear here.</p></div> : null}
        {catalogState === 'ready' && catalog ? (
          <>
            <section className="catalog-toolbar" aria-label="Catalog filters">
              <div className="status-pills">
                <button className={catalogFilter === 'all' ? 'is-active' : undefined} type="button" onClick={() => setCatalogFilter('all')}>All Products</button>
                <button className={catalogFilter === 'simple' ? 'is-active' : undefined} type="button" onClick={() => setCatalogFilter('simple')}>Simple</button>
                <button className={catalogFilter === 'variant' ? 'is-active' : undefined} type="button" onClick={() => setCatalogFilter('variant')}>Variant</button>
              </div>
              <label className="catalog-search">
                <span className="sr-only">Search catalog</span>
                <input type="search" name="q" autoComplete="off" value={catalogQuery} placeholder="Ceramic Form Pack…" onChange={(event) => setCatalogQuery(event.target.value)} />
              </label>
            </section>
            <div className="storefront-workspace">
              <div className="catalog-featured" id="featured-products">
                <div>
                  <h2>Published Products</h2>
                  <p>Active catalog from this Store.</p>
                </div>
                <p>Showing {visibleProducts.length} Products</p>
              </div>
              <section className="catalog-list" aria-label="Available Products">{visibleProducts.map((product) => (
                <CatalogProduct
                  key={product.id}
                  product={product}
                  selected={product.id === selectedProductId}
                  onSelect={() => {
                    setSelectedProductId(product.id);
                    setSelectedOptions({});
                    setFieldErrors({});
                    attemptRef.current = null;
                    setSubmitState('idle');
                  }}
                />
              ))}</section>
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
                  <div className="field"><label htmlFor="checkout-quantity">Quantity</label><input id="checkout-quantity" name="quantity" autoComplete="off" type="number" inputMode="numeric" min="1" max="99" step="1" value={quantity} aria-invalid={Boolean(fieldErrors.quantity)} aria-describedby={fieldErrors.quantity ? 'quantity-error' : undefined} onBlur={() => setFieldErrors((current) => ({ ...current, quantity: Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 99 ? undefined : 'Enter a whole number from 1 to 99.' }))} onChange={(event) => { setQuantity(event.target.value); attemptRef.current = null; setSubmitState('idle'); }} />{fieldErrors.quantity ? <span id="quantity-error" className="field-error">{fieldErrors.quantity}</span> : null}</div>
                  <div className="field"><label htmlFor="checkout-name">Name</label><input id="checkout-name" name="name" autoComplete="name" value={name} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'name-error' : undefined} onBlur={() => setFieldErrors((current) => ({ ...current, name: name.trim() && name.trim().length <= 120 ? undefined : 'Enter your name using 1 to 120 characters.' }))} onChange={(event) => { setName(event.target.value); attemptRef.current = null; setSubmitState('idle'); }} />{fieldErrors.name ? <span id="name-error" className="field-error">{fieldErrors.name}</span> : null}</div>
                  <div className="field"><label htmlFor="checkout-email">Email</label><input id="checkout-email" name="email" type="email" autoComplete="email" spellCheck={false} value={email} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'email-error' : undefined} onBlur={() => setFieldErrors((current) => ({ ...current, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'Enter a valid email address.' }))} onChange={(event) => { setEmail(event.target.value); attemptRef.current = null; setSubmitState('idle'); }} />{fieldErrors.email ? <span id="email-error" className="field-error">{fieldErrors.email}</span> : null}</div>
                </div>
                <div className="purchase-total"><span>{matchingVariant ? 'Selected price' : 'Product price'}</span><strong className="numeric">{money(matchingVariant?.effectivePriceMinor ?? selectedProduct.basePriceMinor, selectedProduct.currency)}</strong></div>
                {submitMessage ? <p className="submit-message" role="alert">{submitMessage}</p> : null}
                <button className="primary-action" type="submit" disabled={submitState === 'submitting'}>{submitState === 'submitting' ? 'Placing Order…' : submitState === 'retry' ? 'Retry checkout' : 'Place Order'}</button>
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
        Shop digital products from this store · Private delivery after checkout
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
            <p>Digital products from this Store. Private delivery after checkout.</p>
          </div>
          <div>
            <p className="footer-heading">Catalog</p>
            <p>Published Products appear here when Active.</p>
          </div>
          <div>
            <p className="footer-heading">Orders</p>
            <p>Checkout creates a private Order link for the Customer.</p>
          </div>
          <div>
            <p className="footer-heading">Console</p>
            <p>Operators manage Products, Variants, and the Order list.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
