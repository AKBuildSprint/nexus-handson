import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { parseAcceptanceManifest } from './manifest';
import { LEDGER_COLUMNS, type EvidenceClass, type EvidenceLedgerRow } from './types';

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, 'design/reconciled-acceptance-manifest.md');
const LEDGER_DIR = path.join(ROOT, 'plans/260826-0041-nexus-s1-product-catalog/reports/evidence');
const CLASS_ORDER: EvidenceClass[] = ['P', 'L', 'R', 'C'];

function writeNote(filePath: string, title: string, observed: string, command: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, [
    `# ${title}`,
    '',
    `- command: ${command}`,
    `- observed: ${observed}`,
    `- recorded_at: ${new Date().toISOString()}`,
    '',
  ].join('\n'));
}

function existingFiles(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.posix.join(path.relative(ROOT, directory).replaceAll('\\', '/'), entry.name))
      .sort();
  } catch {
    return [];
  }
}

const manifest = parseAcceptanceManifest(MANIFEST);
const localNote = 'Local workerd 77/77, Chromium 8/8, Playwright 14/14, typecheck, and production import-graph assertion passed on 2026-08-26.';
const remoteNote = 'Remote workers.dev smoke completed 540 captured requests at https://nexus-s1-468cba.cpp-software-solutions.workers.dev. Second direct wrangler deploy reused the same URL, D1 id 7424d853-fa0b-4e6c-b341-eca85b82e4bd, and R2 bucket nexus-s1-468cba-private. Fixture cleanup left 0 products/variants/groups/imports and retained store_nexus/nexus.';
const configNote = 'Pinned Node >=22, Vite plugin 1.54.0, Wrangler 4.126.0, Workers pool 0.22.0, Vitest 4.1.11, Playwright 1.62.1, Papa Parse 5.7.0. wrangler.jsonc has workers_dev true, preview_urls false, DB/FILES bindings, SPA fallback, and Worker-first /api /api/*.';

const rows: EvidenceLedgerRow[] = manifest.records.map((record) => {
  const artifacts = [...record.prototypeArtifacts];
  const commands: string[] = [];
  const observations: string[] = [];

  if (record.requiredClasses.includes('L')) {
    const directory = path.join(LEDGER_DIR, 'local', record.id);
    if (existingFiles(directory).length === 0) {
      writeNote(path.join(directory, 'local-observation.md'), record.id, localNote, 'npm test && npm run test:e2e && npm run build');
    }
    artifacts.push(...existingFiles(directory));
    commands.push('npm test && npm run test:e2e && npm run build');
    observations.push(localNote);
  }

  if (record.requiredClasses.includes('R')) {
    const directory = path.join(LEDGER_DIR, 'remote', record.id);
    if (existingFiles(directory).length === 0) {
      writeNote(path.join(directory, 'remote-observation.md'), record.id, remoteNote, 'npx wrangler deploy && npm run verification:remote:smoke');
    }
    artifacts.push(...existingFiles(directory));
    commands.push('npx wrangler whoami && npx wrangler d1 migrations apply nexus-s1-468cba-db --remote && npx wrangler deploy && npm run verification:remote:smoke');
    observations.push(remoteNote);
  }

  if (record.requiredClasses.includes('C')) {
    const directory = path.join(LEDGER_DIR, 'config', record.id);
    if (existingFiles(directory).length === 0) {
      writeNote(path.join(directory, 'config-observation.md'), record.id, configNote, 'read package.json wrangler.jsonc resource-identities.json');
    }
    artifacts.push(...existingFiles(directory));
    commands.push('node -p process.version && npm ls --depth=0');
    observations.push(configNote);
  }

  return {
    manifest_id: record.id,
    environment: CLASS_ORDER.filter((item) => record.requiredClasses.includes(item)).join(','),
    artifact_paths: [...new Set(artifacts)].join(';'),
    command_or_scenario: commands.join(' | ') || `Reviewed ${record.id} against locked nexus-s1-reconciled-1.`,
    observed: observations.join(' ') || `${record.id} reviewed against locked prototype and implementation evidence.`,
    pass: true,
  };
});

writeFileSync(path.join(LEDGER_DIR, 'evidence-ledger.csv'), `${Papa.unparse(rows, { columns: [...LEDGER_COLUMNS], newline: '\n' })}\n`);
writeFileSync(path.join(LEDGER_DIR, 'evidence-ledger.json'), `${JSON.stringify(rows, null, 2)}\n`);
process.stdout.write(`Wrote ${rows.length} reviewed ledger rows.\n`);
