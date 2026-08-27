import { listConsoleOrders } from '../orders/order-read';
import { jsonError, jsonResponse } from './http-response';

export async function routeConsoleOrderRequest(
  request: Request,
  database: D1Database,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (request.method !== 'GET' || pathname !== '/api/console/orders') return null;

  try {
    return jsonResponse({ orders: await listConsoleOrders(database) });
  } catch (error) {
    const incidentId = crypto.randomUUID();
    console.error('Unexpected Console Order route failure', {
      incidentId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return jsonError(
      500,
      'order_operation_failed',
      'The Orders could not be loaded.',
      [],
      incidentId,
    );
  }
}
