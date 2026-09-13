# Phase 8 Node/operator evidence

Date: 2026-09-12
Runtime: Node v22.16.0

## Delivered

- Added an isolated Node Vitest config covering only `tests/node/**/*.test.ts`.
- Added a deterministic schema-7 Store A/B fixture containing products, a variant matrix, import/R2 associations, customers, Orders, capability/idempotency rows, command/history rows, one pending Refund request, one manual payment, and one legacy paid Order without a payment row.
- Added a raw migration rehearsal which materializes the explicit baseline commit `a3a67f6`, applies its root Wrangler config through migration 0007, seeds through a real local binding proxy, and uses the same absolute CLI persistence root for the current checkout's root Wrangler config.
- The rehearsal cross-reads a non-secret sentinel and populated counts from proxy to raw CLI, writes another sentinel through raw CLI and reads it through the proxy, injects a real 0010 failure after 0008/0009, seeds the schema-9 assignment graph, retries 0010, reapplies as a no-op, verifies the exact ten-entry ledger, and runs `PRAGMA foreign_key_check` through raw Wrangler.
- Added mode-0600, atomic, redacted protected-manifest IO. Follow-up hardening records R2 object-key digests and object-content digests separately; neither raw key nor content is written to reports.
- Added dry-run-first provisioning with real `provisionCredentialAccount`, conflict-safe one-active-membership creation, exact-rerun no-op, and recovery after credential success plus membership failure. Local CLI apply accepts identity intent and auth secret only through stdin/runtime environment.
- Added executable private-fixture, provisioning, and remote-smoke dry-run CLIs. Remote apply is rejected before proxy/network creation; remote smoke is validation-only.

## TDD evidence

- RED: `npx vitest run --config vitest.node.config.ts tests/node/s4-populated-rehearsal.test.ts` discovered one Node test and failed behaviorally because remote apply did not fail closed (`expected [Function] to throw`).
- GREEN: `PATH=/Users/plateau/.nvm/versions/node/v22.16.0/bin:$PATH npx vitest run --config vitest.node.config.ts tests/node/s4-populated-rehearsal.test.ts` — 1 file, 5 tests passed, 25.98s.
- Owned-file whitespace validation: `git diff --check -- <owned paths>` — passed.
- Root typecheck currently reaches an unrelated concurrent file and fails at `tests/integration/s4-acceptance.test.ts:211` (`HeadersInit` union with optional undefined properties). No owned Phase 8 Node/operator TypeScript error remains in the output.

## Explicit remaining obligations

- No package scripts were registered because `package.json` and the lockfile were explicitly outside this worker's ownership. Invoke the Node test and TypeScript entrypoints directly.
- No `s4-provisioning` named remote Wrangler environment exists in this worker's changes because `wrangler.jsonc` was explicitly outside ownership. Remote proxy/apply therefore remains unavailable and fail-closed.
- Authenticated remote inspection, checkpoint, migration, provisioning, deployment, and smoke were not performed and were not authorized.
- Cross-layer acceptance, browser/E2E evidence, the 10,000-Order performance measurement, evergreen docs, and plan status are owned elsewhere and are not claimed here.

Status: DONE_WITH_CONCERNS
Summary: The owned Node/operator implementation provides a real populated raw migration rehearsal, secret-safe dry-run tools, and real local identity provisioning behavior with focused green evidence.
Concerns/Blockers: Root typecheck is blocked by the unrelated concurrent `tests/integration/s4-acceptance.test.ts:211` error; package script and named remote-environment registration were outside ownership, so remote mutation remains intentionally unavailable.
