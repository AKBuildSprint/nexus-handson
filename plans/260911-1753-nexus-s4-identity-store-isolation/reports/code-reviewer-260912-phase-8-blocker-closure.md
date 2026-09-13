# Phase 8 Blocker Closure Code Review

Date: 2026-09-12 21:25 Asia/Saigon
Reviewer: code-reviewer
Scope: mandatory final Phase 8 advisory review after Kongming blocker fixes. No production, test, config, docs, or remote changes were made.

## Findings first

No critical or high findings.

Score: 9.8 / 10
Critical count: 0
High count: 0
GO/NO-GO: GO for Phase 8 local acceptance and remote-preparation scope. NO remote cutover is approved or proven by this review.

## Closure of the four blocker classes

### 1. Three raw destructive-stage fault points with complete rollback proof — closed

`scripts/verification/s4-populated-rehearsal.ts` now creates a schema-9 checkpoint after applying baseline schema 1-7 from explicit baseline `a3a67f6`, applying current migrations 0008-0009, seeding assignment history/command/current assignment, and capturing a complete digest over schema, table data, migration ledger, and R2 key/content evidence (`scripts/verification/s4-populated-rehearsal.ts:243-305`).

The runner then creates three disposable migration copies with injected failures in the checked-in 0010 SQL at these boundaries: after staging, after parent/child drops, and during late restoration (`scripts/verification/s4-populated-rehearsal.ts:305-362`). Each failed apply is verified against the original schema-9 digest, the original nine-entry `d1_migrations` ledger, a direct assignment-history-command join, and raw Wrangler `PRAGMA foreign_key_check` (`scripts/verification/s4-populated-rehearsal.ts:341-360`).

The clean retry uses the repository root `wrangler.jsonc` and untouched checked-in `migrations/0010-refund-decisions.sql`, then records the exact 0001-0010 ledger, post-reapply no-op state equality, assignment preservation, pending Refund preservation, legacy paid-without-payment preservation, and zero FK violations (`scripts/verification/s4-populated-rehearsal.ts:364-446`). The invariant gate throws on any missing fault, rollback mismatch, ledger mutation, FK row, retry/reapply failure, missing assignment/refund/payment-gap preservation, or missing R2 content evidence (`scripts/verification/s4-populated-rehearsal.ts:54-97`).

### 2. Purchased Variant retention in all three uncertain outcomes — closed

`packages/catalog/src/files/delivery-file.ts` classifies failed post-upload D1 outcomes by checking whether the new object key is referenced by Products, Variants, or purchased Order line snapshots before attempting compensation (`packages/catalog/src/files/delivery-file.ts:178-185`, `325-350`). This is the right fail-safe boundary: committed or unknown association outcomes retain the uploaded object; only unreferenced new objects are compensation candidates.

The focused integration coverage now includes purchased Variant replacement cases for commit-before-response-failure, post-failure reference lookup outage, and compensation failure. Each case asserts the original purchased `order_lines.private_file_key` remains the exact original key, the original object bytes are still readable, and retained objects include the correct original/replacement keys (`tests/integration/delivery-replacement.test.ts:219-366`). Product-path uncertain outcomes remain covered in the same file (`tests/integration/delivery-replacement.test.ts:170-328`).

### 3. Fail-closed named gate, post-reapply, and honest local key/content/barrier evidence — closed

The standalone Node config is isolated from the Workers/browser pool and discovers only `tests/node/**/*.test.ts` (`vitest.node.config.ts:1-9`). The Node test asserts the named rehearsal returns three fault proofs, post-reapply preservation, distinct R2 key and content digest arrays, no raw object key leakage, exact local dry-run behavior, and invariant failure on falsified results (`tests/node/s4-populated-rehearsal.test.ts:39-130`, `201-271`).

The local binding helper requires an absolute isolated `.wrangler` root, maps the CLI root to the proxy `v3` path, disables remote bindings, and disposes the proxy in `finally` (`scripts/verification/local-binding-context.ts:28-67`). The rehearsal proves same-state raw/proxy use with proxy-written and raw-written sentinels before and after migration (`scripts/verification/s4-populated-rehearsal.ts:274-285`, `394-396`). It hashes R2 object keys and R2 object contents separately instead of emitting raw keys or content (`scripts/verification/s4-populated-rehearsal.ts:188-205`, `225-235`).

### 4. Remote sequence explicitly future-blocked — closed

The checked-in named environment exists only as `env.s4-provisioning` in the root Wrangler config, with exact DB/R2 identities, `remote: true` bindings, and `.invalid` origins that cannot be mistaken for live endpoints (`wrangler.jsonc:34-56`). Default root bindings remain local.

The provisioning CLI rejects remote apply before creating a remote path, and the remote smoke helper only accepts dry-run validation with `mutationAuthorized: false` (`scripts/provision-s4-identities.ts`, `scripts/verification/s4-remote-smoke.ts:26-55`, `58-90`). README states the S4 commands are for local validation and remote-input validation only, says remote cutover is blocked, and warns that local evidence is not a deployed security claim (`README.md:138-146`, `196-202`). The S4 runbook is titled `FUTURE PROCEDURE — REMOTE CUTOVER BLOCKED`, stops before remote migration, and says remote-capable provisioning/smoke apply must be implemented, tested, reviewed, and separately authorized before any remote schema mutation (`plans/260911-1753-nexus-s4-identity-store-isolation/reports/remote-runbook.md:1-5`, `56-85`).

## Acceptance and blast-radius review

The Phase 8 plan requires local populated migration proof, secret-safe provisioning/runbook, cross-store and assigned-order acceptance, retained purchased objects, Node22 evidence, and documentation that separates local checkout behavior from deployed state (`plans/260911-1753-nexus-s4-identity-store-isolation/phase-08-migration-rehearsal-and-rollout.md:44-61`). The implementation now matches that local scope.

Public contracts remain intact. The operator surfaces are scripts, not public Worker routes. The delivery-file package signature now requires `ConsoleIdentityContext`, and the Worker adapter plus direct integration callers have been updated to pass it. The HTTP response codes stay within the existing catalog error envelope families: `store_access_denied`, `persistence_failed`, `storage_compensation_failed`, revision conflicts, and validation/type failures.

The migration rehearsal does not fake a successful persistence layer: it shells out to the installed Wrangler CLI for raw `d1 migrations apply`/`execute`, uses `getPlatformProxy` for real local D1/R2 bindings against the same persisted state, and compares raw/proxy sentinels. The failed migration copies are disposable and do not alter the checked-in SQL used for retry.

No remote operation was performed by this review. I did not find any hidden remote default or public provisioning route.

## Verification performed in this review

- `npm run verification:s4-rehearsal:test` — passed, 1 file / 6 tests, 38.91s.
- `npm run test:workerd -- tests/integration/delivery-replacement.test.ts` — passed, 1 file / 9 tests, 4.03s.
- `git diff --check` — passed.

Controller-provided Node22 evidence considered for wider regression coverage: node 6/6, named rehearsal pass, unit 40/40, integration 188/188, browser 62/62, E2E 30/30, typecheck, both builds, diff check, no remote.

## Non-blocking notes

- The requested `remote-runbook.md` root path is not present; the active runbook is `plans/260911-1753-nexus-s4-identity-store-isolation/reports/remote-runbook.md`, which README links. This is not a blocker because the linked runbook is explicit and future-blocked.
- README still contains legacy S1 remote smoke instructions after the S4 remote-preparation section. The headings make the distinction clear enough for GO, but future cleanup could reduce operator scanning risk.

## Required fixes

None for Phase 8 GO.

Status: DONE
Summary: The final Phase 8 blocker fixes are verified in source and focused gates: destructive migration rollback, purchased Variant retention, fail-closed local rehearsal evidence, and future-blocked remote sequencing are closed. Phase 8 is GO for local acceptance and remote-preparation scope with zero critical/high findings.
Concerns/Blockers: None blocking. Remote migration/provisioning/deployment/smoke remains intentionally unperformed and not authorized by this review.
