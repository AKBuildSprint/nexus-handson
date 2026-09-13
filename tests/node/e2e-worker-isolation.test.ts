import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unstable_getVarsForDev } from 'wrangler';
import {
  resolveConsoleWorkerIsolation,
  resolveLoopbackServer,
  WORKER_ISOLATION_FLAG,
} from '../../scripts/verification/e2e-worker-environment';

const DEVELOPER_DEV_VARS = [
  'BETTER_AUTH_SECRET=developer-dev-vars-secret-value',
  'GOOGLE_CLIENT_SECRET=developer-google-client-secret',
  '',
].join('\n');

const CANONICAL_VARS = {
  CONSOLE_ORIGIN: 'http://127.0.0.1:5173',
  STOREFRONT_ORIGIN: 'http://127.0.0.1:5174',
};

const E2E_SECRET = 'nexus-local-e2e-generated-secret-value';

let projectRoot: string;

function e2eEnvironment(): Partial<NodeJS.ProcessEnv> {
  return {
    [WORKER_ISOLATION_FLAG]: 'true',
    NEXUS_TEST_PERSIST_ROOT: join(projectRoot, '.wrangler', 'e2e-auth'),
    PLAYWRIGHT_API_CONSOLE_BASE_URL: 'http://127.0.0.1:5273',
    PLAYWRIGHT_STOREFRONT_BASE_URL: 'http://127.0.0.1:5274',
    NEXUS_TEST_AUTH_SECRET: E2E_SECRET,
    GOOGLE_CLIENT_ID: 'local-e2e-google-client-id',
    GOOGLE_CLIENT_SECRET: 'local-e2e-google-client-secret',
  };
}

function devVarValues(configPath: string, vars: Record<string, string>): Record<string, unknown> {
  const resolved = unstable_getVarsForDev(configPath, undefined, vars, undefined, true);
  return Object.fromEntries(Object.entries(resolved).map(([name, binding]) => [name, binding.value]));
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'nexus-e2e-isolation-'));
  await mkdir(join(projectRoot, '.wrangler', 'e2e-auth'), { recursive: true });
  await writeFile(join(projectRoot, '.dev.vars'), DEVELOPER_DEV_VARS, 'utf8');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(projectRoot, { recursive: true, force: true });
});

describe('local E2E Console Worker environment', () => {
  it('binds the harness secret and origins instead of the developer .dev.vars, and leaves that file untouched', async () => {
    const developerConfigPath = join(projectRoot, 'wrangler.jsonc');
    expect(devVarValues(developerConfigPath, CANONICAL_VARS)).toMatchObject({
      BETTER_AUTH_SECRET: 'developer-dev-vars-secret-value',
    });

    const isolation = resolveConsoleWorkerIsolation(e2eEnvironment(), projectRoot);
    if (!isolation) throw new Error('Expected the E2E isolation flag to produce Worker overrides.');
    vi.stubEnv('CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV', 'false');
    vi.stubEnv('CLOUDFLARE_INCLUDE_PROCESS_ENV', 'false');
    vi.stubEnv('NEXUS_UNRELATED_DEVELOPER_SECRET', 'must-not-reach-the-worker');

    const bound = devVarValues(isolation.workerConfigPath, { ...CANONICAL_VARS, ...isolation.vars });

    expect(bound).toMatchObject({
      BETTER_AUTH_SECRET: E2E_SECRET,
      CONSOLE_ORIGIN: 'http://127.0.0.1:5273',
      STOREFRONT_ORIGIN: 'http://127.0.0.1:5274',
      GOOGLE_CLIENT_SECRET: 'local-e2e-google-client-secret',
    });
    expect(bound).not.toHaveProperty('NEXUS_UNRELATED_DEVELOPER_SECRET');
    expect(await readFile(join(projectRoot, '.dev.vars'), 'utf8')).toBe(DEVELOPER_DEV_VARS);
  });

  it('leaves ordinary development on the canonical Wrangler config', () => {
    const { [WORKER_ISOLATION_FLAG]: _flag, ...development } = e2eEnvironment();
    expect(resolveConsoleWorkerIsolation(development, projectRoot)).toBeUndefined();
    expect(() => resolveConsoleWorkerIsolation({ ...development, [WORKER_ISOLATION_FLAG]: '1' }, projectRoot))
      .toThrow(/must be "true"/);
  });

  it('refuses test settings that would silently mismatch the launched servers', () => {
    const environment = e2eEnvironment();
    expect(() => resolveConsoleWorkerIsolation({
      ...environment,
      PLAYWRIGHT_STOREFRONT_BASE_URL: environment.PLAYWRIGHT_API_CONSOLE_BASE_URL,
    }, projectRoot)).toThrow(/must be distinct/);
    expect(() => resolveConsoleWorkerIsolation({
      ...environment,
      PLAYWRIGHT_API_CONSOLE_BASE_URL: 'https://console.example.test',
    }, projectRoot)).toThrow(/loopback origin/);
    expect(() => resolveConsoleWorkerIsolation({
      ...environment,
      NEXUS_TEST_PERSIST_ROOT: join(tmpdir(), 'nexus-outside-repository'),
    }, projectRoot)).toThrow(/under the repository \.wrangler directory/);
    expect(() => resolveConsoleWorkerIsolation({
      ...environment,
      NEXUS_TEST_AUTH_SECRET: undefined,
    }, projectRoot)).toThrow(/NEXUS_TEST_AUTH_SECRET/);
  });

  it('reads a loopback server host and port from the configured base URL', () => {
    expect(resolveLoopbackServer('http://localhost:5273', 'PLAYWRIGHT_API_CONSOLE_BASE_URL')).toEqual({
      origin: 'http://localhost:5273',
      hostname: 'localhost',
      port: 5273,
    });
    expect(() => resolveLoopbackServer('http://127.0.0.1:5273/console', 'PLAYWRIGHT_API_CONSOLE_BASE_URL'))
      .toThrow(/loopback origin/);
  });

});
