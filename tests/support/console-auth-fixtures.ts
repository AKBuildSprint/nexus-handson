import { resolve } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { serializeSignedCookie } from 'better-call';
import { createAuth, provisionGoogleAccount } from '../../apps/worker/src/auth';
import { resolveActiveMembership } from '../../packages/identity/src/membership-store';
import { withLocalBindings } from '../../scripts/verification/local-binding-context';

export interface ConsoleTestAccount {
  email: string;
  name: string;
  googleSubject: string;
  role: 'owner' | 'staff';
  userId: string;
  sessionCookie: { name: string; value: string };
}

export interface ConsoleAuthFixture {
  owner: ConsoleTestAccount;
  staff: ConsoleTestAccount;
  operator: ConsoleTestAccount;
  sentinel: { id: string; name: string; privateEvidence: string };
}

type ConsoleStorageState = Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>;

function requiredRuntimeValue(name: string): string {
  const value = process['env'][name];
  if (!value) throw new Error(`Missing required local E2E setting: ${name}.`);
  return value;
}

async function provisionMembership(
  database: D1Database,
  userId: string,
  role: 'owner' | 'staff',
): Promise<void> {
  await database.prepare(
    `INSERT INTO store_memberships (id,store_id,user_id,role,status,revoked_at)
     VALUES (?, 'store_nexus', ?, ?, 'active', NULL)
     ON CONFLICT(user_id,store_id) DO UPDATE SET
       role=excluded.role,status='active',revoked_at=NULL,
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).bind(`membership_e2e_${userId}`, userId, role).run();
  const resolved = await resolveActiveMembership(database, userId);
  if (resolved.kind !== 'resolved' || resolved.membership.role !== role) {
    throw new Error('Local E2E membership provisioning could not be verified.');
  }
}

async function provisionLocalAuthFixture(): Promise<ConsoleAuthFixture> {
  const persistRoot = requiredRuntimeValue('NEXUS_TEST_PERSIST_ROOT');
  const consoleOrigin = requiredRuntimeValue('PLAYWRIGHT_API_CONSOLE_BASE_URL');
  const authSecret = requiredRuntimeValue('NEXUS_TEST_AUTH_SECRET');
  const ownerEmail = requiredRuntimeValue('NEXUS_TEST_OWNER_EMAIL');
  const staffEmail = requiredRuntimeValue('NEXUS_TEST_STAFF_EMAIL');
  const inputs = [
    {
      email: ownerEmail,
      name: 'E2E Nexus Owner',
      googleSubject: `e2e-google-owner:${ownerEmail}`,
      role: 'owner' as const,
    },
    {
      email: staffEmail,
      name: 'E2E Nexus Staff',
      googleSubject: `e2e-google-staff:${staffEmail}`,
      role: 'staff' as const,
    },
    {
      email: `operator-${crypto.randomUUID()}@e2e.nexus.invalid`,
      name: 'E2E Nexus Operator',
      googleSubject: `e2e-google-operator-${crypto.randomUUID()}`,
      role: 'owner' as const,
    },
  ];
  try {
    return await withLocalBindings({
      configPath: resolve('wrangler.jsonc'),
      persistRoot,
    }, async ({ bindings }) => {
      const auth = createAuth({ DB: bindings.DB, CONSOLE_ORIGIN: consoleOrigin, BETTER_AUTH_SECRET: authSecret });
      const accounts: ConsoleTestAccount[] = [];
      for (const input of inputs) {
        const provisioned = await provisionGoogleAccount(auth, input);
        await provisionMembership(bindings.DB, provisioned.userId, input.role);
        const context = await auth.$context;
        const session = await context.internalAdapter.createSession(provisioned.userId);
        const cookie = context.authCookies.sessionToken;
        const serialized = await serializeSignedCookie(cookie.name, session.token, context.secret, cookie.attributes);
        const [name, serializedValue] = serialized.split(';', 1)[0].split('=', 2);
        const value = decodeURIComponent(serializedValue);
        accounts.push({
          ...input,
          userId: provisioned.userId,
          sessionCookie: { name, value },
        });
      }
      const sentinel = {
        id: `product_e2e_auth_${crypto.randomUUID().replaceAll('-', '')}`,
        name: `E2E auth sentinel ${crypto.randomUUID().slice(0, 8)}`,
        privateEvidence: `Owner-only delivery evidence ${crypto.randomUUID()}`,
      };
      await bindings.DB.prepare(
        `INSERT INTO products (
           id,store_id,slug,name,name_search_key,slug_search_key,status,product_type,
           currency,base_price_minor,public_description,delivery_access_title,delivery_access_instructions
         ) VALUES (?,'store_nexus',?,?,? ,?,'active','simple','USD',100,
           'Local binding continuity sentinel','Owner package',?)`,
      ).bind(
        sentinel.id,
        sentinel.id,
        sentinel.name,
        sentinel.name.toLowerCase(),
        sentinel.id.toLowerCase(),
        sentinel.privateEvidence,
      ).run();
      return { owner: accounts[0], staff: accounts[1], operator: accounts[2], sentinel };
    });
  } catch (error) {
    throw new Error('Local auth E2E fixture provisioning failed.', { cause: error });
  }
}

export async function signInConsole(page: Page, account: ConsoleTestAccount): Promise<void> {
  await page.context().addCookies([{
    ...account.sessionCookie,
    url: requiredRuntimeValue('PLAYWRIGHT_API_CONSOLE_BASE_URL'),
    httpOnly: true,
    sameSite: 'Lax',
  }]);
  const installedCookies = await page.context().cookies(
    requiredRuntimeValue('PLAYWRIGHT_API_CONSOLE_BASE_URL'),
  );
  if (!installedCookies.some(({ name, value }) => name === account.sessionCookie.name && value === account.sessionCookie.value)) {
    throw new Error(`The injected local session cookie ${account.sessionCookie.name} was not accepted by the browser context.`);
  }
  const sessionResponse = await page.request.get(
    `${requiredRuntimeValue('PLAYWRIGHT_API_CONSOLE_BASE_URL')}/api/console/session`,
  );
  if (!sessionResponse.ok()) {
    throw new Error(
      `The injected ${account.sessionCookie.name} local session was rejected (${sessionResponse.status()}): ${await sessionResponse.text()}`,
    );
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
}

export async function setPersistedSessionTiming(
  userId: string,
  timing: { updatedAt: string; expiresAt: string },
): Promise<void> {
  try {
    await withLocalBindings({
      configPath: resolve('wrangler.jsonc'),
      persistRoot: requiredRuntimeValue('NEXUS_TEST_PERSIST_ROOT'),
    }, async ({ bindings }) => {
      const result = await bindings.DB.prepare(
        'UPDATE session SET updatedAt=?, expiresAt=? WHERE userId=?',
      ).bind(timing.updatedAt, timing.expiresAt, userId).run();
      if (result.meta.changes < 1) {
        throw new Error('No persisted session matched the requested local E2E identity.');
      }
    });
  } catch {
    throw new Error('Local auth E2E session arrangement failed.');
  }
}

export const test = base.extend<
  { consoleOwnerPage: Page },
  { consoleAuth: ConsoleAuthFixture; consoleOwnerStorageState: ConsoleStorageState }
>({
  consoleOwnerPage: async ({ browser, consoleOwnerStorageState }, use) => {
    const context = await browser.newContext({ storageState: consoleOwnerStorageState });
    const page = await context.newPage();
    await page.goto(`${requiredRuntimeValue('PLAYWRIGHT_API_CONSOLE_BASE_URL')}/console/products`);
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
  consoleAuth: [async ({}, use) => {
    await use(await provisionLocalAuthFixture());
  }, { scope: 'worker' }],
  consoleOwnerStorageState: [async ({ browser, consoleAuth }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${requiredRuntimeValue('PLAYWRIGHT_API_CONSOLE_BASE_URL')}/console/products`);
    await signInConsole(page, consoleAuth.operator);
    const storageState = await context.storageState();
    await context.close();
    await use(storageState);
  }, { scope: 'worker' }],
});

export { expect };
