import {
  AuthConfigurationError,
  consoleAuthOrigin,
  consoleEmailAllowed,
  createConsoleAuth,
} from '@nexus/auth/auth';
import type { Env } from './environment';
import { jsonError, jsonResponse, routeNotFound } from './http-response';

export interface ConsoleUser {
  id: string;
  name: string;
  email: string;
}

function authFailure(error: unknown): Response {
  if (error instanceof AuthConfigurationError) {
    return jsonError(503, 'auth_not_configured', 'Console sign-in is not configured. Contact the store administrator.');
  }
  return jsonError(503, 'auth_unavailable', 'Sign-in could not be checked. Please try again.');
}

export function consoleMutationOriginAccepted(request: Request, env: Env): boolean {
  return request.headers.get('Origin') === consoleAuthOrigin(env)
    && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}

export async function authenticateConsole(request: Request, env: Env): Promise<ConsoleUser | Response> {
  try {
    const auth = createConsoleAuth(env.DB, env);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return jsonError(401, 'authentication_required', 'Sign in with Google to continue.');
    if (!session.user.emailVerified || !consoleEmailAllowed(env, session.user.email)) {
      return jsonError(403, 'access_denied', 'This account cannot access the Console.');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !consoleMutationOriginAccepted(request, env)) {
      return jsonError(403, 'invalid_origin', 'This request must come from the Console.');
    }
    return { id: session.user.id, name: session.user.name, email: session.user.email };
  } catch (error) {
    return authFailure(error);
  }
}

export async function routeConsoleAuth(request: Request, env: Env): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const allowed = (request.method === 'POST' && (
    pathname === '/api/auth/sign-in/social' || pathname === '/api/auth/sign-out'
  )) || (request.method === 'GET' && (
    pathname === '/api/auth/callback/google' || pathname === '/api/auth/get-session'
  ));
  if (!allowed) return routeNotFound();

  try {
    const auth = createConsoleAuth(env.DB, env);
    if (request.method === 'POST' && !consoleMutationOriginAccepted(request, env)) {
      return jsonError(403, 'invalid_origin', 'This request must come from the Console.');
    }
    if (pathname === '/api/auth/get-session') {
      const user = await authenticateConsole(request, env);
      if (user instanceof Response) return user;
      return jsonResponse({ user });
    }
    const response = await auth.handler(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Referrer-Policy', 'no-referrer');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    return authFailure(error);
  }
}
