import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createProvisioningPlan,
  provisionS4Identity,
} from '../../scripts/provision-s4-identities';
import { withLocalBindings } from '../../scripts/verification/local-binding-context';
import {
  assertRehearsalInvariants,
  runS4PopulatedRehearsal,
} from '../../scripts/verification/s4-populated-rehearsal';
import {
  assertSecretSafeText,
  writeS4ProtectedManifest,
} from '../../scripts/verification/s4-private-fixtures';
import { runRemoteSmokeDryRun } from '../../scripts/verification/s4-remote-smoke';
import { S4_POPULATED_FIXTURE } from '../fixtures/s4-populated-store';

function runCli(script: string, arguments_: string[], environment: Record<string, string> = {}): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(resolve('node_modules/.bin/tsx'), [script, ...arguments_], {
      cwd: resolve('.'),
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('exit', (code) => code === 0 ? resolveRun(stdout) : rejectRun(new Error(stderr)));
    child.on('error', rejectRun);
  });
}

describe('S4 populated rehearsal operator boundary', () => {
  it('runs in the standalone Node pool and fails closed before remote mutation', () => {
    expect(typeof process.versions.node).toBe('string');
    expect(() => createProvisioningPlan({
      target: 'remote',
      apply: true,
      databaseName: 'nexus-s1-468cba-db',
      bucketName: 'nexus-s1-468cba-private',
    })).toThrow(/remote mutation is not authorized/i);
  });

  it('rehearses populated raw migrations, failure recovery, reapply, and protected preservation', async () => {
    const result = await runS4PopulatedRehearsal({ baselineRef: 'a3a67f6' });
    expect(result).toMatchObject({
      failureObserved: true,
      retrySucceeded: true,
      reapplyWasNoop: true,
      preservationMatched: true,
      foreignKeyViolations: 0,
      assignmentPreserved: true,
      pendingRefundPreserved: true,
      legacyPaymentGapPreserved: true,
    });
    expect(result.migrationNames).toHaveLength(11);
    expect(result.manifest.counts['orders']).toBe(3);
    expect(result.faults).toEqual([
      expect.objectContaining({ point: 'after-staging', rolledBack: true, assignmentHistoryCommandPreserved: true, ledgerUnchanged: true, foreignKeyViolations: 0 }),
      expect.objectContaining({ point: 'after-parent-child-drops', rolledBack: true, assignmentHistoryCommandPreserved: true, ledgerUnchanged: true, foreignKeyViolations: 0 }),
      expect.objectContaining({ point: 'during-late-restoration', rolledBack: true, assignmentHistoryCommandPreserved: true, ledgerUnchanged: true, foreignKeyViolations: 0 }),
    ]);
    expect(result.localSafety).toMatchObject({
      writerBarrier: 'isolated-disposable-state',
      checkpointVerified: true,
      abortsVerified: 3,
    });
    expect(result.postReapplyPreserved).toBe(true);
    expect(result.manifest.objectContentDigests).toHaveLength(3);
    expect(result.manifest.objectContentDigests).not.toEqual(result.manifest.objectKeyDigests);
    expect(JSON.stringify(result)).not.toContain('stores/store_nexus/');
  }, 180_000);

  it('makes the named rehearsal fail closed for any failed invariant', () => {
    const fault = {
      point: 'after-staging',
      rolledBack: true,
      assignmentHistoryCommandPreserved: true,
      ledgerUnchanged: true,
      foreignKeyViolations: 0,
    };
    const valid = {
      failureObserved: true,
      retrySucceeded: true,
      reapplyWasNoop: true,
      preservationMatched: true,
      postReapplyPreserved: true,
      foreignKeyViolations: 0,
      assignmentPreserved: true,
      pendingRefundPreserved: true,
      legacyPaymentGapPreserved: true,
      faults: [fault, { ...fault, point: 'after-parent-child-drops' }, { ...fault, point: 'during-late-restoration' }],
      localSafety: { writerBarrier: 'isolated-disposable-state', checkpointVerified: true, abortsVerified: 3 },
      manifest: {
        version: 1 as const,
        generatedAt: '2026-09-12T00:00:00.000Z',
        databaseName: 'nexus-s1-468cba-db',
        coreDigest: 'a'.repeat(64),
        counts: {},
        objectKeyDigests: ['b'.repeat(64)],
        objectContentDigests: ['c'.repeat(64)],
        capabilityDigests: [],
      },
    };
    const failures = [
      { ...valid, failureObserved: false },
      { ...valid, retrySucceeded: false },
      { ...valid, reapplyWasNoop: false },
      { ...valid, preservationMatched: false },
      { ...valid, postReapplyPreserved: false },
      { ...valid, foreignKeyViolations: 1 },
      { ...valid, assignmentPreserved: false },
      { ...valid, pendingRefundPreserved: false },
      { ...valid, legacyPaymentGapPreserved: false },
      { ...valid, faults: [{ ...fault, rolledBack: false }, valid.faults[1], valid.faults[2]] },
      { ...valid, faults: [{ ...fault, assignmentHistoryCommandPreserved: false }, valid.faults[1], valid.faults[2]] },
      { ...valid, faults: [{ ...fault, ledgerUnchanged: false }, valid.faults[1], valid.faults[2]] },
      { ...valid, faults: [{ ...fault, foreignKeyViolations: 1 }, valid.faults[1], valid.faults[2]] },
      { ...valid, localSafety: { ...valid.localSafety, checkpointVerified: false } },
      { ...valid, manifest: { ...valid.manifest, objectContentDigests: [] } },
    ];
    for (const failed of failures) expect(() => assertRehearsalInvariants(failed)).toThrow();
  });

  it('provisions exact reruns, rejects identity conflicts, and recovers after membership failure', async () => {
    const rehearsal = await runS4PopulatedRehearsal({ baselineRef: 'a3a67f6', keepState: true });
    const runRoot = resolve(rehearsal.persistRoot, '../../..');
    const configPath = resolve('wrangler.jsonc');
    const authEnvironment = {
      CONSOLE_ORIGIN: 'http://127.0.0.1:5173',
      BETTER_AUTH_SECRET: 'node-test-auth-secret-with-at-least-thirty-two-characters',
    };
    const ownerGoogleSubject = 'google-subject-operator-owner';
    try {
      await withLocalBindings({ configPath, persistRoot: rehearsal.persistRoot }, async ({ bindings }) => {
        const owner = {
          email: 'operator-owner@fixture.invalid',
          name: 'Operator Owner',
          googleSubject: ownerGoogleSubject,
          storeId: 'store_nexus',
          role: 'owner' as const,
        };
        const created = await provisionS4Identity(bindings.DB, authEnvironment, owner);
        const repeated = await provisionS4Identity(bindings.DB, authEnvironment, owner);
        expect(created.membership).toBe('created');
        expect(repeated).toMatchObject({ membership: 'unchanged', google: { created: false, recovered: false } });
        await expect(provisionS4Identity(bindings.DB, authEnvironment, {
          ...owner,
          storeId: 'store_b',
        })).rejects.toThrow(/membership identity conflict/i);

        const recoverable = {
          email: 'operator-recovery@fixture.invalid',
          name: 'Operator Recovery',
          googleSubject: 'google-subject-operator-recovery',
          storeId: 'missing_store',
          role: 'staff' as const,
        };
        await expect(provisionS4Identity(bindings.DB, authEnvironment, recoverable)).rejects.toThrow(/store does not exist/i);
        const recovered = await provisionS4Identity(bindings.DB, authEnvironment, {
          ...recoverable,
          storeId: 'store_b',
        });
        expect(recovered).toMatchObject({ membership: 'created', google: { created: false } });
        assertSecretSafeText(JSON.stringify([created, repeated, recovered]), [ownerGoogleSubject, owner.email, recoverable.email]);

        const preexistingMember = {
          email: S4_POPULATED_FIXTURE.users.ownerA.email,
          name: S4_POPULATED_FIXTURE.users.ownerA.name,
          googleSubject: 'google-subject-preexisting-owner-a',
          storeId: S4_POPULATED_FIXTURE.stores.a.id,
          role: 'staff' as const,
        };
        const countOwnerAccounts = async (): Promise<number> => {
          const row = await bindings.DB.prepare('SELECT count(*) AS total FROM account WHERE userId=?')
            .bind(S4_POPULATED_FIXTURE.users.ownerA.id).first<{ total: number }>();
          return row?.total ?? -1;
        };
        expect(await countOwnerAccounts()).toBe(0);
        for (const conflicting of [
          preexistingMember,
          { ...preexistingMember, storeId: S4_POPULATED_FIXTURE.stores.b.id, role: 'owner' as const },
        ]) {
          const rejection = await provisionS4Identity(bindings.DB, authEnvironment, conflicting)
            .then(() => null, (error: Error) => error);
          expect(rejection?.message ?? '').toMatch(/membership identity conflict/i);
          assertSecretSafeText(rejection?.message ?? '', [conflicting.email, conflicting.googleSubject]);
          expect(await countOwnerAccounts()).toBe(0);
        }
      });
      const cliIdentity = [{
        email: 'operator-cli@fixture.invalid',
        name: 'Operator CLI',
        googleSubject: 'google-subject-operator-cli',
        storeId: 'store_nexus',
        role: 'staff',
      }];
      const cliOutput = await runCli('scripts/provision-s4-identities.ts', [
        '--target', 'local', '--apply', '--persist-to', rehearsal.persistRoot,
        '--console-origin', authEnvironment.CONSOLE_ORIGIN,
      ], {
        BETTER_AUTH_SECRET: authEnvironment.BETTER_AUTH_SECRET,
        NEXUS_S4_IDENTITIES_JSON: JSON.stringify(cliIdentity),
      });
      expect(JSON.parse(cliOutput)[0]).toMatchObject({ membership: 'created' });
      expect(cliOutput).not.toContain(cliIdentity[0].googleSubject);
      expect(cliOutput).not.toContain(cliIdentity[0].email);
      await withLocalBindings({ configPath, persistRoot: rehearsal.persistRoot }, async ({ bindings }) => {
        const membership = await bindings.DB.prepare(
          "SELECT membership.role FROM store_memberships membership JOIN \"user\" user ON user.id=membership.user_id WHERE user.email='operator-cli@fixture.invalid'",
        ).first<{ role: string }>();
        expect(membership?.role).toBe('staff');
      });
    } finally {
      await rm(runRoot, { recursive: true, force: true });
    }
  }, 180_000);

  it('writes mode-600 redacted evidence and validates remote smoke without remote work', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'nexus-s4-manifest-'));
    const manifestPath = join(temporaryRoot, 'private.json');
    const secret = 'never-serialize-this-secret';
    try {
      await writeS4ProtectedManifest(manifestPath, {
        version: 1,
        generatedAt: '2026-09-12T00:00:00.000Z',
        databaseName: 'nexus-s1-468cba-db',
        coreDigest: 'a'.repeat(64),
        counts: { orders: 3 },
        objectKeyDigests: ['b'.repeat(64)],
        capabilityDigests: ['c'.repeat(64)],
      }, [secret]);
      expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
      const result = await runRemoteSmokeDryRun({
        target: 'remote',
        dryRun: true,
        apiOrigin: 'https://api.example.invalid',
        storefrontOrigin: 'https://store.example.invalid',
        fixtureManifest: manifestPath,
        databaseName: 'nexus-s1-468cba-db',
        bucketName: 'nexus-s1-468cba-private',
        accountId: 'operator-account-reference',
        credentialRefs: ['owner-secret-reference', 'staff-secret-reference'],
      });
      expect(result).toMatchObject({ dryRun: true, mutationAuthorized: false });
      expect(JSON.stringify(result)).not.toContain('operator-account-reference');
      expect(() => assertSecretSafeText(JSON.stringify(result), [secret])).not.toThrow();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('keeps every operator CLI dry-run executable and free of proxy writes', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'nexus-s4-cli-'));
    const manifestPath = join(temporaryRoot, 'private.json');
    const absentPath = join(temporaryRoot, 'dry-run-must-not-write.json');
    try {
      const fixtureOutput = await runCli('scripts/verification/s4-private-fixtures.ts', [
        'init', '--fixture-manifest', absentPath, '--prefix', 'safe-fixture',
        '--base-url', 'https://api.example.invalid',
      ]);
      expect(JSON.parse(fixtureOutput)).toMatchObject({ dryRun: true });
      await expect(access(absentPath)).rejects.toThrow();

      await writeS4ProtectedManifest(manifestPath, {
        version: 1,
        generatedAt: '2026-09-12T00:00:00.000Z',
        databaseName: 'nexus-s1-468cba-db',
        coreDigest: 'd'.repeat(64),
        counts: {},
        objectKeyDigests: [],
        capabilityDigests: [],
      });
      const provisionOutput = await runCli('scripts/provision-s4-identities.ts', ['--target', 'local']);
      expect(JSON.parse(provisionOutput)).toMatchObject({ target: 'local', dryRun: true });
      const remoteOutput = await runCli('scripts/verification/s4-remote-smoke.ts', [
        'run', '--fixture-manifest', manifestPath, '--prefix', 'safe-fixture',
        '--api-origin', 'https://api.example.invalid',
        '--storefront-origin', 'https://store.example.invalid', '--dry-run',
      ], {
        CLOUDFLARE_ACCOUNT_ID: 'account-reference',
        NEXUS_S4_CREDENTIAL_REFS: 'owner-reference,staff-reference',
      });
      expect(JSON.parse(remoteOutput)).toMatchObject({ dryRun: true, mutationAuthorized: false });
      expect(remoteOutput).not.toContain('account-reference');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
