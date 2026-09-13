# Red-team failure review: Nexus S4 identity and Store isolation

Scope: `plans/260911-1753-nexus-s4-identity-store-isolation/{plan.md,contracts.md,acceptance.md,phase-*.md}` plus traced current source for migrations, command batches, route surfaces, Wrangler config and rollout docs.

Mode: PLAN review only. No installs, lint, typecheck, build or tests were run.

Current verdict: **DONE_WITH_CONCERNS**. The updated plan now preserves the Phase 5 assignment child when 0010 rebuilds Refund/history dependencies, and it no longer contains the prior `pending`-after-terminal ledger guard issue. Remaining findings are rollout/security proof gaps, not implementation defects already present in source.

## Findings

### High - Origin contract still has an unsafe absent-Origin ambiguity

Phase/section: `contracts.md` Origins and sessions; Phase 3 exact-Origin gate.

Concrete failure: the canonical contract says cookie-authenticated mutations must require an exact configured `Origin`, then immediately says absence is allowed for supported operator/test clients. Phase 3 is stricter and says absent Origin is rejected. That conflict lets an implementer follow the canonical `contracts.md` escape hatch and accept cookie-authenticated unsafe Console mutations with no Origin/Sec-Fetch proof. Current Console private POSTs are real mutation surfaces (`payments/manual`, `fulfill`, `cancel`, `refund-requests`), so this becomes a CSRF/origin-bypass acceptance hole once S4 adds cookies.

Evidence:

- `contracts.md:38` says reject absent Origin but also says absence is allowed.
- `phase-03-authenticated-context.md:93` requires rejecting absent Origin.
- `apps/worker/src/console-order-routes.ts:169-247` shows existing unsafe Console mutation routes that will become cookie-authenticated S4 routes.

Minimal fix: remove the absent-Origin allowance from the Console mutation contract. If operator tooling needs non-browser access, keep it outside cookie-authenticated Console routes, e.g. the Phase 8 `getPlatformProxy` transport, and give it a separate non-cookie authentication/approval rule. Add an explicit acceptance row for absent Origin + absent Fetch Metadata on every unsafe Console method.

### High - Raw migration proof can pass against the wrong isolated D1 state

Phase/section: Phase 8 operator transport and raw migration rehearsal.

Concrete failure: Phase 8 says the raw migration runner uses Wrangler's `v3` suffix convention with an isolated persistence path, while helper tests use the in-memory/test environment whose splitter strips PRAGMAs. If those two paths are not coupled by a sentinel, the plan can produce two independent green checks: helper migration tests preserve seeded data, and raw Wrangler migration runs PRAGMAs against an empty or different local database. That misses exactly the class of populated-data/FK failures Phase 8 is meant to catch.

Evidence:

- `phase-08-migration-rehearsal-and-rollout.md:76-78` defines the `getPlatformProxy`/raw runner path but does not require cross-verifying that helper-seeded data and raw runner state are the same database.
- `tests/support/catalog-test-env.ts:60-70` strips all `PRAGMA` statements from helper migrations.
- `wrangler.jsonc:26-31` defines the real D1 binding whose local persisted state must be targeted by the raw runner.

Minimal fix: add a Phase 8 gate that plants a protected sentinel graph through one path and reads it through the other before and after applying raw migrations. The evidence should include the exact `persist-to` directory, the resolved D1 local sqlite path, `d1_migrations` entries, a sentinel Order/history/payment/assignment/refund row, and `PRAGMA foreign_key_check` output from the same database.

### Medium - Current-state docs/AGENTS can be updated too early for remote truth

Phase/section: Phase 8 documentation reconciliation.

Concrete failure: Phase 8 allows README/design/AGENTS current-state claims to be reconciled after observed local S4 proof. But the current public Workers deployment is explicitly anonymous, and Phase 8 remote execution is unexecuted unless separately authorized. If AGENTS/README are rewritten after local proof but before remote cutover/smoke, future agents and operators can treat public Console Order actions as authenticated Owner access while the deployed surface is still anonymous.

Evidence:

- `phase-08-migration-rehearsal-and-rollout.md:61` says docs update after local implementation gates.
- `phase-08-migration-rehearsal-and-rollout.md:107-110` includes `README.md`, `docs/design-guidelines.md`, and `AGENTS.md` as update targets.
- `phase-08-migration-rehearsal-and-rollout.md:207-210` makes local gates and unexecuted remote runbook separate success criteria.
- `AGENTS.md:27`, `README.md:33`, and `README.md:193-197` currently warn that Console actions/public workers.dev surfaces are anonymous demos, not authenticated Owner access.

Minimal fix: split local-S4 documentation from deployed-current-state documentation. Keep public/remote anonymous warnings until an authorized remote cutover and S4 authenticated smoke pass. If local docs must change earlier, qualify them as local implementation state only and leave AGENTS rules that affect agent behavior fail-closed for remote claims.

### Low - Plan red-team gate points at a missing report

Phase/section: `plan.md` Red Team Review.

Concrete failure: the plan links to `./reports/red-team-260912-0224.md` and says the review is pending/reconcile-before-handoff, but that file is not present in the plan directory. A later handoff can either follow a dead link or treat review status as reconciled by implication while the actual independent failure-mode report lives at a different path.

Evidence:

- `plan.md:65-67` links `./reports/red-team-260912-0224.md` and says it must be reconciled before handoff.
- File inventory during this review found existing reports `planner-ui-rollout-260912-0224.md`, `research-auth-260912-0224.md`, `research-domain-260912-0224.md`, and `validation-260912-0224.md`; `reports/red-team-260912-0224.md` was absent.

Minimal fix: update the red-team line to point at the actual review artifact(s), including this report if accepted, and replace the stale "pending while draft is being refined" text with the current adjudication state.

## Scout notes

- The requested recent fix is present: `contracts.md:65-67` and `phase-06-refund-decisions.md:55` require 0010 to stage/drop/restore current assignments because assignment events reference rebuilt history.
- The prior `pending`-after-terminal refund ledger failure is fixed in `contracts.md:54-57` and `phase-06-refund-decisions.md:57-63`.
- The current source still has anonymous bootstrap Console routes (`apps/worker/src/index.ts:22-29`, `apps/worker/src/console-order-routes.ts:38-39`), which is expected baseline, not S4 implementation evidence.

Status: DONE_WITH_CONCERNS
Summary: Reviewed the current plan corpus and traced the relevant migration, command, route, D1/R2 and rollout surfaces. The main remaining blockers are a contradictory absent-Origin rule, a raw migration proof gap that can target the wrong D1 state, and documentation timing that can overclaim remote auth.
Concerns/Blockers: None blocking this review report. Block implementation handoff until the High findings are adjudicated.
