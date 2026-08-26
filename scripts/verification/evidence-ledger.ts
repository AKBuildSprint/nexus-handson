import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { parseCliArguments } from './cli';
import { parseAcceptanceManifest } from './manifest';
import {
  LEDGER_COLUMNS,
  type AcceptanceManifest,
  type EvidenceClass,
  type EvidenceLedgerRow,
  type EvidenceSummary,
} from './types';

const DEFAULT_MANIFEST = 'design/reconciled-acceptance-manifest.md';
const DEFAULT_LEDGER_DIRECTORY = 'plans/260826-0041-nexus-s1-product-catalog/reports/evidence';
const CLASS_ORDER: EvidenceClass[] = ['P', 'L', 'R', 'C'];
const PRIVATE_VALUE = /(?:delivery\/[0-9a-f-]{16,}|imports\/[0-9a-f-]{16,}\.csv|authorization\s*:|cookie\s*:)/i;

function ledgerPaths(directory: string) {
  return {
    csv: path.join(directory, 'evidence-ledger.csv'),
    json: path.join(directory, 'evidence-ledger.json'),
  };
}

function artifactList(value: string): string[] {
  if (value.trim() === '') return [];
  const paths = value.split(';').map((item) => item.trim());
  if (paths.some((item) => item === '')) throw new Error('artifact_paths contains an empty path.');
  return paths;
}

function parsePass(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`Invalid pass value ${String(value)}; expected true, false, or null.`);
}

function normalizeRow(input: Record<string, unknown>): EvidenceLedgerRow {
  const keys = Object.keys(input);
  if (keys.length !== LEDGER_COLUMNS.length || LEDGER_COLUMNS.some((column, index) => keys[index] !== column)) {
    throw new Error(`Ledger row columns must be exactly ${LEDGER_COLUMNS.join('|')} in that order.`);
  }
  return {
    manifest_id: String(input.manifest_id ?? ''),
    environment: String(input.environment ?? ''),
    artifact_paths: String(input.artifact_paths ?? ''),
    command_or_scenario: String(input.command_or_scenario ?? ''),
    observed: String(input.observed ?? ''),
    pass: parsePass(input.pass),
  };
}

function readLedgers(directory: string): EvidenceLedgerRow[] {
  const files = ledgerPaths(directory);
  const jsonValue = JSON.parse(readFileSync(files.json, 'utf8')) as unknown;
  if (!Array.isArray(jsonValue)) throw new Error('Evidence ledger JSON must be an array of exact ledger rows.');
  const jsonRows = jsonValue.map((row) => normalizeRow(row as Record<string, unknown>));

  const csv = Papa.parse<Record<string, unknown>>(readFileSync(files.csv, 'utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  if (csv.errors.length > 0) throw new Error(`Evidence ledger CSV is invalid: ${csv.errors[0].message}`);
  if (csv.meta.fields?.join('|') !== LEDGER_COLUMNS.join('|')) {
    throw new Error(`Ledger CSV columns must be exactly ${LEDGER_COLUMNS.join('|')}.`);
  }
  const csvRows = csv.data.map(normalizeRow);
  if (JSON.stringify(csvRows) !== JSON.stringify(jsonRows)) {
    throw new Error('Evidence ledger CSV and JSON rows differ. Update them atomically.');
  }
  return jsonRows;
}

function relativeArtifactPath(root: string, artifact: string): string {
  if (path.isAbsolute(artifact) || artifact.includes('\0')) throw new Error(`Artifact path must be repository-relative: ${artifact}`);
  const normalized = path.posix.normalize(artifact.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) throw new Error(`Artifact path escapes the repository: ${artifact}`);
  if (normalized.includes('/evidence/private/')) throw new Error(`Private fixture evidence cannot be linked from the public ledger: ${artifact}`);
  const absolute = path.resolve(root, normalized);
  if (!statSync(absolute).isFile()) throw new Error(`Evidence artifact is not a file: ${artifact}`);
  return normalized;
}

function artifactClass(recordId: string, artifact: string, prototypeArtifacts: Set<string>): EvidenceClass | null {
  if (prototypeArtifacts.has(artifact)) return 'P';
  const base = 'plans/260826-0041-nexus-s1-product-catalog/reports/evidence';
  if (artifact.startsWith(`${base}/local/${recordId}/`)) return 'L';
  if (artifact.startsWith(`${base}/remote/${recordId}/`)) return 'R';
  if (artifact.startsWith(`${base}/config/${recordId}/`)) return 'C';
  return null;
}

function validateRows(root: string, manifest: AcceptanceManifest, rows: EvidenceLedgerRow[]): EvidenceSummary {
  const manifestById = new Map(manifest.records.map((record) => [record.id, record]));
  const ledgerById = new Map<string, EvidenceLedgerRow>();
  for (const row of rows) {
    if (ledgerById.has(row.manifest_id)) throw new Error(`Duplicate ledger ID ${row.manifest_id}.`);
    if (!manifestById.has(row.manifest_id)) throw new Error(`Extra ledger ID ${row.manifest_id}.`);
    ledgerById.set(row.manifest_id, row);
  }
  for (const record of manifest.records) {
    if (!ledgerById.has(record.id)) throw new Error(`Missing ledger ID ${record.id}.`);
  }

  let artifactCount = 0;
  for (const record of manifest.records) {
    const row = ledgerById.get(record.id) as EvidenceLedgerRow;
    const expectedEnvironment = CLASS_ORDER.filter((item) => record.requiredClasses.includes(item)).join(',');
    if (row.environment !== expectedEnvironment) {
      throw new Error(`${record.id} evidence classes must be exactly ${expectedEnvironment}; found ${row.environment}.`);
    }
    if (PRIVATE_VALUE.test(`${row.command_or_scenario}\n${row.observed}\n${row.artifact_paths}`)) {
      throw new Error(`${record.id} contains a secret header or private object key in public ledger data.`);
    }
    const rawArtifacts = artifactList(row.artifact_paths);
    const uniqueArtifacts = new Set(rawArtifacts);
    if (uniqueArtifacts.size !== rawArtifacts.length) throw new Error(`${record.id} contains duplicate artifact paths.`);
    const normalizedArtifacts = rawArtifacts.map((artifact) => relativeArtifactPath(root, artifact));
    artifactCount += normalizedArtifacts.length;

    const expectedPrototype = new Set(record.prototypeArtifacts);
    const foundClasses = new Set<EvidenceClass>();
    for (const artifact of normalizedArtifacts) {
      const evidenceClass = artifactClass(record.id, artifact, expectedPrototype);
      if (evidenceClass === null) throw new Error(`${record.id} has an extra or misclassified artifact: ${artifact}`);
      if (!record.requiredClasses.includes(evidenceClass)) throw new Error(`${record.id} has extra ${evidenceClass} evidence: ${artifact}`);
      foundClasses.add(evidenceClass);
    }
    for (const artifact of expectedPrototype) {
      if (!uniqueArtifacts.has(artifact)) throw new Error(`${record.id} is missing prototype artifact ${artifact}.`);
    }
    for (const evidenceClass of record.requiredClasses) {
      if (!foundClasses.has(evidenceClass)) throw new Error(`${record.id} is missing ${evidenceClass} artifact evidence.`);
    }
    if (row.command_or_scenario.trim() === '') throw new Error(`${record.id} has no command or scenario.`);
    if (row.observed.trim().length < 12 || /^(?:exit\s*0|command passed|passed)$/i.test(row.observed.trim())) {
      throw new Error(`${record.id} needs a concrete observed result, not a command-exit claim.`);
    }
    if (row.pass !== true) throw new Error(`${record.id} is not explicitly passed from reviewed artifacts.`);
  }

  return {
    manifest_id: manifest.id,
    manifest_version: manifest.version,
    generated_at: new Date().toISOString(),
    complete: true,
    counts: {
      manifest_records: manifest.records.length,
      passed: manifest.records.length,
      incomplete: 0,
      artifacts: artifactCount,
    },
    rows: manifest.records.map((record) => ledgerById.get(record.id) as EvidenceLedgerRow),
  };
}

function initialize(root: string, manifest: AcceptanceManifest, directory: string, force: boolean) {
  const files = ledgerPaths(directory);
  if (!force) {
    for (const file of Object.values(files)) {
      try {
        statSync(file);
        throw new Error(`Refusing to overwrite existing ledger ${file}; pass --force only when intentionally resetting unclaimed evidence.`);
      } catch (error) {
        if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error;
      }
    }
  }
  mkdirSync(directory, { recursive: true });
  const rows: EvidenceLedgerRow[] = manifest.records.map((record) => ({
    manifest_id: record.id,
    environment: CLASS_ORDER.filter((item) => record.requiredClasses.includes(item)).join(','),
    artifact_paths: record.prototypeArtifacts.join(';'),
    command_or_scenario: '',
    observed: '',
    pass: null,
  }));
  for (const record of manifest.records) {
    for (const artifact of record.prototypeArtifacts) relativeArtifactPath(root, artifact);
  }
  writeFileSync(files.csv, `${Papa.unparse(rows, { columns: [...LEDGER_COLUMNS], newline: '\n' })}\n`, { flag: force ? 'w' : 'wx' });
  writeFileSync(files.json, `${JSON.stringify(rows, null, 2)}\n`, { flag: force ? 'w' : 'wx' });
}

function main() {
  const arguments_ = parseCliArguments(process.argv.slice(2));
  if (!['init', 'check', 'summary'].includes(arguments_.command)) {
    throw new Error('Usage: evidence-ledger.ts init|check|summary [--manifest path] [--ledger-dir path] [--output path] [--force]');
  }
  const root = process.cwd();
  const manifest = parseAcceptanceManifest(path.resolve(root, arguments_.values.manifest ?? DEFAULT_MANIFEST));
  const directory = path.resolve(root, arguments_.values['ledger-dir'] ?? DEFAULT_LEDGER_DIRECTORY);
  if (arguments_.command === 'init') {
    initialize(root, manifest, directory, arguments_.flags.has('force'));
    process.stdout.write(`Initialized ${manifest.records.length} unclaimed ledger rows.\n`);
    return;
  }
  const summary = validateRows(root, manifest, readLedgers(directory));
  if (arguments_.command === 'check') {
    process.stdout.write(`Verified ${summary.counts.passed} manifest ledger rows and ${summary.counts.artifacts} artifacts.\n`);
    return;
  }
  const output = arguments_.values.output;
  if (!output) throw new Error('summary requires --output.');
  const outputPath = path.resolve(root, output);
  if (outputPath.includes(`${path.sep}evidence${path.sep}private${path.sep}`)) {
    throw new Error('HTML report summary input must not be written into private evidence.');
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote complete report summary input to ${path.relative(root, outputPath)}.\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
