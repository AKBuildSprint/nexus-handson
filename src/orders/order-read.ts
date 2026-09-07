import { BOOTSTRAP_STORE_ID } from '../catalog/catalog-read';
import { normalizeComparisonKey } from '../catalog/slug';
import type {
  ConsoleOrderAction,
  ConsoleOrderDetailProjection,
  ConsoleOrderListQuery,
  ConsoleOrderProjection,
  CustomerOrderProjection,
  OrderHistoryEntry,
  OrderProductProjection,
  OrderPurchaseProjection,
  OrderRefundRequest,
  OrderSelectedOption,
  OrderStatus,
} from './order-types';
import { decodeConsoleOrderCursor } from './order-validation';

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
  refund_id: string | null;
  refund_reason: string | null;
  refund_status: 'pending' | null;
  refund_created_at: string | null;
}

interface HistoryRow {
  sequence: number;
  action: OrderHistoryEntry['action'];
  previous_status: OrderStatus | null;
  status: OrderStatus;
  source: OrderHistoryEntry['source'];
  refund_request_id: string | null;
  created_at: string;
}

const PURCHASE_SELECT = `SELECT orders.id, orders.reference, orders.status,
       orders.customer_name, orders.customer_email_normalized,
       order_lines.product_id, order_lines.product_name, order_lines.variant_id, order_lines.variant_sku,
       order_lines.selected_options_json, order_lines.quantity, order_lines.unit_price_minor,
       orders.total_minor, orders.currency, orders.created_at`;

const CUSTOMER_SELECT = `${PURCHASE_SELECT},
       refund_requests.id AS refund_id, refund_requests.reason AS refund_reason,
       refund_requests.status AS refund_status, refund_requests.created_at AS refund_created_at
  FROM orders
  JOIN order_lines ON order_lines.order_id = orders.id AND order_lines.store_id = orders.store_id
  LEFT JOIN refund_requests
    ON refund_requests.order_id = orders.id AND refund_requests.store_id = orders.store_id`;

const LIST_SELECT = CUSTOMER_SELECT;

const PAGE_SIZE = 25;
const MATCH_BUFFER = PAGE_SIZE + 1;
const SCAN_CHUNK = 100;

function productProjection(row: OrderProjectionRow): OrderProductProjection {
  const parsed = JSON.parse(row.selected_options_json) as unknown;
  if (!Array.isArray(parsed)) throw new Error('The persisted Order selection is invalid.');
  const selectedOptions = parsed as OrderSelectedOption[];
  return {
    id: row.product_id,
    name: row.product_name,
    variant: row.variant_id === null ? null : {
      id: row.variant_id,
      sku: row.variant_sku as string,
      selectedOptions,
    },
  };
}

function purchaseProjection(row: OrderProjectionRow): OrderPurchaseProjection {
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

function refundProjection(row: OrderProjectionRow): OrderRefundRequest | null {
  if (row.refund_id === null || row.refund_reason === null || row.refund_created_at === null) return null;
  return {
    id: row.refund_id,
    reason: row.refund_reason,
    status: 'pending',
    createdAt: row.refund_created_at,
  };
}

function historyProjection(row: HistoryRow): OrderHistoryEntry {
  return {
    sequence: row.sequence,
    action: row.action,
    fromStatus: row.previous_status,
    toStatus: row.status,
    source: row.source,
    refundRequestId: row.refund_request_id,
    createdAt: row.created_at,
  };
}

function allowedConsoleActions(status: OrderStatus): ConsoleOrderAction[] {
  if (status === 'pending_payment') return ['mark_paid', 'cancel'];
  if (status === 'paid') return ['mark_fulfilled'];
  return [];
}

export async function readCustomerOrderById(
  database: D1Database,
  orderId: string,
): Promise<CustomerOrderProjection | null> {
  const row = await database.prepare(
    `${CUSTOMER_SELECT} WHERE orders.store_id = ? AND orders.id = ?`,
  ).bind(BOOTSTRAP_STORE_ID, orderId).first<OrderProjectionRow>();
  return row ? { ...purchaseProjection(row), refundRequest: refundProjection(row) } : null;
}

function encodeConsoleOrderCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify([createdAt, id])).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function consoleListProjection(row: OrderProjectionRow): ConsoleOrderProjection {
  return {
    ...purchaseProjection(row),
    customer: {
      name: row.customer_name,
      email: row.customer_email_normalized,
    },
    hasPendingRefund: row.refund_id !== null,
  };
}

function matchesListQuery(row: OrderProjectionRow, needle: string): boolean {
  if (needle === '') return true;
  return [row.reference, row.customer_name, row.customer_email_normalized]
    .some((value) => normalizeComparisonKey(value).includes(needle));
}

export async function listConsoleOrders(
  database: D1Database,
  criteria: ConsoleOrderListQuery,
): Promise<{ orders: ConsoleOrderProjection[]; nextCursor: string | null; hasAnyOrders: boolean }> {
  const needle = normalizeComparisonKey(criteria.q);
  const existing = await database.prepare(
    'SELECT 1 AS ok FROM orders WHERE store_id = ? LIMIT 1',
  ).bind(BOOTSTRAP_STORE_ID).first();
  const hasAnyOrders = existing !== null;

  const matches: OrderProjectionRow[] = [];
  let sqlCursor: [string, string] | null = criteria.cursor === null ? null : decodeConsoleOrderCursor(criteria.cursor);
  while (matches.length < MATCH_BUFFER) {
    const statement = database.prepare(
      `${LIST_SELECT}
        WHERE orders.store_id = ?
          AND (? = 0 OR orders.status = ?)
          AND (? = 0 OR refund_requests.id IS NOT NULL)
          AND (? = 0 OR orders.created_at < ? OR (orders.created_at = ? AND orders.id < ?))
        ORDER BY orders.created_at DESC, orders.id DESC
        LIMIT ${SCAN_CHUNK}`,
    ).bind(
      BOOTSTRAP_STORE_ID,
      criteria.status === 'all' ? 0 : 1,
      criteria.status === 'all' ? 'pending_payment' : criteria.status,
      criteria.refund === 'pending' ? 1 : 0,
      sqlCursor === null ? 0 : 1,
      sqlCursor?.[0] ?? '',
      sqlCursor?.[0] ?? '',
      sqlCursor?.[1] ?? '',
    );
    const rows = (await statement.all<OrderProjectionRow>()).results;
    if (rows.length === 0) break;
    for (const row of rows) {
      if (matchesListQuery(row, needle)) {
        matches.push(row);
        if (matches.length === MATCH_BUFFER) break;
      }
    }
    if (matches.length === MATCH_BUFFER || rows.length < SCAN_CHUNK) break;
    const last = rows[rows.length - 1];
    sqlCursor = [last.created_at, last.id];
  }

  const page = matches.slice(0, PAGE_SIZE);
  const lastReturned = page[PAGE_SIZE - 1];
  return {
    orders: page.map(consoleListProjection),
    nextCursor: matches.length === MATCH_BUFFER && lastReturned !== undefined
      ? encodeConsoleOrderCursor(lastReturned.created_at, lastReturned.id)
      : null,
    hasAnyOrders,
  };
}

export async function readConsoleOrderDetail(
  database: D1Database,
  reference: string,
): Promise<ConsoleOrderDetailProjection | null> {
  const [baseResult, historyResult] = await database.batch<OrderProjectionRow | HistoryRow>([
    database.prepare(
      `${CUSTOMER_SELECT} WHERE orders.store_id = ? AND orders.reference = ?`,
    ).bind(BOOTSTRAP_STORE_ID, reference),
    database.prepare(
      `SELECT order_history.sequence, order_history.action, order_history.previous_status,
              order_history.status, order_history.source, order_history.refund_request_id,
              order_history.created_at
         FROM order_history
         JOIN orders
           ON orders.id = order_history.order_id AND orders.store_id = order_history.store_id
        WHERE orders.store_id = ? AND orders.reference = ?
        ORDER BY order_history.sequence ASC`,
    ).bind(BOOTSTRAP_STORE_ID, reference),
  ]);
  const row = baseResult.results[0] as OrderProjectionRow | undefined;
  if (!row) return null;
  return {
    ...purchaseProjection(row),
    customer: {
      name: row.customer_name,
      email: row.customer_email_normalized,
    },
    history: (historyResult.results as HistoryRow[]).map(historyProjection),
    refundRequest: refundProjection(row),
    allowedActions: allowedConsoleActions(row.status),
  };
}
