import type {
  CreateStorefrontOrderInput,
  CustomerOrderView,
  OrderAttemptIdentity,
  OrderCommandResultView,
  StorefrontCatalog,
} from './storefront-view-types';

const API_BASE_VARIABLE = 'VITE_STOREFRONT_API_BASE_URL';
const STOREFRONT_MUTATION_DEADLINE_MS = 15_000;

export interface StorefrontErrorField {
  path: string;
  code: string;
  message: string;
}

function normalizeApiBaseUrl(value: string | undefined): string | null {
  const configuredValue = value?.trim();
  if (!configuredValue) return null;

  const url = new URL(configuredValue);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${API_BASE_VARIABLE} must use http or https.`);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`${API_BASE_VARIABLE} must be an origin without credentials, a path, query, or fragment.`);
  }

  return url.origin;
}

export const storefrontApiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_STOREFRONT_API_BASE_URL);

export function storefrontApiUrl(pathname: string): URL {
  if (!storefrontApiBaseUrl) {
    throw new Error(`${API_BASE_VARIABLE} is required before the Storefront can call the Nexus API.`);
  }
  if (!pathname.startsWith('/') || pathname.startsWith('//')) {
    throw new Error('Storefront API paths must start with exactly one slash.');
  }

  return new URL(pathname, storefrontApiBaseUrl);
}

export class StorefrontApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    readonly code?: string,
    readonly fields?: StorefrontErrorField[],
    readonly incidentId?: string | null,
    message?: string,
  ) {
    super(message ?? (retryable
      ? 'The request did not complete. Check your connection and retry.'
      : 'The request could not be completed. Review your details and try again.'));
    this.name = 'StorefrontApiError';
  }
}

function randomOpaqueValue(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = '';
  buffer.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function createOrderAttemptIdentity(): OrderAttemptIdentity {
  return {
    capability: randomOpaqueValue(32),
    idempotencyKey: crypto.randomUUID(),
  };
}

function readErrorFields(value: unknown): StorefrontErrorField[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const fields: StorefrontErrorField[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    if (!('path' in entry) || !('code' in entry) || !('message' in entry)) continue;
    if (typeof entry.path !== 'string' || typeof entry.code !== 'string' || typeof entry.message !== 'string') continue;
    fields.push({ path: entry.path, code: entry.code, message: entry.message });
  }
  return fields;
}

function readErrorEnvelope(body: unknown): {
  code?: string;
  message?: string;
  fields?: StorefrontErrorField[];
  incidentId?: string | null;
} {
  if (body === null || typeof body !== 'object' || !('error' in body)) return {};
  const error = body.error;
  if (error === null || typeof error !== 'object') return {};
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : undefined;
  const fields = 'fields' in error ? readErrorFields(error.fields) : undefined;
  const incidentId = 'incidentId' in error && (error.incidentId === null || typeof error.incidentId === 'string')
    ? error.incidentId
    : undefined;
  return { code, message, fields, incidentId };
}

async function decode<T>(response: Response): Promise<T> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    if (response.ok) throw new TypeError('The response could not be read.');
  }
  if (!response.ok) {
    const envelope = readErrorEnvelope(parsed);
    throw new StorefrontApiError(
      response.status,
      response.status >= 500 || response.status === 408 || response.status === 429,
      envelope.code,
      envelope.fields,
      envelope.incidentId,
      envelope.message,
    );
  }
  return parsed as T;
}

async function decodeUntil(response: Response, signal: AbortSignal): Promise<OrderCommandResultView> {
  if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  const decoded = decode<OrderCommandResultView>(response);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([decoded, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export async function fetchCatalog(signal?: AbortSignal): Promise<StorefrontCatalog> {
  const response = await fetch(storefrontApiUrl('/api/storefront/products'), {
    headers: { Accept: 'application/json' },
    signal,
  });
  return await decode<StorefrontCatalog>(response);
}

export async function createStorefrontOrder(
  input: CreateStorefrontOrderInput,
  identity: OrderAttemptIdentity,
): Promise<CustomerOrderView> {
  const response = await fetch(storefrontApiUrl('/api/storefront/orders'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': identity.idempotencyKey,
      'X-Nexus-Order-Capability': identity.capability,
    },
    body: JSON.stringify(input),
  });
  return await decode<CustomerOrderView>(response);
}

export async function fetchStorefrontOrder(
  reference: string,
  capability: string,
  signal?: AbortSignal,
): Promise<CustomerOrderView> {
  const response = await fetch(storefrontApiUrl(`/api/storefront/orders/${encodeURIComponent(reference)}`), {
    headers: {
      Accept: 'application/json',
      'X-Nexus-Order-Capability': capability,
    },
    signal,
  });
  return await decode<CustomerOrderView>(response);
}

export async function createStorefrontRefundRequest(
  reference: string,
  capability: string,
  reason: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OrderCommandResultView> {
  const timeout = AbortSignal.timeout(STOREFRONT_MUTATION_DEADLINE_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(storefrontApiUrl(`/api/storefront/orders/${encodeURIComponent(reference)}/refund-requests`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-Nexus-Order-Capability': capability,
    },
    body: JSON.stringify({ reason }),
    signal: combined,
  });
  return await decodeUntil(response, combined);
}
