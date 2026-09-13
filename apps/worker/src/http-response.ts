export interface ErrorField {
  path: string;
  code: string;
  message: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields: ErrorField[];
    incidentId: string | null;
  };
}

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export const ORDER_CONTRACT_HEADER = 'X-Nexus-Order-Contract';
export const ORDER_CONTRACT_VERSION = '2';

export function orderContractAccepted(request: Request): boolean {
  return request.headers.get(ORDER_CONTRACT_HEADER) === ORDER_CONTRACT_VERSION;
}

export function orderContractOutdatedResponse(): Response {
  return jsonError(
    409,
    'client_contract_outdated',
    'This client is out of date. Reload the page and try again.',
  );
}
export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}


export function jsonError(
  status: number,
  code: string,
  message: string,
  fields: ErrorField[] = [],
  incidentId: string | null = null,
): Response {
  const body: ErrorEnvelope = {
    error: { code, message, fields, incidentId },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

export function routeNotFound(): Response {
  return jsonError(404, 'route_not_found', 'The requested API route was not found.');
}

export function withConsoleAuthHeaders(response: Response, authHeaders: Headers): Response {
  const headers = new Headers(response.headers);
  for (const cookie of authHeaders.getSetCookie()) headers.append('Set-Cookie', cookie);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
