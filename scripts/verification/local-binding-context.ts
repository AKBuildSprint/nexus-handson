import { createServer } from 'node:net';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';

export interface LocalBindingOptions {
  configPath: string;
  persistRoot: string;
}

export interface ResolvedLocalBindingContext {
  configPath: string;
  cliPersistRoot: string;
  proxyPersistPath: string;
}

export interface LocalBindings {
  DB: D1Database;
  FILES: R2Bucket;
  CONSOLE_ORIGIN: string;
  STOREFRONT_ORIGIN: string;
}

export interface LocalBindingContext extends ResolvedLocalBindingContext {
  bindings: LocalBindings;
}

export function resolveLocalBindingContext(options: LocalBindingOptions): ResolvedLocalBindingContext {
  if (!isAbsolute(options.persistRoot)) {
    throw new TypeError('persistRoot must be an absolute path.');
  }
  const cliPersistRoot = resolve(options.persistRoot);
  if (basename(cliPersistRoot) === 'v3') {
    throw new TypeError('persistRoot must be the Wrangler CLI root, without the v3 suffix.');
  }
  const configPath = resolve(options.configPath);
  const wranglerStateRoot = resolve(dirname(configPath), '.wrangler');
  const relativePersistRoot = relative(wranglerStateRoot, cliPersistRoot);
  if (
    relativePersistRoot === '' ||
    relativePersistRoot === '..' ||
    relativePersistRoot.startsWith(`..${sep}`)
  ) {
    throw new TypeError('persistRoot must be an isolated directory under the repository .wrangler directory.');
  }
  return {
    configPath,
    cliPersistRoot,
    proxyPersistPath: join(cliPersistRoot, 'v3'),
  };
}

export async function withLocalBindings<T>(
  options: LocalBindingOptions,
  callback: (context: LocalBindingContext) => T | Promise<T>,
): Promise<T> {
  const resolved = resolveLocalBindingContext(options);
  const platform = await getPlatformProxy<LocalBindings>({
    configPath: resolved.configPath,
    persist: { path: resolved.proxyPersistPath },
    remoteBindings: false,
  });
  try {
    return await callback({ ...resolved, bindings: platform['env'] });
  } finally {
    await platform.dispose();
  }
}

export async function assertLoopbackPortAvailable(hostname: string, port: number): Promise<void> {
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new TypeError('Local test server hostname must be loopback.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Local test server port must be an integer from 1 to 65535.');
  }
  await new Promise<void>((resolveAvailable, rejectUnavailable) => {
    const probe = createServer();
    probe.once('error', (error) => {
      rejectUnavailable(new Error(`Local test port ${hostname}:${port} is unavailable.`, { cause: error }));
    });
    probe.listen({ host: hostname, port, exclusive: true }, () => {
      probe.close((error) => {
        if (error) rejectUnavailable(error);
        else resolveAvailable();
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, hostname, portValue] = process.argv.slice(2);
  if (command !== 'check-port' || !hostname || !portValue) {
    throw new TypeError('Usage: local-binding-context.ts check-port <loopback-hostname> <port>');
  }
  await assertLoopbackPortAvailable(hostname, Number(portValue));
}
