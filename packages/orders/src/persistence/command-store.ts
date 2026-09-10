import { stableId } from '@nexus/catalog/slug';
import {
  OrderPersistenceError,
  OrderValidationError,
  type OrderCommandAction,
  type OrderCommandResult,
  type OrderStatus,
  type RefundRequestProjection,
} from '../order-types';

interface CommandLedgerRow {
  order_id: string;
  action: OrderCommandAction;
  payload_hash: string;
  contract_version: number;
}

interface CommandResultRow {
  reference: string;
  action: OrderCommandAction;
  status: OrderStatus;
  occurredAt: string;
  payment_id: string | null;
  refund_id: string | null;
  refund_reason: string | null;
  refund_created_at: string | null;
}

export interface OrderCommandTarget {
  id: string;
  reference: string;
  status: OrderStatus;
  total_minor: number;
  currency: string;
  customer_id: string;
}

interface ExistingPaymentRow {
  id: string;
  method: string;
  external_reference: string;
  history_id: string;
}

export function notFound(): never {
  throw new OrderValidationError('not_found', 'Order not found.', [], 404);
}

export function keyConflict(): never {
  throw new OrderValidationError(
    'idempotency_conflict',
    'The idempotency key is already bound to another Order command.',
    [],
    409,
  );
}

export function legacyKeyConflict(): never {
  throw new OrderValidationError(
    'idempotency_conflict',
    'This command key is from a previous contract. Reload the Order and retry with a new key.',
    [],
    409,
  );
}

export function stateConflict(): never {
  throw new OrderValidationError(
    'order_state_conflict',
    'The Order state does not allow this action.',
    [],
    409,
  );
}

export async function readLedger(
  database: D1Database,
  storeId: string,
  requestKey: string,
): Promise<CommandLedgerRow | null> {
  return database.prepare(
    `SELECT order_id, action, payload_hash, contract_version
       FROM order_commands
      WHERE store_id = ? AND request_key = ?`,
  ).bind(storeId, requestKey).first<CommandLedgerRow>();
}

export function ledgerMatches(
  row: CommandLedgerRow,
  action: OrderCommandAction,
  orderId: string,
  hash: string,
): boolean {
  return row.action === action && row.order_id === orderId && row.payload_hash === hash;
}

export async function readOrderTarget(
  database: D1Database,
  storeId: string,
  orderId: string,
): Promise<OrderCommandTarget | null> {
  return database.prepare(
    `SELECT id, reference, status, total_minor, currency, customer_id
       FROM orders
      WHERE store_id = ? AND id = ?`,
  ).bind(storeId, orderId).first<OrderCommandTarget>();
}

function refundProjection(row: CommandResultRow): RefundRequestProjection | null {
  if (row.action !== 'request_refund' || row.refund_id === null || row.refund_reason === null
    || row.refund_created_at === null) {
    return null;
  }
  return {
    id: row.refund_id,
    status: 'pending',
    reason: row.refund_reason,
    createdAt: row.refund_created_at,
  };
}

export async function readCommandResult(
  database: D1Database,
  storeId: string,
  requestKey: string,
): Promise<OrderCommandResult> {
  const row = await database.prepare(
    `SELECT orders.reference AS reference,
            commands.action AS action,
            history.status AS status,
            history.created_at AS occurredAt,
            payments.id AS payment_id,
            refunds.id AS refund_id,
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
       LEFT JOIN payments
         ON payments.history_id = commands.result_history_id
        AND payments.store_id = commands.store_id
        AND payments.order_id = commands.order_id
       LEFT JOIN order_refund_requests refunds
         ON commands.result_refund_request_id = refunds.id
        AND refunds.order_id = commands.order_id
        AND refunds.store_id = commands.store_id
      WHERE commands.store_id = ? AND commands.request_key = ?`,
  ).bind(storeId, requestKey).first<CommandResultRow>();
  if (!row) throw new OrderPersistenceError(new Error('The command result could not be read.'));
  return {
    reference: row.reference,
    action: row.action,
    status: row.status,
    occurredAt: row.occurredAt,
    paymentId: row.payment_id,
    refundRequest: refundProjection(row),
  };
}

export async function readExistingPayment(
  database: D1Database,
  storeId: string,
  orderId: string,
): Promise<ExistingPaymentRow | null> {
  return database.prepare(
    `SELECT id, method, external_reference, history_id
       FROM payments
      WHERE store_id = ? AND order_id = ? AND status = 'succeeded'`,
  ).bind(storeId, orderId).first<ExistingPaymentRow>();
}

export async function readDecisionHistoryId(
  database: D1Database,
  storeId: string,
  orderId: string,
  action: 'order_fulfilled' | 'order_canceled',
): Promise<string | null> {
  const row = await database.prepare(
    `SELECT id FROM order_history
      WHERE store_id = ? AND order_id = ? AND action = ?`,
  ).bind(storeId, orderId, action).first<{ id: string }>();
  return row?.id ?? null;
}

export async function readOpenRefund(
  database: D1Database,
  storeId: string,
  orderId: string,
): Promise<{ id: string; history_id: string } | null> {
  return database.prepare(
    `SELECT requests.id AS id, history.id AS history_id
       FROM order_refund_requests requests
       JOIN order_history history
         ON history.refund_request_id = requests.id
        AND history.order_id = requests.order_id
        AND history.store_id = requests.store_id
        AND history.action = 'refund_requested'
      WHERE requests.store_id = ? AND requests.order_id = ? AND requests.status = 'pending'`,
  ).bind(storeId, orderId).first<{ id: string; history_id: string }>();
}

export async function bindExistingResult(input: {
  database: D1Database;
  storeId: string;
  requestKey: string;
  orderId: string;
  action: OrderCommandAction;
  hash: string;
  historyId: string;
  refundRequestId: string | null;
}): Promise<OrderCommandResult> {
  const commandId = stableId('cmd');
  try {
    await input.database.batch([
      input.database.prepare(
        `INSERT INTO order_commands (
           id, store_id, request_key, order_id, action, payload_hash, result_history_id,
           contract_version, result_refund_request_id
         ) VALUES (
           CASE WHEN (
             SELECT id FROM order_history
              WHERE id = ? AND store_id = ? AND order_id = ?
           ) IS NOT NULL THEN ? ELSE NULL END,
           ?, ?, ?, ?, ?, ?, 2, ?
         )`,
      ).bind(
        input.historyId,
        input.storeId,
        input.orderId,
        commandId,
        input.storeId,
        input.requestKey,
        input.orderId,
        input.action,
        input.hash,
        input.historyId,
        input.refundRequestId,
      ),
    ]);
  } catch (error) {
    const ledger = await readLedger(input.database, input.storeId, input.requestKey);
    if (!ledger) throw new OrderPersistenceError(error);
    if (ledger.contract_version === 1) legacyKeyConflict();
    if (!ledgerMatches(ledger, input.action, input.orderId, input.hash)) keyConflict();
  }
  return readCommandResult(input.database, input.storeId, input.requestKey);
}

async function recoverFailedBatch(
  database: D1Database,
  storeId: string,
  input: {
    requestKey: string;
    action: OrderCommandAction;
    orderId: string;
    hash: string;
    eligible: (status: OrderStatus) => boolean;
  },
  cause: unknown,
): Promise<OrderCommandResult> {
  const ledger = await readLedger(database, storeId, input.requestKey);
  if (ledger) {
    if (ledger.contract_version === 1) legacyKeyConflict();
    if (!ledgerMatches(ledger, input.action, input.orderId, input.hash)) keyConflict();
    return readCommandResult(database, storeId, input.requestKey);
  }
  const order = await readOrderTarget(database, storeId, input.orderId);
  if (order === null) notFound();
  if (!input.eligible(order.status)) stateConflict();
  throw new OrderPersistenceError(cause);
}

export async function runCommandBatch(input: {
  database: D1Database;
  storeId: string;
  requestKey: string;
  action: OrderCommandAction;
  orderId: string;
  hash: string;
  eligible: (status: OrderStatus) => boolean;
  statements: D1PreparedStatement[];
  onConflictReplay?: () => Promise<OrderCommandResult | null>;
}): Promise<OrderCommandResult> {
  try {
    await input.database.batch(input.statements);
  } catch (error) {
    if (input.onConflictReplay) {
      const recovered = await input.onConflictReplay();
      if (recovered) return recovered;
    }
    return recoverFailedBatch(input.database, input.storeId, input, error);
  }
  return readCommandResult(input.database, input.storeId, input.requestKey);
}
