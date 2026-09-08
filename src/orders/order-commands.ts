import { stableId } from '../catalog/slug';
import {
  OrderPersistenceError,
  OrderValidationError,
  type OrderActor,
  type OrderCommandAction,
  type OrderCommandResult,
  type OrderContext,
  type OrderStatus,
  type RefundRequestProjection,
} from './order-types';
import {
  parseCancelOrderInput,
  parseFulfillOrderInput,
  parseManualPaymentInput,
  parseRefundRequestInput,
} from './order-validation';

const encoder = new TextEncoder();

const REFUND_ELIGIBILITY_SQL =
  'SELECT status AS eligibility_status FROM orders WHERE store_id = ? AND id = ?';

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

interface OrderCommandTarget {
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

function legacyKeyConflict(): never {
  throw new OrderValidationError(
    'idempotency_conflict',
    'This command key is from a previous contract. Reload the Order and retry with a new key.',
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

function paymentConflict(): never {
  throw new OrderValidationError(
    'payment_conflict',
    'This payment cannot be recorded for the Order.',
    [],
    409,
  );
}

function actorRejected(): never {
  throw new OrderValidationError('validation_failed', 'The request is invalid.', [], 422);
}

async function payloadHash(parts: unknown[]): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function authorizedActor(
  context: OrderContext,
  order: OrderCommandTarget,
  action: OrderCommandAction,
): OrderActor {
  if (!actorAllowed(action, context.actor.source)) actorRejected();
  if (context.actor.source === 'storefront') {
    if (context.actor.id !== order.customer_id) actorRejected();
    return { source: 'storefront', id: order.customer_id };
  }
  if (context.actor.source !== 'bootstrap_owner' || context.actor.id !== null) actorRejected();
  return { source: 'bootstrap_owner', id: null };
}

function actorAllowed(action: OrderCommandAction, source: OrderActor['source']): boolean {
  if (source === 'storefront') return action === 'request_refund';
  return source === 'bootstrap_owner';
}

async function readLedger(
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

function ledgerMatches(
  row: CommandLedgerRow,
  action: OrderCommandAction,
  orderId: string,
  hash: string,
): boolean {
  return row.action === action && row.order_id === orderId && row.payload_hash === hash;
}

async function readOrderTarget(
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

async function readCommandResult(
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

async function readExistingPayment(
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

async function readDecisionHistoryId(
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

async function readOpenRefund(
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

async function bindExistingResult(input: {
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

async function runCommandBatch(input: {
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

async function prepareCommand<TParsed extends { idempotencyKey: string }>(input: {
  database: D1Database;
  context: OrderContext;
  orderId: string;
  action: OrderCommandAction;
  parse: () => TParsed;
  canonicalBody: (parsed: TParsed) => unknown[];
}): Promise<{
  order: OrderCommandTarget;
  actor: OrderActor;
  hash: string;
  replay: OrderCommandResult | null;
  parsed: TParsed;
}> {
  const order = await readOrderTarget(input.database, input.context.storeId, input.orderId);
  if (order === null) notFound();
  const actor = authorizedActor(input.context, order, input.action);
  const parsed = input.parse();
  const hash = await payloadHash([
    input.action,
    order.id,
    actor.source,
    actor.id,
    ...input.canonicalBody(parsed),
  ]);
  const existing = await readLedger(input.database, input.context.storeId, parsed.idempotencyKey);
  if (existing) {
    if (existing.contract_version === 1) legacyKeyConflict();
    if (!ledgerMatches(existing, input.action, order.id, hash)) keyConflict();
    return {
      order,
      actor,
      hash,
      parsed,
      replay: await readCommandResult(input.database, input.context.storeId, parsed.idempotencyKey),
    };
  }
  return { order, actor, hash, parsed, replay: null };
}

export async function markPaid(input: {
  database: D1Database;
  context: OrderContext;
  orderId: string;
  body: unknown;
  idempotencyKey: unknown;
}): Promise<OrderCommandResult> {
  const prepared = await prepareCommand({
    database: input.database,
    context: input.context,
    orderId: input.orderId,
    action: 'mark_paid',
    parse: () => parseManualPaymentInput(input.body, input.idempotencyKey),
    canonicalBody: (parsed) => ['manual', parsed.method, parsed.reference],
  });
  if (prepared.replay) return prepared.replay;
  const parsed = prepared.parsed;

  const existingPayment = await readExistingPayment(input.database, input.context.storeId, prepared.order.id);
  if (existingPayment) {
    if (
      existingPayment.method !== parsed.method
      || existingPayment.external_reference !== parsed.reference
    ) {
      paymentConflict();
    }
    return bindExistingResult({
      database: input.database,
      storeId: input.context.storeId,
      requestKey: parsed.idempotencyKey,
      orderId: prepared.order.id,
      action: 'mark_paid',
      hash: prepared.hash,
      historyId: existingPayment.history_id,
      refundRequestId: null,
    });
  }

  const colliding = await input.database.prepare(
    `SELECT 1 AS taken
       FROM payments
      WHERE store_id = ? AND source = 'manual' AND external_reference = ?`,
  ).bind(input.context.storeId, parsed.reference).first<{ taken: number }>();
  if (colliding) paymentConflict();

  if (prepared.order.status !== 'pending') stateConflict();

  const historyId = stableId('hist');
  const commandId = stableId('cmd');
  const recordedPaymentId = `pay_${crypto.randomUUID().replaceAll('-', '')}`;
  return runCommandBatch({
    database: input.database,
    storeId: input.context.storeId,
    requestKey: parsed.idempotencyKey,
    action: 'mark_paid',
    orderId: prepared.order.id,
    hash: prepared.hash,
    eligible: (status) => status === 'pending',
    onConflictReplay: async () => {
      const payment = await readExistingPayment(input.database, input.context.storeId, prepared.order.id);
      if (payment) {
        if (payment.method !== parsed.method || payment.external_reference !== parsed.reference) {
          paymentConflict();
        }
        return bindExistingResult({
          database: input.database,
          storeId: input.context.storeId,
          requestKey: parsed.idempotencyKey,
          orderId: prepared.order.id,
          action: 'mark_paid',
          hash: prepared.hash,
          historyId: payment.history_id,
          refundRequestId: null,
        });
      }
      const taken = await input.database.prepare(
        `SELECT 1 AS taken
           FROM payments
          WHERE store_id = ? AND source = 'manual' AND external_reference = ?`,
      ).bind(input.context.storeId, parsed.reference).first<{ taken: number }>();
      if (taken) paymentConflict();
      return null;
    },
    statements: [
      input.database.prepare(
        `INSERT INTO order_history (
           id, store_id, order_id, status, action, source, from_status, actor_id, contract_version
         )
         SELECT ?, ?, ?, 'paid', 'order_paid', ?, 'pending', ?, 2
           FROM orders
          WHERE store_id = ? AND id = ? AND status = 'pending'`,
      ).bind(
        historyId,
        input.context.storeId,
        prepared.order.id,
        prepared.actor.source,
        prepared.actor.id,
        input.context.storeId,
        prepared.order.id,
      ),
      input.database.prepare(
        `INSERT INTO payments (
           id, store_id, order_id, source, method, external_reference, amount_minor, currency,
           status, history_id, recorded_actor_source, recorded_actor_id
         )
         SELECT ?, ?, orders.id, 'manual', ?, ?, orders.total_minor, orders.currency,
                'succeeded', ?, ?, ?
           FROM orders
           JOIN order_history history
             ON history.id = ? AND history.store_id = orders.store_id AND history.order_id = orders.id
          WHERE orders.store_id = ? AND orders.id = ? AND orders.status = 'pending'`,
      ).bind(
        recordedPaymentId,
        input.context.storeId,
        parsed.method,
        parsed.reference,
        historyId,
        prepared.actor.source,
        prepared.actor.id,
        historyId,
        input.context.storeId,
        prepared.order.id,
      ),
      input.database.prepare(
        `UPDATE orders
            SET status = 'paid'
          WHERE store_id = ? AND id = ? AND status = 'pending'
            AND EXISTS (
              SELECT 1 FROM payments
               WHERE id = ? AND store_id = ? AND order_id = ? AND history_id = ?
            )`,
      ).bind(
        input.context.storeId,
        prepared.order.id,
        recordedPaymentId,
        input.context.storeId,
        prepared.order.id,
        historyId,
      ),
      input.database.prepare(
        `INSERT INTO order_commands (
           id, store_id, request_key, order_id, action, payload_hash, result_history_id, contract_version
         ) VALUES (
           CASE WHEN (
             SELECT status FROM orders WHERE store_id = ? AND id = ?
           ) = 'paid' AND (
             SELECT id FROM payments WHERE id = ? AND store_id = ? AND order_id = ?
           ) IS NOT NULL AND (
             SELECT id FROM order_history WHERE id = ? AND store_id = ? AND order_id = ?
           ) IS NOT NULL THEN ? ELSE NULL END,
           ?, ?, ?, 'mark_paid', ?, ?, 2
         )`,
      ).bind(
        input.context.storeId,
        prepared.order.id,
        recordedPaymentId,
        input.context.storeId,
        prepared.order.id,
        historyId,
        input.context.storeId,
        prepared.order.id,
        commandId,
        input.context.storeId,
        parsed.idempotencyKey,
        prepared.order.id,
        prepared.hash,
        historyId,
      ),
    ],
  });
}

export async function fulfillOrder(input: {
  database: D1Database;
  context: OrderContext;
  orderId: string;
  body: unknown;
  idempotencyKey: unknown;
}): Promise<OrderCommandResult> {
  const prepared = await prepareCommand({
    database: input.database,
    context: input.context,
    orderId: input.orderId,
    action: 'fulfill',
    parse: () => parseFulfillOrderInput(input.body, input.idempotencyKey),
    canonicalBody: () => [],
  });
  if (prepared.replay) return prepared.replay;
  const parsed = prepared.parsed;

  const existingHistoryId = await readDecisionHistoryId(
    input.database,
    input.context.storeId,
    prepared.order.id,
    'order_fulfilled',
  );
  if (existingHistoryId) {
    return bindExistingResult({
      database: input.database,
      storeId: input.context.storeId,
      requestKey: parsed.idempotencyKey,
      orderId: prepared.order.id,
      action: 'fulfill',
      hash: prepared.hash,
      historyId: existingHistoryId,
      refundRequestId: null,
    });
  }

  if (prepared.order.status !== 'paid') stateConflict();

  const historyId = stableId('hist');
  const commandId = stableId('cmd');
  return runCommandBatch({
    database: input.database,
    storeId: input.context.storeId,
    requestKey: parsed.idempotencyKey,
    action: 'fulfill',
    orderId: prepared.order.id,
    hash: prepared.hash,
    eligible: (status) => status === 'paid',
    onConflictReplay: async () => {
      const existing = await readDecisionHistoryId(
        input.database,
        input.context.storeId,
        prepared.order.id,
        'order_fulfilled',
      );
      if (!existing) return null;
      return bindExistingResult({
        database: input.database,
        storeId: input.context.storeId,
        requestKey: parsed.idempotencyKey,
        orderId: prepared.order.id,
        action: 'fulfill',
        hash: prepared.hash,
        historyId: existing,
        refundRequestId: null,
      });
    },
    statements: [
      input.database.prepare(
        `INSERT INTO order_history (
           id, store_id, order_id, status, action, source, from_status, actor_id, contract_version
         )
         SELECT ?, ?, ?, 'fulfilled', 'order_fulfilled', ?, 'paid', ?, 2
           FROM orders
          WHERE store_id = ? AND id = ? AND status = 'paid'`,
      ).bind(
        historyId,
        input.context.storeId,
        prepared.order.id,
        prepared.actor.source,
        prepared.actor.id,
        input.context.storeId,
        prepared.order.id,
      ),
      input.database.prepare(
        `UPDATE orders
            SET status = 'fulfilled'
          WHERE store_id = ? AND id = ? AND status = 'paid'
            AND EXISTS (
              SELECT 1 FROM order_history
               WHERE id = ? AND store_id = ? AND order_id = ?
            )`,
      ).bind(
        input.context.storeId,
        prepared.order.id,
        historyId,
        input.context.storeId,
        prepared.order.id,
      ),
      input.database.prepare(
        `INSERT INTO order_commands (
           id, store_id, request_key, order_id, action, payload_hash, result_history_id, contract_version
         ) VALUES (
           CASE WHEN (
             SELECT status FROM orders WHERE store_id = ? AND id = ?
           ) = 'fulfilled' AND (
             SELECT id FROM order_history WHERE id = ? AND store_id = ? AND order_id = ?
           ) IS NOT NULL THEN ? ELSE NULL END,
           ?, ?, ?, 'fulfill', ?, ?, 2
         )`,
      ).bind(
        input.context.storeId,
        prepared.order.id,
        historyId,
        input.context.storeId,
        prepared.order.id,
        commandId,
        input.context.storeId,
        parsed.idempotencyKey,
        prepared.order.id,
        prepared.hash,
        historyId,
      ),
    ],
  });
}

export async function cancelOrder(input: {
  database: D1Database;
  context: OrderContext;
  orderId: string;
  body: unknown;
  idempotencyKey: unknown;
}): Promise<OrderCommandResult> {
  const prepared = await prepareCommand({
    database: input.database,
    context: input.context,
    orderId: input.orderId,
    action: 'cancel',
    parse: () => parseCancelOrderInput(input.body, input.idempotencyKey),
    canonicalBody: () => [],
  });
  if (prepared.replay) return prepared.replay;
  const parsed = prepared.parsed;

  const existingHistoryId = await readDecisionHistoryId(
    input.database,
    input.context.storeId,
    prepared.order.id,
    'order_canceled',
  );
  if (existingHistoryId) {
    return bindExistingResult({
      database: input.database,
      storeId: input.context.storeId,
      requestKey: parsed.idempotencyKey,
      orderId: prepared.order.id,
      action: 'cancel',
      hash: prepared.hash,
      historyId: existingHistoryId,
      refundRequestId: null,
    });
  }

  if (prepared.order.status !== 'pending') stateConflict();

  const historyId = stableId('hist');
  const commandId = stableId('cmd');
  return runCommandBatch({
    database: input.database,
    storeId: input.context.storeId,
    requestKey: parsed.idempotencyKey,
    action: 'cancel',
    orderId: prepared.order.id,
    hash: prepared.hash,
    eligible: (status) => status === 'pending',
    onConflictReplay: async () => {
      const existing = await readDecisionHistoryId(
        input.database,
        input.context.storeId,
        prepared.order.id,
        'order_canceled',
      );
      if (!existing) return null;
      return bindExistingResult({
        database: input.database,
        storeId: input.context.storeId,
        requestKey: parsed.idempotencyKey,
        orderId: prepared.order.id,
        action: 'cancel',
        hash: prepared.hash,
        historyId: existing,
        refundRequestId: null,
      });
    },
    statements: [
      input.database.prepare(
        `INSERT INTO order_history (
           id, store_id, order_id, status, action, source, from_status, actor_id, contract_version
         )
         SELECT ?, ?, ?, 'canceled', 'order_canceled', ?, 'pending', ?, 2
           FROM orders
          WHERE store_id = ? AND id = ? AND status = 'pending'`,
      ).bind(
        historyId,
        input.context.storeId,
        prepared.order.id,
        prepared.actor.source,
        prepared.actor.id,
        input.context.storeId,
        prepared.order.id,
      ),
      input.database.prepare(
        `UPDATE orders
            SET status = 'canceled'
          WHERE store_id = ? AND id = ? AND status = 'pending'
            AND EXISTS (
              SELECT 1 FROM order_history
               WHERE id = ? AND store_id = ? AND order_id = ?
            )`,
      ).bind(
        input.context.storeId,
        prepared.order.id,
        historyId,
        input.context.storeId,
        prepared.order.id,
      ),
      input.database.prepare(
        `INSERT INTO order_commands (
           id, store_id, request_key, order_id, action, payload_hash, result_history_id, contract_version
         ) VALUES (
           CASE WHEN (
             SELECT status FROM orders WHERE store_id = ? AND id = ?
           ) = 'canceled' AND (
             SELECT id FROM order_history WHERE id = ? AND store_id = ? AND order_id = ?
           ) IS NOT NULL THEN ? ELSE NULL END,
           ?, ?, ?, 'cancel', ?, ?, 2
         )`,
      ).bind(
        input.context.storeId,
        prepared.order.id,
        historyId,
        input.context.storeId,
        prepared.order.id,
        commandId,
        input.context.storeId,
        parsed.idempotencyKey,
        prepared.order.id,
        prepared.hash,
        historyId,
      ),
    ],
  });
}

export async function createRefundRequest(input: {
  database: D1Database;
  context: OrderContext;
  orderId: string;
  body: unknown;
  idempotencyKey: unknown;
}): Promise<OrderCommandResult> {
  const prepared = await prepareCommand({
    database: input.database,
    context: input.context,
    orderId: input.orderId,
    action: 'request_refund',
    parse: () => parseRefundRequestInput(input.body, input.idempotencyKey),
    canonicalBody: (parsed) => [parsed.reason],
  });
  if (prepared.replay) return prepared.replay;
  const parsed = prepared.parsed;

  const open = await readOpenRefund(input.database, input.context.storeId, prepared.order.id);
  if (open) {
    return bindExistingResult({
      database: input.database,
      storeId: input.context.storeId,
      requestKey: parsed.idempotencyKey,
      orderId: prepared.order.id,
      action: 'request_refund',
      hash: prepared.hash,
      historyId: open.history_id,
      refundRequestId: open.id,
    });
  }

  const eligibility = await input.database.prepare(REFUND_ELIGIBILITY_SQL)
    .bind(input.context.storeId, prepared.order.id)
    .first<{ eligibility_status: OrderStatus }>();
  if (!eligibility) notFound();
  if (eligibility.eligibility_status !== 'paid' && eligibility.eligibility_status !== 'fulfilled') {
    stateConflict();
  }

  const requestId = stableId('rrq');
  const historyId = stableId('hist');
  const commandId = stableId('cmd');
  return runCommandBatch({
    database: input.database,
    storeId: input.context.storeId,
    requestKey: parsed.idempotencyKey,
    action: 'request_refund',
    orderId: prepared.order.id,
    hash: prepared.hash,
    eligible: (status) => status === 'paid' || status === 'fulfilled',
    onConflictReplay: async () => {
      const open = await readOpenRefund(input.database, input.context.storeId, prepared.order.id);
      if (!open) return null;
      return bindExistingResult({
        database: input.database,
        storeId: input.context.storeId,
        requestKey: parsed.idempotencyKey,
        orderId: prepared.order.id,
        action: 'request_refund',
        hash: prepared.hash,
        historyId: open.history_id,
        refundRequestId: open.id,
      });
    },
    statements: [
      input.database.prepare(
        `INSERT INTO order_refund_requests (
           id, store_id, order_id, status, reason, actor_source, actor_id
         )
         SELECT ?, ?, ?, 'pending', ?, ?, ?
           FROM orders
          WHERE store_id = ? AND id = ? AND status IN ('paid', 'fulfilled')
            AND NOT EXISTS (
              SELECT 1 FROM order_refund_requests
               WHERE store_id = ? AND order_id = ? AND status = 'pending'
            )`,
      ).bind(
        requestId,
        input.context.storeId,
        prepared.order.id,
        parsed.reason,
        prepared.actor.source,
        prepared.actor.id,
        input.context.storeId,
        prepared.order.id,
        input.context.storeId,
        prepared.order.id,
      ),
      input.database.prepare(
        `INSERT INTO order_history (
           id, store_id, order_id, status, action, source, from_status, actor_id,
           contract_version, refund_request_id
         )
         SELECT ?, orders.store_id, orders.id, orders.status, 'refund_requested', ?, orders.status, ?, 2, ?
           FROM orders
           JOIN order_refund_requests requests
             ON requests.id = ? AND requests.store_id = orders.store_id AND requests.order_id = orders.id
          WHERE orders.store_id = ? AND orders.id = ? AND orders.status IN ('paid', 'fulfilled')`,
      ).bind(
        historyId,
        prepared.actor.source,
        prepared.actor.id,
        requestId,
        requestId,
        input.context.storeId,
        prepared.order.id,
      ),
      input.database.prepare(
        `INSERT INTO order_commands (
           id, store_id, request_key, order_id, action, payload_hash, result_history_id,
           contract_version, result_refund_request_id
         ) VALUES (
           CASE WHEN (
             SELECT status FROM orders WHERE store_id = ? AND id = ?
           ) IN ('paid', 'fulfilled') AND (
             SELECT id FROM order_refund_requests WHERE id = ? AND store_id = ? AND order_id = ?
           ) IS NOT NULL AND (
             SELECT id FROM order_history WHERE id = ? AND store_id = ? AND order_id = ?
           ) IS NOT NULL THEN ? ELSE NULL END,
           ?, ?, ?, 'request_refund', ?, ?, 2, ?
         )`,
      ).bind(
        input.context.storeId,
        prepared.order.id,
        requestId,
        input.context.storeId,
        prepared.order.id,
        historyId,
        input.context.storeId,
        prepared.order.id,
        commandId,
        input.context.storeId,
        parsed.idempotencyKey,
        prepared.order.id,
        prepared.hash,
        historyId,
        requestId,
      ),
    ],
  });
}
