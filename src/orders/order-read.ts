import { BOOTSTRAP_STORE_ID } from '../catalog/catalog-read';
import type {
  ConsoleOrderProjection,
  CustomerOrderProjection,
  OrderProductProjection,
  OrderSelectedOption,
  OrderStatus,
} from './order-types';

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
}

const PROJECTION_SELECT = `SELECT orders.id, orders.reference, orders.status,
       orders.customer_name, orders.customer_email_normalized,
       order_lines.product_id, order_lines.product_name, order_lines.variant_id, order_lines.variant_sku,
       order_lines.selected_options_json, order_lines.quantity, order_lines.unit_price_minor,
       orders.total_minor, orders.currency, orders.created_at
  FROM orders
  JOIN order_lines ON order_lines.order_id = orders.id AND order_lines.store_id = orders.store_id`;

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

function customerProjection(row: OrderProjectionRow): CustomerOrderProjection {
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

export async function readCustomerOrderById(
  database: D1Database,
  orderId: string,
): Promise<CustomerOrderProjection | null> {
  const row = await database.prepare(
    `${PROJECTION_SELECT} WHERE orders.store_id = ? AND orders.id = ?`,
  ).bind(BOOTSTRAP_STORE_ID, orderId).first<OrderProjectionRow>();
  return row ? customerProjection(row) : null;
}

export async function listConsoleOrders(database: D1Database): Promise<ConsoleOrderProjection[]> {
  const rows = await database.prepare(
    `${PROJECTION_SELECT} WHERE orders.store_id = ? ORDER BY orders.created_at DESC, orders.id DESC`,
  ).bind(BOOTSTRAP_STORE_ID).all<OrderProjectionRow>();
  return rows.results.map((row) => ({
    ...customerProjection(row),
    customer: {
      name: row.customer_name,
      email: row.customer_email_normalized,
    },
  }));
}
