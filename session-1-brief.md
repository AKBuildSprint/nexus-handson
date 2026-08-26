# Session 1 — Nexus Build Brief (PRD)

*Feature: Product API + Variant Matrix + Operations Console Catalog + CSV import · Builds on: nothing (this is the seed)*

> **TUTOR-ONLY TECHNICAL PRD.** Read `../student-persona.md`. Use this to prepare/rehearse Nexus and steer AgentKit. Never paste this full brief into the student prompt. The student-facing session also produces the Product One-Pager, scope contract, success evidence, User Journey Map and AgentKit Workflow Map described in `../session-1.md`.

## This session

We ship Nexus's first backend and surface: bootstrap Store + Product API + Operations Console. Store Owner creates simple or multi-option digital Products with prices and delivery configuration, imports Product/Variant combinations from CSV and opens Console on a real link. S2 Storefront must read these same Products and purchasable Variants through the API.

The build starts immediately. Scope/evidence and AgentKit operating-model work runs in parallel while the agent builds.

## Goal

Stand up Nexus API/Console on Cloudflare Workers and ship one complete Store-scoped Product journey with optional multi-attribute Variants. Preserve public Product/Variant fields for S2 and safe delivery configuration for S5.

## User story

As Store Owner, I create a digital Product with name, price and what the Customer receives; optionally add a matrix of purchasable Variants; edit/find/import the catalog in Console; and see active Products/Variants through the public API that the separate Storefront will consume.

## Build this slice

1. Deploy the Worker API, D1 database and Operations Console with one bootstrap Store.
2. Let the Owner create and edit a Product with its name, decimal display price, currency and status.
3. Let a Product remain simple or define one active Variant schema with up to five option groups and ten values per group.
4. Let the Owner select which groups participate in combination generation and omit unnecessary groups.
5. Preview the Cartesian count. Combinations 11–30 require a Customer-UX warning and explicit confirmation; more than 30 is blocked.
6. Give every Variant a Store-unique SKU, enabled/disabled status and optional price override in the Product currency. Website generation suggests editable SKUs.
7. Rename groups/values without changing identity. Structural edits preview/regenerate the one active schema and disable obsolete combinations.
8. Let the Owner describe what a paying Customer receives through Product-default access title/instructions and an optional private R2 file. A Variant may replace this with one complete delivery configuration.
9. Keep Product and Variant delivery configuration private in S1. S2 copies effective access content and immutable file key into the Order-item snapshot; S5 grants that snapshot.
10. Show simple Products and Variant matrices in Console; expose only the safe fields that S2 Storefront needs.
11. Let the Owner download one unified CSV template with one exact header row, one simple Product example and two Variant rows of one Product example.
12. Browser-preview and auto-detect CSV shape. Enforce 1 MB/500 data rows, require confirmation for 11–30 combinations and block more than 30 before upload.
13. After confirmation, store the original CSV in R2 before the Worker parses and validates catalog rows.
14. Add valid Products, option groups and Variant combinations to D1 using additive exact-match semantics; report added, duplicate and rejected rows.

## Data

- D1 `stores`: bootstrap `id`, public key/slug, public identity fields, timestamps.
- D1 `products`: `id`, `store_id`, `name`, `slug`, `base_price_minor`, `currency`, `status`, safe public description, default private access title/instructions and optional private-file key, timestamps.
- D1 `product_option_groups` and `product_option_values`: one active ordered schema; at most five groups per Product and ten values per group.
- D1 `product_variants`: stable `id`, `store_id`, `product_id`, Store-unique `sku`, canonical combination key, enabled/disabled status, nullable `price_override_minor`, optional complete delivery override, timestamps.
- D1 Variant-to-option-value membership: exactly one selected value for every group in the active schema.
- D1 `imports`: `id`, `store_id`, `storage_key`, `filename`, `size`, `content_type`, result counts, `created_at`.
- Private R2 bucket for original CSV blobs and Product/Variant PDF or ZIP delivery files up to 25 MB.

**Required Variant model:** A Product may be simple or have one dynamic active Variant schema. Limits are fixed in S1: five groups, ten values/group and 30 materialized combinations/Product. Combinations 11–30 require warning and confirmation; the 31st is blocked. Making these values configurable is outside S1.

## Rules & edge cases that MUST hold

- **Complete Product journey:** the Owner can create a simple or Variant Product, edit it, return to the list and reopen it.
- **One active schema:** every enabled Variant selects exactly one value from each active group. Different active group schemas cannot coexist in one Product.
- **Schema edits:** rename preserves IDs. Adding/removing groups or values requires preview/regeneration; obsolete combinations become disabled rather than hard-deleted.
- **Variant identity:** every Variant has a stable ID and Store-unique SKU. The same canonical combination cannot appear twice in one Product.
- **Website SKU:** generated combinations receive deterministic SKU suggestions from Product slug + option values; Owner may edit before save; server enforces uniqueness.
- **Variant availability:** only enabled Variants of an active Product are purchasable and visible through `GET /api/storefront/products`.
- **Variant pricing:** Product owns `base_price_minor`; Variant may store `price_override_minor` in the same currency; effective price falls back to Product.
- **Combination boundary:** 11–30 combinations require warning/confirmation. More than 30 is rejected. Admin-configurable limits are future scope.
- **Variant delivery:** Product owns default delivery. A Variant inherits it completely or replaces it with a complete private override.
- **S2 continuity:** public API returns stable Product/Variant identities, option selections and effective minor-unit prices. S2 snapshots selected Variant, options, price, copied access title/instructions and immutable private-file key when creating the Order.
- **S5 continuity:** S5 grants the Order-item delivery snapshot; later catalog edits cannot change the original promise.
- **Money:** Console/CSV accept decimal strings by currency; Worker converts exactly to integer minor units without floating point. Reject negative, malformed or over-precision values.
- **S1 authorization exception:** Console and write/upload routes are public by explicit scope decision. Do not claim Owner authorization; S4 introduces real identity and permissions.
- **File validation:** accept private delivery files only when bytes identify PDF or ZIP and size is at most 25 MB. CSV is UTF-8, at most 1 MB/500 data rows; inspect bytes/fields rather than trusting filename or browser Content-Type.
- **File persistence:** browser preview happens before upload. Worker writes original bytes to R2, revalidates independently and deletes the object if validation or D1 commit fails.
- **Delivery file retention:** replacing a Product/Variant file writes a new random R2 key. Never overwrite or delete an object key referenced by an Order-item snapshot.
- **Unified CSV template:** Console downloads one stable `nexus-product-import-template.csv` with the exact ordered header, one valid simple example and two valid Variant rows from the brainstorm report.
- **CSV type detection:** group rows by Product slug. Blank Variant/options means one simple row; SKU plus complete option pairs means Variant rows. Reject mixed shapes or incomplete pairs.
- **CSV Variant matrix:** derive Cartesian combinations from distinct option values. Variant rows must cover that matrix exactly once; sparse/extra combinations reject the whole Product group. Warning/cap uses derived count.
- **Additive exact-match:** existing Product accepts only new SKU/combinations when Product fields and active schema match. Import never updates existing catalog records; conflict rejects the whole Product group.
- **Random storage key:** never use the user's filename as the R2 path.
- **Private file:** never expose a public bucket URL or Product/Variant delivery metadata through public/Customer-safe responses.
- **Frontend-first gate:** use Mobbin-backed design research and a browser-visible Console prototype first. Backend/data work starts only after user approval and phase reconciliation.
- **Wrangler deployment:** generate one random Worker suffix once, persist the full name in `wrangler.jsonc`, deploy directly with Wrangler CLI and use only the resulting `workers.dev` URL.

## Acceptance criteria

- [ ] On a real Cloudflare link, the operator creates, edits, lists and reopens both a simple Product and a Variant Product.
- [ ] Product enforces one active schema, 0–5 groups, at most 10 values/group and at most 30 materialized combinations.
- [ ] Combinations 11–30 require warning/confirmation; combination 31 is blocked.
- [ ] Structural schema regeneration disables obsolete combinations; rename preserves stable identities.
- [ ] Website suggests editable SKUs; Store-SKU and Product-combination uniqueness hold.
- [ ] Decimal base/override prices convert to correct integer minor units; effective price fallback is correct.
- [ ] Product-default delivery and complete Variant override remain private and resolve to copied access content plus immutable file key for S2/S5.
- [ ] Console downloads one `nexus-product-import-template.csv` with exact unified header, one simple example and two Variant example rows.
- [ ] Browser preview auto-detects both example shapes, applies warning/cap before upload and requires no type column.
- [ ] CSV Variant rows cover the derived Cartesian matrix exactly once; sparse/extra rows are rejected and cannot bypass 30-combination cap.
- [ ] Additive exact-match imports new Variants into a matching Product but never updates existing catalog records.
- [ ] Mixed shapes, incomplete pairs and Product/schema conflicts reject the whole Product group with clear reasons.
- [ ] Re-import adds zero records; identity conflicts are distinguished from safe duplicates.
- [ ] Invalid file/server validation/D1 failure leaves no partial catalog/import records or orphan blob.
- [ ] `GET /api/storefront/products` returns active Products, enabled Variants, options and effective prices without private delivery fields.
- [ ] PDF/ZIP up to 25 MB uses random private R2 keys; oversized/mismatched content is rejected.
- [ ] Replacing a delivery file does not overwrite or delete an R2 key referenced by an Order-item snapshot.
- [ ] Final evidence states Console/write routes are public and real authorization remains deferred to S4.
- [ ] Mobbin-backed Product list/editor/Variant/import prototype is approved before backend/data implementation; remaining phases are reconciled afterward.
- [ ] Browser and Worker both enforce CSV 1 MB/500-row limits.
- [ ] Direct Wrangler deploy reuses one persisted randomly suffixed Worker name and returns a working `workers.dev` URL without a custom domain.

## Suggested AgentKit sequence

```text
# Frontend first
/ak:frontend-design "Use Mobbin references to design and prototype Nexus Product list, Product editor, Variant matrix and unified CSV import."

# Stop for explicit user design approval, then reconcile the remaining plan
/ak:plan "Reconcile approved Console fields/states with API, D1, R2, tests and deployment phases."

# Implement only the reconciled plan
/ak:cook → /ak:test → /ak:code-review

# Deploy directly, no custom domain
npx wrangler deploy
```

## What this enables in the teaching session

- Tutor launches a concrete feature before any concept explanation.
- Students use agent latency to lock product scope/evidence and map how they will steer AgentKit.
- They personally challenge a plan, build, use, revise, test and deploy their first vertical slice.
- **They walk out with:** Product One-Pager, scope contract, success evidence, User Journey Map, AgentKit Workflow Map, repository operating rules, Vertical Slice Plan and one task running on their own link.

---

## Student-facing adaptation seed

Do not hand students this PRD. Use the six-line Product One-Pager and scope contract in `../session-1.md`; then write the first prompt with the student's exact user, nouns, input, journey, result and non-goals.
