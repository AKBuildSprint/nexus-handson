---
phase: 5
title: "Enforce assigned-only Order access and atomic assignment"
status: pending
priority: P1
effort: 2.5d
dependencies: [2, 3]
---

# Phase 5: Enforce assigned-only Order access and atomic assignment

## Goal

Let Owners assign/reassign Orders to active same-Store Staff and make Staff visibility and processing depend on current assignment at both read and commit boundaries.

## Context Links

- [Plan](./plan.md)
- [Canonical implementation contracts](./contracts.md)
- [Exact Order symbols, callers and recovery gaps](./reports/research-domain-260912-0224.md#phase-5-assignment-visibility-and-replay)
- `packages/orders/src/queries/order-read.ts:214-513`
- `packages/orders/src/commands/order-commands.ts:59-97`
- `packages/orders/src/persistence/command-store.ts:77-270`
- `packages/orders/src/transitions/order-transitions.ts:13-46`
- `apps/worker/src/console-order-routes.ts:127-247`
- Scenarios S4-02, S4-09, S4-12–S4-15, S4-18, S4-30, S4-35, S4-45, S4-49

## Overview

- **Priority:** P1.
- **Current status:** Pending.
- **Read rule:** Owner sees all Store Orders; Staff sees only current assignments in inbox, search, detail, pagination, and summary.
- **Write rule:** assigned Staff may use existing processing actions allowed by Order state, including Customer-on-behalf Refund request. Assignment and terminal Refund decisions remain Owner-only.

## Requirements

### Functional

- Add Owner assignment/reassignment command and same-Store active Staff candidate read.
- List/detail/search/summary/`hasOrders` all share one visibility predicate.
- Cursor binds query plus principal visibility identity so Owner/other Staff/Store cursors cannot be replayed as another view.
- Existing `mark_paid`, `fulfill`, `cancel`, and `request_refund` commands authorize current Owner or current assigned Staff as policy permits.
- Reassignment/revocation and processing commands have coherent commit ordering.
- Authorization occurs before reading/replaying command-ledger results.

### Non-functional

- Summary counts come from current server filters and authorized rows, never the current page.
- Sparse Staff queries use assignment indexes before pagination.
- Denials reveal no Customer, payment, history, or command-result fields.

## Architecture

Extend the current Store-scoped Order package instead of adding route SQL. A visibility descriptor derived from `IdentityContext` feeds one `boundBasePredicate`; detail and mutation target reads apply the same descriptor. Assignment SQL lives in an Orders command and uses active Owner/Staff membership predicates.

For mutation races, every business effect is conditioned on current membership plus current assignment when actor is Staff. The final command-ledger INSERT executes unconditionally with a non-null `CASE` guard over current authority, expected poststate and this command's exact new event ID. A zero-row conditional INSERT cannot force rollback. State left by another command is not proof this command succeeded.

Authorization covers initial preparation, existing-key replay, existing-effect result binding, conflict callbacks, generic batch recovery and successful post-batch result reads. Use current authorized-resource predicates in result queries; a stale in-memory actor check cannot close an awaited lookup gap. If a valid command commits before access is lost, preserve its effect and conceal its later response. Customer capability commands remain a separate authorization path.

Cursor format is a versioned tuple containing Store, principal user ID, current role, seek timestamp/ID and normalized query/status/refund/limit. Compare its principal/filter fields to server-resolved context, then apply current membership/assignment predicates on every query. No global assignment epoch or undefined visibility-version state is needed. A reassigned-away last row remains a valid seek position; pagination must recover without broadening visibility.

Assignment records its target user and one event time in durable history, with the assigning Owner as actor; the command result points to that event. Same-key identical replay returns the recorded target/time without changing the current assignment, even if it has since changed. A different target or actor under that key conflicts. For a fresh key selecting the already-current assignee, bind the current assignment's existing event under current Owner/target-membership and assignment-event guards, with no duplicate assignment event or timestamp change. A later genuine change creates a new event. Store the event reference on the current assignment so this no-op cannot bind an unrelated historical assignment.

## File Inventory

Audit correction (2026-09-12): Phase 2 provides SQL storage/CHECK branches only. This phase owns the complete compiling `assign`/`assigned` seam: strict Order types, shared command/history readers, Worker adapter and minimal Console result types/parser/tests. Phase 7 adds interactive controls/refetch, not delayed support required to decode Phase 5 results. Keep non-assignment/Customer shapes unchanged; never make assignment target optional to mask an incomplete reader.

| File | Action | Rough change | Test impact |
|---|---|---:|---|
| `/Users/plateau/Project/nexus-handson/packages/orders/src/order-types.ts` | Modify | 70–110 lines | Assignment/projection/action types |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/transitions/order-transitions.ts` | Modify | 80–130 lines | Evaluator-backed actor/action rules |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/queries/order-read.ts` | Modify | 140–210 lines | Shared assigned visibility/cursor/summary |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/persistence/command-store.ts` | Modify | 60–100 lines | Visibility target and replay guards |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/commands/order-commands.ts` | Modify | 140–220 lines | Atomic membership/assignment guards |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/commands/order-assignment.ts` | Create | 130–190 lines | Owner assignment/reassignment |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/console-order-routes.ts` | Modify | 80–130 lines | Assignment endpoints/context lookup |
| `/Users/plateau/Project/nexus-handson/apps/console/src/orders/order-ui-types.ts` | Modify | Minimal assignment result/history types | Compiling strict parser contract now; interactive UI in Phase 7 |
| `/Users/plateau/Project/nexus-handson/apps/console/src/api-client.ts` | Modify | Minimal assignment result decoding | Preserve existing action response shapes; auth UI/calls in Phase 7 |
| `/Users/plateau/Project/nexus-handson/tests/browser/console-orders-contracts.test.ts` | Modify | Assignment envelope contract assertions | Strict result acceptance/rejection now; UI behavior in Phase 7 |
| `/Users/plateau/Project/nexus-handson/tests/integration/order-assignment.test.ts` | Create | 280–380 lines | Assignment and race contracts |
| `/Users/plateau/Project/nexus-handson/tests/integration/order-commands.test.ts` | Modify | 120–200 lines | Owner/Staff/replay matrix |
| `/Users/plateau/Project/nexus-handson/tests/integration/console-orders.test.ts` | Modify | 120–180 lines | Assigned list/search/summary/cursor |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/order-validation.ts` | Modify | Strict assignment input | Reject unsupported fields and malformed target/key |
| `/Users/plateau/Project/nexus-handson/tests/integration/order-operations-routes.test.ts` | Modify | Existing 10-case route suite | Actual pagination, filters, summaries, direct commands and privacy |
| `/Users/plateau/Project/nexus-handson/tests/integration/orders-persistence.test.ts` | Modify fixtures/imports | Existing create compatibility | Public create and snapshots remain separate |
| `/Users/plateau/Project/nexus-handson/tests/support/catalog-test-env.ts` | Coordinate with phases 2/3 | Authenticated callers/latest schema | Preserve historical-through fixtures; no duplicated test authority |

### Interface checklist

- [x] `encodeCursor`/`decodeCursor`, `boundBasePredicate`, `pageSelectSql` and `listConsoleOrders` share current Store/principal visibility. Include page-item subquery, filtered summary and independent `hasOrders` query.
- [x] `readConsoleOrderByReference` scopes all five header/line/refund/history/payment queries. `readOrderTarget` and the route reference lookup cannot disclose unassigned/foreign targets.
- [x] `authorizedActor` and `allowedActions` use central policy plus domain eligibility; remove `bootstrapOwnerContext` and move `lookupBootstrapOrderId` SQL to Orders.
- [x] `prepareCommand`, `readLedger`, `readCommandResult`, `bindExistingResult`, `recoverFailedBatch`, `runCommandBatch` and every `onConflictReplay` callback enforce current authorization before disclosure. Existing-effect ledger-only writes are guarded too.
- [x] Proposed `order-assignment.ts` exposes the assignment command and active same-Store Staff candidate query; Worker serves `GET /api/console/staff` and `POST /api/console/orders/:reference/assignment` with strict `{assigneeUserId}`, key/header and canonical error/CSRF order.
- [x] Verify completed phase 2 migration 0009 supplies durable assignment target/event/result fields and action CHECK branches. Check its payment/history/command closure before adding phase 5 behavior; do not wait for migration 0010. These fields are proposed and absent in the current checkout.
- [x] Update Console `order-ui-types.ts` and API result decoding in this phase with the domain types/readers/Worker adapter; existing contract-2/public Customer callers stay valid. Phase 7 consumes these contracts for controls/refetch. No assignment data enters the Customer projection.
- [x] Extend shared `readCommandResult` with the canonical action-discriminated `assign` envelope: recorded status/time, null payment/refund and `{assigneeUserId,eventId}` from the immutable `assigned` history row. Check action/event compatibility in normal, no-op, replay and recovery reads; never substitute current assignment or bypass shared command handling.

## Dependency Map

`Phase 2 migration 0009 membership/assignment + assignment history/command CHECK expansion + Phase 3 context -> Order visibility/commands -> Phase 6 decision auth and Phase 7 UI`. Migration 0009 preserves/rebuilds payments referencing history; migration 0010 must retain the new assignment event/result fields.

## Test Scenario Matrix

| Priority | Scenarios | Test boundary | Expected proof |
|---|---|---|---|
| Critical | S4-09, S4-12, S4-18 | concurrent Worker/D1 commands | Commit ordering; no stale action or replay disclosure |
| Critical | S4-13, S4-49 | list/detail/direct endpoints | No unassigned rows, counts, fields, or actions |
| Critical | S4-30, S4-35 | assignment/direct mutation | Owner-only assignment; valid same-Store Staff only |
| High | S4-02, S4-14, S4-45 | end-to-end domain flow | Empty-to-assigned inbox; valid processing and transitions |
| High | S4-15 | benchmark fixture | indexed sparse assignments meet regression budget |

## Tests Before

Use Node 22 with exact version recorded and dependencies from `npm ci`. Current planning discovery fails before collection due to missing packages; no passing baseline exists. Static source inventory is 30 cases: `order-commands.test.ts` 18, `console-orders.test.ts` 2, `order-operations-routes.test.ts` 10. These are not runtime passes or new S4 tests. Characterize these contracts, make test fixtures/signatures compile, then capture the new failing visibility/atomicity assertion. Missing module/table setup errors are not behavioral Red.

1. Add assigned-only list/detail/search/summary tests with zero, one, page-size, and page-size+1 fixtures.
2. Add copied Owner/Staff B/tampered cursors and reassignment between pages.
3. Add assignment-versus-processing and revocation/demotion-versus-processing in both forced commit orders using two sessions and real D1 barriers. Reuse `order-commands.test.ts:109-158` proxy/deferred helpers; do not add production sleeps or fabricate successful writes.
4. Add idempotency tests: identical retry while still authorized replays; after reassignment/revocation it denies before result lookup; changed body/actor under the same key conflicts. Force access loss in initial replay, `bindExistingResult`, conflict callback, generic batch recovery and post-success result read.
5. Add invalid assignee tests: missing user, Owner, revoked Staff, other Store Staff.
6. Race assignment against target Staff revocation. Assert durable original assignment replay after a later reassignment, same-target/fresh-key no-op, changed-target/same-key conflict and no audit/ledger partial effects after faults at each statement boundary.
   Assert the exact assignment envelope across initial success, same-key retry, fresh-key no-op and replay after later Order status changes; recorded status/time/target/event remain unchanged. Existing non-assignment and Customer command JSON shapes stay unchanged.
7. Compare absent/foreign/unassigned target response shape, including payment-reference search and error recovery. Assert no Customer/payment/history/key-existence disclosure and no denial ledger.

## Implementation Steps

1. Focused-scout Order target, list, summary, cursor, batch, and route call sites; update exact symbols before editing.
   Implement the compiling strict assignment types/shared reader/Worker/Console parser seam together, with exact envelope assertions and unchanged non-assignment characterization. Add minimal compiling signatures before behavioral Reds; a union mismatch is setup failure, not a passing phase gate.
2. Extend `IdentityContext` use in Order context and replace bootstrap actor acceptance with evaluator-backed Owner/assigned Staff policy.
3. Build one visibility predicate for Owner versus Staff and use it in page query, item query, summary query, has-any query, and detail/history/payment/refund reads.
4. Implement the versioned principal/filter/seek cursor tuple described above. Reject foreign or mismatched context; apply live visibility independently of cursor contents and recover when the last row was reassigned away.
5. Add Owner-only Staff candidate and assignment endpoints from contracts.md, strict assignment parser and safe candidate projection without credentials/email.
6. Implement assignment as one D1 batch guarded by current Owner membership and target active same-Store Staff membership. Persist target/time/event and exact command-result reference. Reassignment replaces only current assignment; retries/no-ops follow the durable-event rules above.
7. Add current membership/assignment predicates and exact poststate guards to every existing command and ledger-only binding. Authorize every initial, post-batch and recovery result query; follow canonical concealed lookup and error precedence.
8. Return evaluator-derived `allowedActions` from detail. Existing Order transition eligibility still wins after role permission.
9. Prepare the deterministic sparse-assignment dataset from contracts.md; correctness tests assert scope/counts and index use. Capture runtime/query plan, `rows_read` and p95 in a separate measured phase report, not timing assertions inside permanent correctness tests.

## Refactor

Delete `lookupBootstrapOrderId` and bootstrap actor branches after all callers migrate. Keep Customer capability authorization separate; do not force it through Staff assignment. Remove any route/UI role switches that duplicate package policy.

## Tests After

- Assert Owner views all Store rows while each Staff view contains only its assignment, including summary metrics.
- Assert reassignment removes old Staff access immediately and enables new Staff.
- Assert all-or-none audit/business/ledger writes under injected failures and races.
- Assert existing integrity transitions still reject cancel-after-payment and other invalid status actions for both Owner and Staff.

## Todo

- [x] Write failing assigned visibility, cursor, replay, and race tests.
- [x] Add Owner-only assignment command and candidate read.
- [x] Apply one visibility predicate to every Order projection/count.
- [x] Add atomic membership/assignment guards to processing commands.
- [x] Remove bootstrap Order lookup/actor paths.
- [x] Measure sparse Staff query budget and add required indexes.

## Success Criteria

Staff cannot infer or act on unassigned Orders through any route, filter, cursor, count, or replay. Owner assignment is same-Store and current-membership safe. Concurrent operations produce one coherent order with atomic audit and ledger persistence.

## Regression Gate

After Node 22 plus `npm ci`, run the proposed new assignment test first, capture behavioral Red/Green/refactor evidence, then existing regression files. The assignment file is absent today; a missing-file failure is not Red.

```sh
npx vitest run tests/integration/order-assignment.test.ts
npx vitest run tests/integration/order-commands.test.ts tests/integration/console-orders.test.ts tests/integration/order-operations-routes.test.ts tests/integration/orders-persistence.test.ts
npx vitest run --config vitest.browser.config.ts tests/browser/console-orders-contracts.test.ts
npm run typecheck
```

Measure list/search/summary separately using the proposed 10,000-Order/200-assignment fixture and 20 warmed samples. Record p95 <1s and <=1.25x equivalent Owner query or diagnose/revise explicitly; never fabricate a pass. Keep permanent assertions deterministic and fail correctness for broadened scope or inappropriate sparse-query access. Broaden to `npm run test:integration` after shared schema/fixture changes.

## Risk Assessment

- **TOCTOU authorization:** signal is an effect after reassignment/revocation wins. Response: block phase; move predicate into every committing batch path.
- **Summary leak:** signal is Staff total larger than authorized matching rows. Response: derive all counts from shared base predicate.
- **Cursor leak/trap:** signal is copied cursor broadens scope or makes pagination permanent. Response: bind principal visibility and handle reassigned-away edge rows.

## Security Considerations

Same-Store membership alone is insufficient for Staff. Resource concealment covers details, errors, counts, cursors, payments, Customer fields, history, and idempotency results. Assignment IDs from clients are untrusted until Store/role/status guards pass.

## Next Steps

Phase 6 adds terminal Refund decisions on the established Owner/Staff boundary. Phase 7 surfaces assignment without treating hidden UI as enforcement.
