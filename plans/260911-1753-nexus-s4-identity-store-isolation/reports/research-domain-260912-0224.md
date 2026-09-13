---
type: research
date: 2026-09-12
status: complete-with-verification-blocker
scope: phases-04-05-06
---

# Domain scout for Store isolation, assignments, and Refund decisions

## Summary

The accepted three decisions remain unchanged: Staff sees assigned Orders only, Staff Products are read-only, and one Refund Request per Order stays final after approval/rejection. The existing command architecture is reusable, but the plan needs concrete recovery authorization, assignment schema dependencies, mutation poststate guards, and the complete populated migration dependency closure.

This is source inspection and planning evidence, not implemented S4 behavior or a test pass. Only this report was written. No application/schema/configuration files, remote resources, or credentials were changed. The `ak-scout` workflow informed the symbol/caller inventory; project-organization advisory places this report under the owning plan.

## Evidence and baseline limitations

- Read root/scoped AGENTS, README, the supplied brainstorm/scenario reports, plan index and phases 4–6; inspected phase 2 to resolve assignment schema ordering.
- Existing migrations end at `0007-manual-payments.sql`. Membership, assignment, decision migrations and new tests named by phases 4–6 do not exist yet.
- Attempted discovery only: `npx vitest list --json` exited 1 before collection. Errors: `Could not resolve '@cloudflare/vitest-pool-workers'`, `Could not resolve 'vitest/config'`, then `ERR_MODULE_NOT_FOUND: Cannot find package '@cloudflare/vitest-pool-workers' imported from .../vitest.config.ts.timestamp-...mjs`.
- No dependency installation or test execution followed. Counts below are source-declared test cases, with the one inspected `it.each` expansion stated explicitly; they are not collected runtime totals or passing tests.
- `package.json:18-19` defines `test:unit` as `vitest run tests/unit` and `test:integration` as `vitest run tests/integration`. Appending specific files retains those broad positional filters. Use `npm exec -- vitest run <exact files>` for narrow gates after repository dependencies are available. The existing npm scripts remain valid broad regression commands.

## Phase 4: complete private catalog inventory

### Symbols and callers

All paths below are relative to `/Users/plateau/Project/nexus-handson`.

| Owner file and symbol | Existing caller / role | Required change |
|---|---|---|
| `packages/catalog/src/catalog-read.ts:72` `productRowBy`; `:86` `readProductRevision`; `:93` `readProductIdBySlug`; `:100` `readProductDetailBySlug`; `:108` `readProductDetailById`; `:116` `readDetailFromRow`; `:223` `listProducts` | Product routes `:43,85,92,106,153`; catalog write readbacks `:392,431,442,549`; file revision checks `:203,266,287,321` | Explicit trusted Store context in private APIs and nested group/value/variant/membership queries. `readProductIdBySlug` has no discovered caller; remove if still unused rather than retain an unscoped export. |
| `packages/catalog/src/catalog-write.ts:76` `mapSchema`; `:294` `schemaStatements`; `:371` `createProduct`; `:397` `validateSchemaForProduct`; `:405` `applyProductSchema`; `:436` `updateProductNonstructural` | Product routes `:101,108,122,132,142` | Store-scoped validation, uniqueness, schema references, guarded batches and readbacks; current Owner predicate at commit. |
| `packages/catalog/src/import/exact-match.ts:290` `preflightExactMatch` | `import-command.ts:136`; `tests/unit/exact-match.test.ts:29,39,48,56,64,69`; `tests/integration/import-lifecycle.test.ts:188,208` | Replace bootstrap payload at `:294` with trusted Store; retain all duplicate and exact-match semantics. |
| `packages/catalog/src/import/import-write.ts:42` `executeImportWrite` | `import-command.ts:137`; exact-match test helper `:15`; import-lifecycle `:190,212` | Replace interpolated Store constant in all five insert families `:61,83,94,106,117`; metadata Store `:126`; guard authorization even when poststate list is empty. |
| `packages/catalog/src/import/import-command.ts:78` `executeCsvImport` | `apps/worker/src/console-import-routes.ts:61` | Trusted Owner input, pre-upload authorization, Store-scoped preflight/write, compensation for definitive failed commit. |
| `packages/catalog/src/files/delivery-file.ts:184` `putDeliveryFile`; `:281` `deleteDeliveryFile` | `apps/worker/src/console-file-routes.ts:43,60`; direct integration caller `delivery-replacement.test.ts:63` | Store scope, pre-consumption Owner check, current membership and exact association poststate invariant in batch. |
| `apps/worker/src/console-product-routes.ts:71` `routeConsoleProductRequest`; helper `assertRevision` at `:42` | Worker router | Migrate all calls and error-path revision lookup `:153`. Move schema-preview raw query at `:109-112` into catalog ownership. |
| `apps/worker/src/console-import-routes.ts:31` `routeConsoleImportRequest` | Worker router | Resolve role before `request.arrayBuffer()` at `:60`, including direct POST. Explicitly classify template GET at `:33` as a private-route read with no Store data. |
| `apps/worker/src/console-file-routes.ts:25` `routeConsoleFileRequest` | Worker router | Both Product and Variant PUT/DELETE paths get trusted context; permission must precede revision/body validation that could disclose a foreign resource. |

Exact current private endpoint set: GET `/api/console/products`; GET `/api/console/products/by-slug/:slug`; POST `/api/console/products/schema/preview` (new and existing product forms); POST `/api/console/products`; PUT `/api/console/products/:id/schema`; PUT `/api/console/products/:id`; GET `/api/console/imports/template`; POST `/api/console/imports`; PUT/DELETE `/api/console/products/:id/delivery-file`; PUT/DELETE `/api/console/products/:id/variants/:variantId/delivery-file`. There is no existing import-result GET or general Product DELETE to invent for this cutover.

### Deliberate public consumers and compile-time impact

- `packages/catalog/src/public-catalog.ts:2,18-55` imports the bootstrap constant and reads Store A explicitly. `apps/worker/src/storefront-product-routes.ts:1` calls this public projection. Preserve Store A routing.
- `apps/worker/src/storefront-order-routes.ts:1` imports the bootstrap constant for public Order/capability routing. Move its constant import to the deliberately public owner if `catalog-read.ts:12` loses that export.
- `packages/catalog/src/private-order-snapshot.ts:87` already accepts `storeId`; `packages/orders/src/commands/order-write.ts:94-98` supplies the public create context. Preserve this explicit Store-scoped resolver, its private snapshot output and the immutable Order-line copy. Do not turn the resolver into an implicit Store A fallback merely because its public caller targets A.
- `apps/worker/src/console-order-routes.ts:1,38,127` is the private bootstrap consumer removed by phase 5.
- Direct test imports of the bootstrap constant: `orders-persistence.test.ts:4`, `private-order-snapshot.test.ts:4`, `order-commands.test.ts:13`, `order-operations-routes.test.ts:4`. Include them in signature/import migration.
- Console imports `csv-parser` and `csv-validator` in `csv-import-screen.tsx:3-4` and validator types in `csv-preview-table.tsx:8`; these are pure preview consumers, not database authority. Do not make pure browser parsing depend on server identity.
- Fixture correction: Product and Variant IDs are global primary keys (`0001-store-products.sql:11`, `0002-product-variants.sql:45`), while Product slug and Variant SKU are Store-local unique (`0001:40`, `0002:66`). Seed distinct IDs with colliding slugs/SKUs; test global-ID collision as rejection, not a valid cross-Store duplicate ID fixture.

### Atomic catalog and R2 gaps to make testable

1. Every write needs a final *unconditional assertion statement* capable of failing when all preceding conditional writes affect zero rows. A `WHERE active_owner` on every statement by itself can silently commit no effect and return success. Test revoked Owner on a new Product, schema replacement, ordinary update, file association, and a duplicate-only/rejected-only import whose guarded poststates are empty.
2. Delivery precheck precedes streaming (`delivery-file.ts:203-218`) but currently has no identity. Its D1 success path does not inspect changed rows or associated key and unconditionally reports `expectedRevision + 1` (`:237-277`). Preserve revision guards while proving the intended Product/Variant association exists at the expected revision and membership is current inside the transaction. If the target disappears or becomes ineligible between precheck and batch, zero-row success must be impossible.
3. Existing delivery compensation retries deletion three times (`:164-174`) and only runs for size mismatch or thrown association failure (`:228-270`). `DELETE` only clears database association and does not delete R2 data (`:281-330`). Preserve both old object and purchased snapshot keys. Add Product and Variant tests, late revocation, stale revision, failure after an actual D1 write, and compensation failure. Existing `delivery-replacement.test.ts:57-73` rejects the entire batch before any statement; it does not establish rollback of a partially executed association.
4. Import uploads before parsing/preflight (`import-command.ts:89-110`), and route consumes bytes at `console-import-routes.ts:60`. Add route authorization before bytes and package authorization before R2. A late authorization failure must roll back every catalog/import row and compensate only the new original.
5. If an association failure is ambiguous rather than a confirmed D1 rollback, establish that the new key is unreferenced before deleting it; if verification is unavailable, retain it and report a sanitized incident. Never delete old/purchased keys. Avoid logging raw storage errors containing private object identity.
6. Import architecture currently fixes statement count and rejects drift (`import-write.ts:157-163`); retain this established public-maintainer contract where possible by incorporating the Owner invariant in the existing final statement. Retest the 500-row/45-statement architecture (`import-lifecycle.test.ts:187,204`) if guards alter statement shape.

## Phase 5: assignment, visibility, and replay

### Exact symbol/caller inventory

| Owner file and symbol | Current evidence / callers | Planned seam |
|---|---|---|
| `order-read.ts:214` `encodeCursor`; `:221` `decodeCursor` | Six fields currently bind date/id/query/status/refund/limit only (`:239-255`) | Bind Store and principal visibility. Never treat decoded role as authority. Apply live row visibility regardless of cursor. |
| `order-read.ts:261` `boundBasePredicate`; `:300` `pageSelectSql`; `:448` `listConsoleOrders` | List, line-page subquery and summary; independent `hasOrders` query at `:483` | Shared Store/current assignment membership predicate on every row/count path, including has-any. |
| `order-read.ts:360` `readConsoleOrderByReference` | Five-statement header/line/refund/history/payment batch `:366-416`; route `console-order-routes.ts:160` | Scope each subquery to authorized Order; no hidden payment/history fetch that bypasses visibility. |
| `order-read.ts:204` `allowedActions` | Used at `:430`; currently only Order state/refund occupancy | Replace with evaluator-backed result plus state eligibility. |
| `transitions/order-transitions.ts:18` `authorizedActor` | `order-commands.ts:75` | Replace bootstrap-only branch; preserve Customer identity check for request submission. |
| `order-commands.ts:59` `prepareCommand` | `markPaid :99`, `fulfillOrder :271`, `cancelOrder :399`, `createRefundRequest :527` | Current resource authorization before parsing/hash/ledger, and safe replay result query. |
| `command-store.ts:97` `readOrderTarget`; `:76` `readLedger`; `:122` `readCommandResult` | Preparation and recovery paths | Explicit trusted context/visibility for private callers; preserve Customer path separately. |
| `command-store.ts:207` `bindExistingResult` | Existing-effect branches in all four commands and their conflict callbacks | Commit-time authorization even when only a new ledger row is written; authorize catch recovery and result read. |
| `command-store.ts:254` `recoverFailedBatch`; `:278` `runCommandBatch` | All four commands | Check current authorization before conflict callback, ledger lookup, existing-effect lookup, error classification, and post-success result disclosure. |
| `console-order-routes.ts:38` `bootstrapOwnerContext`; `:127` `lookupBootstrapOrderId`; `:137` route | List/detail and POST manual payment `:169`, fulfillment `:189`, cancellation `:209`, refund request `:229` | Replace manufactured context; move raw lookup into Orders; add assignment/candidate endpoints with Owner policy. |
| Proposed `commands/order-assignment.ts` | No current implementation/caller | Owner assignment batch; target Staff membership; durable audit target plus command identity and result. |

Paths in table without package prefix belong to `packages/orders/src/`; Worker file belongs to `apps/worker/src/`.

### Recovery privacy and race design

Current preparation authorizes before ledger (`order-commands.ts:73-93`), but `recoverFailedBatch` reads ledger first (`command-store.ts:266-270`), `bindExistingResult` catches and reads ledger without authority (`:245-251`), and `runCommandBatch` executes `onConflictReplay` before generic recovery (`:292-296`). Success also reads a result after awaited commit (`:298`). Merely upgrading `prepareCommand` leaves all those S4 paths incomplete.

Use the same trusted authorization facts/predicate builder at current resource/result reads and commit guards. A post-await memory-only role check is insufficient. Result queries must join a currently authorized target; denial/error recovery must not reveal whether a hidden Order/payment/command key exists. A command may commit before a subsequent reassignment, while its later response is concealed if authority was lost before disclosure. Do not promise that already committed authorized work can be undone.

For assignment, record the deciding Owner as actor and the assigned user as durable event data. Hash explicit action, Order, real actor, and target Staff ID. A replay must return the recorded assignment result, not live current assignee inferred by joining the assignment table; reassignment since the original command must not rewrite history or replay another assignment. Define same-target/new-key behavior explicitly without producing misleading duplicate audit events. Same-key changed target conflicts. Target membership demotion/revocation must be checked in the assignment batch along with current Owner membership.

### Required phase dependency correction

Phase 5 needs new assignment command/history action constraints before it can pass. Current `order_history_event_combo` accepts only existing S3 action combinations (`0006:203-259`) and `order_commands_version_action` only S3 command names (`0006:327-329`). Phase 6 cannot be the first migration to broaden these constraints.

Keep the eight phases. Expand phase 2's new `0009-store-memberships.sql` to include assignment audit/result schema alongside membership/assignment tables. Stage `order_history`, `order_commands`, and **payments**; drop commands and payments before history; recreate/restore history with assignment action and durable target attribution; recreate/restore payments exactly and command rows with assignment action support; restore all dropped indexes. Existing Orders and Refund tables can remain parents in 0009. Preserve IDs, old contract/source/actor values and timestamps exactly. No fabricated assignment history for existing Orders.

`payments` belongs in the closure because `0007-manual-payments.sql:27-29` references `(history_id, order_id, store_id)` in history. This dependency did not exist when migration 0006 rebuilt history. Capture schema/index/FK metadata rather than copying the older migration's narrower drop list.

### Concrete missing Red gates

- Assignment-versus-processing in both forced commit orders, plus Owner demotion/Staff revocation between preparation and batch; current status must remain valid and audit/ledger effects all commit or none.
- Target Staff revocation during assignment; same-key lost response replay; changed target conflict; replay after later reassignment returns original result without modifying current assignment.
- Revocation/reassignment during direct ledger replay, during `bindExistingResult`, during `onConflictReplay`, generic failed-batch recovery, and after successful batch before result query. Compare denial shape to absent/foreign target and assert no private result fields or new ledger rows.
- Owner, Staff A1, Staff A2, other Store and no-active-membership over detail/list/search/summary/hasOrders, with zero/one/page/page+1 assignments and copied/tampered cursors. Include payment-reference search because `boundBasePredicate :274-279` searches Console-only payment evidence.
- Use existing real D1 proxy/barrier utilities (`order-commands.test.ts:109-158`) and failure splice (`:212-230`) to control ordering; do not fake successful database results. No production sleep/test backdoor required.
- Add `tests/integration/order-operations-routes.test.ts` to the phase's ownership/regression inventory: its ten cases are the actual pagination, filter, summaries, public/Console operations and privacy suite, not the two-case `console-orders.test.ts` alone.

## Phase 6: terminal decision, migration, and projection

### Exact affected symbols and consumers

- `order-types.ts:56` Refund projection, `:160` Console status, `:163` history, `:174` detail/actions, `:182` query; existing request/action parsers in `order-validation.ts:210,277` need decision counterparts.
- `order-read.ts:165` `refundFromRow`, `:204` `allowedActions`, `:300` list status subquery, `:335` `readCustomerOrderById`, `:360` Console detail, `:428` hard-coded Console pending status, and summary at `:475-479`. Pending-only summary/filter may remain explicitly a pending queue, but terminal detail/list status must be truthful.
- `command-store.ts:109` `refundProjection` hard-codes `pending`; `:122` `readCommandResult` lacks terminal decision fields; `:190` `readOpenRefund` filters pending. Replace open-only occupancy lookup throughout request creation/recovery, not just request INSERT.
- `order-commands.ts:527` `createRefundRequest`, existing-result branch `:545`, conflict branch `:579`, INSERT no-pending guard `:602`; all three must recognize permanent occupancy.
- `apps/worker/src/storefront-order-routes.ts` uses the Customer projection/command result path; preserve capability guard precedence and separate Console authorization.
- Integration to phase 7: `apps/storefront/src/storefront-view-types.ts:64-77`, API `api-client.ts:185`; Console `order-ui-types.ts:51-56,84,123`, `orders-screen.tsx:100,393`, `order-detail-screen.tsx:96-97,622,894-900`. Do not add a decider field to a shared projection and accidentally expose it through Customer output.

### Concrete three-statement decision protocol

The current phase text says every statement checks `pending`, but its final ledger statement follows the terminal UPDATE. That ledger predicate would always fail on a successful decision. Separate prestate and poststate:

1. Conditional history insert selects the exact pending request + same Store Order in `paid|fulfilled` + current active Owner membership. Write one generated history ID, request ID, real actor and one decision time. New unique partial index on `(store_id, order_id, refund_request_id)` **across both** `refund_approved` and `refund_rejected` enforces one winning decision event, not one per action.
2. Conditional Refund UPDATE requires pending prestate, current Owner and that exact new history ID/request/actor/action. Set chosen terminal status, `decided_at`, and real deciding user. Keep Order/payment rows untouched.
3. Unconditional command-ledger INSERT uses a non-null CASE guard over **terminal poststate**: expected request ID/status/decider/time, exact new history ID/action/source/actor, current Owner, same Store+Order and valid Order state. A failed guard forces rollback of prior writes. It must not require the request still be pending.

Concurrent distinct keys/actions therefore have one winner; loser cannot create event/ledger. Identical key/hash may replay only after current authorization. Opposite intent or a changed body with the same key conflicts. A new decision key against terminal state does not reopen or overwrite it. Customer/Console request-submission retries, including new request keys, return the single recorded request in its actual current terminal state; they never invent another pending request.

Use an explicit legal-status CHECK and consistency CHECK requiring null decision fields while pending and non-null fields for terminal states. Persist a durable deciding user FK without cascading deletion of history; membership revocation/name edits must not erase attribution. Add a non-partial unique `(store_id, order_id)` Refund constraint.

### Migration closure and TDD corrections

- Migration 0010 must stage **payments, order_commands, order_history, order_refund_requests**. Drop commands/payments, then history, then refunds. Recreate/restore refunds, then history, then child payments/commands with preserved IDs; recreate indexes. Order/access/line/idempotency parents remain untouched unless actual dependency inspection proves otherwise.
- Preserve assignment actions/columns introduced by 0009 when expanding history/commands for decisions. Do not reconstruct a schema7 history table and lose phase 5 assignment evidence.
- Current migration helper only imports seven files (`tests/support/catalog-test-env.ts:2-8,74-82`), allows through `4|5|6|7` (`:84`), defaults to 7 (`:86,115`), and reset drop list omits future identity/assignment children (`:90-110`). Add this helper to phase 2/6 ownership; retain historical-through fixtures and adopt a latest-schema helper with FK-safe reset order. Its SQL splitter drops PRAGMAs (`:65,70`), so PRAGMA-dependent migration rehearsal is not equivalent to this helper automatically.
- Seed through populated pre-S4 and intermediate 0009 state: legacy v1 events, bootstrap v2 events, current user assignment events, refunds, manual payments, no-evidence legacy paid Orders, capabilities, line snapshots and retained R2 keys. Compare exact rows/reference graph and foreign-key checks before/after, then inject failure after staging, between drops/rebuilds, and late restore. Verify rollback and retry from the correct migration checkpoint.
- Decision tests must compare full business/audit/ledger snapshots after faults after history, after Refund UPDATE, after ledger; include concurrent approve/reject, same-key same-intent, changed-key opposite intent, terminal resubmission by both Customer and Console, and revocation during recovery.
- JSON privacy assertions should whitelist Customer decision shape: retain existing safe request `id/reason/createdAt` contract, add status/decision time, and exclude decider identity, history, payment evidence, internal notes and R2 identity. Test both Customer GET and request-command retry response.

## Existing tests and proposed commands

These source counts intentionally overlap where a regression suite protects more than one phase. No new S4 test case exists yet in the named proposed files.

| Phase | Existing files and source-declared case counts | Total for this selection |
|---|---|---:|
| 4 primary catalog integration | `catalog-crud` 3; `product-create-schema` 4 (2 direct + `it.each` with 2 rows at `:55-78`); `schema-regeneration` 1; `import-lifecycle` 9; `delivery-replacement` 2; `public-catalog` 1 | 20 |
| 4 additional compatibility/retention | `private-order-snapshot` 3 integration; unit `exact-match` 3, `delivery-file` 3, `console-product-adapter` 1 | 10 |
| 5 Orders domain/HTTP | `order-commands` 18; `console-orders` 2; `order-operations-routes` 10 | 30 |
| 6 migration/command/privacy baseline | `order-brief-migration` 8; `order-operations-migration` 4; `order-commands` 18; `private-order-snapshot` 3; `order-operations-routes` 10; `order-routes` 4; `orders-persistence` 12 | 59 |

Count reproduction (source declarations; inspect parameterization separately):

```sh
rg -n '^\s*it(\(|\.each)' tests/integration/*.test.ts tests/unit/{console-product-adapter,exact-match,delivery-file}.test.ts
```

Existing file selections; **not executed and currently environment-blocked** until dependencies are installed by the controller:

```sh
npm exec -- vitest run tests/integration/catalog-crud.test.ts tests/integration/product-create-schema.test.ts tests/integration/schema-regeneration.test.ts tests/integration/import-lifecycle.test.ts tests/integration/delivery-replacement.test.ts tests/integration/public-catalog.test.ts
npm exec -- vitest run tests/integration/order-commands.test.ts tests/integration/console-orders.test.ts tests/integration/order-operations-routes.test.ts
npm exec -- vitest run tests/integration/order-brief-migration.test.ts tests/integration/order-operations-migration.test.ts tests/integration/private-order-snapshot.test.ts tests/integration/order-routes.test.ts tests/integration/orders-persistence.test.ts
```

Proposed future Red/Green selections; these files **do not exist today**:

```sh
npm exec -- vitest run tests/integration/catalog-store-isolation.test.ts
npm exec -- vitest run tests/integration/order-assignment.test.ts
npm exec -- vitest run tests/integration/refund-decision-migration.test.ts tests/integration/refund-decisions.test.ts
```

Run each named new test to prove a behavior-relevant Red after its fixture infrastructure exists, record failure reason, implement the owned boundary, then rerun the same test and relevant existing regressions. Missing-file/config failure is not Red evidence. Finish affected public-type work with `npm run typecheck`; broaden to the full integration suite after shared fixture/schema changes.

## Recommendations and unresolved questions

Correct phase 2's schema prerequisite and phase 6's pending/poststate contradiction before execution. Expand phase 4/5 inventories with the real callers/test helper and order-operations route suite. Name recovery authorization and R2 zero-row failure gates explicitly. Keep all three user decisions and the eight-phase delivery table.

No product decision is required by these corrections. Remaining implementation detail: specify cursor visibility version ownership (or choose a simpler principal-bound cursor plus live visibility and recovery behavior); specify same-target/new-key assignment semantics and its immutable result representation. Dependency installation and real Worker/D1 collection remain unverified.

Status: DONE_WITH_CONCERNS
Summary: Completed the phase 4–6 source inventory, migration dependency correction, and concrete TDD gaps without changing application code or the plan.
Concerns/Blockers: Runtime test collection is blocked by missing repository dependencies; counts are source-declared, not passing totals.
