import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { cancelConsoleOrder, completeConsoleOrder, ConsoleApiError, fetchOrder } from '../api-client';
import type {
  ConsoleOrderDetailState,
  ConsoleOrderDetailView,
  ConsoleOrderHistoryView,
  OrderAuditSource,
  OrderHistoryAction,
  OrderStatus,
} from './order-ui-types';

interface OrderDetailScreenProps {
  reference: string;
  routeGeneration: number;
  onInvalidateList: () => void;
  onBack: () => void;
}

type OrderAction = 'complete' | 'cancel';
type ConfirmPanel = OrderAction | null;
type DetailNotice =
  | { kind: 'unknown' }
  | { kind: 'conflict'; idempotency: boolean }
  | { kind: 'read-after-write' }
  | { kind: 'error'; message: string };

const MUTATION_DEADLINE_MS = 15_000;

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

const HISTORY_ACTION_LABEL: Record<OrderHistoryAction, string> = {
  order_created: 'Created',
  order_completed: 'Completed',
  order_cancelled: 'Cancelled',
  refund_requested: 'Refund requested',
};

const HISTORY_SOURCE_LABEL: Record<OrderAuditSource, string> = {
  console: 'Console',
  customer_capability: 'Customer',
};

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

function statusPresentation(status: string): { label: string; className: string } {
  if (status === 'pending_payment' || status === 'completed' || status === 'cancelled') {
    return { label: STATUS_LABEL[status], className: `status-tag ${STATUS_CLASS[status]}` };
  }
  return { label: 'Unknown status', className: 'status-tag' };
}

function historyActionLabel(action: string): string {
  return action in HISTORY_ACTION_LABEL ? HISTORY_ACTION_LABEL[action as OrderHistoryAction] : action;
}

function historySourceLabel(source: string): string {
  return source in HISTORY_SOURCE_LABEL ? HISTORY_SOURCE_LABEL[source as OrderAuditSource] : source;
}

function orderSelection(order: ConsoleOrderDetailView): string {
  if (!order.product.variant) return 'Simple Product';
  const options = order.product.variant.selectedOptions.map((option) => `${option.groupName}: ${option.valueLabel}`).join(', ');
  return options ? `${options} · SKU ${order.product.variant.sku}` : `SKU ${order.product.variant.sku}`;
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError');
}

function isOutcomeUnknown(error: unknown): boolean {
  if (isAbortError(error) || error instanceof TypeError) return true;
  if (error instanceof ConsoleApiError) return error.status >= 500 || error.status === 408 || error.status === 429;
  return true;
}

function deadlineSignal(parent: AbortSignal, ms: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  const onParent = () => controller.abort();
  parent.addEventListener('abort', onParent, { once: true });
  if (parent.aborted) controller.abort();
  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timer);
      parent.removeEventListener('abort', onParent);
    },
  };
}

function HistoryEntry({ event }: { event: ConsoleOrderHistoryView }) {
  const from = event.fromStatus ? statusPresentation(event.fromStatus).label : 'None';
  const to = statusPresentation(event.toStatus).label;
  return (
    <li>
      <strong>{historyActionLabel(event.action)}</strong>
      <span className="meta-text">
        {historySourceLabel(event.source)} · {from} → {to} · {new Date(event.createdAt).toLocaleString()}
      </span>
    </li>
  );
}

export function OrderDetailScreen({
  reference,
  routeGeneration,
  onInvalidateList,
  onBack,
}: OrderDetailScreenProps) {
  const [state, setState] = useState<ConsoleOrderDetailState>('loading');
  const [order, setOrder] = useState<ConsoleOrderDetailView | null>(null);
  const [panel, setPanel] = useState<ConfirmPanel>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [notice, setNotice] = useState<DetailNotice | null>(null);
  const [lockedAction, setLockedAction] = useState<OrderAction | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const attemptRef = useRef<{ reference: string; action: OrderAction; key: string } | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const restoreTriggerRef = useRef(false);
  const generationRef = useRef(routeGeneration);
  const referenceRef = useRef(reference);

  generationRef.current = routeGeneration;
  referenceRef.current = reference;

  const stillCurrent = (generation: number, capturedReference: string) => (
    generationRef.current === generation && referenceRef.current === capturedReference
  );

  const loadOrder = (generation: number, capturedReference: string, signal: AbortSignal) => {
    setState('loading');
    void fetchOrder(capturedReference, signal).then((response) => {
      if (!stillCurrent(generation, capturedReference)) return;
      setOrder(response.order);
      setState('ready');
      setNotice((current) => current?.kind === 'read-after-write' ? null : current);
    }).catch((error: unknown) => {
      if (!stillCurrent(generation, capturedReference) || isAbortError(error)) return;
      if (error instanceof ConsoleApiError && error.status === 404) {
        setOrder(null);
        setState('not-found');
        return;
      }
      setState((current) => current === 'ready' ? current : 'error');
    });
  };

  useEffect(() => {
    const generation = routeGeneration;
    const capturedReference = reference;
    loadAbortRef.current?.abort();
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = null;
    const controller = new AbortController();
    loadAbortRef.current = controller;
    attemptRef.current = null;
    setOrder(null);
    setPanel(null);
    setPaymentConfirmed(false);
    setInFlight(false);
    setNotice(null);
    setLockedAction(null);
    loadOrder(generation, capturedReference, controller.signal);
    return () => {
      mutationAbortRef.current?.abort();
      loadAbortRef.current?.abort();
    };
  }, [reference, routeGeneration]);

  useEffect(() => {
    if (state === 'ready' || state === 'not-found' || state === 'error') headingRef.current?.focus();
  }, [state, reference]);

  useEffect(() => {
    if (panel) {
      panelHeadingRef.current?.focus();
      return;
    }
    if (restoreTriggerRef.current) {
      restoreTriggerRef.current = false;
      triggerRef.current?.focus();
    }
  }, [panel]);

  const closePanel = () => {
    if (inFlight) return;
    restoreTriggerRef.current = true;
    setPanel(null);
    setPaymentConfirmed(false);
  };

  const openPanel = (action: OrderAction, trigger: HTMLButtonElement) => {
    if (lockedAction && lockedAction !== action) return;
    triggerRef.current = trigger;
    setNotice(null);
    setPaymentConfirmed(false);
    setPanel(action);
  };

  const refetchAfterWrite = async (generation: number, capturedReference: string, signal: AbortSignal) => {
    try {
      const response = await fetchOrder(capturedReference, signal);
      if (!stillCurrent(generation, capturedReference)) return;
      setOrder(response.order);
      setState('ready');
      setNotice(null);
    } catch (error) {
      if (!stillCurrent(generation, capturedReference) || isAbortError(error)) return;
      setNotice({ kind: 'read-after-write' });
    }
  };

  const confirmAction = async (action: OrderAction) => {
    if (inFlight) return;
    if (action === 'complete' && !paymentConfirmed) return;
    const generation = generationRef.current;
    const capturedReference = referenceRef.current;
    let attempt = attemptRef.current;
    if (!attempt || attempt.reference !== capturedReference || attempt.action !== action) {
      attempt = { reference: capturedReference, action, key: crypto.randomUUID() };
      attemptRef.current = attempt;
    }
    mutationAbortRef.current?.abort();
    const controller = new AbortController();
    mutationAbortRef.current = controller;
    const deadline = deadlineSignal(controller.signal, MUTATION_DEADLINE_MS);
    setInFlight(true);
    setLockedAction(action);
    setNotice(null);
    try {
      if (action === 'complete') {
        await completeConsoleOrder(capturedReference, attempt.key, deadline.signal);
      } else {
        await cancelConsoleOrder(capturedReference, attempt.key, deadline.signal);
      }
      if (!stillCurrent(generation, capturedReference)) {
        onInvalidateList();
        return;
      }
      attemptRef.current = null;
      setLockedAction(null);
      setPanel(null);
      setPaymentConfirmed(false);
      onInvalidateList();
      await refetchAfterWrite(generation, capturedReference, loadAbortRef.current?.signal ?? controller.signal);
    } catch (error) {
      if (!stillCurrent(generation, capturedReference)) return;
      if (error instanceof ConsoleApiError && error.status === 409) {
        attemptRef.current = null;
        setLockedAction(null);
        setPanel(null);
        setPaymentConfirmed(false);
        setNotice({ kind: 'conflict', idempotency: error.code === 'idempotency_conflict' });
        onInvalidateList();
        loadAbortRef.current?.abort();
        const refresh = new AbortController();
        loadAbortRef.current = refresh;
        loadOrder(generation, capturedReference, refresh.signal);
        return;
      }
      if (error instanceof ConsoleApiError && error.status !== 408 && error.status !== 429 && error.status < 500) {
        attemptRef.current = null;
        setLockedAction(null);
        setNotice({ kind: 'error', message: error.message });
        return;
      }
      if (isOutcomeUnknown(error)) {
        setNotice({ kind: 'unknown' });
        return;
      }
      setNotice({ kind: 'error', message: 'The Order operation could not be completed.' });
    } finally {
      deadline.dispose();
      if (stillCurrent(generation, capturedReference)) setInFlight(false);
    }
  };

  const retryLoading = () => {
    const generation = generationRef.current;
    const capturedReference = referenceRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setNotice((current) => current?.kind === 'read-after-write' ? current : null);
    loadOrder(generation, capturedReference, controller.signal);
  };

  const status = order ? statusPresentation(order.status) : null;
  const showComplete = Boolean(order && ((order.allowedActions.includes('complete') || lockedAction === 'complete')));
  const showCancel = Boolean(order && ((order.allowedActions.includes('cancel') || lockedAction === 'cancel')));
  const completeLockedOut = lockedAction === 'cancel';
  const cancelLockedOut = lockedAction === 'complete';
  return (
    <div className="page-stack">
      <button className="text-button" type="button" onClick={onBack}>Back to Orders</button>

      {state === 'loading' && !order ? (
        <div aria-busy="true" aria-label="Loading Order">
          <div className="skeleton-row order-skeleton-row" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((cell) => <span className="skeleton-line" key={cell} />)}</div>
        </div>
      ) : null}

      {state === 'not-found' ? (
        <div className="empty-state notice-error" role="alert">
          <h1 tabIndex={-1} ref={headingRef}>Order not found</h1>
          <p>This Order is unavailable. The reference may be unknown or malformed.</p>
          <button className="button" type="button" onClick={onBack}>Back to Orders</button>
        </div>
      ) : null}

      {state === 'error' && !order ? (
        <div className="empty-state notice-error" role="alert">
          <h1 tabIndex={-1} ref={headingRef}>Order could not be loaded</h1>
          <p>Retry to request the safe Console projection again.</p>
          <div className="inline-actions">
            <button className="button" type="button" onClick={retryLoading}>Retry loading Order</button>
            <button className="button" type="button" onClick={onBack}>Back to Orders</button>
          </div>
        </div>
      ) : null}

      {order ? (
        <>
          <header className="page-header">
            <div className="page-header-copy">
              <h1 tabIndex={-1} ref={headingRef}>{order.reference}</h1>
              <p>Review the stored Customer Order snapshot. Complete or Cancel only when the Order is still pending payment.</p>
            </div>
            <div className="page-actions">
              <span className={status?.className}>{status?.label}</span>
              {order.refundRequestStatus === 'pending' ? <span className="refund-badge">Refund request pending</span> : null}
            </div>
          </header>
          {notice?.kind === 'unknown' ? (
            <div className="notice notice-error" role="alert">
              <strong>The outcome is not confirmed. Retry the same action.</strong>
              <span>The previous request may still be processing. Retry uses the same action and does not prove the server rolled back.</span>
            </div>
          ) : null}
          {notice?.kind === 'conflict' ? (
            <div className="notice notice-error" role="alert">
              <strong>The action was not applied. The Order has changed.</strong>
              {notice.idempotency ? <span>The idempotency key is already bound to another Order command.</span> : null}
            </div>
          ) : null}
          {notice?.kind === 'read-after-write' ? (
            <div className="notice notice-error" role="alert">
              <strong>The action succeeded, but the latest Order could not be loaded.</strong>
              <button className="button" type="button" onClick={retryLoading}>Retry loading Order</button>
            </div>
          ) : null}
          {notice?.kind === 'error' ? (
            <div className="notice notice-error" role="alert">
              <strong>{notice.message}</strong>
            </div>
          ) : null}
          {state === 'error' && order ? (
            <div className="notice notice-error" role="alert">
              <strong>The latest Order could not be loaded.</strong>
              <button className="button" type="button" onClick={retryLoading}>Retry loading Order</button>
            </div>
          ) : null}

          {panel === 'complete' ? (
            <section className="notice notice-info" aria-labelledby="complete-order-title">
              <h2 id="complete-order-title" tabIndex={-1} ref={panelHeadingRef}>Confirm Complete</h2>
              <p>
                Complete Order {order.reference} for {formatMoney(order.totalMinor, order.currency)} {order.currency}.
                Confirm that the full payment has been received. Zero-total Orders use this same confirmation.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={paymentConfirmed}
                  disabled={inFlight}
                  onChange={(event) => setPaymentConfirmed(event.target.checked)}
                />
                I confirm the full payment has been received.
              </label>
              <div className="inline-actions">
                <button
                  className="button button-primary"
                  type="button"
                  disabled={inFlight || !paymentConfirmed}
                  onClick={() => { void confirmAction('complete'); }}
                >
                  {notice?.kind === 'unknown' ? 'Retry Complete' : 'Confirm Complete'}
                </button>
                <button className="button" type="button" disabled={inFlight} onClick={closePanel}>Back to Order</button>
              </div>
            </section>
          ) : null}

          {panel === 'cancel' ? (
            <section className="notice notice-info" aria-labelledby="cancel-order-title">
              <h2 id="cancel-order-title" tabIndex={-1} ref={panelHeadingRef}>Confirm Cancel</h2>
              <p>
                Cancel Order {order.reference} for {formatMoney(order.totalMinor, order.currency)} {order.currency}.
                Only Orders pending payment can be cancelled.
              </p>
              <div className="inline-actions">
                <button
                  className="button button-danger"
                  type="button"
                  disabled={inFlight}
                  onClick={() => { void confirmAction('cancel'); }}
                >
                  {notice?.kind === 'unknown' ? 'Retry Cancel' : 'Confirm Cancel'}
                </button>
                <button className="button" type="button" disabled={inFlight} onClick={closePanel}>Back to Order</button>
              </div>
            </section>
          ) : null}

          {(showComplete || showCancel) ? (
            <div
              className="inline-actions"
              style={{ display: panel !== null || notice?.kind === 'read-after-write' || state !== 'ready' ? 'none' : undefined }}
            >
              {showComplete ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={inFlight || completeLockedOut}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => openPanel('complete', event.currentTarget)}
                >
                  Complete
                </button>
              ) : null}
              {showCancel ? (
                <button
                  className="button button-danger"
                  type="button"
                  disabled={inFlight || cancelLockedOut}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => openPanel('cancel', event.currentTarget)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          ) : null}

          <section className="order-detail-section" aria-labelledby="order-snapshot-title">
            <h2 id="order-snapshot-title">Order snapshot</h2>
            <dl className="order-detail-fields">
              <div><dt>Customer</dt><dd>{order.customer.name}<br /><span className="meta-text">{order.customer.email}</span></dd></div>
              <div><dt>Product</dt><dd>{order.product.name}<br /><span className="meta-text">{orderSelection(order)}</span></dd></div>
              <div><dt>Quantity</dt><dd className="numeric">{order.quantity}</dd></div>
              <div><dt>Unit price</dt><dd className="numeric">{formatMoney(order.unitPriceMinor, order.currency)}</dd></div>
              <div><dt>Total</dt><dd className="numeric order-total">{formatMoney(order.totalMinor, order.currency)} {order.currency}</dd></div>
              <div><dt>Created</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd></div>
            </dl>
          </section>

          {order.refundRequest ? (
            <section className="order-detail-section" aria-labelledby="order-refund-title">
              <h2 id="order-refund-title">Refund request</h2>
              <p><span className="refund-badge">Refund request pending</span></p>
              <p className="order-reason">{order.refundRequest.reason}</p>
              <p className="meta-text">{new Date(order.refundRequest.createdAt).toLocaleString()}</p>
            </section>
          ) : null}

          <section className="order-detail-section" aria-labelledby="order-history-title">
            <h2 id="order-history-title">History</h2>
            <ol className="order-history">
              {order.history.map((event) => (
                <HistoryEntry key={`${event.action}-${event.createdAt}-${event.source}`} event={event} />
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </div>
  );
}
