import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { AcceptanceManifest, EvidenceClass, ManifestRecord } from './types';

const EXPECTED_MANIFEST_ID = 'nexus-s1-reconciled-1';
const EXPECTED_MANIFEST_VERSION = 1;
const RECORD_ID = /^[A-Z]+-\d{3}$/;
const EXPECTED_GROUPS: Record<string, true> = {
  UI: true,
  API: true,
  DATA: true,
  MONEY: true,
  VAR: true,
  FILE: true,
  CSV: true,
  PRIV: true,
  SNAP: true,
  ROUTE: true,
  RES: true,
  TEST: true,
  DEPLOY: true,
  RISK: true,
};
const ARTIFACT_EXTENSION = /\.(?:html|png|csv|md)$/;

function tableCells(line: string): string[] {
  if (!line.startsWith('|')) return [];
  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  const content = line.slice(1, line.endsWith('|') ? -1 : undefined);
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '`' && content[index - 1] !== '\\') inCode = !inCode;
    if (character === '|' && !inCode && content[index - 1] !== '\\') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function inlineCode(value: string): string[] {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function prototypeKeysFrom(value: string): string[] {
  return [...value.matchAll(/\bP-[A-Z]+\b/g)].map((match) => match[0]);
}

function numericPrefix(filename: string): number | null {
  const match = /^(\d+)-/.exec(filename);
  return match ? Number(match[1]) : null;
}

function resolvePrototypeRegistry(rawRegistry: Map<string, string>, rootDirectory: string): Record<string, string[]> {
  const screenshotDirectory = '.artifacts/screenshots/20260826-030504-nexus-prototype';
  const resolved: Record<string, string[]> = {};

  for (const [key, expression] of rawRegistry) {
    const tokens = inlineCode(expression).filter((token) => ARTIFACT_EXTENSION.test(token));
    const paths = new Set<string>();
    for (const token of tokens) {
      if (token.includes('/')) paths.add(token);
      else if (token.endsWith('.png')) paths.add(path.posix.join(screenshotDirectory, token));
    }

    if (expression.includes(' through ') && tokens.length >= 2) {
      const startToken = tokens[tokens.length - 2];
      const endToken = tokens[tokens.length - 1];
      const start = numericPrefix(path.posix.basename(startToken));
      const end = numericPrefix(path.posix.basename(endToken));
      const directory = startToken.includes('/') ? path.posix.dirname(startToken) : screenshotDirectory;
      const absoluteDirectory = path.resolve(rootDirectory, directory);
      if (start === null || end === null || start > end || !existsSync(absoluteDirectory)) {
        throw new Error(`Prototype registry ${key} has an unresolvable artifact range.`);
      }
      for (const filename of readdirSync(absoluteDirectory)) {
        const prefix = numericPrefix(filename);
        if (prefix !== null && prefix >= start && prefix <= end) paths.add(path.posix.join(directory, filename));
      }
    }

    if (paths.size === 0) throw new Error(`Prototype registry ${key} contains no executable artifact path.`);
    resolved[key] = [...paths].sort();
  }
  return resolved;
}

function requiredClasses(evidence: string): EvidenceClass[] {
  const classes = new Set<EvidenceClass>();
  if (/\bP(?:-[A-Z]+)?\b/.test(evidence)) classes.add('P');
  for (const evidenceClass of ['L', 'R', 'C'] as const) {
    if (new RegExp(`\\b${evidenceClass}\\b`).test(evidence)) classes.add(evidenceClass);
  }
  if (classes.size === 0) throw new Error(`Acceptance record has no recognized evidence class: ${evidence}`);
  return [...classes];
}

export function parseAcceptanceManifest(manifestPath: string): AcceptanceManifest {
  const sourcePath = path.resolve(manifestPath);
  const rootDirectory = path.dirname(path.dirname(sourcePath));
  const source = readFileSync(sourcePath, 'utf8');
  const id = /^manifest_id:\s*(\S+)$/m.exec(source)?.[1];
  const versionText = /^manifest_version:\s*(\d+)$/m.exec(source)?.[1];
  const implementationStatus = /^status:\s*(\S+)$/m.exec(source)?.[1];
  const authorityStatus = /^\*\*Status:\*\*\s*(\S+)$/m.exec(source)?.[1];
  if (id !== EXPECTED_MANIFEST_ID || Number(versionText) !== EXPECTED_MANIFEST_VERSION) {
    throw new Error(`Manifest identity/version mismatch; expected ${EXPECTED_MANIFEST_ID} version ${EXPECTED_MANIFEST_VERSION}.`);
  }
  if (implementationStatus !== 'locked-for-implementation' || authorityStatus !== 'LOCKED_ACCEPTANCE_AUTHORITY') {
    throw new Error('Manifest is not LOCKED_ACCEPTANCE_AUTHORITY and locked-for-implementation.');
  }

  const rawRegistry = new Map<string, string>();
  const rawRecords: Array<{ id: string; contract: string; evidence: string }> = [];
  for (const line of source.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (cells.length < 2) continue;
    const firstCode = inlineCode(cells[0])[0];
    if (firstCode?.startsWith('P-') && cells.length === 2) rawRegistry.set(firstCode, cells[1]);
    if (firstCode && RECORD_ID.test(firstCode) && cells.length >= 3) {
      rawRecords.push({ id: firstCode, contract: cells[1], evidence: cells[2] });
    }
  }

  if (rawRecords.length === 0) throw new Error('Manifest contains no acceptance records.');
  const seen = new Set<string>();
  for (const record of rawRecords) {
    if (seen.has(record.id)) throw new Error(`Duplicate manifest ID ${record.id}.`);
    seen.add(record.id);
    const group = record.id.split('-', 1)[0];
    if (!EXPECTED_GROUPS[group]) throw new Error(`Unknown manifest record group ${group}.`);
  }

  const prototypeRegistry = resolvePrototypeRegistry(rawRegistry, rootDirectory);
  const records: ManifestRecord[] = rawRecords.map((record) => {
    const prototypeKeys = [...new Set([
      ...prototypeKeysFrom(record.contract),
      ...prototypeKeysFrom(record.evidence),
    ])];
    for (const key of prototypeKeys) {
      if (!prototypeRegistry[key]) throw new Error(`${record.id} references unknown prototype registry key ${key}.`);
    }
    const classes = requiredClasses(record.evidence);
    if (classes.includes('P') && prototypeKeys.length === 0) {
      throw new Error(`${record.id} requires P evidence without an exact prototype registry key.`);
    }
    return {
      ...record,
      requiredClasses: classes,
      prototypeKeys,
      prototypeArtifacts: [...new Set(prototypeKeys.flatMap((key) => prototypeRegistry[key]))].sort(),
    };
  });

  return {
    id,
    version: EXPECTED_MANIFEST_VERSION,
    status: 'LOCKED_ACCEPTANCE_AUTHORITY',
    sourcePath,
    records,
    prototypeRegistry,
  };
}
