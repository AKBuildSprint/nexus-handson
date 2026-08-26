---
phase: 4
title: "Catalog Domain API and Private Files"
status: pending
priority: P1
effort: "2d"
dependencies: [3]
---

# Phase 4: Catalog Domain API and Private Files

## Context Links

- [Locked machine reconciliation](../../design/contract-reconciliation.md)
- [Acceptance authority `nexus-s1-reconciled-1`](../../design/reconciled-acceptance-manifest.md)
- [Approved frontend prototype](./phase-02-frontend-prototype-and-approval.md)
- [Cloudflare D1 batch behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)

## Overview

Implement Phase 4 ownership: `API-001..007`, `API-011..016`, `DATA-001..007`, `MONEY-*`, `VAR-*`, `FILE-*`, `PRIV-*`, `SNAP-*`, and Product `UI-*`. Produce their locally available `L/C/P` evidence only. `DATA-008` belongs to Phase 5; every required `R` artifact belongs to Phase 6.

## Requirements

- Functional:
  - Idempotent bootstrap Store `store_nexus`; list/filter, get by stable slug, create, edit, refresh/reopen simple and Variant Products.
  - Preserve selected Product browser route/history: row push by slug, create replace from `/new`, edit path stability, direct deep-link load, and dirty Back/Forward guard.
  - One active schema with exact 5-group, 10-value, 30-combination caps; 11-30 confirmation; 31 rejects before writes.
  - Stateless structural preview for create/edit and atomic structural apply only on Product Save. Regenerate remains local dirty UI; rename-only uses nonstructural update.
  - Nonstructural update carries exact existing group/value IDs with group names/value labels only plus existing Variant edits; create/apply owns Variant fields only in schema rows. Reject misplaced copies and treat add/remove/reorder/participation/membership as structural.
  - SchemaDraft gives every existing/new group/value a request-local `draftRef`; rows use `selectedValueRefs`; server validates/maps refs and persists only server IDs.
  - Stable Variant identity, deterministic editable SKU suggestions, Store-SKU/Product-combination uniqueness, disable obsolete, reactivate historical combination ID.
  - Exact decimal-string money conversion to integer minor units and effective price fallback.
  - Product default delivery plus discriminated complete Variant override; no partial fallback.
  - Exact Product/Variant private file PUT and DELETE semantics for PDF/ZIP through 25,000,000 actual bytes.
  - `GET /api/storefront/products` returns only the exact active/enabled Customer-safe allow-list.
  - Private internal snapshot resolver copies selected identities/options, effective minor price/currency, effective access fields, and immutable file key for S2/S5; no route/Order table.
- Non-functional:
  - All reads/writes scope to bootstrap Store; ignore/reject client Store identity.
  - Every aggregate mutation uses revision `ETag`/required `If-Match` and one bounded atomic D1 batch.
  - Composite keys/FKs and uniqueness/triggers are final race-safe boundaries; bypass tests own cross-scope and 5/10/30 enforcement.
  - Stream files; inspect/reconstruct prefix and count actual bytes without cloning/buffering 25 MB.
  - R2-first/D1-second compensation; old committed keys are retained. No file-read route/public URL.
  - Every non-2xx uses the reconciled stable error envelope; no key/internal details in response.

## Architecture

### D1 migrations and aggregate invariants

`0001-store-products.sql` owns idempotent `store_nexus` and Products with stable slug/revision, canonical SHA-256 `import_fingerprint`, integer minor price, lowercase status, public description, private default delivery metadata, and unique `(store_id,slug)`. Every aggregate write increments revision and updates fingerprint.

`0002-product-variants.sql` owns ordered groups/values, Variants, and membership:

- composite FKs keep every group/value/Variant/membership in one Product/Store;
- unique `(store_id,sku)`, `(product_id,combination_key)`, and Variant/group membership;
- comparison keys use NFKC + trim + locale-independent lowercase while preserving labels;
- canonical combination is ordered stable `groupId:valueId`, never labels;
- triggers reject group 6, value 11, and materialized combination 31;
- every enabled Variant has exactly one value per active group;
- obsolete rows disable; a historical key reactivates its stable ID.

### Exact Product/schema routes

| Route | UI owner | Write boundary |
| --- | --- | --- |
| `GET /api/console/products?q=&status=all|draft|active|archived` | `PL-*` list/filter/retry | Read only; exact list DTO/order. |
| `GET /api/console/products/by-slug/:productSlug` | direct/open editor | Read only; field-complete detail + `ETag`. |
| `POST /api/console/products/schema/preview` | create/edit preview | Exact `{productId,productSlug,product:ProductCoreFields,schema}`; existing `If-Match`; hash exact ProductCore+schema; exact DTO; zero state/stable IDs. |
| `POST /api/console/products` | create Save | Validate refs/count/confirmation/limits; recompute hash over exact ProductCore+schema; stale 409/no write; valid atomic ref→new stable-ID create, `201`/Location/ETag. |
| `PUT /api/console/products/:productId` | unchanged-schema Save/rename | Exact Product/optionLabels/variantEdits; structural/misplaced rejects. |
| `PUT /api/console/products/:productId/schema` | Save after regeneration | `If-Match`; exact ProductCore/schema/hash; recompute; stale hash 409/no write; valid atomic server-ID lifecycle. |

`ProductDetailResponse` MUST match the field-by-field reconciliation type: identity/status/type/currency/base/public fields; Product access/file summary; ordered participating groups/values; every Variant's canonical key, selected IDs+current labels, SKU/status, override/effective price and source, effective private delivery source/access/file; timestamp and revision. No storage key.

Create/structural routes reject `variantEdits`/`product.variants`; nonstructural rejects `schema`; repeated/mismatched copies return `variant_payload_ambiguous`. `optionLabels` may only rename exact existing IDs; add/remove/reorder/participation/membership returns `schema_preview_required`.
Schema preview returns refs, never newly persisted IDs. Group refs are unique among groups; value refs globally unique among values. Existing IDs must belong to Product; new use null. Each row resolves exactly one value ref per participating group and none elsewhere. Duplicate/missing/unknown/reused-ID/cross-group refs return `invalid_draft_reference`; apply maps refs to pre-generated stable IDs and never persists refs.

### File lifecycle routes

| Route | D1 | R2 |
| --- | --- | --- |
| `PUT /api/console/products/:productId/delivery-file` | Conditional association/revision after object success. | Stream to new `delivery/<uuid>`; compensate new object on D1 failure; retain old. |
| `DELETE /api/console/products/:productId/delivery-file` | Clear active association/revision. | Do not delete historical object. |
| `PUT /api/console/products/:productId/variants/:variantId/delivery-file` | Same, only for a complete saved Variant override. | Same random/compensated/retain-old rule. |
| `DELETE /api/console/products/:productId/variants/:variantId/delivery-file` | Clear file but keep complete override text/mode. | Do not delete historical object. |

PUT requires `If-Match`, raw `application/octet-stream`, and percent-encoded UTF-8 `X-Nexus-Filename`. A browser/network-supplied `Content-Length` is an optional early bound; counted actual bytes are authoritative. Reject byte 25,000,001; detect `%PDF-` or ZIP `PK` signatures from actual prefix; reconstruct counted stream and verify saved size/checksum. Returning a Variant to Product default clears active override/file association in the Product aggregate transaction but retains its historical object.

### Stable errors and public projection

All errors use `{error:{code,message,fields:[{path,code,message}],incidentId}}`, including `route_not_found`. Implement the exact registry, stable paths, ambiguous payload, revision/schema/limit/identity/file/persistence/compensation codes; never expose keys.

`GET /api/storefront/products` is built only from the public allow-list. It returns active Products, enabled current-schema Variants, reachable options, stable identities/SKU/selections, and minor prices; it recursively excludes access/delivery/file/storage/R2/import data.

### Private S2/S5 snapshot seam

`resolveOrderItemCatalogSnapshot({productId,variantId})` is an internal D1-only module with no route/table. It returns exact Product/Variant identity, selected option IDs/current labels, effective unit minor price/currency, effective Product-default-or-complete-Variant access title/instructions, and immutable private-file key. It requires active Product; simple requires null Variant; Variant Product requires enabled current-schema belonging Variant. Tests cover simple/default, Variant/default, Variant/override, mismatch/disabled/missing selection, and copied snapshot immutability after catalog/file edits.

### Selected Product/history behavior

List DTO supplies stable slug. Browser uses `pushState` to open; direct slug route fetches detail; create success uses `replaceState` to returned slug; edit stays on the slug. The central dirty guard performs no Worker request until Stay/Discard is resolved. This is frontend integration of approved behavior, not a router dependency or browser design change.

## Related Code Files

- Create: `/Users/itsddvn/projects/nexus-handson/migrations/0001-store-products.sql`
- Create: `/Users/itsddvn/projects/nexus-handson/migrations/0002-product-variants.sql`
- Create: `/Users/itsddvn/projects/nexus-handson/src/shared/catalog-status.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/catalog/catalog-types.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/catalog/money.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/catalog/slug.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/catalog/product-validation.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/catalog/variant-matrix.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/catalog/schema-change.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/catalog/catalog-read.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/catalog/catalog-write.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/catalog/public-catalog.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/catalog/private-order-snapshot.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/files/delivery-file.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/worker/console-product-routes.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/worker/console-file-routes.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/worker/storefront-product-routes.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/api-client.ts`
- Modify: approved files under `/Users/itsddvn/projects/nexus-handson/src/console/products/`
- Verify preserved invariant: `/Users/itsddvn/projects/nexus-handson/design/prototype-scenarios.ts` remains outside production inputs.
- Create: `/Users/itsddvn/projects/nexus-handson/tests/unit/money.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/unit/slug.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/unit/variant-matrix.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/unit/schema-change.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/unit/delivery-file.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/catalog-crud.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/product-create-schema.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/migration-constraints.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/schema-regeneration.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/public-catalog.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/delivery-replacement.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/private-order-snapshot.test.ts`

## Implementation Steps

1. Implement migrations/bootstrap, revision column, composite FKs/uniqueness/triggers, and fresh local apply.
2. Add bypass tests for cross-Store/Product/group membership and exact 5/10/30 caps.
3. Implement exact Product/list/detail/request/error DTOs, strict unknown-field parsing, and one Variant owner per route.
4. Implement nonstructural `optionLabels` exact stable-ID rename and `variantEdits`; reject structural/misplaced/duplicate data with zero write.
5. Implement decimal money, stable slug, normalized identity, canonical combinations, deterministic SKU, revision and import fingerprint updates.
6. After migrations, test API-003 create stale-hash zero-write and successful stable-ID mapping, plus exact API-005 preview and API-006 apply If-Match/DTO/no-write/recompute/stale/atomic behavior.
7. Connect stable-slug bootstrap/history and field-complete authoritative detail/errors to approved UI.
8. Implement Product-default/complete-Variant delivery plus private exact snapshot resolver; add no Order route/table.
9. Implement Product/Variant raw file PUT/DELETE, stream/signature/size, compensation, history retention.
10. Implement public allow-list and recursive forbidden-key tests.
11. Run D1 bypass/aggregate rollback, DTO ownership/detail schema, snapshot immutability, and route_not_found tests.
12. Run production graph denial and browser-drive unchanged desktop/375 px list/editor/Variant/file/history flows.

## Todo

- [x] Store/Product/Variant migrations and bootstrap complete
- [x] Money/slug/validation invariants implemented
- [x] One active schema and 10/11/30/31 behavior implemented
- [x] Variant identity/reversion/regeneration implemented
- [x] Private file stream and compensation implemented
- [x] Approved Product/Variant frontend connected to real APIs
- [x] Customer-safe Storefront projection implemented
- [x] S2 private snapshot resolver contract protected

## Success Criteria

- [x] Phase 4-owned IDs (`API-001..007/011..016`, `DATA-001..007`, `MONEY/VAR/FILE/PRIV/SNAP`, Product `UI`) have all locally available `L/C/P` evidence; no Phase 4 success claim requires `R`.
- [x] Field-complete Product detail and stable error corpus, including `route_not_found`, match exact schemas.
- [x] API-003 Variant create validates refs/count/confirmation/limits, recomputes exact-payload hash, stale 409 writes zero, and success atomically persists mapped stable IDs.
- [x] API-005 exact preview route/body/DTO/If-Match writes no state; API-006 recomputes hash, stale 409 writes zero, valid apply atomically persists server IDs only.
- [x] Simple/Variant create/edit/list/reopen/history and 10/11/30/31 identity/lifecycle behavior pass after migrations.
- [x] Revision/import fingerprint updates, D1 constraints, decimal effective pricing, and complete delivery pass.
- [x] PDF/ZIP exact boundaries, compensation, remove/default association clear, and historical retention pass.
- [x] Public allow-list recursively excludes private data.
- [x] Snapshot resolver copies exact simple/Variant/default/override identities/options/price/access/private key and remains immutable after later catalog edits, with no public route.
- [x] Approved desktop/375 px behavior and production graph exclusion remain unchanged.

## Risk Assessment

- Risk: persistence on Regenerate contradicts approved `SR-APPLIED-DIRTY`.
  - Signal: preview route changes D1 or UI becomes Saved before Product Save.
  - Response: stop; restore stateless preview/local apply and atomic Save route.
- Risk: request carries two Variant owners or rename data cannot be represented.
  - Signal: structural payload contains Variant edits outside schema rows, nonstructural lacks stable option IDs, or implementation chooses precedence.
  - Response: reject ambiguous payload; preserve exact route-owned DTO and label-only ID-set rule.
- Risk: aggregate/file sequence yields recoverable partial save.
  - Signal: JSON save succeeds but selected replacement fails.
  - Response: keep authoritative saved text, current file association, and local recoverable selection; idempotent retry completes file route without claiming rollback of saved text.
- Risk: D1 statement budget or constraints regress from Phase 3 proof.
  - Signal: Product mutation reaches 50 queries, >100 bindings/query, or bypass insert succeeds.
  - Response: stop and revise JSON-bulk/chunk implementation; do not change limits.
- Risk: R2 compensation delete fails.
  - Signal: object remains after bounded retries.
  - Response: emit private incident evidence/opaque public incident ID and fail acceptance; never claim no orphan.
- Risk: public DTO leaks via Console object reuse.
  - Signal: recursive key scan finds access/delivery/file/storage/import vocabulary.
  - Response: construct only from explicit public allow-list and block deployment.
- Risk: anonymous Console is abused.
  - Signal: unexpected mutations/objects or quota pressure.
  - Response: preserve accepted S1 scope, document `RISK-*`, and defer authorization to S4.

