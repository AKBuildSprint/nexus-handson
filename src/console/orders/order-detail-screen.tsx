import { useEffect, useRef, useState } from 'react';
import type { ConsoleOrderAction } from '../../orders/order-types';
import { ConsoleApiError } from '../api-client';
import type { ConsoleOrderDetailState, ConsoleOrderDetailView } from './order-ui-types';
import { isRetryableOrderError, orderActionLabel, orderStatusLabel } from './order-ui-types';

interface OrderDetailScreenProps {
  state: ConsoleOrderDetailState;
  order: ConsoleOrderDetailView | null;
  pendingAction: ConsoleOrderAction | null;
  retryAction: ConsoleOrderAction | null;
  actionError: unknown;
  onBack: () => void;
  onRetry: () => void;
  onRetryAction: () => void;
  onAction: (action: ConsoleOrderAction, acknowledgedRefundRequestId: string | null) => void;
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

function historyLabel(action: ConsoleOrderDetailView['history'][number]['action']): string {
  if (action === 'order_created') return 'Created';
  if (action === 'refund_requested') return 'Refund requested';
  return orderActionLabel(action);
}

function statusClass(status: ConsoleOrderDetailView['status']): string {
  if (status === 'pending_payment') return 'status-tag status-draft';
  if (status === 'paid') return 'status-tag status-paid';
  if (status === 'fulfilled') return 'status-tag status-active';
  return 'status-tag status-archived';
}

export function OrderDetailScreen({
  state,
  order,
  pendingAction,
  retryAction,
  actionError,
  onBack,
  onRetry,
  onRetryAction,
  onAction,
}: OrderDetailScreenProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const acknowledgedIdRef = useRef<string | null>(null);
  const [fulfillOpen, setFulfillOpen] = useState(false);

  useEffect(() => {
    setFulfillOpen(false);
    acknowledgedIdRef.current = null;
  }, [order?.reference, order?.refundRequest?.id, order?.status]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (fulfillOpen && !dialog.open) dialog.showModal();
    if (!fulfillOpen && dialog.open) dialog.close();
  }, [fulfillOpen]);

  const closeFulfill = () => {
    setFulfillOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const requestFulfill = (event: { currentTarget: HTMLButtonElement }) => {
    if (!order) return;
    if (order.refundRequest) {
      triggerRef.current = event.currentTarget;
      acknowledgedIdRef.current = order.refundRequest.id;
      setFulfillOpen(true);
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) dialog.showModal();
      return;
    }
    onAction('mark_fulfilled', null);
  };

  const confirmFulfill = () => {
    const requestId = acknowledgedIdRef.current;
    closeFulfill();
    if (requestId) onAction('mark_fulfilled', requestId);
  };

  const retryableAction = isRetryableOrderError(actionError);
  const actionMessage = actionError instanceof ConsoleApiError
    ? actionError.message
    : actionError
      ? 'The Order action could not be completed.'
      : null;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div className="page-header-copy">
          <h1>{order?.reference ?? 'Order'}</h1>
          <p>Inspect the purchase snapshot and take only server-provided actions.</p>
        </div>
        <div className="page-actions">
          <button className="button" type="button" onClick={onBack}>Back to Orders</button>
        </div>
      </header>

      {state === 'loading' && !order ? (
        <div aria-label="Loading Order">
          <div className="skeleton-row order-skeleton-row" aria-hidden="true">
            {[0, 1, 2, 3].map((cell) => <span className="skeleton-line" key={cell} />)}
          </div>
        </div>
      ) : null}

      {state === 'error' && !order ? (
        <div className="empty-state notice-error" role="alert">
          <h3>Order could not be loaded</h3>
          <p>Retry to request the current Console Order projection.</p>
          <button className="button" type="button" onClick={onRetry}>Retry loading Order</button>
        </div>
      ) : null}

      {order ? (
        <div className="section-stack order-detail">
          <p>
            <span className={statusClass(order.status)}>{orderStatusLabel(order.status)}</span>
          </p>
          <div className="notice notice-info">
            <strong>Manual operations</strong>
            <span>Mark paid is a manual confirmation, not a payment-provider receipt. Mark fulfilled records operational confirmation and does not grant delivery. A Refund Request is received and awaiting response; it is not refunded.</span>
          </div>

          <section className="editor-section">
            <div className="section-heading">
              <h2>Purchase snapshot</h2>
              <p>Money and selection are frozen at checkout.</p>
            </div>
            <dl className="order-detail-list">
              <div><dt>Product</dt><dd>{order.product.name}</dd></div>
              <div>
                <dt>Selection</dt>
                <dd>{order.product.variant
                  ? order.product.variant.selectedOptions.map((option) => `${option.groupName}: ${option.valueLabel}`).join(', ') || order.product.variant.sku
                  : 'Simple Product'}
                </dd>
              </div>
              <div><dt>Quantity</dt><dd className="numeric">{order.quantity}</dd></div>
              <div><dt>Unit price</dt><dd className="numeric">{formatMoney(order.unitPriceMinor, order.currency)}</dd></div>
              <div><dt>Total</dt><dd className="numeric order-total">{formatMoney(order.totalMinor, order.currency)}</dd></div>
              <div><dt>Created</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd></div>
            </dl>
          </section>

          <section className="editor-section">
            <div className="section-heading">
              <h2>Customer snapshot</h2>
              <p>Name and email captured at purchase time.</p>
            </div>
            <dl className="order-detail-list">
              <div><dt>Name</dt><dd>{order.customer.name}</dd></div>
              <div><dt>Email</dt><dd>{order.customer.email}</dd></div>
            </dl>
          </section>

          <section className="editor-section">
            <div className="section-heading">
              <h2>History</h2>
              <p>Chronological server events for this Order.</p>
            </div>
            <ol className="order-history">
              {order.history.map((entry) => (
                <li key={entry.sequence}>
                  <strong>{historyLabel(entry.action)}</strong>
                  <span className="meta-text">{new Date(entry.createdAt).toLocaleString()} · {entry.source}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="editor-section">
            <div className="section-heading">
              <h2>Refund Request</h2>
              <p>Request-only; this is not a refunded Order.</p>
            </div>
            {order.refundRequest ? (
              <div className="notice notice-warning">
                <strong>Received — awaiting response</strong>
                <p data-refund-reason>{order.refundRequest.reason}</p>
                <span className="meta-text">{new Date(order.refundRequest.createdAt).toLocaleString()}</span>
              </div>
            ) : (
              <p className="meta-text">No Refund Request has been received.</p>
            )}
          </section>

          {actionMessage ? (
            <div className="notice notice-error" role="alert">
              <strong>The Order could not be updated</strong>
              <span>{actionMessage}</span>
              {retryableAction && retryAction && pendingAction === null ? (
                <button className="button" type="button" onClick={onRetryAction}>Retry {orderActionLabel(retryAction)}</button>
              ) : null}
            </div>
          ) : null}

          <div className="page-actions" aria-label="Order actions">
            {order.allowedActions.map((action) => (
              <button
                key={action}
                className={action === 'cancel' ? 'button button-danger' : 'button button-primary'}
                type="button"
                disabled={pendingAction !== null}
                onClick={(event) => {
                  if (action === 'mark_fulfilled') requestFulfill(event);
                  else onAction(action, null);
                }}
              >
                {pendingAction === action ? `Saving ${orderActionLabel(action)}` : orderActionLabel(action)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <dialog
        ref={dialogRef}
        className="guard-dialog order-fulfill-dialog"
        aria-labelledby="fulfill-confirm-title"
        onCancel={(event) => {
          event.preventDefault();
          closeFulfill();
        }}
        onClose={() => {
          if (fulfillOpen) closeFulfill();
        }}
      >
        <div className="guard-content">
          <h2 id="fulfill-confirm-title">Confirm fulfillment</h2>
          <p>Mark fulfilled records operational confirmation and does not grant delivery. The Refund Request stays received and awaiting response.</p>
          {order?.refundRequest ? <p data-refund-reason>{order.refundRequest.reason}</p> : null}
          <div className="inline-actions">
            <button className="button" type="button" onClick={closeFulfill}>Cancel</button>
            <button className="button button-primary" type="button" onClick={confirmFulfill}>Confirm fulfillment</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
