import { BOOTSTRAP_STORE_ID } from '../catalog/catalog-read';
import { readCustomerOrderById } from './order-read';
import type { CustomerOrderProjection } from './order-types';
import { parseOrderCapability } from './order-validation';

const encoder = new TextEncoder();

export async function digestOrderCapability(capability: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(capability));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function findOrderIdByCapability(input: {
  database: D1Database;
  reference: string;
  capability: unknown;
}): Promise<string | null> {
  const capability = parseOrderCapability(input.capability);
  const digest = await digestOrderCapability(capability);
  const row = await input.database.prepare(
    `SELECT orders.id
       FROM orders
       JOIN order_access
         ON order_access.order_id = orders.id AND order_access.store_id = orders.store_id
      WHERE orders.store_id = ? AND orders.reference = ? AND order_access.capability_digest = ?`,
  ).bind(BOOTSTRAP_STORE_ID, input.reference, digest).first<{ id: string }>();
  return row?.id ?? null;
}

export async function readPrivateOrder(input: {
  database: D1Database;
  reference: string;
  capability: unknown;
}): Promise<CustomerOrderProjection | null> {
  const orderId = await findOrderIdByCapability(input);
  return orderId === null ? null : readCustomerOrderById(input.database, orderId);
}
