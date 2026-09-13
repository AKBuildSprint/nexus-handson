# Phase 6 refund-decision migration report

## Scope

- Added append-only `migrations/0010-refund-decisions.sql`.
- Added populated migration coverage in `tests/integration/refund-decision-migration.test.ts`.
- Registered migration 0010 and made latest reset FK-safe in `tests/support/catalog-test-env.ts`.

## TDD evidence

- Red: `npx vitest run tests/integration/refund-decision-migration.test.ts` failed after a valid through-0009 setup because `order_refund_requests` lacked `decided_at` and `decided_by_user_id`.
- Green on Node 22.16.0: focused migration suite passed 5/5.
- Migration regression selection passed 24/24.
- `npm run typecheck` passed under Node 22.16.0 before the concurrent decision-test file appeared.
- Owned-file `git diff --check` passed.

## Migration behavior

- Stages all five affected tables; drops assignments, commands and payments before history, then history before Refund requests.
- Restores Refund requests and history before assignments, commands and payments.
- Preserves pending request provenance, contract-1 history/commands, phase-5 assignment fields/results, payment evidence, customer capability rows and private file references.
- Adds pending/terminal decision-shape checks, membership-backed decider identity, terminal immutability, one request per Store/Order, one terminal event across approve/reject, and contract-2 decision command branches.
- Fault injection after late child restore rolls back to the populated schema-9 graph and permits clean retry.

## Broader gate

- Full integration: 172/174 passed. Two failures are in the concurrently edited `tests/integration/order-operations-routes.test.ts` safe-key whitelist because current Phase 6 projection emits `decidedAt`; this file is outside this worker's ownership. Controller notified.
- A final workspace typecheck rerun is blocked by unused declarations in the concurrently created `tests/integration/refund-decisions.test.ts` at lines 4, 73 and 84. No owned file is named by TypeScript.

Status: DONE_WITH_CONCERNS
Summary: Migration slice and owned tests are complete and passing; one outside-scope route-test whitelist needs controller integration.
Concerns/Blockers: Full integration remains 2 tests short until `decidedAt` is added to the route test's allowed safe projection keys; workspace typecheck also awaits cleanup of unused declarations in the concurrent decision test.
