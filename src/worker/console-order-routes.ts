import { cancelOrder, completeOrder } from '../orders/order-commands';
import { listConsoleOrders, readConsoleOrderByReference } from '../orders/order-read';
import {
  OrderPersistenceError,
  OrderValidationError,
  type ConsoleOrderListQuery,
  type OrderStatus,
} from '../orders/order-types';
import { jsonError, jsonResponse } from './http-response';

const ORDER_STATUS: Record<OrderStatus, true> = {
  pending: true,
  paid: true,
  fulfilled: true,
  canceled: true,
};

const QUERY_KEYS: Record<string, true> = {
  q: true,
  status: true,
  refund: true,
  limit: true,
  cursor: true,
};

function unexpectedConsoleError(
  error: unknown,
  operation: 'list' | 'read' | 'complete' | 'cancel',
): Response {
  if (error instanceof OrderValidationError) {
    return jsonError(error.status, error.code, error.message, error.fields);
  }
  const incidentId = crypto.randomUUID();
  console.error('Unexpected Console Order route failure', {
    incidentId,
    operation,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  if (error instanceof OrderPersistenceError) {
    return jsonError(error.status, error.code, error.message, [], incidentId);
  }
  return jsonError(
    500,
    'order_operation_failed',
    operation === 'list' ? 'The Orders could not be loaded.' : 'The Order operation could not be completed.',
    [],
    incidentId,
  );
}

function decodeReference(encoded: string): string | null {
  try {
    const reference = decodeURIComponent(encoded);
    return /^NX-[A-F0-9]{16}$/.test(reference) ? reference : null;
  } catch {
    return null;
  }
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new OrderValidationError('invalid_json', 'The request body is not valid JSON.', [], 400);
  }
}

function parseConsoleOrderListQuery(searchParams: URLSearchParams): ConsoleOrderListQuery {
  const seen: Record<string, true> = {};
  for (const key of searchParams.keys()) {
    if (QUERY_KEYS[key] !== true || seen[key] === true || searchParams.getAll(key).length > 1) {
      throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
    }
    seen[key] = true;
  }

  const rawQ = searchParams.get('q');
  const q = rawQ === null ? '' : rawQ.normalize('NFKC').trim();
  if (Array.from(q).length > 254) {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }

  const rawStatus = searchParams.get('status');
  if (rawStatus !== null && ORDER_STATUS[rawStatus as OrderStatus] !== true) {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }

  const rawRefund = searchParams.get('refund');
  if (rawRefund !== null && rawRefund !== 'pending') {
    throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
  }

  const rawLimit = searchParams.get('limit');
  let limit = 25;
  if (rawLimit !== null) {
    if (!/^(?:[1-9]\d?|100)$/.test(rawLimit)) {
      throw new OrderValidationError('invalid_query', 'The Order query is invalid.', [], 400);
    }
    limit = Number(rawLimit);
  }

  return {
    q,
    status: rawStatus as OrderStatus | null,
    refund: rawRefund === 'pending' ? 'pending' : null,
    limit,
    cursor: searchParams.get('cursor'),
  };
}

export async function routeConsoleOrderRequest(
  request: Request,
  database: D1Database,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === 'GET' && pathname === '/api/console/orders') {
    try {
      return jsonResponse(await listConsoleOrders(database, parseConsoleOrderListQuery(url.searchParams)));
    } catch (error) {
      return unexpectedConsoleError(error, 'list');
    }
  }

  const detail = /^\/api\/console\/orders\/([^/]+)$/.exec(pathname);
  if (detail !== null && request.method === 'GET') {
    const reference = decodeReference(detail[1]);
    if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
    try {
      const order = await readConsoleOrderByReference(database, reference);
      return order === null
        ? jsonError(404, 'not_found', 'Order not found.')
        : jsonResponse({ order });
    } catch (error) {
      return unexpectedConsoleError(error, 'read');
    }
  }

  const complete = /^\/api\/console\/orders\/([^/]+)\/complete$/.exec(pathname);
  if (complete !== null && request.method === 'POST') {
    const reference = decodeReference(complete[1]);
    if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
    try {
      return jsonResponse(await completeOrder({
        database,
        reference,
        body: await parseJson(request),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      }));
    } catch (error) {
      return unexpectedConsoleError(error, 'complete');
    }
  }

  const cancel = /^\/api\/console\/orders\/([^/]+)\/cancel$/.exec(pathname);
  if (cancel !== null && request.method === 'POST') {
    const reference = decodeReference(cancel[1]);
    if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
    try {
      return jsonResponse(await cancelOrder({
        database,
        reference,
        body: await parseJson(request),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      }));
    } catch (error) {
      return unexpectedConsoleError(error, 'cancel');
    }
  }

  return null;
}
