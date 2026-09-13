export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'canceled';
export type OrderCommandAction =
  | 'assign' | 'cancel' | 'request_refund' | 'approve_refund' | 'reject_refund' | 'mark_paid' | 'fulfill';
export type OrderHistoryAction =
  | 'order_created'
  | 'order_completed'
  | 'order_cancelled'
  | 'order_paid'
  | 'order_fulfilled'
  | 'order_canceled'
  | 'refund_requested'
  | 'refund_approved'
  | 'refund_rejected'
  | 'assigned';
export type OrderAuditSource = 'console' | 'customer_capability' | 'bootstrap_owner' | 'storefront' | 'user' | 'system';
export type OrderStatusFilter = 'all' | OrderStatus;
export type PaymentRecordState = 'none' | 'recorded' | 'legacy_unrecorded';

export interface OrderSelectedOptionView {
  groupId: string;
  groupName: string;
  valueId: string;
  valueLabel: string;
}

export interface OrderProductView {
  id: string;
  name: string;
  variant: null | {
    id: string;
    sku: string;
    selectedOptions: OrderSelectedOptionView[];
  };
}

export interface OrderItemView {
  id: string;
  position: number;
  product: OrderProductView;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: string;
}

export interface ConsoleOrderView {
  reference: string;
  paymentReference: string;
  status: OrderStatus;
  items: OrderItemView[];
  customer: { name: string; email: string };
  totalMinor: number;
  currency: string;
  createdAt: string;
  refundRequestStatus: 'pending' | 'approved' | 'rejected' | null;
}

export interface RefundRequestView {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface ConsoleOrderRefundRequestView extends RefundRequestView {
  decidedByUserId: string | null;
}

export interface ConsoleOrderHistoryView {
  action: OrderHistoryAction;
  source: OrderAuditSource;
  actorId: string | null;
  actorLabel: string;
  contractVersion: 1 | 2;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  createdAt: string;
}

export interface PaymentLedgerView {
  id: string;
  source: 'manual';
  method: string;
  externalReference: string;
  amountMinor: number;
  currency: string;
  status: 'succeeded';
  recordedAt: string;
}

export interface ConsoleOrderDetailView extends ConsoleOrderView {
  assignment?: { assigneeUserId: string } | null;
  refundRequest: ConsoleOrderRefundRequestView | null;
  allowedActions: Array<
    'cancel' | 'mark_paid' | 'fulfill' | 'request_refund' | 'approve_refund' | 'reject_refund'
  >;
  history: ConsoleOrderHistoryView[];
  payment: PaymentLedgerView | null;
  paymentRecordState: PaymentRecordState;
}

export interface ConsoleOrderListQuery {
  q: string;
  status: OrderStatus | null;
  refund: 'pending' | null;
  limit: number;
  cursor: string | null;
}

export interface ConsoleOrderSummary {
  totalOrders: number;
  byStatus: {
    pending: number;
    paid: number;
    fulfilled: number;
    canceled: number;
  };
  openRefundRequests: number;
}

export interface ConsoleOrderListResponse {
  orders: ConsoleOrderView[];
  summary: ConsoleOrderSummary;
  nextCursor: string | null;
  hasOrders: boolean;
}

interface OrderCommandResultBaseView {
  reference: string;
  status: OrderStatus;
  occurredAt: string;
}

export interface OrderTransitionCommandResultView extends OrderCommandResultBaseView {
  action: Exclude<OrderCommandAction, 'assign'>;
  paymentId: string | null;
  refundRequest: RefundRequestView | null;
}

export interface OrderAssignmentCommandResultView extends OrderCommandResultBaseView {
  action: 'assign';
  paymentId: null;
  refundRequest: null;
  assignment: { assigneeUserId: string; eventId: string };
}

export type OrderCommandResultView = OrderTransitionCommandResultView | OrderAssignmentCommandResultView;

export interface StaffCandidateView {
  userId: string;
  name: string;
}

export type ConsoleOrdersState = 'loading' | 'ready' | 'empty' | 'no-results' | 'error';
export type ConsoleOrderDetailState = 'loading' | 'ready' | 'not-found' | 'error';
