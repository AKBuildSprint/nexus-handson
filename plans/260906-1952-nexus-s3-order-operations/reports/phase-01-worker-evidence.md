# Phase 1 worker evidence (sanitized)

Worker-only. Plan status, git, and Phase 2 were not mutated.

## Mode
- Cook: code path on accepted `phase-01-start.md` plus `--advice`.
- Coordinator later set remaining testing/review to `--auto`.

## Brainstorm contract reused
- Outcome: migrate real S2 Orders to S3 schema without weakening stored-data invariants (DI02/A13).
- Constraints: append-only 0005; never edit 0004; no FK-off pragma; fail-closed 0/2 history; customers unchanged; 15 domain tables.
- Non-goals: payment/delivery/auth; Phase 2+ APIs/UI; remote D1; plan-status; commit.
- Acceptance: S2 seed then 0005; identities preserved; private replay; four statuses; garbage/illegal edges abort; one-line rules; Wrangler late-failure rollback then retry.

## Changed files
- Create: `migrations/0005-order-operations.sql`
- Create: `tests/integration/s3-order-migration.test.ts`
- Modify: `tests/support/catalog-test-env.ts`
- Modify: `src/catalog/slug.ts` (`stableId` prefixes `cmd` | `refund`)
- Modify: `src/orders/order-write.ts` (history INSERT shape)
- Modify: `tests/integration/migration-constraints.test.ts`
- Modify: `tests/integration/orders-persistence.test.ts`
- Temporary: `scripts/verification/s3-order-migration-smoke.mjs` (removed after proof below)
- Unchanged: `migrations/0004-orders.sql`
- Out of scope (untouched by this worker): session-1..6-brief.md, `.agentkit/`, `.claude/`, `ORDER_OPERATIONS_PLAN.md`, omp-session HTML

## RED
Command: `npx vitest run tests/integration/s3-order-migration.test.ts tests/integration/orders-persistence.test.ts`

Observed failure before CHECK fix:

- File: `tests/integration/s3-order-migration.test.ts`
- Case: `rejects non-create history with a NULL previous status`
- Assertion: expected reject `/CHECK/`, received resolved `{ success: true }`
- Cause: SQLite CHECK NULL-pass on `previous_status = 'pending_payment'` / `previous_status = status`

Cross-order FK cases and create-history shape already passed on that run.

## GREEN
Command: `npx vitest run tests/integration/s3-order-migration.test.ts tests/integration/migration-constraints.test.ts tests/integration/orders-persistence.test.ts`

- Worker: 3 files, 17 tests passed
- Tester subagent: 3/3 files, 17/17 tests passed, duration 1.06s
- Residual: Miniflare uncaught `SQLITE_CONSTRAINT_FOREIGNKEY` Durable Object reset after the intentional deferred cross-Order command reject. Tests still passed. Kongming: not a Phase 1 blocker on this negative path only.

Fix: `order_history_event_shape` non-create branches now require `previous_status IS NOT NULL`.

## Smoke
Command: `node scripts/verification/s3-order-migration-smoke.mjs`

Isolated temp config + persist dir; S2 apply; seed old-shape rows; late-fail 0005; graph+ledger preserved and 0005 not recorded; retry real 0005.

Sanitized JSON (worker and tester both):

```json
{"ok":true,"failClosed":true,"retry":true,"domainTables":15,"leftoverS3":0,"fkViolations":0,"historySequence":0}
```

Wrangler help confirmed `--local`, `--config`, `--persist-to`, and per-failed-migration rollback. Temporary smoke driver removed after this record.

## Review
- `code-reviewer`: 9.5/10, critical 0, HARD-GATE-NO-SIDE-EFFECTS PASS. Auto-approved (`score >= 9.5` and no critical).
- Warnings: Miniflare FK-reset log; no project-wide lint/type/build.
- Suggestion (not applied): duplicate `order_idempotency` in `resetCatalog`.

## Advice / model evidence
Config: `task.agentModelOverrides.kongming = openai-codex/gpt-5.6-sol:xhigh`; `task.agentAdvisor.kongming = off`. Kongming agent frontmatter `model: @advisor` was not substituted with skill-default Fable.

| Checkpoint | Agent | Routed model | Fallback | Effort | Verdict |
|---|---|---|---|---|---|
| Pre-fix | KongmingPhase1 | openai-codex/gpt-5.6-sol | false | xhigh | NO-GO (CHECK hole + missing adversarial proof) |
| Post-fix | KongmingPostFix | openai-codex/gpt-5.6-sol | false | xhigh | GO for worker completion |

Correction: earlier “same-model counsel” was wrong. Both kongming runs used the configured Sol override, not parent grok-4.6.

## Blockers
None for Phase 1 worker completion. Local Workerd + isolated Wrangler only. Not remote D1.

Next risk (kongming): Phase 2 deferred command-to-history commit-time failure classification and rollback. Unexpected Miniflare reset on a success path would be blocking.
