export type OrderStatus = 'pending_payment' | 'completed' | 'cancelled';
export type OrderCommandAction = 'complete' | 'cancel' | 'request_refund';
export type OrderHistoryAction = 'order_created' | 'order_completed' | 'order_cancelled' | 'refund_requested';
export type OrderAuditSource = 'console' | 'customer_capability';
export type OrderStatusFilter = 'all' | OrderStatus;

export interface ConsoleOrderView {
  reference: string;
  status: OrderStatus;
  product: {
    id: string;
    name: string;
    variant: null | {
      id: string;
      sku: string;
      selectedOptions: Array<{
        groupId: string;
        groupName: string;
        valueId: string;
        valueLabel: string;
      }>;
    };
  };
  customer: { name: string; email: string };
  quantity: number;
  unitPriceMinor: number;
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
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  createdAt: string;
}

export interface ConsoleOrderDetailView extends ConsoleOrderView {
  refundRequest: ConsoleOrderRefundRequestView | null;
  allowedActions: Array<'complete' | 'cancel'>;
  history: ConsoleOrderHistoryView[];
}

export interface ConsoleOrderListQuery {
  q: string;
  status: OrderStatus | null;
  refund: 'pending' | null;
  limit: number;
  cursor: string | null;
}

export interface ConsoleOrderListResponse {
  orders: ConsoleOrderView[];
  nextCursor: string | null;
  hasOrders: boolean;
}

export interface OrderCommandResultView {
  reference: string;
  action: OrderCommandAction;
  status: 'completed' | 'cancelled';
  occurredAt: string;
  refundRequest: ConsoleOrderRefundRequestView | null;
}

export type ConsoleOrdersState = 'loading' | 'ready' | 'empty' | 'no-results' | 'error';
export type ConsoleOrderDetailState = 'loading' | 'ready' | 'not-found' | 'error';
