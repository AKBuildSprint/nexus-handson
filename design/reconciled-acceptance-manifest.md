# Nexus S1 reconciled acceptance manifest

```yaml
manifest_id: nexus-s1-reconciled-1
manifest_version: 1
approved_prototype_date: 2026-08-26
contract_owner: design/contract-reconciliation.md
phase_6_authority: true
status: locked-for-implementation
```

## How to read and verify this manifest

Each row is one atomic acceptance record. RFC 2119 `MUST` is literal. Phase 6 must create an evidence ledger with exactly these columns:

```text
manifest_id | environment | artifact_paths | command_or_scenario | observed | pass
```

Evidence classes in the tables resolve as follows:

- `P`: existing approved-prototype evidence at the exact paths in **Prototype evidence registry**.
- `L`: local evidence under `plans/260826-0041-nexus-s1-product-catalog/reports/evidence/local/<MANIFEST-ID>/`.
- `R`: remote workers.dev evidence under `plans/260826-0041-nexus-s1-product-catalog/reports/evidence/remote/<MANIFEST-ID>/`.
- `C`: reviewable configuration/build-graph evidence under `plans/260826-0041-nexus-s1-product-catalog/reports/evidence/config/<MANIFEST-ID>/`.

A required class cannot be replaced by prose. Request/response bodies must be captured with secrets and private object keys redacted. Private storage evidence may record an opaque fixture alias and checksum, never a public URL. Every ID below must appear exactly once in the Phase 6 evidence ledger. Missing, stale, contradictory, or failed evidence fails the manifest.

## Prototype evidence registry

| Key | Exact approved artifact |
| --- | --- |
| `P-REPORT` | `.artifacts/report/20260826-030504-nexus-prototype/report.html` |
| `P-LIST` | `.artifacts/screenshots/20260826-030504-nexus-prototype/01-desktop-product-list.png` |
| `P-EDITOR` | `.artifacts/screenshots/20260826-030504-nexus-prototype/02-desktop-variant-editor.png` |
| `P-BOUNDARY` | `.artifacts/screenshots/20260826-030504-nexus-prototype/03-boundary-10.png` through `07-boundary-31-blocked.png` |
| `P-CSV` | `.artifacts/screenshots/20260826-030504-nexus-prototype/08-csv-11-warning.png` through `10-csv-durable-results.png` |
| `P-MOBILE` | `.artifacts/screenshots/20260826-030504-nexus-prototype/11-mobile-csv-results.png` through `13-mobile-focused-variant-editor.png` |
| `P-TEMPLATE` | `.artifacts/docs/20260826-030504-nexus-prototype/nexus-product-import-template.csv` and screenshots `14-template-reimport-preview.png` through `16-csv-row-limit-rejection.png` |
| `P-FILE` | `.artifacts/screenshots/20260826-030504-nexus-prototype/17-invalid-delivery-file.png` |
| `P-APPROVAL` | `design/approval.md`, explicit approval dated `2026-08-26` |

## Exact constants registry

```yaml
console_routes:
  - /console/products
  - /console/products/new
  - /console/products/:productSlug
  - /console/products/import
api_prefixes:
  console: /api/console
  public_catalog: /api/storefront/products
product_statuses: [draft, active, archived]
variant_statuses: [enabled, disabled]
option_groups_max: 5
option_values_per_group_max: 10
combinations_normal_max: 10
combinations_confirmation_min: 11
combinations_confirmation_max: 30
combinations_blocked_min: 31
csv_filename: nexus-product-import-template.csv
csv_header_columns: 21
csv_bytes_max: 1000000
csv_first_rejected_byte: 1000001
csv_data_rows_max: 500
csv_first_rejected_row: 501
delivery_file_bytes_max: 25000000
delivery_file_first_rejected_byte: 25000001
delivery_file_kinds: [pdf, zip]
worker_name_pattern: ^nexus-s1-[a-z0-9]{6}$
d1_name_suffix: -db
r2_name_suffix: -private
d1_binding: DB
r2_binding: FILES
d1_queries_per_invocation_max: 50
d1_bound_parameters_per_query_max: 100
phase3_worst_case_query_count: 45
bootstrap_store_id: store_nexus
bootstrap_store_slug: nexus
parser: papaparse@5.7.0
node_minimum_major: 22
cloudflare_vite_plugin: 1.54.0
wrangler: 4.126.0
cloudflare_vitest_pool_workers: 0.22.0
vitest: 4.1.11
playwright: 1.62.1
```

## UI records

| ID | Contract | Evidence |
| --- | --- | --- |
| `UI-001` | `P-APPROVAL` MUST remain the approval authority; implementation MUST preserve the approved industrial-utilitarian presentation, density `6/10`, variance `3/10`, motion `2/10`, labels, and interactions. | `P,L,R` browser comparison/report. |
| `UI-002` | Product list MUST expose loading, catalog-empty, populated, filtered-loading, filtered-empty, request-error/retry, row-opening, template loading/success/error, search, and `All|Draft|Active|Archived` filters without false empty state. | `P-LIST,L,R`. |
| `UI-003` | Browser IA MUST remain exactly the four `console_routes`; direct Product/import deep links and real Back/Forward MUST work. No new destination may appear. | `P-REPORT,L,R`. |
| `UI-004` | Opening a row MUST use its stable slug path. Create success MUST replace `/new` with `/console/products/<returned-slug>`; edit success MUST preserve path; both MUST remain in durable **Saved** context. | `L,R` history + request evidence. |
| `UI-005` | One dirty-navigation guard MUST cover editor Back, Products, scenario/journey changes in development, and browser Back/Forward. Stay MUST preserve route/local Product/Variant/delivery/file edits; Discard MUST reset before completing the requested transition; Escape means Stay. | `P-REPORT,L,R`. |
| `UI-006` | Editor MUST preserve default/loading/ready/dirty/invalid/saving/save-error/saved/save-disabled/status-dirty and discard-warning behavior. Server errors MUST retain dirty input and attach through stable field paths. | `P-EDITOR,L,R`. |
| `UI-007` | Product fields MUST remain name, decimal base price, ISO currency, `Draft|Active|Archived`, optional public description, required private access title/instructions, optional PDF/ZIP, and Variants. Manual slug editing MUST NOT appear. | `P-EDITOR,L,R`. |
| `UI-008` | Option builder MUST preserve `0..5` groups, `0..10` values, participation controls, empty/duplicate errors, one active schema, and exact meter behavior at `10`, `11`, `30`, `31`. | `P-BOUNDARY,L,R`. |
| `UI-009` | Structural preview MUST render ordered `Retained|New|Will disable`; **Regenerate** MUST only update local dirty editor state; Product Save MUST be the persistence action. Rename-only MUST NOT show regeneration. | `P-EDITOR,L,R`. |
| `UI-010` | Variant rows/focused editor MUST preserve editable suggested SKU, effective price and `Base price|Override`, `Enabled|Disabled`, `Product default|Variant override`, complete override fields, actual inherited summary, dirty/revert guard, and field blur/apply errors. | `P-EDITOR,P-MOBILE,L,R`. |
| `UI-011` | Product/Variant file UI MUST preserve no-file/chosen/checking/valid PDF/valid ZIP/type-error/size-error/replacement/remove/save-error states. Current saved file MUST remain visible until replacement succeeds; UI MUST NOT claim historical object deletion. | `P-FILE,L,R`. |
| `UI-012` | CSV workspace MUST preserve template/download, native choose/drop enhancement, parsing/error, Simple/Variant grouped preview, source-ordered rows/reasons, warning confirmation, blocked group, uploading/server-checking, success/mixed/all-Duplicate/all-Rejected/result-error, durable result focus, and retry. | `P-CSV,P-TEMPLATE,L,R`. |
| `UI-013` | If one Product group is `31+`, it MUST remain visibly Rejected while other eligible groups remain importable. If no group is eligible, Import MUST remain disabled. | `P-CSV,L,R`. |
| `UI-014` | Browser preview labels MUST be `Ready|Duplicate candidate|Rejected`; only server results may use `Added|Duplicate|Rejected`. Server result MUST supersede preview without a toast-only result. | `P-CSV,L,R`. |
| `UI-015` | Desktop tables/drawers and exact `375 px` semantic summaries/full-width dialog MUST preserve all decision fields and have no intentional horizontal page scroll. | `P-LIST,P-EDITOR,P-MOBILE,L,R` screenshots plus width measurement. |
| `UI-016` | First Tab skip link, visible focus, `44x44 px` targets, blur validation, associated errors, summary focus, dialog containment/Escape/restoration, keyboard file action, live announcements, and reduced motion MUST remain. | `P-REPORT,L,R`. |

## API records

| ID | Contract | Evidence |
| --- | --- | --- |
| `API-001` | List MUST be `GET /api/console/products` with optional `q` and `status=all|draft|active|archived`; defaults empty/`all`; order `updatedAt DESC,id ASC`; response is the exact list allow-list in reconciliation. | `L,R` requests/responses. |
| `API-002` | Detail MUST be `GET /api/console/products/by-slug/:productSlug`, return the exact field-by-field `ProductDetailResponse` from reconciliation plus `ETag`, including ordered groups/values, selected option IDs+labels, effective price/source, effective private delivery/file summaries, and revision but no storage key. | `L,R` schema corpus and responses. |
| `API-003` | Create MUST be `POST /api/console/products` with `{product:ProductCoreFields,schema:SchemaDraft|null,previewHash:string|null}`. Simple requires both null. Variant create validates draft/selected refs, count, confirmation and limits; recomputes hash over exact create payload; mismatch is `409 schema_preview_stale` with zero writes. Success atomically maps refs to new stable IDs and returns `201` ProductMutationResponse, slug Location and ETag. | `L,R` stale-zero-write and stable-mapping evidence. |
| `API-004` | Nonstructural edit MUST be `PUT /api/console/products/:productId` with `If-Match` and exact `{product,optionLabels,variantEdits}`. `optionLabels` carries the exact existing stable group/value IDs plus group names/value labels only; `variantEdits` is the only Variant owner. Add/remove/reorder/participation/membership returns `schema_preview_required`. | `L,R`. |
| `API-005` | Preview MUST be `POST /api/console/products/schema/preview` with `{productId:null|string,productSlug:string,product:ProductCoreFields,schema:SchemaDraft}`; existing preview requires `If-Match`. Return exact DTO; hash canonical exact ProductCore+schema; validate refs/count/flags; create no stable IDs and write no state. | `L,R` route/response/absence evidence. |
| `API-006` | Apply MUST be `PUT /api/console/products/:productId/schema` with `If-Match` and JSON `{product:ProductCoreFields,schema:SchemaDraft,previewHash:string}`. Worker MUST revalidate refs, recompute preview/hash/count; stale hash returns `409 schema_preview_stale` with zero write; valid apply atomically maps refs to server IDs and commits Product/schema/Variant/membership, returning exact ProductMutationResponse/new ETag. | `L,R` route/atomicity corpus. |
| `API-007` | Product file MUST use exact PUT/DELETE routes; Variant file MUST use exact nested PUT/DELETE routes. PUT headers/body and DELETE no-body semantics MUST match reconciliation. | `L,R`. |
| `API-008` | Template MUST be `GET /api/console/imports/template`, `text/csv; charset=utf-8`, exact attachment filename/body. | `L,R`. |
| `API-009` | Import MUST be `POST /api/console/imports` with raw CSV and exact headers. `X-Nexus-Confirm-Variants:true` is required iff an otherwise-eligible `11..30` group exists. | `L,R`. |
| `API-010` | Import result MUST match exact ordered `ImportResultResponse`; every source row has exactly one authoritative outcome/reason; identity conflict is Rejected, never Duplicate. | `L,R`. |
| `API-011` | Public catalog MUST be only `GET /api/storefront/products` and match the exact public allow-list. | `L,R`. |
| `API-012` | `/api` and all unmatched `/api/*` MUST return JSON `404 route_not_found`, never SPA HTML. | `L,R`. |
| `API-013` | Every non-2xx MUST use `{error:{code,message,fields:[...],incidentId}}`; `fields` MUST always be an array; no secret/internal key may appear. | `L,R` schema corpus. |
| `API-014` | Product aggregate writes/file mutations MUST enforce integer revision through quoted `ETag`/required `If-Match`; stale/missing precondition MUST be `409 revision_conflict` with zero write. | `L,R`. |
| `API-015` | Create/structural routes MUST reject `variantEdits`/`product.variants`; nonstructural route MUST reject `schema`; repeated IDs or any duplicate/mismatched Variant copy MUST return `422 validation_failed` with field code `variant_payload_ambiguous` and zero write. | `L,R` payload corpus. |
| `API-016` | Group refs MUST be unique among groups and value refs globally unique among values in one SchemaDraft. Every row MUST resolve exactly one value ref from every participating group and none elsewhere; client refs MUST never appear in D1/detail/public identity. | `L,R` request/DB corpus. |

## Data records

| ID | Contract | Evidence |
| --- | --- | --- |
| `DATA-001` | Bootstrap Store MUST be idempotent with ID `store_nexus`, slug `nexus`; clients MUST NOT submit/select Store IDs. | `L,R` migration/query/request evidence. |
| `DATA-002` | S1 application schema MUST define exactly the seven domain tables named in reconciliation and enforce foreign keys. Wrangler's configured `d1_migrations` metadata table and SQLite internal tables are explicitly permitted and are not application/domain tables. | `L,R` schema evidence. |
| `DATA-003` | D1 MUST enforce unique `(store_id,slug)`, `(store_id,sku)`, `(product_id,combination_key)` and composite Store/Product/group/value membership scope. | `L` migration-bypass failures; `R` schema query. |
| `DATA-004` | Group/value comparison key MUST be NFKC + trim + locale-independent lowercase; display text remains unchanged. | `L`. |
| `DATA-005` | Product has `0..5` groups; each group `1..10` values when saved; one active schema; enabled Variant has exactly one value per active group. DB constraints/triggers MUST reject bypasses. | `L,R`. |
| `DATA-006` | Product/Variant status storage MUST use lowercase constants only. | `L,R`. |
| `DATA-007` | Create, nonstructural update, and structural apply MUST each be one D1 atomic batch; forced late failure MUST leave no partial aggregate. | `L`. |
| `DATA-008` | Import is one atomic batch. Product chunks MUST conditionally transition matched Products from preflight revision/fingerprint to computed post-import state; duplicates remain unchanged. Final metadata insert MUST re-read computed poststates and fail atomically on mismatch. | `L,R`. |

## Money records

| ID | Contract | Evidence |
| --- | --- | --- |
| `MONEY-001` | Console/CSV price inputs MUST be decimal strings, never floating-point JSON numbers; D1/public API MUST use safe integer minor units. | `L,R`. |
| `MONEY-002` | Currency MUST be uppercase valid ISO 4217; fraction digits come from resolved currency metadata; Variant inherits Product currency. | `L`. |
| `MONEY-003` | Negative, malformed, over-precision, and non-safe-integer minor values MUST reject with stable field errors and no write. | `L,R`. |
| `MONEY-004` | Blank Variant override means Product base; present override determines effective price; public min/max derive only purchasable rows. | `L,R`. |

## Variant identity and schema-lifecycle records

| ID | Contract | Evidence |
| --- | --- | --- |
| `VAR-001` | Product may be simple with no Variant record or have one active Variant schema. | `L,R`. |
| `VAR-002` | Maximums MUST be exactly `5` groups, `10` values/group, `30` materialized combinations; `1..10` normal, `11..30` confirmed, `31+` blocked/rejected. No configuration surface. | `P-BOUNDARY,L,R`. |
| `VAR-003` | Every Variant MUST have stable ID, Store-unique editable required SKU, Product-unique canonical combination, lowercase status. | `L,R`. |
| `VAR-004` | Canonical combination MUST use ordered stable `groupId:valueId` membership, never labels. | `L`. |
| `VAR-005` | Rename group/value MUST preserve IDs and Variant memberships without regeneration. | `L,R`. |
| `VAR-006` | Structural preview MUST write nothing and classify every affected row exactly once as retained/new/will_disable. | `L,R`. |
| `VAR-007` | Structural apply MUST disable obsolete combinations, not hard-delete them; a reintroduced historical canonical key MUST reactivate the same Variant ID. | `L,R`. |
| `VAR-008` | New website-generated rows MUST receive deterministic editable SKU suggestions; final uniqueness remains server/D1 authoritative. | `L,R`. |
| `VAR-009` | Variant delivery MUST be exactly complete `product_default` or complete `variant_override`; partial fallback MUST reject. | `L,R`. |
| `VAR-010` | Existing and new group/value draft refs are client-stable only for preview/create/apply correlation. Existing IDs must belong to Product; new IDs are server-generated; memberships map refs to stable IDs; refs are never persisted identities. | `L,R`. |

## File records

| ID | Contract | Evidence |
| --- | --- | --- |
| `FILE-001` | Accepted delivery kinds MUST be actual PDF or ZIP bytes only; filename/browser MIME MUST NOT authorize type. | `L,R`. |
| `FILE-002` | Maximum actual delivery body MUST be exactly `25,000,000` bytes; `25,000,001` MUST reject. Declared length is only an early check. | `L,R`. |
| `FILE-003` | Delivery request MUST be streamed/counting with inspected prefix reconstructed; stored bytes/size/checksum MUST equal uploaded input. No full 25 MB clone/buffer. | `L,R` checksum/runtime evidence. |
| `FILE-004` | Every write MUST use new random `delivery/<uuid>` key; user filename MUST never be path; bucket has no public access/read route. | `L,R,C`. |
| `FILE-005` | R2 PUT MUST precede conditional D1 association. D1 failure MUST delete only the new object and preserve prior association/object. | `L,R`. |
| `FILE-006` | Remove/default transition MUST clear active D1 association but MUST NOT delete historical committed object, preserving future Order snapshot retention. | `L,R`. |
| `FILE-007` | Product/Variant Console detail MAY return filename/size/kind/presence but MUST NOT return key, URL, bucket, or R2 terminology. | `L,R`. |
| `FILE-008` | Failed delete compensation MUST return `storage_compensation_failed` with opaque incident ID, expose no key, and fail acceptance until resolved. | `L` forced-failure evidence. |

## CSV records

| ID | Contract | Evidence |
| --- | --- | --- |
| `CSV-001` | Browser/workerd parser MUST be exactly `papaparse@5.7.0`, strict UTF-8 with optional BOM, RFC 4180 quoting, LF/CRLF; shared fixtures MUST normalize identically. | `L,C`. |
| `CSV-002` | Exact filename MUST be `nexus-product-import-template.csv`; exact header MUST be the `21` columns in reconciliation in that order. | `P-TEMPLATE,L,R`. |
| `CSV-003` | Download MUST contain exactly one header, the exact `field-notes` simple row, and exact two `focus-pack` Variant rows from reconciliation; unchanged download MUST re-import. | `P-TEMPLATE,L,R`. |
| `CSV-004` | Product statuses MUST be `draft|active|archived`; Variant statuses `enabled|disabled`; title-cased CSV status values MUST reject. | `L,R`. |
| `CSV-005` | Actual byte maximum MUST be `1,000,000`; byte `1,000,001` rejects in browser and Worker. | `L,R`. |
| `CSV-006` | Data-row maximum MUST be `500`; row `501` rejects in browser and Worker; zero data rows rejects. | `P-TEMPLATE,L,R`. |
| `CSV-007` | Group rows by normalized `product_slug`; simple is exactly one row with all Variant/options blank; Variant requires SKU/status and contiguous complete pairs; no type column. | `L,R`. |
| `CSV-008` | Same-slug Product fields MUST match exactly under the reconciled normalization. Mixed shape, incomplete/gapped pairs, field/schema conflict MUST reject whole Product group. | `L,R`. |
| `CSV-009` | Distinct option values MUST derive the Cartesian set; rows MUST cover it exactly once; sparse, extra, or duplicate combinations reject whole Product group. | `L,R`. |
| `CSV-010` | Derived count, not raw rows, owns `10/11/30/31`; confirmation never bypasses `31+`. | `L,R`. |
| `CSV-011` | An over-limit/rejected Product group MUST NOT prevent eligible peer groups from committing; original unchanged CSV and all source-order outcomes MUST remain in result. | `P-CSV,L,R`. |
| `CSV-012` | Import MUST be additive exact-match only. Exact existing mapping is Duplicate; new SKU+new combination may add only under exact Product/schema; identity/Product/schema conflict is Rejected; no update. | `L,R`. |
| `CSV-013` | Browser preview MUST precede upload and remain advisory; Worker MUST write original to R2 first then independently decode/parse/validate/classify. | `L,R`. |
| `CSV-014` | Fatal encoding/header/malformed/size/rows/missing-confirmation or D1 failure MUST leave zero import/catalog rows and no original object. Expected group rejection MUST retain original + import metadata/result. | `L,R`. |
| `CSV-015` | Exact 500-row fixture MUST produce `500/2500/2500/500/2500/1 = 8,501` records at `<=1,000,000` bytes locally and complete as an actual remote workers.dev import in Phase 6. | `L,R`. |
| `CSV-016` | JSON bulk success proof MUST use exact chunks `100/250/250/100/250`, four JSON lookups, one final guarded import-metadata write, and exactly `45` D1 statements; every statement has one binding. | `L`. |
| `CSV-017` | Same-count rollback MUST stay `45`: mutate one matched Product after reads; its conditional Product transition no-ops; statement 45 fails NOT NULL because computed poststate is absent; statements 1-44 rollback. Remote JSON probe/cleanup MUST pass before Phase 4. | `L,R`. |
| `CSV-018` | CSV MUST NOT import private files or Variant delivery overrides and MUST NOT add import history/background jobs. | `L,R,C`. |
| `CSV-019` | Preflight MUST carry `{id,revision,importFingerprint}` and compute poststate. Product chunks update only from that exact prestate; statement 45 rechecks poststate. New-Variant import increments revision; Duplicate-only leaves it unchanged; concurrent edits cannot be overwritten or receive stale-schema Variants. | `L` deterministic race test. |

## Public privacy records

| ID | Contract | Evidence |
| --- | --- | --- |
| `PRIV-001` | Public DTO MUST be constructed from the exact manifest/reconciliation allow-list, not by omitting keys from a Console DTO. | `L,C`. |
| `PRIV-002` | Only active Products and enabled current-schema Variants appear. Variant Products with zero enabled Variants are omitted; simple Products have empty groups/variants and base=min=max. | `L,R`. |
| `PRIV-003` | Public output MUST recursively contain no access title/instructions, delivery/default/override data, filename/file key/storage key, R2/bucket data, or import metadata at any depth. | `L,R` recursive key scan + captured JSON. |
| `PRIV-004` | Public output MUST include stable Product/Variant IDs, slug/name, currency, base/min/max minor prices, public description, active option identities/labels, SKU, selected IDs, and effective minor price. | `L,R`. |

## Internal S2/S5 snapshot records

| ID | Contract | Evidence |
| --- | --- | --- |
| `SNAP-001` | S1 MUST expose no snapshot HTTP route/table, but a private catalog module MUST implement the exact `resolveOrderItemCatalogSnapshot` input/output from reconciliation. | `L,C`. |
| `SNAP-002` | Simple selection MUST require `variantId:null`; Variant Product MUST require an enabled current-schema Variant belonging to the active Product. Mismatched/disabled/missing selection MUST reject. | `L`. |
| `SNAP-003` | Resolver output MUST copy Product/Variant IDs, SKU, selected group/value IDs and current labels, effective integer minor price/currency, effective access title/instructions, and immutable private-file key. | `L` exact DTO assertions. |
| `SNAP-004` | Product/Variant/file association edits after resolution MUST NOT mutate an already copied snapshot value; resolver MUST read D1 only and produce no R2 URL/public response. | `L,C`. |

## Routing records

| ID | Contract | Evidence |
| --- | --- | --- |
| `ROUTE-001` | Static config MUST declare `assets.directory` and `assets.not_found_handling:"single-page-application"`. | `C,L,R`. |
| `ROUTE-002` | `assets.run_worker_first` MUST be exactly `["/api","/api/*"]`. | `C,L,R`. |
| `ROUTE-003` | `/console/products`, `/new`, direct slug, and `/import` MUST return SPA HTML on direct navigation; unknown Console path uses SPA behavior. | `L,R`. |
| `ROUTE-004` | `/api`, known APIs, and unknown `/api/*` MUST execute Worker first and return JSON, never index HTML. | `L,R`. |

## Resource identity records

| ID | Contract | Evidence |
| --- | --- | --- |
| `RES-001` | Worker name MUST match `^nexus-s1-[a-z0-9]{6}$` and be generated/persisted once. D1 name MUST be `<worker>-db`; R2 name `<worker>-private`. | `C,R`. |
| `RES-002` | Bindings MUST be exactly `DB` and `FILES`; R2 MUST remain private; no `r2.dev`, custom domain, `route`, or `routes`. | `C,R`. |
| `RES-003` | Before first remote mutation, all names MUST be persisted. Then `wrangler whoami` and exact D1/R2 lists MUST identify account and absent/exact/ambiguous state. | `R` timestamped command evidence. |
| `RES-004` | D1 create may run only when absent; returned D1 ID MUST be persisted immediately before any later mutation. R2 create may run only when absent. Ambiguity MUST stop. | `R,C`. |
| `RES-005` | Rerun MUST reuse exact Worker/D1/R2 identity and MUST NOT issue resource-create commands or regenerate suffix. | `R,C`. |
| `RES-006` | Local development MUST use local bindings; production config MUST NOT persist `remote:true`. | `C`. |
| `RES-007` | Gate order MUST be: reconciliation + scaffold/minimal Worker/API 404 + routing `C+L` + parser/exact-45 local proof; only then persist final names, whoami/list, resolve/create D1/persist ID, remote JSON probe/cleanup, resolve/create R2, then Phase 4. | `L,R` ordered timestamps. |

## Testing records

| ID | Contract | Evidence |
| --- | --- | --- |
| `TEST-001` | Required versions MUST be Node `>=22` (recorded local `24.13.1`), Vite plugin `1.54.0`, Wrangler `4.126.0`, Workers pool `0.22.0`, Vitest `4.1.11`, Playwright `1.62.1`, Papa Parse `5.7.0`. | `C,L`. |
| `TEST-002` | Local unit/workerd tests MUST cover money, normalization/slug, matrix, schema lifecycle, exact Product detail/payload ownership, exact match, CSV/parser, byte sniff/stream, snapshot resolver, privacy, and stable errors including `route_not_found`. | `L`. |
| `TEST-003` | D1 bypass tests MUST attempt cross-scope membership, unique/cap violations, Product fingerprint/revision drift at import statement 45, and same-45-statement late rollback. | `L`. |
| `TEST-004` | Built HTTP harness MUST cover SPA/API routing, raw stream boundaries, R2 compensation, and no false HTML API response. | `L`. |
| `TEST-005` | Playwright MUST exercise all `UI-*` records at desktop and exactly `375 px`, including keyboard/focus/dirty/history and server-connected states. | `L`. |
| `TEST-006` | Remote smoke MUST exercise create/edit/list/reopen simple+Variant, exact boundaries, template/import/re-import/partial groups, file replace/remove/failures, and public privacy. | `R`. |
| `TEST-007` | Production build/import graph MUST have no reachable `design/`, `prototype-scenarios`, scenario controls, or prototype fixture payload. | `C`. |
| `TEST-008` | Phase 6 HTML report MUST link the complete one-row-per-manifest-ID ledger and reviewable artifacts. | `L,R,C`. |
| `TEST-009` | Local contract tests MUST assert API-003 create ref/count/confirmation/limit validation, exact-payload hash recompute, stale-zero-write and stable mapping; field-complete detail, one-owner/label/ref contracts; and all `SNAP-*` cases. | `L`. |

## Deployment records

| ID | Contract | Evidence |
| --- | --- | --- |
| `DEPLOY-001` | Remote mutation order MUST be: confirm manifest/config/account/resources; apply persisted D1 migrations; build; direct `npx wrangler deploy`; then smoke. | `R` ordered timestamps. |
| `DEPLOY-002` | Config MUST set `workers_dev:true`, `preview_urls:false`; deploy MUST use direct Wrangler and return the matching `*.workers.dev` URL; no deploy wrapper/custom domain. | `C,R`. |
| `DEPLOY-003` | Second no-change build/deploy MUST preserve Worker URL, D1 ID, R2 bucket and issue no create command. | `R,C`. |
| `DEPLOY-004` | Before smoke writes, fixture manifest MUST record every generated Product/import ID and private object alias/key in private evidence as each succeeds. | `R`. |
| `DEPLOY-005` | Cleanup MUST use only fixture-manifest IDs, FK-safe D1 deletion and unreferenced fixture-object deletion; preserve bootstrap Store, non-fixture data, and any snapshotted/historical object not proven disposable. | `R`. |
| `DEPLOY-006` | Post-cleanup absence queries/lists MUST prove all verification rows/objects gone and bootstrap/non-test data retained. | `R`. |

## Accepted public-Console risk records

| ID | Contract | Evidence |
| --- | --- | --- |
| `RISK-001` | Console/read/write/upload routes are intentionally anonymous in S1. No login/session/Owner authorization claim or UI may be added; S4 owns real identity/permissions. | `P-APPROVAL,L,R,C`. |
| `RISK-002` | Anonymous users can mutate catalog and consume Worker/D1/R2 quota. Size/type/combination bounds mitigate but do not remove abuse risk. Final report MUST state this verbatim in substance. | `R` report/config evidence. |
| `RISK-003` | workers.dev is a public teaching deployment, not a custom-domain or business-critical-production/security claim. | `R,C` final report/deploy evidence. |

## Phase 3 hard stop records

Phase 4 hard stop is staged. Before any mutation require local `L` for `CSV-001/015..017/019` and `TEST-001`, plus routing `C+L` for `ROUTE-001/002`; the scaffold, minimal Worker/API 404, and local SPA/API proof must already exist. Only then persist/confirm final names, whoami/list, resolve/create D1, run/clean remote JSON probe, then create R2. `API-005/006`, stable-ID persistence, and schema lifecycle route/DB tests are Phase 4 after migrations; Phase 3 may test only pure draft-ref validation/mapping with no route or persistence claim. `R` routing and actual remote CSV-015 import remain Phase 6.

## Status

**Status:** LOCKED_ACCEPTANCE_AUTHORITY

## Summary

This versioned manifest converts every approved Console interaction and fixed S1 decision into an exact machine and evidence contract. Phase 6 can verify completion solely by producing the required ledger and artifacts for every ID.

## Concerns

The manifest deliberately accepts anonymous mutation/upload and workers.dev exposure. R2/D1 compensation remains observable rather than transactional. Any failed compensation, remote bulk probe, resource-identity ambiguity, recursive privacy leak, fixture graph leak, or missing manifest evidence blocks completion.
