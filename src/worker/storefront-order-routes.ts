import { BOOTSTRAP_STORE_ID } from '../catalog/catalog-read';
import { createRefundRequest } from '../orders/order-commands';
import { readCustomerOrderById } from '../orders/order-read';
import { createOrder } from '../orders/order-write';
import { findOrderIdByCapability } from '../orders/private-access';
import {
  OrderPersistenceError,
  OrderValidationError,
  type CustomerOrderProjection,
  type OrderCommandResult,
  type OrderContext,
} from '../orders/order-types';
import {
  jsonError,
  jsonResponse,
  orderContractAccepted,
  orderContractOutdatedResponse,
} from './http-response';
import { withStorefrontCors } from './storefront-cors';

export const PAYMENT_NEXT_STEP = 'Payment instructions will be provided separately.';

type CustomerOrderResponse = CustomerOrderProjection & {
  paymentNextStep: string | null;
};

function storefrontContext(customerId: string | null = null): OrderContext {
  return { storeId: BOOTSTRAP_STORE_ID, actor: { source: 'storefront', id: customerId } };
}

function customerResponse(order: CustomerOrderProjection): CustomerOrderResponse {
  return {
    ...order,
    paymentNextStep: order.status === 'pending' ? PAYMENT_NEXT_STEP : null,
  };
}

function storefrontCommandResult(result: OrderCommandResult) {
  return {
    reference: result.reference,
    action: result.action,
    status: result.status,
    occurredAt: result.occurredAt,
    refundRequest: result.refundRequest,
  };
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new OrderValidationError('invalid_json', 'The request body is not valid JSON.', [], 400);
  }
}

function unexpectedOrderError(
  error: unknown,
  operation: 'create' | 'read' | 'refund',
): Response {
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

export async function routeStorefrontOrderRequest(
  request: Request,
  database: D1Database,
  storefrontOrigin: string | undefined,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  let response: Response | null = null;

  if (request.method === 'POST' && pathname === '/api/storefront/orders') {
    if (!orderContractAccepted(request)) {
      return withStorefrontCors(request, storefrontOrigin, orderContractOutdatedResponse());
    }
    try {
      const order = await createOrder({
        database,
        context: storefrontContext(),
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
    return withStorefrontCors(request, storefrontOrigin, response);
  }

  const refundMatch = /^\/api\/storefront\/orders\/([^/]+)\/refund-requests$/.exec(pathname);
  if (refundMatch !== null) {
    if (request.method !== 'POST') return null;
    const reference = decodeReference(refundMatch[1]);
    if (reference === null) {
      return withStorefrontCors(request, storefrontOrigin, privateNotFound());
    }
    let orderId: string | null;
    try {
      orderId = await findOrderIdByCapability({
        database,
        storeId: BOOTSTRAP_STORE_ID,
        reference,
        capability: request.headers.get('X-Nexus-Order-Capability'),
      });
    } catch (error) {
      return withStorefrontCors(
        request,
        storefrontOrigin,
        error instanceof OrderValidationError
          ? privateNotFound()
          : unexpectedOrderError(error, 'refund'),
      );
    }
    if (orderId === null) {
      return withStorefrontCors(request, storefrontOrigin, privateNotFound());
    }
    if (!orderContractAccepted(request)) {
      return withStorefrontCors(request, storefrontOrigin, orderContractOutdatedResponse());
    }
    try {
      const customerId = await database.prepare(
        'SELECT customer_id FROM orders WHERE store_id = ? AND id = ?',
      ).bind(BOOTSTRAP_STORE_ID, orderId).first<string>('customer_id');
      if (customerId === null) {
        response = privateNotFound();
      } else {
        response = jsonResponse(storefrontCommandResult(await createRefundRequest({
          database,
          context: storefrontContext(customerId),
          orderId,
          body: await parseJson(request),
          idempotencyKey: request.headers.get('Idempotency-Key'),
        })));
      }
    } catch (error) {
      response = error instanceof OrderValidationError
        ? jsonError(error.status, error.code, error.message, error.fields)
        : unexpectedOrderError(error, 'refund');
    }
    return withStorefrontCors(request, storefrontOrigin, response);
  }

  const match = /^\/api\/storefront\/orders\/([^/]+)$/.exec(pathname);
  if (request.method !== 'GET' || match === null) return null;
  const reference = decodeReference(match[1]);
  if (reference === null) {
    response = privateNotFound();
  } else {
    try {
      const orderId = await findOrderIdByCapability({
        database,
        storeId: BOOTSTRAP_STORE_ID,
        reference,
        capability: request.headers.get('X-Nexus-Order-Capability'),
      });
      if (orderId === null) {
        response = privateNotFound();
      } else if (!orderContractAccepted(request)) {
        response = orderContractOutdatedResponse();
      } else {
        const order = await readCustomerOrderById({
          database,
          storeId: BOOTSTRAP_STORE_ID,
          orderId,
        });
        response = order === null
          ? privateNotFound()
          : jsonResponse(customerResponse(order));
      }
    } catch (error) {
      response = error instanceof OrderValidationError
        ? privateNotFound()
        : unexpectedOrderError(error, 'read');
    }
  }

  return withStorefrontCors(request, storefrontOrigin, response);
}
