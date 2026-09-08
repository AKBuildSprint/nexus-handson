import type {
  ConsoleOrderDetailProjection,
  ConsoleOrderHistoryEntry,
  ConsoleOrderListQuery,
  ConsoleOrderListResponse,
  ConsoleOrderProjection,
  ConsoleOrderSummary,
  CustomerOrderProjection,
  OrderContext,
  OrderItemProjection,
  OrderSelectedOption,
  OrderStatus,
  PaymentLedgerProjection,
  PaymentRecordState,
  RefundRequestProjection,
} from './order-types';
import { OrderValidationError } from './order-types';

interface OrderHeaderRow {
  id: string;
  reference: string;
  payment_reference: string;
  status: OrderStatus;
  customer_name: string;
  customer_email_normalized: string;
  total_minor: number;
  currency: string;
  created_at: string;
  refund_status?: 'pending' | null;
}

interface OrderLineRow {
  id: string;
  order_id: string;
  position: number;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_sku: string | null;
  selected_options_json: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  currency: string;
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
  actor_id: string | null;
  contract_version: 1 | 2;
  from_status: OrderStatus | null;
  status: OrderStatus;
  created_at: string;
}

interface PaymentRow {
  id: string;
  source: 'manual';
  method: string;
  external_reference: string;
  amount_minor: number;
  currency: string;
  status: 'succeeded';
  recorded_at: string;
}

interface SummaryRow {
  total_orders: number;
  pending: number;
  paid: number;
  fulfilled: number;
  canceled: number;
  open_refund_requests: number;
}

const ORDER_STATUS: Record<OrderStatus, true> = {
  pending: true,
  paid: true,
  fulfilled: true,
  canceled: true,
};

const HEADER_SELECT = `SELECT orders.id, orders.reference, orders.payment_reference, orders.status,
       orders.customer_name, orders.customer_email_normalized,
       orders.total_minor, orders.currency, orders.created_at
  FROM orders`;

const LINE_SELECT = `SELECT order_lines.id, order_lines.order_id, order_lines.position, order_lines.product_id,
       order_lines.product_name, order_lines.variant_id, order_lines.variant_sku,
       order_lines.selected_options_json, order_lines.quantity, order_lines.unit_price_minor,
       order_lines.line_total_minor, order_lines.currency
  FROM order_lines`;

const EMPTY_SUMMARY: ConsoleOrderSummary = {
  totalOrders: 0,
  byStatus: { pending: 0, paid: 0, fulfilled: 0, canceled: 0 },
  openRefundRequests: 0,
};

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

function itemProjection(row: OrderLineRow): OrderItemProjection {
  const options = selectedOptions(JSON.parse(row.selected_options_json) as unknown);
  return {
    id: row.id,
    position: row.position,
    product: {
      id: row.product_id,
      name: row.product_name,
      variant: row.variant_id === null ? null : {
        id: row.variant_id,
        sku: row.variant_sku as string,
        selectedOptions: options,
      },
    },
    quantity: row.quantity,
    unitPriceMinor: row.unit_price_minor,
    lineTotalMinor: row.line_total_minor,
    currency: row.currency,
  };
}

function orderFields(header: OrderHeaderRow, items: OrderItemProjection[]) {
  return {
    reference: header.reference,
    paymentReference: header.payment_reference,
    status: header.status,
    items,
    totalMinor: header.total_minor,
    currency: header.currency,
    createdAt: header.created_at,
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

function historyActorLabel(source: ConsoleOrderHistoryEntry['source']): string {
  if (source === 'bootstrap_owner' || source === 'console') return 'Bootstrap Owner (demo)';
  if (source === 'storefront' || source === 'customer_capability') return 'Customer';
  return '';
}

function paymentFromRow(row: PaymentRow | undefined): PaymentLedgerProjection | null {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    method: row.method,
    externalReference: row.external_reference,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status,
    recordedAt: row.recorded_at,
  };
}

function paymentRecordState(
  status: OrderStatus,
  payment: PaymentLedgerProjection | null,
): PaymentRecordState {
  if (payment !== null) return 'recorded';
  if (status === 'paid' || status === 'fulfilled') return 'legacy_unrecorded';
  return 'none';
}

function allowedActions(
  status: OrderStatus,
  openRefund: boolean,
): ConsoleOrderDetailProjection['allowedActions'] {
  if (status === 'pending') return ['mark_paid', 'cancel'];
  if (status === 'paid') return openRefund ? ['fulfill'] : ['fulfill', 'request_refund'];
  if (status === 'fulfilled') return openRefund ? [] : ['request_refund'];
  return [];
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

function boundBasePredicate(storeId: string, query: ConsoleOrderListQuery): {
  sql: string;
  binds: Array<string | number>;
} {
  const conditions = ['orders.store_id = ?'];
  const binds: Array<string | number> = [storeId];
  if (query.q !== '') {
    const customerQ = query.q.normalize('NFKC');
    conditions.push(`(
      instr(lower(orders.reference), lower(?)) > 0
      OR instr(lower(orders.payment_reference), lower(?)) > 0
      OR instr(lower(orders.customer_name), lower(?)) > 0
      OR instr(lower(orders.customer_email_normalized), lower(?)) > 0
      OR EXISTS (
        SELECT 1 FROM payments
         WHERE payments.store_id = orders.store_id
           AND payments.order_id = orders.id
           AND payments.status = 'succeeded'
           AND instr(lower(payments.external_reference), lower(?)) > 0
      )
    )`);
    binds.push(query.q, query.q, customerQ, customerQ, query.q);
  }
  if (query.status !== null) {
    conditions.push('orders.status = ?');
    binds.push(query.status);
  }
  if (query.refund !== null) {
    conditions.push(`EXISTS (
      SELECT 1 FROM order_refund_requests
       WHERE order_refund_requests.store_id = orders.store_id
         AND order_refund_requests.order_id = orders.id
         AND order_refund_requests.status = ?
    )`);
    binds.push(query.refund);
  }
  return { sql: conditions.join(' AND '), binds };
}

function pageSelectSql(whereSql: string, seek: boolean): string {
  const seekSql = seek
    ? ` AND (orders.created_at < ? OR (orders.created_at = ? AND orders.id < ?))`
    : '';
  return `SELECT orders.id, orders.reference, orders.payment_reference, orders.status,
       orders.customer_name, orders.customer_email_normalized,
       orders.total_minor, orders.currency, orders.created_at,
       (
         SELECT order_refund_requests.status
           FROM order_refund_requests
          WHERE order_refund_requests.store_id = orders.store_id
            AND order_refund_requests.order_id = orders.id
            AND order_refund_requests.status = 'pending'
          LIMIT 1
       ) AS refund_status
  FROM orders
 WHERE ${whereSql}${seekSql}
 ORDER BY orders.created_at DESC, orders.id DESC
 LIMIT ?`;
}

function summaryFromRow(row: SummaryRow | undefined): ConsoleOrderSummary {
  if (!row) return EMPTY_SUMMARY;
  return {
    totalOrders: Number(row.total_orders),
    byStatus: {
      pending: Number(row.pending),
      paid: Number(row.paid),
      fulfilled: Number(row.fulfilled),
      canceled: Number(row.canceled),
    },
    openRefundRequests: Number(row.open_refund_requests),
  };
}

export async function readCustomerOrderById(input: {
  database: D1Database;
  storeId: string;
  orderId: string;
}): Promise<CustomerOrderProjection | null> {
  const [orderResult, lineResult, refundResult] = await input.database.batch([
    input.database.prepare(`${HEADER_SELECT} WHERE orders.store_id = ? AND orders.id = ?`)
      .bind(input.storeId, input.orderId),
    input.database.prepare(
      `${LINE_SELECT} WHERE order_lines.store_id = ? AND order_lines.order_id = ?
        ORDER BY order_lines.position ASC, order_lines.id ASC`,
    ).bind(input.storeId, input.orderId),
    input.database.prepare(
      `SELECT id, status, reason, created_at FROM order_refund_requests WHERE store_id = ? AND order_id = ?`,
    ).bind(input.storeId, input.orderId),
  ]);
  const header = orderResult.results[0] as OrderHeaderRow | undefined;
  const lines = lineResult.results as OrderLineRow[];
  if (!header || lines.length === 0) return null;
  return {
    ...orderFields(header, lines.map(itemProjection)),
    refundRequest: refundFromRow(refundResult.results[0] as RefundRow | undefined),
  };
}

export async function readConsoleOrderByReference(
  database: D1Database,
  context: OrderContext,
  reference: string,
): Promise<ConsoleOrderDetailProjection | null> {
  const storeId = context.storeId;
  const [orderResult, lineResult, refundResult, historyResult, paymentResult] = await database.batch([
    database.prepare(`${HEADER_SELECT} WHERE orders.store_id = ? AND orders.reference = ?`)
      .bind(storeId, reference),
    database.prepare(
      `${LINE_SELECT}
         JOIN orders ON orders.id = order_lines.order_id AND orders.store_id = order_lines.store_id
        WHERE orders.store_id = ? AND orders.reference = ?
        ORDER BY order_lines.position ASC, order_lines.id ASC`,
    ).bind(storeId, reference),
    database.prepare(
      `SELECT order_refund_requests.id, order_refund_requests.status, order_refund_requests.reason,
              order_refund_requests.created_at
         FROM order_refund_requests
         JOIN orders
           ON orders.id = order_refund_requests.order_id AND orders.store_id = order_refund_requests.store_id
        WHERE orders.store_id = ? AND orders.reference = ?`,
    ).bind(storeId, reference),
    database.prepare(
      `SELECT order_history.action, order_history.source, order_history.actor_id,
              order_history.contract_version, order_history.from_status, order_history.status,
              order_history.created_at
         FROM order_history
         JOIN orders
           ON orders.id = order_history.order_id AND orders.store_id = order_history.store_id
        WHERE orders.store_id = ? AND orders.reference = ?
        ORDER BY order_history.created_at ASC,
                 CASE order_history.action
                   WHEN 'order_created' THEN 0
                   WHEN 'order_completed' THEN 1
                   WHEN 'order_paid' THEN 1
                   WHEN 'order_cancelled' THEN 1
                   WHEN 'order_canceled' THEN 1
                   WHEN 'order_fulfilled' THEN 2
                   WHEN 'refund_requested' THEN 3
                   ELSE 4
                 END ASC,
                 order_history.id ASC`,
    ).bind(storeId, reference),
    database.prepare(
      `SELECT payments.id, payments.source, payments.method, payments.external_reference,
              payments.amount_minor, payments.currency, payments.status, payments.recorded_at
         FROM payments
         JOIN orders
           ON orders.id = payments.order_id AND orders.store_id = payments.store_id
         JOIN order_history
           ON order_history.id = payments.history_id
          AND order_history.order_id = payments.order_id
          AND order_history.store_id = payments.store_id
        WHERE orders.store_id = ? AND orders.reference = ?`,
    ).bind(storeId, reference),
  ]);
  const header = orderResult.results[0] as OrderHeaderRow | undefined;
  const lines = lineResult.results as OrderLineRow[];
  if (!header || lines.length === 0) return null;
  const refund = refundFromRow(refundResult.results[0] as RefundRow | undefined);
  const payment = paymentFromRow(paymentResult.results[0] as PaymentRow | undefined);
  return {
    ...orderFields(header, lines.map(itemProjection)),
    customer: {
      name: header.customer_name,
      email: header.customer_email_normalized,
    },
    refundRequestStatus: refund ? 'pending' : null,
    refundRequest: refund,
    allowedActions: allowedActions(header.status, refund !== null),
    payment,
    paymentRecordState: paymentRecordState(header.status, payment),
    history: (historyResult.results as HistoryRow[]).map((event) => ({
      action: event.action,
      source: event.source,
      actorId: event.actor_id,
      actorLabel: event.action === 'order_completed'
        ? 'Legacy completion (payment confirmed; fulfillment not recorded)'
        : historyActorLabel(event.source),
      contractVersion: event.contract_version,
      fromStatus: event.from_status,
      toStatus: event.status,
      createdAt: event.created_at,
    })),
  };
}

export async function listConsoleOrders(
  database: D1Database,
  context: OrderContext,
  query: ConsoleOrderListQuery,
): Promise<ConsoleOrderListResponse> {
  const seek = query.cursor === null ? null : decodeCursor(query.cursor, query);
  const base = boundBasePredicate(context.storeId, query);
  const pageSql = pageSelectSql(base.sql, seek !== null);
  const pageBinds: Array<string | number> = seek === null
    ? [...base.binds, query.limit + 1]
    : [...base.binds, seek.createdAt, seek.createdAt, seek.id, query.limit + 1];
  const itemSql = `WITH page AS (${pageSql})
${LINE_SELECT}
  JOIN page ON page.id = order_lines.order_id
 WHERE order_lines.store_id = ?
 ORDER BY order_lines.position ASC, order_lines.id ASC`;

  const [listResult, itemResult, summaryResult, hasResult] = await database.batch([
    database.prepare(pageSql).bind(...pageBinds),
    database.prepare(itemSql).bind(...pageBinds, context.storeId),
    database.prepare(
      `SELECT COUNT(*) AS total_orders,
              COALESCE(SUM(CASE WHEN orders.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN orders.status = 'paid' THEN 1 ELSE 0 END), 0) AS paid,
              COALESCE(SUM(CASE WHEN orders.status = 'fulfilled' THEN 1 ELSE 0 END), 0) AS fulfilled,
              COALESCE(SUM(CASE WHEN orders.status = 'canceled' THEN 1 ELSE 0 END), 0) AS canceled,
              COALESCE(SUM(CASE WHEN EXISTS (
                SELECT 1 FROM order_refund_requests
                 WHERE order_refund_requests.store_id = orders.store_id
                   AND order_refund_requests.order_id = orders.id
                   AND order_refund_requests.status = 'pending'
              ) THEN 1 ELSE 0 END), 0) AS open_refund_requests
         FROM orders
        WHERE ${base.sql}`,
    ).bind(...base.binds),
    database.prepare('SELECT EXISTS(SELECT 1 FROM orders WHERE store_id = ?) AS has_orders')
      .bind(context.storeId),
  ]);

  const rows = listResult.results as OrderHeaderRow[];
  const page = rows.slice(0, query.limit);
  const pageIds = new Set(page.map((row) => row.id));
  const itemsByOrder = new Map<string, OrderItemProjection[]>();
  for (const line of itemResult.results as OrderLineRow[]) {
    if (!pageIds.has(line.order_id)) continue;
    const items = itemsByOrder.get(line.order_id) ?? [];
    items.push(itemProjection(line));
    itemsByOrder.set(line.order_id, items);
  }
  const last = page[page.length - 1];
  return {
    orders: page.map((row): ConsoleOrderProjection => ({
      ...orderFields(row, itemsByOrder.get(row.id) ?? []),
      customer: {
        name: row.customer_name,
        email: row.customer_email_normalized,
      },
      refundRequestStatus: row.refund_status ?? null,
    })),
    summary: summaryFromRow(summaryResult.results[0] as SummaryRow | undefined),
    nextCursor: rows.length > query.limit && last
      ? encodeCursor([last.created_at, last.id, query.q, query.status, query.refund, query.limit])
      : null,
    hasOrders: Number((hasResult.results[0] as { has_orders: number } | undefined)?.has_orders) === 1,
  };
}
