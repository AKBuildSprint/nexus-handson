# Phase 1 cook evidence

Mode: code (existing plan). No remote D1 mutation. Plan status/index/commits left to coordinator.

## Owned files

- `migrations/0006-order-brief-contract.sql` (47 statements + marker = 48)
- `migrations/0007-manual-payments.sql` (10 statements + marker = 11)
- `tests/support/catalog-test-env.ts` (through 4|5|6|7, default 7; drop commands→payments→history→refunds→idempotency→access→lines→orders)
- `tests/integration/order-brief-migration.test.ts` (created)
- `tests/integration/order-operations-migration.test.ts` (schema5 pin; removed createOrder/completeOrder)
- `tests/integration/migration-constraints.test.ts` (Order identity test pinned to schema5)

Untouched baseline: deleted `session-*-brief.md`, `tsconfig.json` storefront/src, untracked `ORDER_OPERATIONS_PLAN.md` and browser screenshots.

## Checks

```
npm run test:workerd -- tests/integration/order-brief-migration.test.ts tests/integration/order-operations-migration.test.ts tests/integration/migration-constraints.test.ts
```

Final run: 3 files, 19 tests, 0 failed (Vitest 4.1.11). Tester subagent earlier: 19/19 pass. One later Miniflare log (`Durable Object was reset… FOREIGN KEY`) after a rejected cross-Store batch; suite still green.

## Review

code-reviewer first pass: 6/10, two blockers (NULL-unsafe history CHECK; v2 `complete` command). Both fixed in 0006 (`from_status IS …`, `order_commands_version_action`). Added CHECK/UNIQUE/FK regressions and fuller 0005→7 preservation (variant snapshot, access/idempotency IDs+times, command key/time). Expected runtime hold: `resetCatalog()` now schema7; live createOrder/completeOrder still S2 until phases 2/3.

## Left

Coordinator: plan checkbox/status, commit. Phases 2–6 not started. No deploy.
