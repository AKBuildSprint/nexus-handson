import { BOOTSTRAP_STORE_ID } from '@nexus/catalog/catalog-read';
import { stableId } from '@nexus/catalog/slug';
import { readConsoleOrderDetail, readCustomerOrderById } from './order-read';
import {
  OrderPersistenceError,
  OrderValidationError,
  type ConsoleOrderAction,
  type ConsoleOrderDetailProjection,
  type CustomerOrderProjection,
  type OrderCommandResult,
  type OrderStatus,
} from './order-types';
import {
  parseConsoleOrderActionBody,
  parseOrderIdempotencyKey,
  parseOrderRefundBody,
} from './order-validation';

interface CommandRow {
  id: string;
  order_id: string;
  action: string;
  payload_digest: string;
  outcome: 'applied' | 'already_applied';
  result_status: OrderStatus;
}

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function consoleCanonical(action: ConsoleOrderAction, acknowledgedRefundRequestId: string | null): string {
  if (action === 'mark_fulfilled') {
    return JSON.stringify({ action: 'mark_fulfilled', acknowledgedRefundRequestId });
  }
  return JSON.stringify({ action });
}

async function readCommand(database: D1Database, requestKey: string): Promise<CommandRow | null> {
  try {
    return await database.prepare(
      `SELECT id, order_id, action, payload_digest, outcome, result_status
         FROM order_commands
        WHERE store_id = ? AND request_key = ?`,
    ).bind(BOOTSTRAP_STORE_ID, requestKey).first<CommandRow>();
  } catch (error) {
    throw new OrderPersistenceError(error);
  }
}

async function readOrderIdByReference(database: D1Database, reference: string): Promise<string | null> {
  try {
    const row = await database.prepare(
      'SELECT id FROM orders WHERE store_id = ? AND reference = ?',
    ).bind(BOOTSTRAP_STORE_ID, reference).first<{ id: string }>();
    return row?.id ?? null;
  } catch (error) {
    throw new OrderPersistenceError(error);
  }
}

function idempotencyConflict(): never {
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
    'The Order cannot accept this command in its current state.',
    [],
    409,
  );
}

function acknowledgementRequired(): never {
  throw new OrderValidationError(
    'refund_acknowledgement_required',
    'Fulfillment requires acknowledgement of the current Refund Request.',
    [],
    409,
  );
}

function commandResult(row: CommandRow, candidateId: string): OrderCommandResult {
  return {
    outcome: row.outcome,
    replayed: row.id !== candidateId,
    resultStatus: row.result_status,
  };
}

function consoleCommandInsert(input: {
  database: D1Database;
  candidateId: string;
  requestKey: string;
  orderId: string;
  action: ConsoleOrderAction;
  digest: string;
  historyId: string;
  createdAt: string;
  acknowledgedRefundRequestId: string | null;
}): D1PreparedStatement {
  if (input.action === 'mark_paid') {
    return input.database.prepare(
      `INSERT INTO order_commands (
         id, store_id, request_key, order_id, action, payload_digest,
         outcome, result_status, history_id, refund_request_id, created_at
       )
       SELECT ?, ?, ?, o.id, 'mark_paid', ?,
              CASE o.status WHEN 'pending_payment' THEN 'applied' WHEN 'paid' THEN 'already_applied' END,
              'paid',
              CASE o.status WHEN 'pending_payment' THEN ? ELSE NULL END,
              NULL, ?
         FROM orders o
        WHERE o.store_id = ? AND o.id = ? AND o.status IN ('pending_payment', 'paid')
       ON CONFLICT(store_id, request_key) DO NOTHING`,
    ).bind(
      input.candidateId,
      BOOTSTRAP_STORE_ID,
      input.requestKey,
      input.digest,
      input.historyId,
      input.createdAt,
      BOOTSTRAP_STORE_ID,
      input.orderId,
    );
  }
  if (input.action === 'cancel') {
    return input.database.prepare(
      `INSERT INTO order_commands (
         id, store_id, request_key, order_id, action, payload_digest,
         outcome, result_status, history_id, refund_request_id, created_at
       )
       SELECT ?, ?, ?, o.id, 'cancel', ?, 'applied', 'cancelled', ?, NULL, ?
         FROM orders o
        WHERE o.store_id = ? AND o.id = ? AND o.status = 'pending_payment'
       ON CONFLICT(store_id, request_key) DO NOTHING`,
    ).bind(
      input.candidateId,
      BOOTSTRAP_STORE_ID,
      input.requestKey,
      input.digest,
      input.historyId,
      input.createdAt,
      BOOTSTRAP_STORE_ID,
      input.orderId,
    );
  }
  return input.database.prepare(
    `INSERT INTO order_commands (
       id, store_id, request_key, order_id, action, payload_digest,
       outcome, result_status, history_id, refund_request_id, created_at
     )
     SELECT ?, ?, ?, o.id, 'mark_fulfilled', ?, 'applied', 'fulfilled', ?, rr.id, ?
       FROM orders o
       LEFT JOIN refund_requests rr
         ON rr.order_id = o.id AND rr.store_id = o.store_id
      WHERE o.store_id = ? AND o.id = ? AND o.status = 'paid'
        AND ((rr.id IS NULL AND ? IS NULL) OR rr.id = ?)
     ON CONFLICT(store_id, request_key) DO NOTHING`,
  ).bind(
    input.candidateId,
    BOOTSTRAP_STORE_ID,
    input.requestKey,
    input.digest,
    input.historyId,
    input.createdAt,
    BOOTSTRAP_STORE_ID,
    input.orderId,
    input.acknowledgedRefundRequestId,
    input.acknowledgedRefundRequestId,
  );
}

function consoleStatusUpdate(input: {
  database: D1Database;
  candidateId: string;
  orderId: string;
  action: ConsoleOrderAction;
}): D1PreparedStatement | null {
  const nextStatus = input.action === 'mark_paid'
    ? 'paid'
    : input.action === 'cancel'
      ? 'cancelled'
      : 'fulfilled';
  const fromStatus = input.action === 'mark_fulfilled' ? 'paid' : 'pending_payment';
  return input.database.prepare(
    `UPDATE orders
        SET status = ?
      WHERE store_id = ? AND id = ? AND status = ?
        AND EXISTS (
          SELECT 1 FROM order_commands
           WHERE id = ? AND store_id = ? AND order_id = ? AND action = ? AND outcome = 'applied'
        )`,
  ).bind(
    nextStatus,
    BOOTSTRAP_STORE_ID,
    input.orderId,
    fromStatus,
    input.candidateId,
    BOOTSTRAP_STORE_ID,
    input.orderId,
    input.action,
  );
}

function historyFromCandidate(database: D1Database, candidateId: string, orderId: string): D1PreparedStatement {
  return database.prepare(
    `INSERT INTO order_history (
       id, store_id, order_id, sequence, action, previous_status, status, source, refund_request_id, created_at
     )
     SELECT c.history_id, c.store_id, c.order_id,
            (SELECT COALESCE(MAX(h.sequence), -1) + 1
               FROM order_history h
              WHERE h.store_id = c.store_id AND h.order_id = c.order_id),
            CASE c.action WHEN 'request_refund' THEN 'refund_requested' ELSE c.action END,
            CASE c.action
              WHEN 'mark_paid' THEN 'pending_payment'
              WHEN 'cancel' THEN 'pending_payment'
              WHEN 'mark_fulfilled' THEN 'paid'
              WHEN 'request_refund' THEN o.status
            END,
            CASE c.action WHEN 'request_refund' THEN o.status ELSE c.result_status END,
            CASE c.action WHEN 'request_refund' THEN 'storefront' ELSE 'console' END,
            c.refund_request_id,
            c.created_at
       FROM order_commands c
       JOIN orders o ON o.id = c.order_id AND o.store_id = c.store_id
      WHERE c.id = ? AND c.store_id = ? AND c.order_id = ? AND c.outcome = 'applied'`,
  ).bind(candidateId, BOOTSTRAP_STORE_ID, orderId);
}

async function classifyStoredCommand<T>(input: {
  database: D1Database;
  requestKey: string;
  orderId: string;
  action: string;
  digest: string;
  candidateId: string;
  batchError: unknown;
  readCurrent: () => Promise<T | null>;
  diagnose: (current: T | null) => never;
}): Promise<{ order: T; command: OrderCommandResult }> {
  let stored: CommandRow | null;
  try {
    stored = await readCommand(input.database, input.requestKey);
  } catch (error) {
    if (error instanceof OrderPersistenceError) throw error;
    throw new OrderPersistenceError(error);
  }
  if (stored) {
    if (stored.order_id !== input.orderId || stored.action !== input.action || stored.payload_digest !== input.digest) {
      idempotencyConflict();
    }
    const current = await input.readCurrent();
    if (!current) throw new OrderPersistenceError(new Error('The command result has no Order aggregate.'));
    return { order: current, command: commandResult(stored, input.candidateId) };
  }
  if (input.batchError) throw new OrderPersistenceError(input.batchError);
  let current: T | null;
  try {
    current = await input.readCurrent();
  } catch (error) {
    throw new OrderPersistenceError(error);
  }
  input.diagnose(current);
}

export async function executeConsoleOrderAction(input: {
  database: D1Database;
  reference: string;
  body: unknown;
  idempotencyKey: unknown;
}): Promise<{ order: ConsoleOrderDetailProjection; command: OrderCommandResult }> {
  const body = parseConsoleOrderActionBody(input.body);
  const requestKey = parseOrderIdempotencyKey(input.idempotencyKey);
  const digest = await sha256Hex(consoleCanonical(body.action, body.acknowledgedRefundRequestId));
  const existing = await readCommand(input.database, requestKey);
  const orderId = await readOrderIdByReference(input.database, input.reference);
  if (existing) {
    if (!orderId || existing.order_id !== orderId || existing.action !== body.action || existing.payload_digest !== digest) {
      idempotencyConflict();
    }
    const order = await readConsoleOrderDetail(input.database, input.reference);
    if (!order) throw new OrderPersistenceError(new Error('The command result has no Order aggregate.'));
    return { order, command: commandResult(existing, '') };
  }
  if (!orderId) {
    throw new OrderValidationError('not_found', 'Order not found.', [], 404);
  }

  const candidateId = stableId('cmd');
  const historyId = stableId('hist');
  const createdAt = new Date().toISOString();
  const update = consoleStatusUpdate({
    database: input.database,
    candidateId,
    orderId,
    action: body.action,
  });
  let batchError: unknown;
  try {
    await input.database.batch([
      consoleCommandInsert({
        database: input.database,
        candidateId,
        requestKey,
        orderId,
        action: body.action,
        digest,
        historyId,
        createdAt,
        acknowledgedRefundRequestId: body.acknowledgedRefundRequestId,
      }),
      update,
      historyFromCandidate(input.database, candidateId, orderId),
    ].filter((statement): statement is D1PreparedStatement => statement !== null));
  } catch (error) {
    batchError = error;
  }

  return classifyStoredCommand({
    database: input.database,
    requestKey,
    orderId,
    action: body.action,
    digest,
    candidateId,
    batchError,
    readCurrent: () => readConsoleOrderDetail(input.database, input.reference),
    diagnose: (current) => {
      if (
        body.action === 'mark_fulfilled'
        && current?.status === 'paid'
        && current.refundRequest !== null
        && current.refundRequest.id !== body.acknowledgedRefundRequestId
      ) {
        acknowledgementRequired();
      }
      stateConflict();
    },
  });
}

export async function requestOrderRefund(input: {
  database: D1Database;
  orderId: string;
  body: unknown;
  idempotencyKey: unknown;
}): Promise<{ order: CustomerOrderProjection; command: OrderCommandResult }> {
  const body = parseOrderRefundBody(input.body);
  const requestKey = parseOrderIdempotencyKey(input.idempotencyKey);
  const digest = await sha256Hex(JSON.stringify({ action: 'request_refund', reason: body.reason }));
  const existing = await readCommand(input.database, requestKey);
  if (existing) {
    if (existing.order_id !== input.orderId || existing.action !== 'request_refund' || existing.payload_digest !== digest) {
      idempotencyConflict();
    }
    const order = await readCustomerOrderById(input.database, input.orderId);
    if (!order) throw new OrderPersistenceError(new Error('The command result has no Order aggregate.'));
    return { order, command: commandResult(existing, '') };
  }

  const candidateId = stableId('cmd');
  const historyId = stableId('hist');
  const refundId = stableId('refund');
  const createdAt = new Date().toISOString();
  let batchError: unknown;
  try {
    await input.database.batch([
      input.database.prepare(
        `INSERT INTO refund_requests (id, store_id, order_id, reason, status, created_at)
         SELECT ?, ?, o.id, ?, 'pending', ?
           FROM orders o
          WHERE o.store_id = ? AND o.id = ?
            AND o.status IN ('paid', 'fulfilled')
            AND NOT EXISTS (
              SELECT 1 FROM order_commands WHERE store_id = ? AND request_key = ?
            )
         ON CONFLICT(order_id, store_id) DO NOTHING`,
      ).bind(
        refundId,
        BOOTSTRAP_STORE_ID,
        body.reason,
        createdAt,
        BOOTSTRAP_STORE_ID,
        input.orderId,
        BOOTSTRAP_STORE_ID,
        requestKey,
      ),
      input.database.prepare(
        `INSERT INTO order_commands (
           id, store_id, request_key, order_id, action, payload_digest,
           outcome, result_status, history_id, refund_request_id, created_at
         )
         SELECT ?, ?, ?, o.id, 'request_refund', ?,
                CASE WHEN r.id = ? THEN 'applied' ELSE 'already_applied' END,
                o.status,
                CASE WHEN r.id = ? THEN ? ELSE NULL END,
                r.id, ?
           FROM orders o
           JOIN refund_requests r ON r.store_id = o.store_id AND r.order_id = o.id
          WHERE o.store_id = ? AND o.id = ? AND o.status IN ('paid', 'fulfilled')
         ON CONFLICT(store_id, request_key) DO NOTHING`,
      ).bind(
        candidateId,
        BOOTSTRAP_STORE_ID,
        requestKey,
        digest,
        refundId,
        refundId,
        historyId,
        createdAt,
        BOOTSTRAP_STORE_ID,
        input.orderId,
      ),
      input.database.prepare(
        `INSERT INTO order_history (
           id, store_id, order_id, sequence, action, previous_status, status, source, refund_request_id, created_at
         )
         SELECT c.history_id, c.store_id, c.order_id,
                (SELECT COALESCE(MAX(h.sequence), -1) + 1
                   FROM order_history h
                  WHERE h.store_id = c.store_id AND h.order_id = c.order_id),
                'refund_requested', o.status, o.status, 'storefront', r.id, c.created_at
           FROM order_commands c
           JOIN orders o ON o.id = c.order_id AND o.store_id = c.store_id
           JOIN refund_requests r
             ON r.id = c.refund_request_id AND r.store_id = c.store_id AND r.order_id = c.order_id
          WHERE c.id = ? AND c.store_id = ? AND c.order_id = ?
            AND c.outcome = 'applied'
            AND r.id = ?`,
      ).bind(candidateId, BOOTSTRAP_STORE_ID, input.orderId, refundId),
    ]);
  } catch (error) {
    batchError = error;
  }

  return classifyStoredCommand({
    database: input.database,
    requestKey,
    orderId: input.orderId,
    action: 'request_refund',
    digest,
    candidateId,
    batchError,
    readCurrent: () => readCustomerOrderById(input.database, input.orderId),
    diagnose: () => stateConflict(),
  });
}
