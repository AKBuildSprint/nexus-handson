export type {
  ConsoleOrderAction,
  ConsoleOrderDetailProjection as ConsoleOrderDetailView,
  ConsoleOrderListQuery as ConsoleOrderListCriteria,
  ConsoleOrderProjection as ConsoleOrderView,
  OrderCommandResult as ConsoleOrderCommandResult,
  OrderHistoryEntry,
  OrderRefundRequest,
  OrderStatus,
} from '@nexus/orders/order-types';

import type {
  ConsoleOrderAction,
  ConsoleOrderDetailProjection,
  ConsoleOrderListQuery,
  ConsoleOrderProjection,
  OrderCommandResult,
  OrderStatus,
} from '@nexus/orders/order-types';

export interface ConsoleOrderListResponse {
  orders: ConsoleOrderProjection[];
  nextCursor: string | null;
  hasAnyOrders: boolean;
}

export interface ConsoleOrderActionResponse {
  order: ConsoleOrderDetailProjection;
  command: OrderCommandResult;
}

export type ConsoleOrdersState = 'loading' | 'ready' | 'empty' | 'no-match' | 'error';
export type ConsoleOrderDetailState = 'loading' | 'ready' | 'error';

export const EMPTY_ORDER_CRITERIA: ConsoleOrderListQuery = {
  q: '',
  status: 'all',
  refund: 'all',
  cursor: null,
};

export function orderCriteriaEqual(left: ConsoleOrderListQuery, right: ConsoleOrderListQuery): boolean {
  return left.q === right.q
    && left.status === right.status
    && left.refund === right.refund
    && left.cursor === right.cursor;
}
export function orderStatusLabel(status: OrderStatus): string {
  if (status === 'pending_payment') return 'Pending payment';
  if (status === 'paid') return 'Paid';
  if (status === 'fulfilled') return 'Fulfilled';
  return 'Cancelled';
}

export function orderActionLabel(action: ConsoleOrderAction): string {
  if (action === 'mark_paid') return 'Mark paid';
  if (action === 'mark_fulfilled') return 'Mark fulfilled';
  return 'Cancel';
}

export function isRetryableOrderError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    return error.status >= 500;
  }
  return true;
}
