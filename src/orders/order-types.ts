export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'canceled';

export type OrderCommandAction = 'complete' | 'cancel' | 'request_refund' | 'mark_paid' | 'fulfill';

export type OrderHistoryAction =
  | 'order_created'
  | 'order_completed'
  | 'order_cancelled'
  | 'order_paid'
  | 'order_fulfilled'
  | 'order_canceled'
  | 'refund_requested';

export type OrderAuditSource = 'console' | 'customer_capability' | 'bootstrap_owner' | 'storefront' | 'user' | 'system';

export type OrderActorSource = 'bootstrap_owner' | 'storefront' | 'user' | 'system';

export interface OrderActor {
  source: OrderActorSource;
  id: string | null;
}

export interface OrderContext {
  storeId: string;
  actor: OrderActor;
}

export type PaymentSource = 'manual';

export type PaymentLedgerStatus = 'succeeded';

export type PaymentRecordState = 'none' | 'recorded' | 'legacy_unrecorded';

export interface PaymentLedgerProjection {
  id: string;
  source: PaymentSource;
  method: string;
  externalReference: string;
  amountMinor: number;
  currency: string;
  status: PaymentLedgerStatus;
  recordedAt: string;
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

export interface RefundRequestProjection {
  id: string;
  status: 'pending';
  reason: string;
  createdAt: string;
}

export interface OrderCommandResult {
  reference: string;
  action: OrderCommandAction;
  status: OrderStatus;
  occurredAt: string;
  paymentId: string | null;
  refundRequest: RefundRequestProjection | null;
}

export interface OrderFieldError {
  path: string;
  code: string;
  message: string;
}

export class OrderValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fields: OrderFieldError[] = [],
    readonly status = 422,
  ) {
    super(message);
    this.name = 'OrderValidationError';
  }
}

export class OrderPersistenceError extends Error {
  readonly code = 'order_persistence_failed';
  readonly status = 500;

  constructor(cause: unknown) {
    super('The Order could not be saved.', { cause });
    this.name = 'OrderPersistenceError';
  }
}

export interface OrderSelectedOption {
  groupId: string;
  groupName: string;
  valueId: string;
  valueLabel: string;
}

export interface ValidatedOrderCreateItem {
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface ValidatedOrderCreateInput {
  customerName: string;
  customerEmailNormalized: string;
  items: ValidatedOrderCreateItem[];
  idempotencyKey: string;
  capability: string;
}

export interface OrderProductProjection {
  id: string;
  name: string;
  variant: null | {
    id: string;
    sku: string;
    selectedOptions: OrderSelectedOption[];
  };
}

export interface OrderItemProjection {
  id: string;
  position: number;
  product: OrderProductProjection;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: string;
}

export interface OrderProjection {
  reference: string;
  paymentReference: string;
  status: OrderStatus;
  items: OrderItemProjection[];
  totalMinor: number;
  currency: string;
  createdAt: string;
}

export interface CustomerOrderProjection extends OrderProjection {
  refundRequest: RefundRequestProjection | null;
}

export interface ConsoleOrderProjection extends OrderProjection {
  customer: {
    name: string;
    email: string;
  };
  refundRequestStatus: 'pending' | null;
}

export interface ConsoleOrderHistoryEntry {
  action: OrderHistoryAction;
  source: OrderAuditSource;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  createdAt: string;
}

export interface ConsoleOrderDetailProjection extends ConsoleOrderProjection {
  refundRequest: RefundRequestProjection | null;
  allowedActions: Array<'complete' | 'cancel' | 'mark_paid' | 'fulfill' | 'request_refund'>;
  history: ConsoleOrderHistoryEntry[];
}

export interface ConsoleOrderListQuery {
  q: string;
  status: OrderStatus | null;
  refund: 'pending' | null;
  limit: number;
  cursor: string | null;
}

export interface ConsoleOrderListResponse {
  orders: ConsoleOrderProjection[];
  nextCursor: string | null;
  hasOrders: boolean;
}
