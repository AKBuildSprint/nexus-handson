# Phase 6 code review: terminal Refund decisions

## Verdict

GO for Phase 7.

Score: 9.7/10
Critical count: 0
Auto-mode verdict: approved.

## Critical findings

None.

## Findings and review evidence

### Competing decisions and poststate ledger guard: pass

- Files: `packages/orders/src/commands/order-commands.ts:776-954`, `tests/integration/refund-decisions.test.ts:128-159`
- Evidence: `decideRefund` creates one action-specific history event ID, command ID, and `decidedAt` at `order-commands.ts:812-818`. The batch inserts a terminal history event only for an exact same-Store pending request and active Owner at `order-commands.ts:854-878`, updates the request only when that exact event exists at `order-commands.ts:879-901`, and inserts the command ledger through an unconditional `VALUES (CASE WHEN EXISTS (...))` poststate guard tied to the terminal request status, exact event, actor, timestamp, current Owner, and paid/fulfilled Order state at `order-commands.ts:902-943`.
- Test coverage: the approve/reject race test asserts one 200, one 409, one terminal history event, one decision command, unchanged Order status, and unchanged payment evidence in `refund-decisions.test.ts:128-159`.

### Current Owner authorization across awaits/replay/recovery: pass

- Files: `packages/orders/src/commands/order-commands.ts:47-50`, `packages/orders/src/commands/order-commands.ts:67-154`, `packages/orders/src/commands/order-commands.ts:776-954`, `packages/orders/src/persistence/command-store.ts:307-388`
- Evidence: decision actions map to `refund:decide` at `order-commands.ts:47-50`; `prepareCommand` checks current access before actor/hash derivation, before ledger lookup, and before existing-key replay at `order-commands.ts:81-126`. `authorizedResult` performs before-and-after checks around `readCommandResult` at `order-commands.ts:131-154`. Decision command lookup checks Owner access before and after the request lookup at `order-commands.ts:780-798`, while conflict recovery re-authorizes around ledger/request reads at `order-commands.ts:829-851`. Generic recovery keeps the Phase 5 post-target-read authorization at `command-store.ts:322-348`.
- Test coverage: revoked Owner replay and post-commit concealment are covered in `refund-decisions.test.ts:224-248` and `340-370`; pre-batch revocation rollback is covered at `refund-decisions.test.ts:312-338`.

### Request final occupancy and submission semantics: pass

- Files: `packages/orders/src/commands/order-commands.ts:636-688`, `packages/orders/src/commands/order-commands.ts:808-810`, `tests/integration/refund-decisions.test.ts:161-222`
- Evidence: Refund submission now reads any existing request through `readRefundRequest`, not only open requests, and binds a fresh submission key to the existing request result after current authorization at `order-commands.ts:636-649` and `673-688`. Decision commands reject terminal requests before a new decision batch at `order-commands.ts:808-810`.
- Test coverage: same-key replay, fresh same/opposite terminal decision rejection, terminal Customer/Console resubmission, and single request occupancy are covered at `refund-decisions.test.ts:161-222`.

### Exact history/result compatibility: pass

- Files: `packages/orders/src/persistence/command-store.ts:120-210`, `tests/integration/refund-decision-migration.test.ts:250-322`, `tests/integration/order-assignment.test.ts:491-506`
- Evidence: command result reading validates that each command action points to the expected history action before returning an envelope at `command-store.ts:167-187`. Refund command results project actual persisted request status and decision time through `refundProjection` at `command-store.ts:120-137`.
- Test coverage: migration constraints admit decision command branches and reject malformed result shape in `refund-decision-migration.test.ts:250-322`; the shared result reader rejects action/history mismatches in `order-assignment.test.ts:491-506`.

### Customer redaction and public contract: pass

- Files: `packages/orders/src/queries/order-read.ts:179-187`, `packages/orders/src/queries/order-read.ts:420-439`, `packages/orders/src/queries/order-read.ts:451-525`, `apps/storefront/src/storefront-view-types.ts:63-70`, `tests/integration/refund-decisions.test.ts:190-222`
- Evidence: Customer projection returns only safe Refund fields via `refundFromRow`: id, status, reason, createdAt, and decidedAt. Console detail separately adds `decidedByUserId` at `order-read.ts:520-524`. Customer projection does not include payment evidence, assignment, history, or deciding identity.
- Test coverage: `refund-decisions.test.ts:190-222` asserts exact Customer refund keys and verifies no `decidedByUserId` or payment data leaks.

### Migration five-table closure: pass

- Files: `migrations/0010-refund-decisions.sql:1-381`, `tests/integration/refund-decision-migration.test.ts:214-360`, `plans/260911-1753-nexus-s4-identity-store-isolation/reports/worker-260912-1911-refund-decision-migration.md`
- Evidence: migration 0010 stages Refund requests, history, commands, payments, and assignments at `0010-refund-decisions.sql:1-5`, drops children before parents at `0010-refund-decisions.sql:7-11`, recreates Refund requests/history/assignments/commands/payments with the required FKs and indexes, and restores child data after parent data. It adds terminal status shape, one request per Store/Order, terminal decision-event uniqueness, decision command branches, and result-shape checks at `0010-refund-decisions.sql:13-35`, `119-130`, and `291-324`.
- Test coverage: populated migration preservation, FK checks, index preservation, terminal invariants, rollback and retry, and latest helper registration are covered in `refund-decision-migration.test.ts:214-360`. The worker migration report records the original migration Red and the broader migration evidence.

## Non-blocking notes

1. `packages/orders/src/commands/order-commands.ts:829-851` uses a decision-specific `onConflictReplay` that returns `stateConflict` for a terminal request when this command did not win. That matches the Phase 6 contract. Keep this branch covered because it is the main guard against accidentally binding a fresh losing decision to the winner.
2. Customer projection queries include `decided_by_user_id` in `readCustomerOrderById` at `packages/orders/src/queries/order-read.ts:429-430`, but the shared `refundFromRow` used there omits it. This is safe as implemented; avoid reusing the raw row in Customer responses in future UI work.

## Verification run

Local verification in this review environment:

- `node -v`: `v24.20.0`
- `npx vitest run tests/integration/refund-decision-migration.test.ts tests/integration/refund-decisions.test.ts tests/integration/order-brief-migration.test.ts tests/integration/order-operations-migration.test.ts tests/integration/order-commands.test.ts tests/integration/private-order-snapshot.test.ts tests/integration/order-operations-routes.test.ts tests/integration/order-routes.test.ts tests/integration/orders-persistence.test.ts`: pass, 9 files / 73 tests
- `npx vitest run --config vitest.browser.config.ts tests/browser/console-orders-contracts.test.ts`: pass, 1 file / 20 tests
- `npm run typecheck`: pass (`tsc --noEmit`)
- `git diff --check`: pass

Controller-provided evidence reports the requested Node22 gates: behavioral Red 404 captured, target 9/72 pass, full 27/182 pass, browser 39/39, typecheck and diff-check pass.

Status: DONE
Summary: Phase 6 final code review is complete. No critical findings; terminal Refund decisions, finality, replay/recovery authorization, Customer redaction, and migration 0010 five-table closure align with the accepted contract. GO for Phase 7.
Concerns/Blockers: None.
