# Nexus S1 design-to-machine contract reconciliation

## Authority and frozen presentation

- Reconciliation version: `nexus-s1-reconciled-1`.
- Approved presentation version: Phase 2 prototype approved on `2026-08-26`, recorded in [`approval.md`](./approval.md).
- Authority order for this reconciliation is: fixed S1 decisions in the validated brainstorm and `session-1-brief.md`; approved browser behavior in `approval.md`, `docs/design-guidelines.md`, and `console-journey-state-matrix.md`; current Cloudflare evidence; then provisional plan text.
- Browser information architecture remains exactly `/console/products`, `/console/products/new`, `/console/products/:productSlug`, and `/console/products/import`.
- Approved labels, state transitions, desktop/375 px transformations, focus behavior, dirty guard, template copy, and partial-group import behavior do not change.
- This document owns the machine boundary that the approved prototype intentionally left unspecified. [`reconciled-acceptance-manifest.md`](./reconciled-acceptance-manifest.md) is the versioned Phase 6 authority.

## Design-versus-plan gap audit

No provisional Phase 3-6 assumption survives unless it is crosswalked below. These resolutions lock downstream phases; a later implementation may change them only by updating both reconciliation documents and every affected phase. Renewed approval is required only if the browser-visible contract changes.

| Approved field/state/action | Provisional gap or contradiction found | Locked resolution and downstream patch |
| --- | --- | --- |
| Browser Product route uses stable selected Product path, including direct `/console/products/focus-pack` and real history. | Phase 4 named ID-only Product GET and did not own direct slug bootstrap/history. | Browser key is stable `productSlug`; add detail GET by slug, keep ID routes for mutations, and define push/replace/back/forward behavior. Phase 4/6 must verify it. |
| Create and edit stay in context with durable Saved/error state. | Product create/update DTO, optimistic concurrency, and create route replacement were unspecified. | Exact save DTO, `revision`/`ETag`/`If-Match`, create `replaceState`, and recoverable errors are defined below. |
| Structural changes show recoverable Retained/New/Will disable preview before Product Save. | A single provisional `PUT .../variant-schema` could persist on **Regenerate**, contradicting `SR-APPLIED-DIRTY`. | Add stateless preview route; **Regenerate** changes local dirty state only; Product Save calls atomic schema apply with `previewHash`. |
| Create Product can preview a not-yet-persisted schema. | ID-only schema route could not serve `/new`. | One stateless preview accepts `productId:null`; create POST applies the verified schema atomically. |
| Rename-only does not regenerate; historical combinations preserve identity. | Phase 4 did not separate label-only update from structural apply on the wire. | Nonstructural Product PUT owns label-only edits; schema apply owns membership changes and reactivates historical canonical IDs. |
| Rename-only request payload. | Nonstructural Product PUT was named but did not carry group/value labels or stable IDs. | `optionLabels` carries every existing group/value ID plus group name/value label only; add/remove/reorder/participation/membership is structural. |
| Variant field ownership during structural save. | Product and schema DTOs could carry competing copies of SKU/status/price/delivery. | Product core has no Variant collection. Structural create/apply owns Variant data only in `SchemaDraft.rows`; nonstructural update owns it only in `variantEdits`; misplaced/duplicate copies reject. |
| New option identity during stateless preview. | `id:null` plus row `selectedValueIds` could not reference unsaved values without inventing stable IDs. | Every existing/new group and value has a request-local `draftRef`; rows select value refs. Server validates/maps refs, generates stable IDs only on create/apply, and never persists client refs as identity. |
| Exact Product editor response. | “Detail” prose did not lock nested group/value/membership/effective price/delivery/file fields. | `ProductDetailResponse` is defined field-by-field below and is the only editor/mutation response schema. |
| Complete Product-default or complete Variant override, including focused dirty/revert behavior. | Provisional DTOs and partial override semantics were absent. | Discriminated complete delivery DTO; no per-field fallback. File association remains a separate exact route and never exposes keys. |
| Product/Variant replacement and removal show current file until Save and never claim deletion. | Phase 4 listed only PUT file routes and no remove semantics; old-key retention was incomplete at route level. | Add exact DELETE routes. PUT uses new random key + compensation; DELETE clears D1 association only; old committed objects remain. |
| Product list has search/status filters and retry/template actions. | List query/default/order/DTO and template state ownership were unspecified. | Exact list query, stable ordering, nullable simple Variant count, and template route/headers are defined. |
| CSV preview is real browser parsing and server result is authoritative. | Parser remained provisional; existing prototype used a hand parser. | Lock `papaparse@5.7.0`, strict UTF-8, one shared contract/fixture in browser and workerd; Phase 5 removes hand parsing. |
| Canonical template statuses are lowercase while labels are title-cased. | Downstream plan named statuses but did not lock exact approved example rows. | Exact 21-column header, exact three approved rows, lowercase status values, and filename are frozen below. |
| A `31+` group is rejected while other eligible groups may proceed. | Phase 5 could be read as whole-file rejection for the hard cap. | Over-limit is expected Product-group rejection; unchanged original file uploads when another group is eligible; accepted groups commit atomically. |
| Browser preview preserves source-order row identity and provisional reason; result later replaces it. | Immediate result DTO/order/field shape were unspecified. | Exact ordered `ImportResultResponse`; provisional labels never use authoritative Added/Duplicate/Rejected. |
| All-Duplicate, mixed, all-Rejected, failure, and durable result focus are approved. | Phase 5 only broadly named counts/rows. | Server returns one outcome per source row and ordered groups with exact counts/reasons; no polling/import-history route. |
| Public catalog must recursively exclude private delivery/storage/import data. | Phase 4 said “safe” without an exact allow-list or recursive check. | Exact public DTO allow-list and recursive deny-key proof below; no Console DTO reuse. |
| S2/S5 delivery snapshot continuity. | Public privacy and object retention did not define the fixed internal resolver seam. | Add a private, tested, no-route resolver that copies selected identities/options, effective minor price/currency, effective access title/instructions, and immutable private-file key into a snapshot DTO. |
| Exact browser/Worker limits. | Prototype code used binary multipliers while provisional machine plan used decimal bytes. | Machine contract is exactly `1,000,000` CSV bytes and `25,000,000` delivery bytes; UI copy remains **1 MB**/**25 MB** and boundary behavior is verified at `+1` byte. This reconciles to the fixed plan/brief machine contract without layout/copy changes. |
| D1 500-row feasibility and concurrent import drift must be proven before catalog coding. | “Representative 500 rows” did not maximize relational rows; an appended failure would make 46 statements; preflight exact-match reads could become stale before writes. | Deterministic 500-row/8,501-record success stays exactly 45 statements. The counted 45th import insert rechecks expected Product revisions/fingerprints and deliberately fails its NOT NULL ID on drift, proving same-count rollback and closing the race. |
| SPA deep links and API JSON 404. | Current docs require `assets.directory`; plan showed fallback but did not lock exact current config/version reality. | Use `assets.directory`, `not_found_handling`, and `run_worker_first` for exact `/api` and `/api/*`; pin current package facts. |
| No prototype fixture in production. | Phase 3 mentioned an assertion but Phase 6 lacked a manifest ID/evidence format. | Manifest owns graph-deny ID and Phase 6 records build-metafile evidence. |
| Public anonymous Console risk. | Plan noted the risk but did not make it a versioned acceptance record. | Manifest includes accepted-risk IDs; reports must not call the deployment authorized/private/production-secure. |

Crosswalk completeness: all `PL-*`, `PE-*`, `PRICE-*`, `DF-*`, `VR-*`, `VG-*`, `CM-*`, `VM-*`, `SR-*`, `CI-*`, route/history, responsive, keyboard, and error families are assigned to a browser-only, Worker-read, Worker-write, D1, or R2 boundary in the matrices below and the manifest. No approved state is deferred or silently dropped.

## Shared wire conventions

### Media, naming, identity, and concurrency

- JSON routes accept and return `application/json; charset=utf-8`; JSON field names are `camelCase`.
- CSV columns remain the exact `snake_case` header defined below. Canonical stored/wire statuses are lowercase: Product `draft|active|archived`; Variant `enabled|disabled`. Console labels remain title-cased.
- `productId`, `variantId`, group/value IDs, and import IDs are server-generated stable opaque strings. Product `slug` is stable after creation and is the browser location key.
- A Product aggregate has an integer `revision`. Detail responses include `ETag: "<revision>"`. Product update, schema apply, and Product/Variant file replace/remove require `If-Match: "<revision>"`. A stale or absent required precondition returns `409 revision_conflict` with no write.
- Client-supplied Store IDs are never accepted. Every operation is scoped to bootstrap Store `store_nexus`.
- Timestamps are UTC RFC 3339 strings. List order is `updatedAt` descending, then `id` ascending.

### Stable error envelope

Every non-2xx API response is JSON and has the same shape; `fields` is always an array, including when empty.

```json
{
  "error": {
    "code": "variant_limit_exceeded",
    "message": "A Product can have at most 30 combinations.",
    "fields": [{"path":"/schema/groups","code":"variant_limit_exceeded","message":"31 combinations exceeds the maximum of 30."}],
    "incidentId": null
  }
}
```

`path` is a JSON Pointer for JSON requests and `/rows/<one-based-data-row>/<csv_column>` for CSV results. `incidentId` is `null` except an internal persistence/compensation failure. Responses never contain an R2 key, binding name, SQL text, stack, or private log data.

Stable top-level codes and status classes:

| HTTP | Codes |
| ---: | --- |
| `400` | `invalid_json`, `invalid_csv`, `invalid_utf8`, `header_mismatch`, `empty_csv` |
| `404` | `route_not_found`, `product_not_found`, `variant_not_found` |
| `409` | `revision_conflict`, `slug_conflict`, `sku_conflict`, `combination_conflict`, `schema_preview_stale`, `schema_conflict`, `identity_conflict` |
| `413` | `csv_size_exceeded`, `csv_row_limit_exceeded`, `delivery_file_size_exceeded` |
| `415` | `delivery_file_type_invalid` |
| `422` | `validation_failed`, `schema_preview_required`, `variant_confirmation_required`, `variant_limit_exceeded`, `option_group_limit_exceeded`, `option_value_limit_exceeded`, `matrix_incomplete` |
| `500` | `persistence_failed`, `storage_write_failed`, `storage_compensation_failed` |
| `502` | `storage_unavailable` |

### DTO vocabulary

```ts
type ProductStatus = 'draft' | 'active' | 'archived';
type VariantStatus = 'enabled' | 'disabled';
type FileKind = 'pdf' | 'zip';
type PrivateFileSummary =
  | { present: false }
  | { present: true; filename: string; sizeBytes: number; kind: FileKind };

type ProductCoreFields = {
  name: string;
  basePrice: string;
  currency: string;
  status: ProductStatus;
  publicDescription: string;
  delivery: { accessTitle: string; accessInstructions: string };
};

type LabelOnlySchemaEdits = {
  groups: Array<{
    id: string;
    name: string;
    values: Array<{ id: string; label: string }>;
  }>;
};

type VariantEdit = {
  id: string;
  sku: string;
  status: VariantStatus;
  priceOverride: string | null;
  delivery:
    | { source: 'product_default' }
    | { source: 'variant_override'; accessTitle: string; accessInstructions: string };
};

type DraftRef = string;
type SchemaDraft = {
  groups: Array<{
    draftRef: DraftRef;
    id: string | null;
    name: string;
    position: number;
    participating: boolean;
    values: Array<{
      draftRef: DraftRef;
      id: string | null;
      label: string;
      position: number;
    }>;
  }>;
  rows: Array<{
    id: string | null;
    selectedValueRefs: DraftRef[];
    sku: string;
    status: VariantStatus;
    priceOverride: string | null;
    delivery:
      | { source: 'product_default' }
      | { source: 'variant_override'; accessTitle: string; accessInstructions: string };
  }>;
  confirmCombinations: boolean;
};

type NonstructuralProductUpdateRequest = {
  product: ProductCoreFields;
  optionLabels: LabelOnlySchemaEdits;
  variantEdits: VariantEdit[];
};

type ProductDetailResponse = {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  type: 'simple' | 'variant';
  currency: string;
  basePriceMinor: number;
  publicDescription: string;
  delivery: {
    accessTitle: string;
    accessInstructions: string;
    file: PrivateFileSummary;
  };
  optionGroups: Array<{
    id: string;
    name: string;
    position: number;
    participating: boolean;
    values: Array<{ id: string; label: string; position: number }>;
  }>;
  variants: Array<{
    id: string;
    combinationKey: string;
    selectedOptions: Array<{
      groupId: string;
      groupName: string;
      valueId: string;
      valueLabel: string;
    }>;
    sku: string;
    status: VariantStatus;
    priceOverrideMinor: number | null;
    effectivePriceMinor: number;
    priceSource: 'base_price' | 'override';
    delivery: {
      source: 'product_default' | 'variant_override';
      accessTitle: string;
      accessInstructions: string;
      file: PrivateFileSummary;
    };
  }>;
  updatedAt: string;
  revision: number;
};
```

`ProductListResponse.products[]` contains `id`, `slug`, `name`, lowercase `status`, `type`, `currency`, `minimumEffectivePriceMinor`, `maximumEffectivePriceMinor`, `enabledVariantCount:number|null`, `updatedAt`, and `revision`. Simple min/max equal base and count is `null` (**Not applicable**). Variant min/max use every materialized current-schema Variant's effective price; enabled count is separate.

`ProductMutationResponse` is exactly `{product:ProductDetailResponse}` and carries the new `ETag`. Product detail's Variant delivery fields are the effective private access/file summary: inherited Product values when `source:"product_default"` and the complete override when `source:"variant_override"`. No Console response returns a storage key.

Payload ownership is strict:

- Create is `{product:ProductCoreFields,schema:SchemaDraft|null,previewHash:string|null}`; structural Variant fields exist only in `schema.rows`.
- Structural apply is `{product:ProductCoreFields,schema:SchemaDraft,previewHash:string}`; structural Variant fields exist only in `schema.rows`.
- Nonstructural update is `NonstructuralProductUpdateRequest`; existing Variant fields exist only in `variantEdits`, and label-only existing group/value changes only in `optionLabels`.
- `optionLabels` must contain the exact existing group/value ID set and may change only group names/value labels. Add/remove/reorder, participation, membership, or selected-option change returns `422 schema_preview_required`.
- Every group/value, existing or new, requires a nonempty client-stable `draftRef` unique across its request collection. Each existing `id` must belong to the Product and map one-to-one to its ref; new items use `id:null`.
- `selectedValueRefs` must contain exactly one resolvable value ref from every participating group and none from nonparticipating/another Product group. Duplicate, missing, unknown, reused-ID, or cross-group refs return `422 validation_failed` with field code `invalid_draft_reference`.
- Preview returns refs and writes no IDs. Create/apply pre-generates stable group/value IDs, maps refs to them for memberships, and persists only stable IDs. Client refs are never database/public identity.
- Unknown `product.variants`, structural-route `variantEdits`, nonstructural `schema`, repeated IDs, or any second/mismatched Variant copy returns `422 validation_failed` with field code `variant_payload_ambiguous`; no precedence rule exists.
A JSON Product save never accepts a file body, filename, storage key, or file metadata. Saved file association is unchanged until its file route succeeds. A complete Variant override requires both access fields. Returning to `product_default` clears active Variant file association in D1 but retains the historical R2 object.

## Exact Worker route contract

| Method and route | Request body/headers and semantics | Success DTO | D1 boundary | R2 boundary |
| --- | --- | --- | --- | --- |
| `GET /api/console/products?q=<text>&status=all|draft|active|archived` | Optional keys; defaults empty `q` and `all`. Trimmed `q` matches name/slug case-insensitively. | `200 ProductListResponse` | Read-only Store query. | None. |
| `GET /api/console/products/by-slug/:productSlug` | Exact stable slug from browser route. | `200 ProductDetailResponse`, `ETag` | Read-only aggregate query. | None; file summaries come from D1 metadata. |
| `POST /api/console/products/schema/preview` | JSON `{productId:null|string,productSlug:string,product:ProductCoreFields,schema:SchemaDraft}`; existing Product also requires `If-Match`. | `200 SchemaPreviewResponse`; `previewHash` covers canonical exact ProductCore+schema payload, count/flags/ordered ref rows. | Read-only; no stable IDs or D1 writes. | None. |
| `POST /api/console/products` | JSON `{product:ProductCoreFields,schema:SchemaDraft|null,previewHash:string|null}`. Simple requires both null. Variant create validates refs/count/confirmation/limits and recomputes hash over exact create payload; mismatch returns `409 schema_preview_stale` with zero writes. | `201 ProductMutationResponse`, slug `Location`, new `ETag`. | Valid hash atomically pre-generates/maps refs to stable IDs and inserts Product/schema/Variants/memberships; refs are not persisted. | None; file follows stable IDs. |
| `PUT /api/console/products/:productId` | Requires `If-Match`; exact `NonstructuralProductUpdateRequest`. `optionLabels` carries label-only stable-ID group/value edits; `variantEdits` is the only Variant owner. Structural/misplaced/duplicate payload returns stable 422 with no write. | `200 ProductMutationResponse`, new `ETag`. | One atomic aggregate batch. | None; file associations unchanged. |
| `PUT /api/console/products/:productId/schema` | Requires `If-Match`; JSON `{product:ProductCoreFields,schema:SchemaDraft,previewHash:string}`; `schema.rows` is the only Variant owner. Recompute hash/count. | `200 ProductMutationResponse`, new `ETag`. | One atomic Product + rename/reorder + insert/reactivate + membership + disable-obsolete batch. | None; retained IDs retain association; obsolete objects remain. |
| `PUT /api/console/products/:productId/delivery-file` | `If-Match`, raw body, `application/octet-stream`, percent-encoded UTF-8 `X-Nexus-Filename`; if browser/network supplies `Content-Length`, use it only as an early bound. | `200 {productId,file,revision}`, new `ETag`. | Conditional association/metadata/revision after R2 success. | New `delivery/<uuid>`; delete new key on D1 failure; retain old key. |
| `DELETE /api/console/products/:productId/delivery-file` | `If-Match`; no body. | `200 {productId,file:{present:false},revision}`. | Conditional association clear. | No delete; retain historical object. |
| `PUT /api/console/products/:productId/variants/:variantId/delivery-file` | Same raw headers; Variant must have complete override. | `200 {productId,variantId,file,revision}`. | Conditional Variant association after R2 success. | New random key; compensate new only; retain old. |
| `DELETE /api/console/products/:productId/variants/:variantId/delivery-file` | `If-Match`; no body; override text/mode remains. | `200 {productId,variantId,file:{present:false},revision}`. | Conditional association clear. | No delete. |
| `GET /api/console/imports/template` | No body. | CSV with exact content headers/filename. | None. | None. |
| `POST /api/console/imports` | Raw CSV; `text/csv; charset=utf-8`; percent-encoded filename header; optional network `Content-Length` is an early bound only; `X-Nexus-Confirm-Variants:true` iff eligible `11..30` groups exist. | `200 ImportResultResponse` for structurally valid file, including mixed groups. | One atomic import-metadata + accepted-groups batch; rejected groups write no catalog rows. | Original first; retain for result, delete for fatal validation/missing confirmation/batch failure. |
| `GET /api/storefront/products` | No body/Console parameters. | `200 PublicCatalogResponse`. | Read-only active/enabled allow-list projection. | None. |
| `/api` or unmatched `/api/*` | Any method. | JSON `404 route_not_found` envelope. | None. | None. |

```ts
type SchemaPreviewResponse = {
  previewHash: string;
  combinationCount: number;
  confirmationRequired: boolean;
  blocked: boolean;
  rows: Array<{ outcome:'retained'|'new'|'will_disable'; variantId:string|null; selectedValueRefs:DraftRef[]; sku:string; skuSuggested:boolean }>;
};
type ImportResultResponse = {
  importId:string; filename:string; counts:{added:number;duplicate:number;rejected:number};
  groups:Array<{
    productSlug:string; detectedType:'simple'|'variant'; derivedCombinationCount:number; outcome:'added'|'duplicate'|'rejected'|'mixed';
    rows:Array<{row:number;productSlug:string;variantSku:string|null;outcome:'added'|'duplicate'|'rejected';field:string|null;code:string|null;reason:string|null}>;
  }>;
};
```

Preview is stateless: no preview table/session, polling, or background job. Apply recomputes `previewHash`; mismatch returns `schema_preview_stale` with no write. Import groups/rows stay in source order; identity conflict is Rejected, never Duplicate.

## Approved UI action/state ownership

### Product list and selected Product history

| Approved action/state | Worker ownership | Browser/history ownership |
| --- | --- | --- |
| Initial/filtered load, retry, catalog/filtered empty | Product list GET; failure is `PL-REQUEST-ERROR`, not empty. | Preserve header/actions and focus while requesting. |
| Open Product row | List gives slug; detail GET by slug. | `pushState('/console/products/:productSlug')`; bounded row-opening state. |
| Add Product | None until preview/save. | `pushState('/console/products/new')`. |
| Download template | Template GET. | Download without route change; loading/success/error/retry. |
| Import CSV | None merely to navigate. | `pushState('/console/products/import')`. |
| Direct Product URL | Detail GET by stable slug. | SPA deep link preserves URL. |
| Successful create | POST returns stable slug/detail. | `replaceState('/console/products/<slug>')`; remain Saved in editor. |
| Successful edit | PUT returns same slug/detail. | Stay on route; durable Saved. |
| Dirty Products/Back/scenario/browser Back/Forward | No request before guard resolution. | Stay restores URL/local edits; Discard resets then completes requested transition. |

### Editor, Variant, delivery, responsive, and accessibility families

| Approved families | Exact ownership |
| --- | --- |
| `PE-EDIT-LOADING/LOAD-ERROR/READY` | Detail GET; failed GET never creates defaults. |
| `PRICE-*`, blur errors, `PE-INVALID` | Shared browser validation plus server repeat; `fields[]` attaches to exact controls/summary. |
| `PE-SAVING/SAVE-ERROR/SAVED` | POST, nonstructural PUT, or schema PUT selected by state; returned detail/ETag is authoritative. |
| `VG-*`, `CM-*`, `VM-*`, suggested SKU | Shared browser computation; server preview/save repeats fixed limits/uniqueness. |
| Rename-only | Product PUT; membership set unchanged; IDs preserved. |
| `SR-PREVIEW-*`, Retained/New/Will disable | Preview route. **Regenerate** updates local dirty state only. |
| Save after regeneration | Schema PUT atomically commits full Product/schema; stale preview is recoverable. |
| Complete `VR-*` override/default | Product/schema PUT stores discriminated complete configuration; partial override rejects. |
| `DF-*` replace/remove | Browser prefix/size validation then raw PUT/DELETE after JSON identity/text save; current file remains until success. |
| `PL/PE/VM/CI` desktop and 375 px transformations | Browser CSS/semantic ownership only; DTO order/content supports both without a second API. |
| Keyboard/focus/live/error state | Browser ownership; stable server field paths/messages feed associations. No server operation moves focus. |

### CSV workspace families

| Approved action/state family | Exact ownership |
| --- | --- |
| Choose/drop, encoding/header/malformed/empty/size/row preview | Browser Papa Parse `5.7.0` + strict UTF-8/shared contract; no upload. |
| Type/matrix/duplicate-candidate reasons | Advisory shared browser classification; Worker repeats after R2 write. |
| `11..30` confirmation | One approved checkbox covers eligible warning groups and sends header; file/data/count change clears it. |
| `31+` group beside eligible groups | Keep blocked group visible as Rejected; upload unchanged original; Worker rejects only that group and may commit eligible groups. |
| All groups rejected | Browser Import disabled; never silently constructs a narrower file. |
| Uploading/server checking | One raw POST; preview remains non-final. |
| Success/mixed/all-Duplicate/all-Rejected | Immediate ordered POST result is authoritative/durable; no polling/history route. |
| Fatal file/request failure | Error envelope, zero D1 state, compensated object, retry/replace. |
| Result rendering error | Never invent counts; retain response for recoverable rendering. |

## Data, money, and transaction ownership

- Tables: `stores`, `products`, `product_option_groups`, `product_option_values`, `product_variants`, `product_variant_values`, `imports`.
- Product aggregate transactions include fields, one active ordered schema, Variant rows, and membership. Composite FKs prevent cross-Store/Product/group membership; unique constraints own `(store_id,slug)`, `(store_id,sku)`, `(product_id,combination_key)`.
- Group/value uniqueness uses Unicode NFKC + trim + locale-independent lowercase for comparison, retaining display text. CSV exact-match uses the same comparison normalization, exact lowercase statuses, exact minor price, and empty/null normalization; it never updates display fields.
- Every Product aggregate mutation increments `revision`; stored `importFingerprint` is a canonical SHA-256 of normalized Product exact-match fields plus active schema. Import preflight records both. Product bulk chunks conditionally transition matched Products from the preflight revision/fingerprint to the computed post-import revision/fingerprint; duplicates remain unchanged.
- Canonical combination keys are ordered stable `groupId:valueId` pairs, not labels. Rename preserves IDs; structural obsolete rows disable; historical keys reactivate the same Variant ID.
- D1 stores integer minor prices. Decimal strings convert using ISO currency fraction digits and string/integer arithmetic. Negative, malformed, over-precision, or non-safe-integer minor values reject.
- R2/D1 are not jointly transactional. File/import routes use the explicit R2-first/D1-second compensation above. A failed compensation emits `storage_compensation_failed` with opaque incident ID and blocks acceptance; key is private evidence only.

## Public catalog privacy contract

```ts
type PublicCatalogResponse = {
  store:{id:string;slug:string;name:string};
  products:Array<{
    id:string;slug:string;name:string;currency:string;basePriceMinor:number;minimumEffectivePriceMinor:number;maximumEffectivePriceMinor:number;publicDescription:string;
    optionGroups:Array<{id:string;name:string;position:number;values:Array<{id:string;label:string;position:number}>}>;
    variants:Array<{id:string;sku:string;status:'enabled';selectedOptions:Array<{groupId:string;valueId:string}>;effectivePriceMinor:number}>;
  }>;
};
```

Only active Products appear. A Variant Product with zero enabled current-schema Variants is omitted. Simple Products use empty groups/variants and base=min=max. Option groups/values are only those reachable from returned enabled Variants. The construction boundary is this exact allow-list; recursive tests reject delivery/access/instruction/file/storage/R2/import vocabulary at any depth. Console DTOs are never spread or serialized into this response.

## Internal S2/S5 snapshot resolver contract

No HTTP route, Order table, or Customer response is added in S1. A private catalog module exposes only this internal seam:

```ts
type OrderItemCatalogSnapshot = {
  productId: string;
  productName: string;
  variantId: string | null;
  variantSku: string | null;
  selectedOptions: Array<{
    groupId: string;
    groupName: string;
    valueId: string;
    valueLabel: string;
  }>;
  unitPriceMinor: number;
  currency: string;
  accessTitle: string;
  accessInstructions: string;
  privateFileKey: string | null;
};

resolveOrderItemCatalogSnapshot(input: {
  productId: string;
  variantId: string | null;
}): Promise<OrderItemCatalogSnapshot>
```

The resolver requires an active Product; simple Product requires `variantId:null`; Variant Product requires an enabled current-schema Variant belonging to that Product. It copies the selected option identities and current labels, effective Variant-or-base price, Product currency, and effective Product-default-or-complete-Variant access fields plus immutable private-file key. It reads D1 only and never creates a public route or R2 URL. Local contract tests must prove simple/default, Variant/default, Variant/override, invalid/mismatched/disabled selection, and that a later catalog/file association edit does not mutate an already copied returned snapshot value.


## Exact unified CSV contract

- Parser: `papaparse@5.7.0` in browser and workerd; strict UTF-8, optional leading BOM, RFC 4180 comma/quote escaping, LF or CRLF.
- Maximum actual body `1,000,000` bytes; `1,000,001` rejects. Maximum `500` data rows; `501` rejects.
- Filename `nexus-product-import-template.csv`.
- Exact `21`-column ordered header:

```csv
product_slug,product_name,base_price,currency,product_status,public_description,access_title,access_instructions,variant_sku,variant_price_override,variant_status,option_1_name,option_1_value,option_2_name,option_2_value,option_3_name,option_3_value,option_4_name,option_4_value,option_5_name,option_5_value
```

- Exact examples:

```csv
field-notes,Field Notes,24.00,USD,active,A concise guide,Download Field Notes,Open the PDF from your order,,,,,,,,,,,,,
focus-pack,Focus Pack,36.00,USD,draft,Desktop focus templates,Download Focus Pack,Open the ZIP from your order,FOCUS-DARK,,enabled,Theme,Dark,License,Personal,,,,,,
focus-pack,Focus Pack,36.00,USD,draft,Desktop focus templates,Download Focus Pack,Open the ZIP from your order,FOCUS-LIGHT,,enabled,Theme,Light,License,Personal,,,,,,
```

A simple group is exactly one row with all Variant/option columns blank. A Variant row requires SKU, lowercase status, and contiguous complete pairs from option 1. Product fields must match within slug. Derived Cartesian set must be covered exactly once. Sparse/extra/mixed/incomplete/Product-schema/SKU/combination conflicts reject whole group. `1..10` no confirmation, `11..30` confirmation, `31+` rejected group; eligible peers proceed. Repeat is Duplicate; identity conflict is Rejected. No updates, private files, or Variant delivery override import.

## Phase 3 feasibility proof before Phase 4

### Deterministic worst-case fixture

`tests/fixtures/import/worst-case-500-rows.csv` has one exact header plus exactly `500` data rows. Every row is a distinct Variant Product `bulk-0001` through `bulk-0500`, five participating singleton groups `Option 1` through `Option 5`, one value each, one enabled Variant, SKU `BULK-0001` through `BULK-0500`, Product `active`, base `1.00`, currency `USD`, blank override. Exact relational result: `500` Products, `2,500` groups, `2,500` values, `500` Variants, `2,500` memberships, `1` import row (`8,501` records). It must be valid RFC 4180 strict UTF-8 and `<=1,000,000` bytes. Browser/workerd normalized rows/errors must match exactly.

### JSON bulk and statement budget

Pre-generate IDs and bind one JSON array parameter per prepared statement through SQLite `json_each(?)`:

```json
{"import":["1 record"],"products":["500"],"groups":["2500"],"values":["2500"],"variants":["500"],"memberships":["2500"]}
```

| Work | Chunk | Statements |
| --- | ---: | ---: |
| Existing Product/SKU/combination/schema JSON lookups | all keys per lookup | `4` |
| Products | `100` | `5` |
| Groups | `250` | `10` |
| Values | `250` | `10` |
| Variants | `100` | `5` |
| Memberships | `250` | `10` |
| Import metadata | `1` | `1` |
| **Total** |  | **`45`** |

Proof records encoded parameter/SQL sizes, one binding per statement, total `45 < 50`. The Product chunks conditionally update each matched Product only where its current `{revision,importFingerprint}` equals preflight; a Product receiving new Variants moves to computed `postRevision` and `postImportFingerprint`, while a Duplicate-only Product's poststate equals preflight. Drift makes that conditional transition a no-op.

Counted statement 45 is the import-metadata insert. Its one JSON parameter contains metadata and every matched Product's computed `{id,postRevision,postImportFingerprint}`. `INSERT ... SELECT` re-reads those poststates; missing/mismatched state makes required import ID `NULL`, triggers imports-table NOT NULL, and rolls back statements 1-44. Success inserts metadata normally. Thus intended import changes do not trip their own guard, but pre-batch anonymous edits cannot be overwritten or receive stale-schema Variants.

Success imports the all-new 500-row/8,501-record fixture in 45 statements. Same-count rollback/race uses the same file with one pre-existing exact Product, records pre/post expectations, mutates it after reads, observes conditional Product transition no-op and statement 45 failure, and sees zero batch-created rows; the external mutation remains. No 46th statement/failure hook.

Before any Cloudflare mutation, finish reconciliation; scaffold assets config and minimal Worker/API `route_not_found`; pass `ROUTE-001/002` configuration+local harness (`C+L`); and pass local parser/exact-45 success+drift rollback. Only then generate/persist/confirm final names, run whoami/list, resolve/create D1 and persist ID, run/clean remote JSON probe, then resolve/create R2 and permit Phase 4.

Phase 3 may prove only the pure SchemaDraft ref validator/mapper contract in memory. Exact preview/apply routes, no-write preview, server-ID persistence, stale-hash behavior, atomic lifecycle and D1 absence/rollback tests belong to Phase 4 after migrations. Deployed routing and actual remote CSV-015 import are Phase 6; the JSON probe substitutes for neither.

## Cloudflare routing and resource identity

- Planned verified versions: Node `>=22` (local `24.13.1`), `@cloudflare/vite-plugin@1.54.0`, `wrangler@4.126.0`, `@cloudflare/vitest-pool-workers@0.22.0`, `vitest@4.1.11`, `@playwright/test@1.62.1`, `papaparse@5.7.0`.
- Assets use `assets.directory`, `assets.not_found_handling:"single-page-application"`, `assets.run_worker_first:["/api","/api/*"]`. `/console/*` deep links return SPA HTML; `/api` and `/api/*` execute Worker first and return JSON.
- Worker name: `nexus-s1-<six lowercase alphanumeric characters>` once. D1 `<worker-name>-db`; private R2 `<worker-name>-private`; bindings `DB`, `FILES`.
- Persist all names before mutation; whoami/list/classify. Create D1 only if absent and persist ID immediately; run/clean remote JSON probe; create R2 only after probe passes and only if absent. Ambiguity stops. Reruns reuse; never regenerate/create twice.
- `workers_dev:true`, `preview_urls:false`; no custom/public R2 route/domain, deploy wrapper, or persisted production `remote:true`.

## No fixture production graph

`design/prototype-scenarios.ts`, scenario query controls, and prototype fixture payloads remain design evidence only. Production imports real API/shared contracts. Phase 6 fails if build graph/metafile reaches `design/`, `prototype-scenarios`, or scenario fixture exports.

## Status

**Status:** RECONCILED_FOR_IMPLEMENTATION

## Summary

Approved browser behavior now has exact Worker, DTO, D1, R2, error, routing, feasibility, and evidence ownership. The visible gap audit resolves every missing or contradictory Phase 3-6 assumption and locks the downstream plan without changing the Console presentation.

## Concerns

Anonymous write/upload remains an accepted quota-abuse risk. R2 compensation is not transactional with D1; any delete failure blocks acceptance. The decimal byte contract must replace provisional binary multipliers during implementation while retaining the approved **1 MB**/**25 MB** copy. Remote 500-row proof is a hard gate, never permission to reduce scope.
