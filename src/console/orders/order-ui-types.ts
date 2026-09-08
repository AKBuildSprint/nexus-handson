export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'canceled';
export type OrderCommandAction = 'cancel' | 'request_refund' | 'mark_paid' | 'fulfill';
export type OrderHistoryAction =
  | 'order_created'
  | 'order_completed'
  | 'order_cancelled'
  | 'order_paid'
  | 'order_fulfilled'
  | 'order_canceled'
  | 'refund_requested';
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
  refundRequestStatus: 'pending' | null;
}

export interface ConsoleOrderRefundRequestView {
  id: string;
  status: 'pending';
  reason: string;
  createdAt: string;
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
  refundRequest: ConsoleOrderRefundRequestView | null;
  allowedActions: Array<'cancel' | 'mark_paid' | 'fulfill' | 'request_refund'>;
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

export interface OrderCommandResultView {
  reference: string;
  action: OrderCommandAction;
  status: OrderStatus;
  occurredAt: string;
  paymentId: string | null;
  refundRequest: ConsoleOrderRefundRequestView | null;
}

export type ConsoleOrdersState = 'loading' | 'ready' | 'empty' | 'no-results' | 'error';
export type ConsoleOrderDetailState = 'loading' | 'ready' | 'not-found' | 'error';
