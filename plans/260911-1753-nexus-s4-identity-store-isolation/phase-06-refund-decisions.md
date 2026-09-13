---
phase: 6
title: "Persist final Refund decisions and safe projections"
status: pending
priority: P1
effort: 2d
dependencies: [5]
---

# Phase 6: Persist final Refund decisions and safe projections

## Goal

Add one atomic Owner-only `approve`/`reject` decision to each pending Refund Request, preserve finality and idempotency, and expose only the safe status to Customers without moving money or changing the Order.

## Context Links

- [Plan](./plan.md)
- [Canonical implementation contracts](./contracts.md)
- [Exact Refund callers, migration closure and test inventory](./reports/research-domain-260912-0224.md#phase-6-terminal-decision-migration-and-projection)
- `migrations/0006-order-brief-contract.sql:160-262`
- `migrations/0007-manual-payments.sql`
- `packages/orders/src/commands/order-commands.ts:510-668`
- `packages/orders/src/queries/order-read.ts:47-52,165-172,335-445`
- `apps/storefront/src/storefront-view-types.ts:63-77`
- Scenarios S4-10, S4-11, S4-18–S4-20, S4-26, S4-40, S4-41, S4-43–S4-47

## Overview

- **Priority:** P1.
- **Current status:** Pending.
- **Lifecycle:** exactly one request per Order; `pending -> approved|rejected`; terminal forever in S4.
- **Money boundary:** approval records authorization for S5 execution only. Order remains `paid|fulfilled`; payment evidence remains unchanged.

## Requirements

### Functional

- Add `approve_refund` and `reject_refund` commands for active same-Store Owner only.
- Persist terminal status, `decided_at` and real `decided_by_user_id`; link the exact winning event through existing history `refund_request_id`, without a cyclic Refund-to-history FK or duplicate event column.
- Enforce one request per Store+Order across all statuses with a non-partial unique constraint.
- Write exactly one decision history event and one command ledger result atomically.
- Identical same-command retry returns recorded result only while caller remains authorized.
- Conflicting decision/key intent fails and never flips the winner.
- Customer projection retains safe request `id`, `reason`, `createdAt` and adds actual terminal status/decision time; no deciding identity, assignment, internal history or payment evidence.

### Non-functional

- Preserve all existing pending requests, IDs, request actors, timestamps, history, commands, payments, and Order states.
- Rejected and approved requests never reopen Customer or Console submission.
- No S5 queue, reversal provider, payout, `refunded` Order status, or fabricated payment evidence.

## Architecture

Create append-only migration 0010 using the repository's staged-table rebuild pattern. Its populated closure is Refund requests, Order history, Order commands, **payments and current assignments**: `0007-manual-payments.sql:27-29` makes payments a history child, and migration 0009's current-assignment event FK adds assignments as another child. Stage all five; drop commands/payments/assignments before history and refunds; recreate parents before children, restore exact rows and all dropped indexes. Preserve phase 2/5 assignment fields/actions, contract-1/2 legacy provenance and payment evidence. New decision columns require null pending actor/time and non-null terminal actor/time; the winning event is linked from history to the request. Do not combine this migration with remote provisioning.

Decision protocol in one D1 batch, using one generated event ID and decision time:

1. Conditional history INSERT joins exact same-Store Order/request in pending prestate, current active Owner, and Order `paid|fulfilled`. A unique partial terminal-event index spans both `refund_approved` and `refund_rejected` on `(store_id, order_id, refund_request_id)` so two actions cannot each win.
2. Conditional Refund UPDATE requires pending prestate plus this exact new event/request/actor/action and current Owner. Persist terminal status, deciding user and time; history already links the event to this request. Preserve requester fields and Order/payment records.
3. Unconditional command-ledger INSERT uses a non-null `CASE` over terminal **poststate**, the exact new event, same actor/time, current Owner and unchanged valid Order state/payment evidence. Do not check `pending` after step 2. A missing predicate forces rollback; an empty conditional INSERT would not.

Replay authorizes current resource access at every initial/post-batch/recovery read. Identical same-key action/body/actor returns the recorded result. A fresh decision key against any terminal request gets 409 state conflict, including the same decision; opposite intent never binds to the winner. Submission is separate: Customer/Console requests with a fresh key return the one existing request in its current status without changing reason/requester/time or adding a request event. Changed body under an already-bound key conflicts.

## File Inventory

| File | Action | Rough change | Test impact |
|---|---|---:|---|
| `/Users/plateau/Project/nexus-handson/migrations/0010-refund-decisions.sql` | Create | 260–380 lines | Populated table rebuild/finality |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/order-types.ts` | Modify | 40–80 lines | Terminal status/action/projection |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/order-validation.ts` | Modify | 20–40 lines | Decision body/key validation |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/transitions/order-transitions.ts` | Modify | 30–60 lines | Pending-only Owner decision eligibility |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/persistence/command-store.ts` | Modify | 50–90 lines | Terminal result/recovery reads |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/commands/order-commands.ts` | Modify | 180–260 lines | Approve/reject batch and request finality |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/queries/order-read.ts` | Modify | 80–130 lines | Console and Customer projections/history labels |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/console-order-routes.ts` | Modify | 50–80 lines | Decision endpoints |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/storefront-order-routes.ts` | Modify | 15–30 lines | Safe terminal projection/retry response |
| `/Users/plateau/Project/nexus-handson/tests/integration/refund-decision-migration.test.ts` | Create | 240–340 lines | Populated migration preservation |
| `/Users/plateau/Project/nexus-handson/tests/integration/refund-decisions.test.ts` | Create | 300–420 lines | Race/idempotency/finality/privacy |
| `/Users/plateau/Project/nexus-handson/tests/support/catalog-test-env.ts` | Modify | Migration registry/reset | Add 0010; preserve historical-through helpers and FK-safe reset |
| `/Users/plateau/Project/nexus-handson/tests/integration/order-brief-migration.test.ts` | Verify/adapt fixture seam | Existing 8 cases | Populated legacy and schema7 preservation |
| `/Users/plateau/Project/nexus-handson/tests/integration/order-commands.test.ts` | Modify/extend | Existing 18 cases | Final request occupancy and recovery |
| `/Users/plateau/Project/nexus-handson/tests/integration/order-operations-routes.test.ts` | Modify/extend | Existing 10 cases | HTTP decision route support and privacy |
| `/Users/plateau/Project/nexus-handson/tests/integration/order-routes.test.ts` | Verify/extend | Existing 4 cases | Customer capability and GET continuity |
| `/Users/plateau/Project/nexus-handson/tests/integration/orders-persistence.test.ts` | Verify/extend | Existing 12 cases | Create replay after terminal Refund and snapshots |
| `/Users/plateau/Project/nexus-handson/apps/storefront/src/storefront-view-types.ts` | Coordinate with phase 7 | Additive type contract | Safe terminal statuses/time |
| `/Users/plateau/Project/nexus-handson/apps/console/src/orders/order-ui-types.ts` | Coordinate with phase 7 | Additive type contract | Terminal Refund/actions/history |

### Interface checklist

- [x] `RefundRequestProjection` is not widened with Console-only fields consumed by Customers. Explicit Console detail and Customer projections preserve their distinct contracts.
- [x] `refundFromRow`, list status projection, `readCustomerOrderById`, `readConsoleOrderByReference`, and evaluator-derived `allowedActions` use actual persisted status. Pending queue filter/summary may stay explicitly pending; do not label a terminal detail as pending.
- [x] `refundProjection`/`readCommandResult` in command-store return actual status/time and exact decision result; replace `readOpenRefund` with all-status occupancy for request creation and recovery.
- [x] `createRefundRequest` initial existing-result branch, INSERT absence guard, and conflict callback all honor permanent occupancy. Customer GET and submission replay both retain safe projections.
- [x] Named approve/reject commands validate exact `:requestId` and `:reference`, empty JSON body, command key and contract header at proposed `/api/console/orders/:reference/refund-requests/:requestId/approve|reject`; follow contracts.md concealed lookup/permission/CSRF/error ordering.
- [x] Every `prepareCommand`, ledger/result read, `bindExistingResult`, conflict callback, failed-batch recovery and post-success response retains phase 5 current-authorization rules.
- [x] Migration helper imports/list, `CatalogMigrationThrough`, latest-schema default and reset drop order include new tables without losing historical-through fixtures. Drop current assignments before history and memberships; commands/payments also precede history. Its splitter removes PRAGMAs, so a raw Wrangler rehearsal is also required.
- [x] Phase 7 coordinates Storefront `api-client.ts` and `storefront-view-types.ts`, Console `order-ui-types.ts`, API client, `orders-screen.tsx` and `order-detail-screen.tsx` pending-only branches. Keep phase 6 public types buildable and do not claim UI completion here.

## Dependency Map

`Phase 5 current Owner authorization -> migration 0010 terminal state -> decision commands/projections -> Phase 7 UI -> Phase 8 populated rehearsal`. S5 later consumes `approved`; S5 is not implemented here.

## Test Scenario Matrix

| Priority | Scenarios | Boundary | Expected proof |
|---|---|---|---|
| Critical | S4-10, S4-26 | concurrent D1 batch/fault injection | One decision, one event, one ledger or none |
| Critical | S4-41, S4-46 | Customer/Console response | Safe status; no identity/money claim; Order/payment unchanged |
| Critical | S4-18 | command/replay lifecycle | Current authorization before replay disclosure |
| High | S4-11, S4-19, S4-20 | command/replay lifecycle | Identical retry only; finality; invalid transitions no effect |
| High | S4-40, S4-43, S4-47 | migration/projection | Old pending rows work; actor/evidence gaps remain truthful |

## Tests Before

Use Node 22 and record its exact version; install lockfile dependencies with `npm ci` before collection. Planning's discovery failed before tests because packages are missing. Static baseline selection totals 59 source-declared cases: `order-brief-migration` 8, `order-operations-migration` 4, `order-commands` 18, `private-order-snapshot` 3, `order-operations-routes` 10, `order-routes` 4, `orders-persistence` 12. They overlap earlier phase regressions and are not passing totals. New Refund test files are absent today.

Characterize unchanged behavior, compile the new tests with valid pre-migration fixtures/signatures, and record the required failing behavioral assertion. A deliberate assertion that the new schema contract is absent can establish Red; an unexpected missing-table/import/setup exception cannot.

1. Add migration test seeded through migrations 1–9 with pending Refunds, v1/bootstrap actors, real phase 5 user assignment events/results, Customer capability, payments, legacy paid Orders without payments, and referenced history/commands. Record protected rows, indexes/FKs, snapshots and R2 reference manifests before migration.
2. Add two-session approve/reject race using distinct idempotency keys; assert exactly one status/event/ledger and unchanged Order/payment rows.
3. Add lost-response identical retry, changed intent/actor under the same key, opposite decision, fresh-key same decision after terminal state, absent request, invalid Order state, and Customer/Console resubmission after both rejection and approval.
4. Whitelist Customer GET and command-retry JSON keys and compare to Console output to prove privacy, not merely copy. Keep existing safe request fields.
5. Inject real D1 faults after decision history, Refund UPDATE and ledger. Compare exact business/history/commands/payment snapshots to baseline, then retry the same command. Force membership revocation before batch and during each replay/recovery branch; assert concealed response and no denial ledger.
6. Inject migration faults after staging, during parent/child rebuild and late restore. Prove rollback and retry from the correct checkpoint, with assignment/payment rows intact. Also execute the raw migration via the actual Wrangler runner against isolated local state as specified in phase 8; do not reset the user's `.wrangler` state.

## Implementation Steps

1. Focused-scout current migration CHECK/FK dependency graph and command result readers before authoring 0010.
2. Write migration 0010 with the five-table dependency closure above and exact before/after row/reference/index accounting. Retain phase 5 assignment event/result schema and restore current assignment event FKs/indexes. Replace partial `one_open` with unconditional unique `(store_id, order_id)` and add the combined terminal-decision event uniqueness invariant. Restore payment constraints/indexes without changing evidence.
3. Extend Refund status/projections with `approved|rejected`, `decidedAt`, and Console-only decider attribution. Add `refund_approved|refund_rejected` history actions and decision command actions.
4. Update Refund request creation and every recovery lookup to treat any existing request as final occupancy. Authorized fresh-key submissions return that request's current terminal/pending state without a new request event; same-key changed intent conflicts. New decision keys on terminal requests always conflict.
5. Implement one internal decision function parameterized by explicit action/status only if that removes duplication without weakening distinct idempotency hashes and endpoint contracts.
6. Implement the prestate/event/terminal-poststate protocol above. Use pending only before UPDATE; make the final ledger assertion unconditional and tied to this event/actor/time. Enforce current authorization again for every result disclosure and recovery path.
7. Update Customer projection with actual status/decision time while retaining safe request identity/reason/creation time. Update separate Console projection with decider attribution, allowed decision actions and truthful actor labels.
8. Keep Order status, payments, delivery access, and R2 references untouched for both decisions.

## Refactor

Consolidate shared approve/reject batch construction, but keep named public commands/endpoints and action-specific hashes. Delete pending-only type branches and partial-index assumptions from all current callers. Do not add execution placeholders or fake payout state.

## Tests After

- Verify domain/API types and parsers accept terminal statuses; pass the explicit pending-only UI inventory to phase 7, which proves rendered behavior.
- Verify final decision survives Owner rename/membership revocation as durable actor ID and timestamp, while replay disclosure still requires current authority.
- Verify Customer output omits actor identity, internal history, notes, and payment evidence.
- Verify approval on `legacy_unrecorded` records no invented payment source/reference.

## Todo

- [x] Write failing migration, race, retry, finality, and privacy tests.
- [x] Add append-only migration 0010 and preserve populated references.
- [x] Extend Refund/history/command contracts.
- [x] Implement atomic Owner-only approve/reject.
- [x] Enforce one request per Order across all statuses.
- [x] Update safe Customer and full Console projections without money movement.

## Success Criteria

Competing decisions yield one durable winner and one audit event. Same intent retries safely; conflicting intent fails. Approved/rejected requests are final. Customer sees only safe truth. Order, payment, snapshots, and file retention remain unchanged.

## Regression Gate

After Node 22 plus `npm ci`, collect valid fixtures, capture behavioral Red in the new migration/decision tests, then Green and refactor reruns. The first command names proposed files absent today; missing-file or setup failure does not count as Red.

```sh
npx vitest run tests/integration/refund-decision-migration.test.ts tests/integration/refund-decisions.test.ts
npx vitest run tests/integration/order-brief-migration.test.ts tests/integration/order-operations-migration.test.ts tests/integration/order-commands.test.ts tests/integration/private-order-snapshot.test.ts tests/integration/order-operations-routes.test.ts tests/integration/order-routes.test.ts tests/integration/orders-persistence.test.ts
npm run typecheck
npm run test:integration
```

The second selection exists today; the final broader integration gate is required after migration/fixture changes. Raw isolated Wrangler migration evidence remains a separate prerequisite because the helper strips PRAGMAs. Do not infer its pass from the Worker/D1 tests.

## Risk Assessment

- **SQLite rebuild breaks references:** signal is count/hash/FK mismatch. Response: stop before application; correct new migration and rerun from populated pre-S4 fixture.
- **Double decision:** signal is >1 terminal event or winner overwrite. Response: block release; enforce pending+Owner predicate and atomic guard inside one batch.
- **Money-state confusion:** signal is Order `refunded`, changed payment, or UI/API claims returned money. Response: remove S5 behavior/copy from S4.

## Security Considerations

Only current active Owner may decide or replay a result. Decision actor is durable internally but omitted from Customer responses. Cross-Store/absent requests are indistinguishable and produce no ledger row.

## Next Steps

Phase 7 adds assignment and decision controls based on server-produced allowed actions. Phase 8 rehearses migration 0010 against populated Store A before any remote use.
