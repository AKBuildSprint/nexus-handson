const ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'] as const;
const CATALOG_ALLOWED_HEADERS = [
  'Content-Type',
  'Idempotency-Key',
  'X-Nexus-Order-Capability',
] as const;
const ORDER_ALLOWED_HEADERS = [
  ...CATALOG_ALLOWED_HEADERS,
  'X-Nexus-Order-Contract',
] as const;

const catalogRequestHeaders: Record<string, true> = {
  'content-type': true,
  'idempotency-key': true,
  'x-nexus-order-capability': true,
};
const orderRequestHeaders: Record<string, true> = {
  ...catalogRequestHeaders,
  'x-nexus-order-contract': true,
};

function appendVary(headers: Headers, values: readonly string[]): void {
  const existing = (headers.get('Vary') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set(existing.map((value) => value.toLowerCase()));
  for (const value of values) {
    if (!seen.has(value.toLowerCase())) existing.push(value);
  }
  headers.set('Vary', existing.join(', '));
}

function isAllowedOrigin(request: Request, storefrontOrigin: string | undefined): storefrontOrigin is string {
  return storefrontOrigin !== undefined
    && storefrontOrigin !== ''
    && request.headers.get('Origin') === storefrontOrigin;
}

function requestedMethodForPath(pathname: string): 'GET' | 'POST' | null {
  if (pathname === '/api/storefront/products') return 'GET';
  if (pathname === '/api/storefront/orders') return 'POST';
  if (/^\/api\/storefront\/orders\/[^/]+\/refund-requests$/.test(pathname)) return 'POST';
  if (/^\/api\/storefront\/orders\/[^/]+$/.test(pathname)) return 'GET';
  return null;
}

function isStorefrontOrderPath(pathname: string): boolean {
  return pathname === '/api/storefront/orders'
    || /^\/api\/storefront\/orders\/[^/]+(?:\/refund-requests)?$/.test(pathname);
}

function hasAllowedRequestHeaders(request: Request, pathname: string): boolean {
  const requested = request.headers.get('Access-Control-Request-Headers');
  if (requested === null || requested.trim() === '') return true;
  const allowed = isStorefrontOrderPath(pathname) ? orderRequestHeaders : catalogRequestHeaders;
  return requested
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .every((header) => header !== '' && allowed[header] === true);
}

function corsHeaders(origin: string, pathname: string): Headers {
  const allowHeaders = isStorefrontOrderPath(pathname) ? ORDER_ALLOWED_HEADERS : CATALOG_ALLOWED_HEADERS;
  const headers = new Headers({
    'Access-Control-Allow-Headers': allowHeaders.join(', '),
    'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', '),
    'Access-Control-Allow-Origin': origin,
  });
  appendVary(headers, ['Origin']);
  return headers;
}


export function routeStorefrontPreflight(
  request: Request,
  storefrontOrigin: string | undefined,
): Response | null {
  if (request.method !== 'OPTIONS' || !isAllowedOrigin(request, storefrontOrigin)) return null;
  const pathname = new URL(request.url).pathname;
  const requestedMethod = request.headers.get('Access-Control-Request-Method');
  if (requestedMethod !== requestedMethodForPath(pathname)) return null;
  if (!hasAllowedRequestHeaders(request, pathname)) return null;

  const headers = corsHeaders(storefrontOrigin, pathname);
  appendVary(headers, ['Access-Control-Request-Method', 'Access-Control-Request-Headers']);
  return new Response(null, { status: 204, headers });
}

export function withStorefrontCors(
  request: Request,
  storefrontOrigin: string | undefined,
  response: Response,
): Response {
  if (!isAllowedOrigin(request, storefrontOrigin)) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', storefrontOrigin);
  appendVary(headers, ['Origin']);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
