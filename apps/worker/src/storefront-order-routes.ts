import { PUBLIC_STORE_ID } from '@nexus/catalog/public-store';
import { createRefundRequest } from '@nexus/orders/commands/order-commands';
import { readCustomerOrderById } from '@nexus/orders/queries/order-read';
import { createOrder } from '@nexus/orders/commands/order-write';
import { findOrderIdByCapability, findOrderIdByReference } from '@nexus/orders/private-access';
import {
  OrderPersistenceError,
  OrderValidationError,
  type CustomerOrderProjection,
  type OrderCommandResult,
  type OrderContext,
} from '@nexus/orders/order-types';
import type { Env } from './environment';
import { emailTokenMatches } from './order-email-service';
import {
  jsonError,
  jsonResponse,
  orderContractAccepted,
  orderContractOutdatedResponse,
} from './http-response';
import { withStorefrontCors } from './storefront-cors';

type BankTransferInstructions = {
  bank: string;
  accountNumber: string;
};

type CustomerOrderResponse = CustomerOrderProjection & {
  paymentInstructions: BankTransferInstructions | null;
};

function storefrontContext(customerId: string | null = null): OrderContext {
  return {
    storeId: PUBLIC_STORE_ID,
    actor: { source: 'storefront', id: customerId },
    identity: customerId === null
      ? { kind: 'public' }
      : { kind: 'customer', storeId: PUBLIC_STORE_ID, customerId },
  };
}

function bankTransferInstructions(
  order: CustomerOrderProjection,
  payment: Pick<Env, 'PAYFS_MERCHANT_BANK' | 'PAYFS_MERCHANT_ACCOUNT'> | undefined,
): BankTransferInstructions | null {
  const bank = payment?.PAYFS_MERCHANT_BANK;
  const accountNumber = payment?.PAYFS_MERCHANT_ACCOUNT;
  if (
    order.status !== 'pending'
    || order.currency !== 'VND'
    || typeof bank !== 'string'
    || !/^[A-Za-z0-9]{2,16}$/u.test(bank)
    || typeof accountNumber !== 'string'
    || !/^[A-Za-z0-9-]{1,80}$/u.test(accountNumber)
  ) return null;
  return { bank: bank.toUpperCase(), accountNumber };
}

function customerResponse(
  order: CustomerOrderProjection,
  payment?: Pick<Env, 'PAYFS_MERCHANT_BANK' | 'PAYFS_MERCHANT_ACCOUNT'>,
): CustomerOrderResponse {
  return {
    ...order,
    paymentInstructions: bankTransferInstructions(order, payment),
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

async function findOrderIdByPrivateLink(input: {
  database: D1Database;
  reference: string;
  capability: string | null;
  emailSecret: string | undefined;
}): Promise<string | null> {
  if (input.capability === null) return null;
  const direct = await findOrderIdByCapability({
    database: input.database,
    storeId: PUBLIC_STORE_ID,
    reference: input.reference,
    capability: input.capability,
  });
  if (direct !== null) return direct;
  const orderId = await findOrderIdByReference({
    database: input.database,
    storeId: PUBLIC_STORE_ID,
    reference: input.reference,
  });
  if (orderId === null) return null;
  return await emailTokenMatches(input.emailSecret, PUBLIC_STORE_ID, orderId, input.capability) ? orderId : null;
}

export async function routeStorefrontOrderRequest(
  request: Request,
  database: D1Database,
  storefrontOrigin: string | undefined,
  payment?: Pick<Env, 'PAYFS_MERCHANT_BANK' | 'PAYFS_MERCHANT_ACCOUNT' | 'RESEND_API_KEY'>,
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
      response = jsonResponse(customerResponse(order, payment), { status: 201 });
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
      orderId = await findOrderIdByPrivateLink({
        database,
        reference,
        capability: request.headers.get('X-Nexus-Order-Capability'),
        emailSecret: payment?.RESEND_API_KEY,
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
      ).bind(PUBLIC_STORE_ID, orderId).first<string>('customer_id');
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
      const orderId = await findOrderIdByPrivateLink({
        database,
        reference,
        capability: request.headers.get('X-Nexus-Order-Capability'),
        emailSecret: payment?.RESEND_API_KEY,
      });
      if (orderId === null) {
        response = privateNotFound();
      } else if (!orderContractAccepted(request)) {
        response = orderContractOutdatedResponse();
      } else {
        const order = await readCustomerOrderById({
          database,
          storeId: PUBLIC_STORE_ID,
          orderId,
        });
        response = order === null
          ? privateNotFound()
          : jsonResponse(customerResponse(order, payment));
      }
    } catch (error) {
      response = error instanceof OrderValidationError
        ? privateNotFound()
        : unexpectedOrderError(error, 'read');
    }
  }

  return withStorefrontCors(request, storefrontOrigin, response);
}
