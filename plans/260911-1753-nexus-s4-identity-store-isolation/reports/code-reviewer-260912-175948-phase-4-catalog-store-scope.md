## Phase 4 Code Review — Catalog Store Scope

### Verdict

- Blocking findings: none.
- Score: 8.8/10.
- critical_count: 0.
- Auto-mode verdict: APPROVE_WITH_WARNINGS.
- GO/NO-GO: GO for the next phase, provided the warnings below are tracked before Phase 8 rehearsal.

### Scope reviewed

- Plan: `plans/260911-1753-nexus-s4-identity-store-isolation/phase-04-catalog-store-scope.md`.
- Catalog domain: `packages/catalog/src/catalog-read.ts`, `packages/catalog/src/catalog-write.ts`, `packages/catalog/src/public-store.ts`, `packages/catalog/src/import/exact-match.ts`, `packages/catalog/src/import/import-write.ts`, `packages/catalog/src/import/import-command.ts`, `packages/catalog/src/files/delivery-file.ts`, `packages/catalog/package.json`.
- Worker adapters: `apps/worker/src/console-product-routes.ts`, `apps/worker/src/console-import-routes.ts`, `apps/worker/src/console-file-routes.ts`, public Storefront callers.
- Tests: `tests/integration/catalog-store-isolation.test.ts`, `tests/integration/catalog-crud.test.ts`, `tests/integration/product-create-schema.test.ts`, `tests/integration/schema-regeneration.test.ts`, `tests/integration/import-lifecycle.test.ts`, `tests/integration/delivery-replacement.test.ts`, `tests/integration/public-catalog.test.ts`, `tests/integration/private-order-snapshot.test.ts`, `tests/unit/console-product-adapter.test.ts`, `tests/unit/exact-match.test.ts`, plus caller grep for the changed public contracts.

### Blocking findings

None.

### High priority findings

None.

### Medium priority warnings

1. `tests/integration/catalog-store-isolation.test.ts:35-110` proves the essential Store A/B read/write/import/file path, but it does not cover the full Phase 4 route matrix from the plan. The plan asked for Owner A, Staff A, Owner B, no membership, and revoked Owner across list, detail, revision, schema preview, import, and delivery-file operations. Current coverage has Owner/Staff/Owner B for a subset, plus a create revocation boundary at `tests/integration/catalog-store-isolation.test.ts:140-155`. The implementation looks scoped, but missing direct cases could let a future regression re-open schema preview, import duplicate detection, or variant file paths without failing this new gate.

2. Import retention coverage does not yet exercise every uncertainty branch required by the plan. `packages/catalog/src/import/import-command.ts:163-190` retains the original when the import row is visible after a thrown batch, deletes after confirmed absence, and retains on lookup outage. Tests cover confirmed rollback at `tests/integration/import-lifecycle.test.ts:180-185` and commit-then-error at `tests/integration/import-lifecycle.test.ts:224-244`, but I did not find direct assertions for ownership-read outage, compensation delete failure, or commit-then-error followed by membership revocation before verification. The current code path is reasonable because it reads `imports` by exact `store_id`/`id` before any membership-dependent decision at `packages/catalog/src/import/import-command.ts:165-178`, but the riskiest retention semantics remain under-tested.

3. Delivery-file retention coverage is still product-path only. `tests/integration/delivery-replacement.test.ts:57-103` covers product association rollback compensation and commit-then-error retention. The plan explicitly calls out Product and Variant file methods plus old/purchased snapshot retention. `packages/catalog/src/files/delivery-file.ts:252-257` and `377-381` scope variant prechecks by Store, and `deliveryCommitAssertion` checks variant poststate at `packages/catalog/src/files/delivery-file.ts:203-226`, but a future variant-specific regression would not be caught by the current focused file tests.

### Low priority notes

1. `packages/catalog/src/catalog-write.ts:296-370` uses `ON CONFLICT(id) DO UPDATE` for schema rows without repeating `store_id` in the conflict target. This is acceptable with current callers because `mapSchema` rejects foreign existing IDs at `packages/catalog/src/catalog-write.ts:85-149` and new IDs are UUID-backed in `packages/catalog/src/slug.ts:21-23`. If direct domain callers ever accept externally supplied new IDs, add a test that a guessed foreign group/value/variant ID cannot update another Store.

2. `apps/worker/src/console-import-routes.ts:39-47` serves the template to any authenticated member without an explicit `catalog:read` call. This matches the plan’s “private read without Store data” classification and is not a security issue, since Phase 3 context resolution blocks unauthenticated/no-membership callers before the route. A small explicit read-permission assertion would make the intention clearer.

### Requirement assessment

- Private Store hardcodes: PASS. `BOOTSTRAP_STORE_ID` was moved to `packages/catalog/src/public-store.ts:1`; remaining private catalog and Console adapter calls pass `context.store.id` / `identity.storeId`. Remaining `PUBLIC_STORE_ID` uses are public Storefront/order/fixture paths.
- SQL binding correctness: PASS. Store IDs are bound parameters in private read/write/import/file queries, including JSON payload paths in import preflight/write. I did not find string-interpolated Store IDs in private SQL.
- Always-executed commit assertions including zero effects: PASS in implementation. Product writes use `productCommitAssertion` at `packages/catalog/src/catalog-write.ts:373-392`, create appends it at `419-421`, schema update at `451-467`, and nonstructural update at `546-590`. Import keeps the fixed 45-statement architecture and makes the final import row conditional on active Owner membership and all poststates at `packages/catalog/src/import/import-write.ts:137-167`; empty duplicate/rejected plans still execute the import assertion. Delivery file commit assertions run after product/variant association batches at `packages/catalog/src/files/delivery-file.ts:195-226`, `283-314`, and `362-399`.
- Cross-Store error concealment: PASS for covered paths. Product detail/update/file conceal foreign Store A resources from Store B with 404 in `tests/integration/catalog-store-isolation.test.ts:59-75`; domain reads use Store-scoped filters in `packages/catalog/src/catalog-read.ts:70-137`, `217-242`, and `253-262`.
- D1/R2 uncertain-outcome retention: PASS in implementation for product delivery uploads and CSV originals, with test coverage warnings above. Delivery retains when committed association is observed at `packages/catalog/src/files/delivery-file.ts:316-328`; import retains when the exact import association is visible at `packages/catalog/src/import/import-command.ts:163-170` and on lookup uncertainty at `185-188`.
- Public contract compatibility: PASS. Public Storefront catalog remains bound to `PUBLIC_STORE_ID` via `packages/catalog/src/public-catalog.ts`, and Storefront order routes import the same public Store constant. Private catalog function signatures intentionally changed to require trusted Store/identity context; grep found direct callers updated.
- Security/trust boundary: PASS with warnings. Worker adapters evaluate permissions before private body consumption for catalog product and import/file writes. File upload checks Store/revision/variant before reading the request body at `packages/catalog/src/files/delivery-file.ts:240-259`. R2 keys are treated only as storage locators.

### Verification run

- `npx vitest run tests/integration/catalog-store-isolation.test.ts tests/integration/catalog-crud.test.ts tests/integration/product-create-schema.test.ts tests/integration/schema-regeneration.test.ts tests/integration/import-lifecycle.test.ts tests/integration/delivery-replacement.test.ts tests/integration/public-catalog.test.ts tests/integration/private-order-snapshot.test.ts tests/unit/console-product-adapter.test.ts tests/unit/exact-match.test.ts`: 10 files, 32/32 tests passed.
- `npm run typecheck`: passed.

### Suggested follow-ups

1. Add direct matrix rows for schema preview, product revision conflict, import, product file, and variant file across Owner A, Staff A, Owner B, revoked Owner, and no membership.
2. Add import uncertainty tests for ownership-read outage, compensation delete failure, and commit-then-error with membership revoked before outcome verification.
3. Add variant delivery-file rollback/commit-then-error tests and a private-order-snapshot assertion that purchased file keys remain immutable after replacement/removal.
4. Keep remaining `store_nexus` literals in tests/public paths classified as public fixture authority; do not reintroduce it into private catalog or Console adapters.

## Short re-review after expanded Phase 4 tests — 260912-1805

### Updated verdict

- Blocking findings: none.
- Score: 9.3/10.
- critical_count: 0.
- Auto-mode verdict: AUTO-APPROVE / GO.
- GO/NO-GO: GO.

### Targeted findings

No implementation blocker was exposed by the expanded tests or the delivery current-owner classification change.

The prior Staff/cross-Store/schema warnings are substantially addressed. `tests/integration/catalog-store-isolation.test.ts:54-155` now covers Owner A, Staff A, Owner B, crossed detail/update/schema preview/file, Staff create/preview/import/file denial, same-slug Store A/B coexistence, Store B import scoping, and create rollback on revoke-at-batch. `tests/integration/catalog-store-isolation.test.ts:185-255` extends commit-boundary checks to nonstructural update, schema apply, delivery put/delete, and import revoke-at-batch.

Import uncertainty coverage is now materially stronger. `tests/integration/import-lifecycle.test.ts:224-288` covers commit-then-error with membership revoked before outcome verification, ownership-read outage, and compensation delete failure. The implementation uses an exact internal association read by `store_id` and `importId` before membership-dependent classification at `packages/catalog/src/import/import-command.ts:163-178`, which matches the plan's requirement that revocation must not masquerade as absence.

Delivery uncertainty coverage is also stronger. `packages/catalog/src/files/delivery-file.ts:175-193` adds global reference lookup and current-owner classification, `300-352` retains on referenced/unknown outcomes and only reports permission denial after safe compensation, and `410-419` classifies committed delete response loss as reconciliation. `tests/integration/delivery-replacement.test.ts:77-148` now covers commit-then-error retention, post-failure lookup outage retention, and compensation failure retention/sanitization.

### Residual warning

Variant delivery-file and purchased snapshot immutability remain the only meaningful coverage gap I still see. The implementation scopes variant checks and poststate assertions by Store at `packages/catalog/src/files/delivery-file.ts:261-266`, `309-313`, and `386-398`, and the key-reference check includes `order_lines.private_file_key` at `178-185`. Existing tests cover product delivery replacement/retention and private snapshot copying, but I did not find a direct variant-file rollback/commit-then-error test or a purchased-order snapshot key immutability test after replacement/removal. This is not a Phase 4 blocker because the reviewed implementation follows the intended invariant, but it should be added before Phase 8 rehearsal.

### Fresh verification

- `npx vitest run tests/integration/catalog-store-isolation.test.ts tests/integration/import-lifecycle.test.ts tests/integration/delivery-replacement.test.ts tests/integration/product-create-schema.test.ts tests/integration/private-order-snapshot.test.ts tests/integration/catalog-crud.test.ts tests/integration/schema-regeneration.test.ts tests/integration/public-catalog.test.ts tests/unit/console-product-adapter.test.ts tests/unit/exact-match.test.ts tests/unit/delivery-file.test.ts`: 11 files, 40/40 tests passed.
- `npm run typecheck`: passed.

## Final re-review after Kongming fixes — 260912-1814

### Updated verdict

- Blocking findings: none.
- Score: 9.7/10.
- critical_count: 0.
- Auto-mode verdict: AUTO-APPROVE / GO.
- GO/NO-GO: GO.

### Targeted findings

No implementation blocker remains in the final Phase 4 artifact.

The live-membership read boundary is now materially stronger. `packages/catalog/src/catalog-read.ts:20-28` adds the post-query membership assertion, and the private read functions bind membership predicates into the row queries and recheck after reads at `packages/catalog/src/catalog-read.ts:88-132`, `135-168`, `247-276`, and `286-297`. The new interleaving test at `tests/integration/catalog-store-isolation.test.ts:263-308` proves a revocation during a list read is denied and a write committed just before membership revocation withholds its private result.

Foreign-target concealment now happens before revision/header/permission detail on product and file targets. Product update/schema preview paths read Store-scoped revision before parsing revision conflicts at `apps/worker/src/console-product-routes.ts:130-185`; file routes read Store-scoped revision before evaluating permission or headers at `apps/worker/src/console-file-routes.ts:41-49`. The sentinel cases at `tests/integration/catalog-store-isolation.test.ts:78-105` cover crossed product detail/update/schema preview/file with invalid revision/header inputs returning 404 and no R2 write.

Commit-boundary revocation coverage now covers the meaningful private catalog write families. `tests/integration/catalog-store-isolation.test.ts:198-260` covers nonstructural update rollback, schema apply rollback, delivery put rollback, delivery delete retention, and rejected-only import zero-effect guard under revoke-at-batch. The domain code still uses always-executed commit assertions, including product assertions in `packages/catalog/src/catalog-write.ts:373-392` and import statement 45 in `packages/catalog/src/import/import-write.ts:137-167`.

Import/file uncertainty and sanitized diagnostics are now covered. CSV import retains committed/unknown originals and avoids raw provider details via classification-only logs at `packages/catalog/src/import/import-command.ts:54-89` and `163-190`, with tests at `tests/integration/import-lifecycle.test.ts:224-314`. Delivery file handling classifies referenced/unknown outcomes and current-owner loss at `packages/catalog/src/files/delivery-file.ts:175-193`, `325-350`, and `410-420`, with tests at `tests/integration/delivery-replacement.test.ts:77-148` plus diagnostic sentinel coverage immediately after that block.

Canonical denial codes now align with the contract: user lacks current Store access maps to `store_access_denied` through `CatalogReadAccessError`, while authenticated-but-insufficient role maps to `forbidden` in the Console adapters. The prior generic `permission_denied` surface is gone from the reviewed product/import/file routes.

### Residual note

The only remaining note is non-blocking: I still did not see a dedicated variant delivery-file rollback/commit-then-error test. The implementation scopes variant lookup and poststate assertions by Store, so this is a rehearsal-hardening suggestion rather than a Phase 4 acceptance gap.

### Fresh verification

- `npx vitest run tests/integration/catalog-store-isolation.test.ts tests/integration/import-lifecycle.test.ts tests/integration/delivery-replacement.test.ts tests/integration/product-create-schema.test.ts tests/integration/private-order-snapshot.test.ts tests/integration/catalog-crud.test.ts tests/integration/schema-regeneration.test.ts tests/integration/public-catalog.test.ts tests/unit/console-product-adapter.test.ts tests/unit/exact-match.test.ts tests/unit/delivery-file.test.ts`: 11 files, 43/43 tests passed.
- `npm run typecheck`: passed.
