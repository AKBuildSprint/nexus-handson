---
phase: 4
title: "Phase 4: Filtered inbox and API cutover"
status: pending
priority: P1
effort: ""
dependencies: [3]
---

# Phase 4: Filtered inbox and API cutover

## Goal

Serve an accurate filtered summary, 25-Order pages and complete detail, with all real Order HTTP actions using one Store-scoped domain service. [Contracts C5/C6](./contracts.md) define response and route shapes.

## Files / ownership

Modify `src/orders/order-read.ts`, `src/orders/order-types.ts`, `src/orders/private-access.ts`, `src/worker/console-order-routes.ts`, `src/worker/storefront-order-routes.ts`, `src/worker/storefront-cors.ts`, `src/worker/index.ts` if needed to supply context.
Modify `tests/integration/order-operations-routes.test.ts`, `tests/integration/console-orders.test.ts`, `tests/integration/order-routes.test.ts`, `tests/integration/storefront-cors.test.ts`, `tests/integration/spa-api-routing.test.ts`.
No dependency on new authentication middleware. Keep public Catalog/Console Catalog routes working.

## Implementation steps

1. Resolve bootstrap Console context in existing order route module; scope all domain/read calls explicitly. For private refund, verify capability before body/idempotency/refund lookup, then derive storefront actor from authorized Order Customer. Avoid a second evaluator or caller-supplied Store selector. A guessed ref cannot bypass private read even though Console remains publicly accessible by user decision.
2. Build one reusable bound base predicate for Store/search/status/open refund. Keep trimmed raw q for external payment-reference predicates; derive NFKC customerQ separately for normalized Customer fields. Preserve raw q through client and cursor; never NFKC-transform stored transaction evidence. Search refs and Customer fields with OR/EXISTS, literal `%`/`_`, bounded lengths. Never join payments or lines into counted Order cardinality.
3. Execute one read batch: page Order rows (limit+1); ordered item snapshots for the identical page CTE; summary aggregations on the same base predicate without seek/limit; Store existence for empty-state discrimination. Keep composite Store joins, request-local arrays and deterministic tiebreakers. Bounded JSON sets avoid D1 parameter limit when API limit=100.
4. Return counts-only summary exact contract. Status filter applies to summary too, so no false counts from other statuses; refund filter applies equally. Do not sum different currencies or add revenue cards. Existing unfiltered hasOrders remains explicitly not a count.
5. Detail read batch returns full immutable items, Customer snapshot, totals/currency, references, original payment ledger, allowed actions, pending refund and history. Join by Order/Store and payment history_id/refund_request_id. Preserve historical audit labels/version; derive legacy_unrecorded instead of fabricating a payment.
6. Wire new manual payment, fulfill and Console refund routes; retain cancel/private refund; remove complete routing/imports. Enforce X-Nexus-Order-Contract:2 on every Order GET/POST before input/ledger work but AFTER private capability guard; absent/old =>409 client_contract_outdated with reload instruction and no write. Permit header in Storefront preflight only on Order routes. Private response omits actor/history/external ref/internal legacy warning; no blind Console-result forwarding.
7. Query parser accepts only new status vocabulary, same limit/cursor rigor. Cursor encodes trimmed RAW q/status/refund/limit, with customerQ deterministically derived; no credential authority. Invalid/mismatched cursor ->400. Compound search and status/refund reset handled client-side in phase5.
8. Replace tests which treated Console refund as forbidden with successful shared-service and duplicate-race assertions. Keep S4 approve/reject and S5 execution routes absent. Preserve route-first API fallback, malformed body errors and no-store semantics on errors.
9. Own sequential update to tests/support/catalog-test-env.ts for the Order contract marker in normal workerRequest fixtures; old-wire tests must explicitly construct requests without it rather than inherit the helper default. Update affected order-routes, operations, console-orders and CORS HTTP tests together; product/import requests remain unchanged.

## Verification

`npm run test:workerd -- tests/integration/order-operations-routes.test.ts tests/integration/console-orders.test.ts tests/integration/order-routes.test.ts tests/integration/storefront-cors.test.ts tests/integration/spa-api-routing.test.ts`

- Seed >25 Orders with mixed 1/2/10 lines and equal created_at at page boundary. Iterate pages: every matching Order exactly once, no split/multiplied Order rows.
- Combined search+status+refund: summary.totalOrders equals complete paginated set; each status/open-request count matches; summary identical across cursors for unchanged data. No-results summary zero even though hasOrders true.
- Search individually by exact/mixed-case name, email, Order ref, generated payment ref, external payment ref, literal wildcard chars; wrong Store payment/ref does not match.
- Plant a real second-Store SQL fixture for list/detail/action isolation (not S4 login). References/IDs/payment refs cannot cross context; API remains bootstrap scoped.
- Paste exact valid fullwidth external reference `ＡＢ１２` and find its Order; Customer compatibility normalization still works independently; cursor preserves raw search criteria.
- Detail vs private same original line snapshots after catalog change; totals/currency/references agree; no private config, actor, external ref or capability escapes Customer projection.
- HTTP manual Paid->Fulfill gives distinct outcomes/history, repeated same key after Fulfill stable. Canceled direct invalid action 409.
- Console and Customer create same pending request once; correct first actor/reason retained; missing/wrong/cross-Order capability 404 before replay/body error.
- Unsupported complete/approve/reject/status patch/execution still 404; Storefront cannot use new payment/fulfill endpoints through its CORS surface. Do not describe CORS as authentication.
- Retained Cancel and private refund from old clients with fresh keys and no/old contract header ->409/no changes; wrong capability still404 first. Updated clients/fixtures send marker. Public products do not gain the Order header allowance.

## Tasks

- [x] Implement shared filtered summary and Order pagination
- [x] Wire Store-scoped action routes and projections
- [x] Prove HTTP isolation and cross-path consistency

## Risks / next

List batching must snapshot summary/page/items together; running summary after the batch can lie under concurrent mutation. This phase supplies the final API contract to both phase5 UIs; no deployment until they migrate.
