import { requestOrderRefund } from '../orders/order-operations';
import { createOrder } from '../orders/order-write';
import { findOrderIdByCapability, readPrivateOrder } from '../orders/private-access';
import {
  OrderPersistenceError,
  OrderValidationError,
  type CustomerOrderProjection,
} from '../orders/order-types';
import { jsonError, jsonResponse } from './http-response';
import { readOrderOperationJson } from './order-operation-body';
import { withStorefrontCors } from './storefront-cors';

export const PAYMENT_NEXT_STEP = 'Payment instructions will be provided separately.';

type CustomerOrderResponse = CustomerOrderProjection & {
  paymentNextStep: string | null;
};

function customerResponse(order: CustomerOrderProjection): CustomerOrderResponse {
  return {
    ...order,
    paymentNextStep: order.status === 'pending_payment' ? PAYMENT_NEXT_STEP : null,
  };
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new OrderValidationError('invalid_json', 'The request body is not valid JSON.', [], 400);
  }
}

function unexpectedOrderError(error: unknown, operation: 'create' | 'read' | 'refund'): Response {
  const incidentId = crypto.randomUUID();
  console.error('Unexpected Storefront Order route failure', {
    incidentId,
    operation,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  if (error instanceof OrderPersistenceError) {
    return jsonError(error.status, error.code, error.message, [], incidentId);
  }
  return jsonError(500, 'order_operation_failed', 'The Order operation could not be completed.', [], incidentId);
}

function privateNotFound(): Response {
  return jsonError(404, 'not_found', 'Order not found.');
}

function decodeReference(encoded: string): string | null {
  try {
    const reference = decodeURIComponent(encoded);
    return /^NX-[A-F0-9]{16}$/.test(reference) ? reference : null;
  } catch {
    return null;
  }
}

async function authorizePrivateOrder(
  database: D1Database,
  encodedReference: string,
  capability: string | null,
): Promise<string | null> {
  const reference = decodeReference(encodedReference);
  if (reference === null) return null;
  try {
    return await findOrderIdByCapability({ database, reference, capability });
  } catch (error) {
    if (error instanceof OrderValidationError) return null;
    throw error;
  }
}

export async function routeStorefrontOrderRequest(
  request: Request,
  database: D1Database,
  storefrontOrigin: string | undefined,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  let response: Response | null = null;

  if (request.method === 'POST' && pathname === '/api/storefront/orders') {
    try {
      const order = await createOrder({
        database,
        body: await parseJson(request),
        idempotencyKey: request.headers.get('Idempotency-Key'),
        capability: request.headers.get('X-Nexus-Order-Capability'),
      });
      response = jsonResponse(customerResponse(order), { status: 201 });
    } catch (error) {
      response = error instanceof OrderValidationError
        ? jsonError(error.status, error.code, error.message, error.fields)
        : unexpectedOrderError(error, 'create');
    }
  } else {
    const refundMatch = /^\/api\/storefront\/orders\/([^/]+)\/refund-requests$/.exec(pathname);
    const privateMatch = /^\/api\/storefront\/orders\/([^/]+)$/.exec(pathname);
    if (request.method === 'POST' && refundMatch !== null) {
      try {
        const orderId = await authorizePrivateOrder(
          database,
          refundMatch[1],
          request.headers.get('X-Nexus-Order-Capability'),
        );
        if (orderId === null) {
          response = privateNotFound();
        } else {
          const result = await requestOrderRefund({
            database,
            orderId,
            body: await readOrderOperationJson(request),
            idempotencyKey: request.headers.get('Idempotency-Key'),
          });
          response = jsonResponse(
            { order: customerResponse(result.order), command: result.command },
            { status: result.command.replayed || result.command.outcome === 'already_applied' ? 200 : 201 },
          );
        }
      } catch (error) {
        response = error instanceof OrderValidationError
          ? jsonError(error.status, error.code, error.message, error.fields)
          : unexpectedOrderError(error, 'refund');
      }
    } else if (request.method !== 'GET' || privateMatch === null) {
      return null;
    } else {
      const reference = decodeReference(privateMatch[1]);
      if (reference === null) {
        response = privateNotFound();
      } else {
        try {
          const order = await readPrivateOrder({
            database,
            reference,
            capability: request.headers.get('X-Nexus-Order-Capability'),
          });
          response = order === null
            ? privateNotFound()
            : jsonResponse(customerResponse(order));
        } catch (error) {
          response = error instanceof OrderValidationError
            ? privateNotFound()
            : unexpectedOrderError(error, 'read');
        }
      }
    }
  }

  return withStorefrontCors(request, storefrontOrigin, response);
}
