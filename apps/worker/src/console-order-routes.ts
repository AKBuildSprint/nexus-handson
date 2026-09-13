import {
  approveRefundRequest,
  cancelOrder,
  createRefundRequest,
  fulfillOrder,
  markPaid,
  rejectRefundRequest,
} from '@nexus/orders/commands/order-commands';
import { assignOrder, listActiveStaffCandidates } from '@nexus/orders/commands/order-assignment';
import {
  findConsoleOrderIdByReference,
  listConsoleOrders,
  readConsoleOrderByReference,
  resolveConsoleRefundDecisionTarget,
} from '@nexus/orders/queries/order-read';
import {
  OrderPersistenceError,
  OrderValidationError,
  type ConsoleOrderListQuery,
  type OrderContext,
  type OrderStatus,
} from '@nexus/orders/order-types';
import {
  jsonError,
  jsonResponse,
  orderContractAccepted,
  orderContractOutdatedResponse,
} from './http-response';
import type { ConsoleRequestContext } from './auth';

const ORDER_STATUS: Record<OrderStatus, true> = {
  pending: true,
  paid: true,
  fulfilled: true,
  canceled: true,
};

const QUERY_KEYS: Record<string, true> = {
  q: true,
  status: true,
  limit: true,
  cursor: true,
  refund: true,
};

function unexpectedConsoleError(
  error: unknown,
  operation: 'list' | 'read' | 'pay' | 'fulfill' | 'cancel' | 'refund' | 'refund-decision' | 'assign' | 'staff',
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
  const q = rawQ === null ? '' : rawQ.trim();
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
  requestContext: ConsoleRequestContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const context: OrderContext = {
    storeId: requestContext.identity.storeId,
    actor: { source: 'user', id: requestContext.identity.userId },
    identity: requestContext.identity,
  };

  if (request.method === 'GET' && pathname === '/api/console/orders') {
    if (!orderContractAccepted(request)) return orderContractOutdatedResponse();
    try {
      return jsonResponse(await listConsoleOrders(database, context, parseConsoleOrderListQuery(url.searchParams)));
    } catch (error) {
      return unexpectedConsoleError(error, 'list');
    }
  }

  if (request.method === 'GET' && pathname === '/api/console/staff') {
    if (!orderContractAccepted(request)) return orderContractOutdatedResponse();
    try {
      return jsonResponse({ staff: await listActiveStaffCandidates(database, requestContext.identity) });
    } catch (error) {
      return unexpectedConsoleError(error, 'staff');
    }
  }

  const detail = /^\/api\/console\/orders\/([^/]+)$/.exec(pathname);
  if (detail !== null && request.method === 'GET') {
    const reference = decodeReference(detail[1]);
    if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
    try {
      if (await findConsoleOrderIdByReference(database, context, reference) === null) {
        return jsonError(404, 'not_found', 'Order not found.');
      }
      if (!orderContractAccepted(request)) return orderContractOutdatedResponse();
      const order = await readConsoleOrderByReference(database, context, reference);
      return order === null
        ? jsonError(404, 'not_found', 'Order not found.')
        : jsonResponse({ order });
    } catch (error) {
      return unexpectedConsoleError(error, 'read');
    }
  }

  const payment = /^\/api\/console\/orders\/([^/]+)\/payments\/manual$/.exec(pathname);
  if (payment !== null && request.method === 'POST') {
    const reference = decodeReference(payment[1]);
    if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
    try {
      const orderId = await findConsoleOrderIdByReference(database, context, reference);
      if (orderId === null) return jsonError(404, 'not_found', 'Order not found.');
      if (!orderContractAccepted(request)) return orderContractOutdatedResponse();
      return jsonResponse(await markPaid({
        database,
        context,
        orderId,
        body: await parseJson(request),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      }));
    } catch (error) {
      return unexpectedConsoleError(error, 'pay');
    }
  }

  const assignment = /^\/api\/console\/orders\/([^/]+)\/assignment$/.exec(pathname);
  if (assignment !== null && request.method === 'POST') {
    const reference = decodeReference(assignment[1]);
    if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
    try {
      const orderId = await findConsoleOrderIdByReference(database, context, reference);
      if (orderId === null) return jsonError(404, 'not_found', 'Order not found.');
      if (!orderContractAccepted(request)) return orderContractOutdatedResponse();
      return jsonResponse(await assignOrder({
        database,
        identity: requestContext.identity,
        orderId,
        body: await parseJson(request),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      }));
    } catch (error) {
      return unexpectedConsoleError(error, 'assign');
    }
  }

  const fulfill = /^\/api\/console\/orders\/([^/]+)\/fulfill$/.exec(pathname);
  if (fulfill !== null && request.method === 'POST') {
    const reference = decodeReference(fulfill[1]);
    if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
    try {
      const orderId = await findConsoleOrderIdByReference(database, context, reference);
      if (orderId === null) return jsonError(404, 'not_found', 'Order not found.');
      if (!orderContractAccepted(request)) return orderContractOutdatedResponse();
      return jsonResponse(await fulfillOrder({
        database,
        context,
        orderId,
        body: await parseJson(request),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      }));
    } catch (error) {
      return unexpectedConsoleError(error, 'fulfill');
    }
  }

  const cancel = /^\/api\/console\/orders\/([^/]+)\/cancel$/.exec(pathname);
  if (cancel !== null && request.method === 'POST') {
    const reference = decodeReference(cancel[1]);
    if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
    try {
      const orderId = await findConsoleOrderIdByReference(database, context, reference);
      if (orderId === null) return jsonError(404, 'not_found', 'Order not found.');
      if (!orderContractAccepted(request)) return orderContractOutdatedResponse();
      return jsonResponse(await cancelOrder({
        database,
        context,
        orderId,
        body: await parseJson(request),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      }));
    } catch (error) {
      return unexpectedConsoleError(error, 'cancel');
    }
  }

  const refund = /^\/api\/console\/orders\/([^/]+)\/refund-requests$/.exec(pathname);
  if (refund !== null && request.method === 'POST') {
    const reference = decodeReference(refund[1]);
    if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
    try {
      const orderId = await findConsoleOrderIdByReference(database, context, reference);
      if (orderId === null) return jsonError(404, 'not_found', 'Order not found.');
      if (!orderContractAccepted(request)) return orderContractOutdatedResponse();
      return jsonResponse(await createRefundRequest({
        database,
        context,
        orderId,
        body: await parseJson(request),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      }));
    } catch (error) {
      return unexpectedConsoleError(error, 'refund');
    }
  }

  const refundDecision = /^\/api\/console\/orders\/([^/]+)\/refund-requests\/(rrq_[a-f0-9]{32})\/(approve|reject)$/.exec(pathname);
  if (refundDecision !== null && request.method === 'POST') {
    const reference = decodeReference(refundDecision[1]);
    if (reference === null) return jsonError(404, 'not_found', 'Order not found.');
    try {
      const orderId = await findConsoleOrderIdByReference(database, context, reference);
      if (orderId === null) return jsonError(404, 'not_found', 'Order not found.');
      await resolveConsoleRefundDecisionTarget({
        database,
        context,
        orderId,
        requestId: refundDecision[2],
      });
      if (!orderContractAccepted(request)) return orderContractOutdatedResponse();
      const command = refundDecision[3] === 'approve' ? approveRefundRequest : rejectRefundRequest;
      return jsonResponse(await command({
        database,
        context,
        orderId,
        requestId: refundDecision[2],
        body: await parseJson(request),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      }));
    } catch (error) {
      return unexpectedConsoleError(error, 'refund-decision');
    }
  }

  return null;
}
