import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ProductListState, ProductStatus, ProductSummary } from './product-ui-types';

interface ProductListScreenProps {
  state: ProductListState;
  products: ProductSummary[];
  onAddProduct: () => void;
  onEditProduct: (productId: string) => void;
  onImportCsv: () => void;
  onDownloadTemplate: () => Promise<void> | void;
  onRetry: () => void;
  onCriteriaChange?: (query: string, status: 'all' | 'draft' | 'active' | 'archived') => void;
}

const FILTERS: ReadonlyArray<'All' | ProductStatus> = ['All', 'Draft', 'Active', 'Archived'];

function StatusTag({ status }: { status: ProductStatus }) {
  return <span className={`status-tag status-${status.toLowerCase()}`}>{status}</span>;
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
}: ProductListScreenProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [templateState, setTemplateState] = useState<'idle' | 'loading' | 'success' | 'error'>(
    state === 'template-error' ? 'error' : 'idle',
  );
  const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
  useEffect(() => {
    onCriteriaChange?.(query, filter === 'All' ? 'all' : filter.toLowerCase() as 'draft' | 'active' | 'archived');
  }, [filter, onCriteriaChange, query]);
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
    setFilter(FILTERS[nextIndex]);
    filterRefs.current[nextIndex]?.focus();
  };

  const hasActiveFilters = Boolean(query.trim()) || filter !== 'All';
  const showProducts = state === 'populated' || state === 'row-opening' || state === 'template-error';
  const openingProductId = state === 'row-opening' ? products[0]?.id : undefined;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div className="page-header-copy">
          <h1>Products</h1>
          <p>Find, create, and import the digital Products available in this Store.</p>
        </div>
        <div className="page-actions" aria-label="Product list actions">
          <button className="button" type="button" onClick={onImportCsv}>
            Import CSV
          </button>
          <button className="button" type="button" onClick={downloadTemplate} disabled={templateState === 'loading'}>
            {templateState === 'loading' ? 'Downloading template' : templateState === 'error' ? 'Retry CSV template' : 'Download CSV template'}
          </button>
          <button className="button button-primary" type="button" onClick={onAddProduct}>
            Add Product
          </button>
        </div>
      </header>

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

      <section className="product-tools" aria-label="Search and filter Products">
        <div className="field">
          <label htmlFor="product-search">Search Products</label>
          <input
            id="product-search"
            type="search"
            value={query}
            placeholder="Search by Product name"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div>
          <span className="field-label" id="product-status-filter-label">
            Product status
          </span>
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
                onClick={() => setFilter(option)}
                onKeyDown={(event) => handleFilterKeyDown(event, index)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section
        className="data-region"
        aria-labelledby="product-results-title"
        aria-busy={state === 'loading' || state === 'filtered-loading'}
      >
        <h2 id="product-results-title" className="sr-only">
          Product results
        </h2>
        <p className="sr-only" aria-live="polite">
          {state === 'populated' ? `${filteredProducts.length} Products shown.` : ''}
        </p>

        {state === 'loading' || state === 'filtered-loading' ? (
          <div aria-label={state === 'filtered-loading' ? 'Updating filtered Products' : 'Loading Products'}>
            {[0, 1, 2, 3].map((row) => (
              <div className="skeleton-row" key={row} aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((cell) => (
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
            <h3>Create your first Product or import a prepared CSV.</h3>
            <p>Start with one Product in the editor, or use the fixed Nexus template for a prepared catalog.</p>
            <div className="inline-actions">
              <button className="button button-primary" type="button" onClick={onAddProduct}>
                Add Product
              </button>
              <button className="button" type="button" onClick={onImportCsv}>
                Import CSV
              </button>
            </div>
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
                setQuery('');
                setFilter('All');
              }}
            >
              Clear filters
            </button>
          </div>
        ) : null}

        {showProducts && filteredProducts.length > 0 ? (
          <>
            <table className="console-table" aria-label="Products in this Store">
              <thead>
                <tr>
                  <th className="product-column" scope="col">Product</th>
                  <th scope="col">Status</th>
                  <th scope="col">Type</th>
                  <th scope="col">Effective price range</th>
                  <th scope="col">Enabled Variants</th>
                  <th scope="col">Updated time</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id}>
                    <td>
                      {product.id === openingProductId ? (
                        <button className="text-button" type="button" disabled aria-label={`Opening ${product.name}`}>
                          Opening Product
                        </button>
                      ) : (
                        <a
                          className="product-link"
                          href={`/console/products/${encodeURIComponent(product.slug ?? product.id)}`}
                          onClick={(event) => {
                            event.preventDefault();
                            onEditProduct(product.id);
                          }}
                        >
                          {product.name}
                        </a>
                      )}
                    </td>
                    <td><StatusTag status={product.status} /></td>
                    <td>{product.type}</td>
                    <td className="numeric">{product.effectivePrice}</td>
                    <td className="numeric">{product.enabledVariants === null ? 'Not applicable' : product.enabledVariants}</td>
                    <td>{product.updated}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="product-list-mobile" aria-label="Products in this Store">
              {filteredProducts.map((product) => (
                <article className="product-summary-card" key={product.id}>
                  {product.id === openingProductId ? (
                    <button className="text-button" type="button" disabled aria-label={`Opening ${product.name}`}>
                      Opening Product
                    </button>
                  ) : (
                    <a
                      className="product-link"
                      href={`/console/products/${encodeURIComponent(product.slug ?? product.id)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onEditProduct(product.id);
                      }}
                    >
                      {product.name}
                    </a>
                  )}
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
          </>
        ) : null}
      </section>

      {hasActiveFilters && state !== 'populated' ? (
        <p className="meta-text">Search and status controls remain available while this scenario is shown.</p>
      ) : null}
    </div>
  );
}
