# Phase 5 code review: assigned Order access and atomic assignment

## Verdict

NO-GO for Phase 6 until the assignment same-target race is fixed and covered.

Score: 8.3/10
Critical count: 1
Auto-mode verdict: not approved. The implementation is mostly aligned, but the critical assignment race violates the accepted durable-event/no-op assignment contract.

## Blocking findings

### Critical: concurrent same-target assignment can create duplicate `assigned` events instead of binding the current event

- Files: `packages/orders/src/commands/order-assignment.ts:77-155`, `packages/orders/src/commands/order-assignment.ts:157-184`
- Threat model: two authorized Owners, or one Owner retrying through two workers, assigns the same unassigned or differently-assigned Order to the same active Staff member with different fresh idempotency keys. Both requests read the pre-batch `current` assignment before either batch commits.
- Impact: the second request still enters the “current target differs” path chosen at lines 77-90, inserts a new `assigned` history row at lines 91-108, upserts `order_assignments` to that new event at lines 109-123, and binds its command to that new event at lines 126-155. At actual batch time, the target may already be current because the other assignment committed first, but there is no guard that converts the second command to the existing-event no-op required by the plan. The catch/recovery path at lines 157-184 also does not bind an already-current assignment when no ledger exists; it returns persistence after order/target checks.
- Contract violated: `phase-05-assigned-order-access.md` requires “for a fresh key selecting the already-current assignee, bind the current assignment's existing event ... with no duplicate assignment event or timestamp change,” and says commit ordering must be coherent under assignment versus processing races. This implementation satisfies the sequential no-op case, but not the concurrent same-target case.
- Concrete fix: make the committing path detect “already current assignee” inside the transaction boundary. One acceptable shape is to guard the new history insert with the expected old assignment state, make the command guard fail when the target became current through another event, and in recovery bind the existing current assignment event only after current Owner and target Staff checks plus assignment-event compatibility checks. Add a race test where two fresh keys assign the same Staff concurrently from an initially unassigned Order and assert exactly one `order_history.action='assigned'`, two command rows pointing to the same `result_history_id`, and identical assignment envelopes.

## Non-blocking warnings

### High: generic failed-batch recovery has a remaining post-authorization gap before state classification

- File: `packages/orders/src/persistence/command-store.ts:323-335`
- Detail: `recoverFailedBatch` authorizes at line 323, then reads the raw Store-scoped target at line 332 and may classify `stateConflict()` at line 334 without re-authorizing after that awaited read. Most result-disclosure paths have before-and-after checks, and the tested lost-assignment cases hit the earlier authorization denial. This remaining branch can still expose a 409 state classification if access is lost in the narrow gap after line 323 and before line 334.
- Suggested fix: re-run `authorizeResult` after `readOrderTarget` and before `stateConflict()`/persistence classification, matching the post-read pattern used in successful result reads.

### Medium: browser contract test could not be executed in this local environment

- File: `tests/browser/console-orders-contracts.test.ts`
- Detail: `npx vitest run --config vitest.browser.config.ts tests/browser/console-orders-contracts.test.ts` failed before collection because Playwright Chromium is missing at `/Users/plateau/Library/Caches/ms-playwright/chromium_headless_shell-1234/...`. This is an environment blocker for the browser gate, not an application assertion failure.
- Suggested fix: run the browser contract gate in the controller environment with the installed browser cache, or install the pinned Playwright browser before final sign-off.

## Scope and scout notes

Reviewed the Phase 5 plan and contracts, migration 0009 assignment schema, current Orders package diff, Worker order routes, Console API/result types, assignment integration tests, order command regressions, and browser contract source. Scout checks focused on assignment command data flow, direct command callers, shared result reader, route lookup order, cursor binding, and recovery callbacks.

Changed Order surfaces found by scout:

- `packages/orders/src/order-types.ts` adds `assign` command/result and Staff candidate projection.
- `packages/orders/src/order-validation.ts` adds strict assignment input parsing.
- `packages/orders/src/order-access.ts`, `queries/order-read.ts`, and `transitions/order-transitions.ts` centralize live membership plus current assignment predicates.
- `packages/orders/src/commands/order-assignment.ts` implements assignment outside the generic `runCommandBatch` helper but uses the shared ledger/result tables.
- `packages/orders/src/commands/order-commands.ts` and `persistence/command-store.ts` add replay/bind/recovery authorization checks for existing processing commands.
- `apps/worker/src/console-order-routes.ts`, `console-route-match.ts`, `apps/console/src/api-client.ts`, and `order-ui-types.ts` expose the minimal Phase 5 HTTP and Console parsing seam.

## Acceptance review

- Live membership/assignment at initial processing: mostly met. `prepareCommand` authorizes current Console access before actor evaluation and again before ledger lookup in `packages/orders/src/commands/order-commands.ts:74-101`. `authorizedActor` consumes the current `assignee_user_id` from `readOrderTarget` and central permission policy.
- Replay and result disclosure: mostly met for non-assignment commands. Existing-key replay routes through `authorizedResult` with before/after checks in `packages/orders/src/commands/order-commands.ts:101-119` and `124-149`. Assignment replay uses owner-only before/after checks in `packages/orders/src/commands/order-assignment.ts:67-74`.
- Bind/conflict callback/recovery: mostly met, with the warning above. `bindExistingResult` adds a visibility guard in the same batch and before/after result authorization in `packages/orders/src/persistence/command-store.ts:270-292`. `runCommandBatch` appends a visibility guard and post-result checks at lines 350-374; callbacks in `order-commands.ts` reauthorize after awaited effect reads before binding.
- Batch commit and post-result: mostly met for processing commands. The appended guard turns lost Staff assignment into a rollback, and successful commit response is concealed if assignment is removed after commit. Covered by `tests/integration/order-assignment.test.ts:277-338`.
- Atomic assignment replay/no-op: sequential behavior is covered, but concurrent same-target behavior is not safe. This is the critical blocker.
- List/detail/summary/cursor concealment: met. Staff visibility uses a current `order_assignments` subquery in `packages/orders/src/queries/order-read.ts:328-355`; detail applies `consoleVisibilitySql` to header, lines, refunds, history, and payment queries and rechecks current membership/visibility at lines 418-486. Cursors bind version, Store, user ID, role, seek row, normalized filters, and limit at lines 236-285 and 600-602.
- Worker route lookup/order: met. Detail and mutations conceal target lookup before contract checks in `apps/worker/src/console-order-routes.ts:159-205`, and the assignment endpoint is not public.
- Unchanged non-assignment/Customer JSON: mostly met. The shared result reader only adds `assignment` for `action === 'assign'` in `packages/orders/src/persistence/command-store.ts:130-187`. Console assignment parsing is action-discriminated in `apps/console/src/api-client.ts:139-152`; existing transition API methods still return the existing command result union.
- Schema/indexes: met for the reviewed phase. Migration 0009 adds `order_assignments`, assignment history/command CHECK branches, same-Store membership FKs, immutable assignment-event triggers, and `order_assignments_assignee_order_idx` at `migrations/0009-store-memberships.sql:225-246`. The sparse query performance test asserts that index in `tests/integration/order-assignment-performance.test.ts:96-103`.
- Public contract/security: no public provisioning or assignment route found in the Phase 5 order surface. Candidate read returns only `{userId,name}` and requires active owner membership in `packages/orders/src/commands/order-assignment.ts:39-53`.

## Verification run

- `node -v`: `v24.20.0`
- `npx vitest run tests/integration/order-assignment.test.ts tests/integration/order-assignment-performance.test.ts tests/integration/order-operations-routes.test.ts tests/integration/console-orders.test.ts tests/integration/orders-persistence.test.ts`: pass, 5 files / 34 tests
- `npm run typecheck`: pass (`tsc --noEmit`)
- `npx vitest run --config vitest.browser.config.ts tests/browser/console-orders-contracts.test.ts`: blocked before test collection by missing Playwright Chromium executable

## Recommended actions

1. Fix the assignment same-target race at the D1 batch/recovery boundary and add the concurrent fresh-key same-target test described above.
2. Add the extra post-authorization check in `recoverFailedBatch` after `readOrderTarget` and cover the narrow access-loss gap if feasible with the existing proxy helpers.
3. Re-run the Phase 5 gate under Node 22, plus the browser contract gate in an environment with Playwright browsers installed.

Status: DONE_WITH_CONCERNS
Summary: Phase 5 is close but not ready for Phase 6 because concurrent same-target assignment can create a second durable assignment event instead of binding the already-current event. Focused integration tests and typecheck passed locally on Node v24.20.0; browser contract execution was blocked by missing Playwright Chromium.
Concerns/Blockers: Critical assignment no-op race in `packages/orders/src/commands/order-assignment.ts:77-184`; high warning on `recoverFailedBatch` post-authorization gap in `packages/orders/src/persistence/command-store.ts:323-335`.
