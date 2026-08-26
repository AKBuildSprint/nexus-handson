# Nexus Console Phase 2 design approval

## Status

**Approved by explicit user selection on 2026-08-26.**

This record documents the approved browser-visible frontend prototype boundary. Approval authorizes Phase 3 design reconciliation and Cloudflare foundation work; it does not itself approve inferred routes, DTOs, schemas, storage keys, authentication, or deployment behavior.

## Implemented prototype scope

- Responsive Nexus Operations Console shell with Products as the only primary destination.
- Explicit design scenario harness sourced from `design/prototype-scenarios.ts`.
- Product list initial and filtered loading, empty, populated, filtered-empty, row-opening, template failure/retry, and request-error presentations.
- Product list traversal preserves the selected Product identity and path through create, edit, unified CSV import, and template download.
- Create and edit Product lifecycle presentation with Basics, Pricing, Public description, private Delivery, Variants, and recoverable save failure.
- Sticky desktop editor actions and a viewport-fixed safe-area Save action at 375 px.
- Blur validation, associated errors, child save blockers, error summary, durable saved state, and reset-safe dirty-discard guard.
- Product private-file no-file, current-file, validating byte signature, selection, replacement, removal, invalid-content, mismatched-extension, and oversize presentation.
- Option groups from 0 to 5, values from 0 to 10, empty-group validation, participating-group controls, and live Cartesian count.
- Explicit design boundary scenarios for 10 normal, 11 warning, 30 confirmed maximum, and 31 blocked.
- Generated Variant rows with editable suggested SKU, effective-price source, enabled state, delivery source, actual Product-default access summary, persisted complete delivery override, and focused-editor dirty/revert guards. Required override fields show neutral prerequisites, keep Apply disabled while empty, and expose associated errors after blur. Focused SKU and price errors appear only after their field is left or Apply is attempted. The full-width 375 px focused editor exposes SKU, price override, enabled state, and delivery together.
- Structural regeneration effects derived from edited groups and current rows, with controlled Retained, New, and Will disable outcomes plus duplicate and existing-SKU conflict blockers.
- Unified CSV template loading, success, error, retry, and download states; native file selection and drop enhancement; client UTF-8, 1 MB, ordered-header, malformed-row, empty-file, and 500-row checks. The downloadable and re-importable examples use canonical lowercase `draft|active|archived` Product statuses and `enabled|disabled` Variant statuses while Console labels remain title-cased.
- Selected CSV parsing owns required Product fields, same-slug consistency, SKU and combination identities, exact-repeat Duplicate candidates, simple/Variant detection, grouped errors, threshold blockers, confirmation, and import eligibility. A 31-or-more group alone is rejected while other eligible groups can proceed. Browser preview preserves source-ordered row identity, provisional outcome, and reason in desktop and mobile details. Explicit 11/30 confirmations, Uploading, Server checking, file failure, server validation failure, success, mixed, all-Duplicate, all-Rejected, and result-error fixtures are included, with durable result focus after normal completion and failure retry.
- Additive exact-match copy. The workspace explicitly states that imports do not update existing Products or Variants.
- Desktop table structures and 375 px semantic summary transformations with no intentional horizontal page scrolling.
- Visible focus treatment, 44 px minimum targets, native dialogs for focus containment, Escape behavior, focus restoration, and reduced-motion handling.
- One centralized dirty-navigation guard covers editor Back, ConsoleShell Products, scenario journey or editor-state changes, and browser Back/Forward. Stay preserves the current route and all local Product, Variant, delivery, and file edits. Discard resets the editor before the requested destination. Supported Console paths bootstrap directly and real journey transitions use browser history without a router dependency.

## Review checklist

- [x] Desktop Product list hierarchy, density, and action order reviewed.
- [x] Desktop create and edit Product journeys reviewed.
- [x] Desktop Variant option builder, matrix, regeneration preview, and focused delivery editor reviewed.
- [x] Desktop unified CSV workspace and durable result presentation reviewed.
- [x] Exact 10, 11, 30, and 31 combination states understood from the interface alone.
- [x] Editable suggested SKU and Base price versus Override source understood.
- [x] Product default versus complete Variant delivery override understood.
- [x] Retained, New, and Will disable regeneration outcomes understood.
- [x] CSV simple versus Variant detection and grouped row reasons understood.
- [x] CSV UTF-8, 1 MB, 500-row, 30-confirmation, and 31-blocked boundaries understood.
- [x] Exact-match additive behavior and no-overwrite consequence understood.
- [x] 375 px Product list, editor, matrix summaries, focused dialog, CSV groups, and long-content wrapping reviewed.
- [x] Keyboard order, skip link, focus rings, dialog containment, Escape behavior, focus restoration, and error associations reviewed.
- [x] Loading, empty, dirty, warning, error, disabled, and success states reviewed.
- [x] Industrial-utilitarian visual direction, variance 3, motion 2, and density 6 approved.
- [x] Information architecture and interaction flow explicitly approved by the user.

## Evidence slots

| Evidence | Verified artifact or note |
| --- | --- |
| Desktop Product list | `.artifacts/screenshots/20260826-030504-nexus-prototype/01-desktop-product-list.png` |
| Desktop Product editor | `.artifacts/screenshots/20260826-030504-nexus-prototype/02-desktop-variant-editor.png` |
| Desktop Variant builder and 10/11/30/31 meter | `.artifacts/screenshots/20260826-030504-nexus-prototype/03-boundary-10.png` through `07-boundary-31-blocked.png` |
| Desktop focused Variant editor | `.artifacts/screenshots/20260826-030504-nexus-prototype/13-mobile-focused-variant-editor.png`; the same native dialog is used at desktop width |
| Desktop CSV previews, errors, warning, and result | `.artifacts/screenshots/20260826-030504-nexus-prototype/08-csv-11-warning.png` through `10-csv-durable-results.png` |
| 375 px Product editor | `.artifacts/screenshots/20260826-030504-nexus-prototype/12-mobile-variant-editor.png`; measured document width 360 px in a 375 px viewport |
| 375 px Variant summary and focused dialog | `.artifacts/screenshots/20260826-030504-nexus-prototype/12-mobile-variant-editor.png` and `13-mobile-focused-variant-editor.png` |
| 375 px CSV workspace | `.artifacts/screenshots/20260826-030504-nexus-prototype/11-mobile-csv-results.png`; measured document width 360 px in a 375 px viewport |
| CSV template and client bounds | `.artifacts/docs/20260826-030504-nexus-prototype/nexus-product-import-template.csv` and screenshots `14-template-reimport-preview.png` through `16-csv-row-limit-rejection.png` |
| Private-file byte validation | `.artifacts/screenshots/20260826-030504-nexus-prototype/17-invalid-delivery-file.png` |
| Keyboard and navigation walkthrough | First Tab focused `Skip to main content`; Stay preserved dirty edits and `/console/products/focus-pack`; direct `/console/products/import` and browser Back restored the import journey |
| Complete verification report | `.artifacts/report/20260826-030504-nexus-prototype/report.html` |
| Requested revisions | None recorded yet |
| Explicit approval statement | User selected **Approve Phase 2 design** on 2026-08-26 after reviewing the verification summary and evidence paths. |

## Approval gate

The Phase 2 frontend approval gate is satisfied. Phase 3 design reconciliation and Cloudflare foundation work may begin.

Phase 3 must still reconcile the approved fields and interactions into explicit Worker routes, DTOs, D1 transactions, R2 lifecycle, tests, and deployment contracts before backend implementation. Approval does not introduce authentication, inventory, analytics, custom-domain behavior, CSV upsert behavior, import background jobs, or production fallback fixtures.

## Approval decision

**Approved.** Information architecture, industrial-utilitarian visual direction, density, responsive behavior, and interactions were explicitly accepted by the user on 2026-08-26.
