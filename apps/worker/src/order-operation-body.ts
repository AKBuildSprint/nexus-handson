import { OrderValidationError } from '@nexus/orders/order-types';

export const ORDER_OPERATION_BODY_LIMIT = 16_384;

function payloadTooLarge(): never {
  throw new OrderValidationError('payload_too_large', 'The request body is too large.', [], 413);
}

function invalidJson(): never {
  throw new OrderValidationError('invalid_json', 'The request body is not valid JSON.', [], 400);
}

export async function readOrderOperationJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isInteger(length) && length > ORDER_OPERATION_BODY_LIMIT) payloadTooLarge();
  }

  const reader = request.body?.getReader();
  if (reader === undefined) invalidJson();

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > ORDER_OPERATION_BODY_LIMIT) {
      try {
        await reader.cancel();
      } catch {
        // Overflow is already determined; cancel failure must not become 500.
      }
      payloadTooLarge();
    }
    total += value.byteLength;
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    invalidJson();
  }
}
