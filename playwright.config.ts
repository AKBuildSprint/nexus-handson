import { defineConfig } from '@playwright/test';

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

const apiConsoleServer = localServer(
  process.env.PLAYWRIGHT_API_CONSOLE_BASE_URL,
  'http://127.0.0.1:5173',
  'PLAYWRIGHT_API_CONSOLE_BASE_URL',
);
const storefrontServer = localServer(
  process.env.PLAYWRIGHT_STOREFRONT_BASE_URL,
  'http://127.0.0.1:5174',
  'PLAYWRIGHT_STOREFRONT_BASE_URL',
);
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL ?? apiConsoleServer.origin;

if (apiConsoleServer.origin === storefrontServer.origin) {
  throw new Error('Playwright API/Console and Storefront origins must be distinct.');
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  metadata: {
    apiBaseURL,
    consoleBaseURL: apiConsoleServer.origin,
    storefrontBaseURL: storefrontServer.origin,
  },
  use: {
    trace: 'retain-on-failure',
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
      command: `npx wrangler d1 migrations apply nexus-s1-468cba-db --local --config wrangler.jsonc && npm run dev:console -- --host ${apiConsoleServer.hostname} --port ${apiConsoleServer.port}`,
      url: apiConsoleServer.origin,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run dev:storefront -- --host ${storefrontServer.hostname} --port ${storefrontServer.port}`,
      url: storefrontServer.origin,
      env: {
        VITE_STOREFRONT_API_BASE_URL: apiBaseURL,
      },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
