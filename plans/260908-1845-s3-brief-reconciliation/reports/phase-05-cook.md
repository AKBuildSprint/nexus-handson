# Phase 5 cook evidence

Mode: code (existing phase path). No remote mutation, no plan index/stage/commit, no phase 6.

## Brainstorm contract (reused)

- Outcome: Console inbox/detail Mark Paid/Fulfill/Cancel/refund-on-behalf; Storefront 1–10 item cart and private refund on paid/fulfilled.
- Constraints: C4–C6; `X-Nexus-Order-Contract: 2`; raw trimmed search (no client NFKC); bootstrap demo labels; no Approve/Reject/Execute.
- Non-goals: deploy, git, plan index, project-wide suites (phase 6).

## Scout

Vite/React Console + Storefront. Phase 4 Worker already served items[], summary, markPaid/fulfill/refund, contract 2. UI still used complete/single-product/NFKC until this phase.

## Files

- `src/console/orders/order-ui-types.ts` — canonical statuses, items[], summary, paymentRecordState
- `src/console/api-client.ts` — contract 2; markPaid/fulfill/createConsoleRefundRequest; cancel retained
- `src/console/production-console-app.tsx` — raw trim search; summary envelope; no previous summary on load/error
- `src/console/orders/orders-screen.tsx` — matching counts; item preview; payment reference
- `src/console/orders/order-detail-screen.tsx` — ledger, items table, Mark Paid/Fulfill/refund; frozen method/reference/reason
- `src/console/styles/console-layout.css` — matching summary / item table / action form
- `storefront/src/storefront-view-types.ts` — items[] create/view; pending|paid|fulfilled|canceled
- `storefront/src/api-client.ts` — contract 2 on Order GET/POST
- `storefront/src/storefront-app.tsx` — cart 1–10; frozen Create; private multi-line; refund paid/fulfilled
- `storefront/src/styles.css` — cart/item list
- `tests/browser/console-orders-contracts.test.ts`
- `tests/browser/storefront-orders-contracts.test.ts`
- `tests/e2e/console-orders.spec.ts`
- `tests/e2e/storefront-orders.spec.ts`

## Checks

Host: `npm run typecheck` exit 0.

```
npm run test:browser -- tests/browser/console-orders-contracts.test.ts tests/browser/storefront-orders-contracts.test.ts
```

33/33 passed (Vitest 4.1.11).

Local D1: applied 0006+0007 to existing local DB (did not kill console/storefront supervisors).

```
env -u CI npm run test:e2e -- tests/e2e/console-orders.spec.ts tests/e2e/storefront-orders.spec.ts --trace=off
```

ReuseExistingServer: console pid 19311 :5173, storefront pid 19310 :5174, not killed.

Final e2e: **12/12 passed** (`Phase5E2E5` 25.5s). Post-review-gap e2e (`Phase5Verify`) also 12/12 / 26.6s. Browser re-run after retry-button unlock: 33/33.

No production vite build. No lint script. No project-wide suite.

## Review

code-reviewer first pass: **6/10**, 3 blocking (P5-1 in-flight cart reset duplicate Create; P5-2 outdated still POST; P5-3 refresh left stale confirm panel).

Fixed: lock cart while submitting; split placeLocked so Retry checkout still works; outdated closes panel and disables mutation; restore allowedActions panel drop; e2e cross-tab expects Paid and Cancel gone.

## Remaining

- Phase 6 owns project-wide checks, existing-data/redeploy evidence, documentation cutover.
- Plan index/stage/commit left to coordinator.
- Two-product cart is in UI; e2e still places one Product per Order except sequential products (C-S2 full two-product in one Order is UI-capable; dedicated two-line e2e not added).

## Repair session (acceptance completion)

Prior Remaining line above is historical: dedicated two-line live E2E and visual proof were missing. This session did not rewrite the first cook pass.

### P5-1 live two-origin journey

Playwright live (reuseExistingServer, `env -u CI`): one Storefront Order with a Simple Product and a Variant PDF line; Console inbox `+ 1 more`; detail both lines, `$59.45 USD`, paymentReference; Mark Paid then Fulfill; Customer refund; Console canonical existing request (form gone).

Test: `tests/e2e/storefront-orders.spec.ts` `places one Order with a Simple and Variant Product, then Marks Paid, Fulfills, and canonicalizes a Customer refund`.

Live servers preserved: console pid 19536 `:5173`, storefront pid 19537 `:5174`. Not killed.

### P5-2 screenshots (page-only, emails redacted, did not overwrite ui-01-*)

- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-storefront-cart-1280.png`
- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-storefront-cart-375.png`
- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-storefront-private-1280.png`
- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-storefront-private-375.png`
- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-console-inbox-1280.png`
- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-console-inbox-375.png`
- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-console-detail-1280.png`
- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-console-detail-375.png`
- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-console-fulfilled-1280.png`
- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-storefront-refund-1280.png`
- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-02-console-existing-refund-1280.png`

Prior proof kept: `plans/reports/evidence-session-3/ui-01-console-list-1280.png`, `ui-01-console-list-375.png`, `ui-01-storefront-refund-375.png`.

### P5-3 repairs

- Console GET `client_contract_outdated` closes panel, clears attempt/lockedAction, hides actions; Fulfill/Cancel/refund confirms disable when outdated.
- Refresh drops open panel **and** `lockedAction` when `allowedActions` no longer includes the action.
- Browser: Retry checkout asserts identical Idempotency-Key/capability/JSON `items[]`, cart `#checkout-cart` two lines stay, qty/remove/add stay disabled; outdated Place Order disabled, posts length 1.
- Browser: open Mark Paid panel closes on paid refresh; GET outdated closes panel and does not POST.

### Checks this session

- `npm run typecheck` exit 0
- browser contracts **36/36** (was 33)
- e2e console+storefront **13/13** (`env -u CI`, `--trace=off`, 28.9s tester / 13 passed 29.5s host). Two-item case 3.2s after keyboard/create-count tighten.

code-reviewer final: **8/10**, critical 0. Warnings (keyboard `.focus()`, create POST count, cart lock assertions) addressed after review; not re-scored.

Simplify skipped: no `.ck.json`; `git diff HEAD` includes entire prior Phase 5, not this slice.

No plan index, stage, commit, phase 6, deploy. Journal not written (prefs resolve failed; coordinator forbade index/commit).

### Remaining

- Phase 6 still owns project-wide checks, existing-data/redeploy evidence, documentation cutover.
- Plan index/stage/commit left to coordinator.

## Repair session (375px Order items visibility)

Coordinator Chromium 375 inspection at `/console/orders/NX-9C1FEEB127364F4E` proved `.order-items-table` computed `display:none` and rect `0x0`. DOM still had two items, so `toContainText` was a false pass. Prior `ui-02-console-detail-375.png` omits every line.

### Root cause

`src/console/styles/console-layout.css` `@media (max-width: 719px) { .console-table { display: none } }`. Detail used `className="console-table order-items-table"` with no mobile sibling. Inbox already had `.order-list-mobile`. Not a fixture special-case.

### Fix

Dual-DOM matching inbox/product-list. Shared `itemLineCopy` feeds the desktop table and `.order-items-mobile` `order-summary-card` list. Global table hide unchanged. Desktop table preserved. No NX-9C1FEEB127364F4E branch.

Files: `src/console/orders/order-detail-screen.tsx`, `src/console/styles/console-layout.css`, `tests/e2e/storefront-orders.spec.ts`.

### Proof

- `npm run typecheck` exit 0
- `npm run test:browser -- tests/browser/console-orders-contracts.test.ts` 19/19
- `env -u CI npm run test:e2e -- tests/e2e/storefront-orders.spec.ts --trace=off -g "places one Order with a Simple and Variant"` 1/1 (3.2s)
- Live servers preserved: console pid 19536 `:5173`, storefront pid 19537 `:5174`
- Fresh page-only redacted screenshots (did not overwrite ui-02):
  - `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-03-console-detail-375.png` — both lines, qty/unit/line totals
  - `plans/260908-1845-s3-brief-reconciliation/reports/evidence-phase-05/ui-03-console-detail-1280.png` — desktop table intact
- Prior false-pass kept: `ui-02-console-detail-375.png` (mtime 05:13, items omitted)

code-reviewer: **9/10**, critical 0, GO. Warning: e2e qty/money still match aggregate row/card text; independent live measurement confirmed visible child values and 375/1280 geometry. Initial regression was the whole table hidden; visible row/card geometry plus measured children covers this repair.

Simplify skipped: no `.ck.json`; `git diff HEAD` includes entire prior Phase 5, not this slice.

No plan index, stage, commit, phase 6, deploy. Journal skipped (prefs resolve failed; coordinator: report only, no commit).

### Remaining

- Phase 6 still owns project-wide checks, existing-data/redeploy evidence, documentation cutover.
- Plan index/stage/commit left to coordinator.
