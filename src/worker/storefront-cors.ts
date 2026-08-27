const ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'] as const;
const ALLOWED_HEADERS = [
  'Content-Type',
  'Idempotency-Key',
  'X-Nexus-Order-Capability',
] as const;

const allowedRequestHeaders: Record<string, true> = {
  'content-type': true,
  'idempotency-key': true,
  'x-nexus-order-capability': true,
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
  if (/^\/api\/storefront\/orders\/[^/]+$/.test(pathname)) return 'GET';
  return null;
}

function hasAllowedRequestHeaders(request: Request): boolean {
  const requested = request.headers.get('Access-Control-Request-Headers');
  if (requested === null || requested.trim() === '') return true;
  return requested
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .every((header) => header !== '' && allowedRequestHeaders[header] === true);
}

function corsHeaders(origin: string): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
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
  const requestedMethod = request.headers.get('Access-Control-Request-Method');
  if (requestedMethod !== requestedMethodForPath(new URL(request.url).pathname)) return null;
  if (!hasAllowedRequestHeaders(request)) return null;

  const headers = corsHeaders(storefrontOrigin);
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
