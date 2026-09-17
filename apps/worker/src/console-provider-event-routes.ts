import { listConsoleProviderEvents, type ConsoleProviderEventListQuery } from '@nexus/orders/queries/provider-event-read';
import { OrderPersistenceError, OrderValidationError, type OrderContext } from '@nexus/orders/order-types';
import type { ConsoleRequestContext } from './auth';
import { jsonError, jsonResponse, orderContractAccepted, orderContractOutdatedResponse } from './http-response';

const QUERY_KEYS: Record<string, true> = {
  limit: true,
  cursor: true,
};

function parseProviderEventListQuery(searchParams: URLSearchParams): ConsoleProviderEventListQuery {
  const seen: Record<string, true> = {};
  for (const key of searchParams.keys()) {
    if (QUERY_KEYS[key] !== true || seen[key] === true || searchParams.getAll(key).length > 1) {
      throw new OrderValidationError('invalid_query', 'The third-party log query is invalid.', [], 400);
    }
    seen[key] = true;
  }

  const rawLimit = searchParams.get('limit');
  let limit = 25;
  if (rawLimit !== null) {
    if (!/^(?:[1-9]\d?|100)$/.test(rawLimit)) {
      throw new OrderValidationError('invalid_query', 'The third-party log query is invalid.', [], 400);
    }
    limit = Number(rawLimit);
  }
  return { limit, cursor: searchParams.get('cursor') };
}

function unexpectedProviderEventError(error: unknown): Response {
  if (error instanceof OrderValidationError) return jsonError(error.status, error.code, error.message, error.fields);
  const incidentId = crypto.randomUUID();
  console.error('Unexpected third-party log route failure', {
    incidentId,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  if (error instanceof OrderPersistenceError) {
    return jsonError(error.status, error.code, error.message, [], incidentId);
  }
  return jsonError(500, 'provider_event_list_failed', 'Third-party logs could not be loaded.', [], incidentId);
}

export async function routeConsoleProviderEventRequest(
  request: Request,
  database: D1Database,
  requestContext: ConsoleRequestContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/console/provider-events') return null;
  if (!orderContractAccepted(request)) return orderContractOutdatedResponse();
  const context: OrderContext = {
    storeId: requestContext.identity.storeId,
    actor: { source: 'user', id: requestContext.identity.userId },
    identity: requestContext.identity,
  };
  try {
    return jsonResponse(await listConsoleProviderEvents(database, context, parseProviderEventListQuery(url.searchParams)));
  } catch (error) {
    return unexpectedProviderEventError(error);
  }
}
