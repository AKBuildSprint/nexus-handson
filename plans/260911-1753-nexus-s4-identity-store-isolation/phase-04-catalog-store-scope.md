---
phase: 4
title: "Cut every private catalog path over to Store scope"
status: pending
priority: P1
effort: 2.5d
dependencies: [2, 3]
---

# Phase 4: Cut every private catalog path over to Store scope

## Goal

Remove the private catalog's hard-coded `store_nexus` authority and enforce Owner-write/Staff-read permissions across list, detail, revision, schema preview, import, and delivery-file operations without changing the public Store A catalog.

## Context Links

- [Plan](./plan.md)
- [Canonical implementation contracts](./contracts.md)
- [Exact symbols, callers, current tests and gaps](./reports/research-domain-260912-0224.md#phase-4-complete-private-catalog-inventory)
- `packages/catalog/src/catalog-read.ts:12-248`
- `packages/catalog/src/catalog-write.ts:11-552`
- `packages/catalog/src/import/exact-match.ts:293-342`
- `packages/catalog/src/import/import-write.ts:1-152`
- `packages/catalog/src/files/delivery-file.ts:184-316`
- `apps/worker/src/console-product-routes.ts:71-220`
- Scenarios S4-07, S4-27, S4-29, S4-30, S4-39, S4-44, S4-48

## Overview

- **Priority:** P1.
- **Current status:** Pending.
- **Boundary:** private catalog APIs require trusted `IdentityContext`; public catalog remains deliberately `store_nexus`.
- **Authority:** Staff can read. Only Owner can create/update/schema/import/file mutate. Existing integrity guards still apply to Owner.

## Requirements

### Functional

- Every private read accepts `storeId` and filters every aggregate/subquery by it.
- Every write uses evaluator permission and current membership in the committing D1 batch.
- Schema preview raw SQL no longer contains `store_id='store_nexus'`.
- Import exact-match, plan, guarded poststate, and persisted import row all use the same trusted Store.
- File authorization happens before body consumption/R2 upload; D1 association remains Store-scoped.
- Public catalog and Storefront Order snapshot resolution still target Store A explicitly.

### Non-functional

- Do not add a second catalog API or compatibility overload.
- R2 key/prefix is never authorization.
- Purchased order-line snapshot keys and old Product references remain immutable.

## Architecture

Thread explicit `StoreContext`/`IdentityContext` through existing functions. `BOOTSTRAP_STORE_ID` remains only in public Storefront-facing modules and fixture/default seed code. Catalog functions use `@nexus/identity/permissions` for role policy; SQL still lives in catalog.

Atomic revocation rule: mutations use conditional statements with an active Owner membership predicate inside one D1 batch. The final assertion must execute even if every effect selected zero rows, and force a constraint failure unless current authorization, expected revision and this operation's poststate all hold. A conditional zero-row write or batch success is not that proof. For imports, incorporate authorization into the existing unconditional final import-row INSERT with its non-null CASE guard; duplicate-only/rejected-only imports with empty `guardedPoststates` must still deny a revoked Owner. Preserve the fixed 45-statement architecture unless measured evidence requires an explicitly reviewed change.

Delivery association poststate includes the exact new key, Product/Variant identity, expected new revision and eligible delivery source. A confirmed failed D1 batch compensates only the new upload. If commit outcome is uncertain, first establish that the new key is unreferenced; when that cannot be established, retain it and return a sanitized incident. Never delete retained old or purchased snapshot objects. Authorization happens before request bytes are consumed and again at commit.

Audit correction (2026-09-12): apply the same rule to CSV originals. `executeCsvImport` captures one import ID/key, then classifies a thrown batch as confirmed rollback, committed, or unknown. Before compensation, prove rollback or definitive absence of the exact `(storeId, importId, privateObjectKey)` association with no outstanding commit. Use a server-internal Store-scoped ownership read, not a member-filtered response whose denial could masquerade as absence after revocation. Committed/unknown outcomes retain the file and return a sanitized incident without automatic retry, private-key disclosure or reversal of committed catalog/import rows. Do not add a public import-result lookup API.

## File Inventory

| File | Action | Rough change | Test impact |
|---|---|---:|---|
| `/Users/plateau/Project/nexus-handson/packages/catalog/package.json` | Modify | 1 dependency | Identity evaluator import |
| `/Users/plateau/Project/nexus-handson/packages/catalog/src/catalog-read.ts` | Modify | 70–110 lines | Explicit Store reads |
| `/Users/plateau/Project/nexus-handson/packages/catalog/src/catalog-write.ts` | Modify | 120–190 lines | Store/Owner guarded batches |
| `/Users/plateau/Project/nexus-handson/packages/catalog/src/import/exact-match.ts` | Modify | 25–45 lines | Store-scoped duplicate matching |
| `/Users/plateau/Project/nexus-handson/packages/catalog/src/import/import-command.ts` | Modify | Context + compensation classifier | Store/permission input; retain originals on committed/unknown D1 outcome |
| `/Users/plateau/Project/nexus-handson/packages/catalog/src/import/import-write.ts` | Modify | 40–70 lines | Remove interpolated Store A SQL |
| `/Users/plateau/Project/nexus-handson/packages/catalog/src/files/delivery-file.ts` | Modify | 70–110 lines | Owner guard and safe R2 ordering |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/console-product-routes.ts` | Modify | 50–80 lines | Context and raw-query cutover |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/console-import-routes.ts` | Modify | 20–35 lines | Owner-only import |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/console-file-routes.ts` | Modify | 25–45 lines | Owner-only files |
| `/Users/plateau/Project/nexus-handson/tests/integration/catalog-store-isolation.test.ts` | Create | 280–380 lines | Cross-Store/private-path matrix |
| `/Users/plateau/Project/nexus-handson/tests/integration/delivery-replacement.test.ts` | Modify | 40–80 lines | R2 compensation/retention |
| `/Users/plateau/Project/nexus-handson/tests/integration/import-lifecycle.test.ts` | Modify | Scoped import + fault cases | Real commit-then-error, rollback/absence, lookup outage and compensation failure |
| `/Users/plateau/Project/nexus-handson/packages/catalog/src/public-catalog.ts` | Modify import only | Small | Preserve explicit public Store A constant ownership |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/storefront-order-routes.ts` | Modify import only | Small | Public Order routing remains Store A |
| `/Users/plateau/Project/nexus-handson/tests/unit/exact-match.test.ts` | Modify | Context fixtures | Direct preflight/write caller signatures |
| `/Users/plateau/Project/nexus-handson/tests/integration/catalog-crud.test.ts` | Modify fixtures | Scoped requests | Existing catalog lifecycle |
| `/Users/plateau/Project/nexus-handson/tests/integration/product-create-schema.test.ts` | Modify fixtures | Scoped requests | Existing schema preview/create contracts |
| `/Users/plateau/Project/nexus-handson/tests/integration/schema-regeneration.test.ts` | Modify fixtures | Scoped requests | Historical Variant reuse |
| `/Users/plateau/Project/nexus-handson/tests/integration/public-catalog.test.ts` | Verify/extend | Public continuity | Store B cookie cannot route public catalog |
| `/Users/plateau/Project/nexus-handson/tests/integration/private-order-snapshot.test.ts` | Modify import/extend | Retention | Explicit Store snapshot resolver |

### Interface checklist

- [x] `readProductRevision`, `readProductDetailBySlug/Id`, `listProducts`, `productRowBy` and nested `readDetailFromRow` receive trusted Store scope. Remove unused `readProductIdBySlug` if still caller-free.
- [x] `mapSchema`, `schemaStatements`, `validateSchemaForProduct`, `createProduct`, `applyProductSchema`, `updateProductNonstructural` and their post-write/error reads use that same context.
- [x] `preflightExactMatch`, `executeImportWrite`, `executeCsvImport`, `putDeliveryFile` and `deleteDeliveryFile` require their explicit Store/permission contract; update direct test callers.
- [x] CSV compensation uses exact Store/import/key ownership independently of caller visibility; confirmed commit or unknown lookup retains the original. Sanitize persistence/compensation diagnostics and do not auto-resubmit unknown imports.
- [x] Move Worker preview SQL into catalog; update all product/import/file routes. Cover new/existing schema previews and both Product/Variant file methods. Classify the existing template GET as a private read without Store data; do not invent an import-result GET or Product DELETE.
- [x] Move the bootstrap constant to its deliberately public owner and update public/fixture imports. `private-order-snapshot.ts:87` already takes `storeId`; preserve this API and its explicit public caller in `order-write.ts:94-98`. Pure Console CSV parser/validator imports remain identity-free.
- [x] Coordinate bootstrap imports in `orders-persistence.test.ts`, `order-commands.test.ts` and `order-operations-routes.test.ts` with phase 5. Reuse phase 2/3 authenticated test helpers instead of another fixture authority.

## Dependency Map

`Phase 3 trusted context -> catalog reads/writes/import/files -> Phase 7 role-aware Product UI -> Phase 8 crossed-Store rehearsal`.

## Test Scenario Matrix

| Priority | Scenarios | Boundary | Proof |
|---|---|---|---|
| Critical | S4-07, S4-29, S4-30 | Worker/D1 | Forged Store/role/IDs never broaden or mutate |
| Critical | S4-27, S4-44 | Worker/D1/R2 | Unauthorized upload never reaches R2; association failure preserves old/snapshot objects |
| Critical | S4-48 | D1 domain | Owner authority cannot bypass retention/FK guards |
| High | Store-local collisions | Integration | Same slugs/SKUs coexist across A/B without cross-match |

## Tests Before

Run under Node 22 with the lockfile dependencies installed by `npm ci`; record the exact runtime. Current runner discovery is blocked by missing packages, so no baseline pass or S4 Red is claimed. Characterize existing behavior, make the new fixture/test compile, then record a failing authorization/atomicity assertion. Missing imports, unavailable dependencies, broken fixture schema and zero discovered tests are setup failures, not behavioral Red.

Static baseline: six primary integration files contain 20 source-declared cases (`catalog-crud` 3, `product-create-schema` 4 including two `it.each` rows, `schema-regeneration` 1, `import-lifecycle` 9, `delivery-replacement` 2, `public-catalog` 1). Compatibility selection adds 10 cases (`private-order-snapshot` 3; unit `exact-match` 3, `delivery-file` 3, `console-product-adapter` 1). These are overlapping source inventories, not executed counts; see the linked research report.

1. Create a route matrix for Owner A, Staff A, Owner B, no membership, and revoked Owner over every private catalog endpoint/method.
2. Seed distinct global Product/Variant IDs with colliding Store-local slugs/SKUs, schema draft references, import rows, and file targets in Stores A/B. Global ID collisions must reject, never overwrite the other Store.
3. Make tests assert response concealment plus D1/R2 non-effects; UI-hidden controls are not evidence.
4. Add revocation-during-write fault hooks at domain batch boundaries for create/update/import/file association.
5. Add empty-poststate duplicate-only/rejected-only import revocation; assert no import/catalog row and safe original compensation. Assert unauthorized import/file requests never consume bytes or reach R2.
6. Force Product/Variant association to select zero rows after precheck and inject a real D1 failure after an earlier write. Assert no false success/revision increment; preserve old/snapshot keys. Exercise confirmed rollback, uncertain outcome, unreference-check outage and compensation failure separately.
7. Wrap a real D1 import batch so it commits and then throws a response error: assert the committed import/catalog rows and exact R2 original remain. Separately prove confirmed rollback/definitive absence deletes only the new original; ownership-read outage retains it; delete failure returns sanitized incident. Repeat commit-then-error with membership revoked before ownership verification to prove concealment is not absence. These are real persistence fault seams, not fake successful writes.

## Implementation Steps

1. Focused-scout all `BOOTSTRAP_STORE_ID` and literal `store_nexus` uses in catalog and Console adapters. Classify each as public-intentional or private-to-remove.
2. Add identity dependency and update every private read signature with Store scope. Ensure nested detail queries use the row's trusted Store, not a global constant.
3. Update create, nonstructural update, schema application, and preview validation to accept trusted context and use Store in all statements.
4. Parameterize import duplicate detection, write plans, guarded poststates, import rows, and object association. Remove Store interpolation from SQL strings. Replace unconditional error compensation with the Store/import/key outcome classification above; retain committed or unresolved originals and emit sanitized incident diagnostics.
5. For delivery files, authorize and verify Store-scoped Product/Variant/revision before consuming the request body. Upload only after that check; prove exact association poststate in the D1 batch. Compensate only the new unreferenced object after confirmed rollback or a successful unreference check; retain it on unresolved commit uncertainty.
6. Add commit-time Owner membership guards and an always-executed failing assertion to mutation batches, including empty import plans. Follow contracts.md error precedence: conceal foreign resources before exposing revision/integrity detail; use existing domain errors only after authorization.
7. Pass Worker-resolved context into product/import/file adapters. Return read-only Product payloads to Staff and refuse direct mutation calls.
8. Keep `public-catalog.ts`, Storefront catalog route, and Storefront Order creation fixed to Store A; add comments naming this deliberate public routing boundary.

## Refactor

Delete private compatibility overloads, constants, and route-level raw catalog SQL. Keep public Store A constant in public modules only. Avoid a generic repository/context wrapper; explicit function parameters make omissions compile-time-visible.

## Tests After

- Exercise schema preview, revision errors, import result details, and delivery mutation against crossed Stores.
- Verify Staff gets the same safe Product read projection but no private write succeeds.
- Verify Store B collisions do not affect Store A duplicate checks or writes.
- Rerun CSV commit-then-error, confirmed rollback/absence, ownership-read outage/revocation and compensation-failure cases after refactor. Retained evidence and committed rows must survive an unknown outcome; diagnostics contain no raw exceptions/private keys.
- Verify old R2 keys and order-line snapshot keys remain unchanged after replacement/removal and approved Refund state.

## Todo

- [x] Scout and classify every Store A constant use.
- [x] Write failing cross-Store and Staff-write matrices.
- [x] Thread Store context through all private reads and writes.
- [x] Guard import and file operations at authorization and commit boundaries.
- [x] Preserve explicit public Store A modules.
- [x] Remove private Store constants and prove crossed paths have no effect.

## Success Criteria

No private catalog code can select Store A without trusted context. Staff reads work. Owner writes retain all existing validation/retention rules. Cross-Store IDs/slugs/SKUs/previews/imports/files are unavailable and side-effect free.

## Regression Gate

After Node 22 plus `npm ci`, first run the new behavioral gate (file is proposed, absent today), then existing regressions. Save the Red assertion, Green result and refactor rerun; do not treat missing-file failure as Red.

```sh
npx vitest run tests/integration/catalog-store-isolation.test.ts
npx vitest run tests/integration/catalog-crud.test.ts tests/integration/product-create-schema.test.ts tests/integration/schema-regeneration.test.ts tests/integration/import-lifecycle.test.ts tests/integration/delivery-replacement.test.ts tests/integration/public-catalog.test.ts tests/integration/private-order-snapshot.test.ts
npx vitest run tests/unit/console-product-adapter.test.ts tests/unit/exact-match.test.ts tests/unit/delivery-file.test.ts
npm run typecheck
```

The first command names a new file; the following selections already exist. Appending file filters to `npm run test:integration` retains its broad directory filter, so it is reserved for the broader shared-schema/fixture regression gate.

## Risk Assessment

- **Missed constant/bypass:** signal is a private `BOOTSTRAP_STORE_ID` or `store_nexus` match after cutover. Response: fail code review and migrate the caller; do not whitelist private paths.
- **R2 orphan/retention error:** signal is changed old/snapshot key or unassociated new object. Response: stop file rollout; prove ownership before compensation.
- **Batch guard masks integrity errors:** signal is wrong status/code for stale revision. Response: preserve separate evaluator and integrity predicates while keeping denial non-disclosing.

## Security Considerations

Store scope applies to validation details and error branches, not only successful rows. Bound every query parameter; never interpolate Store IDs. CORS is not authorization. R2 object names are opaque storage locators only.

## Next Steps

Phase 7 can expose Staff read-only UI after this server boundary passes. Phase 8 repeats the path matrix against populated Store A and Store B fixtures.
