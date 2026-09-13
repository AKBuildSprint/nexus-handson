import { evaluatePermission } from '@nexus/identity/permissions';
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
} from '../order-types';
import { OrderValidationError } from '../order-types';
import {
  consoleVisibilityBinds,
  consoleVisibilitySql,
  assertCurrentConsoleMembership,
  requirePermission,
  requireConsoleIdentity,
} from '../order-access';
import { assertCurrentConsoleOrderAccess } from '../order-access';

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
  refund_status?: RefundRequestProjection['status'] | null;
  assigned_user_id?: string | null;
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
  status: RefundRequestProjection['status'];
  reason: string;
  created_at: string;
  decided_at: string | null;
  decided_by_user_id: string | null;
}

interface HistoryRow {
  action: ConsoleOrderHistoryEntry['action'];
  source: ConsoleOrderHistoryEntry['source'];
  actor_id: string | null;
  contract_version: 1 | 2;
  from_status: OrderStatus | null;
  status: OrderStatus;
  created_at: string;
  actor_name: string | null;
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
       orders.total_minor, orders.currency, orders.created_at,
       (SELECT assignment.assignee_user_id FROM order_assignments assignment
         WHERE assignment.store_id = orders.store_id AND assignment.order_id = orders.id) AS assigned_user_id
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
    decidedAt: row.decided_at,
  };
}

function historyActorLabel(source: ConsoleOrderHistoryEntry['source'], actorName: string | null): string {
  if (source === 'bootstrap_owner' || source === 'console') return 'Bootstrap Owner (demo)';
  if (source === 'storefront' || source === 'customer_capability') return 'Customer';
  if (source === 'user') return actorName ?? 'Store user';
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
  refund: RefundRequestProjection | null,
  context: OrderContext,
  assignedUserId: string | null,
): ConsoleOrderDetailProjection['allowedActions'] {
  const candidates: ConsoleOrderDetailProjection['allowedActions'] = status === 'pending'
    ? ['mark_paid', 'cancel']
    : status === 'paid'
      ? (refund ? ['fulfill'] : ['fulfill', 'request_refund'])
      : status === 'fulfilled' && !refund
        ? ['request_refund']
        : [];
  if (refund?.status === 'pending') candidates.push('approve_refund', 'reject_refund');
  return candidates.filter((action) => evaluatePermission(
    context.identity ?? { kind: 'public' },
    action === 'request_refund'
      ? 'refund:request'
      : action === 'approve_refund' || action === 'reject_refund'
        ? 'refund:decide'
        : 'order:process',
    { storeId: context.storeId, assignedUserId },
  ));
}

function encodeCursor(tuple: [1, string, string, string, string, string, string, OrderStatus | null, 'pending' | null, number]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(tuple));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(
  cursor: string,
  query: ConsoleOrderListQuery,
  context: OrderContext,
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
  if (!Array.isArray(parsed) || parsed.length !== 10) {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }
  const [version, storeId, userId, role, createdAt, id, q, status, refund, limit] = parsed as unknown[];
  const identity = requireConsoleIdentity(context.identity);
  if (version !== 1 || storeId !== context.storeId || userId !== identity.userId || role !== identity.role) {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }
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

function boundBasePredicate(context: OrderContext, query: ConsoleOrderListQuery): {
  sql: string;
  binds: Array<string | number>;
} {
  const visibility = boundVisibilityPredicate(context);
  const conditions = [visibility.sql];
  const binds: Array<string | number> = [...visibility.binds];
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

function boundVisibilityPredicate(context: OrderContext): {
  sql: string;
  binds: Array<string | number>;
} {
  const identity = requireConsoleIdentity(context.identity);
  const membershipSql = `EXISTS (
    SELECT 1 FROM store_memberships membership
     WHERE membership.id = ? AND membership.user_id = ?
       AND membership.store_id = orders.store_id
       AND membership.role = ? AND membership.status = 'active'
  )`;
  if (identity.role === 'owner') {
    return {
      sql: `orders.store_id = ? AND ${membershipSql}`,
      binds: [context.storeId, identity.membershipId, identity.userId, identity.role],
    };
  }
  return {
    sql: `orders.store_id = ? AND ${membershipSql}
      AND orders.id IN (
        SELECT assignment.order_id FROM order_assignments assignment
         WHERE assignment.store_id = ? AND assignment.assignee_user_id = ?
      )`,
    binds: [
      context.storeId, identity.membershipId, identity.userId, identity.role,
      context.storeId, identity.userId,
    ],
  };
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

function summarySelectSql(whereSql: string): string {
  return `SELECT COUNT(*) AS total_orders,
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
     FROM orders WHERE ${whereSql}`;
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
      `SELECT id, status, reason, created_at, decided_at, decided_by_user_id
         FROM order_refund_requests WHERE store_id = ? AND order_id = ?`,
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
  const identity = requireConsoleIdentity(context.identity);
  const visible = consoleVisibilitySql('orders');
  const visibleBinds = consoleVisibilityBinds(identity);
  const [orderResult, lineResult, refundResult, historyResult, paymentResult] = await database.batch([
    database.prepare(`${HEADER_SELECT} WHERE orders.store_id = ? AND orders.reference = ? AND ${visible}`)
      .bind(storeId, reference, ...visibleBinds),
    database.prepare(
      `${LINE_SELECT}
         JOIN orders ON orders.id = order_lines.order_id AND orders.store_id = order_lines.store_id
        WHERE orders.store_id = ? AND orders.reference = ? AND ${visible}
        ORDER BY order_lines.position ASC, order_lines.id ASC`,
    ).bind(storeId, reference, ...visibleBinds),
    database.prepare(
      `SELECT order_refund_requests.id, order_refund_requests.status, order_refund_requests.reason,
              order_refund_requests.created_at, order_refund_requests.decided_at,
              order_refund_requests.decided_by_user_id
         FROM order_refund_requests
         JOIN orders
           ON orders.id = order_refund_requests.order_id AND orders.store_id = order_refund_requests.store_id
        WHERE orders.store_id = ? AND orders.reference = ? AND ${visible}`,
    ).bind(storeId, reference, ...visibleBinds),
    database.prepare(
      `SELECT order_history.action, order_history.source, order_history.actor_id,
              order_history.contract_version, order_history.from_status, order_history.status,
              order_history.created_at, actor.name AS actor_name
         FROM order_history
         JOIN orders
           ON orders.id = order_history.order_id AND orders.store_id = order_history.store_id
         LEFT JOIN "user" actor ON actor.id = order_history.actor_id
        WHERE orders.store_id = ? AND orders.reference = ? AND ${visible}
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
    ).bind(storeId, reference, ...visibleBinds),
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
        WHERE orders.store_id = ? AND orders.reference = ? AND ${visible}`,
    ).bind(storeId, reference, ...visibleBinds),
  ]);
  const header = orderResult.results[0] as OrderHeaderRow | undefined;
  const lines = lineResult.results as OrderLineRow[];
  await assertCurrentConsoleMembership(database, identity);
  if (!header || lines.length === 0) return null;
  const stillVisible = await database.prepare(
    `SELECT 1 AS visible FROM orders WHERE store_id = ? AND id = ? AND ${visible}`,
  ).bind(storeId, header.id, ...visibleBinds).first<number>('visible');
  if (stillVisible !== 1) return null;
  const refund = refundFromRow(refundResult.results[0] as RefundRow | undefined);
  const payment = paymentFromRow(paymentResult.results[0] as PaymentRow | undefined);
  return {
    ...orderFields(header, lines.map(itemProjection)),
    customer: {
      name: header.customer_name,
      email: header.customer_email_normalized,
    },
    refundRequestStatus: refund?.status ?? null,
    refundRequest: refund === null ? null : {
      ...refund,
      decidedByUserId: (refundResult.results[0] as RefundRow).decided_by_user_id,
    },
    assignment: header.assigned_user_id ? { assigneeUserId: header.assigned_user_id } : null,
    allowedActions: allowedActions(header.status, refund, context, header.assigned_user_id ?? null),
    payment,
    paymentRecordState: paymentRecordState(header.status, payment),
    history: (historyResult.results as HistoryRow[]).map((event) => ({
      action: event.action,
      source: event.source,
      actorId: event.actor_id,
      actorLabel: event.action === 'order_completed'
        ? 'Legacy completion (payment confirmed; fulfillment not recorded)'
        : historyActorLabel(event.source, event.actor_name),
      contractVersion: event.contract_version,
      fromStatus: event.from_status,
      toStatus: event.status,
      createdAt: event.created_at,
    })),
  };
}

export async function findConsoleOrderIdByReference(
  database: D1Database,
  context: OrderContext,
  reference: string,
): Promise<string | null> {
  const identity = requireConsoleIdentity(context.identity);
  const row = await database.prepare(
    `SELECT orders.id
       FROM orders
      WHERE orders.store_id = ? AND orders.reference = ?
        AND ${consoleVisibilitySql('orders')}`,
  ).bind(
    context.storeId,
    reference,
    ...consoleVisibilityBinds(identity),
  ).first<{ id: string }>();
  if (row) {
    await assertCurrentConsoleOrderAccess({ database, identity, orderId: row.id, action: 'order:read' });
  } else {
    await assertCurrentConsoleMembership(database, identity);
  }
  return row?.id ?? null;
}

export async function resolveConsoleRefundDecisionTarget(input: {
  database: D1Database;
  context: OrderContext;
  orderId: string;
  requestId: string;
}): Promise<void> {
  const identity = requireConsoleIdentity(input.context.identity);
  const row = await input.database.prepare(
    `SELECT requests.id
       FROM order_refund_requests requests
       JOIN orders ON orders.id = requests.order_id AND orders.store_id = requests.store_id
      WHERE requests.id = ? AND requests.store_id = ? AND requests.order_id = ?
        AND ${consoleVisibilitySql('orders')}`,
  ).bind(
    input.requestId,
    input.context.storeId,
    input.orderId,
    ...consoleVisibilityBinds(identity),
  ).first<{ id: string }>();
  if (!row) {
    await assertCurrentConsoleMembership(input.database, identity);
    throw new OrderValidationError('not_found', 'Refund Request not found.', [], 404);
  }
  await assertCurrentConsoleOrderAccess({
    database: input.database,
    identity,
    orderId: input.orderId,
    action: 'order:read',
  });
  requirePermission(identity, 'refund:decide', { storeId: input.context.storeId });
}

export async function listConsoleOrders(
  database: D1Database,
  context: OrderContext,
  query: ConsoleOrderListQuery,
  visibilityRetry = 0,
): Promise<ConsoleOrderListResponse> {
  const identity = requireConsoleIdentity(context.identity);
  const seek = query.cursor === null ? null : decodeCursor(query.cursor, query, context);
  const base = boundBasePredicate(context, query);
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
    database.prepare(summarySelectSql(base.sql)).bind(...base.binds),
    (() => {
      const visibility = boundVisibilityPredicate(context);
      return database.prepare(`SELECT EXISTS(SELECT 1 FROM orders WHERE ${visibility.sql}) AS has_orders`)
        .bind(...visibility.binds);
    })(),
  ]);
  await assertCurrentConsoleMembership(database, identity);

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
  const response: ConsoleOrderListResponse = {
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
      ? encodeCursor([1, context.storeId, identity.userId, identity.role, last.created_at, last.id, query.q, query.status, query.refund, query.limit])
      : null,
    hasOrders: Number((hasResult.results[0] as { has_orders: number } | undefined)?.has_orders) === 1,
  };
  if (identity.role === 'staff') {
    const visibility = boundVisibilityPredicate(context);
    const placeholders = page.map(() => '?').join(',');
    const hasSql = `SELECT EXISTS(SELECT 1 FROM orders WHERE ${visibility.sql}) AS has_orders`;
    const checks = await database.batch([
      database.prepare(summarySelectSql(base.sql)).bind(...base.binds),
      database.prepare(hasSql).bind(...visibility.binds),
      page.length === 0
        ? database.prepare('SELECT 0 AS visible_count')
        : database.prepare(
          `SELECT count(*) AS visible_count FROM orders
            WHERE ${visibility.sql} AND orders.id IN (${placeholders})`,
        ).bind(...visibility.binds, ...page.map((row) => row.id)),
    ]);
    await assertCurrentConsoleMembership(database, identity);
    const currentSummary = summaryFromRow(checks[0].results[0] as SummaryRow | undefined);
    const currentHasOrders = Number((checks[1].results[0] as { has_orders: number } | undefined)?.has_orders) === 1;
    const visibleCount = Number((checks[2].results[0] as { visible_count: number } | undefined)?.visible_count);
    if (
      JSON.stringify(currentSummary) !== JSON.stringify(response.summary)
      || currentHasOrders !== response.hasOrders
      || visibleCount !== page.length
    ) {
      if (visibilityRetry === 0) return listConsoleOrders(database, context, query, 1);
      throw new OrderValidationError('order_visibility_changed', 'Order access changed. Reload and try again.', [], 409);
    }
  }
  return response;
}
