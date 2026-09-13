import { env } from 'cloudflare:test';
import { createAuth, provisionGoogleAccount, type AuthEnv, type NexusAuth } from '../../apps/worker/src/auth';
import { serializeSignedCookie } from 'better-call';

export const TEST_CONSOLE_ORIGIN = 'https://local.invalid';
export const TEST_BETTER_AUTH_SECRET = 'nexus-test-only-secret-32-bytes-minimum';
export const TEST_GOOGLE_CLIENT_ID = 'test-google-client-id';
export const TEST_GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

export function testAuthEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    DB: env.DB,
    CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN,
    BETTER_AUTH_SECRET: TEST_BETTER_AUTH_SECRET,
    GOOGLE_CLIENT_ID: TEST_GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: TEST_GOOGLE_CLIENT_SECRET,
    ...overrides,
  };
}

export function createTestAuth(overrides: Partial<AuthEnv> = {}): NexusAuth {
  return createAuth(testAuthEnv(overrides));
}

export function authRequest(
  auth: NexusAuth,
  path: string,
  init: RequestInit = {},
  requestOrigin = TEST_CONSOLE_ORIGIN,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Origin')) headers.set('Origin', requestOrigin);
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', '203.0.113.10');
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return auth.handler(new Request(`${requestOrigin}${path}`, { ...init, headers }));
}

export function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('Expected Better Auth to set a session cookie.');
  return setCookie.split(';', 1)[0];
}

export async function createPersistedTestSession(auth: NexusAuth, userId: string): Promise<string> {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
  const authCookie = context.authCookies.sessionToken;
  const serialized = await serializeSignedCookie(
    authCookie.name,
    session.token,
    context.secret,
    authCookie.attributes,
  );
  return serialized.split(';', 1)[0];
}

export async function createConsoleSession(input: {
  email?: string;
  name?: string;
  googleSubject?: string;
  storeId?: string;
  role?: 'owner' | 'staff';
  status?: 'active' | 'revoked';
} = {}): Promise<{ cookie: string; userId: string }> {
  const email = input.email ?? 'owner@example.test';
  const name = input.name ?? 'Nexus Owner';
  const googleSubject = input.googleSubject ?? `google-subject-${email}`;
  const storeId = input.storeId ?? 'store_nexus';
  const role = input.role ?? 'owner';
  const status = input.status ?? 'active';
  const auth = createTestAuth();
  const provisioned = await provisionGoogleAccount(auth, { email, name, googleSubject });
  await env.DB.prepare(
    `INSERT INTO store_memberships (
       id, store_id, user_id, role, status, revoked_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, store_id) DO UPDATE SET
       role = excluded.role,
       status = excluded.status,
       revoked_at = excluded.revoked_at,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(
    `membership_${provisioned.userId}_${storeId}`,
    storeId,
    provisioned.userId,
    role,
    status,
    status === 'revoked' ? new Date().toISOString() : null,
  ).run();
  return { cookie: await createPersistedTestSession(auth, provisioned.userId), userId: provisioned.userId };
}
