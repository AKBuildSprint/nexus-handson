import { useRef, type KeyboardEvent } from 'react';
import type { OrderStatus } from '@nexus/orders/order-types';
import type {
  ConsoleOrderListCriteria,
  ConsoleOrdersState,
  ConsoleOrderView,
} from './order-ui-types';
import { orderStatusLabel } from './order-ui-types';

interface OrdersScreenProps {
  state: ConsoleOrdersState;
  orders: ConsoleOrderView[];
  criteria: ConsoleOrderListCriteria;
  nextCursor: string | null;
  canGoPrevious: boolean;
  showFirstPage: boolean;
  onRetry: () => void;
  onCriteriaChange: (criteria: ConsoleOrderListCriteria) => void;
  onClearFilters: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onFirstPage: () => void;
  onOpenOrder: (reference: string) => void;
}

const STATUS_FILTERS: ReadonlyArray<{ id: 'all' | OrderStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending_payment', label: 'Pending payment' },
  { id: 'paid', label: 'Paid' },
  { id: 'fulfilled', label: 'Fulfilled' },
  { id: 'cancelled', label: 'Cancelled' },
];

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

function orderSelection(order: ConsoleOrderView): string {
  if (!order.product.variant) return 'Simple Product';
  const options = order.product.variant.selectedOptions.map((option) => `${option.groupName}: ${option.valueLabel}`).join(', ');
  return options ? `${options} · SKU ${order.product.variant.sku}` : `SKU ${order.product.variant.sku}`;
}

function statusClass(status: OrderStatus): string {
  if (status === 'pending_payment') return 'status-tag status-draft';
  if (status === 'paid') return 'status-tag status-paid';
  if (status === 'fulfilled') return 'status-tag status-active';
  return 'status-tag status-archived';
}

export function OrdersScreen({
  state,
  orders,
  criteria,
  nextCursor,
  canGoPrevious,
  showFirstPage,
  onRetry,
  onCriteriaChange,
  onClearFilters,
  onNext,
  onPrevious,
  onFirstPage,
  onOpenOrder,
}: OrdersScreenProps) {
  const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasActiveFilters = Boolean(criteria.q.trim()) || criteria.status !== 'all' || criteria.refund === 'pending';
  const showOrders = state === 'ready';

  const handleFilterKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % STATUS_FILTERS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + STATUS_FILTERS.length) % STATUS_FILTERS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = STATUS_FILTERS.length - 1;
    else return;
    event.preventDefault();
    onCriteriaChange({ ...criteria, status: STATUS_FILTERS[nextIndex].id, cursor: null });
    filterRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div className="page-header-copy">
          <h1>Orders</h1>
          <p>Review Customer purchases from the Storefront.</p>
        </div>
      </header>

      <section className="product-tools" aria-label="Search and filter Orders">
        <div className="field">
          <label htmlFor="order-search">Search Orders</label>
          <input
            id="order-search"
            type="search"
            value={criteria.q}
            placeholder="Search by reference, name, or email"
            onChange={(event) => onCriteriaChange({ ...criteria, q: event.target.value, cursor: null })}
          />
        </div>
        <div>
          <span className="field-label" id="order-status-filter-label">Order status</span>
          <div className="status-tabs" role="tablist" aria-labelledby="order-status-filter-label">
            {STATUS_FILTERS.map((option, index) => (
              <button
                key={option.id}
                ref={(element) => { filterRefs.current[index] = element; }}
                type="button"
                role="tab"
                aria-selected={criteria.status === option.id}
                tabIndex={criteria.status === option.id ? 0 : -1}
                onClick={() => onCriteriaChange({ ...criteria, status: option.id, cursor: null })}
                onKeyDown={(event) => handleFilterKeyDown(event, index)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={criteria.refund === 'pending'}
            onChange={(event) => onCriteriaChange({
              ...criteria,
              refund: event.target.checked ? 'pending' : 'all',
              cursor: null,
            })}
          />
          Pending refund request
        </label>
      </section>

      <section className="data-region" aria-labelledby="order-results-title" aria-busy={state === 'loading'}>
        <h2 id="order-results-title" className="sr-only">Order results</h2>
        <p className="sr-only" aria-live="polite">{state === 'ready' ? `${orders.length} Orders shown.` : ''}</p>

        {state === 'loading' ? (
          <div aria-label="Loading Orders">
            {[0, 1, 2, 3].map((row) => <div className="skeleton-row order-skeleton-row" key={row} aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((cell) => <span className="skeleton-line" key={cell} />)}</div>)}
          </div>
        ) : null}

        {state === 'error' ? (
          <div className="empty-state notice-error" role="alert">
            <h3>Orders could not be loaded</h3>
            <p>The Order list is unavailable. Retry to request the safe Console projection again.</p>
            <button className="button" type="button" onClick={onRetry}>Retry loading Orders</button>
          </div>
        ) : null}

        {state === 'empty' ? (
          <div className="empty-state">
            <h3>No Orders have been placed.</h3>
            <p>Customer purchases will appear here after Storefront checkout.</p>
          </div>
        ) : null}

        {state === 'no-match' ? (
          <div className="empty-state">
            <h3>No Orders match these filters.</h3>
            <p>Keep the current Store Orders and clear the search, status, or refund scope.</p>
            <button className="button" type="button" onClick={onClearFilters}>Clear filters</button>
          </div>
        ) : null}

        {showOrders ? (
          <>
            <table className="console-table orders-table" aria-label="Storefront Orders">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Product selection</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Unit price</th>
                  <th scope="col">Total</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.reference}>
                    <td className="order-reference">
                      <a
                        className="product-link"
                        href={`/console/orders/${encodeURIComponent(order.reference)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          onOpenOrder(order.reference);
                        }}
                      >
                        {order.reference}
                      </a>
                    </td>
                    <td><strong>{order.customer.name}</strong><br /><span className="meta-text">{order.customer.email}</span></td>
                    <td><strong>{order.product.name}</strong><br /><span className="meta-text">{orderSelection(order)}</span></td>
                    <td className="numeric">{order.quantity}</td>
                    <td className="numeric">{formatMoney(order.unitPriceMinor, order.currency)}</td>
                    <td className="numeric order-total">{formatMoney(order.totalMinor, order.currency)}</td>
                    <td><span className={statusClass(order.status)}>{orderStatusLabel(order.status)}</span></td>
                    <td>{new Date(order.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="order-list-mobile" aria-label="Storefront Orders">
              {orders.map((order) => (
                <article className="order-summary-card" key={order.reference}>
                  <header>
                    <a
                      className="product-link order-reference"
                      href={`/console/orders/${encodeURIComponent(order.reference)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onOpenOrder(order.reference);
                      }}
                    >
                      {order.reference}
                    </a>
                    <span className={statusClass(order.status)}>{orderStatusLabel(order.status)}</span>
                  </header>
                  <h2>{order.product.name}</h2>
                  <p className="meta-text">{orderSelection(order)}</p>
                  <dl>
                    <div><dt>Customer</dt><dd>{order.customer.name}<br /><span>{order.customer.email}</span></dd></div>
                    <div><dt>Quantity</dt><dd className="numeric">{order.quantity}</dd></div>
                    <div><dt>Unit price</dt><dd className="numeric">{formatMoney(order.unitPriceMinor, order.currency)}</dd></div>
                    <div><dt>Total</dt><dd className="numeric order-total">{formatMoney(order.totalMinor, order.currency)}</dd></div>
                    <div><dt>Created</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
            <div className="page-actions" aria-label="Order pagination">
              <button className="button" type="button" onClick={onPrevious} disabled={!canGoPrevious}>Previous</button>
              <button className="button" type="button" onClick={onNext} disabled={!nextCursor}>Next</button>
              {showFirstPage ? <button className="button" type="button" onClick={onFirstPage}>First page</button> : null}
            </div>
          </>
        ) : null}
        {hasActiveFilters && (state === 'ready' || state === 'no-match') ? (
          <p className="meta-text">Filters are applied to this page of results.</p>
        ) : null}
      </section>
    </div>
  );
}
