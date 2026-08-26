export const LEDGER_COLUMNS = [
  'manifest_id',
  'environment',
  'artifact_paths',
  'command_or_scenario',
  'observed',
  'pass',
] as const;

export type EvidenceClass = 'P' | 'L' | 'R' | 'C';

export interface ManifestRecord {
  id: string;
  contract: string;
  evidence: string;
  requiredClasses: EvidenceClass[];
  prototypeKeys: string[];
  prototypeArtifacts: string[];
}

export interface AcceptanceManifest {
  id: string;
  version: number;
  status: 'LOCKED_ACCEPTANCE_AUTHORITY';
  sourcePath: string;
  records: ManifestRecord[];
  prototypeRegistry: Record<string, string[]>;
}

export interface EvidenceLedgerRow {
  manifest_id: string;
  environment: string;
  artifact_paths: string;
  command_or_scenario: string;
  observed: string;
  pass: boolean | null;
}

export interface EvidenceSummary {
  manifest_id: string;
  manifest_version: number;
  generated_at: string;
  complete: boolean;
  counts: {
    manifest_records: number;
    passed: number;
    incomplete: number;
    artifacts: number;
  };
  rows: EvidenceLedgerRow[];
}

export type FixtureObjectDisposition =
  | 'unresolved'
  | 'active_fixture'
  | 'historical_retained'
  | 'snapshot_ambiguous'
  | 'unreferenced_fixture';

interface VerificationFixtureBase {
  manifestId: string;
  fixtureLabel: string;
  recordedAt: string;
}

export interface ProductVerificationFixture extends VerificationFixtureBase {
  kind: 'product';
  id: string;
  slug: string;
}

export interface VariantVerificationFixture extends VerificationFixtureBase {
  kind: 'variant';
  id: string;
  productId: string;
}

export interface ImportVerificationFixture extends VerificationFixtureBase {
  kind: 'import';
  id: string;
  filename: string;
}

export interface ObjectVerificationFixture extends VerificationFixtureBase {
  kind: 'object';
  alias: string;
  privateObjectKey: string | null;
  ownerKind: 'product' | 'variant' | 'import';
  ownerId: string;
  disposition: FixtureObjectDisposition;
}

export type VerificationFixture =
  | ProductVerificationFixture
  | VariantVerificationFixture
  | ImportVerificationFixture
  | ObjectVerificationFixture;

export interface VerificationFixtureManifest {
  schemaVersion: 1;
  acceptanceManifestId: string;
  verificationPrefix: string;
  baseUrl: string;
  createdAt: string;
  fixtures: VerificationFixture[];
}
