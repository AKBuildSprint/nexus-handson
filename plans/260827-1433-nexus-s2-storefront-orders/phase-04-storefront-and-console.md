---
phase: 4
title: "Storefront and Console"
status: completed
priority: P1
effort: ""
dependencies: [3]
---

# Phase 4: Storefront and Console

## Overview

Complete the Customer-facing Storefront journey and the Console Orders surface against persisted API data. Both surfaces render reduced server projections; neither calculates money, repairs history, or exposes private delivery/capability data.

## Requirements

- Storefront fetches catalog at load and when returning to the active page; no realtime subscription or local catalog persistence.
- Customer can distinguish Simple Product from Variant Product, must select an enabled Variant where required, and can choose quantity `1–99`.
- Checkout collects name/email, creates one Web Crypto capability plus one idempotency identity per submit attempt, keeps both only in retry state, and navigates to a reopenable fragment-only private Order URL on success. It renders server response rather than client-computed money.
- Customer private page renders only approved purchase-time selection, quantity, amount, currency, status, reference, and payment next-step.
- Console reaches an Orders sibling route through both desktop/mobile navigation and shows persisted safe values in loading, empty, error, desktop-table, and mobile-card states.
- UI is accessible and responsive; 375px mobile cannot hide Order data or overflow horizontally.

## Architecture

Storefront owns its own API client and app state because it targets a configured cross-origin API base. Console extends the production manual router (`ProductionConsoleApp`), existing same-origin `api-client.ts`, and `ConsoleShell`; it does not use the prototype-only `ConsoleApp`.

Use typed view models dedicated to Storefront and Console Orders. Do not reuse `OrderItemCatalogSnapshot` or `ProductDetailResponse` as view DTOs, because those shapes carry fields outside the surface allow-list.

## Related Code Files

- Create: Storefront Product/Variant selector, checkout form, private Order page, view models, and API client modules under `storefront/src/`
- Modify: Storefront bootstrap/style files from Phase 1
- Create: `src/console/orders/orders-screen.tsx`, `src/console/orders/order-ui-types.ts`
- Modify: `src/console/production-console-app.tsx`, `src/console/api-client.ts`, `src/console/layout/console-shell.tsx`, `src/console/styles/console-layout.css`
- Reuse: `src/console/products/product-list-screen.tsx` as loading/error/empty/table/mobile-card accessibility pattern; `src/console/styles/design-tokens.css`
- Create: `tests/browser/storefront-orders-contracts.test.ts`, `tests/browser/console-orders-contracts.test.ts`

## Implementation Steps

1. Implement Storefront catalog screen and selection state from `PublicCatalogResponse`. Simple Product submits `variantId: null`; Variant Product disables submit until exactly one enabled Variant matches the selected options.
2. At checkout start, generate the opaque capability with Web Crypto and an idempotency identity. Keep them in component retry state, send them only in the explicit API headers, reuse both after a retryable/lost response, and regenerate only after a definitive terminal outcome. Treat every displayed amount/total as a server response.
3. Navigate successful create to a Storefront-relative private route with the capability in `location.hash`, never path/query/storage. On direct/reloaded private route, read the fragment and send it in the private-read header. Render only the approved Customer-safe Order fields and static payment instruction.
4. Refetch catalog when Storefront becomes active again. A Console edit becomes visible through ordinary fetch, not push, polling, or a catalog copy.
5. Add Console Orders client functions and dedicated read-only view models. Extend `ProductionConsoleApp` manual route parsing/navigation/data loading for `/console/orders` without entangling Product dirty-editor state.
6. Generalize `ConsoleShell` desktop/mobile navigation and topbar active label for Products/Orders. Implement Orders screen states using existing Console tokens, semantic table/card pattern, live regions, retry, and explicit redaction.
7. Add browser contract tests for both UI surfaces, including accessibility, safe rendering, selection/quantity boundaries, and retry/error states.

## Todo

- [x] Build the separate Customer catalog, checkout, and private Order journey.
- [x] Add Storefront refetch and idempotent retry UX.
- [x] Add Console Orders routing, navigation, and responsive safe projection.
- [x] Cover UI contracts without duplicating server authority.

## Success Criteria

- [x] Simple and Variant Customer flows reach a fragment-only private Order page with server-returned purchase-time fields.
- [x] Variant Product cannot submit without one enabled valid selection; quantity controls remain within `1–99`.
- [x] Retryable/lost-response submit reuses its in-memory idempotency identity and capability and returns the original Order without duplicate creation.
- [x] Private page and Console Orders never render access content, private-file identity, raw capability, or capability URL.
- [x] Console Orders works via direct URL, navigation, back/forward, desktop table, and 375px mobile card view.

## Risk Assessment

- Storing a raw capability in browser storage or sending it in a path/query expands disclosure risk. Keep it in component memory before success and in the private URL fragment afterward; never put it in analytics/error logging.
- Reusing Product view types can accidentally render delivery data; force a reduced Orders view-model boundary.

## Security Considerations

- Mask/redact all capability/private delivery fields from UI error paths, telemetry hooks, and debug output.
- Client quantity/selection validation is UX only; API responses remain authoritative.
