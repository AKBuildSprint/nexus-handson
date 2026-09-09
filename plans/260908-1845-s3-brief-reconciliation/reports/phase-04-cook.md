# Phase 4 cook evidence

Mode: code (existing plan path). No remote mutation, no index/stage/commit, no phase 5/6.

## Brainstorm contract (reused)

- Outcome: filtered Console inbox (summary + 25-Order pages + complete detail) and Store-scoped HTTP cutover with `X-Nexus-Order-Contract: 2`.
- Constraints: C5/C6; bootstrap Console context only; private capability 404 before contract 409; no S4 auth/approve/reject/execution; Catalog/public products unchanged.
- Non-goals: UI (phase 5), deploy, git, plan index.

## Scout

Workers + Vite/React TS. Phase 3 domain `markPaid`/`fulfillOrder`/`cancelOrder`/`createRefundRequest` existed. HTTP still listed/detailed/canceled only. List JOINed lines (cardinality bug), NFKC-trimmed `q` globally, no summary, no contract header, Console refund treated as 404.

## Files

- `src/orders/order-types.ts` — list `summary`; detail `payment`/`paymentRecordState`; history actor/version labels; drop `complete` from live `allowedActions`; live `OrderCommandAction` is now `cancel | request_refund | mark_paid | fulfill` only
- `src/orders/order-read.ts` — context-scoped list/detail; one D1 batch; page CTE + items; counts-only summary; raw `q` + NFKC `customerQ`; EXISTS payment search
- `src/worker/http-response.ts` — contract marker helpers
- `src/worker/console-order-routes.ts` — bootstrap context; pay/fulfill/refund; marker before parse; `/complete` falls through 404
- `src/worker/storefront-order-routes.ts` — capability then marker; safe refund projection (no `paymentId`)
- `src/worker/storefront-cors.ts` — `X-Nexus-Order-Contract` only on Storefront Order preflights
- `tests/support/catalog-test-env.ts` — `workerRequest` defaults marker
- tests: operations, console-orders, CORS; persistence caller signature only; operations now include Worker HTTP concurrent Customer vs Console refund

## Checks

```
npm run test:workerd -- tests/integration/order-operations-routes.test.ts tests/integration/console-orders.test.ts tests/integration/order-routes.test.ts tests/integration/storefront-cors.test.ts tests/integration/spa-api-routing.test.ts
```

Direct + tester: 5 files, 28 tests, 0 failed (Vitest 4.1.11). After review-gap fixes, same command 28/28.

Acceptance repair (this dispatch): same named command **5 files, 29 tests, 0 failed** (`Phase4Tester`). New case `concurrent Customer and Console refund HTTP keep one request and winner` ran and passed. Reviewer independently reran that named test 1/1.

Host extra (not reviewer): `npx tsc --noEmit` from repo root, TypeScript 7.0.2 / `package.json` `typecheck` script, **exit 0**, no diagnostics. Not a production `vite` build. No lint script exists.

## Review

code-simplifier skipped: live `git diff` vs HEAD includes prior-phase work; coordinator forbade unrelated edits.

code-reviewer first pass: **7/10**, 0 critical. Follow-up closed W1–W5 in tests/helper; retest 28/28 (`Phase4Tester2`).

| ID | Finding | Final check |
|---|---|---|
| W1 | >25 only 1-line; combined filter lacked q/cursor | 28×1-line + 1×2-line + 1×10-line, tied `created_at`, unique pages; `q=Seed&status=paid&refund=pending&limit=1` summaries equal across cursor; `limit=100` |
| W2 | old-wire only cancel/private refund | missing marker + `X-Nexus-Order-Contract:1` on create/list/detail/pay/fulfill/private GET →409; missing capability still 404 first |
| W3 | sentinel had no variant | SQL line has `variant_id`/`sku` + extra option keys; Console + private GET strip them |
| W4 | `workerRequest` marked Catalog/import | marker default only for `/api/console/orders` and `/api/storefront/orders` |
| W5 | weaker isolation/NFKC/actor | foreign-only ref 404; `NPbbbb…` search empty; NFKC `Ｇｒａｃｅ`; raw-q cursor mismatch 400; refund `actor_source=storefront` |

## C5/C6 evidence (named)

- Summary counts-only, same predicate, no cursor; empty match `hasOrders:true` with zero summary
- Search: name/email/order ref/payment ref/external fullwidth `ＡＢ１２`/literal `%` `_`; ASCII `AB12` does not match fullwidth evidence
- Store isolation: second-store SQL fixture; bootstrap HTTP cannot see/pay it
- Detail: items, customer, payment ledger/`legacy_unrecorded` vs `recorded`/`none`, allowedActions, history labels/version
- Private: no payment/history/customer/external ref
- Actions: mark_paid → fulfill distinct; pay replay after fulfill; cancel; pending/canceled fulfill 409
- Shared refund: sequential first-writer still asserts Console returns the Customer request/reason (`actor_source=storefront`); concurrent Worker HTTP race (D1 batch barrier, different keys/reasons) keeps one request + one `refund_requested`, two command ledger rows, canonical winner reason/actor, Order status/total/currency unchanged, Customer GET omits payment/history/customer/allowedActions/`WIRE-RACE`, Console GET matches the same refund
- Removed: complete/approve/reject/PATCH/storefront pay/fulfill → `route_not_found`; CORS contract header Order-only; products preflight with contract 404

## Remaining

- Phase 5 UIs omit contract 2 and still reference `/complete` — intentional; not deployable alone. UI `OrderCommandAction` still includes `complete` (separate types).
- No formatter/lint/production-build/project-wide suite (not in phase 4 verification command). Host `npx tsc --noEmit` was run for this repair only.
- Plan index/stage/commit left to coordinator

## Final ownership (acceptance repair)

- Owner files: `src/orders/order-types.ts` (live command union), `tests/integration/order-operations-routes.test.ts` (barrier helpers + concurrent HTTP test)
- Live `complete` removed from `OrderCommandAction` only. Historical `order_completed` / SQL v1 `order_commands.action='complete'` preserved. `/complete` HTTP still 404.
- Targeted reviewer: **9/10**, 0 critical, GO. Warning: named suite is not standalone typecheck/build; host `npx tsc --noEmit` later clean.
- No UI, no phase 5, no journal, no shared plan/index, no git.
