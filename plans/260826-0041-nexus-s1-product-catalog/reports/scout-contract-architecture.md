# Contract and architecture scout

## Summary

- Repository is greenfield: briefs/reports only; no package, Worker, UI, migration, config, source or test files.
- Canonical product contract: [`../../reports/brainstorm-2026-08-25-session-1-nexus-product-console.md`](../../reports/brainstorm-2026-08-25-session-1-nexus-product-console.md).
- S1 implementation owner: [`../../../session-1-brief.md`](../../../session-1-brief.md).
- S2 consumer contract: [`../../../session-2-brief.md`](../../../session-2-brief.md).
- S5 entitlement contract: [`../../../session-5-brief.md`](../../../session-5-brief.md).
- Frontend design/prototype must complete and receive explicit user approval before backend/data implementation.
- After approval, reconcile UI fields/states with routes, DTOs, D1 transactions and R2 lifecycles before continuing.

## Required architecture boundaries

- One TypeScript Cloudflare Worker.
- One D1 catalog and one private R2 bucket.
- Console and `GET /api/storefront/products` share one Store-scoped catalog.
- Console/write/upload routes intentionally public in S1; never claim authorization.
- Product has one active Variant schema, max 5 groups, 10 values/group and 30 materialized combinations.
- 11-30 combinations require confirmation; more than 30 is rejected in browser and Worker.
- Unified CSV is additive exact-match, max 1 MB and 500 data rows.
- Product/Variant delivery files: PDF/ZIP, max 25 MB, random immutable R2 keys.
- Wrangler CLI deploys directly under one randomly suffixed Worker name persisted in `wrangler.jsonc`; workers.dev only.

## Frontend-first journey inventory

1. Product list: loading, empty, populated and error states.
2. Product editor: clean, dirty, invalid, saving, saved and server-conflict states.
3. Variant builder: group/value editing, participation selection, 0-10 normal, 11-30 warning/confirmation, 31 blocked.
4. Schema change: rename-only and structural regenerate preview with retained/new/obsolete combinations.
5. Delivery editor: inherit/override, file selected/rejected/uploaded/replacement failure.
6. CSV workspace: template download, browser preview, detected Product types, counts, confirmation, server result and row errors.
7. Responsive/accessibility: desktop, 375px, keyboard navigation, associated errors, focus and live status.

## Recommended data migrations

1. `migrations/0001-store-products.sql`: Store, Product and idempotent bootstrap Store.
2. `migrations/0002-product-variants.sql`: option groups/values, Variants and memberships; active flags preserve history.
3. `migrations/0003-imports.sql`: import metadata and counts; row details remain response-only.

## Candidate source boundaries

- `src/shared/`: fixed limits, CSV header/examples and shared DTO types.
- `src/catalog/`: money, slug, validation, matrix generation, schema diff, D1 read/write and public projection.
- `src/files/`: delivery-file validation, R2 writes and compensation.
- `src/import/`: parse, validate, classify and orchestrate.
- `src/routes/`: Console catalog/files/import and Storefront catalog routes.
- `src/console/`: approved React shell, Product list/form, Variant matrix, schema preview, delivery editor and import workspace.
- `tests/unit/`, `tests/integration/`, `tests/e2e/`: behavior-specific verification.

## Design-gated decisions

Resolve after prototype approval, before migrations/API implementation:

- Exact form grouping, endpoint granularity and JSON error shapes.
- Active/retired group/value representation and schema-reversion behavior.
- Exact-match normalization for text, option order and null values.
- Exact template example values and row-error presentation.
- File replacement endpoint boundaries and progress states.
- Public DTO ordering and price-range display.

## Fixed planning decisions

- CSV UTF-8 with optional BOM, LF/CRLF, RFC 4180 quoting; 1 MB and 500 data rows.
- One active Variant schema; structural changes regenerate and disable obsolete combinations.
- Existing canonical combination reuses/reactivates historical identity rather than creating a second identity.
- Random Worker suffix is generated once, persisted and reused.
- No custom domain, deploy wrapper, import dashboard, background import or configurable-limit admin.

## Status

**Status:** DONE
**Summary:** Greenfield evidence and phase boundaries confirmed. Frontend design approval is the hard prerequisite for backend work.
**Concerns/Blockers:** Public mutation/upload is an accepted resource-abuse risk. R2 delete failure needs bounded retry plus explicit incident evidence; it cannot be made impossible without excluded background cleanup.
