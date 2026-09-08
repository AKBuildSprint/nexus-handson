import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type {
  ConsoleOrderView,
  ConsoleOrdersState,
  OrderStatus,
  OrderStatusFilter,
} from './order-ui-types';

export interface OrdersScreenProps {
  state: ConsoleOrdersState;
  orders: ConsoleOrderView[];
  searchDraft: string;
  statusFilter: OrderStatusFilter;
  refundPendingOnly: boolean;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onSearchDraftChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStatusFilterChange: (status: OrderStatusFilter) => void;
  onRefundPendingOnlyChange: (value: boolean) => void;
  onRetry: () => void;
  onClearFilters: () => void;
  onFirstPage: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onOpenOrder: (reference: string) => void;
}

const STATUS_TABS: ReadonlyArray<{ id: OrderStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending_payment', label: 'Pending payment' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const STATUS_CLASS: Record<OrderStatus, string> = {
  pending_payment: 'status-draft',
  completed: 'status-active',
  cancelled: 'status-archived',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Pending payment',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

function orderSelection(order: ConsoleOrderView): string {
  if (!order.product.variant) return 'Simple Product';
  const options = order.product.variant.selectedOptions.map((option) => `${option.groupName}: ${option.valueLabel}`).join(', ');
  return options ? `${options} · SKU ${order.product.variant.sku}` : `SKU ${order.product.variant.sku}`;
}

function statusPresentation(status: string): { label: string; className: string } {
  if (status === 'pending_payment' || status === 'completed' || status === 'cancelled') {
    return { label: STATUS_LABEL[status], className: `status-tag ${STATUS_CLASS[status]}` };
  }
  return { label: 'Unknown status', className: 'status-tag' };
}

function isUnmodifiedLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && !event.defaultPrevented;
}

function OrderStatusBadge({ order }: { order: ConsoleOrderView }) {
  const status = statusPresentation(order.status);
  return (
    <span className="order-status-cluster">
      <span className={status.className}>{status.label}</span>
      {order.refundRequestStatus === 'pending' ? <span className="refund-badge">Refund request pending</span> : null}
    </span>
  );
}

function OrderReferenceLink({
  reference,
  onOpenOrder,
}: {
  reference: string;
  onOpenOrder: (reference: string) => void;
}) {
  return (
    <a
      className="product-link order-reference"
      href={`/console/orders/${encodeURIComponent(reference)}`}
      onClick={(event) => {
        if (!isUnmodifiedLeftClick(event)) return;
        event.preventDefault();
        onOpenOrder(reference);
      }}
    >
      {reference}
    </a>
  );
}

export function OrdersScreen({
  state,
  orders,
  searchDraft,
  statusFilter,
  refundPendingOnly,
  hasPreviousPage,
  hasNextPage,
  onSearchDraftChange,
  onSearchSubmit,
  onStatusFilterChange,
  onRefundPendingOnlyChange,
  onRetry,
  onClearFilters,
  onFirstPage,
  onPreviousPage,
  onNextPage,
  onOpenOrder,
}: OrdersScreenProps) {
  const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const paging = state === 'ready' || state === 'no-results';

  const handleFilterKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % STATUS_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + STATUS_TABS.length) % STATUS_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = STATUS_TABS.length - 1;
    else return;
    event.preventDefault();
    onStatusFilterChange(STATUS_TABS[nextIndex].id);
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

      <section className="product-tools order-tools" aria-label="Search and filter Orders">
        <form
          className="field"
          onSubmit={(event) => {
            event.preventDefault();
            onSearchSubmit();
          }}
        >
          <label htmlFor="order-search">Search Orders</label>
          <div className="order-search-row">
            <input
              id="order-search"
              type="search"
              value={searchDraft}
              placeholder="Search by reference, Customer name, or email"
              onChange={(event) => onSearchDraftChange(event.target.value)}
            />
            <button className="button" type="submit">Search</button>
          </div>
        </form>
        <div>
          <span className="field-label" id="order-status-filter-label">Order status</span>
          <div className="status-tabs" role="tablist" aria-labelledby="order-status-filter-label">
            {STATUS_TABS.map((option, index) => (
              <button
                key={option.id}
                ref={(element) => {
                  filterRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                aria-selected={statusFilter === option.id}
                tabIndex={statusFilter === option.id ? 0 : -1}
                onClick={() => onStatusFilterChange(option.id)}
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
            checked={refundPendingOnly}
            onChange={(event) => onRefundPendingOnlyChange(event.target.checked)}
          />
          Pending refund requests
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

        {state === 'no-results' ? (
          <div className="empty-state">
            <h3>No Orders match these filters.</h3>
            <p>Clear filters or return to the first page to continue reviewing Orders.</p>
            <div className="inline-actions">
              <button className="button" type="button" onClick={onClearFilters}>Clear filters</button>
              {hasPreviousPage ? <button className="button" type="button" onClick={onFirstPage}>First page</button> : null}
            </div>
          </div>
        ) : null}

        {state === 'ready' ? (
          <>
            <table className="console-table orders-table" aria-label="Storefront Orders">
              <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Product selection</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Total</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead>
              <tbody>{orders.map((order) => {
                const status = statusPresentation(order.status);
                return (
                  <tr key={order.reference}>
                    <td><OrderReferenceLink reference={order.reference} onOpenOrder={onOpenOrder} /></td>
                    <td><strong>{order.customer.name}</strong><br /><span className="meta-text">{order.customer.email}</span></td>
                    <td><strong>{order.product.name}</strong><br /><span className="meta-text">{orderSelection(order)}</span></td>
                    <td className="numeric">{order.quantity}</td>
                    <td className="numeric">{formatMoney(order.unitPriceMinor, order.currency)}</td>
                    <td className="numeric order-total">{formatMoney(order.totalMinor, order.currency)}</td>
                    <td>
                      <span className={status.className}>{status.label}</span>
                      {order.refundRequestStatus === 'pending' ? <span className="refund-badge">Refund request pending</span> : null}
                    </td>
                    <td>{new Date(order.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            <div className="order-list-mobile" aria-label="Storefront Orders">{orders.map((order) => (
              <article className="order-summary-card" key={order.reference}>
                <header>
                  <OrderReferenceLink reference={order.reference} onOpenOrder={onOpenOrder} />
                  <OrderStatusBadge order={order} />
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
            ))}</div>
          </>
        ) : null}

        {paging ? (
          <div className="order-pager" aria-label="Order pages">
            <button className="button" type="button" disabled={!hasPreviousPage} onClick={onPreviousPage}>Previous</button>
            <button className="button" type="button" disabled={!hasNextPage} onClick={onNextPage}>Next</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
