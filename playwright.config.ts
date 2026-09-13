import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import {
  resolveLoopbackServer,
  WORKER_ISOLATION_FLAG,
} from './scripts/verification/e2e-worker-environment';
import { resolveLocalBindingContext } from './scripts/verification/local-binding-context';

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const apiConsoleServer = resolveLoopbackServer(
  process['env'].PLAYWRIGHT_API_CONSOLE_BASE_URL ?? 'http://127.0.0.1:5173',
  'PLAYWRIGHT_API_CONSOLE_BASE_URL',
);
const storefrontServer = resolveLoopbackServer(
  process['env'].PLAYWRIGHT_STOREFRONT_BASE_URL ?? 'http://127.0.0.1:5174',
  'PLAYWRIGHT_STOREFRONT_BASE_URL',
);
const apiBaseURL = process['env'].PLAYWRIGHT_API_BASE_URL ?? apiConsoleServer.origin;

if (apiConsoleServer.origin === storefrontServer.origin) {
  throw new Error('Playwright API/Console and Storefront origins must be distinct.');
}

const persistContext = resolveLocalBindingContext({
  configPath: resolve('wrangler.jsonc'),
  persistRoot: process['env'].NEXUS_TEST_PERSIST_ROOT ?? resolve('.wrangler/e2e-auth'),
});
const runId = randomUUID();
const authSecret = process['env'].NEXUS_TEST_AUTH_SECRET
  ?? `nexus-local-e2e-${randomUUID()}-${randomUUID()}`;
const authRuntime = {
  PLAYWRIGHT_API_CONSOLE_BASE_URL: apiConsoleServer.origin,
  PLAYWRIGHT_STOREFRONT_BASE_URL: storefrontServer.origin,
  NEXUS_TEST_PERSIST_ROOT: persistContext.cliPersistRoot,
  NEXUS_TEST_AUTH_SECRET: authSecret,
  BETTER_AUTH_SECRET: authSecret,
  NEXUS_TEST_OWNER_EMAIL: process['env'].NEXUS_TEST_OWNER_EMAIL ?? `owner-${runId}@e2e.nexus.invalid`,
  NEXUS_TEST_STAFF_EMAIL: process['env'].NEXUS_TEST_STAFF_EMAIL ?? `staff-${runId}@e2e.nexus.invalid`,
  GOOGLE_CLIENT_ID: process['env'].GOOGLE_CLIENT_ID ?? 'local-e2e-google-client-id',
  GOOGLE_CLIENT_SECRET: process['env'].GOOGLE_CLIENT_SECRET ?? 'local-e2e-google-client-secret',
};

Object.assign(process['env'], authRuntime);

const checkConsolePort = `npx tsx scripts/verification/local-binding-context.ts check-port ${shellArgument(apiConsoleServer.hostname)} ${apiConsoleServer.port}`;
const checkStorefrontPort = `npx tsx scripts/verification/local-binding-context.ts check-port ${shellArgument(storefrontServer.hostname)} ${storefrontServer.port}`;
const applyMigrations = `npx wrangler d1 migrations apply nexus-s1-468cba-db --local --persist-to ${shellArgument(persistContext.cliPersistRoot)} --config wrangler.jsonc`;

export default defineConfig({
  testDir: './tests/e2e',
  preserveOutput: 'never',
  fullyParallel: false,
  workers: 1,
  metadata: {
    apiBaseURL,
    consoleBaseURL: apiConsoleServer.origin,
    storefrontBaseURL: storefrontServer.origin,
  },
  use: {
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'console',
      testMatch: /(?:^|[/\\])console-[^/\\]*\.spec\.ts$/,
      use: {
        baseURL: apiConsoleServer.origin,
      },
    },
    {
      name: 'storefront',
      testMatch: /(?:^|[/\\])storefront-[^/\\]*\.spec\.ts$/,
      use: {
        baseURL: storefrontServer.origin,
      },
    },
  ],
  webServer: [
    {
      command: `${checkConsolePort} && ${applyMigrations} && npm run dev:console -- --host ${shellArgument(apiConsoleServer.hostname)} --port ${apiConsoleServer.port}`,
      url: apiConsoleServer.origin,
      env: {
        ...authRuntime,
        // The launched Worker takes its origins and auth secret from this harness only.
        // Wrangler must not fall back to the developer's `.dev.vars`, `.env`, or the rest of
        // the parent process environment, so both dotenv sources stay off for this server.
        [WORKER_ISOLATION_FLAG]: 'true',
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
        CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
      },
      reuseExistingServer: false,
    },
    {
      command: `${checkStorefrontPort} && npm run dev:storefront -- --host ${shellArgument(storefrontServer.hostname)} --port ${storefrontServer.port}`,
      url: storefrontServer.origin,
      env: {
        VITE_STOREFRONT_API_BASE_URL: apiBaseURL,
      },
      reuseExistingServer: false,
    },
  ],
});
