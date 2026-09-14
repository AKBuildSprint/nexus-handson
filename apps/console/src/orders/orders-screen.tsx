import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type {
  ConsoleOrderSummary,
  ConsoleOrderView,
  ConsoleOrdersState,
  OrderItemView,
  OrderStatus,
  OrderStatusFilter,
} from './order-ui-types';
import { formatMoney } from './format-money';
import { useConsoleSearchHost } from '../layout/console-search-host';

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

function customerInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toLocaleUpperCase() || '—';
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
      {order.refundRequestStatus === 'pending' ? <span className="refund-tag-outline">Refund request pending</span> : null}
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
    <nav className="pager" aria-label={`Order pages ${placement}`}>
      <p className="pager-range">
        Showing {start}–{end} of {total}
        <span aria-hidden="true"> · </span>
        Page {page}{page <= totalPages ? <> of {totalPages}</> : null}
      </p>
      <div className="pager-actions">
        <button className="button pager-step" type="button" disabled={!hasPreviousPage} onClick={onPrevious}>Previous</button>
        <button className="button pager-step" type="button" disabled={!hasNextPage} onClick={onNext}>Next</button>
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
  const searchHost = useConsoleSearchHost();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchHeldFocusRef = useRef(false);
  const searchCaretRef = useRef<number | null>(null);
  const searchHostRef = useRef<HTMLElement | null>(null);
  const rememberSearchCursor = useCallback((input: HTMLInputElement) => {
    searchCaretRef.current = input.selectionStart;
  }, []);
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
  const showFooter = summary !== null && (state === 'ready' || state === 'no-results' || state === 'empty');

  // The host swap remounts the input and drops its selection. Snapshot the live
  // caret while the current input is still attached to the document.
  if (searchHostRef.current !== searchHost && searchInputRef.current && document.activeElement === searchInputRef.current) {
    searchCaretRef.current = searchInputRef.current.selectionStart;
    searchHeldFocusRef.current = true;
  }

  // The search control changes host at 719↔720 px, which remounts the input.
  // Hand focus and the caret back to the same draft without submitting.
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

  const searchField = (
    <form
      className="console-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearchSubmit();
      }}
    >
      <label className="console-search-label" htmlFor="order-search">Search Orders</label>
      <input
        id="order-search"
        ref={searchInputRef}
        type="search"
        value={searchDraft}
        placeholder="Search by Order reference, payment reference, Customer name, or email"
        onFocus={() => { searchHeldFocusRef.current = true; }}
        onBlur={(event) => {
          searchHeldFocusRef.current = false;
          rememberSearchCursor(event.currentTarget);
        }}
        onSelect={(event) => rememberSearchCursor(event.currentTarget)}
        onChange={(event) => {
          rememberSearchCursor(event.target);
          onSearchDraftChange(event.target.value);
        }}
      />
      <button className="button console-search-submit" type="submit">Search</button>
    </form>
  );

  return (
    <div className="page-stack">
      <header className="console-tab-row">
        <h1 className="console-tab">Orders</h1>
        <div className="console-tab-spacer" />
        <label className="checkbox-row console-tab-filter">
          <input
            type="checkbox"
            checked={refundPendingOnly}
            onChange={(event) => onRefundPendingOnlyChange(event.target.checked)}
          />
          Pending refund requests
        </label>
      </header>

      {searchHost ? createPortal(searchField, searchHost) : searchField}

      <section ref={resultsRef} className="data-region" aria-labelledby="order-results-title" aria-busy={state === 'loading'}>
        <div className="console-panel-head">
          <span className="sr-only" id="order-status-filter-label">Filter Orders by status</span>
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
        </div>

        <h2 id="order-results-title" className="sr-only">Order results</h2>
        <p className="sr-only" aria-live="polite">{state === 'ready' ? `Showing ${rangeStart}–${rangeEnd} of ${total} Orders.` : ''}</p>

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
            <h3>{total > 0 ? 'No Orders remain on this page.' : 'No Orders match these filters.'}</h3>
            <p>{total > 0 ? 'The result set changed. Return to the previous or first page to review matching Orders.' : 'Clear filters or return to the first page to continue reviewing Orders.'}</p>
            <div className="inline-actions">
              <button className="button" type="button" onClick={onClearFilters}>Clear filters</button>
              {hasPreviousPage ? <button className="button" type="button" onClick={onFirstPage}>First page</button> : null}
            </div>
          </div>
        ) : null}

        {state === 'ready' ? (
          <>
            <div className="console-table-scroll">
              <table className="console-table orders-table" aria-label="Storefront Orders">
                <thead>
                  <tr>
                    <th className="orders-col-order" scope="col">Order</th>
                    <th className="orders-col-customer" scope="col">Customer</th>
                    <th className="orders-col-email" scope="col">Email</th>
                    <th scope="col">Items</th>
                    <th className="orders-col-total" scope="col">Total</th>
                    <th className="orders-col-payment" scope="col">Payment ref</th>
                    <th className="orders-col-status" scope="col">Status</th>
                    <th className="orders-col-created" scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>{orders.map((order) => {
                  const preview = itemPreview(order);
                  return (
                    <tr key={order.reference}>
                      <td className="orders-col-order"><OrderReferenceLink reference={order.reference} onOpenOrder={onOpenOrder} /></td>
                      <td className="orders-col-customer">
                        <span className="order-customer">
                          <span className="order-customer-initials" aria-hidden="true">{customerInitials(order.customer.name)}</span>
                          <span>{order.customer.name}</span>
                        </span>
                      </td>
                      <td className="orders-col-email order-email">{order.customer.email}</td>
                      <td>
                        <span className="order-items-cell">
                          <span>{preview.title}</span>
                          <span className="meta-text">{preview.detail}</span>
                        </span>
                      </td>
                      <td className="orders-col-total numeric order-total">{formatMoney(order.totalMinor, order.currency)} {order.currency}</td>
                      <td className="orders-col-payment order-payment-ref numeric">{order.paymentReference}</td>
                      <td className="orders-col-status"><OrderStatusBadge order={order} /></td>
                      <td className="orders-col-created order-created numeric">{new Date(order.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
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

        {showFooter && summary ? (
          <div className="console-table-footer">
            <p className="summary-row">
              <span className="summary-stat">Matching Orders <strong className="numeric">{summary.totalOrders}</strong></span>
              <span className="summary-stat">Pending <strong className="numeric">{summary.byStatus.pending}</strong></span>
              <span className="summary-stat">Paid <strong className="numeric">{summary.byStatus.paid}</strong></span>
              <span className="summary-stat">Fulfilled <strong className="numeric">{summary.byStatus.fulfilled}</strong></span>
              <span className="summary-stat">Canceled <strong className="numeric">{summary.byStatus.canceled}</strong></span>
              <span className="summary-stat">Open refund requests <strong className="numeric">{summary.openRefundRequests}</strong></span>
            </p>
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
          </div>
        ) : null}
      </section>
    </div>
  );
}
