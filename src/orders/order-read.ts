import { BOOTSTRAP_STORE_ID } from '../catalog/catalog-read';
import type {
  ConsoleOrderDetailProjection,
  ConsoleOrderHistoryEntry,
  ConsoleOrderListQuery,
  ConsoleOrderListResponse,
  ConsoleOrderProjection,
  CustomerOrderProjection,
  OrderProductProjection,
  OrderSelectedOption,
  OrderStatus,
  RefundRequestProjection,
} from './order-types';
import { OrderValidationError } from './order-types';

interface OrderProjectionRow {
  id: string;
  reference: string;
  status: OrderStatus;
  customer_name: string;
  customer_email_normalized: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_sku: string | null;
  selected_options_json: string;
  quantity: number;
  unit_price_minor: number;
  total_minor: number;
  currency: string;
  created_at: string;
  refund_id?: string | null;
  refund_status?: 'pending' | null;
}

interface RefundRow {
  id: string;
  status: 'pending';
  reason: string;
  created_at: string;
}

interface HistoryRow {
  action: ConsoleOrderHistoryEntry['action'];
  source: ConsoleOrderHistoryEntry['source'];
  from_status: OrderStatus | null;
  status: OrderStatus;
  created_at: string;
}

const ORDER_STATUS: Record<OrderStatus, true> = {
  pending_payment: true,
  completed: true,
  cancelled: true,
};

const PROJECTION_SELECT = `SELECT orders.id, orders.reference, orders.status,
       orders.customer_name, orders.customer_email_normalized,
       order_lines.product_id, order_lines.product_name, order_lines.variant_id, order_lines.variant_sku,
       order_lines.selected_options_json, order_lines.quantity, order_lines.unit_price_minor,
       orders.total_minor, orders.currency, orders.created_at
  FROM orders
  JOIN order_lines ON order_lines.order_id = orders.id AND order_lines.store_id = orders.store_id`;

const LIST_SELECT = `SELECT orders.id, orders.reference, orders.status,
       orders.customer_name, orders.customer_email_normalized,
       order_lines.product_id, order_lines.product_name, order_lines.variant_id, order_lines.variant_sku,
       order_lines.selected_options_json, order_lines.quantity, order_lines.unit_price_minor,
       orders.total_minor, orders.currency, orders.created_at,
       order_refund_requests.id AS refund_id,
       order_refund_requests.status AS refund_status
  FROM orders
  JOIN order_lines ON order_lines.order_id = orders.id AND order_lines.store_id = orders.store_id
  LEFT JOIN order_refund_requests
    ON order_refund_requests.order_id = orders.id AND order_refund_requests.store_id = orders.store_id`;

function selectedOptions(parsed: unknown): OrderSelectedOption[] {
  if (!Array.isArray(parsed)) throw new Error('The persisted Order selection is invalid.');
  return parsed.map((option) => {
    if (typeof option !== 'object' || option === null) {
      throw new Error('The persisted Order selection is invalid.');
    }
    const record = option as Record<string, unknown>;
    if (
      typeof record.groupId !== 'string'
      || typeof record.groupName !== 'string'
      || typeof record.valueId !== 'string'
      || typeof record.valueLabel !== 'string'
    ) {
      throw new Error('The persisted Order selection is invalid.');
    }
    return {
      groupId: record.groupId,
      groupName: record.groupName,
      valueId: record.valueId,
      valueLabel: record.valueLabel,
    };
  });
}

function productProjection(row: OrderProjectionRow): OrderProductProjection {
  const options = selectedOptions(JSON.parse(row.selected_options_json) as unknown);
  return {
    id: row.product_id,
    name: row.product_name,
    variant: row.variant_id === null ? null : {
      id: row.variant_id,
      sku: row.variant_sku as string,
      selectedOptions: options,
    },
  };
}

function orderFields(row: OrderProjectionRow) {
  return {
    reference: row.reference,
    status: row.status,
    product: productProjection(row),
    quantity: row.quantity,
    unitPriceMinor: row.unit_price_minor,
    totalMinor: row.total_minor,
    currency: row.currency,
    createdAt: row.created_at,
  };
}

function refundFromRow(row: RefundRow | undefined): RefundRequestProjection | null {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function encodeCursor(tuple: [string, string, string, OrderStatus | null, 'pending' | null, number]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(tuple));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(
  cursor: string,
  query: ConsoleOrderListQuery,
): { createdAt: string; id: string } {
  let json: string;
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (cursor.length % 4)) % 4);
    const binary = atob(padded);
    json = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }
  if (!Array.isArray(parsed) || parsed.length !== 6) {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }
  const [createdAt, id, q, status, refund, limit] = parsed as unknown[];
  if (typeof createdAt !== 'string' || typeof id !== 'string' || typeof q !== 'string') {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }
  if (status !== null && (typeof status !== 'string' || ORDER_STATUS[status as OrderStatus] !== true)) {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }
  if (refund !== null && refund !== 'pending') {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }
  if (q !== query.q || status !== query.status || refund !== query.refund || limit !== query.limit) {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }
  return { createdAt, id };
}

function consoleListProjection(row: OrderProjectionRow): ConsoleOrderProjection {
  return {
    ...orderFields(row),
    customer: {
      name: row.customer_name,
      email: row.customer_email_normalized,
    },
    refundRequestStatus: row.refund_status ?? null,
  };
}

export async function readCustomerOrderById(
  database: D1Database,
  orderId: string,
): Promise<CustomerOrderProjection | null> {
  const [orderResult, refundResult] = await database.batch([
    database.prepare(`${PROJECTION_SELECT} WHERE orders.store_id = ? AND orders.id = ?`)
      .bind(BOOTSTRAP_STORE_ID, orderId),
    database.prepare(
      `SELECT id, status, reason, created_at FROM order_refund_requests WHERE store_id = ? AND order_id = ?`,
    ).bind(BOOTSTRAP_STORE_ID, orderId),
  ]);
  const row = orderResult.results[0] as OrderProjectionRow | undefined;
  if (!row) return null;
  return {
    ...orderFields(row),
    refundRequest: refundFromRow(refundResult.results[0] as RefundRow | undefined),
  };
}

export async function readConsoleOrderByReference(
  database: D1Database,
  reference: string,
): Promise<ConsoleOrderDetailProjection | null> {
  const [orderResult, refundResult, historyResult] = await database.batch([
    database.prepare(`${PROJECTION_SELECT} WHERE orders.store_id = ? AND orders.reference = ?`)
      .bind(BOOTSTRAP_STORE_ID, reference),
    database.prepare(
      `SELECT order_refund_requests.id, order_refund_requests.status, order_refund_requests.reason,
              order_refund_requests.created_at
         FROM order_refund_requests
         JOIN orders
           ON orders.id = order_refund_requests.order_id AND orders.store_id = order_refund_requests.store_id
        WHERE orders.store_id = ? AND orders.reference = ?`,
    ).bind(BOOTSTRAP_STORE_ID, reference),
    database.prepare(
      `SELECT order_history.action, order_history.source, order_history.from_status, order_history.status,
              order_history.created_at
         FROM order_history
         JOIN orders
           ON orders.id = order_history.order_id AND orders.store_id = order_history.store_id
        WHERE orders.store_id = ? AND orders.reference = ?
        ORDER BY order_history.created_at ASC,
                 CASE order_history.action
                   WHEN 'order_created' THEN 0
                   WHEN 'order_completed' THEN 1
                   WHEN 'order_cancelled' THEN 1
                   WHEN 'refund_requested' THEN 2
                   ELSE 3
                 END ASC,
                 order_history.id ASC`,
    ).bind(BOOTSTRAP_STORE_ID, reference),
  ]);
  const row = orderResult.results[0] as OrderProjectionRow | undefined;
  if (!row) return null;
  const refund = refundFromRow(refundResult.results[0] as RefundRow | undefined);
  return {
    ...orderFields(row),
    customer: {
      name: row.customer_name,
      email: row.customer_email_normalized,
    },
    refundRequestStatus: refund ? 'pending' : null,
    refundRequest: refund,
    allowedActions: row.status === 'pending_payment' ? ['complete', 'cancel'] : [],
    history: (historyResult.results as HistoryRow[]).map((event) => ({
      action: event.action,
      source: event.source,
      fromStatus: event.from_status,
      toStatus: event.status,
      createdAt: event.created_at,
    })),
  };
}

export async function listConsoleOrders(
  database: D1Database,
  query: ConsoleOrderListQuery,
): Promise<ConsoleOrderListResponse> {
  const seek = query.cursor === null ? null : decodeCursor(query.cursor, query);
  const conditions = ['orders.store_id = ?'];
  const binds: Array<string | number> = [BOOTSTRAP_STORE_ID];

  if (query.q !== '') {
    conditions.push(`(
      instr(lower(orders.reference), lower(?)) > 0
      OR instr(lower(orders.customer_name), lower(?)) > 0
      OR instr(lower(orders.customer_email_normalized), lower(?)) > 0
    )`);
    binds.push(query.q, query.q, query.q);
  }
  if (query.status !== null) {
    conditions.push('orders.status = ?');
    binds.push(query.status);
  }
  if (query.refund !== null) {
    conditions.push('order_refund_requests.status = ?');
    binds.push(query.refund);
  }
  if (seek !== null) {
    conditions.push('(orders.created_at < ? OR (orders.created_at = ? AND orders.id < ?))');
    binds.push(seek.createdAt, seek.createdAt, seek.id);
  }

  const [listResult, hasResult] = await database.batch([
    database.prepare(
      `${LIST_SELECT}
 WHERE ${conditions.join(' AND ')}
 ORDER BY orders.created_at DESC, orders.id DESC
 LIMIT ?`,
    ).bind(...binds, query.limit + 1),
    database.prepare('SELECT EXISTS(SELECT 1 FROM orders WHERE store_id = ?) AS has_orders')
      .bind(BOOTSTRAP_STORE_ID),
  ]);
  const rows = listResult.results as OrderProjectionRow[];
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    orders: page.map(consoleListProjection),
    nextCursor: rows.length > query.limit && last
      ? encodeCursor([last.created_at, last.id, query.q, query.status, query.refund, query.limit])
      : null,
    hasOrders: Number((hasResult.results[0] as { has_orders: number } | undefined)?.has_orders) === 1,
  };
}
