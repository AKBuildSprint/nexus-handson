import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type {
  ConsoleOrderSummary,
  ConsoleOrderView,
  ConsoleOrdersState,
  OrderItemView,
  OrderStatus,
  OrderStatusFilter,
} from './order-ui-types';

export interface OrdersScreenProps {
  state: ConsoleOrdersState;
  orders: ConsoleOrderView[];
  summary: ConsoleOrderSummary | null;
  searchDraft: string;
  statusFilter: OrderStatusFilter;
  refundPendingOnly: boolean;
  contractOutdated: boolean;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  pageIndex: number;
  onSearchDraftChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStatusFilterChange: (status: OrderStatusFilter) => void;
  onRefundPendingOnlyChange: (value: boolean) => void;
  onRetry: () => void;
  onReload: () => void;
  onClearFilters: () => void;
  onFirstPage: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onOpenOrder: (reference: string) => void;
}

const ORDER_PAGE_SIZE = 25;

const STATUS_TABS: ReadonlyArray<{ id: OrderStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'paid', label: 'Paid' },
  { id: 'fulfilled', label: 'Fulfilled' },
  { id: 'canceled', label: 'Canceled' },
];

const STATUS_CLASS: Record<OrderStatus, string> = {
  pending: 'status-draft',
  paid: 'status-active',
  fulfilled: 'status-active',
  canceled: 'status-archived',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
  fulfilled: 'Fulfilled',
  canceled: 'Canceled',
};

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

function itemSelection(item: OrderItemView): string {
  if (!item.product.variant) return 'Simple Product';
  const options = item.product.variant.selectedOptions.map((option) => `${option.groupName}: ${option.valueLabel}`).join(', ');
  return options ? `${options} · SKU ${item.product.variant.sku}` : `SKU ${item.product.variant.sku}`;
}

function itemPreview(order: ConsoleOrderView): { title: string; detail: string } {
  const first = order.items[0];
  if (!first) return { title: 'No items', detail: '' };
  const remaining = order.items.length - 1;
  return {
    title: remaining > 0 ? `${first.product.name} + ${remaining} more` : first.product.name,
    detail: remaining > 0 ? `${order.items.length} items` : itemSelection(first),
  };
}

function statusPresentation(status: string): { label: string; className: string } {
  if (status === 'pending' || status === 'paid' || status === 'fulfilled' || status === 'canceled') {
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

function MatchingSummary({ summary }: { summary: ConsoleOrderSummary }) {
  return (
    <section className="metric-strip" aria-label="Matching current filters">
      <article className="metric-card metric-card-accent">
        <p className="metric-label">Matching Orders</p>
        <p className="metric-value numeric">{summary.totalOrders}</p>
        <p className="metric-meta">Server aggregate for current filters</p>
      </article>
      <article className="metric-card">
        <p className="metric-label">Pending</p>
        <p className="metric-value numeric">{summary.byStatus.pending}</p>
        <p className="metric-meta">Paid {summary.byStatus.paid}</p>
      </article>
      <article className="metric-card">
        <p className="metric-label">Fulfilled</p>
        <p className="metric-value numeric">{summary.byStatus.fulfilled}</p>
        <p className="metric-meta">Canceled {summary.byStatus.canceled}</p>
      </article>
      <article className="metric-card">
        <p className="metric-label">Open refund requests</p>
        <p className="metric-value numeric">{summary.openRefundRequests}</p>
        <p className="metric-meta">Pending refund requests on matching Orders</p>
      </article>
    </section>
  );
}

function OrderListPager({
  placement,
  start,
  end,
  total,
  page,
  totalPages,
  hasPreviousPage,
  hasNextPage,
  onPrevious,
  onNext,
}: {
  placement: 'top' | 'bottom';
  start: number;
  end: number;
  total: number;
  page: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className="order-pager" aria-label={`Order pages ${placement}`}>
      <p className="pager-range">
        Showing {start}–{end} of {total}
        <span aria-hidden="true"> · </span>
        Page {page} of {totalPages}
      </p>
      <div className="pager-actions">
        <button className="button" type="button" disabled={!hasPreviousPage} onClick={onPrevious}>Previous</button>
        <button className="button" type="button" disabled={!hasNextPage} onClick={onNext}>Next</button>
      </div>
    </nav>
  );
}


export function OrdersScreen({
  state,
  orders,
  summary,
  searchDraft,
  statusFilter,
  refundPendingOnly,
  contractOutdated,
  hasPreviousPage,
  hasNextPage,
  pageIndex,
  onSearchDraftChange,
  onSearchSubmit,
  onStatusFilterChange,
  onRefundPendingOnlyChange,
  onRetry,
  onReload,
  onClearFilters,
  onFirstPage,
  onPreviousPage,
  onNextPage,
  onOpenOrder,
}: OrdersScreenProps) {
  const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resultsRef = useRef<HTMLElement>(null);
  const total = summary?.totalOrders ?? 0;
  const rangeStart = orders.length === 0 ? 0 : pageIndex * ORDER_PAGE_SIZE + 1;
  const rangeEnd = orders.length === 0 ? 0 : pageIndex * ORDER_PAGE_SIZE + orders.length;
  const pageNumber = pageIndex + 1;
  const totalPages = Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE));
  const goToAdjacent = (direction: 'previous' | 'next', placement: 'top' | 'bottom') => {
    if (direction === 'previous') onPreviousPage();
    else onNextPage();
    if (placement === 'bottom') resultsRef.current?.scrollIntoView({ block: 'start' });
  };
  const paging = state === 'ready' || state === 'no-results';
  const showSummary = summary !== null && (state === 'ready' || state === 'no-results' || state === 'empty');

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
          <p className="page-kicker">Order operations · Nexus</p>
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
              placeholder="Search by Order reference, payment reference, Customer name, or email"
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

      {showSummary ? <MatchingSummary summary={summary} /> : null}

      <section ref={resultsRef} className="data-region" aria-labelledby="order-results-title" aria-busy={state === 'loading'}>
        <h2 id="order-results-title" className="sr-only">Order results</h2>
        <p className="sr-only" aria-live="polite">{state === 'ready' ? `Showing ${rangeStart}–${rangeEnd} of ${total} Orders.` : ''}</p>
        {paging ? (
          <OrderListPager
            placement="top"
            start={rangeStart}
            end={rangeEnd}
            total={total}
            page={pageNumber}
            totalPages={totalPages}
            hasPreviousPage={hasPreviousPage}
            hasNextPage={hasNextPage}
            onPrevious={() => goToAdjacent('previous', 'top')}
            onNext={() => goToAdjacent('next', 'top')}
          />
        ) : null}

        {state === 'loading' ? (
          <div aria-label="Loading Orders">
            {[0, 1, 2, 3].map((row) => <div className="skeleton-row order-skeleton-row" key={row} aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((cell) => <span className="skeleton-line" key={cell} />)}</div>)}
          </div>
        ) : null}

        {state === 'error' ? (
          <div className="empty-state notice-error" role="alert">
            {contractOutdated ? (
              <>
                <h3>This Console is out of date</h3>
                <p>Reload the page and try again. This client will not retry the previous Order request.</p>
                <button className="button" type="button" onClick={onReload}>Reload Console</button>
              </>
            ) : (
              <>
                <h3>Orders could not be loaded</h3>
                <p>The Order list is unavailable. Retry to request the safe Console projection again.</p>
                <button className="button" type="button" onClick={onRetry}>Retry loading Orders</button>
              </>
            )}
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
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Items</th>
                  <th scope="col">Total</th>
                  <th scope="col">Payment reference</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>{orders.map((order) => {
                const status = statusPresentation(order.status);
                const preview = itemPreview(order);
                return (
                  <tr key={order.reference}>
                    <td><OrderReferenceLink reference={order.reference} onOpenOrder={onOpenOrder} /></td>
                    <td><strong>{order.customer.name}</strong><br /><span className="meta-text">{order.customer.email}</span></td>
                    <td><strong>{preview.title}</strong><br /><span className="meta-text">{preview.detail}</span></td>
                    <td className="numeric order-total">{formatMoney(order.totalMinor, order.currency)} {order.currency}</td>
                    <td className="order-reference">{order.paymentReference}</td>
                    <td>
                      <span className={status.className}>{status.label}</span>
                      {order.refundRequestStatus === 'pending' ? <span className="refund-badge">Refund request pending</span> : null}
                    </td>
                    <td>{new Date(order.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            <div className="order-list-mobile" aria-label="Storefront Orders">{orders.map((order) => {
              const preview = itemPreview(order);
              return (
                <article className="order-summary-card" key={order.reference}>
                  <header>
                    <OrderReferenceLink reference={order.reference} onOpenOrder={onOpenOrder} />
                    <OrderStatusBadge order={order} />
                  </header>
                  <h2>{preview.title}</h2>
                  <p className="meta-text">{preview.detail}</p>
                  <dl>
                    <div><dt>Customer</dt><dd>{order.customer.name}<br /><span>{order.customer.email}</span></dd></div>
                    <div><dt>Total</dt><dd className="numeric order-total">{formatMoney(order.totalMinor, order.currency)} {order.currency}</dd></div>
                    <div><dt>Payment reference</dt><dd>{order.paymentReference}</dd></div>
                    <div><dt>Created</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd></div>
                  </dl>
                </article>
              );
            })}</div>
          </>
        ) : null}

        {paging ? (
          <OrderListPager
            placement="bottom"
            start={rangeStart}
            end={rangeEnd}
            total={total}
            page={pageNumber}
            totalPages={totalPages}
            hasPreviousPage={hasPreviousPage}
            hasNextPage={hasNextPage}
            onPrevious={() => goToAdjacent('previous', 'bottom')}
            onNext={() => goToAdjacent('next', 'bottom')}
          />
        ) : null}
      </section>
    </div>
  );
}
