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

export function OrdersScreen({ state, orders, onRetry }: OrdersScreenProps) {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div className="page-header-copy">
          <h1>Orders</h1>
          <p>Review Customer purchases from the Storefront.</p>
        </div>
      </header>

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

        {state === 'ready' ? (
          <>
            <table className="console-table orders-table" aria-label="Storefront Orders">
              <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Product selection</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Total</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead>
              <tbody>{orders.map((order) => <tr key={order.reference}>
                <td className="order-reference">{order.reference}</td>
                <td><strong>{order.customer.name}</strong><br /><span className="meta-text">{order.customer.email}</span></td>
                <td><strong>{order.product.name}</strong><br /><span className="meta-text">{orderSelection(order)}</span></td>
                <td className="numeric">{order.quantity}</td>
                <td className="numeric">{formatMoney(order.unitPriceMinor, order.currency)}</td>
                <td className="numeric order-total">{formatMoney(order.totalMinor, order.currency)}</td>
                <td><span className="status-tag status-draft">Pending payment</span></td>
                <td>{new Date(order.createdAt).toLocaleString()}</td>
              </tr>)}</tbody>
            </table>
            <div className="order-list-mobile" aria-label="Storefront Orders">{orders.map((order) => <article className="order-summary-card" key={order.reference}>
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
            </article>)}</div>
          </>
        ) : null}
      </section>
    </div>
  );
}
