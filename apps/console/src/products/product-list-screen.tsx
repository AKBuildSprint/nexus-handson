import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ProductListState, ProductStatus, ProductSummary } from './product-ui-types';
import { useConsoleSearchHost } from '../layout/console-search-host';

interface ProductListScreenProps {
  state: ProductListState;
  products: ProductSummary[];
  onAddProduct: () => void;
  onEditProduct: (productId: string) => void;
  onImportCsv: () => void;
  onDownloadTemplate: () => Promise<void> | void;
  onRetry: () => void;
  onCriteriaChange?: (query: string, status: 'all' | 'draft' | 'active' | 'archived') => void;
  readOnly?: boolean;
}

const FILTERS: ReadonlyArray<'All' | ProductStatus> = ['All', 'Draft', 'Active', 'Archived'];
const PRODUCT_PAGE_SIZE = 25;

function readListCriteria(): { query: string; filter: (typeof FILTERS)[number] } {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status');
  const filter = status === 'draft' ? 'Draft' : status === 'active' ? 'Active' : status === 'archived' ? 'Archived' : 'All';
  return { query: params.get('q') ?? '', filter };
}

function writeListCriteria(query: string, filter: (typeof FILTERS)[number]): void {
  const params = new URLSearchParams(window.location.search);
  const trimmed = query.trim();
  if (trimmed) params.set('q', trimmed);
  else params.delete('q');
  if (filter === 'All') params.delete('status');
  else params.set('status', filter.toLowerCase());
  const search = params.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== next) window.history.replaceState(window.history.state, '', next);
}

function StatusTag({ status }: { status: ProductStatus }) {
  return <span className={`status-tag status-${status.toLowerCase()}`}>{status}</span>;
}

function ProductListPager({
  placement,
  start,
  end,
  total,
  page,
  totalPages,
  onPrevious,
  onNext,
}: {
  placement: 'top' | 'bottom';
  start: number;
  end: number;
  total: number;
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className="pager" aria-label={`Product pages ${placement}`}>
      <p className="pager-range">
        Showing {start}–{end} of {total}
        <span aria-hidden="true"> · </span>
        Page {page} of {totalPages}
      </p>
      <div className="pager-actions">
        <button className="button pager-step" type="button" disabled={page <= 1} onClick={onPrevious}>Previous</button>
        {placement === 'bottom' ? <span className="pager-chip numeric" aria-hidden="true">{page}</span> : null}
        <button className="button pager-step" type="button" disabled={page >= totalPages} onClick={onNext}>Next</button>
        {placement === 'bottom' ? <span className="pager-page-size numeric">{PRODUCT_PAGE_SIZE} / page</span> : null}
      </div>
    </nav>
  );
}


export function ProductListScreen({
  state,
  products,
  onAddProduct,
  onEditProduct,
  onImportCsv,
  onDownloadTemplate,
  onRetry,
  onCriteriaChange,
  readOnly = false,
}: ProductListScreenProps) {
  const initialCriteria = readListCriteria();
  const [query, setQuery] = useState(initialCriteria.query);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>(initialCriteria.filter);
  const [page, setPage] = useState(1);
  const [templateState, setTemplateState] = useState<'idle' | 'loading' | 'success' | 'error'>(
    state === 'template-error' ? 'error' : 'idle',
  );
  const resultsRef = useRef<HTMLElement>(null);
  const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchHost = useConsoleSearchHost();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchHeldFocusRef = useRef(false);
  const searchCaretRef = useRef<number | null>(null);
  const searchHostRef = useRef<HTMLElement | null>(null);
  const applyQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };
  const applyFilter = (next: (typeof FILTERS)[number]) => {
    setFilter(next);
    setPage(1);
  };
  const goToPage = (nextPage: number, placement: 'top' | 'bottom') => {
    setPage(nextPage);
    if (placement === 'bottom') resultsRef.current?.scrollIntoView({ block: 'start' });
  };
  const rememberSearchCursor = useCallback((input: HTMLInputElement) => {
    searchCaretRef.current = input.selectionStart;
  }, []);

  // The host swap remounts the input and drops its selection. Snapshot the live
  // caret while the current input is still attached to the document.
  if (searchHostRef.current !== searchHost && searchInputRef.current && document.activeElement === searchInputRef.current) {
    searchCaretRef.current = searchInputRef.current.selectionStart;
    searchHeldFocusRef.current = true;
  }

  // The search control changes host at 719↔720 px, which remounts the input.
  // Hand focus and the caret back to the same query without touching criteria.
  useLayoutEffect(() => {
    if (searchHostRef.current === searchHost) return;
    searchHostRef.current = searchHost;
    if (!searchHeldFocusRef.current) return;
    const input = searchInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const caret = searchCaretRef.current;
    if (caret === null) return;
    try {
      input.setSelectionRange(caret, caret);
    } catch {
      // Some engines refuse a selection range on a search input; focus still moves.
    }
  }, [searchHost]);

  useEffect(() => {
    setTemplateState(state === 'template-error' ? 'error' : 'idle');
  }, [state]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return products.filter((product) => {
      const matchesQuery = !normalizedQuery
        || product.name.toLocaleLowerCase().includes(normalizedQuery)
        || (product.slug ?? '').toLocaleLowerCase().includes(normalizedQuery);
      const matchesFilter = filter === 'All' || product.status === filter;
      return matchesQuery && matchesFilter;
    });
  }, [filter, products, query]);
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStartIndex = (currentPage - 1) * PRODUCT_PAGE_SIZE;
  const pageProducts = filteredProducts.slice(pageStartIndex, pageStartIndex + PRODUCT_PAGE_SIZE);
  const rangeStart = pageProducts.length === 0 ? 0 : pageStartIndex + 1;
  const rangeEnd = pageStartIndex + pageProducts.length;
  const catalogCounts = useMemo(() => ({
    total: products.length,
    active: products.filter((product) => product.status === 'Active').length,
    variant: products.filter((product) => product.type === 'Variant').length,
    simple: products.filter((product) => product.type === 'Simple').length,
  }), [products]);
  useEffect(() => {
    onCriteriaChange?.(query, filter === 'All' ? 'all' : filter.toLowerCase() as 'draft' | 'active' | 'archived');
  }, [filter, onCriteriaChange, query]);
  useEffect(() => {
    writeListCriteria(query, filter);
  }, [filter, query]);
  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);
  const downloadTemplate = async () => {
    setTemplateState('loading');
    try {
      await onDownloadTemplate();
      setTemplateState('success');
    } catch {
      setTemplateState('error');
    }
  };

  const handleFilterKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % FILTERS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + FILTERS.length) % FILTERS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = FILTERS.length - 1;
    else return;

    event.preventDefault();
    applyFilter(FILTERS[nextIndex]);
    filterRefs.current[nextIndex]?.focus();
  };

  const hasActiveFilters = Boolean(query.trim()) || filter !== 'All';
  const showProducts = state === 'populated' || state === 'row-opening' || state === 'template-error';
  const openingProductId = state === 'row-opening' ? products[0]?.id : undefined;

  const productName = (product: ProductSummary) => {
    if (product.id === openingProductId) {
      return (
        <button className="text-button" type="button" disabled aria-label={`Opening ${product.name}`}>
          Opening Product…
        </button>
      );
    }
    if (readOnly) return <strong>{product.name}</strong>;
    return (
      <a
        className="product-link"
        href={`/console/products/${encodeURIComponent(product.slug ?? product.id)}`}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          onEditProduct(product.id);
        }}
      >
        {product.name}
      </a>
    );
  };

  const searchField = (
    <form
      className="console-search"
      role="search"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="console-search-label" htmlFor="product-search">Search Products</label>
      <input
        id="product-search"
        ref={searchInputRef}
        type="search"
        value={query}
        placeholder="Field Notes…"
        name="q"
        autoComplete="off"
        onFocus={() => { searchHeldFocusRef.current = true; }}
        onBlur={(event) => {
          searchHeldFocusRef.current = false;
          rememberSearchCursor(event.currentTarget);
        }}
        onSelect={(event) => rememberSearchCursor(event.currentTarget)}
        onChange={(event) => {
          rememberSearchCursor(event.target);
          applyQuery(event.target.value);
        }}
      />
    </form>
  );

  return (
    <div className="page-stack">
      <header className="console-tab-row">
        <h1 className="console-tab">Products</h1>
        {readOnly ? <p className="console-tab-note">Read-only Product catalog for this Store.</p> : null}
        {!readOnly ? <div className="inline-actions" aria-label="Product list actions">
          <button className="button" type="button" onClick={downloadTemplate} disabled={templateState === 'loading'}>
            {templateState === 'loading' ? 'Downloading template…' : templateState === 'error' ? 'Retry CSV template' : 'Download CSV template'}
          </button>
          <button className="button" type="button" onClick={onImportCsv}>
            Import CSV
          </button>
          <button className="button button-primary" type="button" onClick={onAddProduct}>
            Add Product
          </button>
        </div> : null}
      </header>

      {searchHost ? createPortal(searchField, searchHost) : searchField}

      {templateState === 'success' ? (
        <div className="notice notice-success" role="status">
          <strong>Template downloaded</strong>
          <span>nexus-product-import-template.csv is ready.</span>
        </div>
      ) : null}

      {templateState === 'error' ? (
        <div className="notice notice-error" role="alert">
          <strong>CSV template could not be downloaded</strong>
          <span>Retry the download or open Import CSV. Add Product and catalog recovery actions remain available.</span>
        </div>
      ) : null}

      <section
        ref={resultsRef}
        className="data-region"
        aria-labelledby="product-results-title"
        aria-busy={state === 'loading' || state === 'filtered-loading'}
      >
        <h2 id="product-results-title" className="sr-only">
          Product results
        </h2>
        <p className="sr-only" aria-live="polite">
          {state === 'populated' && filteredProducts.length > 0 ? `Showing ${rangeStart}–${rangeEnd} of ${filteredProducts.length} Products.` : ''}
        </p>

        <div className="console-panel-head">
          <span className="sr-only" id="product-status-filter-label">Filter Products by status</span>
          <div className="status-tabs" role="tablist" aria-labelledby="product-status-filter-label">
            {FILTERS.map((option, index) => (
              <button
                key={option}
                ref={(element) => {
                  filterRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                aria-selected={filter === option}
                tabIndex={filter === option ? 0 : -1}
                onClick={() => applyFilter(option)}
                onKeyDown={(event) => handleFilterKeyDown(event, index)}
              >
                {option}
              </button>
            ))}
          </div>
          {showProducts && filteredProducts.length > 0 ? (
            <ProductListPager
              placement="top"
              start={rangeStart}
              end={rangeEnd}
              total={filteredProducts.length}
              page={currentPage}
              totalPages={totalPages}
              onPrevious={() => goToPage(currentPage - 1, 'top')}
              onNext={() => goToPage(currentPage + 1, 'top')}
            />
          ) : null}
        </div>

        {state === 'loading' || state === 'filtered-loading' ? (
          <div aria-label={state === 'filtered-loading' ? 'Updating filtered Products' : 'Loading…'}>
            {[0, 1, 2, 3].map((row) => (
              <div className="skeleton-row" key={row} aria-hidden="true">
                {[0, 1, 2, 3, 4, 5, 6].map((cell) => (
                  <span className="skeleton-line" key={cell} />
                ))}
              </div>
            ))}
          </div>
        ) : null}

        {state === 'error' ? (
          <div className="empty-state notice-error" role="alert">
            <h3>Products could not be loaded</h3>
            <p>The catalog data region is unavailable. You can retry without losing access to create, import, or template actions.</p>
            <button className="button" type="button" onClick={onRetry}>
              Retry loading Products
            </button>
          </div>
        ) : null}

        {state === 'empty' ? (
          <div className="empty-state">
            <h3>{readOnly ? 'No Products are available in this Store.' : 'Create your first Product or import a prepared CSV.'}</h3>
            <p>{readOnly ? 'An Owner can add or import Products.' : 'Start with one Product in the editor, or use the fixed Nexus template for a prepared catalog.'}</p>
            {!readOnly ? <div className="inline-actions">
              <button className="button button-primary" type="button" onClick={onAddProduct}>
                Add Product
              </button>
              <button className="button" type="button" onClick={onImportCsv}>
                Import CSV
              </button>
            </div> : null}
          </div>
        ) : null}

        {showProducts && filteredProducts.length === 0 ? (
          <div className="empty-state">
            <h3>No Products match these filters.</h3>
            <p>Keep the current catalog and clear the search and status scope.</p>
            <button
              className="button"
              type="button"
              onClick={() => {
                applyQuery('');
                applyFilter('All');
              }}
            >
              Clear filters
            </button>
          </div>
        ) : null}

        {showProducts && filteredProducts.length > 0 ? (
          <>
            <div className="console-table-scroll">
              <table className="console-table products-table" aria-label="Products in this Store">
                <thead>
                  <tr>
                    <th className="products-col-slug" scope="col">Slug</th>
                    <th scope="col">Product</th>
                    <th className="products-col-status" scope="col">Status</th>
                    <th className="products-col-type" scope="col">Type</th>
                    <th className="products-col-price" scope="col">Effective price</th>
                    <th className="products-col-variants" scope="col">Variants</th>
                    <th className="products-col-updated" scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {pageProducts.map((product) => (
                    <tr key={product.id}>
                      <td className="products-col-slug products-slug">{product.slug ?? '—'}</td>
                      <td>{productName(product)}</td>
                      <td className="products-col-status"><StatusTag status={product.status} /></td>
                      <td className="products-col-type products-type">{product.type}</td>
                      <td className="products-col-price numeric">{product.effectivePrice}</td>
                      <td className="products-col-variants numeric">{product.enabledVariants === null ? 'Not applicable' : product.enabledVariants}</td>
                      <td className="products-col-updated products-updated numeric">{product.updated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="product-list-mobile" aria-label="Products in this Store">
              {pageProducts.map((product) => (
                <article className="product-summary-card" key={product.id}>
                  {productName(product)}
                  <StatusTag status={product.status} />
                  <dl>
                    <div><dt>Type</dt><dd>{product.type}</dd></div>
                    <div><dt>Effective price</dt><dd className="numeric">{product.effectivePrice}</dd></div>
                    <div><dt>Enabled Variants</dt><dd className="numeric">{product.enabledVariants === null ? 'Not applicable' : product.enabledVariants}</dd></div>
                    <div><dt>Updated</dt><dd>{product.updated}</dd></div>
                  </dl>
                </article>
              ))}
            </div>

            <div className="console-table-footer">
              <p className="summary-row">
                <span className="summary-stat">Products <strong className="numeric">{catalogCounts.total}</strong></span>
                <span className="summary-stat">Active <strong className="numeric">{catalogCounts.active}</strong></span>
                <span className="summary-stat">Simple <strong className="numeric">{catalogCounts.simple}</strong></span>
                <span className="summary-stat">Variant <strong className="numeric">{catalogCounts.variant}</strong></span>
              </p>
              <ProductListPager
                placement="bottom"
                start={rangeStart}
                end={rangeEnd}
                total={filteredProducts.length}
                page={currentPage}
                totalPages={totalPages}
                onPrevious={() => goToPage(currentPage - 1, 'bottom')}
                onNext={() => goToPage(currentPage + 1, 'bottom')}
              />
            </div>
          </>
        ) : null}

        {(showProducts || state === 'empty') && filteredProducts.length === 0 ? (
          <div className="console-table-footer">
            <p className="summary-row">
              <span className="summary-stat">Products <strong className="numeric">{catalogCounts.total}</strong></span>
              <span className="summary-stat">Active <strong className="numeric">{catalogCounts.active}</strong></span>
              <span className="summary-stat">Simple <strong className="numeric">{catalogCounts.simple}</strong></span>
              <span className="summary-stat">Variant <strong className="numeric">{catalogCounts.variant}</strong></span>
            </p>
          </div>
        ) : null}
      </section>

      {hasActiveFilters && state !== 'populated' ? (
        <p className="meta-text">Search and status controls remain available while this scenario is shown.</p>
      ) : null}
    </div>
  );
}
