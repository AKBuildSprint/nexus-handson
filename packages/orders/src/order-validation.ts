import { OrderValidationError, type PayfsCreditInput, type ValidatedOrderCreateInput } from './order-types';

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
  const length = Array.from(normalized).length;
  if (length < 1 || length > 120 || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
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

function boundedQuantity(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 99) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path, code: 'quantity_invalid', message: 'Quantity must be an integer from 1 to 99.' },
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

function parseCreateItems(value: unknown): ValidatedOrderCreateInput['items'] {
  if (!Array.isArray(value)) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path: '/items', code: 'type_invalid', message: 'Expected an array.' },
    ]);
  }
  if (value.length < 1 || value.length > 10) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      {
        path: '/items',
        code: 'items_invalid',
        message: 'Order items must contain between 1 and 10 selections.',
      },
    ]);
  }

  const items = value.map((entry, index) => {
    const path = `/items/${index}`;
    const item = objectAt(entry, path);
    rejectUnknown(item, ['productId', 'variantId', 'quantity'], path);
    return {
      productId: durableId(item.productId, `${path}/productId`, PRODUCT_ID, false) as string,
      variantId: durableId(item.variantId, `${path}/variantId`, VARIANT_ID, true),
      quantity: boundedQuantity(item.quantity, `${path}/quantity`),
    };
  });

  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const key = `${item.productId}\0${item.variantId ?? ''}`;
    if (seen.has(key)) {
      throw new OrderValidationError('validation_failed', 'The request is invalid.', [
        {
          path: `/items/${index}`,
          code: 'duplicate_item',
          message: 'Each Product and Variant selection may appear only once.',
        },
      ]);
    }
    seen.add(key);
  }
  return items;
}

export function parseOrderCreateInput(
  body: unknown,
  idempotencyKey: unknown,
  capability: unknown,
): ValidatedOrderCreateInput {
  const request = objectAt(body, '');
  rejectUnknown(request, ['customer', 'items'], '');
  const customer = objectAt(request.customer, '/customer');
  rejectUnknown(customer, ['name', 'email'], '/customer');

  return {
    customerName: normalizeName(customer.name),
    customerEmailNormalized: normalizeCustomerEmail(customer.email),
    items: parseCreateItems(request.items),
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

function parseCommandKey(idempotencyKey: unknown): string {
  return opaqueHeader(
    idempotencyKey,
    '/headers/idempotency-key',
    IDEMPOTENCY_KEY,
    'idempotency_key_invalid',
    'A valid idempotency key is required.',
  );
}

export function parseAssignmentInput(
  body: unknown,
  idempotencyKey: unknown,
): { assigneeUserId: string; idempotencyKey: string } {
  const request = objectAt(body, '');
  rejectUnknown(request, ['assigneeUserId'], '');
  if (
    typeof request.assigneeUserId !== 'string'
    || request.assigneeUserId.length < 1
    || request.assigneeUserId.length > 128
    || !/^[A-Za-z0-9_-]+$/.test(request.assigneeUserId)
  ) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [{
      path: '/assigneeUserId',
      code: 'assignee_invalid',
      message: 'Choose an active Staff member.',
    }]);
  }
  return { assigneeUserId: request.assigneeUserId, idempotencyKey: parseCommandKey(idempotencyKey) };
}

function reasonHasDisallowedControls(reason: string): boolean {
  for (const char of reason) {
    if (/\p{Cf}/u.test(char)) return true;
    if (/\p{Cc}/u.test(char) && char !== '\t' && char !== '\n') return true;
  }
  return false;
}

function normalizePaymentText(
  value: unknown,
  path: string,
  code: string,
  message: string,
  maxCodePoints: number,
): string {
  if (typeof value !== 'string') {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path, code, message },
    ]);
  }
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > maxCodePoints || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      { path, code, message },
    ]);
  }
  return normalized;
}

function normalizeRefundReason(value: unknown): string {
  if (typeof value !== 'string') {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      {
        path: '/reason',
        code: 'reason_invalid',
        message: 'Enter a reason using 1 to 1000 characters.',
      },
    ]);
  }
  const normalized = value.replace(/\r\n|\r/g, '\n').trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > 1000 || reasonHasDisallowedControls(normalized)) {
    throw new OrderValidationError('validation_failed', 'The request is invalid.', [
      {
        path: '/reason',
        code: 'reason_invalid',
        message: 'Enter a reason using 1 to 1000 characters.',
      },
    ]);
  }
  return normalized;
}

function payfsInvalid(path: string): never {
  throw new OrderValidationError('validation_failed', 'The PayFS payload is invalid.', [
    { path, code: 'payfs_field_invalid', message: 'This PayFS field is invalid.' },
  ], 400);
}

function payfsOpaque(value: unknown, path: string, pattern: RegExp, min = 1, max = 128): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || !pattern.test(value)) {
    return payfsInvalid(path);
  }
  return value;
}

function payfsContent(value: unknown): string {
  if (typeof value !== 'string' || Array.from(value).length > 1000 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    return payfsInvalid('/content');
  }
  return value;
}

function payfsTransactionDate(value: unknown): string {
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u.exec(value)
    : null;
  if (match === null) return payfsInvalid('/transaction_date');
  const [, year, month, day, hour, minute, second] = match;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second);
  const daysInMonth = monthNumber === 2
    ? (yearNumber % 4 === 0 && (yearNumber % 100 !== 0 || yearNumber % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(monthNumber) ? 30 : 31;
  if (
    monthNumber < 1 || monthNumber > 12
    || dayNumber < 1 || dayNumber > daysInMonth
    || hourNumber > 23 || minuteNumber > 59 || secondNumber > 59
  ) return payfsInvalid('/transaction_date');
  return match[0];
}

export function parsePayfsCreditInput(body: unknown): PayfsCreditInput {
  const request = objectAt(body, '');
  rejectUnknown(request, [
    'account_id',
    'amount',
    'bank',
    'bank_account_number',
    'content',
    'transaction_date',
    'transaction_id',
    'transfer_type',
  ], '');
  if (typeof request.amount !== 'number' || !Number.isSafeInteger(request.amount) || request.amount <= 0) {
    return payfsInvalid('/amount');
  }
  if (request.transfer_type !== 'credit' && request.transfer_type !== 'debit') {
    return payfsInvalid('/transfer_type');
  }
  return {
    accountId: payfsOpaque(request.account_id, '/account_id', /^[A-Za-z0-9_-]+$/u),
    amount: request.amount,
    bank: payfsOpaque(request.bank, '/bank', /^[A-Za-z0-9]+$/u, 2, 16).toUpperCase(),
    bankAccountNumber: payfsOpaque(request.bank_account_number, '/bank_account_number', /^[A-Za-z0-9-]+$/u, 1, 80),
    content: payfsContent(request.content),
    transactionDate: payfsTransactionDate(request.transaction_date),
    transactionId: payfsOpaque(request.transaction_id, '/transaction_id', /^[A-Za-z0-9_-]+$/u),
    transferType: request.transfer_type,
  };
}

export function parseManualPaymentInput(
  body: unknown,
  idempotencyKey: unknown,
): { idempotencyKey: string; method: string; reference: string } {
  const request = objectAt(body, '');
  rejectUnknown(request, ['method', 'reference'], '');
  return {
    idempotencyKey: parseCommandKey(idempotencyKey),
    method: normalizePaymentText(
      request.method,
      '/method',
      'method_invalid',
      'Enter a payment method using 1 to 80 characters.',
      80,
    ),
    reference: normalizePaymentText(
      request.reference,
      '/reference',
      'reference_invalid',
      'Enter a payment reference using 1 to 160 characters.',
      160,
    ),
  };
}

export function parseFulfillOrderInput(
  body: unknown,
  idempotencyKey: unknown,
): { idempotencyKey: string } {
  const request = objectAt(body, '');
  rejectUnknown(request, [], '');
  return { idempotencyKey: parseCommandKey(idempotencyKey) };
}

export function parseCancelOrderInput(
  body: unknown,
  idempotencyKey: unknown,
): { idempotencyKey: string } {
  const request = objectAt(body, '');
  rejectUnknown(request, [], '');
  return { idempotencyKey: parseCommandKey(idempotencyKey) };
}

export function parseRefundRequestInput(
  body: unknown,
  idempotencyKey: unknown,
): { idempotencyKey: string; reason: string } {
  const request = objectAt(body, '');
  rejectUnknown(request, ['reason'], '');
  return {
    idempotencyKey: parseCommandKey(idempotencyKey),
    reason: normalizeRefundReason(request.reason),
  };
}

export function parseRefundDecisionInput(
  body: unknown,
  idempotencyKey: unknown,
): { idempotencyKey: string } {
  const request = objectAt(body, '');
  rejectUnknown(request, [], '');
  return { idempotencyKey: parseCommandKey(idempotencyKey) };
}
