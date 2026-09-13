import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLocalBindings } from './local-binding-context';
import { sha256, writeS4ProtectedManifest, type S4ProtectedManifest } from './s4-private-fixtures';
import { seedSchemaNineAssignment, seedSchemaSeven, S4_POPULATED_FIXTURE } from '../../tests/fixtures/s4-populated-store';

const MIGRATION_NAMES = [
  '0001-store-products.sql',
  '0002-product-variants.sql',
  '0003-imports.sql',
  '0004-orders.sql',
  '0005-order-operations.sql',
  '0006-order-brief-contract.sql',
  '0007-manual-payments.sql',
  '0008-better-auth.sql',
  '0009-store-memberships.sql',
  '0010-refund-decisions.sql',
  '0011-google-account-binding-uniqueness.sql',
] as const;

interface ManifestSnapshot {
  coreDigest: string;
  counts: Record<string, number>;
  objectKeyDigests: string[];
  objectContentDigests: string[];
  capabilityDigests: string[];
}

export interface RehearsalResult {
  persistRoot: string;
  failureObserved: boolean;
  retrySucceeded: boolean;
  reapplyWasNoop: boolean;
  preservationMatched: boolean;
  foreignKeyViolations: number;
  migrationNames: string[];
  assignmentPreserved: boolean;
  pendingRefundPreserved: boolean;
  legacyPaymentGapPreserved: boolean;
  postReapplyPreserved: boolean;
  faults: Array<{
    point: string;
    rolledBack: boolean;
    assignmentHistoryCommandPreserved: boolean;
    ledgerUnchanged: boolean;
    foreignKeyViolations: number;
  }>;
  localSafety: { writerBarrier: string; checkpointVerified: boolean; abortsVerified: number };
  manifest: S4ProtectedManifest;
}

export function assertRehearsalInvariants(_result: Pick<RehearsalResult,
  'failureObserved' | 'retrySucceeded' | 'reapplyWasNoop' | 'preservationMatched'
  | 'postReapplyPreserved' | 'foreignKeyViolations' | 'assignmentPreserved'
  | 'pendingRefundPreserved' | 'legacyPaymentGapPreserved' | 'faults' | 'localSafety'
  | 'manifest'
>): void {
  const result = _result;
  if (!result.postReapplyPreserved) throw new Error('Reapply preservation invariant failed.');
  if (
    !result.failureObserved
    || result.faults.length !== 3
    || result.faults.some((fault) => !fault.rolledBack || !fault.assignmentHistoryCommandPreserved)
  ) {
    throw new Error('Migration fault rollback invariant failed.');
  }
  if (result.faults.some((fault) => !fault.ledgerUnchanged)) throw new Error('Failed migration changed the ledger.');
  if (result.foreignKeyViolations !== 0 || result.faults.some((fault) => fault.foreignKeyViolations !== 0)) {
    throw new Error('Foreign-key invariant failed.');
  }
  if (!result.retrySucceeded || !result.reapplyWasNoop || !result.preservationMatched) {
    throw new Error('Migration retry or preservation invariant failed.');
  }
  if (!result.assignmentPreserved || !result.pendingRefundPreserved || !result.legacyPaymentGapPreserved) {
    throw new Error('Protected graph invariant failed.');
  }
  const expectedPoints = ['after-staging', 'after-parent-child-drops', 'during-late-restoration'];
  if (expectedPoints.some((point, index) => result.faults[index]?.point !== point)) {
    throw new Error('Migration fault coverage invariant failed.');
  }
  if (
    result.localSafety.writerBarrier !== 'isolated-disposable-state'
    || !result.localSafety.checkpointVerified
    || result.localSafety.abortsVerified !== 3
  ) {
    throw new Error('Local writer barrier, checkpoint, or abort invariant failed.');
  }
  if (
    !result.manifest.objectContentDigests
    || result.manifest.objectContentDigests.length === 0
    || result.manifest.objectContentDigests.length !== result.manifest.objectKeyDigests.length
  ) {
    throw new Error('R2 content evidence invariant failed.');
  }
}

function runProcess(executable: string, arguments_: string[], cwd: string): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, arguments_, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', rejectRun);
    child.on('exit', (code) => {
      if (code === 0) resolveRun(stdout);
      else rejectRun(new Error(`Operator command failed (${code}): ${stderr.slice(-800)}`));
    });
  });
}

function runWrangler(arguments_: string[], repositoryRoot: string): Promise<string> {
  return runProcess(resolve(repositoryRoot, 'node_modules/.bin/wrangler'), arguments_, repositoryRoot);
}

async function createLocalMigrationConfig(
  repositoryRoot: string,
  directory: string,
  migrationNames: readonly string[],
  migrationOverride?: { name: string; sql: string },
): Promise<string> {
  const migrationsDirectory = join(directory, 'migrations');
  await mkdir(migrationsDirectory, { recursive: true });
  await copyFile(join(repositoryRoot, 'wrangler.jsonc'), join(directory, 'wrangler.jsonc'));
  for (const name of migrationNames) {
    if (migrationOverride?.name === name) await writeFile(join(migrationsDirectory, name), migrationOverride.sql);
    else await copyFile(join(repositoryRoot, 'migrations', name), join(migrationsDirectory, name));
  }
  return join(directory, 'wrangler.jsonc');
}

function injectFailureAfter(sql: string, marker: string, point: string): string {
  if (!sql.includes(marker)) throw new Error(`Checked-in migration marker is missing for ${point}.`);
  return sql.replace(marker, `${marker}\nSELECT missing_column FROM s4_injected_${point.replaceAll('-', '_')};`);
}

function rawForeignKeyViolationCount(output: string): number {
  const results = JSON.parse(output) as Array<{ results?: unknown[] }>;
  return results.at(-1)?.results?.length ?? -1;
}

async function queryRows(database: D1Database, sql: string): Promise<Record<string, unknown>[]> {
  const result = await database.prepare(sql).all<Record<string, unknown>>();
  return result.results;
}

function sanitizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if ((key.endsWith('_key') || key.includes('capability')) && typeof value === 'string') {
      return [`${key}_digest`, sha256(value)];
    }
    return [key, value];
  })));
}

async function captureManifest(database: D1Database, files: R2Bucket): Promise<ManifestSnapshot> {
  const tableQueries: Record<string, string> = {
    stores: 'SELECT id,slug,name,created_at FROM stores ORDER BY id',
    products: 'SELECT id,store_id,slug,name,status,product_type,currency,base_price_minor,delivery_file_key,delivery_file_filename,revision,created_at,updated_at FROM products ORDER BY id',
    optionGroups: 'SELECT id,store_id,product_id,name,comparison_key,position,participating,active FROM product_option_groups ORDER BY id',
    optionValues: 'SELECT id,store_id,product_id,group_id,label,comparison_key,position,active FROM product_option_values ORDER BY id',
    variants: 'SELECT id,store_id,product_id,combination_key,sku,status,current_schema,delivery_file_key FROM product_variants ORDER BY id',
    variantValues: 'SELECT variant_id,value_id,group_id,product_id,store_id FROM product_variant_values ORDER BY variant_id,value_id',
    imports: 'SELECT id,store_id,original_filename,size_bytes,detected_type,added_count,duplicate_count,rejected_count,private_object_key,created_at FROM imports ORDER BY id',
    customers: 'SELECT id,store_id,name,email_normalized,created_at,updated_at FROM customers ORDER BY id',
    orders: 'SELECT id,store_id,reference,customer_id,customer_name,customer_email_normalized,status,currency,total_minor,created_at,payment_reference FROM orders ORDER BY id',
    lines: 'SELECT id,store_id,order_id,product_id,product_name,variant_id,variant_sku,selected_options_json,quantity,unit_price_minor,line_total_minor,currency,access_title,access_instructions,private_file_key,position FROM order_lines ORDER BY id',
    access: 'SELECT id,store_id,order_id,capability_digest,created_at FROM order_access ORDER BY id',
    idempotency: 'SELECT id,store_id,request_key,order_id,capability_digest,created_at FROM order_idempotency ORDER BY id',
    refunds: 'SELECT id,store_id,order_id,status,reason,created_at,actor_source,actor_id FROM order_refund_requests ORDER BY id',
    history: "SELECT id,store_id,order_id,status,created_at,action,source,from_status,actor_id,contract_version,refund_request_id FROM order_history WHERE action <> 'assigned' ORDER BY id",
    commands: "SELECT id,store_id,request_key,order_id,action,payload_hash,result_history_id,created_at,contract_version,result_refund_request_id FROM order_commands WHERE action <> 'assign' ORDER BY id",
    payments: 'SELECT id,store_id,order_id,source,method,external_reference,amount_minor,currency,status,history_id,recorded_actor_source,recorded_actor_id,recorded_at FROM payments ORDER BY id',
  };
  const entries = await Promise.all(Object.entries(tableQueries).map(async ([name, sql]) => {
    const rows = sanitizeRows(await queryRows(database, sql));
    return [name, rows] as const;
  }));
  const graph = Object.fromEntries(entries) as Record<string, Record<string, unknown>[]>;
  const listed = await files.list({ prefix: 'stores/' });
  const rawObjectKeys = listed.objects.map((object) => object.key).sort();
  const objectKeyDigests = rawObjectKeys.map(sha256);
  const objectContentDigests: string[] = [];
  for (const key of rawObjectKeys) {
    const object = await files.get(key);
    if (!object) throw new Error('Manifest object disappeared while its content was read.');
    objectContentDigests.push(sha256(new Uint8Array(await object.arrayBuffer())));
  }
  const capabilityRows = await queryRows(database, 'SELECT capability_digest FROM order_access ORDER BY id');
  const capabilityDigests = capabilityRows.map((row) => String(row['capability_digest']));
  const counts = Object.fromEntries(Object.entries(graph).map(([name, rows]) => [name, rows.length]));
  return {
    coreDigest: sha256(JSON.stringify({ graph, objectKeyDigests, objectContentDigests })),
    counts,
    objectKeyDigests,
    objectContentDigests,
    capabilityDigests,
  };
}

async function captureCompleteSchemaNineState(database: D1Database, files: R2Bucket): Promise<string> {
  const schemas = await queryRows(database, `SELECT type,name,tbl_name,sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type,name`);
  const tables = [
    'stores', 'products', 'product_option_groups', 'product_option_values', 'product_variants',
    'product_variant_values', 'imports', 'customers', 'orders', 'order_lines', 'order_access',
    'order_idempotency', 'order_refund_requests', 'order_history', 'order_commands', 'payments',
    'user', 'account', 'session', 'verification', 'rateLimit', 'store_memberships',
    'order_assignments', 's4_rehearsal_sentinel', 'd1_migrations',
  ];
  const tableData = await Promise.all(tables.map(async (table) => {
    const safeName = `"${table.replaceAll('"', '""')}"`;
    return [table, sanitizeRows(await queryRows(database, `SELECT * FROM ${safeName} ORDER BY rowid`))] as const;
  }));
  const objects = await files.list({ prefix: 'stores/' });
  const objectEvidence: Array<{ keyDigest: string; contentDigest: string }> = [];
  for (const object of objects.objects.sort((left, right) => left.key.localeCompare(right.key))) {
    const body = await files.get(object.key);
    if (!body) throw new Error('Checkpoint object disappeared.');
    objectEvidence.push({
      keyDigest: sha256(object.key),
      contentDigest: sha256(new Uint8Array(await body.arrayBuffer())),
    });
  }
  return sha256(JSON.stringify({ schemas: sanitizeRows(schemas), tableData: Object.fromEntries(tableData), objectEvidence }));
}

async function appliedMigrationNames(database: D1Database): Promise<string[]> {
  const rows = await database.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

export async function runS4PopulatedRehearsal(options: {
  repositoryRoot?: string;
  baselineRef: string;
  manifestPath?: string;
  keepState?: boolean;
}): Promise<RehearsalResult> {
  const repositoryRoot = resolve(options.repositoryRoot ?? '.');
  const runRoot = join(repositoryRoot, '.wrangler', `s4-rehearsal-${randomUUID()}`);
  const baselineRoot = join(runRoot, 'baseline');
  const archivePath = join(runRoot, 'baseline.tar');
  const persistRoot = join(baselineRoot, '.wrangler', 'state');
  const baselineConfigPath = join(baselineRoot, 'wrangler.jsonc');
  const implementationConfigPath = join(repositoryRoot, 'wrangler.jsonc');
  const identities = JSON.parse(await readFile(join(repositoryRoot, 'resource-identities.json'), 'utf8')) as {
    d1DatabaseName: string;
    d1DatabaseId: string;
    r2BucketName: string;
  };
  if (!/^[0-9a-f]{7,40}$/i.test(options.baselineRef)) throw new TypeError('baselineRef must be an explicit commit hash.');
  await mkdir(baselineRoot, { recursive: true });
  await runProcess('git', ['archive', '--format=tar', `--output=${archivePath}`, options.baselineRef], repositoryRoot);
  await runProcess('tar', ['-xf', archivePath, '-C', baselineRoot], repositoryRoot);
  const apply = (configPath: string) => runWrangler([
    'd1', 'migrations', 'apply', identities.d1DatabaseName,
    '--local', '--persist-to', persistRoot, '--config', configPath,
  ], repositoryRoot);
  const execute = (configPath: string, sql: string) => runWrangler([
    'd1', 'execute', identities.d1DatabaseName, '--local', '--persist-to', persistRoot,
    '--config', configPath, '--command', sql, '--json',
  ], repositoryRoot);

  try {
    await apply(baselineConfigPath);
    let before!: ManifestSnapshot;
    await withLocalBindings({ configPath: baselineConfigPath, persistRoot }, async ({ bindings }) => {
      await seedSchemaSeven(bindings.DB, bindings.FILES);
      await bindings.DB.prepare('CREATE TABLE s4_rehearsal_sentinel (id TEXT PRIMARY KEY,value TEXT NOT NULL)').run();
      await bindings.DB.prepare("INSERT INTO s4_rehearsal_sentinel VALUES ('proxy-write','schema7')").run();
      before = await captureManifest(bindings.DB, bindings.FILES);
    });
    const rawPre = await execute(baselineConfigPath, "SELECT id,value FROM s4_rehearsal_sentinel; SELECT count(*) AS orders FROM orders; SELECT count(*) AS refunds FROM order_refund_requests; SELECT count(*) AS payments FROM payments;");
    if (!rawPre.includes('proxy-write') || !rawPre.includes('orders')) throw new Error('Raw CLI could not cross-read the populated proxy state.');
    await execute(baselineConfigPath, "INSERT INTO s4_rehearsal_sentinel VALUES ('raw-write','schema7');");
    const preparationConfigPath = await createLocalMigrationConfig(
      repositoryRoot,
      join(runRoot, 'schema-nine'),
      MIGRATION_NAMES.slice(7, 9),
    );
    await apply(preparationConfigPath);
    await withLocalBindings({ configPath: implementationConfigPath, persistRoot }, async ({ bindings }) => {
      await seedSchemaNineAssignment(bindings.DB);
    });
    let schemaNineCheckpoint = '';
    let schemaNineLedger: string[] = [];
    await withLocalBindings({ configPath: implementationConfigPath, persistRoot }, async ({ bindings }) => {
      schemaNineCheckpoint = await captureCompleteSchemaNineState(bindings.DB, bindings.FILES);
      schemaNineLedger = await appliedMigrationNames(bindings.DB);
    });
    if (schemaNineLedger.join('|') !== MIGRATION_NAMES.slice(0, 9).join('|')) {
      throw new Error('Schema-nine checkpoint has the wrong migration ledger.');
    }

    const checkedMigration = await readFile(join(repositoryRoot, 'migrations', MIGRATION_NAMES[9]), 'utf8');
    const faultDefinitions = [
      {
        point: 'after-staging',
        marker: 'CREATE TABLE _s4_refund_assignments AS SELECT * FROM order_assignments;',
      },
      {
        point: 'after-parent-child-drops',
        marker: 'DROP TABLE order_refund_requests;',
      },
      {
        point: 'during-late-restoration',
        marker: 'FROM _s4_refund_payments;',
      },
    ] as const;
    const faults: RehearsalResult['faults'] = [];
    for (const definition of faultDefinitions) {
      const faultConfigPath = await createLocalMigrationConfig(
        repositoryRoot,
        join(runRoot, 'faults', definition.point),
        [MIGRATION_NAMES[9]],
        {
          name: MIGRATION_NAMES[9],
          sql: injectFailureAfter(checkedMigration, definition.marker, definition.point),
        },
      );
      let observed = false;
      try {
        await apply(faultConfigPath);
      } catch {
        observed = true;
      }
      if (!observed) throw new Error(`Injected ${definition.point} migration fault was not observed.`);
      let rollbackDigest = '';
      let rollbackLedger: string[] = [];
      let assignmentHistoryCommandPreserved = false;
      await withLocalBindings({ configPath: implementationConfigPath, persistRoot }, async ({ bindings }) => {
        rollbackDigest = await captureCompleteSchemaNineState(bindings.DB, bindings.FILES);
        rollbackLedger = await appliedMigrationNames(bindings.DB);
        assignmentHistoryCommandPreserved = Boolean(await bindings.DB.prepare(`SELECT 1
          FROM order_assignments assignment
          JOIN order_history history ON history.id=assignment.history_id AND history.action='assigned'
          JOIN order_commands command ON command.result_history_id=history.id AND command.action='assign'
          WHERE assignment.order_id='order_a'
            AND history.id='history_assign_a'
            AND command.id='command_assign_a'`).first());
      });
      const foreignKeyViolations = rawForeignKeyViolationCount(
        await execute(implementationConfigPath, 'PRAGMA foreign_key_check;'),
      );
      faults.push({
        point: definition.point,
        rolledBack: rollbackDigest === schemaNineCheckpoint,
        assignmentHistoryCommandPreserved,
        ledgerUnchanged: rollbackLedger.join('|') === schemaNineLedger.join('|'),
        foreignKeyViolations,
      });
    }

    await apply(implementationConfigPath);

    let after!: ManifestSnapshot;
    let migrationNames: string[] = [];
    let foreignKeyViolations = -1;
    let assignmentPreserved = false;
    let pendingRefundPreserved = false;
    let legacyPaymentGapPreserved = false;
    await withLocalBindings({ configPath: implementationConfigPath, persistRoot }, async ({ bindings }) => {
      after = await captureManifest(bindings.DB, bindings.FILES);
      migrationNames = await appliedMigrationNames(bindings.DB);
      assignmentPreserved = Boolean(await bindings.DB.prepare(
        `SELECT 1
           FROM order_assignments assignment
           JOIN order_commands command
             ON command.store_id=assignment.store_id
            AND command.order_id=assignment.order_id
            AND command.result_history_id=assignment.history_id
            AND command.action='assign'
          WHERE assignment.order_id='order_a'
            AND assignment.assignee_user_id='user_staff_a1'
            AND assignment.history_id='history_assign_a'
            AND command.id='command_assign_a'`,
      ).first());
      pendingRefundPreserved = Boolean(await bindings.DB.prepare(
        "SELECT 1 FROM order_refund_requests WHERE id='refund_a' AND status='pending' AND decided_at IS NULL AND decided_by_user_id IS NULL",
      ).first());
      const legacyPayments = await bindings.DB.prepare("SELECT count(*) AS count FROM payments WHERE order_id='order_legacy'").first<{ count: number }>();
      legacyPaymentGapPreserved = legacyPayments?.count === 0;
    });
    const rawPost = await execute(implementationConfigPath, "SELECT id,value FROM s4_rehearsal_sentinel ORDER BY id; SELECT count(*) AS orders FROM orders; SELECT count(*) AS refunds FROM order_refund_requests; SELECT count(*) AS payments FROM payments; PRAGMA foreign_key_check;");
    if (!rawPost.includes('proxy-write') || !rawPost.includes('raw-write')) throw new Error('Raw CLI post-migration cross-read failed.');
    foreignKeyViolations = rawForeignKeyViolationCount(rawPost);

    const beforeReapply = migrationNames.join('|');
    let beforeReapplyState = '';
    await withLocalBindings({ configPath: implementationConfigPath, persistRoot }, async ({ bindings }) => {
      beforeReapplyState = await captureCompleteSchemaNineState(bindings.DB, bindings.FILES);
    });
    await apply(implementationConfigPath);
    let afterReapply: string[] = [];
    let afterReapplyState = '';
    await withLocalBindings({ configPath: implementationConfigPath, persistRoot }, async ({ bindings }) => {
      afterReapply = await appliedMigrationNames(bindings.DB);
      afterReapplyState = await captureCompleteSchemaNineState(bindings.DB, bindings.FILES);
    });
    const manifest: S4ProtectedManifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      databaseName: identities.d1DatabaseName,
      coreDigest: after.coreDigest,
      counts: after.counts,
      objectKeyDigests: after.objectKeyDigests,
      objectContentDigests: after.objectContentDigests,
      capabilityDigests: after.capabilityDigests,
      migrationNames,
    };
    if (options.manifestPath) await writeS4ProtectedManifest(options.manifestPath, manifest, [
      S4_POPULATED_FIXTURE.products.a.key,
      S4_POPULATED_FIXTURE.products.a.importKey,
      S4_POPULATED_FIXTURE.products.b.key,
    ]);
    const result: RehearsalResult = {
      persistRoot,
      failureObserved: faults.length === 3,
      retrySucceeded: migrationNames.join('|') === MIGRATION_NAMES.join('|'),
      reapplyWasNoop: beforeReapply === afterReapply.join('|'),
      preservationMatched: before.coreDigest === after.coreDigest,
      foreignKeyViolations,
      migrationNames,
      assignmentPreserved,
      pendingRefundPreserved,
      legacyPaymentGapPreserved,
      postReapplyPreserved: beforeReapplyState === afterReapplyState,
      faults,
      localSafety: {
        writerBarrier: 'isolated-disposable-state',
        checkpointVerified: faults.every((fault) => fault.rolledBack && fault.ledgerUnchanged),
        abortsVerified: faults.filter((fault) => fault.rolledBack && fault.ledgerUnchanged && fault.foreignKeyViolations === 0).length,
      },
      manifest,
    };
    assertRehearsalInvariants(result);
    return result;
  } finally {
    if (!options.keepState) await rm(runRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baselineIndex = process.argv.indexOf('--baseline-ref');
  const baselineRef = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : undefined;
  if (!baselineRef) throw new TypeError('Usage: s4-populated-rehearsal.ts --baseline-ref <commit-hash>');
  const result = await runS4PopulatedRehearsal({ baselineRef });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
