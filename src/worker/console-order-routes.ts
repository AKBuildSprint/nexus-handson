import { executeConsoleOrderAction } from '../orders/order-operations';
import { listConsoleOrders, readConsoleOrderDetail } from '../orders/order-read';
import { OrderPersistenceError, OrderValidationError } from '../orders/order-types';
import { parseConsoleOrderListQuery } from '../orders/order-validation';
import { jsonError, jsonResponse } from './http-response';
import { readOrderOperationJson } from './order-operation-body';

function decodeReference(encoded: string): string | null {
  try {
    const reference = decodeURIComponent(encoded);
    return /^NX-[A-F0-9]{16}$/.test(reference) ? reference : null;
  } catch {
    return null;
  }
}

function queryRecord(url: URL): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const key of url.searchParams.keys()) {
    record[key] = url.searchParams.get(key);
  }
  return record;
}

function unexpectedConsoleOrderError(error: unknown): Response {
  const incidentId = crypto.randomUUID();
  console.error('Unexpected Console Order route failure', {
    incidentId,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  if (error instanceof OrderPersistenceError) {
    return jsonError(error.status, error.code, error.message, [], incidentId);
  }
  return jsonError(500, 'order_operation_failed', 'The Orders could not be loaded.', [], incidentId);
}

export async function routeConsoleOrderRequest(
  request: Request,
  database: D1Database,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/console/orders')) return null;

  try {
    if (request.method === 'GET' && pathname === '/api/console/orders') {
      return jsonResponse(await listConsoleOrders(database, parseConsoleOrderListQuery(queryRecord(url))));
    }

    const actionMatch = /^\/api\/console\/orders\/([^/]+)\/actions$/.exec(pathname);
    if (request.method === 'POST' && actionMatch !== null) {
      const body = await readOrderOperationJson(request);
      const reference = decodeReference(actionMatch[1]);
      if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
      return jsonResponse(await executeConsoleOrderAction({
        database,
        reference,
        body,
        idempotencyKey: request.headers.get('Idempotency-Key'),
      }));
    }

    const detailMatch = /^\/api\/console\/orders\/([^/]+)$/.exec(pathname);
    if (request.method === 'GET' && detailMatch !== null) {
      const reference = decodeReference(detailMatch[1]);
      if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
      const order = await readConsoleOrderDetail(database, reference);
      return order === null
        ? jsonError(404, 'not_found', 'Order not found.')
        : jsonResponse(order);
    }

    return null;
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return jsonError(error.status, error.code, error.message, error.fields);
    }
    return unexpectedConsoleOrderError(error);
  }
}
