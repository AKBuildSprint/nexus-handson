export type OrderStatus = 'pending_payment' | 'completed' | 'cancelled';

export type OrderCommandAction = 'complete' | 'cancel' | 'request_refund';

export type OrderHistoryAction = 'order_created' | 'order_completed' | 'order_cancelled' | 'refund_requested';

export type OrderAuditSource = 'console' | 'customer_capability';

export interface RefundRequestProjection {
  id: string;
  status: 'pending';
  reason: string;
  createdAt: string;
}

export interface OrderCommandResult {
  reference: string;
  action: OrderCommandAction;
  status: 'completed' | 'cancelled';
  occurredAt: string;
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

export interface OrderProjection {
  reference: string;
  status: OrderStatus;
  product: OrderProductProjection;
  quantity: number;
  unitPriceMinor: number;
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
  allowedActions: Array<'complete' | 'cancel'>;
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
