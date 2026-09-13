import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface LoopbackServer {
  origin: string;
  hostname: string;
  port: number;
}

export interface IsolatedPersistRootOptions {
  projectRoot: string;
  persistRoot: string;
  label: string;
}

export type ConsoleWorkerVars = {
  CONSOLE_ORIGIN: string;
  STOREFRONT_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

export interface ConsoleWorkerIsolation {
  /**
   * Synthetic Wrangler config path handed to the Cloudflare Vite plugin as `userConfigPath`.
   * The file is never created: Wrangler only uses this path's directory to locate `.dev.vars`
   * and `.env`, so pointing it at the isolated persistence root keeps a developer's real
   * repository-root `.dev.vars` out of the E2E Worker without touching that file.
   */
  workerConfigPath: string;
  vars: ConsoleWorkerVars;
}

export const WORKER_ISOLATION_FLAG = 'NEXUS_TEST_WORKER_ISOLATION';

const ISOLATED_WORKER_CONFIG_FILENAME = 'e2e-worker.jsonc';

export function resolveLoopbackServer(value: string, label: string): LoopbackServer {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError(`${label} must be an http loopback origin.`, { cause: error });
  }
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new TypeError(`${label} must be an http loopback origin without credentials, a path, query, or fragment.`);
  }

  return {
    origin: url.origin,
    hostname: url.hostname,
    port: Number(url.port || '80'),
  };
}

/**
 * Accepts only an absolute Wrangler CLI persistence root that stays inside the repository
 * `.wrangler` directory, so local test state can never collide with, or escape, developer state.
 */
export function resolveIsolatedPersistRoot(options: IsolatedPersistRootOptions): string {
  if (!isAbsolute(options.persistRoot)) {
    throw new TypeError(`${options.label} must be an absolute path.`);
  }
  const persistRoot = resolve(options.persistRoot);
  if (basename(persistRoot) === 'v3') {
    throw new TypeError(`${options.label} must be the Wrangler CLI root, without the v3 suffix.`);
  }
  const wranglerStateRoot = resolve(options.projectRoot, '.wrangler');
  const relativePersistRoot = relative(wranglerStateRoot, persistRoot);
  if (
    relativePersistRoot === '' ||
    relativePersistRoot === '..' ||
    relativePersistRoot.startsWith(`..${sep}`)
  ) {
    throw new TypeError(`${options.label} must be an isolated directory under the repository .wrangler directory.`);
  }
  return persistRoot;
}

function requiredValue(environment: Partial<NodeJS.ProcessEnv>, name: string): string {
  const value = environment[name];
  if (!value) throw new TypeError(`Missing required local E2E setting: ${name}.`);
  return value;
}

/**
 * Resolves the binding overrides for a Console Worker launched by the local E2E harness.
 * Returns `undefined` for ordinary development, which leaves the canonical root Wrangler
 * config and the developer's own `.dev.vars` in charge.
 */
export function resolveConsoleWorkerIsolation(
  environment: Partial<NodeJS.ProcessEnv>,
  projectRoot: string,
): ConsoleWorkerIsolation | undefined {
  const flag = environment[WORKER_ISOLATION_FLAG];
  if (flag === undefined) return undefined;
  if (flag !== 'true') {
    throw new TypeError(`${WORKER_ISOLATION_FLAG} must be "true" when it is set.`);
  }

  const persistRoot = resolveIsolatedPersistRoot({
    projectRoot,
    persistRoot: requiredValue(environment, 'NEXUS_TEST_PERSIST_ROOT'),
    label: 'NEXUS_TEST_PERSIST_ROOT',
  });
  const consoleOrigin = resolveLoopbackServer(
    requiredValue(environment, 'PLAYWRIGHT_API_CONSOLE_BASE_URL'),
    'PLAYWRIGHT_API_CONSOLE_BASE_URL',
  ).origin;
  const storefrontOrigin = resolveLoopbackServer(
    requiredValue(environment, 'PLAYWRIGHT_STOREFRONT_BASE_URL'),
    'PLAYWRIGHT_STOREFRONT_BASE_URL',
  ).origin;
  if (consoleOrigin === storefrontOrigin) {
    throw new TypeError('The local E2E Console and Storefront origins must be distinct.');
  }

  return {
    workerConfigPath: join(persistRoot, ISOLATED_WORKER_CONFIG_FILENAME),
    vars: {
      CONSOLE_ORIGIN: consoleOrigin,
      STOREFRONT_ORIGIN: storefrontOrigin,
      BETTER_AUTH_SECRET: requiredValue(environment, 'NEXUS_TEST_AUTH_SECRET'),
      GOOGLE_CLIENT_ID: requiredValue(environment, 'GOOGLE_CLIENT_ID'),
      GOOGLE_CLIENT_SECRET: requiredValue(environment, 'GOOGLE_CLIENT_SECRET'),
    },
  };
}
