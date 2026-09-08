import { BOOTSTRAP_STORE_ID } from '../catalog/catalog-read';
import { stableId } from '../catalog/slug';
import {
  OrderPersistenceError,
  OrderValidationError,
  type OrderCommandAction,
  type OrderCommandResult,
  type OrderHistoryAction,
  type OrderStatus,
  type RefundRequestProjection,
} from './order-types';
import {
  parseCancelOrderInput,
  parseCompleteOrderInput,
  parseRefundRequestInput,
} from './order-validation';

const encoder = new TextEncoder();

const REFUND_ELIGIBILITY_SQL =
  'SELECT status AS eligibility_status FROM orders WHERE store_id = ? AND id = ?';

interface CommandLedgerRow {
  order_id: string;
  action: OrderCommandAction;
  payload_hash: string;
}

interface CommandResultRow {
  reference: string;
  action: OrderCommandAction;
  status: 'completed' | 'cancelled';
  occurredAt: string;
  refund_id: string | null;
  refund_status: 'pending' | null;
  refund_reason: string | null;
  refund_created_at: string | null;
}

function notFound(): never {
  throw new OrderValidationError('not_found', 'Order not found.', [], 404);
}

function keyConflict(): never {
  throw new OrderValidationError(
    'idempotency_conflict',
    'The idempotency key is already bound to another Order command.',
    [],
    409,
  );
}

function stateConflict(): never {
  throw new OrderValidationError(
    'order_state_conflict',
    'The Order state does not allow this action.',
    [],
    409,
  );
}

async function payloadHash(parts: unknown[]): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readLedger(
  database: D1Database,
  requestKey: string,
): Promise<CommandLedgerRow | null> {
  return database.prepare(
    `SELECT order_id, action, payload_hash
       FROM order_commands
      WHERE store_id = ? AND request_key = ?`,
  ).bind(BOOTSTRAP_STORE_ID, requestKey).first<CommandLedgerRow>();
}

function ledgerMatches(
  row: CommandLedgerRow,
  action: OrderCommandAction,
  orderId: string,
  hash: string,
): boolean {
  return row.action === action && row.order_id === orderId && row.payload_hash === hash;
}

async function readOrderIdByReference(
  database: D1Database,
  reference: string,
): Promise<string | null> {
  const row = await database.prepare(
    'SELECT id FROM orders WHERE store_id = ? AND reference = ?',
  ).bind(BOOTSTRAP_STORE_ID, reference).first<{ id: string }>();
  return row?.id ?? null;
}

async function readOrderStatus(
  database: D1Database,
  orderId: string,
): Promise<OrderStatus | null> {
  const row = await database.prepare(
    'SELECT status FROM orders WHERE store_id = ? AND id = ?',
  ).bind(BOOTSTRAP_STORE_ID, orderId).first<{ status: OrderStatus }>();
  return row?.status ?? null;
}

function refundProjection(row: CommandResultRow): RefundRequestProjection | null {
  if (row.action !== 'request_refund' || row.refund_id === null || row.refund_status === null
    || row.refund_reason === null || row.refund_created_at === null) {
    return null;
  }
  return {
    id: row.refund_id,
    status: row.refund_status,
    reason: row.refund_reason,
    createdAt: row.refund_created_at,
  };
}

async function readCommandResult(
  database: D1Database,
  requestKey: string,
): Promise<OrderCommandResult> {
  const row = await database.prepare(
    `SELECT orders.reference AS reference,
            commands.action AS action,
            history.status AS status,
            history.created_at AS occurredAt,
            refunds.id AS refund_id,
            refunds.status AS refund_status,
            refunds.reason AS refund_reason,
            refunds.created_at AS refund_created_at
       FROM order_commands commands
       JOIN order_history history
         ON history.id = commands.result_history_id
        AND history.order_id = commands.order_id
        AND history.store_id = commands.store_id
       JOIN orders
         ON orders.id = commands.order_id
        AND orders.store_id = commands.store_id
       LEFT JOIN order_refund_requests refunds
         ON commands.action = 'request_refund'
        AND refunds.order_id = commands.order_id
        AND refunds.store_id = commands.store_id
      WHERE commands.store_id = ? AND commands.request_key = ?`,
  ).bind(BOOTSTRAP_STORE_ID, requestKey).first<CommandResultRow>();
  if (!row) throw new OrderPersistenceError(new Error('The command result could not be read.'));
  return {
    reference: row.reference,
    action: row.action,
    status: row.status,
    occurredAt: row.occurredAt,
    refundRequest: refundProjection(row),
  };
}

async function recoverFailedBatch(
  database: D1Database,
  input: {
    requestKey: string;
    action: OrderCommandAction;
    orderId: string;
    hash: string;
    eligible: (status: OrderStatus) => boolean;
  },
  cause: unknown,
): Promise<OrderCommandResult> {
  const ledger = await readLedger(database, input.requestKey);
  if (ledger) {
    if (!ledgerMatches(ledger, input.action, input.orderId, input.hash)) keyConflict();
    return readCommandResult(database, input.requestKey);
  }
  const status = await readOrderStatus(database, input.orderId);
  if (status === null) notFound();
  if (!input.eligible(status)) stateConflict();
  throw new OrderPersistenceError(cause);
}

function terminalSpec(action: 'complete' | 'cancel'): {
  historyAction: OrderHistoryAction;
  targetStatus: 'completed' | 'cancelled';
} {
  if (action === 'complete') {
    return { historyAction: 'order_completed', targetStatus: 'completed' };
  }
  return { historyAction: 'order_cancelled', targetStatus: 'cancelled' };
}

async function runTerminalCommand(input: {
  database: D1Database;
  reference: string;
  body: unknown;
  idempotencyKey: unknown;
  action: 'complete' | 'cancel';
}): Promise<OrderCommandResult> {
  const parsed = input.action === 'complete'
    ? parseCompleteOrderInput(input.body, input.idempotencyKey)
    : parseCancelOrderInput(input.body, input.idempotencyKey);
  const orderId = await readOrderIdByReference(input.database, input.reference);
  if (orderId === null) notFound();

  const hash = await payloadHash(
    input.action === 'complete' ? [input.action, orderId, true] : [input.action, orderId],
  );
  const existing = await readLedger(input.database, parsed.idempotencyKey);
  if (existing) {
    if (!ledgerMatches(existing, input.action, orderId, hash)) keyConflict();
    return readCommandResult(input.database, parsed.idempotencyKey);
  }

  const { historyAction, targetStatus } = terminalSpec(input.action);
  const historyId = stableId('hist');
  const commandId = stableId('cmd');
  const statements: D1PreparedStatement[] = [
    input.database.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status)
       SELECT ?, ?, ?, ?, ?, 'console', 'pending_payment'
         FROM orders
        WHERE store_id = ? AND id = ? AND status = 'pending_payment'`,
    ).bind(
      historyId,
      BOOTSTRAP_STORE_ID,
      orderId,
      targetStatus,
      historyAction,
      BOOTSTRAP_STORE_ID,
      orderId,
    ),
    input.database.prepare(
      `UPDATE orders
          SET status = ?
        WHERE store_id = ? AND id = ? AND status = 'pending_payment'
          AND EXISTS (
            SELECT 1 FROM order_history
             WHERE id = ? AND store_id = ? AND order_id = ?
          )`,
    ).bind(
      targetStatus,
      BOOTSTRAP_STORE_ID,
      orderId,
      historyId,
      BOOTSTRAP_STORE_ID,
      orderId,
    ),
    input.database.prepare(
      `INSERT INTO order_commands (
         id, store_id, request_key, order_id, action, payload_hash, result_history_id
       ) VALUES (
         CASE WHEN (
           SELECT status FROM orders WHERE store_id = ? AND id = ?
         ) = ? AND (
           SELECT id FROM order_history
            WHERE store_id = ? AND order_id = ? AND action = ?
         ) IS NOT NULL THEN ? ELSE NULL END,
         ?, ?, ?, ?, ?,
         (SELECT id FROM order_history WHERE store_id = ? AND order_id = ? AND action = ?)
       )`,
    ).bind(
      BOOTSTRAP_STORE_ID,
      orderId,
      targetStatus,
      BOOTSTRAP_STORE_ID,
      orderId,
      historyAction,
      commandId,
      BOOTSTRAP_STORE_ID,
      parsed.idempotencyKey,
      orderId,
      input.action,
      hash,
      BOOTSTRAP_STORE_ID,
      orderId,
      historyAction,
    ),
  ];

  try {
    await input.database.batch(statements);
  } catch (error) {
    return recoverFailedBatch(input.database, {
      requestKey: parsed.idempotencyKey,
      action: input.action,
      orderId,
      hash,
      eligible: (status) => status === 'pending_payment' || status === targetStatus,
    }, error);
  }

  return readCommandResult(input.database, parsed.idempotencyKey);
}

export async function completeOrder(input: {
  database: D1Database;
  reference: string;
  body: unknown;
  idempotencyKey: unknown;
}): Promise<OrderCommandResult> {
  return runTerminalCommand({ ...input, action: 'complete' });
}

export async function cancelOrder(input: {
  database: D1Database;
  reference: string;
  body: unknown;
  idempotencyKey: unknown;
}): Promise<OrderCommandResult> {
  return runTerminalCommand({ ...input, action: 'cancel' });
}

export async function createRefundRequest(input: {
  database: D1Database;
  orderId: string;
  body: unknown;
  idempotencyKey: unknown;
}): Promise<OrderCommandResult> {
  const parsed = parseRefundRequestInput(input.body, input.idempotencyKey);
  const hash = await payloadHash(['request_refund', input.orderId, parsed.reason]);
  const existing = await readLedger(input.database, parsed.idempotencyKey);
  if (existing) {
    if (!ledgerMatches(existing, 'request_refund', input.orderId, hash)) keyConflict();
    return readCommandResult(input.database, parsed.idempotencyKey);
  }

  const eligibility = await input.database.prepare(REFUND_ELIGIBILITY_SQL)
    .bind(BOOTSTRAP_STORE_ID, input.orderId)
    .first<{ eligibility_status: OrderStatus }>();
  if (!eligibility) notFound();
  if (eligibility.eligibility_status !== 'completed') stateConflict();

  const requestId = stableId('rrq');
  const historyId = stableId('hist');
  const commandId = stableId('cmd');
  const statements: D1PreparedStatement[] = [
    input.database.prepare(
      `INSERT INTO order_refund_requests (id, store_id, order_id, status, reason)
       SELECT ?, ?, ?, 'pending', ?
         FROM orders
        WHERE store_id = ? AND id = ? AND status = 'completed'
          AND NOT EXISTS (
            SELECT 1 FROM order_refund_requests WHERE store_id = ? AND order_id = ?
          )`,
    ).bind(
      requestId,
      BOOTSTRAP_STORE_ID,
      input.orderId,
      parsed.reason,
      BOOTSTRAP_STORE_ID,
      input.orderId,
      BOOTSTRAP_STORE_ID,
      input.orderId,
    ),
    input.database.prepare(
      `INSERT INTO order_history (id, store_id, order_id, status, action, source, from_status)
       SELECT ?, ?, ?, 'completed', 'refund_requested', 'customer_capability', 'completed'
         FROM order_refund_requests
        WHERE id = ? AND store_id = ? AND order_id = ?`,
    ).bind(
      historyId,
      BOOTSTRAP_STORE_ID,
      input.orderId,
      requestId,
      BOOTSTRAP_STORE_ID,
      input.orderId,
    ),
    input.database.prepare(
      `INSERT INTO order_commands (
         id, store_id, request_key, order_id, action, payload_hash, result_history_id
       ) VALUES (
         CASE WHEN (
           SELECT status FROM orders WHERE store_id = ? AND id = ?
         ) = 'completed' AND (
           SELECT id FROM order_refund_requests WHERE store_id = ? AND order_id = ?
         ) IS NOT NULL AND (
           SELECT id FROM order_history
            WHERE store_id = ? AND order_id = ? AND action = 'refund_requested'
         ) IS NOT NULL THEN ? ELSE NULL END,
         ?, ?, ?, 'request_refund', ?,
         (SELECT id FROM order_history
           WHERE store_id = ? AND order_id = ? AND action = 'refund_requested')
       )`,
    ).bind(
      BOOTSTRAP_STORE_ID,
      input.orderId,
      BOOTSTRAP_STORE_ID,
      input.orderId,
      BOOTSTRAP_STORE_ID,
      input.orderId,
      commandId,
      BOOTSTRAP_STORE_ID,
      parsed.idempotencyKey,
      input.orderId,
      hash,
      BOOTSTRAP_STORE_ID,
      input.orderId,
    ),
  ];

  try {
    await input.database.batch(statements);
  } catch (error) {
    return recoverFailedBatch(input.database, {
      requestKey: parsed.idempotencyKey,
      action: 'request_refund',
      orderId: input.orderId,
      hash,
      eligible: (status) => status === 'completed',
    }, error);
  }

  return readCommandResult(input.database, parsed.idempotencyKey);
}
