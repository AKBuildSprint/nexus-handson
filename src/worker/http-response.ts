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
