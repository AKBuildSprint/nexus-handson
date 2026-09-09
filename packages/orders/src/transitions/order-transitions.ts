import { OrderValidationError } from '../order-types';
import type {
  OrderActor,
  OrderCommandAction,
  OrderContext,
  OrderStatus,
} from '../order-types';

function actorRejected(): never {
  throw new OrderValidationError('validation_failed', 'The request is invalid.', [], 422);
}

function actorAllowed(action: OrderCommandAction, source: OrderActor['source']): boolean {
  if (source === 'storefront') return action === 'request_refund';
  return source === 'bootstrap_owner';
}

export function authorizedActor(
  context: OrderContext,
  order: { customer_id: string },
  action: OrderCommandAction,
): OrderActor {
  if (!actorAllowed(action, context.actor.source)) actorRejected();
  if (context.actor.source === 'storefront') {
    if (context.actor.id !== order.customer_id) actorRejected();
    return { source: 'storefront', id: order.customer_id };
  }
  if (context.actor.source !== 'bootstrap_owner' || context.actor.id !== null) actorRejected();
  return { source: 'bootstrap_owner', id: null };
}

export function markPaidEligible(status: OrderStatus): boolean {
  return status === 'pending';
}

export function fulfillEligible(status: OrderStatus): boolean {
  return status === 'paid';
}

export function cancelEligible(status: OrderStatus): boolean {
  return status === 'pending';
}

export function refundEligible(status: OrderStatus): boolean {
  return status === 'paid' || status === 'fulfilled';
}
