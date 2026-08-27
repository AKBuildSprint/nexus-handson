import { BOOTSTRAP_STORE_ID } from '../catalog/catalog-read';
import {
  CatalogValidationError,
  type OrderItemCatalogResolution,
} from '../catalog/catalog-types';
import {
  createOrderItemCatalogSnapshotResolver,
  type ResolveOrderItemCatalogSnapshot,
} from '../catalog/private-order-snapshot';
import { stableId } from '../catalog/slug';
import { digestOrderCapability } from './private-access';
import { readCustomerOrderById } from './order-read';
import {
  OrderPersistenceError,
  OrderValidationError,
  type CustomerOrderProjection,
  type ValidatedOrderCreateInput,
} from './order-types';
import { parseOrderCreateInput } from './order-validation';

interface IdempotencyRow {
  order_id: string;
  capability_digest: string;
}

function orderReference(): string {
  return `NX-${crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
}

async function readIdempotency(
  database: D1Database,
  requestKey: string,
): Promise<IdempotencyRow | null> {
  return database.prepare(
    `SELECT order_id, capability_digest
       FROM order_idempotency
      WHERE store_id = ? AND request_key = ?`,
  ).bind(BOOTSTRAP_STORE_ID, requestKey).first<IdempotencyRow>();
}

async function replayOrder(
  database: D1Database,
  row: IdempotencyRow,
  capabilityDigest: string,
): Promise<CustomerOrderProjection> {
  if (row.capability_digest !== capabilityDigest) {
    throw new OrderValidationError(
      'idempotency_conflict',
      'The idempotency key is already bound to another Order capability.',
      [],
      409,
    );
  }
  const order = await readCustomerOrderById(database, row.order_id);
  if (!order) throw new OrderPersistenceError(new Error('The idempotency result has no Order aggregate.'));
  return order;
}


function checkedTotal(input: ValidatedOrderCreateInput, unitPriceMinor: number): number {
  const total = unitPriceMinor * input.quantity;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new OrderValidationError(
      'money_out_of_range',
      'The server-resolved Order total is outside the supported range.',
      [],
      422,
    );
  }
  return total;
}

export async function createOrder(input: {
  database: D1Database;
  body: unknown;
  idempotencyKey: unknown;
  capability: unknown;
  resolveCatalogSnapshot?: ResolveOrderItemCatalogSnapshot;
}): Promise<CustomerOrderProjection> {
  const request = parseOrderCreateInput(input.body, input.idempotencyKey, input.capability);
  const capabilityDigest = await digestOrderCapability(request.capability);
  const existing = await readIdempotency(input.database, request.idempotencyKey);
  if (existing) return replayOrder(input.database, existing, capabilityDigest);

  const resolveCatalogSnapshot = input.resolveCatalogSnapshot
    ?? createOrderItemCatalogSnapshotResolver(input.database);
  let resolution: OrderItemCatalogResolution;
  try {
    resolution = await resolveCatalogSnapshot({
      productId: request.productId,
      variantId: request.variantId,
    });
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      throw new OrderValidationError(error.code, error.message, error.fields, error.status);
    }
    throw error;
  }

  const snapshot = resolution.snapshot;
  const totalMinor = checkedTotal(request, snapshot.unitPriceMinor);
  const customerId = stableId('cust');
  const orderId = stableId('ord');
  const lineId = stableId('line');
  const accessId = stableId('access');
  const idempotencyId = stableId('idem');
  const historyId = stableId('hist');
  const reference = orderReference();

  const statements: D1PreparedStatement[] = [
    input.database.prepare(
      `INSERT INTO customers (id, store_id, name, email_normalized)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(store_id, email_normalized) DO UPDATE SET
         name = excluded.name,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(customerId, BOOTSTRAP_STORE_ID, request.customerName, request.customerEmailNormalized),
    input.database.prepare(
      `INSERT INTO order_lines
         (id, store_id, order_id, product_id, product_name, variant_id, variant_sku,
          selected_options_json, quantity, unit_price_minor, line_total_minor, currency,
          access_title, access_instructions, private_file_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      lineId,
      BOOTSTRAP_STORE_ID,
      orderId,
      snapshot.productId,
      snapshot.productName,
      snapshot.variantId,
      snapshot.variantSku,
      JSON.stringify(snapshot.selectedOptions),
      request.quantity,
      snapshot.unitPriceMinor,
      totalMinor,
      snapshot.currency,
      snapshot.accessTitle,
      snapshot.accessInstructions,
      snapshot.privateFileKey,
    ),
    input.database.prepare(
      `INSERT INTO orders
         (id, store_id, reference, customer_id, customer_name, customer_email_normalized,
          status, currency, total_minor)
       VALUES (?, ?, ?,
         (SELECT id FROM customers WHERE store_id = ? AND email_normalized = ?),
         ?, ?, 'pending_payment', ?, ?)`,
    ).bind(
      orderId,
      BOOTSTRAP_STORE_ID,
      reference,
      BOOTSTRAP_STORE_ID,
      request.customerEmailNormalized,
      request.customerName,
      request.customerEmailNormalized,
      snapshot.currency,
      totalMinor,
    ),
    input.database.prepare(
      `INSERT INTO order_access (id, store_id, order_id, capability_digest)
       VALUES (?, ?, ?, ?)`,
    ).bind(accessId, BOOTSTRAP_STORE_ID, orderId, capabilityDigest),
    input.database.prepare(
      `INSERT INTO order_idempotency (id, store_id, request_key, order_id, capability_digest)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(idempotencyId, BOOTSTRAP_STORE_ID, request.idempotencyKey, orderId, capabilityDigest),
    input.database.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status)
       SELECT CASE WHEN (
         SELECT count(*) FROM products WHERE store_id = ? AND id = ? AND revision = ?
       ) = 1 THEN ? ELSE NULL END,
       ?, ?, 'pending_payment'`,
    ).bind(
      BOOTSTRAP_STORE_ID,
      snapshot.productId,
      resolution.productRevision,
      historyId,
      BOOTSTRAP_STORE_ID,
      orderId,
    ),
  ];

  try {
    await input.database.batch(statements);
  } catch (error) {
    const raced = await readIdempotency(input.database, request.idempotencyKey);
    if (raced) return replayOrder(input.database, raced, capabilityDigest);
    const currentRevision = await input.database.prepare(
      'SELECT revision FROM products WHERE store_id = ? AND id = ?',
    ).bind(BOOTSTRAP_STORE_ID, snapshot.productId).first<number>('revision');
    if (currentRevision !== resolution.productRevision) {
      throw new OrderValidationError(
        'catalog_revision_conflict',
        'The Product changed while the Order was being created.',
        [],
        409,
      );
    }
    throw new OrderPersistenceError(error);
  }

  const order = await readCustomerOrderById(input.database, orderId);
  if (!order) throw new OrderPersistenceError(new Error('The saved Order aggregate could not be read.'));
  return order;
}
