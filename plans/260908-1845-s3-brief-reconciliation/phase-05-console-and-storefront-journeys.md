---
phase: 5
title: "Phase 5: Console and Storefront journeys"
status: pending
priority: P1
effort: ""
dependencies: [4]
---

# Phase 5: Console and Storefront journeys

## Goal

Owner can find the actual S2 Order, record manual Payment, Fulfill/Cancel and request a refund on behalf; Customer can place two Products and submit a private request once. Use final [contracts](./contracts.md), not old completed labels.

## Files / ownership

Console lane: `src/console/production-console-app.tsx`, `src/console/api-client.ts`, `src/console/orders/order-ui-types.ts`, `src/console/orders/orders-screen.tsx`, `src/console/orders/order-detail-screen.tsx`, `src/console/styles/console-layout.css`, `tests/browser/console-orders-contracts.test.ts`, `tests/e2e/console-orders.spec.ts`.
Storefront lane: `storefront/src/storefront-view-types.ts`, `storefront/src/api-client.ts`, `storefront/src/storefront-app.tsx`, `storefront/src/styles.css`, `tests/browser/storefront-orders-contracts.test.ts`, `tests/e2e/storefront-orders.spec.ts`.
These two lanes may execute concurrently only after phase4 contract is frozen, each owning its own files; neither runs build/lint/tests until both finish. Main integration owner runs verification once. No shared component framework extraction.

## UI design / steps

Follow `docs/design-guidelines.md`, current tokens/table/mobile/inline-confirmation patterns. No visual redesign.

### Console lane

1. Replace complete helper/types with markPaid, fulfill and createConsoleRefundRequest; retain cancel. Both API clients send X-Nexus-Order-Contract:2 on all Order reads/writes; client_contract_outdated displays reload guidance and does not retry a mutation. Body/key contracts exact C6. Request-state logic preserves action+Order+key+normalized fields across uncertain retries.
2. Inbox top: summary counts `Matching Orders / Pending / Paid / Fulfilled / Canceled / Open refund requests`, all from one API envelope. Say “Matching current filters”, not whole-store totals. Loading/error must not display summary from previous criteria alongside fresh rows. Search placeholder names payment references. Fixed 25-page next/previous remains.
   Preserve trimmed raw search text through ProductionConsoleApp and api-client; remove global NFKC conversion there. Server derives normalized Customer query independently; pasting a fullwidth external transaction reference must still match its stored literal evidence.
3. Inbox rows/cards represent ONE Order with multiple snapshot item names/qty, Order total, currency/reference/paymentReference/status/refund badge. No single first-line unit price presented as whole-Order unit price. Show concise first item + remaining item count if needed; detail always shows every line.
4. Detail: reference/paymentReference, Customer snapshot, item table qty/unit/line total/currency, Order total, Payment ledger source/method/external ref/recorded actor/time, status, separate refund section, chronological history. Legacy paid shows missing original payment-record information without asking for payment again.
5. Pending: inline **Record manual payment** panel with method/reference, exact total+currency, acknowledgment of external receipt; button **Mark Paid**. On success Paid exposes **Fulfill**, not Completed. Fulfill confirms an operational status change without claiming access was granted. Cancel appears only Pending. Zero-total copy must not claim a bank transfer occurred.
6. Paid/Fulfilled with no request: **Request refund for Customer** panel, reason, pending-only explanation, bootstrap demo provenance. Existing request replaces form and displays original reason/time/actor; no Approve/Reject or Execute. Both paths read same request, no local-only request object.
7. History displays bootstrap source honestly and preserves legacy completion distinction. User/system labels are defensive read support, not fake signed-in accounts. Show “Manual refunds require confirmation of an external return in a later step”; never say money returned in S3.
8. Preserve current stale-route generation guards, abort handling, cross-tab invalidation and unknown-result retries. One payment retry freezes method/reference/key, refund retry freezes reason/key. After POST200 + GET failure show action succeeded + Retry loading (no second mutation). Conflict refetches detail AND filtered list/summary. Old contract/legacy-key conflict requests a reload; no hidden old API retry.

### Storefront lane

1. Replace one-selected-product state with bounded cart selections (1–10, qty1–99), keeping existing simple/variant option UI. Customer reviews all items and currency/total, edits/removes a line before final submit. No cart database, account or localStorage secrets.
2. Send items[] and preserve frozen Create attempt when network result is uncertain. Validation errors keep valid cart/name/email; server field paths focus the correct line. Mixed-currency selection explains recovery before submission, with server final authority.
3. Private page lists every persisted item and stable Order/payment refs. Pending shows instructions; Paid/Fulfilled stop payment instructions and do not promise unavailable Product Access. Canceled shows canceled. No decision/execution invented.
4. Refund form eligible Paid/Fulfilled only with no existing request. Customer sees pending request regardless of whether Console or Customer created it. Do not expose actor/staff details/external payment ref/internal reconciliation note. Keep reason normalization, keyboard/error focus, same-request retry and route-change guards.

## Verification

After both lanes finish:
- `npm run typecheck`
- `npm run test:browser -- tests/browser/console-orders-contracts.test.ts tests/browser/storefront-orders-contracts.test.ts`
- Local runtime: apply latest migrations to explicitly verified local DB, launch Console/Storefront via runtime process supervisor at distinct configured origins; use existing Playwright reuseExistingServer. Never kill an unrelated service.
- `npm run test:e2e -- tests/e2e/console-orders.spec.ts tests/e2e/storefront-orders.spec.ts --trace=off`

Actual visual proof at 1280px and 375px: no horizontal overflow, all multi-line content accessible, summary/status filters/payment fields/refund reason keyboard reachable, field errors precise, retry frozen values, stale A response never paints B. Inspect screenshots of page content with emails redacted; no address bar/HAR/private URL/header/trace artifacts. Browser contract tests use mocked fetch and do not replace live two-origin E2E.

## Tasks

- [x] Complete Console inbox detail and action journey
- [x] Complete Storefront multi-product and private refund journey
- [x] Verify live desktop mobile and retry behavior

## Risks / next

Update both status/shape consumers together; no alias types. Acceptance fixtures should start with real UI-created Orders, not only HTTP seeding. Phase6 owns final project-wide checks, existing-data/redeploy evidence and documentation cutover.
