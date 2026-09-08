---
phase: 3
title: "Phase 3: Payment transitions and shared refunds"
status: pending
priority: P1
effort: ""
dependencies: [2]
---

# Phase 3: Payment transitions and shared refunds

## Goal

One real transition service records manual money evidence, moves Pending->Paid->Fulfilled, cancels only Pending, and creates at most one open Refund Request from either actor path. [Contracts C1–C3](./contracts.md) are authoritative.

## Files / ownership

Modify `src/orders/order-commands.ts`, `src/orders/order-validation.ts`, `src/orders/order-types.ts`, `tests/integration/order-commands.test.ts`.
No new generic workflow/event bus/service class. No HTTP provider support or entitlement effects. Later phase 4 wires HTTP consumers.

## Design and steps

1. Replace completeOrder/parseCompleteOrderInput with markPaid/manual-payment parser; add fulfillOrder/empty-body parser; keep cancelOrder and createRefundRequest exports with explicit request-local context. Enumerate LSP + fallback grep callers in impact inventory before modifications; remove mutable complete helper after route/test cutover.
2. Normalize manual method/reference per C2; reason stays existing CRLF/trim/1–1000 code points with allowed LF/TAB and React escaping. Reject client-selected money/source/actor/store. Resolve Order in trusted Store before command input; return not_found without cross-Store evidence.
3. Create one internal command execution pattern in order-commands.ts, reusing current hashing, readLedger, recoverFailedBatch and DB non-null assertion technique. It may have concrete action statement builders; do not add a generic transition configuration engine. Actor/action rule is enforced inside domain, not only UI.
4. markPaid on Pending prepares history order_paid, guarded Payment INSERT from exact Order total/currency, guarded pending->paid UPDATE, and version2 command result insertion in one D1 batch. Every effect references candidate history/payment IDs; exactly one full succeeded payment is possible. Unique external reference collision on another Order returns payment_conflict with no leaked other Order data. Status+payment must never commit independently.
5. Fulfill requires Paid in guarded SQL; inserts one order_fulfilled and changes to fulfilled. It does not require retroactively fabricated payment rows on migrated paid Orders, nor grant files. Cancel uses pending->canceled only and shares the paid-or-cancel decision uniqueness. No terminal slot shared between paid and fulfilled.
6. Implement canonical duplicate handling from C3: same key exact payload/actor before state validation; same-payment new key returns existing Payment/event after Fulfill; conflicting new details 409. Result reconstruction is from ledger/history and linked Payment/refund ID, not current Order status. Only new key ledger may be added for a semantic duplicate; history/Payment/request/time/actor stay single.
7. Refund service accepts bootstrap_owner or storefront actors; both must reference the same Store/Order and use the same batch. Paid or fulfilled eligibility inside SQL; insert pending request only if no open one. Record request actor and one linked refund event; order status untouched. A second path/key/reason returns the first request/reason/actor. Key conflict across actors is explicit 409, not impersonation.
8. Return immutable command outcome per C6. Refund outcome reconstructs pending from its request-created event plus linked immutable ID/reason/time, NOT live refunds.status; GET/detail is the current-state projection. This protects later S4 decisions without implementing them now. Version1 command keys remain reserved and return a reload/fresh-attempt conflict. New `/complete` is not recreated; historical source/action values are only readable evidence.
9. Update command tests with genuine new boundaries; preserve rollback/race/replay behavioral coverage, replace obsolete status/checkbox assumptions. Include payments and actor/refund linkage in exact persisted before/after snapshots.

## Verification

`npm run test:workerd -- tests/integration/order-commands.test.ts tests/integration/orders-persistence.test.ts`

| Case | Required observation |
|---|---|
| Pending manual payment, then Fulfill | two distinct events; one ledger Payment; methods/reference/amount/currency/actor exact; valid actions change |
| Pending Cancel | canceled; no Payment; direct markPaid/Fulfill refused |
| Double click/same key/different key same payload | one successful Payment + one paid event; same recorded time |
| markPaid vs Cancel simultaneous | one winning decision; losing state conflict; no partial row |
| Two payments with different refs / same external ref on two Orders | at most one settlement per Order/reference; loser no state/history |
| Paid replay after fulfilled | original paid result, no second paid event |
| Refund Customer vs Console race | one request + linked event + canonical reason/actor; Order unchanged |
| Refund vs Fulfill race | valid paid/fulfilled request and one fulfill; no duplicate/false 500 |
| Fault after Payment/history and after command ledger | exact pre-state restored; same-key retry wins once |
| Wrong Store/forged actor/body | no private disclosure, no mutation |
| Legacy paid without Payment | Fulfill/request allowed, no Payment invention, legacy warning derivable |
| Migrated zero-total Order | SQL seed schema5 -> migrations7 -> current markPaid/Fulfill or legacy-paid Fulfill; original money/IDs unchanged; replacement for removed historical completeOrder runtime test |
| Legacy command key on new operation | clear 409, stored legacy hash/event unchanged |

Use controlled barriers/DB wrappers already in tests, not sleeps or UI disable as concurrency proof. Keep zero-total path honest and consistent. S5 HMAC/queue tests are not part of this phase.

## Tasks

- [x] Implement shared payment and fulfillment transitions
- [x] Unify Customer and Console refund commands
- [x] Prove command races rollback and durable replay

## Risks / next

The prior terminal assertion incorrectly relies on status never advancing; remove that dependency for paid replay. Named actor identity is not authenticated in S3. Phase 4 will resolve context and project private outputs; phase 5 will preserve uncertain-result retry UI.
