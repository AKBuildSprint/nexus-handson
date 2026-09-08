import {
  OrderValidationError,
  type ConsoleOrderAction,
  type ConsoleOrderListQuery,
  type ValidatedOrderCreateInput,
} from './order-types';

const PRODUCT_ID = /^prod_[a-z0-9]{8,80}$/;
const VARIANT_ID = /^(?:var|csvvar)_[a-z0-9]{8,80}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const REFUND_ID = /^refund_[a-f0-9]{32}$/;
const CAPABILITY = /^[A-Za-z0-9_-]{32,256}$/;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path, code: 'type_invalid', message: 'Expected an object.' },
    ]);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(record: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new OrderValidationError('validation_failed', 'The request is invalid.', unknown.map((key) => ({
    path: `${path}/${key}`,
    code: 'unknown_field',
    message: 'This field is not accepted.',
  })));
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path: '/customer/name', code: 'value_required', message: 'A Customer name is required.' },
    ]);
  }
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (normalized.length < 1 || normalized.length > 120 || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path: '/customer/name', code: 'name_invalid', message: 'Customer name must contain 1 to 120 visible characters.' },
    ]);
  }
  return normalized;
}

export function normalizeCustomerEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path: '/customer/email', code: 'value_required', message: 'A Customer email is required.' },
    ]);
  }
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (normalized.length > 254 || normalized.includes('..') || !EMAIL.test(normalized)) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path: '/customer/email', code: 'email_invalid', message: 'Enter a valid email address.' },
    ]);
  }
  return normalized;
}

function durableId(value: unknown, path: string, pattern: RegExp, nullable: boolean): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path, code: 'identity_invalid', message: 'A valid catalog identity is required.' },
    ]);
  }
  return value;
}

function boundedInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 99) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path: '/quantity', code: 'quantity_invalid', message: 'Quantity must be an integer from 1 to 99.' },
    ]);
  }
  return value;
}

function opaqueHeader(value: unknown, path: string, pattern: RegExp, code: string, message: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [{ path, code, message }], 400);
  }
  return value;
}

export function parseOrderCreateInput(
  body: unknown,
  idempotencyKey: unknown,
  capability: unknown,
): ValidatedOrderCreateInput {
  const request = objectAt(body, '');
  rejectUnknown(request, ['customer', 'productId', 'variantId', 'quantity'], '');
  const customer = objectAt(request.customer, '/customer');
  rejectUnknown(customer, ['name', 'email'], '/customer');

  return {
    customerName: normalizeName(customer.name),
    customerEmailNormalized: normalizeCustomerEmail(customer.email),
    productId: durableId(request.productId, '/productId', PRODUCT_ID, false) as string,
    variantId: durableId(request.variantId, '/variantId', VARIANT_ID, true),
    quantity: boundedInteger(request.quantity),
    idempotencyKey: opaqueHeader(
      idempotencyKey,
      '/headers/idempotency-key',
      IDEMPOTENCY_KEY,
      'idempotency_key_invalid',
      'A valid idempotency key is required.',
    ),
    capability: opaqueHeader(
      capability,
      '/headers/x-nexus-order-capability',
      CAPABILITY,
      'capability_invalid',
      'A valid Order capability is required.',
    ),
  };
}

export function parseOrderCapability(value: unknown): string {
  return opaqueHeader(
    value,
    '/headers/x-nexus-order-capability',
    CAPABILITY,
    'capability_invalid',
    'A valid Order capability is required.',
  );
}

export function parseOrderIdempotencyKey(value: unknown): string {
  return opaqueHeader(
    value,
    '/headers/idempotency-key',
    IDEMPOTENCY_KEY,
    'idempotency_key_invalid',
    'A valid idempotency key is required.',
  );
}

function reasonFieldError(message: string): never {
  throw new OrderValidationError('validation_failed', 'The request is invalid.', [
    { path: '/reason', code: 'reason_invalid', message },
  ]);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xDC00 || next > 0xDFFF) return true;
      index += 1;
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return true;
  }
  return false;
}

function reasonExceedsCodePointLimit(reason: string): boolean {
  let count = 0;
  for (const _codePoint of reason) {
    count += 1;
    if (count > 1000) return true;
  }
  return false;
}

export function parseConsoleOrderActionBody(body: unknown): {
  action: ConsoleOrderAction;
  acknowledgedRefundRequestId: string | null;
} {
  const request = objectAt(body, '');
  rejectUnknown(request, ['action', 'acknowledgedRefundRequestId'], '');
  const action = request.action;
  if (action !== 'mark_paid' && action !== 'mark_fulfilled' && action !== 'cancel') {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path: '/action', code: 'action_invalid', message: 'A valid Console Order action is required.' },
    ]);
  }
  const acknowledgedRefundRequestId = request.acknowledgedRefundRequestId;
  if (action === 'mark_fulfilled') {
    if (
      acknowledgedRefundRequestId !== null
      && (typeof acknowledgedRefundRequestId !== 'string' || !REFUND_ID.test(acknowledgedRefundRequestId))
    ) {
      throw new OrderValidationError('validation_failed', 'The request is invalid.', [
        {
          path: '/acknowledgedRefundRequestId',
          code: 'identity_invalid',
          message: 'A valid Refund Request identity or null is required.',
        },
      ]);
    }
  } else if (acknowledgedRefundRequestId !== null) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      {
        path: '/acknowledgedRefundRequestId',
        code: 'identity_invalid',
        message: 'This action does not accept a Refund Request acknowledgement.',
      },
    ]);
  }
  return { action, acknowledgedRefundRequestId };
}

export function parseOrderRefundBody(body: unknown): { reason: string } {
  const request = objectAt(body, '');
  rejectUnknown(request, ['reason'], '');
  if (typeof request.reason !== 'string') {
    reasonFieldError('A Refund Request reason is required.');
  }
  if (hasUnpairedSurrogate(request.reason)) {
    reasonFieldError('The Refund Request reason must be well-formed Unicode text.');
  }
  const reason = request.reason.trim();
  if (
    reason.length === 0
    || reason.includes('\u0000')
    || hasUnpairedSurrogate(reason)
    || reasonExceedsCodePointLimit(reason)
  ) {
    reasonFieldError('Refund Request reason must contain 1 to 1000 Unicode characters.');
  }
  return { reason };
}

function invalidListQuery(path: string, code: string, message: string): never {
  throw new OrderValidationError('validation_failed', 'The request is invalid.', [{ path, code, message }]);
}

export function decodeConsoleOrderCursor(value: string): [string, string] {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    invalidListQuery('/cursor', 'cursor_invalid', 'A valid list cursor is required.');
  }
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (
      !Array.isArray(parsed)
      || parsed.length !== 2
      || typeof parsed[0] !== 'string'
      || typeof parsed[1] !== 'string'
    ) {
      invalidListQuery('/cursor', 'cursor_invalid', 'A valid list cursor is required.');
    }
    return [parsed[0], parsed[1]];
  } catch (error) {
    if (error instanceof OrderValidationError) throw error;
    invalidListQuery('/cursor', 'cursor_invalid', 'A valid list cursor is required.');
  }
}

export function parseConsoleOrderListQuery(query: unknown): ConsoleOrderListQuery {
  const record = objectAt(query, '');
  rejectUnknown(record, ['q', 'status', 'refund', 'cursor'], '');
  const q = record.q === undefined ? '' : record.q;
  if (typeof q !== 'string') invalidListQuery('/q', 'query_invalid', 'Search text must be a string.');
  const status = record.status === undefined ? 'all' : record.status;
  if (
    status !== 'all'
    && status !== 'pending_payment'
    && status !== 'paid'
    && status !== 'fulfilled'
    && status !== 'cancelled'
  ) {
    invalidListQuery('/status', 'status_invalid', 'A valid Order status filter is required.');
  }
  const refund = record.refund === undefined ? 'all' : record.refund;
  if (refund !== 'all' && refund !== 'pending') {
    invalidListQuery('/refund', 'refund_invalid', 'A valid Refund filter is required.');
  }
  if (record.cursor === undefined || record.cursor === null || record.cursor === '') {
    return { q, status, refund, cursor: null };
  }
  if (typeof record.cursor !== 'string') {
    invalidListQuery('/cursor', 'cursor_invalid', 'A valid list cursor is required.');
  }
  decodeConsoleOrderCursor(record.cursor);
  return { q, status, refund, cursor: record.cursor };
}
