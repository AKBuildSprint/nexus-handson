function matches(method: string, expected: string, pattern: RegExp, pathname: string): boolean {
  return method === expected && pattern.test(pathname);
}

export function isKnownConsoleRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  const method = request.method;
  if (matches(method, 'GET', /^\/api\/console\/session$/, pathname)) return true;
  if (matches(method, 'GET', /^\/api\/console\/staff$/, pathname)) return true;
  if (matches(method, 'GET', /^\/api\/console\/imports\/template$/, pathname)) return true;
  if (matches(method, 'POST', /^\/api\/console\/imports$/, pathname)) return true;

  if (matches(method, 'GET', /^\/api\/console\/products$/, pathname)) return true;
  if (matches(method, 'GET', /^\/api\/console\/products\/by-slug\/[^/]+$/, pathname)) return true;
  if (matches(method, 'POST', /^\/api\/console\/products(?:\/schema\/preview)?$/, pathname)) return true;
  if (matches(method, 'PUT', /^\/api\/console\/products\/[^/]+(?:\/schema)?$/, pathname)) return true;
  if (
    (method === 'PUT' || method === 'DELETE')
    && /^\/api\/console\/products\/[^/]+(?:\/variants\/[^/]+)?\/delivery-file$/.test(pathname)
  ) return true;

  if (matches(method, 'GET', /^\/api\/console\/orders(?:\/[^/]+)?$/, pathname)) return true;
  return matches(
    method,
    'POST',
    /^\/api\/console\/orders\/[^/]+\/(?:payments\/manual|fulfill|cancel|refund-requests(?:\/rrq_[a-f0-9]{32}\/(?:approve|reject))?|assignment)$/,
    pathname,
  );
}
