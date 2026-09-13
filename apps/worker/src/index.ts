import type { Env } from './environment';
import { createAuth, resolveConsoleRequestContext, type AuthEnv } from './auth';
import { routeConsoleSessionRequest } from './console-session-routes';
import { isKnownConsoleRequest } from './console-route-match';
import { routeConsoleOrderRequest } from './console-order-routes';
import { routeConsoleFileRequest } from './console-file-routes';
import { routeConsoleImportRequest } from './console-import-routes';
import { routeConsoleProductRequest } from './console-product-routes';
import { routeStorefrontPreflight } from './storefront-cors';
import { routeStorefrontOrderRequest } from './storefront-order-routes';
import { jsonError, routeNotFound, withConsoleAuthHeaders } from './http-response';
import { routeStorefrontProductRequest } from './storefront-product-routes';

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isConsolePath(pathname: string): boolean {
  return pathname === '/api/console' || pathname.startsWith('/api/console/');
}

function authEndpointAllowed(request: Request, pathname: string): boolean {
  return (request.method === 'POST'
    && (pathname === '/api/auth/sign-in/social' || pathname === '/api/auth/sign-out'))
    || (request.method === 'GET' && pathname === '/api/auth/callback/google');
}

async function routeAuthRequest(request: Request, env: AuthEnv): Promise<Response> {
  try {
    const response = await createAuth(env).handler(request);
    const headers = new Headers(response.headers);
    headers.delete('Content-Length');
    headers.set('Cache-Control', 'no-store');
    headers.set('Referrer-Policy', 'no-referrer');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return jsonError(503, 'service_unavailable', 'The identity service is temporarily unavailable.');
  }
}

function googleAuthConfigured(env: AuthEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

function consoleOriginAllowed(request: Request, consoleOrigin: string): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  if (request.headers.get('Origin') !== consoleOrigin) return false;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  return fetchSite === null || fetchSite === 'same-origin';
}

export default {
  async fetch(request: Request, env: Env | Pick<Env, 'ASSETS'>): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (isApiPath(pathname)) {
      if (pathname.startsWith('/api/auth/')) {
        if (!('DB' in env) || !('BETTER_AUTH_SECRET' in env) || !('CONSOLE_ORIGIN' in env)) {
          return routeNotFound();
        }
        if (!authEndpointAllowed(request, pathname)) return routeNotFound();
        if (pathname !== '/api/auth/sign-out' && !googleAuthConfigured(env)) {
          return jsonError(503, 'auth_not_configured', 'Google sign-in is not configured.');
        }
        if (request.method === 'POST' && !consoleOriginAllowed(request, env.CONSOLE_ORIGIN)) {
          return jsonError(403, 'origin_not_allowed', 'This request origin is not allowed.');
        }
        return routeAuthRequest(request, env);
      }
      const storefrontOrigin = 'STOREFRONT_ORIGIN' in env ? env.STOREFRONT_ORIGIN : undefined;
      const preflight = routeStorefrontPreflight(request, storefrontOrigin);
      if (preflight !== null) return preflight;

      if (isConsolePath(pathname)) {
        if (!isKnownConsoleRequest(request)) return routeNotFound();
        if (
          !('DB' in env)
          || !('FILES' in env)
          || !('BETTER_AUTH_SECRET' in env)
          || !('CONSOLE_ORIGIN' in env)
        ) return routeNotFound();
        const resolution = await resolveConsoleRequestContext(request, env);
        if (resolution.kind !== 'resolved') {
          const response = resolution.kind === 'unauthenticated'
            ? jsonError(401, 'unauthenticated', 'Sign in to continue.')
            : resolution.kind === 'store-access-denied'
              ? jsonError(403, 'store_access_denied', 'This account has no active Store access.')
              : jsonError(503, 'service_unavailable', 'The identity service is temporarily unavailable.');
          return withConsoleAuthHeaders(response, resolution.authHeaders);
        }
        if (!consoleOriginAllowed(request, env.CONSOLE_ORIGIN)) {
          return withConsoleAuthHeaders(
            jsonError(403, 'origin_not_allowed', 'This request origin is not allowed.'),
            resolution.authHeaders,
          );
        }
        const response =
          routeConsoleSessionRequest(request, resolution.context) ??
          await routeConsoleImportRequest(request, env, resolution.context) ??
          await routeConsoleFileRequest(request, env, resolution.context) ??
          await routeConsoleProductRequest(request, env.DB, resolution.context) ??
          await routeConsoleOrderRequest(request, env.DB, resolution.context) ??
          routeNotFound();
        return withConsoleAuthHeaders(response, resolution.authHeaders);
      }

      if (!('DB' in env)) return routeNotFound();
      const response =
        await routeStorefrontProductRequest(request, env.DB, storefrontOrigin) ??
        await routeStorefrontOrderRequest(request, env.DB, storefrontOrigin);
      return response ?? routeNotFound();
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
