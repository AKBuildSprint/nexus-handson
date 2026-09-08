import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { ConsoleOrderView, ConsoleOrdersState } from './order-ui-types';

interface OrdersScreenProps {
  state: ConsoleOrdersState;
  orders: ConsoleOrderView[];
  onRetry: () => void;
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

function orderSelection(order: ConsoleOrderView): string {
  if (!order.product.variant) return 'Simple Product';
  const options = order.product.variant.selectedOptions.map((option) => `${option.groupName}: ${option.valueLabel}`).join(', ');
  return options ? `${options} · SKU ${order.product.variant.sku}` : `SKU ${order.product.variant.sku}`;
}

function readOrderCriteria(): { query: string; selectedReference: string | null } {
  const params = new URLSearchParams(window.location.search);
  return { query: params.get('q') ?? '', selectedReference: params.get('order') };
}

function writeOrderCriteria(query: string, selectedReference: string | null): void {
  const params = new URLSearchParams(window.location.search);
  const trimmed = query.trim();
  if (trimmed) params.set('q', trimmed);
  else params.delete('q');
  if (selectedReference) params.set('order', selectedReference);
  else params.delete('order');
  const search = params.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== next) window.history.replaceState(window.history.state, '', next);
}


export function OrdersScreen({ state, orders, onRetry }: OrdersScreenProps) {
  const initial = readOrderCriteria();
  const [query, setQuery] = useState(initial.query);
  const [selectedReference, setSelectedReference] = useState<string | null>(initial.selectedReference);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) => {
      const haystack = [
        order.reference,
        order.customer.name,
        order.customer.email,
        order.product.name,
        orderSelection(order),
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [orders, query]);

  const selected = filtered.find((order) => order.reference === selectedReference) ?? filtered[0] ?? null;

  useEffect(() => {
    writeOrderCriteria(query, selected?.reference ?? null);
  }, [query, selected]);
  const pendingCount = orders.length;
  const totalMinor = orders.reduce((sum, order) => sum + order.totalMinor, 0);
  const customerCount = new Set(orders.map((order) => order.customer.email)).size;
  const currency = orders[0]?.currency ?? 'USD';

  return (
    <div className="page-stack">
      <header className="page-header">
        <div className="page-header-copy">
          <p className="page-kicker">Order operations · Nexus</p>
          <h1>Orders</h1>
          <p>Review Customer purchases from the Storefront.</p>
        </div>
      </header>

      {state === 'ready' || state === 'empty' ? (
        <section className="metric-strip" aria-label="Order counts">
          <article className="metric-card metric-card-accent">
            <p className="metric-label">Pending payment</p>
            <p className="metric-value">{pendingCount} {pendingCount === 1 ? 'order' : 'orders'}</p>
            <p className="metric-meta">{formatMoney(totalMinor, currency)} captured at checkout</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Customers</p>
            <p className="metric-value">{customerCount}</p>
            <p className="metric-meta">Unique emails on Storefront Orders</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Shown</p>
            <p className="metric-value">{filtered.length}</p>
            <p className="metric-meta">{query.trim() ? 'Matching the current search' : 'All Storefront Orders'}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Status</p>
            <p className="metric-value">Pending</p>
            <p className="metric-meta">Payment instructions stay off this Console</p>
          </article>
        </section>
      ) : null}

      <section className="product-tools" aria-label="Search Orders">
        <div className="field">
          <label htmlFor="order-search">Search Orders</label>
          <input
            id="order-search"
            type="search"
            name="q"
            autoComplete="off"
            value={query}
            placeholder="NX-2AF6F6A1FF484095…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className="status-chip">Pending payment ({pendingCount})</p>
      </section>

      <section className="data-region" aria-labelledby="order-results-title" aria-busy={state === 'loading'}>
        <h2 id="order-results-title" className="sr-only">Order results</h2>
        <p className="sr-only" aria-live="polite">{state === 'ready' ? `${filtered.length} Orders shown.` : ''}</p>

        {state === 'loading' ? (
          <div aria-label="Loading…">
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

        {state === 'ready' ? (
          <div className="inspection-layout">
            <div className="inspection-list">
              <div className="inspection-list-meta">
                <span>Recent Storefront Orders</span>
                <span>{filtered.length} shown</span>
              </div>
              <table className="console-table orders-table" aria-label="Storefront Orders">
                <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Product selection</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Total</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead>
                <tbody>{filtered.map((order) => (
                  <tr
                    key={order.reference}
                    className={selected?.reference === order.reference ? 'is-selected' : undefined}
                    tabIndex={0}
                    aria-selected={selected?.reference === order.reference}
                    onClick={() => setSelectedReference(order.reference)}
                    onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedReference(order.reference);
                      }
                    }}
                  >
                    <td className="order-reference">{order.reference}</td>
                    <td><strong>{order.customer.name}</strong><br /><span className="meta-text">{order.customer.email}</span></td>
                    <td><strong>{order.product.name}</strong><br /><span className="meta-text">{orderSelection(order)}</span></td>
                    <td className="numeric">{order.quantity}</td>
                    <td className="numeric">{formatMoney(order.unitPriceMinor, order.currency)}</td>
                    <td className="numeric order-total">{formatMoney(order.totalMinor, order.currency)}</td>
                    <td><span className="status-tag status-draft">Pending payment</span></td>
                    <td>{new Date(order.createdAt).toLocaleString()}</td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="order-list-mobile" aria-label="Storefront Orders">{filtered.map((order) => (
                <article className="order-summary-card" key={order.reference}>
                  <header><strong className="order-reference">{order.reference}</strong><span className="status-tag status-draft">Pending payment</span></header>
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
            </div>
            {selected ? (
              <aside className="inspection-panel" aria-label={`Order ${selected.reference}`}>
                <p className="page-kicker">Pending payment</p>
                <h2>{selected.customer.name}</h2>
                <p className="meta-text">{selected.customer.email}</p>
                <dl className="inspection-facts">
                  <div><dt>Order</dt><dd className="order-reference">{selected.reference}</dd></div>
                  <div><dt>Product</dt><dd>{selected.product.name}</dd></div>
                  <div><dt>Selection</dt><dd>{orderSelection(selected)}</dd></div>
                  <div><dt>Quantity</dt><dd className="numeric">{selected.quantity}</dd></div>
                  <div><dt>Unit price</dt><dd className="numeric">{formatMoney(selected.unitPriceMinor, selected.currency)}</dd></div>
                  <div><dt>Total</dt><dd className="numeric order-total">{formatMoney(selected.totalMinor, selected.currency)}</dd></div>
                  <div><dt>Created</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div>
                </dl>
              </aside>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
