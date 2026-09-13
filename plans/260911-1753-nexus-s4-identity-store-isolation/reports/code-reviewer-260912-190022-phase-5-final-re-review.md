# Phase 5 final re-review: assigned Order access and atomic assignment

## Verdict

GO for Phase 6.

Score: 9.6/10
Critical count: 0
Auto-mode verdict: approved. The prior critical same-target fresh-key assignment race and recovery authorization gap are fixed in the current artifact.

## Critical findings

None.

## Prior blocker re-checks

### Fixed: concurrent same-target fresh-key assignment no longer creates duplicate assignment events

- Files: `packages/orders/src/commands/order-assignment.ts:77-203`, `tests/integration/order-assignment.test.ts:508-535`
- Evidence: the new batch-time history insert guard at `order-assignment.ts:105-110` refuses to create a new `assigned` event if the requested Staff member already became the current assignee. The command insert remains tied to the exact `historyId` selected for this attempt at `order-assignment.ts:132-160`, so that failed batch cannot silently bind to the wrong newly generated event. Recovery then reads the current assignment at `order-assignment.ts:190-197`; when another writer already assigned the same Staff and the current event differs from this attempt's generated `historyId`, it recursively re-enters `assignOrder`, reaches the sequential no-op path, and binds the fresh key to the current durable event.
- Test coverage: `tests/integration/order-assignment.test.ts:508-535` forces two fresh-key assignment calls to reach `database.batch` together and asserts both results share one `assignment.eventId`, exactly one `assigned` history row, and two assignment command rows.
- Assessment: this closes the prior duplicate-event bug under the intended D1 batch boundary. The recursive recovery is acceptable for Phase 5; a loop would be slightly clearer but is not required for correctness in the covered race.

### Fixed: failed-batch recovery re-authorizes after raw target read

- File: `packages/orders/src/persistence/command-store.ts:322-348`
- Evidence: `recoverFailedBatch` still authorizes before ledger/result recovery at `command-store.ts:335`, and now re-authorizes immediately after `readOrderTarget` at `command-store.ts:344-345` before `notFound`, `stateConflict`, or persistence classification. This closes the prior narrow leak where access could be lost after the first authorization but before state-based classification.

## Additional review notes

- Shared command result compatibility improved: `readCommandResult` now verifies action/history compatibility before returning any command result in `packages/orders/src/persistence/command-store.ts:167-176`; the assignment branch remains action-discriminated and only emits `assignment` for `action === 'assign'` at lines 177-189.
- List/detail/summary/cursor concealment remains aligned with Phase 5. Staff visibility is still based on current assignment in `packages/orders/src/queries/order-read.ts`, and detail uses current visibility across header, lines, refund, history, and payment reads with a post-read visibility recheck.
- Worker routes still perform concealed target lookup before contract/body checks for detail and mutations, and `POST /api/console/orders/:reference/assignment` remains a private Console route only.
- Migration 0009 continues to provide the needed assignment schema, composite FKs, action CHECK branches, immutable assignment event triggers, and assignee index. No migration rewrite was observed in this re-review.

## Non-blocking suggestions

1. Consider replacing the recursive `return assignOrder(input)` recovery at `packages/orders/src/commands/order-assignment.ts:195-196` with a small bounded loop or helper for maintainability. The current implementation is safe for the tested same-target race, but a loop would make repeated contention behavior easier to reason about.
2. Keep the same-target concurrent assignment test in the permanent gate; it is the regression test that proves the previous critical contract breach is closed.

## Verification run

Local verification in this review environment:

- `node -v`: `v24.20.0`
- `npx vitest run tests/integration/order-assignment.test.ts tests/integration/order-assignment-performance.test.ts tests/integration/order-commands.test.ts tests/integration/order-operations-routes.test.ts tests/integration/console-orders.test.ts tests/integration/orders-persistence.test.ts tests/integration/order-routes.test.ts`: pass, 7 files / 61 tests
- `npm run typecheck`: pass (`tsc --noEmit`)

Controller-provided evidence also reports Node22 focused gate, broader integration selection, typecheck, and diff-check passing.

Status: DONE
Summary: Final Phase 5 re-review is complete. The prior critical duplicate-event race is fixed with a batch-time already-current guard plus recovery no-op binding, and the recovery authorization gap is fixed with a post-target-read authorization check; GO for Phase 6.
Concerns/Blockers: None blocking. Minor maintainability suggestion: replace recursive same-target recovery with a bounded loop/helper if this path becomes more complex.
