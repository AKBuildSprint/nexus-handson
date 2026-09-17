import { NEXUS_STORE_ID } from '@nexus/identity/identity-types';
import { assertCurrentConsoleMembership, requireConsoleIdentity, requirePermission } from '../order-access';
import { OrderValidationError, type OrderContext, type OrderStatus, type ProviderEventType } from '../order-types';

interface ProviderEventListRow {
  id: string;
  type: ProviderEventType;
  provider: string;
  provider_event_id: string;
  payload_json: string;
  received_at: string;
  order_reference: string | null;
  order_status: OrderStatus | null;
}

export interface ConsoleProviderEventListQuery {
  limit: number;
  cursor: string | null;
}

export interface ConsoleProviderEventProjection {
  id: string;
  type: ProviderEventType;
  provider: string;
  providerEventId: string;
  payloadJson: string;
  receivedAt: string;
  order: { reference: string; status: OrderStatus } | null;
}

export interface ConsoleProviderEventListResponse {
  events: ConsoleProviderEventProjection[];
  nextCursor: string | null;
  hasEvents: boolean;
}

function invalidQuery(): never {
  throw new OrderValidationError('invalid_query', 'The third-party log query is invalid.', [], 400);
}

function encodeCursor(tuple: [1, string, string, string, string, string, number]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(tuple));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(cursor: string, query: ConsoleProviderEventListQuery, context: OrderContext): { receivedAt: string; id: string } {
  let json: string;
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (cursor.length % 4)) % 4);
    const binary = atob(padded);
    json = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    return invalidQuery();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return invalidQuery();
  }
  if (!Array.isArray(parsed) || parsed.length !== 7) return invalidQuery();

  const [version, storeId, userId, role, receivedAt, id, limit] = parsed as unknown[];
  const identity = requireConsoleIdentity(context.identity);
  if (
    version !== 1
    || storeId !== context.storeId
    || userId !== identity.userId
    || role !== identity.role
    || typeof receivedAt !== 'string'
    || typeof id !== 'string'
    || !Number.isInteger(limit)
    || limit !== query.limit
  ) return invalidQuery();
  return { receivedAt, id };
}

function visibility(context: OrderContext): { sql: string; binds: [string, number] } {
  return {
    sql: '(events.store_id = ? OR (? = 1 AND events.store_id IS NULL))',
    binds: [context.storeId, context.storeId === NEXUS_STORE_ID ? 1 : 0],
  };
}

export async function listConsoleProviderEvents(
  database: D1Database,
  context: OrderContext,
  query: ConsoleProviderEventListQuery,
): Promise<ConsoleProviderEventListResponse> {
  const identity = requireConsoleIdentity(context.identity);
  requirePermission(identity, 'provider-events:read', { storeId: context.storeId });
  const seek = query.cursor === null ? null : decodeCursor(query.cursor, query, context);
  const predicate = visibility(context);
  const seekSql = seek === null ? '' : ' AND (events.received_at < ? OR (events.received_at = ? AND events.id < ?))';
  const pageSql = `SELECT events.id, events.type, events.provider, events.provider_event_id,
       events.payload_json, events.received_at,
       COALESCE(direct_order.reference, payment_order.reference) AS order_reference,
       COALESCE(direct_order.status, payment_order.status) AS order_status
  FROM provider_events events
  LEFT JOIN orders direct_order
    ON direct_order.id = events.order_id AND direct_order.store_id = events.store_id
  LEFT JOIN provider_payments payment
    ON payment.id = (
      SELECT candidate.id
        FROM provider_payments candidate
       WHERE candidate.event_id = events.id
       ORDER BY candidate.recorded_at DESC, candidate.id DESC
       LIMIT 1
    )
  LEFT JOIN orders payment_order
    ON payment_order.id = payment.order_id AND payment_order.store_id = payment.store_id
 WHERE ${predicate.sql}${seekSql}
 ORDER BY events.received_at DESC, events.id DESC
 LIMIT ?`;
  const pageBinds: Array<string | number> = seek === null
    ? [...predicate.binds, query.limit + 1]
    : [...predicate.binds, seek.receivedAt, seek.receivedAt, seek.id, query.limit + 1];
  const hasSql = `SELECT EXISTS(SELECT 1 FROM provider_events events WHERE ${predicate.sql}) AS has_events`;
  const [pageResult, hasResult] = await database.batch([
    database.prepare(pageSql).bind(...pageBinds),
    database.prepare(hasSql).bind(...predicate.binds),
  ]);
  await assertCurrentConsoleMembership(database, identity);

  const rows = pageResult.results as ProviderEventListRow[];
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    events: page.map((event) => ({
      id: event.id,
      type: event.type,
      provider: event.provider,
      providerEventId: event.provider_event_id,
      payloadJson: event.payload_json,
      receivedAt: event.received_at,
      order: event.order_reference === null || event.order_status === null
        ? null
        : { reference: event.order_reference, status: event.order_status },
    })),
    nextCursor: rows.length > query.limit && last
      ? encodeCursor([1, context.storeId, identity.userId, identity.role, last.received_at, last.id, query.limit])
      : null,
    hasEvents: Number((hasResult.results[0] as { has_events: number } | undefined)?.has_events) === 1,
  };
}
