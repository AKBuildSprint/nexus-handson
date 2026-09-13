import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface S4ProtectedManifest {
  version: 1;
  generatedAt: string;
  databaseName: string;
  coreDigest: string;
  counts: Record<string, number>;
  objectKeyDigests: string[];
  objectContentDigests?: string[];
  capabilityDigests: string[];
  migrationNames?: string[];
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function assertSecretSafeText(text: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    if (secret.length > 0 && text.includes(secret)) {
      throw new Error('Protected evidence contains a secret value.');
    }
  }
  if (/\b(?:better-auth\.session_token|set-cookie|authorization)\b/i.test(text)) {
    throw new Error('Protected evidence contains an authentication artifact.');
  }
}

export async function writeS4ProtectedManifest(
  manifestPath: string,
  manifest: S4ProtectedManifest,
  secrets: readonly string[] = [],
): Promise<void> {
  if (!isAbsolute(manifestPath)) throw new TypeError('fixture manifest path must be absolute.');
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  assertSecretSafeText(serialized, secrets);
  await mkdir(dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, manifestPath);
}

export async function readS4ProtectedManifest(manifestPath: string): Promise<S4ProtectedManifest> {
  if (!isAbsolute(manifestPath)) throw new TypeError('fixture manifest path must be absolute.');
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !('version' in parsed)
    || parsed.version !== 1
    || !('coreDigest' in parsed)
    || typeof parsed.coreDigest !== 'string'
  ) {
    throw new TypeError('Invalid S4 fixture manifest.');
  }
  return parsed as S4ProtectedManifest;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'init') throw new TypeError('Usage: s4-private-fixtures.ts init --fixture-manifest <absolute-path> --prefix <value> --base-url <https-origin> [--apply]');
  const manifestPath = argumentValue('--fixture-manifest');
  const prefix = argumentValue('--prefix');
  const baseUrl = argumentValue('--base-url');
  if (!manifestPath || !isAbsolute(manifestPath) || !prefix || !/^[A-Za-z0-9_-]{2,40}$/.test(prefix) || !baseUrl) {
    throw new TypeError('Exact manifest path, safe prefix, and base URL are required.');
  }
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'https:' || origin.origin !== baseUrl) throw new TypeError('base URL must be an exact HTTPS origin.');
  const apply = process.argv.includes('--apply');
  const manifest: S4ProtectedManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    databaseName: 'nexus-s1-468cba-db',
    coreDigest: sha256(`${prefix}:${origin.origin}`),
    counts: {},
    objectKeyDigests: [],
    capabilityDigests: [],
  };
  if (apply) await writeS4ProtectedManifest(manifestPath, manifest);
  process.stdout.write(`${JSON.stringify({ dryRun: !apply, manifestRef: sha256(manifestPath), prefixRef: sha256(prefix), origin: origin.origin })}\n`);
}
