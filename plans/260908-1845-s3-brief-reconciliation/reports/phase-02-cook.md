# Phase 2 cook evidence

Mode: code (existing plan). No remote mutation. Plan status/index/commits left to coordinator.

## Brainstorm contract (reused)

- Outcome: two-Product S2 Order, immutable snapshots, canonical `items[]` through create, Create replay, and private links (C4/C7).
- Constraints: serialize shared Order files; no global typecheck; no deploy; preserve user baseline (deleted session briefs, tsconfig storefront/src, untracked ORDER_OPERATIONS_PLAN.md / screenshots).
- Non-goals: phases 3–6, Console pagination rewrite, UI cutover, live command rewrite.

## Scout

Orders were still singular `productId/variantId/quantity` with JOIN-one-line reads. Snapshot factory ran up to four queries per line. Private lookup hardcoded `BOOTSTRAP_STORE_ID`. Schema 0006/0007 already has aggregate, `payment_reference`, canonical statuses.

## Owned files

- `src/orders/order-types.ts`
- `src/orders/order-validation.ts`
- `src/orders/order-write.ts`
- `src/orders/order-read.ts`
- `src/orders/private-access.ts`
- `src/catalog/private-order-snapshot.ts`
- `src/worker/storefront-order-routes.ts`
- `src/worker/console-order-routes.ts` (query status map compile alignment only)
- `tests/integration/order-routes.test.ts`
- `tests/integration/orders-persistence.test.ts`
- `tests/integration/private-order-snapshot.test.ts`
- `tests/integration/order-brief-migration.test.ts` (storeId caller cutover)
- `tests/integration/order-operations-migration.test.ts` (storeId caller cutover)
- `tests/integration/order-commands.test.ts` (storeId caller cutover only; create body remains phase 3)

## Checks

```
npm run test:workerd -- tests/integration/order-routes.test.ts tests/integration/orders-persistence.test.ts tests/integration/private-order-snapshot.test.ts tests/integration/order-brief-migration.test.ts tests/integration/order-operations-migration.test.ts
```

Final: 5 files, 31 tests, 0 failed (Vitest 4.1.11). Tester subagent on the three phase-2 files: 19/19. One Miniflare log (`Durable Object was reset… FOREIGN KEY`) after a rejected cross-Store batch; suite still green.

Worst 10-item create D1 ops: 1 idempotency read + 4 batched catalog queries + write batch (1 customer + 10 lines + order + access + idempotency + history = 15) + read batch 3 = 23. Under Free D1 batch 50.

## Review

code-reviewer first pass: 7/10, HARD-GATE side effect — `findOrderIdByCapability` required `storeId` while phase-1 tests omitted it (`order-brief-migration` 8/7/1 fail, `D1_TYPE_ERROR undefined`). Coordinator approved migrating remaining callers (no bootstrap shim).

code-reviewer second pass: 9/10, 0 critical. Remaining warnings are accepted deferrals (Console line-join pagination = phase 4; live commands/UI = phases 3/5) plus a two-line payment/refund replay coverage gap.

## Left (original cook)

Coordinator: plan checkbox/status, commit. Phases 3–6 not started. No deploy.

## Repair session (C1/C4 context cutover)

Owner: Orca worker `term_075659f0-0af2-4b13-af3f-30feb8f3c4a1` / task `task_cbec3a6bf2f2`. Fresh repair session. Coordinator review found `createOrder` `context?: OrderContext` plus domain `storefrontContext(context?)` silently defaulting `BOOTSTRAP_STORE_ID`.

Repair:
- `src/orders/order-write.ts`: `context: OrderContext` required; `storefrontContext` helper and `BOOTSTRAP_STORE_ID` import removed; `input.context` used directly; non-storefront actor still 422 before parse/DB.
- Callers: Worker `src/worker/storefront-order-routes.ts` already passed Worker-resolved `storefrontContext()` (bootstrap stays at Worker, not domain). Persistence tests already passed `STOREFRONT_CONTEXT`. `tests/integration/order-commands.test.ts` `placeOrder` / `placeZeroTotalOrder` now pass the same fixture. No shim. Create body in command tests remains singular (phase 3).

Checks (tester subagent): same named command, 5 files, 31/31, 0 failed (Vitest 4.1.11). Expected Miniflare FK log after rejected cross-Store batch.

Targeted code-reviewer: **9/10**, 0 critical, HARD-GATE-NO-SIDE-EFFECTS PASS. Intentional contract: omitting context is now a compile-time violation. Warning: named suite does not run `order-commands.test.ts`; no missing-context/non-storefront unit added (suggestion only).

### Phase 3 handoff — two-item Create replay after payment/refund

Exact location: `tests/integration/orders-persistence.test.ts` test `'replays the current aggregate after payment and refund, and keeps snapshots after catalog edits'` (currently ~538–576).

Today it SQL-stubs `orders.status='paid'` and inserts `order_refund_requests` after a **one-item** create, then replays Create.

When phase 3 lands real `markPaid` / `createRefundRequest` in `src/orders/order-commands.ts`, replace those SQL stubs with those commands on a **two-item** Order (one simple + one enabled variant), then assert Create replay returns the same Order/private capability and both items after payment and after refund. Do not keep SQL status/refund invention once those commands exist.

## Left

Coordinator owns plan checkbox/status/index and commit. This session did not stage or commit. Phases 3–6 not started. No deploy. PM sync-back skipped per coordinator. Docs: no `./docs` authority surface changed.
