import {
  CatalogValidationError,
  type OrderItemCatalogResolution,
} from '../catalog/catalog-types';
import {
  resolveOrderItemCatalogSnapshots,
  type OrderItemCatalogSelection,
} from '../catalog/private-order-snapshot';
import { stableId } from '../catalog/slug';
import { digestOrderCapability } from './private-access';
import { readCustomerOrderById } from './order-read';
import {
  OrderPersistenceError,
  OrderValidationError,
  type CustomerOrderProjection,
  type OrderContext,
} from './order-types';
import { parseOrderCreateInput } from './order-validation';

interface IdempotencyRow {
  order_id: string;
  capability_digest: string;
}

function orderReference(): string {
  return `NX-${crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
}

function paymentReference(): string {
  return `NP${crypto.randomUUID().replaceAll('-', '')}`;
}

async function readIdempotency(
  database: D1Database,
  storeId: string,
  requestKey: string,
): Promise<IdempotencyRow | null> {
  return database.prepare(
    `SELECT order_id, capability_digest
       FROM order_idempotency
      WHERE store_id = ? AND request_key = ?`,
  ).bind(storeId, requestKey).first<IdempotencyRow>();
}

async function replayOrder(
  database: D1Database,
  storeId: string,
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
  const order = await readCustomerOrderById({ database, storeId, orderId: row.order_id });
  if (!order) throw new OrderPersistenceError(new Error('The idempotency result has no Order aggregate.'));
  return order;
}

function checkedMoney(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OrderValidationError('money_out_of_range', message, [], 422);
  }
  return value;
}

export async function createOrder(input: {
  database: D1Database;
  body: unknown;
  idempotencyKey: unknown;
  capability: unknown;
  context: OrderContext;
  resolveCatalogSnapshots?: (input: {
    database: D1Database;
    storeId: string;
    items: OrderItemCatalogSelection[];
  }) => Promise<OrderItemCatalogResolution[]>;
}): Promise<CustomerOrderProjection> {
  const context = input.context;
  if (context.actor.source !== 'storefront') {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [], 422);
  }
  const request = parseOrderCreateInput(input.body, input.idempotencyKey, input.capability);
  const capabilityDigest = await digestOrderCapability(request.capability);
  const existing = await readIdempotency(input.database, context.storeId, request.idempotencyKey);
  if (existing) return replayOrder(input.database, context.storeId, existing, capabilityDigest);

  const resolveCatalogSnapshots = input.resolveCatalogSnapshots ?? resolveOrderItemCatalogSnapshots;
  let resolutions: OrderItemCatalogResolution[];
  try {
    resolutions = await resolveCatalogSnapshots({
      database: input.database,
      storeId: context.storeId,
      items: request.items,
    });
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      throw new OrderValidationError(error.code, error.message, error.fields, error.status);
    }
    throw error;
  }

  if (resolutions.length !== request.items.length) {
    throw new OrderPersistenceError(new Error('Catalog snapshot count does not match the Order items.'));
  }

  const currency = resolutions[0]?.snapshot.currency;
  if (!currency) {
    throw new OrderValidationError('product_not_found', 'Product not found.', [], 404);
  }
  if (resolutions.some((resolution) => resolution.snapshot.currency !== currency)) {
    throw new OrderValidationError(
      'currency_mismatch',
      'All Order items must use the same currency.',
      [],
      422,
    );
  }

  const lines = request.items.map((item, index) => {
    const snapshot = resolutions[index].snapshot;
    const lineTotalMinor = checkedMoney(
      snapshot.unitPriceMinor * item.quantity,
      'The server-resolved Order total is outside the supported range.',
    );
    return {
      id: stableId('line'),
      position: index,
      quantity: item.quantity,
      lineTotalMinor,
      snapshot,
      productRevision: resolutions[index].productRevision,
    };
  });
  const totalMinor = checkedMoney(
    lines.reduce((sum, line) => checkedMoney(sum + line.lineTotalMinor, 'The server-resolved Order total is outside the supported range.'), 0),
    'The server-resolved Order total is outside the supported range.',
  );

  const revisions = new Map<string, number>();
  for (const line of lines) {
    const captured = revisions.get(line.snapshot.productId);
    if (captured !== undefined && captured !== line.productRevision) {
      throw new OrderValidationError(
        'catalog_revision_conflict',
        'The Product changed while the Order was being created.',
        [],
        409,
      );
    }
    revisions.set(line.snapshot.productId, line.productRevision);
  }
  const revisionPayload = JSON.stringify([...revisions].map(([id, revision]) => ({ id, revision })));

  const customerId = stableId('cust');
  const orderId = stableId('ord');
  const accessId = stableId('access');
  const idempotencyId = stableId('idem');
  const historyId = stableId('hist');
  const reference = orderReference();
  const internalPaymentReference = paymentReference();

  const statements: D1PreparedStatement[] = [
    input.database.prepare(
      `INSERT INTO customers (id, store_id, name, email_normalized)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(store_id, email_normalized) DO UPDATE SET
         name = excluded.name,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(customerId, context.storeId, request.customerName, request.customerEmailNormalized),
    ...lines.map((line) => input.database.prepare(
      `INSERT INTO order_lines
         (id, store_id, order_id, product_id, product_name, variant_id, variant_sku,
          selected_options_json, quantity, unit_price_minor, line_total_minor, currency,
          access_title, access_instructions, private_file_key, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      line.id,
      context.storeId,
      orderId,
      line.snapshot.productId,
      line.snapshot.productName,
      line.snapshot.variantId,
      line.snapshot.variantSku,
      JSON.stringify(line.snapshot.selectedOptions),
      line.quantity,
      line.snapshot.unitPriceMinor,
      line.lineTotalMinor,
      line.snapshot.currency,
      line.snapshot.accessTitle,
      line.snapshot.accessInstructions,
      line.snapshot.privateFileKey,
      line.position,
    )),
    input.database.prepare(
      `INSERT INTO orders
         (id, store_id, reference, customer_id, customer_name, customer_email_normalized,
          status, currency, total_minor, payment_reference)
       VALUES (?, ?, ?,
         (SELECT id FROM customers WHERE store_id = ? AND email_normalized = ?),
         ?, ?, 'pending', ?, ?, ?)`,
    ).bind(
      orderId,
      context.storeId,
      reference,
      context.storeId,
      request.customerEmailNormalized,
      request.customerName,
      request.customerEmailNormalized,
      currency,
      totalMinor,
      internalPaymentReference,
    ),
    input.database.prepare(
      `INSERT INTO order_access (id, store_id, order_id, capability_digest)
       VALUES (?, ?, ?, ?)`,
    ).bind(accessId, context.storeId, orderId, capabilityDigest),
    input.database.prepare(
      `INSERT INTO order_idempotency (id, store_id, request_key, order_id, capability_digest)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(idempotencyId, context.storeId, request.idempotencyKey, orderId, capabilityDigest),
    input.database.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status, actor_id, contract_version)
       SELECT CASE WHEN (
         SELECT count(*)
           FROM json_each(?) AS expected
           JOIN products
             ON products.store_id = ?
            AND products.id = json_extract(expected.value, '$.id')
            AND products.revision = json_extract(expected.value, '$.revision')
       ) = ?
       AND (
         SELECT count(*) FROM order_lines WHERE order_id = ? AND store_id = ?
       ) BETWEEN 1 AND 10
       AND (
         SELECT COALESCE(sum(line_total_minor), 0) FROM order_lines WHERE order_id = ? AND store_id = ?
       ) = ?
       AND NOT EXISTS (
         SELECT 1 FROM order_lines WHERE order_id = ? AND store_id = ? AND currency != ?
       )
       THEN ? ELSE NULL END,
       ?, ?, 'pending', 'order_created', 'storefront', NULL,
       (SELECT id FROM customers WHERE store_id = ? AND email_normalized = ?),
       2`,
    ).bind(
      revisionPayload,
      context.storeId,
      revisions.size,
      orderId,
      context.storeId,
      orderId,
      context.storeId,
      totalMinor,
      orderId,
      context.storeId,
      currency,
      historyId,
      context.storeId,
      orderId,
      context.storeId,
      request.customerEmailNormalized,
    ),
  ];

  try {
    await input.database.batch(statements);
  } catch (error) {
    const raced = await readIdempotency(input.database, context.storeId, request.idempotencyKey);
    if (raced) return replayOrder(input.database, context.storeId, raced, capabilityDigest);
    const current = await input.database.prepare(
      `WITH input(payload) AS (VALUES (?))
       SELECT products.id, products.revision
         FROM products, input
        WHERE products.store_id = ?
          AND products.id IN (SELECT json_extract(value, '$.id') FROM json_each(input.payload))`,
    ).bind(revisionPayload, context.storeId).all<{ id: string; revision: number }>();
    const currentById = new Map(current.results.map((row) => [row.id, row.revision]));
    for (const [productId, revision] of revisions) {
      if (currentById.get(productId) !== revision) {
        throw new OrderValidationError(
          'catalog_revision_conflict',
          'The Product changed while the Order was being created.',
          [],
          409,
        );
      }
    }
    throw new OrderPersistenceError(error);
  }

  const order = await readCustomerOrderById({ database: input.database, storeId: context.storeId, orderId });
  if (!order) throw new OrderPersistenceError(new Error('The saved Order aggregate could not be read.'));
  return order;
}
