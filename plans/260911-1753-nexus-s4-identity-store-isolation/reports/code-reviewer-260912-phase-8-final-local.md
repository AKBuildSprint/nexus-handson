# Phase 8 Final Local Implementation Review

Date: 2026-09-12 21:36 Asia/Saigon
Reviewer: code-reviewer
Scope: advisory code review only; no production, test, config, or remote changes.

## Verdict

GO for the local Phase 8 artifact.

Score: 9.7 / 10
Critical count: 0
High count: 0

I found no critical or high correctness, security, rollback, provisioning, or contract blocker in the current Phase 8 implementation. The local acceptance artifact is consistent with the Phase 8 plan: it proves populated-schema migration rehearsal, raw/proxy binding agreement, rollback/retry/reapply behavior, FK closure, preserved graph/R2/payment/refund/assignment state, local provisioning idempotency and recovery, dry-run-only remote preparation, and local-vs-deployed documentation boundaries.

## Blocking Findings

None.

## Evidence Reviewed

- Plan/contracts/acceptance:
  - `plans/260911-1753-nexus-s4-identity-store-isolation/phase-08-s4-acceptance.md`
  - `plans/260911-1753-nexus-s4-identity-store-isolation/contracts.md`
  - `plans/260911-1753-nexus-s4-identity-store-isolation/acceptance.md`
- Runtime and operator files:
  - `vitest.node.config.ts`
  - `tests/node/s4-populated-rehearsal.test.ts`
  - `tests/fixtures/s4-populated-store.ts`
  - `scripts/verification/s4-populated-rehearsal.ts`
  - `scripts/provision-s4-identities.ts`
  - `scripts/verification/s4-private-fixtures.ts`
  - `scripts/verification/s4-remote-smoke.ts`
  - `tests/integration/s4-acceptance.test.ts`
  - `package.json`, `tsconfig.json`, `wrangler.jsonc`
  - `README.md`, `docs/design-guidelines.md`, `AGENTS.md`, `apps/console/AGENTS.md`
  - `plans/260911-1753-nexus-s4-identity-store-isolation/reports/remote-runbook.md` because the requested root `remote-runbook.md` path is not present.
- Existing migration closure checked around `migrations/0009-store-memberships.sql` and `migrations/0010-refund-decisions.sql` where Phase 8 preservation depends on schema behavior.
- Local command run during this review:
  - `npm run verification:s4-rehearsal:test`
  - Result: PASS, 1 file / 5 tests, 27.84s.
- Controller evidence considered but not re-run in full: Node22 unit40, node5, integration185, browser62, E2E30, typecheck, both builds, diff-check, raw command all true/FK0, clean ports/state.

## Critical/High Review Findings

No critical or high findings.

The following requested risk areas were specifically checked:

- Actual baseline/current root schema path: `scripts/verification/s4-populated-rehearsal.ts` archives baseline ref `a3a67f6`, applies root config migrations through schema 7 into a real local Wrangler state root, then applies current root migrations 8-10 on the same state. The path conversion through `resolveLocalBindingContext` keeps proxy and raw CLI on the same underlying state.
- Injected migration failure/rollback/retry/reapply: the rehearsal intentionally creates `_s4_refund_requests` before migration 0010, observes failure, verifies the pre-failure core digest remains unchanged, removes the collision, reapplies successfully, then reapplies again and asserts no-op preservation.
- Raw/proxy bidirectional sentinel and counts: the script writes via proxy, reads via raw Wrangler SQL, writes a raw sentinel, then re-reads through proxy after current migrations. This catches split-state rehearsal mistakes.
- FK closure: raw `PRAGMA foreign_key_check` is asserted empty after current migration.
- Data preservation: the fixture and manifest cover Store graph, products/options/variants, imports, customers, orders, lines, access/capabilities, idempotency, refund requests/history/commands, payments, and R2 object hashes. Current checks also assert assignment, pending refund, and legacy paid-without-payment gap preservation.
- Provisioning: `scripts/provision-s4-identities.ts` is dry-run safe by default, rejects remote apply, requires exact local resource names, provisions through the real auth path, returns redacted digests only, detects same-credential/different-store conflicts, and recovers from a partial account-without-membership state only after validating the target Store exists.
- Secrets and private material: local fixture manifest writing enforces absolute protected paths, validates secret-free JSON, writes mode 0600, and CLI tests assert passwords, emails, capability values, private R2 keys, account IDs, and credential references do not leak to stdout/result JSON.
- Remote safety: the named `s4-provisioning` environment exists in `wrangler.jsonc` with remote bindings and invalid placeholder origins. The remote smoke helper is dry-run-only and fail-closed. The runbook is explicitly unexecuted and separates dry-run preparation from separately authorized remote mutation.
- Acceptance grounding: `tests/integration/s4-acceptance.test.ts` exercises the local end-to-end identity/store/order/refund/capability behavior without relying on fake remote state. README and the runbook both distinguish local proof from deployed security state.

## Non-blocking Notes

1. `README.md` still contains an older remote smoke section that references `verification:fixtures` and `verification:remote:smoke` while Phase 8 adds S4-specific scripts and a dedicated S4 runbook. The document already avoids claiming remote deployment, so this is not a blocker, but tightening that section would reduce operator confusion.

2. The populated rehearsal source preserves the assignment row and the assignment event through FK closure, and the SQL migration preserves `order_commands` from the staged table. A future test could assert the pre-existing `command_assign_a` row directly after migration 0010. This would make command-ledger preservation more explicit, but the current implementation and migration SQL are not defective.

## Required Fixes

None for Phase 8 GO.

## Auto-mode Verdict

Auto-approve / GO. The score is above the approval threshold and there are no critical findings.

Status: DONE
Summary: Phase 8 final local artifact is production-review ready for local acceptance and remote-preparation scope. No critical/high blockers found; local rehearsal gate passed in this review and controller Node22 evidence covers the broader suite.
Concerns/Blockers: None blocking. Consider clarifying the older README remote-smoke section and adding a direct command-ledger assertion in the populated rehearsal as follow-up hardening.
