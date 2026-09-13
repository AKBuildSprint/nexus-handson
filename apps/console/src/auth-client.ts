import { ConsoleApiError } from './api-client';

export type ConsoleRole = 'owner' | 'staff';

export interface ConsoleSessionView {
  user: { id: string; name: string };
  store: { id: string; name: string };
  role: ConsoleRole;
  allowedActions: string[];
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    fields?: Array<{ path: string; code: string; message: string }>;
    incidentId?: string | null;
  };
}

async function decodeAuthResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | ErrorEnvelope | null;
  if (!response.ok) {
    const envelope = body as ErrorEnvelope | null;
    throw new ConsoleApiError(
      response.status,
      envelope?.error?.code ?? (response.status === 401 ? 'unauthenticated' : 'auth_failed'),
      envelope?.error?.message ?? 'The Console session request failed.',
      envelope?.error?.fields ?? [],
      envelope?.error?.incidentId ?? null,
    );
  }
  return body as T;
}

export async function fetchConsoleSession(signal?: AbortSignal): Promise<ConsoleSessionView> {
  return decodeAuthResponse(await fetch('/api/console/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  }));
}

export async function startGoogleSignIn(callbackURL: string, signal?: AbortSignal): Promise<string> {
  const result = await decodeAuthResponse<{ url: string }>(await fetch('/api/auth/sign-in/social', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      provider: 'google',
      callbackURL,
      errorCallbackURL: '/console/login?error=google_sign_in_failed',
    }),
    signal,
  }));
  const authorizationURL = new URL(result.url);
  if (authorizationURL.protocol !== 'https:' || authorizationURL.hostname !== 'accounts.google.com') {
    throw new ConsoleApiError(502, 'invalid_oauth_redirect', 'Google sign-in returned an invalid redirect.', [], null);
  }
  return authorizationURL.href;
}

export async function signOutConsole(signal?: AbortSignal): Promise<void> {
  await decodeAuthResponse(await fetch('/api/auth/sign-out', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({}),
    signal,
  }));
}
