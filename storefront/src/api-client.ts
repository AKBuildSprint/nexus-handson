import type {
  CreateStorefrontOrderInput,
  CustomerOrderView,
  OrderAttemptIdentity,
  StorefrontCatalog,
} from './storefront-view-types';
const API_BASE_VARIABLE = 'VITE_STOREFRONT_API_BASE_URL';

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
  ) {
    super(retryable
      ? 'The request did not complete. Check your connection and retry.'
      : 'The request could not be completed. Review your details and try again.');
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

async function decode<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new StorefrontApiError(response.status, response.status >= 500 || response.status === 408 || response.status === 429);
  }
  return await response.json() as T;
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
