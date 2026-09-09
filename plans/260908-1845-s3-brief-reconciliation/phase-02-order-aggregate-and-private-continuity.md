---
phase: 2
title: "Phase 2: Order aggregate and private continuity"
status: pending
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: Order aggregate and private continuity

## Goal

Accept a two-Product S2 Order, retain every immutable snapshot, and return one canonical items[] aggregate through new creation, Create replay and existing private links. Follow [contracts C4/C7](./contracts.md).

## Files / ownership

Modify `src/orders/order-types.ts`, `src/orders/order-validation.ts`, `src/orders/order-write.ts`, `src/orders/order-read.ts`, `src/orders/private-access.ts`, `src/catalog/private-order-snapshot.ts`, `src/catalog/catalog-types.ts`, `src/worker/storefront-order-routes.ts`.
Modify `tests/integration/order-routes.test.ts`, `tests/integration/orders-persistence.test.ts`, `tests/integration/private-order-snapshot.test.ts`.
Phase 3/4 later own these shared Order files; strictly serialize. Do not run global typecheck while consumers still intentionally await cutover.

## Existing mechanisms

- `order-write.ts:110-180`: Customer upsert, lines-before-parent, access/Create-key/history in D1 batch and revision assertion.
- `private-order-snapshot.ts:37-114`: active/simple/variant, selected options, inherited private delivery and revision rules.
- `order-read.ts:195-211`, `private-access.ts:8-37`: shared private read and hashed Store-scoped bearer lookup.

## Implementation steps

1. Define canonical OrderStatus, safe item projection, OrderActor/OrderContext, Payment/summary/refund result types from contracts (declarations for downstream phases are not runtime stubs). Keep route-specific DTOs coherent; no type aliases back to old single-item fields.
2. Replace create parser with C4 items[] only, nested field paths and code-point validation. Preserve name/email normalization and existing key/capability checks. Reject duplicate selection, unsupported currency combination, client money/status/source and empty/oversized arrays before writes.
3. Refactor snapshot resolver in place to a plural batch interface `resolveOrderItemCatalogSnapshots({storeId,items})`. Use LSP references/rename if reliable; replace existing exported singular factory/type and all callers in writer and private snapshot/persistence tests. No permanent single-item wrapper. Return results in request order and one captured revision per distinct product; contradictory revisions for the same product cannot pass.
4. Resolve product/variant/options/group-count sets using bounded batched queries. Use context Store throughout. Validate every active/enabled/current-schema relation and resolve existing delivery inheritance unchanged. Keep private access fields internal.
5. Compute line totals and sum safely, assign positions/IDs and globally unique internal paymentReference, then batch Customer upsert + all lines + Order + capability + Create key + initial history. History's non-null assertion requires all distinct product IDs/revisions AND desired aggregate; no partial Customer update remains on failure. Count DB operations for the worst 10-variant request against deployed tier.
6. Catch batch conflict by checking replay ledger first and all product revisions second. Do not turn infrastructure failure into 404 or invent success after failed assertion. Existing same-key + same capability returns original current aggregate; cross-capability is refused.
7. Change readCustomerOrderById to read Order+ordered lines+refund in one batch. Reuse C4 safe projection for Create and private GET; new paymentReference visible, external ledger refs/private access configuration/actors/history absent. Existing one-line Orders appear as items[0] with original line ID.
8. Add request-local Store context to private lookup/read signatures; Worker derives public Store from existing bootstrap configuration and Customer actor from authorized Order, not request body. Update every call listed in impact inventory. The raw capability remains only fragment/header and ephemeral memory.
9. Storefront HTTP customerResponse shows paymentNextStep only for canonical pending. Paid legacy Orders must not display a request to pay again.

## Verification / success

`npm run test:workerd -- tests/integration/order-routes.test.ts tests/integration/orders-persistence.test.ts tests/integration/private-order-snapshot.test.ts`

Earned regressions:
- One simple + one existing enabled variant Product in ONE Order, correct independent qty/price/options/private snapshots, exact safe summed total.
- Replacement for moved legacy migration runtime test: seed schema5 with SQL, apply through7, invoke the current createOrder on that preserved database, and reopen both old/new private Orders. Historical migration tests no longer import live commands.
- First valid Product plus inactive/cross-Store/disabled second Product => no Customer mutation or partial Order.
- Mixed currency, empty/11 items, duplicate pair, invalid quantity and safe-integer overflow rejected. Same Product with two distinct enabled variants allowed.
- Non-first Product changes/deletes between resolution and commit => 409 + exact rollback. No catalog reset needed.
- Create replay returns same Order/private capability and all items after payment/refund; changed capability refuses. Snapshot retained after live Catalog/customer edits.
- Private/public JSON for every line excludes access instructions, file keys, actor/history and raw capability. Existing private URLs remain valid after populated migration.
- Existing S1 catalog tests remain unchanged unless they directly consumed the renamed private snapshot resolver.

## Tasks

- [x] Cut over multi-product creation and private projections
- [x] Prove aggregate authority and snapshot preservation

## Risks / next phase

Bounded bulk reads are required to stay below D1 query/bind budgets; Promise.all of 10 single-item resolvers is not batching. Do not deploy just this API body change: both UIs switch in phase 5 and rollout is phase 6. Phase 3 extends types/commands; phase 4 rewrites Console queries so items never multiply pagination.
