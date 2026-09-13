import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, provisionGoogleAccount } from '../apps/worker/src/auth';
import { withLocalBindings } from './verification/local-binding-context';
import { sha256 } from './verification/s4-private-fixtures';

export interface ProvisioningPlanInput {
  target: 'local' | 'remote';
  apply?: boolean;
  databaseName: string;
  bucketName: string;
}

export interface S4IdentityInput {
  email: string;
  name: string;
  googleSubject: string;
  storeId: string;
  role: 'owner' | 'staff';
}

export interface ProvisioningPlan {
  target: 'local' | 'remote';
  dryRun: boolean;
  databaseName: string;
  bucketName: string;
}

export interface ProvisioningResult {
  identityRef: string;
  membershipId: string;
  google: { created: boolean; recovered: boolean };
  membership: 'created' | 'unchanged';
}

export function createProvisioningPlan(input: ProvisioningPlanInput): ProvisioningPlan {
  if (input.target === 'remote' && input.apply === true) {
    throw new Error('Remote mutation is not authorized by this operator command.');
  }
  if (!input.databaseName || !input.bucketName) throw new TypeError('Exact resource identities are required.');
  return { ...input, dryRun: input.apply !== true };
}

async function assertExpectedResources(plan: ProvisioningPlan): Promise<void> {
  const expected = JSON.parse(await readFile(resolve('resource-identities.json'), 'utf8')) as {
    d1DatabaseName: string;
    r2BucketName: string;
  };
  if (plan.databaseName !== expected.d1DatabaseName || plan.bucketName !== expected.r2BucketName) {
    throw new Error('Resource identity mismatch.');
  }
}

export async function provisionS4Identity(
  database: D1Database,
  authEnvironment: { CONSOLE_ORIGIN: string; BETTER_AUTH_SECRET: string },
  input: S4IdentityInput,
): Promise<ProvisioningResult> {
  const google = await provisionGoogleAccount(
    createAuth({ DB: database, ...authEnvironment }),
    { email: input.email, name: input.name, googleSubject: input.googleSubject },
  );
  const existing = await database.prepare(
    'SELECT id,store_id,role,status FROM store_memberships WHERE user_id=? ORDER BY id',
  ).bind(google.userId).all<{ id: string; store_id: string; role: string; status: string }>();
  const exact = existing.results.find((row) => row.store_id === input.storeId);
  if (existing.results.length > 0) {
    if (!exact || exact.role !== input.role || exact.status !== 'active') {
      throw new Error('Membership identity conflict.');
    }
    return {
      identityRef: sha256(input.email.trim().toLowerCase()),
      membershipId: exact.id,
      google: { created: google.created, recovered: google.recovered },
      membership: 'unchanged',
    };
  }
  const store = await database.prepare('SELECT id FROM stores WHERE id=?').bind(input.storeId).first();
  if (!store) throw new Error('Membership store does not exist.');
  const membershipId = `membership_${sha256(`${google.userId}:${input.storeId}`).slice(0, 24)}`;
  await database.prepare(
    "INSERT INTO store_memberships (id,store_id,user_id,role,status,revoked_at) VALUES (?,?,?,?,'active',NULL)",
  ).bind(membershipId, input.storeId, google.userId, input.role).run();
  return {
    identityRef: sha256(input.email.trim().toLowerCase()),
    membershipId,
    google: { created: google.created, recovered: google.recovered },
    membership: 'created',
  };
}

export async function executeLocalProvisioning(input: {
  persistRoot: string;
  configPath: string;
  consoleOrigin: string;
  authSecret: string;
  resources: ProvisioningPlanInput;
  identities: S4IdentityInput[];
}): Promise<ProvisioningResult[]> {
  const plan = createProvisioningPlan({ ...input.resources, target: 'local', apply: true });
  await assertExpectedResources(plan);
  if (!input.authSecret) throw new Error('Missing runtime authentication secret.');
  return withLocalBindings(
    { configPath: input.configPath, persistRoot: input.persistRoot },
    async ({ bindings }) => {
      const results: ProvisioningResult[] = [];
      for (const identity of input.identities) {
        results.push(await provisionS4Identity(bindings.DB, {
          CONSOLE_ORIGIN: input.consoleOrigin,
          BETTER_AUTH_SECRET: input.authSecret,
        }, identity));
      }
      return results;
    },
  );
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const value = (name: string) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const targetValue = value('--target');
  if (targetValue !== 'local' && targetValue !== 'remote') throw new TypeError('--target local|remote is required.');
  const target = targetValue;
  const apply = process.argv.includes('--apply');
  const expected = JSON.parse(await readFile(resolve('resource-identities.json'), 'utf8')) as {
    d1DatabaseName: string;
    r2BucketName: string;
  };
  const plan = createProvisioningPlan({
    target,
    apply,
    databaseName: expected.d1DatabaseName,
    bucketName: expected.r2BucketName,
  });
  await assertExpectedResources(plan);
  if (plan.dryRun) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }
  const persistRoot = value('--persist-to');
  const consoleOrigin = value('--console-origin');
  const authSecret = process.env['BETTER_AUTH_SECRET'];
  const serializedIdentities = process.env['NEXUS_S4_IDENTITIES_JSON'] ?? await readStandardInput();
  if (!persistRoot || !consoleOrigin || !authSecret || !serializedIdentities.trim()) {
    throw new Error('Local apply requires persist path, Console origin, runtime auth secret, and identities via stdin/env.');
  }
  const identitiesInput = JSON.parse(serializedIdentities) as S4IdentityInput[];
  const results = await executeLocalProvisioning({
    persistRoot,
    configPath: resolve('wrangler.jsonc'),
    consoleOrigin,
    authSecret,
    resources: { target: 'local', apply: true, databaseName: expected.d1DatabaseName, bucketName: expected.r2BucketName },
    identities: identitiesInput,
  });
  process.stdout.write(`${JSON.stringify(results)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
