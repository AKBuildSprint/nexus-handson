import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readS4ProtectedManifest, sha256 } from './s4-private-fixtures';

export interface RemoteSmokeInput {
  target: 'remote';
  dryRun: boolean;
  apiOrigin: string;
  storefrontOrigin: string;
  fixtureManifest: string;
  databaseName: string;
  bucketName: string;
  accountId: string;
  credentialRefs: string[];
}

function exactHttpsOrigin(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new TypeError(`${label} must be an exact HTTPS origin.`);
  }
  return url.origin;
}

export async function runRemoteSmokeDryRun(input: RemoteSmokeInput): Promise<Record<string, unknown>> {
  if (input.target !== 'remote' || input.dryRun !== true) {
    throw new Error('Remote smoke is validation-only and requires dryRun=true.');
  }
  const apiOrigin = exactHttpsOrigin(input.apiOrigin, 'API origin');
  const storefrontOrigin = exactHttpsOrigin(input.storefrontOrigin, 'Storefront origin');
  if (apiOrigin === storefrontOrigin) throw new Error('API and Storefront origins must be distinct.');
  if (!input.databaseName || !input.bucketName || !input.accountId || input.credentialRefs.length < 2) {
    throw new Error('Exact resource, account, and credential references are required.');
  }
  const expected = JSON.parse(await readFile(resolve('resource-identities.json'), 'utf8')) as {
    d1DatabaseName: string;
    r2BucketName: string;
  };
  if (input.databaseName !== expected.d1DatabaseName || input.bucketName !== expected.r2BucketName) {
    throw new Error('Remote resource identity mismatch.');
  }
  const manifest = await readS4ProtectedManifest(input.fixtureManifest);
  return {
    target: 'remote',
    dryRun: true,
    apiOrigin,
    storefrontOrigin,
    databaseName: input.databaseName,
    bucketName: input.bucketName,
    accountRef: sha256(input.accountId),
    credentialRefs: input.credentialRefs.map(sha256),
    fixtureDigest: manifest.coreDigest,
    mutationAuthorized: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = (name: string) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  if (process.argv[2] !== 'run' || !process.argv.includes('--dry-run') || process.argv.includes('--apply')) {
    throw new Error('Remote smoke supports only: run ... --dry-run');
  }
  const fixtureManifest = value('--fixture-manifest');
  const prefix = value('--prefix');
  const apiOrigin = value('--api-origin');
  const storefrontOrigin = value('--storefront-origin');
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const credentialRefs = process.env['NEXUS_S4_CREDENTIAL_REFS']?.split(',').filter(Boolean);
  if (!fixtureManifest || !prefix || !/^[A-Za-z0-9_-]{2,40}$/.test(prefix) || !apiOrigin || !storefrontOrigin || !accountId || !credentialRefs) {
    throw new Error('Exact manifest, prefix, origins, account, and credential references are required.');
  }
  const resources = JSON.parse(await readFile(resolve('resource-identities.json'), 'utf8')) as {
    d1DatabaseName: string;
    r2BucketName: string;
  };
  const result = await runRemoteSmokeDryRun({
    target: 'remote',
    dryRun: true,
    apiOrigin,
    storefrontOrigin,
    fixtureManifest,
    databaseName: resources.d1DatabaseName,
    bucketName: resources.r2BucketName,
    accountId,
    credentialRefs,
  });
  process.stdout.write(`${JSON.stringify({ ...result, prefixRef: sha256(prefix) })}\n`);
}
