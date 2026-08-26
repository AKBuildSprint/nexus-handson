import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCliArguments, requireArgument } from './cli';
import { parseAcceptanceManifest } from './manifest';
import type {
  VerificationFixture,
  VerificationFixtureManifest,
} from './types';

const PRIVATE_DIRECTORY_FRAGMENT = `${path.sep}plans${path.sep}260826-0041-nexus-s1-product-catalog${path.sep}reports${path.sep}evidence${path.sep}private${path.sep}`;
const PREFIX_PATTERN = /^verify-[a-z0-9](?:[a-z0-9-]{0,39}[a-z0-9])?$/;
const WORKERS_DEV_PATTERN = /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/;
const OBJECT_KEY_PATTERN = /^(?:delivery\/[0-9a-f-]+|imports\/[0-9a-f-]+\.csv)$/;

function exactKeys(value: Record<string, unknown>, expected: string[], context: string) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\0') !== wanted.join('\0')) {
    throw new Error(`${context} keys must be exactly ${expected.join(', ')}.`);
  }
}

function nonemptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a nonempty string.`);
  return value;
}

function isoTimestamp(value: unknown, field: string): string {
  const timestamp = nonemptyString(value, field);
  if (new Date(timestamp).toISOString() !== timestamp) throw new Error(`${field} must be an ISO timestamp.`);
  return timestamp;
}

function validateFixture(input: unknown, prefix: string, manifestIds: Set<string>): VerificationFixture {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Each fixture must be an object.');
  const value = input as Record<string, unknown>;
  const kind = nonemptyString(value.kind, 'fixture.kind');
  const baseKeys = ['kind', 'manifestId', 'fixtureLabel', 'recordedAt'];
  const expectedByKind: Record<string, string[]> = {
    product: [...baseKeys, 'id', 'slug'],
    variant: [...baseKeys, 'id', 'productId'],
    import: [...baseKeys, 'id', 'filename'],
    object: [...baseKeys, 'alias', 'privateObjectKey', 'ownerKind', 'ownerId', 'disposition'],
  };
  const expected = expectedByKind[kind];
  if (!expected) throw new Error(`Unknown fixture kind ${kind}.`);
  exactKeys(value, expected, `Fixture ${kind}`);
  const manifestId = nonemptyString(value.manifestId, 'fixture.manifestId');
  if (!manifestIds.has(manifestId)) throw new Error(`Fixture references nonmanifest ID ${manifestId}.`);
  const fixtureLabel = nonemptyString(value.fixtureLabel, 'fixture.fixtureLabel');
  if (!fixtureLabel.startsWith(`${prefix}-`)) throw new Error(`Fixture label ${fixtureLabel} is not prefixed by ${prefix}-.`);
  const recordedAt = isoTimestamp(value.recordedAt, 'fixture.recordedAt');

  if (kind === 'product') {
    return { kind, manifestId, fixtureLabel, recordedAt, id: nonemptyString(value.id, 'product.id'), slug: nonemptyString(value.slug, 'product.slug') };
  }
  if (kind === 'variant') {
    return { kind, manifestId, fixtureLabel, recordedAt, id: nonemptyString(value.id, 'variant.id'), productId: nonemptyString(value.productId, 'variant.productId') };
  }
  if (kind === 'import') {
    return { kind, manifestId, fixtureLabel, recordedAt, id: nonemptyString(value.id, 'import.id'), filename: nonemptyString(value.filename, 'import.filename') };
  }

  const privateObjectKey = value.privateObjectKey;
  if (privateObjectKey !== null && (typeof privateObjectKey !== 'string' || !OBJECT_KEY_PATTERN.test(privateObjectKey))) {
    throw new Error('object.privateObjectKey must be null or an exact delivery/import object key.');
  }
  const ownerKind = nonemptyString(value.ownerKind, 'object.ownerKind');
  if (!['product', 'variant', 'import'].includes(ownerKind)) throw new Error(`Unknown object owner kind ${ownerKind}.`);
  const disposition = nonemptyString(value.disposition, 'object.disposition');
  if (!['unresolved', 'active_fixture', 'historical_retained', 'snapshot_ambiguous', 'unreferenced_fixture'].includes(disposition)) {
    throw new Error(`Unknown object disposition ${disposition}.`);
  }
  return {
    kind: 'object',
    manifestId,
    fixtureLabel,
    recordedAt,
    alias: nonemptyString(value.alias, 'object.alias'),
    privateObjectKey,
    ownerKind: ownerKind as 'product' | 'variant' | 'import',
    ownerId: nonemptyString(value.ownerId, 'object.ownerId'),
    disposition: disposition as 'unresolved' | 'active_fixture' | 'historical_retained' | 'snapshot_ambiguous' | 'unreferenced_fixture',
  };
}

export function validateFixtureManifest(input: unknown, acceptanceManifestPath: string): VerificationFixtureManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Fixture manifest must be an object.');
  const value = input as Record<string, unknown>;
  exactKeys(value, ['schemaVersion', 'acceptanceManifestId', 'verificationPrefix', 'baseUrl', 'createdAt', 'fixtures'], 'Fixture manifest');
  const acceptance = parseAcceptanceManifest(acceptanceManifestPath);
  if (value.schemaVersion !== 1 || value.acceptanceManifestId !== acceptance.id) throw new Error('Fixture manifest schema or acceptance manifest ID is stale.');
  const verificationPrefix = nonemptyString(value.verificationPrefix, 'verificationPrefix');
  if (!PREFIX_PATTERN.test(verificationPrefix)) throw new Error('verificationPrefix must match verify-[a-z0-9-] and be at most 47 characters.');
  const baseUrl = nonemptyString(value.baseUrl, 'baseUrl').replace(/\/$/, '');
  if (!WORKERS_DEV_PATTERN.test(baseUrl)) throw new Error('baseUrl must be an exact HTTPS workers.dev deployment origin.');
  const createdAt = isoTimestamp(value.createdAt, 'createdAt');
  if (!Array.isArray(value.fixtures)) throw new Error('fixtures must be an array.');
  const manifestIds = new Set(acceptance.records.map((record) => record.id));
  const fixtures = value.fixtures.map((fixture) => validateFixture(fixture, verificationPrefix, manifestIds));

  const identities = new Set<string>();
  const objectKeys = new Set<string>();
  for (const fixture of fixtures) {
    const identity = fixture.kind === 'object' ? `object:${fixture.alias}` : `${fixture.kind}:${fixture.id}`;
    if (identities.has(identity)) throw new Error(`Duplicate fixture identity ${identity}.`);
    identities.add(identity);
    if (fixture.kind === 'object' && fixture.privateObjectKey !== null) {
      if (objectKeys.has(fixture.privateObjectKey)) throw new Error('Duplicate private object key in fixture manifest.');
      objectKeys.add(fixture.privateObjectKey);
    }
  }

  const products = new Set(fixtures.filter((fixture) => fixture.kind === 'product').map((fixture) => fixture.id));
  const variants = new Set(fixtures.filter((fixture) => fixture.kind === 'variant').map((fixture) => fixture.id));
  const imports = new Set(fixtures.filter((fixture) => fixture.kind === 'import').map((fixture) => fixture.id));
  for (const fixture of fixtures) {
    if (fixture.kind === 'variant' && !products.has(fixture.productId)) throw new Error(`Variant ${fixture.id} has an unknown fixture Product owner.`);
    if (fixture.kind === 'object') {
      const owners = fixture.ownerKind === 'product' ? products : fixture.ownerKind === 'variant' ? variants : imports;
      if (!owners.has(fixture.ownerId)) throw new Error(`Object ${fixture.alias} has an unknown ${fixture.ownerKind} fixture owner.`);
    }
  }

  return { schemaVersion: 1, acceptanceManifestId: acceptance.id, verificationPrefix, baseUrl, createdAt, fixtures };
}

function assertPrivatePath(filePath: string) {
  const absolute = path.resolve(filePath);
  if (!absolute.includes(PRIVATE_DIRECTORY_FRAGMENT)) {
    throw new Error('Private fixture manifests and generated cleanup commands must stay under the ignored reports/evidence/private directory.');
  }
}

export function loadFixtureManifest(filePath: string, acceptanceManifestPath: string): VerificationFixtureManifest {
  assertPrivatePath(filePath);
  return validateFixtureManifest(JSON.parse(readFileSync(filePath, 'utf8')), acceptanceManifestPath);
}

export function appendFixture(filePath: string, acceptanceManifestPath: string, fixture: VerificationFixture) {
  const manifest = loadFixtureManifest(filePath, acceptanceManifestPath);
  const updated = validateFixtureManifest({ ...manifest, fixtures: [...manifest.fixtures, fixture] }, acceptanceManifestPath);
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, filePath);
  chmodSync(filePath, 0o600);
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlList(values: string[]): string {
  return values.length === 0 ? "SELECT '' WHERE 0" : values.map(sqlLiteral).join(', ');
}

function generateCleanup(root: string, fixturePath: string, acceptancePath: string, outputDirectory: string) {
  assertPrivatePath(outputDirectory.endsWith(path.sep) ? outputDirectory : `${outputDirectory}${path.sep}`);
  const fixtureManifest = loadFixtureManifest(fixturePath, acceptancePath);
  const objects = fixtureManifest.fixtures.filter((fixture) => fixture.kind === 'object');
  for (const object of objects) {
    if (object.privateObjectKey === null || object.disposition === 'unresolved') throw new Error(`Object ${object.alias} has no resolved private key.`);
    if (object.disposition === 'historical_retained' || object.disposition === 'snapshot_ambiguous') {
      throw new Error(`Object ${object.alias} is ${object.disposition} and cannot enter cleanup.`);
    }
    if (!['active_fixture', 'unreferenced_fixture'].includes(object.disposition)) throw new Error(`Object ${object.alias} is not cleanup-eligible.`);
  }

  const products = fixtureManifest.fixtures.filter((fixture) => fixture.kind === 'product');
  const imports = fixtureManifest.fixtures.filter((fixture) => fixture.kind === 'import');
  const productIds = products.map((fixture) => fixture.id);
  const importIds = imports.map((fixture) => fixture.id);
  const productIdSql = sqlList(productIds);
  const importIdSql = sqlList(importIds);
  const cleanupSql = [
    'PRAGMA foreign_keys = ON;',
    'BEGIN IMMEDIATE;',
    `UPDATE product_variants SET status = 'disabled', current_schema = 0 WHERE product_id IN (${productIdSql});`,
    `DELETE FROM product_variant_values WHERE product_id IN (${productIdSql});`,
    `DELETE FROM product_variants WHERE product_id IN (${productIdSql});`,
    `DELETE FROM product_option_values WHERE product_id IN (${productIdSql});`,
    `DELETE FROM product_option_groups WHERE product_id IN (${productIdSql});`,
    `DELETE FROM products WHERE id IN (${productIdSql});`,
    `DELETE FROM imports WHERE id IN (${importIdSql});`,
    'COMMIT;',
    '',
  ].join('\n');
  const absenceSql = [
    `SELECT 'products' AS fixture_kind, count(*) AS remaining FROM products WHERE id IN (${productIdSql})`,
    `UNION ALL SELECT 'variants', count(*) FROM product_variants WHERE product_id IN (${productIdSql})`,
    `UNION ALL SELECT 'groups', count(*) FROM product_option_groups WHERE product_id IN (${productIdSql})`,
    `UNION ALL SELECT 'values', count(*) FROM product_option_values WHERE product_id IN (${productIdSql})`,
    `UNION ALL SELECT 'memberships', count(*) FROM product_variant_values WHERE product_id IN (${productIdSql})`,
    `UNION ALL SELECT 'imports', count(*) FROM imports WHERE id IN (${importIdSql});`,
    "SELECT id, slug FROM stores WHERE id = 'store_nexus' AND slug = 'nexus';",
    '',
  ].join('\n');

  const identities = JSON.parse(readFileSync(path.resolve(root, 'resource-identities.json'), 'utf8')) as Record<string, unknown>;
  exactKeys(identities, ['workerName', 'd1DatabaseName', 'd1DatabaseId', 'r2BucketName'], 'resource-identities.json');
  const databaseName = nonemptyString(identities.d1DatabaseName, 'd1DatabaseName');
  const bucketName = nonemptyString(identities.r2BucketName, 'r2BucketName');
  const objectCommands = objects.map((object) => ({
    alias: object.alias,
    argv: ['npx', 'wrangler', 'r2', 'object', 'delete', `${bucketName}/${object.privateObjectKey as string}`, '--remote'],
  }));
  const controllerCommands = {
    databaseCleanup: ['npx', 'wrangler', 'd1', 'execute', databaseName, '--remote', '--file', path.join(outputDirectory, 'cleanup.sql')],
    databaseAbsenceProof: ['npx', 'wrangler', 'd1', 'execute', databaseName, '--remote', '--file', path.join(outputDirectory, 'absence.sql')],
    objectCleanup: objectCommands,
  };

  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(outputDirectory, 'cleanup.sql'), cleanupSql, { mode: 0o600, flag: 'wx' });
  writeFileSync(path.join(outputDirectory, 'absence.sql'), absenceSql, { mode: 0o600, flag: 'wx' });
  writeFileSync(path.join(outputDirectory, 'cleanup-commands.json'), `${JSON.stringify(controllerCommands, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

function main() {
  const arguments_ = parseCliArguments(process.argv.slice(2));
  const root = process.cwd();
  const acceptancePath = path.resolve(root, arguments_.values.manifest ?? 'design/reconciled-acceptance-manifest.md');
  if (arguments_.command === 'init') {
    const fixturePath = path.resolve(root, requireArgument(arguments_, 'fixture-manifest'));
    assertPrivatePath(fixturePath);
    const prefix = requireArgument(arguments_, 'prefix');
    const baseUrl = requireArgument(arguments_, 'base-url').replace(/\/$/, '');
    const acceptance = parseAcceptanceManifest(acceptancePath);
    const initial = validateFixtureManifest({
      schemaVersion: 1,
      acceptanceManifestId: acceptance.id,
      verificationPrefix: prefix,
      baseUrl,
      createdAt: new Date().toISOString(),
      fixtures: [],
    }, acceptancePath);
    mkdirSync(path.dirname(fixturePath), { recursive: true, mode: 0o700 });
    writeFileSync(fixturePath, `${JSON.stringify(initial, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    process.stdout.write('Initialized private verification fixture manifest.\n');
    return;
  }
  if (arguments_.command === 'check') {
    const fixturePath = path.resolve(root, requireArgument(arguments_, 'fixture-manifest'));
    const manifest = loadFixtureManifest(fixturePath, acceptancePath);
    process.stdout.write(`Validated ${manifest.fixtures.length} private verification fixture records.\n`);
    return;
  }
  if (arguments_.command === 'generate-cleanup') {
    const fixturePath = path.resolve(root, requireArgument(arguments_, 'fixture-manifest'));
    const outputDirectory = path.resolve(root, requireArgument(arguments_, 'output-dir'));
    generateCleanup(root, fixturePath, acceptancePath, outputDirectory);
    process.stdout.write('Generated private FK-safe cleanup inputs; no cleanup was executed.\n');
    return;
  }
  throw new Error('Usage: verification-fixtures.ts init|check|generate-cleanup --fixture-manifest path [--prefix value --base-url URL | --output-dir path]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
