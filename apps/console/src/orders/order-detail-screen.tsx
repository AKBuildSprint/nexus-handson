import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  cancelConsoleOrder,
  ConsoleApiError,
  createConsoleRefundRequest,
  assignConsoleOrder,
  decideConsoleRefundRequest,
  fetchStaffCandidates,
  fetchOrder,
  fulfill,
  markPaid,
} from '../api-client';
import type {
  ConsoleOrderDetailState,
  ConsoleOrderDetailView,
  ConsoleOrderHistoryView,
  OrderAuditSource,
  OrderHistoryAction,
  OrderItemView,
  OrderStatus,
} from './order-ui-types';

interface OrderDetailScreenProps {
  reference: string;
  routeGeneration: number;
  onInvalidateList: () => void;
  onBack: () => void;
  canAssign?: boolean;
  onSessionExpired?: () => void;
}

type OrderAction = 'mark_paid' | 'fulfill' | 'cancel' | 'request_refund';
type ConfirmPanel = OrderAction | null;
type DetailNotice =
  | { kind: 'unknown' }
  | { kind: 'conflict'; idempotency: boolean; reload: boolean }
  | { kind: 'read-after-write' }
  | { kind: 'outdated' }
  | { kind: 'error'; message: string };

type FrozenAttempt =
  | { action: 'mark_paid'; orderReference: string; key: string; method: string; paymentReference: string }
  | { action: 'fulfill'; orderReference: string; key: string }
  | { action: 'cancel'; orderReference: string; key: string }
  | { action: 'request_refund'; orderReference: string; key: string; reason: string };
type FrozenRoleAttempt =
  | { action: 'assign'; orderReference: string; key: string; assigneeUserId: string }
  | { action: 'approve' | 'reject'; orderReference: string; requestId: string; key: string };

const MUTATION_DEADLINE_MS = 15_000;
const REASON_INVALID = 'Enter a reason using 1 to 1000 characters.';
const METHOD_INVALID = 'Enter a payment method using 1 to 80 characters.';
const REFERENCE_INVALID = 'Enter an external payment reference using 1 to 160 characters.';

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

const HISTORY_ACTION_LABEL: Record<OrderHistoryAction, string> = {
  order_created: 'Created',
  order_completed: 'Legacy completion (payment confirmed; fulfillment not recorded)',
  order_cancelled: 'Cancelled',
  order_paid: 'Paid',
  order_fulfilled: 'Fulfilled',
  order_canceled: 'Canceled',
  refund_requested: 'Refund requested',
  refund_approved: 'Refund approved',
  refund_rejected: 'Refund rejected',
  assigned: 'Assigned',
};

const HISTORY_SOURCE_LABEL: Record<OrderAuditSource, string> = {
  console: 'Console',
  customer_capability: 'Customer',
  bootstrap_owner: 'Bootstrap Owner (demo)',
  storefront: 'Customer',
  user: 'User (recorded identity; not a signed-in Console account)',
  system: 'System (recorded identity; not a signed-in Console account)',
};

const CONSOLE_ORDER_SYNC = 'nexus-console-orders';

function publishConsoleOrderChange(reference: string) {
  if (typeof BroadcastChannel !== 'function') return;
  const channel = new BroadcastChannel(CONSOLE_ORDER_SYNC);
  channel.postMessage({ reference });
  channel.close();
}

function detailIntro(order: ConsoleOrderDetailView): string {
  if (order.status === 'pending') {
    return 'Review the stored Customer Order snapshot. Record a manual payment or Cancel only while the Order is still pending.';
  }
  if (order.status === 'canceled') {
    return 'Review the stored Customer Order snapshot. This Order is canceled. Payment, Fulfill, and Cancel are no longer available.';
  }
  if (order.refundRequestStatus === 'pending') {
    return 'Review the stored Customer Order snapshot. A refund request is pending. An Owner may record a final decision; this Console does not move money.';
  }
  if (order.refundRequestStatus === 'approved') {
    return 'The refund request is approved and awaiting external execution. No refund is recorded as issued here.';
  }
  if (order.refundRequestStatus === 'rejected') {
    return 'The refund request was rejected. No refund was issued.';
  }
  if (order.status === 'fulfilled') {
    return 'Review the stored Customer Order snapshot. This Order is fulfilled. Fulfillment is an operational status and does not grant Product Access.';
  }
  return 'Review the stored Customer Order snapshot. This Order is paid. Fulfill records an operational status change and does not grant Product Access.';
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

function statusPresentation(status: string): { label: string; className: string } {
  if (status === 'pending' || status === 'paid' || status === 'fulfilled' || status === 'canceled') {
    return { label: STATUS_LABEL[status], className: `status-tag ${STATUS_CLASS[status]}` };
  }
  return { label: 'Unknown status', className: 'status-tag' };
}

function historyActionLabel(action: string, actorLabel: string): string {
  if (action === 'order_completed') return actorLabel || HISTORY_ACTION_LABEL.order_completed;
  return action in HISTORY_ACTION_LABEL ? HISTORY_ACTION_LABEL[action as OrderHistoryAction] : action;
}

function historySourceLabel(source: string, actorLabel: string): string {
  if (actorLabel && source !== 'console' && source !== 'customer_capability') return actorLabel;
  if (source === 'bootstrap_owner') return actorLabel || HISTORY_SOURCE_LABEL.bootstrap_owner;
  if (source === 'storefront') return actorLabel || HISTORY_SOURCE_LABEL.storefront;
  return source in HISTORY_SOURCE_LABEL ? HISTORY_SOURCE_LABEL[source as OrderAuditSource] : source;
}

function itemSelection(item: OrderItemView): string {
  if (!item.product.variant) return 'Simple Product';
  const options = item.product.variant.selectedOptions.map((option) => `${option.groupName}: ${option.valueLabel}`).join(', ');
  return options ? `${options} · SKU ${item.product.variant.sku}` : `SKU ${item.product.variant.sku}`;
}

function itemLineCopy(item: OrderItemView) {
  return {
    name: item.product.name,
    selection: itemSelection(item),
    quantity: item.quantity,
    unitPrice: `${formatMoney(item.unitPriceMinor, item.currency)} ${item.currency}`,
    lineTotal: `${formatMoney(item.lineTotalMinor, item.currency)} ${item.currency}`,
  };
}

function OrderItemSnapshots({ items }: { items: OrderItemView[] }) {
  return (
    <>
      <table className="console-table order-items-table" aria-label="Order items">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Quantity</th>
            <th scope="col">Unit price</th>
            <th scope="col">Line total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const line = itemLineCopy(item);
            return (
              <tr key={item.id}>
                <td><strong>{line.name}</strong><br /><span className="meta-text">{line.selection}</span></td>
                <td className="numeric">{line.quantity}</td>
                <td className="numeric">{line.unitPrice}</td>
                <td className="numeric">{line.lineTotal}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="order-items-mobile" aria-label="Order items">
        {items.map((item) => {
          const line = itemLineCopy(item);
          return (
            <article className="order-summary-card" key={item.id}>
              <h3>{line.name}</h3>
              <p className="meta-text">{line.selection}</p>
              <dl>
                <div><dt>Quantity</dt><dd className="numeric">{line.quantity}</dd></div>
                <div><dt>Unit price</dt><dd className="numeric">{line.unitPrice}</dd></div>
                <div><dt>Line total</dt><dd className="numeric">{line.lineTotal}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    </>
  );
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

function validateBoundedText(value: string, min: number, max: number, message: string): string | null {
  const normalized = value.replace(/\r\n|\r/g, '\n').trim();
  const length = Array.from(normalized).length;
  if (length < min || length > max) return message;
  for (const char of normalized) {
    if (/\p{Cf}/u.test(char)) return message;
    if (/\p{Cc}/u.test(char) && char !== '\t' && char !== '\n') return message;
  }
  return null;
}

function HistoryEntry({ event }: { event: ConsoleOrderHistoryView }) {
  const from = event.fromStatus ? statusPresentation(event.fromStatus).label : 'None';
  const to = statusPresentation(event.toStatus).label;
  return (
    <li>
      <strong>{historyActionLabel(event.action, event.actorLabel)}</strong>
      <span className="meta-text">
        {historySourceLabel(event.source, event.actorLabel)} · {from} → {to} · {new Date(event.createdAt).toLocaleString()}
      </span>
    </li>
  );
}

function paidHistoryActor(order: ConsoleOrderDetailView): string | null {
  const paid = [...order.history].reverse().find((event) => event.action === 'order_paid' || event.action === 'order_completed');
  return paid ? historySourceLabel(paid.source, paid.actorLabel) : null;
}

function refundHistoryActor(order: ConsoleOrderDetailView): string | null {
  const requested = [...order.history].reverse().find((event) => event.action === 'refund_requested');
  return requested ? historySourceLabel(requested.source, requested.actorLabel) : null;
}

export function OrderDetailScreen({
  reference,
  routeGeneration,
  onInvalidateList,
  onBack,
  canAssign = false,
  onSessionExpired,
}: OrderDetailScreenProps) {
  const [state, setState] = useState<ConsoleOrderDetailState>('loading');
  const [order, setOrder] = useState<ConsoleOrderDetailView | null>(null);
  const [panel, setPanel] = useState<ConfirmPanel>(null);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentAcknowledged, setPaymentAcknowledged] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [fieldError, setFieldError] = useState<{ path: string; message: string } | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [notice, setNotice] = useState<DetailNotice | null>(null);
  const [lockedAction, setLockedAction] = useState<OrderAction | null>(null);
  const [staff, setStaff] = useState<Array<{ userId: string; name: string }>>([]);
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [roleActionBusy, setRoleActionBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const attemptRef = useRef<FrozenAttempt | null>(null);
  const inFlightRef = useRef(false);
  const loadOrderRef = useRef<(generation: number, capturedReference: string, signal: AbortSignal, mode?: 'page' | 'refresh') => void>(() => undefined);
  const loadAbortRef = useRef<AbortController | null>(null);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const roleActionAbortRef = useRef<AbortController | null>(null);
  const roleAttemptRef = useRef<FrozenRoleAttempt | null>(null);
  const restoreTriggerRef = useRef(false);
  const generationRef = useRef(routeGeneration);
  const referenceRef = useRef(reference);
  const readEpochRef = useRef(0);

  generationRef.current = routeGeneration;
  referenceRef.current = reference;
  inFlightRef.current = inFlight;

  const stillCurrent = (generation: number, capturedReference: string) => (
    generationRef.current === generation && referenceRef.current === capturedReference
  );

  const loadOrder = (generation: number, capturedReference: string, signal: AbortSignal, mode: 'page' | 'refresh' = 'page') => {
    const epoch = readEpochRef.current + 1;
    readEpochRef.current = epoch;
    if (mode === 'page') setState('loading');
    void fetchOrder(capturedReference, signal).then((response) => {
      if (epoch !== readEpochRef.current) return;
      if (!stillCurrent(generation, capturedReference)) return;
      setOrder(response.order);
      setAssigneeUserId(response.order.assignment?.assigneeUserId ?? '');
      setState('ready');
      setNotice((current) => current?.kind === 'read-after-write' ? null : current);
      if (mode === 'refresh' && !inFlightRef.current) {
        const actions = response.order.allowedActions;
        setPanel((current) => (current && !actions.includes(current) ? null : current));
        setLockedAction((current) => (current && !actions.includes(current) ? null : current));
      }
    }).catch((error: unknown) => {
      if (epoch !== readEpochRef.current) return;
      if (!stillCurrent(generation, capturedReference) || isAbortError(error)) return;
      if (error instanceof ConsoleApiError && (error.status === 401 || error.code === 'store_access_denied')) {
        onSessionExpired?.();
        return;
      }
      if (error instanceof ConsoleApiError && error.code === 'client_contract_outdated') {
        attemptRef.current = null;
        setLockedAction(null);
        setPanel(null);
        setPaymentAcknowledged(false);
        setNotice({ kind: 'outdated' });
        setState((current) => current === 'ready' ? current : 'error');
        return;
      }
      if (error instanceof ConsoleApiError && error.status === 404) {
        setOrder(null);
        setState('not-found');
        return;
      }
      setState((current) => current === 'ready' ? current : 'error');
    });
  };
  loadOrderRef.current = loadOrder;

  useEffect(() => {
    const generation = routeGeneration;
    const capturedReference = reference;
    loadAbortRef.current?.abort();
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = null;
    const controller = new AbortController();
    loadAbortRef.current = controller;
    attemptRef.current = null;
    roleAttemptRef.current = null;
    setOrder(null);
    setPanel(null);
    setPaymentMethod('');
    setPaymentReference('');
    setPaymentAcknowledged(false);
    setRefundReason('');
    setFieldError(null);
    setInFlight(false);
    setNotice(null);
    setLockedAction(null);
    loadOrder(generation, capturedReference, controller.signal);
    return () => {
      mutationAbortRef.current?.abort();
      roleActionAbortRef.current?.abort();
      loadAbortRef.current?.abort();
    };
  }, [reference, routeGeneration]);

  useEffect(() => {
    if (!canAssign) {
      setStaff([]);
      return;
    }
    const controller = new AbortController();
    void fetchStaffCandidates(controller.signal).then((response) => {
      if (!controller.signal.aborted) setStaff(response.staff);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ConsoleApiError && (error.status === 401 || error.code === 'store_access_denied')) onSessionExpired?.();
    });
    return () => controller.abort();
  }, [canAssign, routeGeneration]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      if (inFlightRef.current) return;
      const generation = generationRef.current;
      const capturedReference = referenceRef.current;
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      loadOrderRef.current(generation, capturedReference, controller.signal, 'refresh');
    };
    const onMessage = (event: MessageEvent<{ reference?: string }>) => {
      if (event.data?.reference === referenceRef.current) refresh();
    };
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CONSOLE_ORDER_SYNC) : null;
    channel?.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      document.removeEventListener('visibilitychange', refresh);
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

  const fieldsLocked = Boolean(attemptRef.current) && notice?.kind === 'unknown';

  const closePanel = () => {
    if (inFlight) return;
    restoreTriggerRef.current = true;
    setPanel(null);
    setFieldError(null);
    if (!fieldsLocked) {
      setPaymentAcknowledged(false);
    }
  };

  const openPanel = (action: OrderAction, trigger: HTMLButtonElement) => {
    if (lockedAction && lockedAction !== action) return;
    triggerRef.current = trigger;
    setNotice(null);
    setFieldError(null);
    if (!attemptRef.current || attemptRef.current.action !== action) {
      setPaymentAcknowledged(false);
    }
    setPanel(action);
  };

  const refetchAfterWrite = async (generation: number, capturedReference: string) => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const epoch = readEpochRef.current + 1;
    readEpochRef.current = epoch;
    try {
      const response = await fetchOrder(capturedReference, controller.signal);
      if (epoch !== readEpochRef.current) return;
      if (!stillCurrent(generation, capturedReference)) return;
      setOrder(response.order);
      setState('ready');
      setNotice(null);
    } catch (error) {
      if (epoch !== readEpochRef.current) return;
      if (!stillCurrent(generation, capturedReference) || isAbortError(error)) return;
      if (error instanceof ConsoleApiError && (error.status === 401 || error.code === 'store_access_denied')) {
        onSessionExpired?.();
        return;
      }
      if (error instanceof ConsoleApiError && error.code === 'client_contract_outdated') {
        setNotice({ kind: 'outdated' });
        return;
      }
      setNotice({ kind: 'read-after-write' });
    }
  };

  const confirmAction = async (action: OrderAction) => {
    if (inFlight || notice?.kind === 'outdated') return;
    const generation = generationRef.current;
    const capturedReference = referenceRef.current;
    let attempt = attemptRef.current;
    if (!attempt || attempt.orderReference !== capturedReference || attempt.action !== action) {
      if (action === 'mark_paid') {
        const methodError = validateBoundedText(paymentMethod, 1, 80, METHOD_INVALID);
        const referenceError = validateBoundedText(paymentReference, 1, 160, REFERENCE_INVALID);
        if (methodError || referenceError || !paymentAcknowledged) {
          setFieldError(methodError ? { path: '/method', message: methodError } : referenceError ? { path: '/reference', message: referenceError } : { path: '/ack', message: 'Acknowledge the external receipt before recording payment.' });
          return;
        }
        attempt = {
          action: 'mark_paid',
          orderReference: capturedReference,
          key: crypto.randomUUID(),
          method: paymentMethod.trim(),
          paymentReference: paymentReference.trim(),
        };
        setPaymentMethod(attempt.method);
        setPaymentReference(attempt.paymentReference);
      } else if (action === 'request_refund') {
        const reasonError = validateBoundedText(refundReason, 1, 1000, REASON_INVALID);
        if (reasonError) {
          setFieldError({ path: '/reason', message: reasonError });
          return;
        }
        attempt = {
          action: 'request_refund',
          orderReference: capturedReference,
          key: crypto.randomUUID(),
          reason: refundReason.replace(/\r\n|\r/g, '\n').trim(),
        };
        setRefundReason(attempt.reason);
      } else {
        attempt = { action, orderReference: capturedReference, key: crypto.randomUUID() };
      }
      attemptRef.current = attempt;
    }
    if (!attempt) return;
    mutationAbortRef.current?.abort();
    loadAbortRef.current?.abort();
    readEpochRef.current += 1;
    const controller = new AbortController();
    mutationAbortRef.current = controller;
    const deadline = deadlineSignal(controller.signal, MUTATION_DEADLINE_MS);
    setInFlight(true);
    setLockedAction(action);
    setNotice(null);
    setFieldError(null);
    try {
      if (attempt.action === 'mark_paid') {
        await markPaid(capturedReference, { method: attempt.method, reference: attempt.paymentReference }, attempt.key, deadline.signal);
      } else if (attempt.action === 'fulfill') {
        await fulfill(capturedReference, attempt.key, deadline.signal);
      } else if (attempt.action === 'request_refund') {
        await createConsoleRefundRequest(capturedReference, attempt.reason, attempt.key, deadline.signal);
      } else {
        await cancelConsoleOrder(capturedReference, attempt.key, deadline.signal);
      }
      if (!stillCurrent(generation, capturedReference)) {
        onInvalidateList();
        publishConsoleOrderChange(capturedReference);
        return;
      }
      attemptRef.current = null;
      setLockedAction(null);
      setPanel(null);
      setPaymentAcknowledged(false);
      onInvalidateList();
      publishConsoleOrderChange(capturedReference);
      await refetchAfterWrite(generation, capturedReference);
    } catch (error) {
      if (!stillCurrent(generation, capturedReference)) return;
      if (error instanceof ConsoleApiError && (error.status === 401 || error.code === 'store_access_denied')) {
        onSessionExpired?.();
        return;
      }
      if (error instanceof ConsoleApiError && error.code === 'client_contract_outdated') {
        attemptRef.current = null;
        setLockedAction(null);
        setPanel(null);
        setPaymentAcknowledged(false);
        setNotice({ kind: 'outdated' });
        return;
      }
      if (error instanceof ConsoleApiError && error.status === 409) {
        const legacyKey = error.code === 'idempotency_conflict' && error.message.includes('previous contract');
        attemptRef.current = null;
        setLockedAction(null);
        setPanel(null);
        setPaymentAcknowledged(false);
        setNotice({ kind: 'conflict', idempotency: error.code === 'idempotency_conflict', reload: legacyKey });
        onInvalidateList();
        publishConsoleOrderChange(capturedReference);
        loadAbortRef.current?.abort();
        const refresh = new AbortController();
        loadAbortRef.current = refresh;
        loadOrder(generation, capturedReference, refresh.signal);
        return;
      }
      if (error instanceof ConsoleApiError && error.status === 422) {
        attemptRef.current = null;
        setLockedAction(null);
        const first = error.fields[0];
        setFieldError(first ? { path: first.path, message: first.message } : { path: '', message: error.message });
        setNotice({ kind: 'error', message: error.message });
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

  const assignOrderToStaff = async () => {
    if (!order || !assigneeUserId || roleActionBusy) return;
    const generation = generationRef.current;
    const capturedReference = referenceRef.current;
    const existing = roleAttemptRef.current;
    const attempt = existing?.action === 'assign' && existing.orderReference === capturedReference && existing.assigneeUserId === assigneeUserId
      ? existing
      : { action: 'assign' as const, orderReference: capturedReference, assigneeUserId, key: crypto.randomUUID() };
    roleAttemptRef.current = attempt;
    roleActionAbortRef.current?.abort();
    const controller = new AbortController();
    roleActionAbortRef.current = controller;
    setRoleActionBusy(true);
    try {
      await assignConsoleOrder(order.reference, attempt.assigneeUserId, attempt.key, controller.signal);
      if (!stillCurrent(generation, capturedReference)) return;
      roleAttemptRef.current = null;
      setNotice(null);
      onInvalidateList();
      await refetchAfterWrite(generation, capturedReference);
    } catch (error) {
      if (!stillCurrent(generation, capturedReference) || isAbortError(error)) return;
      if (error instanceof ConsoleApiError && (error.status === 401 || error.code === 'store_access_denied')) {
        roleAttemptRef.current = null;
        onSessionExpired?.();
      } else if (isOutcomeUnknown(error)) {
        setNotice({ kind: 'unknown' });
      } else {
        roleAttemptRef.current = null;
        setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Assignment failed.' });
        await refetchAfterWrite(generation, capturedReference);
      }
    } finally {
      if (stillCurrent(generation, capturedReference)) setRoleActionBusy(false);
    }
  };

  const decideRefund = async (decision: 'approve' | 'reject') => {
    if (!order?.refundRequest || roleActionBusy) return;
    const generation = generationRef.current;
    const capturedReference = referenceRef.current;
    const requestId = order.refundRequest.id;
    const existing = roleAttemptRef.current;
    const attempt = existing && existing.action === decision && existing.orderReference === capturedReference && existing.requestId === requestId
      ? existing
      : { action: decision, orderReference: capturedReference, requestId, key: crypto.randomUUID() };
    roleAttemptRef.current = attempt;
    roleActionAbortRef.current?.abort();
    const controller = new AbortController();
    roleActionAbortRef.current = controller;
    setRoleActionBusy(true);
    try {
      await decideConsoleRefundRequest(order.reference, requestId, decision, attempt.key, controller.signal);
      if (!stillCurrent(generation, capturedReference)) return;
      roleAttemptRef.current = null;
      setNotice(null);
      onInvalidateList();
      await refetchAfterWrite(generation, capturedReference);
    } catch (error) {
      if (!stillCurrent(generation, capturedReference) || isAbortError(error)) return;
      if (error instanceof ConsoleApiError && (error.status === 401 || error.code === 'store_access_denied')) {
        roleAttemptRef.current = null;
        onSessionExpired?.();
      } else if (isOutcomeUnknown(error)) {
        setNotice({ kind: 'unknown' });
      } else {
        roleAttemptRef.current = null;
        setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Refund decision failed.' });
        await refetchAfterWrite(generation, capturedReference);
      }
    } finally {
      if (stillCurrent(generation, capturedReference)) setRoleActionBusy(false);
    }
  };

  const status = order ? statusPresentation(order.status) : null;
  const showMarkPaid = Boolean(order && (order.allowedActions.includes('mark_paid') || lockedAction === 'mark_paid'));
  const showFulfill = Boolean(order && (order.allowedActions.includes('fulfill') || lockedAction === 'fulfill'));
  const showCancel = Boolean(order && (order.allowedActions.includes('cancel') || lockedAction === 'cancel'));
  const showRefund = Boolean(order && (order.allowedActions.includes('request_refund') || lockedAction === 'request_refund'));
  const actionsHidden = panel !== null || notice?.kind === 'read-after-write' || notice?.kind === 'outdated' || state !== 'ready';
  const displayedMethod = fieldsLocked && attemptRef.current?.action === 'mark_paid' ? attemptRef.current.method : paymentMethod;
  const displayedPaymentReference = fieldsLocked && attemptRef.current?.action === 'mark_paid' ? attemptRef.current.paymentReference : paymentReference;
  const displayedReason = fieldsLocked && attemptRef.current?.action === 'request_refund' ? attemptRef.current.reason : refundReason;
  const paymentActor = order ? paidHistoryActor(order) : null;
  const refundActor = order ? refundHistoryActor(order) : null;

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
          <h1 tabIndex={-1} ref={headingRef}>{notice?.kind === 'outdated' ? 'This Console is out of date' : 'Order could not be loaded'}</h1>
          <p>{notice?.kind === 'outdated' ? 'Reload the page and try again. This client will not retry the previous Order request.' : 'Retry to request the safe Console projection again.'}</p>
          <div className="inline-actions">
            {notice?.kind === 'outdated'
              ? <button className="button" type="button" onClick={() => { window.location.reload(); }}>Reload Console</button>
              : <button className="button" type="button" onClick={retryLoading}>Retry loading Order</button>}
            <button className="button" type="button" onClick={onBack}>Back to Orders</button>
          </div>
        </div>
      ) : null}

      {order ? (
        <>
          <header className="page-header">
            <div className="page-header-copy">
              <h1 tabIndex={-1} ref={headingRef}>{order.reference}</h1>
              <p>{detailIntro(order)}</p>
            </div>
            <div className="page-actions">
              <span className={status?.className}>{status?.label}</span>
              {order.refundRequestStatus ? <span className="refund-badge">Refund request {order.refundRequestStatus}</span> : null}
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
              {notice.reload ? (
                <>
                  <span>This command key is from a previous contract. Reload the Order and retry with a new key.</span>
                  <button className="button" type="button" onClick={() => { window.location.reload(); }}>Reload Console</button>
                </>
              ) : null}
            </div>
          ) : null}
          {notice?.kind === 'outdated' ? (
            <div className="notice notice-error" role="alert">
              <strong>This Console is out of date.</strong>
              <span>Reload the page and try again. This client will not retry the previous Order request.</span>
              <button className="button" type="button" onClick={() => { window.location.reload(); }}>Reload Console</button>
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

          {canAssign && staff.length > 0 ? (
            <section className="notice notice-info" aria-label="Order assignment">
              <h2>Assignment</h2>
              <label htmlFor="order-assignee">Assign Order</label>
              <select id="order-assignee" aria-label="Assign Order" value={assigneeUserId} disabled={roleActionBusy} onChange={(event) => setAssigneeUserId(event.target.value)}>
                <option value="" disabled>Select active Staff</option>
                {staff.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.name}</option>)}
              </select>
              <button className="button button-primary" type="button" disabled={roleActionBusy || !assigneeUserId || assigneeUserId === order.assignment?.assigneeUserId} onClick={() => { void assignOrderToStaff(); }}>
                {roleAttemptRef.current?.action === 'assign' && notice?.kind === 'unknown' ? 'Retry assignment' : 'Assign'}
              </button>
            </section>
          ) : null}

          {order.refundRequest?.status === 'pending' && (order.allowedActions.includes('approve_refund') || order.allowedActions.includes('reject_refund')) ? (
            <section className="notice notice-info" aria-label="Refund decision">
              <h2>Refund decision</h2>
              <p>Approval records a final decision and awaits external execution. This Console does not return money.</p>
              <div className="inline-actions">
                {order.allowedActions.includes('approve_refund') ? <button className="button button-primary" type="button" disabled={roleActionBusy} onClick={() => { void decideRefund('approve'); }}>{roleAttemptRef.current?.action === 'approve' && notice?.kind === 'unknown' ? 'Retry approve refund' : 'Approve refund'}</button> : null}
                {order.allowedActions.includes('reject_refund') ? <button className="button" type="button" disabled={roleActionBusy} onClick={() => { void decideRefund('reject'); }}>{roleAttemptRef.current?.action === 'reject' && notice?.kind === 'unknown' ? 'Retry reject refund' : 'Reject refund'}</button> : null}
              </div>
            </section>
          ) : null}

          {panel === 'mark_paid' ? (
            <section className="notice notice-info" aria-labelledby="mark-paid-title">
              <h2 id="mark-paid-title" tabIndex={-1} ref={panelHeadingRef}>Record manual payment</h2>
              <p>
                Record payment for Order {order.reference} totaling {formatMoney(order.totalMinor, order.currency)} {order.currency}.
                {order.totalMinor === 0
                  ? ' Supply an honest zero-charge method and reference. This does not claim a bank transfer occurred.'
                  : ' Confirm that an external receipt exists for this exact total. This Console does not move money.'}
              </p>
              <form
                className="order-action-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmAction('mark_paid');
                }}
              >
                <div className="field">
                  <label htmlFor="payment-method">Payment method</label>
                  <input
                    id="payment-method"
                    value={displayedMethod}
                    disabled={inFlight || fieldsLocked}
                    aria-invalid={fieldError?.path === '/method'}
                    aria-describedby={fieldError?.path === '/method' ? 'payment-method-error' : undefined}
                    onChange={(event) => {
                      if (fieldsLocked) return;
                      setPaymentMethod(event.target.value);
                    }}
                  />
                  {fieldError?.path === '/method' ? <span id="payment-method-error" className="field-error">{fieldError.message}</span> : null}
                </div>
                <div className="field">
                  <label htmlFor="payment-reference">External payment reference</label>
                  <input
                    id="payment-reference"
                    value={displayedPaymentReference}
                    disabled={inFlight || fieldsLocked}
                    aria-invalid={fieldError?.path === '/reference'}
                    aria-describedby={fieldError?.path === '/reference' ? 'payment-reference-error' : undefined}
                    onChange={(event) => {
                      if (fieldsLocked) return;
                      setPaymentReference(event.target.value);
                    }}
                  />
                  {fieldError?.path === '/reference' ? <span id="payment-reference-error" className="field-error">{fieldError.message}</span> : null}
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={paymentAcknowledged}
                    disabled={inFlight}
                    onChange={(event) => setPaymentAcknowledged(event.target.checked)}
                  />
                  {order.totalMinor === 0
                    ? 'I confirm this zero-total Order should be marked paid without a bank transfer.'
                    : 'I confirm an external receipt exists for this exact total and currency.'}
                </label>
                {fieldError?.path === '/ack' ? <p className="field-error">{fieldError.message}</p> : null}
                <div className="inline-actions">
                  <button className="button button-primary" type="submit" disabled={inFlight || !paymentAcknowledged || notice?.kind === 'outdated'}>
                    {notice?.kind === 'unknown' ? 'Retry Mark Paid' : 'Mark Paid'}
                  </button>
                  <button className="button" type="button" disabled={inFlight} onClick={closePanel}>Back to Order</button>
                </div>
              </form>
            </section>
          ) : null}

          {panel === 'fulfill' ? (
            <section className="notice notice-info" aria-labelledby="fulfill-order-title">
              <h2 id="fulfill-order-title" tabIndex={-1} ref={panelHeadingRef}>Confirm Fulfill</h2>
              <p>
                Mark Order {order.reference} as fulfilled. This is an operational status change only.
                It does not grant Product Access or claim that files were delivered.
              </p>
              <div className="inline-actions">
                <button
                  className="button button-primary"
                  type="button"
                  disabled={inFlight || notice?.kind === 'outdated'}
                  onClick={() => { void confirmAction('fulfill'); }}
                >
                  {notice?.kind === 'unknown' ? 'Retry Fulfill' : 'Confirm Fulfill'}
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
                Only pending Orders can be canceled.
              </p>
              <div className="inline-actions">
                <button
                  className="button button-danger"
                  type="button"
                  disabled={inFlight || notice?.kind === 'outdated'}
                  onClick={() => { void confirmAction('cancel'); }}
                >
                  {notice?.kind === 'unknown' ? 'Retry Cancel' : 'Confirm Cancel'}
                </button>
                <button className="button" type="button" disabled={inFlight} onClick={closePanel}>Back to Order</button>
              </div>
            </section>
          ) : null}

          {panel === 'request_refund' ? (
            <section className="notice notice-info" aria-labelledby="console-refund-title">
              <h2 id="console-refund-title" tabIndex={-1} ref={panelHeadingRef}>Request refund for Customer</h2>
              <p>
                Submit one pending refund request on behalf of the Customer. Manual refunds require confirmation of an external return in a later step.
                This does not approve, reject, or return money.
              </p>
              <form
                className="order-action-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmAction('request_refund');
                }}
              >
                <div className="field">
                  <label htmlFor="console-refund-reason">Reason</label>
                  <textarea
                    id="console-refund-reason"
                    value={displayedReason}
                    disabled={inFlight || fieldsLocked}
                    aria-invalid={fieldError?.path === '/reason'}
                    aria-describedby={fieldError?.path === '/reason' ? 'console-refund-reason-error' : undefined}
                    onChange={(event) => {
                      if (fieldsLocked) return;
                      setRefundReason(event.target.value);
                    }}
                  />
                  {fieldError?.path === '/reason' ? <span id="console-refund-reason-error" className="field-error">{fieldError.message}</span> : null}
                </div>
                <div className="inline-actions">
                  <button className="button button-primary" type="submit" disabled={inFlight || notice?.kind === 'outdated'}>
                    {notice?.kind === 'unknown' ? 'Retry refund request' : 'Submit refund request'}
                  </button>
                  <button className="button" type="button" disabled={inFlight} onClick={closePanel}>Back to Order</button>
                </div>
              </form>
            </section>
          ) : null}

          {(showMarkPaid || showFulfill || showCancel || showRefund) ? (
            <div className="inline-actions" style={{ display: actionsHidden ? 'none' : undefined }}>
              {showMarkPaid ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={inFlight || (lockedAction !== null && lockedAction !== 'mark_paid')}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => openPanel('mark_paid', event.currentTarget)}
                >
                  Record manual payment
                </button>
              ) : null}
              {showFulfill ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={inFlight || (lockedAction !== null && lockedAction !== 'fulfill')}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => openPanel('fulfill', event.currentTarget)}
                >
                  Fulfill
                </button>
              ) : null}
              {showCancel ? (
                <button
                  className="button button-danger"
                  type="button"
                  disabled={inFlight || (lockedAction !== null && lockedAction !== 'cancel')}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => openPanel('cancel', event.currentTarget)}
                >
                  Cancel
                </button>
              ) : null}
              {showRefund ? (
                <button
                  className="button"
                  type="button"
                  disabled={inFlight || (lockedAction !== null && lockedAction !== 'request_refund')}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => openPanel('request_refund', event.currentTarget)}
                >
                  Request refund for Customer
                </button>
              ) : null}
            </div>
          ) : null}

          <section className="order-detail-section" aria-labelledby="order-snapshot-title">
            <h2 id="order-snapshot-title">Order snapshot</h2>
            <dl className="order-detail-fields">
              <div><dt>Order reference</dt><dd>{order.reference}</dd></div>
              <div><dt>Payment reference</dt><dd>{order.paymentReference}</dd></div>
              <div><dt>Customer</dt><dd>{order.customer.name}<br /><span className="meta-text">{order.customer.email}</span></dd></div>
              <div><dt>Total</dt><dd className="numeric order-total">{formatMoney(order.totalMinor, order.currency)} {order.currency}</dd></div>
              <div><dt>Created</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd></div>
            </dl>
            <OrderItemSnapshots items={order.items} />
          </section>

          <section className="order-detail-section" aria-labelledby="order-payment-title">
            <h2 id="order-payment-title">Payment</h2>
            {order.paymentRecordState === 'legacy_unrecorded' ? (
              <p>Original payment-record information is missing for this migrated paid Order. Do not ask the Customer to pay again.</p>
            ) : null}
            {order.payment ? (
              <dl className="order-detail-fields">
                <div><dt>Source</dt><dd>{order.payment.source}</dd></div>
                <div><dt>Method</dt><dd>{order.payment.method}</dd></div>
                <div><dt>External reference</dt><dd>{order.payment.externalReference}</dd></div>
                <div><dt>Recorded actor</dt><dd>{paymentActor ?? 'Bootstrap Owner (demo)'}</dd></div>
                <div><dt>Recorded time</dt><dd>{new Date(order.payment.recordedAt).toLocaleString()}</dd></div>
              </dl>
            ) : order.paymentRecordState === 'none' ? (
              <p>No payment has been recorded.</p>
            ) : null}
          </section>

          <section className="order-detail-section" aria-labelledby="order-refund-title">
            <h2 id="order-refund-title">Refund request</h2>
            {order.refundRequest ? (
              <>
                <p><span className="refund-badge">Refund request pending</span></p>
                <p className="order-reason">{order.refundRequest.reason}</p>
                <p className="meta-text">
                  {new Date(order.refundRequest.createdAt).toLocaleString()}
                  {refundActor ? ` · ${refundActor}` : ''}
                </p>
                <p>Manual refunds require confirmation of an external return in a later step. Money has not been returned.</p>
              </>
            ) : (
              <p>No refund request is open. Manual refunds require confirmation of an external return in a later step.</p>
            )}
          </section>

          <section className="order-detail-section" aria-labelledby="order-history-title">
            <h2 id="order-history-title">History</h2>
            <ol className="order-history">
              {order.history.map((event) => (
                <HistoryEntry key={`${event.action}-${event.createdAt}-${event.source}-${event.contractVersion}`} event={event} />
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </div>
  );
}
