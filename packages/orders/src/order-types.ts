export type OrderStatus = 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled';

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

export interface ValidatedOrderCreateInput {
  customerName: string;
  customerEmailNormalized: string;
  productId: string;
  variantId: string | null;
  quantity: number;
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
export interface OrderPurchaseProjection {
  reference: string;
  status: OrderStatus;
  product: OrderProductProjection;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: string;
}

export interface OrderRefundRequest {
  id: string;
  reason: string;
  status: 'pending';
  createdAt: string;
}

export interface OrderHistoryEntry {
  sequence: number;
  action: 'order_created' | 'mark_paid' | 'mark_fulfilled' | 'cancel' | 'refund_requested';
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  source: 'storefront' | 'console';
  refundRequestId: string | null;
  createdAt: string;
}

export type ConsoleOrderAction = 'mark_paid' | 'mark_fulfilled' | 'cancel';

export interface CustomerOrderProjection extends OrderPurchaseProjection {
  refundRequest: OrderRefundRequest | null;
}

export interface ConsoleOrderProjection extends OrderPurchaseProjection {
  customer: {
    name: string;
    email: string;
  };
  hasPendingRefund: boolean;
}

export interface ConsoleOrderDetailProjection extends OrderPurchaseProjection {
  customer: {
    name: string;
    email: string;
  };
  history: OrderHistoryEntry[];
  refundRequest: OrderRefundRequest | null;
  allowedActions: ConsoleOrderAction[];
}

export interface OrderCommandResult {
  outcome: 'applied' | 'already_applied';
  replayed: boolean;
  resultStatus: OrderStatus;
}

export interface ConsoleOrderListQuery {
  q: string;
  status: 'all' | OrderStatus;
  refund: 'all' | 'pending';
  cursor: string | null;
}
