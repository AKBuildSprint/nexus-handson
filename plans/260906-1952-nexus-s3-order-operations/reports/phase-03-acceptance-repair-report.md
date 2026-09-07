# Phase 3 acceptance repair

Status: local GREEN. Plan/git left to coordinator. No Phase 4/5.

## Brainstorm contract reused
- Outcome: paged Console operations and capability-authorized refunds with coherent, redacted server projections. This repair: genuine overlapping snapshot-coherence proof.
- Constraints: phase-owned files only; real `env.DB`; test-only batch barriers; both legal commit orders; no plan status; no git; preserve `modelRoles` and `task.agentModelOverrides.kongming=openai-codex/gpt-5.6-sol:xhigh`; kongming advisor off.
- Non-goals: UI, other phases, S2 create body limit, remote D1, commit, baseline deletions/untracked files.
- Acceptance: overlapping GET vs write; detail status/history/refund coherent; immutable purchase projection unchanged; prescribed gate + persistence; code-reviewer; post-fix Kongming GO.

## Prior gap
`phase-03-cook-worker-report.md` claimed 47 GREEN but admitted sequential overlap and no post-final-fix Kongming GO. The then-current overlap test:
- allowed either pending or paid on read-first
- never changed refund (always null)
- did not prove both handlers still in-flight at the barrier

Production `readConsoleOrderDetail` already reads base Order/refund JOIN + history in one `D1Database.batch`. No production edit in this repair.

## RED
Prescribed gate after the concurrent overlap rewrite, before the unique-product fix:
```
npx vitest run tests/integration/order-operations.test.ts tests/integration/order-routes.test.ts tests/integration/console-orders.test.ts tests/integration/storefront-cors.test.ts tests/integration/spa-api-routing.test.ts tests/integration/private-order-snapshot.test.ts
```
- 6 files, 46 passed, 1 failed
- Failed: `tests/integration/order-routes.test.ts` `authorizes refunds before reading the body and keeps private denials uniform`
- Assertion: expected 201, received 409 at second `createSimpleProduct()` (same `SIMPLE_CORE` slug in one test)
- Overlap test itself passed
- Persistence not yet run in that failing snapshot

## GREEN
Focused overlap:
```
npx vitest run tests/integration/console-orders.test.ts -t "keeps detail snapshots coherent across an overlapping write"
```
- 1 passed / 8 skipped, exit 0, 758ms

Prescribed gate:
```
npx vitest run tests/integration/order-operations.test.ts tests/integration/order-routes.test.ts tests/integration/console-orders.test.ts tests/integration/storefront-cors.test.ts tests/integration/spa-api-routing.test.ts tests/integration/private-order-snapshot.test.ts
```
- 6 files, 47 passed, exit 0, 1.83s

Affected persistence:
```
npx vitest run tests/integration/orders-persistence.test.ts
```
- 1 file, 5 passed, exit 0, 683ms

Overlap observations: both batches arrive before either settles; read-first GET is paid + `[order_created, mark_paid]` + `refundRequest: null`; write-first GET is paid + `[..., refund_requested]` + pending refund reason; captured pre-race purchase/customer projection equals the overlapping GET (status/history/refund/actions excluded).

## Owned files touched this repair
- `tests/integration/console-orders.test.ts`
- `tests/integration/order-routes.test.ts`

Untouched: session-1..6-brief.md deletions; untracked `.agentkit/`, `.claude/`, `ORDER_OPERATIONS_PLAN.md`, omp-session HTML; production Worker/order sources; plan status; git index.

## Review disposition
- `code-reviewer` first yield: 8/10 NO-GO on incomplete purchase-field assertions. HARD-GATE-NO-SIDE-EFFECTS PASS.
- Coordinator: expand overlap assertions to full captured immutable purchase projection (DI03/A2), then retest.
- `code-reviewer` later IRC correction (pre-expansion): GO 9.5/10, no criticals/warnings; full-projection optional. Recorded; not used to skip the coordinator-directed expansion.
- After expansion: overlap + 47/47 + 5/5 re-GREEN via tester `FinalPhaseGate`.

## Advice
- Spawned kit `kongming`. Advisor off. Config not mutated.
- Observed worker model: `openai-codex/gpt-5.6-sol`. Configured override `openai-codex/gpt-5.6-sol:xhigh`; the `xhigh` suffix was not independently displayed on the worker identity. Fable 5 not observed. Parent session `xai-oauth/grok-4.6`.
- Verdict: GO. Next risk: local Miniflare D1 vs remote D1 transactional semantics; do not split `readConsoleOrderDetail` off the single batch.

## Blockers
None local. Local D1 ≠ remote D1. Plan status and commit not mutated. No other implementation phase started.
