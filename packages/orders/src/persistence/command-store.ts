import { stableId } from '@nexus/catalog/slug';
import {
  OrderPersistenceError,
  OrderValidationError,
  type OrderCommandAction,
  type OrderCommandResult,
  type OrderContext,
  type OrderStatus,
  type RefundRequestProjection,
} from '../order-types';
import { assertCurrentConsoleOrderAccess, consoleVisibilityBinds, consoleVisibilitySql } from '../order-access';

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
  refund_status: RefundRequestProjection['status'] | null;
  refund_decided_at: string | null;
  event_id: string;
  assignee_user_id: string | null;
  history_action: string;
}

export interface OrderCommandTarget {
  id: string;
  reference: string;
  status: OrderStatus;
  total_minor: number;
  currency: string;
  customer_id: string;
  assignee_user_id: string | null;
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
    `SELECT orders.id, orders.reference, orders.status, orders.total_minor, orders.currency, orders.customer_id,
            assignment.assignee_user_id
       FROM orders
       LEFT JOIN order_assignments assignment
         ON assignment.store_id = orders.store_id AND assignment.order_id = orders.id
      WHERE orders.store_id = ? AND orders.id = ?`,
  ).bind(storeId, orderId).first<OrderCommandTarget>();
}

function refundProjection(row: CommandResultRow): RefundRequestProjection | null {
  if (
    (row.action !== 'request_refund' && row.action !== 'approve_refund' && row.action !== 'reject_refund')
    || row.refund_id === null
    || row.refund_reason === null
    || row.refund_created_at === null
    || row.refund_status === null
  ) {
    return null;
  }
  return {
    id: row.refund_id,
    status: row.refund_status,
    reason: row.refund_reason,
    createdAt: row.refund_created_at,
    decidedAt: row.refund_decided_at,
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
            history.id AS event_id,
            history.assignee_user_id AS assignee_user_id,
            history.action AS history_action,
            payments.id AS payment_id,
            refunds.id AS refund_id,
            refunds.reason AS refund_reason,
            refunds.created_at AS refund_created_at,
            refunds.status AS refund_status,
            refunds.decided_at AS refund_decided_at
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
  const expectedHistoryAction: Record<OrderCommandAction, string> = {
    assign: 'assigned',
    mark_paid: 'order_paid',
    fulfill: 'order_fulfilled',
    cancel: 'order_canceled',
    request_refund: 'refund_requested',
    approve_refund: 'refund_approved',
    reject_refund: 'refund_rejected',
  };
  if (row.history_action !== expectedHistoryAction[row.action]) {
    throw new OrderPersistenceError(new Error('The command result event is incompatible.'));
  }
  if (row.action === 'assign') {
    if (row.assignee_user_id === null) {
      throw new OrderPersistenceError(new Error('The assignment result could not be read.'));
    }
    return {
      reference: row.reference,
      action: 'assign',
      status: row.status,
      occurredAt: row.occurredAt,
      paymentId: null,
      refundRequest: null,
      assignment: { assigneeUserId: row.assignee_user_id, eventId: row.event_id },
    };
  }
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

export async function readRefundRequest(
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
      WHERE requests.store_id = ? AND requests.order_id = ?`,
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
  context: OrderContext;
}): Promise<OrderCommandResult> {
  const commandId = stableId('cmd');
  try {
    const statements = [
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
    ];
    if (input.context.identity?.kind === 'console') {
      statements.push(input.database.prepare(
        `UPDATE orders
            SET status = CASE WHEN ${consoleVisibilitySql('orders')} THEN status ELSE NULL END
          WHERE store_id = ? AND id = ?`,
      ).bind(
        ...consoleVisibilityBinds(input.context.identity),
        input.storeId,
        input.orderId,
      ));
    }
    await input.database.batch(statements);
  } catch (error) {
    await authorizeResult(input.database, input.context, input.orderId, input.action);
    const ledger = await readLedger(input.database, input.storeId, input.requestKey);
    await authorizeResult(input.database, input.context, input.orderId, input.action);
    if (!ledger) throw new OrderPersistenceError(error);
    if (ledger.contract_version === 1) legacyKeyConflict();
    if (!ledgerMatches(ledger, input.action, input.orderId, input.hash)) keyConflict();
  }
  await authorizeResult(input.database, input.context, input.orderId, input.action);
  const result = await readCommandResult(input.database, input.storeId, input.requestKey);
  await authorizeResult(input.database, input.context, input.orderId, input.action);
  return result;
}

async function authorizeResult(
  database: D1Database,
  context: OrderContext,
  orderId: string,
  action: OrderCommandAction,
): Promise<void> {
  if (context.identity?.kind !== 'console') return;
  await assertCurrentConsoleOrderAccess({
    database,
    identity: context.identity,
    orderId,
    action: action === 'request_refund'
      ? 'refund:request'
      : action === 'approve_refund' || action === 'reject_refund'
        ? 'refund:decide'
        : 'order:process',
  });
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
  context: OrderContext,
): Promise<OrderCommandResult> {
  await authorizeResult(database, context, input.orderId, input.action);
  const ledger = await readLedger(database, storeId, input.requestKey);
  await authorizeResult(database, context, input.orderId, input.action);
  if (ledger) {
    if (ledger.contract_version === 1) legacyKeyConflict();
    if (!ledgerMatches(ledger, input.action, input.orderId, input.hash)) keyConflict();
    const result = await readCommandResult(database, storeId, input.requestKey);
    await authorizeResult(database, context, input.orderId, input.action);
    return result;
  }
  const order = await readOrderTarget(database, storeId, input.orderId);
  await authorizeResult(database, context, input.orderId, input.action);
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
  context: OrderContext;
}): Promise<OrderCommandResult> {
  try {
    const guard = input.context.identity?.kind === 'console'
      ? input.database.prepare(
        `UPDATE orders
            SET status = CASE WHEN ${consoleVisibilitySql('orders')} THEN status ELSE NULL END
          WHERE store_id = ? AND id = ?`,
      ).bind(
        ...consoleVisibilityBinds(input.context.identity),
        input.storeId,
        input.orderId,
      )
      : null;
    await input.database.batch(guard === null ? input.statements : [...input.statements, guard]);
  } catch (error) {
    await authorizeResult(input.database, input.context, input.orderId, input.action);
    if (input.onConflictReplay) {
      const recovered = await input.onConflictReplay();
      if (recovered) return recovered;
    }
    return recoverFailedBatch(input.database, input.storeId, input, error, input.context);
  }
  await authorizeResult(input.database, input.context, input.orderId, input.action);
  const result = await readCommandResult(input.database, input.storeId, input.requestKey);
  await authorizeResult(input.database, input.context, input.orderId, input.action);
  return result;
}
