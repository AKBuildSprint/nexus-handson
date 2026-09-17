import { confirmPayfsCredit } from '@nexus/orders/commands/order-commands';
import { OrderPersistenceError, OrderValidationError } from '@nexus/orders/order-types';
import type { Env } from './environment';
import { jsonError, jsonResponse } from './http-response';

const PAYFS_WEBHOOK_PATH = '/api/payfs/webhook';
const PAYFS_MAX_BODY_BYTES = 16 * 1024;
type PayfsRouteEnv = Pick<
  Env,
  'DB' | 'PAYFS_WEBHOOK_API_KEY' | 'PAYFS_MERCHANT_BANK' | 'PAYFS_FEFAULT_ACCOUNT'
>;

type PayfsConfiguration = {
  apiKey: string;
  merchantBank: string;
  merchantAccount: string;
};

function payfsConfiguration(env: PayfsRouteEnv): PayfsConfiguration | null {
  const apiKey = env.PAYFS_WEBHOOK_API_KEY;
  const merchantBank = env.PAYFS_MERCHANT_BANK;
  const merchantAccount = env.PAYFS_FEFAULT_ACCOUNT;
  if (
    typeof apiKey !== 'string' || apiKey.trim() === ''
    || typeof merchantBank !== 'string' || !/^[A-Za-z0-9]{2,16}$/u.test(merchantBank)
    || typeof merchantAccount !== 'string' || !/^[A-Za-z0-9-]{1,80}$/u.test(merchantAccount)
  ) return null;
  return { apiKey, merchantBank: merchantBank.toUpperCase(), merchantAccount };
}
function methodNotAllowed(): Response {
  const response = jsonError(405, 'method_not_allowed', 'The PayFS webhook only accepts POST requests.');
  response.headers.set('Allow', 'POST');
  return response;
}

async function parsePayfsBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > PAYFS_MAX_BODY_BYTES) {
      throw new OrderValidationError('validation_failed', 'The PayFS payload is invalid.', [], 400);
    }
  }
  if (request.body === null) {
    throw new OrderValidationError('validation_failed', 'The PayFS payload is invalid.', [], 400);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PAYFS_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OrderValidationError('validation_failed', 'The PayFS payload is invalid.', [], 400);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new OrderValidationError('validation_failed', 'The PayFS payload is invalid.', [], 400);
  }
}

function payfsFailure(error: unknown): Response {
  if (error instanceof OrderValidationError) {
    return jsonError(400, 'invalid_payfs_request', 'The PayFS request is invalid.');
  }
  const incidentId = crypto.randomUUID();
  console.error('Unexpected PayFS webhook failure', {
    incidentId,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  if (error instanceof OrderPersistenceError) {
    return jsonError(500, 'payfs_persistence_failed', 'The PayFS request could not be processed.', [], incidentId);
  }
  return jsonError(500, 'payfs_processing_failed', 'The PayFS request could not be processed.', [], incidentId);
}

export async function routePayfsWebhookRequest(
  request: Request,
  env: PayfsRouteEnv | Pick<Env, 'ASSETS'>,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== PAYFS_WEBHOOK_PATH) return null;
  if (request.method !== 'POST') return methodNotAllowed();
  if (!('DB' in env)) {
    return jsonError(503, 'payfs_not_configured', 'The PayFS webhook is not configured.');
  }
  const configuration = payfsConfiguration(env);
  if (!env.DB || configuration === null) {
    return jsonError(503, 'payfs_not_configured', 'The PayFS webhook is not configured.');
  }
  if (request.headers.get('X-Client-API-Key') !== configuration.apiKey) {
    return jsonError(401, 'unauthorized', 'The PayFS webhook is unauthorized.');
  }
  try {
    const outcome = await confirmPayfsCredit({
      database: env.DB,
      body: await parsePayfsBody(request),
      merchantBank: configuration.merchantBank,
      merchantAccount: configuration.merchantAccount,
    });
    return jsonResponse({ status: outcome });
  } catch (error) {
    return payfsFailure(error);
  }
}
