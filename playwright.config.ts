import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { resolveLocalBindingContext } from './scripts/verification/local-binding-context';

interface LocalServer {
  origin: string;
  hostname: string;
  port: number;
}

function localServer(environmentValue: string | undefined, fallback: string, label: string): LocalServer {
  const url = new URL(environmentValue ?? fallback);
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be an http loopback origin without credentials, a path, query, or fragment.`);
  }

  return {
    origin: url.origin,
    hostname: url.hostname,
    port: Number(url.port || '80'),
  };
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const apiConsoleServer = localServer(
  process['env'].PLAYWRIGHT_API_CONSOLE_BASE_URL,
  'http://127.0.0.1:5173',
  'PLAYWRIGHT_API_CONSOLE_BASE_URL',
);
const storefrontServer = localServer(
  process['env'].PLAYWRIGHT_STOREFRONT_BASE_URL,
  'http://127.0.0.1:5174',
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
        CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
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
