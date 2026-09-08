# Phase 3 cook evidence

Mode: code (existing plan path). Bounded C1/C3 coordinator-acceptance repair. No remote mutation, no index/stage/commit, no phase 4 or deploy.

## Brainstorm contract (reused)

- Outcome: lookup/actor authorization precedes parse/hash/ledger; storefront actor id must match Order customer; bootstrap_owner id stays server null; user/system stay live-rejected.
- Constraints: preserve existing phase 3 implementation; one Store-scoped Order read in shared prepare; wrong Store/unknown Order + malformed input → `not_found` and no mutations.
- Non-goals: phase 4 HTTP/inbox cutover, UI, HMAC/queue, refund decision/execution, git, plan index.

## Scout

Four exports parsed body/key before `prepareCommand` read the Store-scoped Order. `recordedActor` silently replaced storefront `actor.id` with `order.customer_id` and coerced bootstrap_owner id to null. `STOREFRONT_CONTEXT` and storefront HTTP refund passed `id: null`. User/system already 422.

## This repair files

- `src/orders/order-commands.ts` — `authorizedActor`; `prepareCommand` reads Order once, authorizes, then parse/hash/ledger
- `src/worker/storefront-order-routes.ts` — refund passes matching `customer_id`; lookup inside existing refund try
- `tests/integration/order-commands.test.ts` — matching storefront customer on live refunds; lookup-before-parse + wrong-customer + forged owner regressions
- `tests/integration/orders-persistence.test.ts` — refund uses matching customer id
- `tests/integration/order-operations-routes.test.ts` — customer-lookup D1 fault → sanitized 500 + CORS + no-store

Unchanged this session: `src/orders/order-validation.ts`, `src/orders/order-types.ts`.

## Checks

```
npm run test:workerd -- tests/integration/order-commands.test.ts tests/integration/orders-persistence.test.ts
```

tester `Phase3TesterCors`: 2 files, 30 tests, 0 failed (Vitest 4.1.11).

```
npm run test:workerd -- tests/integration/order-operations-routes.test.ts -t "customer lookup"
```

1 passed, 5 skipped, 0 failed.

## Review

code-simplifier skipped: live `git diff` vs HEAD includes prior phase-3 work; task forbade unrelated edits.

code-reviewer first pass: **8/10**, 1 critical HARD-GATE — customer_id SELECT outside refund try/catch (escaped D1 failure, no CORS JSON). Coordinator: move lookup into existing try; add fault-path check; do not accept leak.

code-reviewer confirmation: **10/10**, 0 critical. Previous HARD-GATE resolved.

## Left

Coordinator owns plan checkbox/status/index and commit. Phases 4–6 not started. No deploy. PM sync-back skipped per coordinator (no index). Docs: no `./docs` authority surface changed. Git skipped (no stage/commit).
