import { OrderValidationError, type ValidatedOrderCreateInput } from './order-types';

const PRODUCT_ID = /^prod_[a-z0-9]{8,80}$/;
const VARIANT_ID = /^(?:var|csvvar)_[a-z0-9]{8,80}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
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
