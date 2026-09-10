import { env } from 'cloudflare:test';
import { serializeSignedCookie } from 'better-call';
import { createConsoleAuth, type AuthConfiguration } from '@nexus/auth/auth';
import worker from '../../apps/worker/src';

export const TEST_CONSOLE_ORIGIN = 'https://local.invalid';
export const TEST_AUTH_EMAIL = 'operator@example.test';
export const TEST_AUTH_CONFIGURATION = {
  BETTER_AUTH_URL: TEST_CONSOLE_ORIGIN,
  BETTER_AUTH_SECRET: 'test-only-console-secret-with-at-least-32-characters',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  CONSOLE_ALLOWED_EMAILS: TEST_AUTH_EMAIL,
} satisfies AuthConfiguration;

export async function createTestSession(options: {
  email?: string;
  emailVerified?: boolean;
  expiresAt?: Date;
  configuration?: AuthConfiguration;
} = {}) {
  const configuration = options.configuration ?? TEST_AUTH_CONFIGURATION;
  const context = await createConsoleAuth(env.DB, configuration).$context;
  const email = options.email ?? TEST_AUTH_EMAIL;
  const existing = await context.internalAdapter.findUserByEmail(email, { includeAccounts: false });
  // Seed a persisted identity through the real adapter; OAuth identity validation needs an HTTP endpoint context.
  const user = existing?.user ?? await context.adapter.create<{
    id: string; email: string; emailVerified: boolean; name: string; createdAt: Date; updatedAt: Date;
  }>({
    model: 'user',
    data: {
      email,
      emailVerified: options.emailVerified ?? true,
      name: 'Console Operator',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const session = await context.internalAdapter.createSession(user.id);
  if (options.expiresAt) {
    await context.internalAdapter.updateSession(session.token, { expiresAt: options.expiresAt });
  }
  const cookie = context.authCookies.sessionToken;
  const serializedCookie = await serializeSignedCookie(cookie.name, session.token, context.secret, cookie.attributes);
  return {
    user,
    session,
    cookie: serializedCookie.split(';')[0]!,
    serializedCookie,
    context,
  };
}

let defaultSession: ReturnType<typeof createTestSession> | undefined;

export function resetAuthTestSession(): void {
  defaultSession = undefined;
}

export function defaultTestSession(): ReturnType<typeof createTestSession> {
  defaultSession ??= createTestSession();
  return defaultSession;
}

export async function authenticatedConsoleHeaders(init?: RequestInit): Promise<Headers> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Cookie')) headers.set('Cookie', (await defaultTestSession()).cookie);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(init?.method?.toUpperCase() ?? 'GET') && !headers.has('Origin')) {
    headers.set('Origin', TEST_CONSOLE_ORIGIN);
  }
  return headers;
}

/** Calls the real Worker without implicitly supplying a session or mutation origin. */
export function authWorkerRequest(
  path: string,
  init?: RequestInit,
  configuration: AuthConfiguration = TEST_AUTH_CONFIGURATION,
): Promise<Response> {
  return worker.fetch(new Request(`${TEST_CONSOLE_ORIGIN}${path}`, init), {
    DB: env.DB,
    FILES: env.FILES,
    ...configuration,
    STOREFRONT_ORIGIN: 'https://storefront.test',
    ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
  });
}
