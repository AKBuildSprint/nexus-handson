import { stableId } from '@nexus/catalog/slug';
import {
  OrderValidationError,
  type OrderActor,
  type OrderCommandAction,
  type OrderCommandResult,
  type OrderContext,
  type OrderStatus,
} from '../order-types';
import {
  parseCancelOrderInput,
  parseFulfillOrderInput,
  parseManualPaymentInput,
  parseRefundRequestInput,
} from '../order-validation';
import {
  bindExistingResult,
  keyConflict,
  legacyKeyConflict,
  ledgerMatches,
  notFound,
  readCommandResult,
  readDecisionHistoryId,
  readExistingPayment,
  readLedger,
  readOpenRefund,
  readOrderTarget,
  runCommandBatch,
  stateConflict,
  type OrderCommandTarget,
} from '../persistence/command-store';
import {
  authorizedActor,
  cancelEligible,
  fulfillEligible,
  markPaidEligible,
  refundEligible,
} from '../transitions/order-transitions';

const encoder = new TextEncoder();

const REFUND_ELIGIBILITY_SQL =
  'SELECT status AS eligibility_status FROM orders WHERE store_id = ? AND id = ?';

function paymentConflict(): never {
  throw new OrderValidationError(
    'payment_conflict',
    'This payment cannot be recorded for the Order.',
    [],
    409,
  );
}

async function payloadHash(parts: unknown[]): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

  if (!markPaidEligible(prepared.order.status)) stateConflict();

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
    eligible: markPaidEligible,
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

  if (!fulfillEligible(prepared.order.status)) stateConflict();

  const historyId = stableId('hist');
  const commandId = stableId('cmd');
  return runCommandBatch({
    database: input.database,
    storeId: input.context.storeId,
    requestKey: parsed.idempotencyKey,
    action: 'fulfill',
    orderId: prepared.order.id,
    hash: prepared.hash,
    eligible: fulfillEligible,
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

  if (!cancelEligible(prepared.order.status)) stateConflict();

  const historyId = stableId('hist');
  const commandId = stableId('cmd');
  return runCommandBatch({
    database: input.database,
    storeId: input.context.storeId,
    requestKey: parsed.idempotencyKey,
    action: 'cancel',
    orderId: prepared.order.id,
    hash: prepared.hash,
    eligible: cancelEligible,
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
  if (!refundEligible(eligibility.eligibility_status)) {
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
    eligible: refundEligible,
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
