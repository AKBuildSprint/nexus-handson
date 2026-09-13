import { OrderValidationError } from '../order-types';
import { evaluatePermission } from '@nexus/identity/permissions';
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
  return source === 'user';
}

export function authorizedActor(
  context: OrderContext,
  order: { customer_id: string; assignee_user_id: string | null },
  action: OrderCommandAction,
): OrderActor {
  if (!actorAllowed(action, context.actor.source)) actorRejected();
  if (context.actor.source === 'storefront') {
    if (context.actor.id !== order.customer_id) actorRejected();
    return { source: 'storefront', id: order.customer_id };
  }
  if (context.actor.source === 'user') {
    if (context.identity?.kind !== 'console' || context.actor.id !== context.identity.userId) actorRejected();
    const permission = action === 'request_refund'
      ? 'refund:request'
      : action === 'approve_refund' || action === 'reject_refund'
        ? 'refund:decide'
        : 'order:process';
    if (!evaluatePermission(context.identity, permission, {
      storeId: context.storeId,
      assignedUserId: order.assignee_user_id,
    })) actorRejected();
    return { source: 'user', id: context.identity.userId };
  }
  actorRejected();
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
