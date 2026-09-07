---
phase: 1
title: "Preserve S2 data and migrate lifecycle"
status: pending
priority: P1
effort: ""
dependencies: []
---

# Phase 1: Preserve S2 data and migrate lifecycle

## Goal
Migrate real S2 Orders to the S3 schema without weakening any stored-data invariant.

## Context and ownership
- [Input strategy](../../ORDER_OPERATIONS_PLAN.md), Phase 1.
- [Accepted business contract](../reports/brainstorm-260906-1738-nexus-s3-order-operations.md).
- [Scenario authority](../reports/scenario-260907-0155-nexus-s3-order-operations.md).
- Execution phase ID: 1; source label: 1. Dependencies use execution IDs. Status is pending; no S3 implementation proof is claimed.
- Sequential gate; no overlapping writers on shared files.

## Files to Create / Modify
All paths below are relative to the repository root. No production files are changed during planning.
- Create: `migrations/0005-order-operations.sql`
- Create: `tests/integration/s3-order-migration.test.ts`
- Modify: `tests/support/catalog-test-env.ts`
- Modify: `src/catalog/slug.ts`
- Modify: `src/orders/order-write.ts`
- Modify: `tests/integration/migration-constraints.test.ts`
- Modify: `tests/integration/orders-persistence.test.ts`
- Temporary verification artifact: `scripts/verification/s3-order-migration-smoke.mjs`, created during implementation, removed after recording proof; not a permanent service or application module.
- Delete: none. No shims, compatibility overloads, or second design system.

## Tests Before (RED)
Seed 0001–0004 only, using the S2 insert shape (not the changed createOrder); preserve a known capability and create key. Write DI02/A13 migration assertions first. Initially fail because 0005 and new lifecycle do not exist. Add invalid edge/status and exactly-one-line preservation cases; do not call latest-schema reset before capturing S2 rows.

Record the failing command and the behavioral assertion that fails before changing source. An import failure may establish the initial missing surface, but replace it with observable-contract assertions before GREEN. Existing S2 regressions remain in the gate.

## Requirements, architecture and implementation steps
1. Tạo append-only `migrations/0005-order-operations.sql`; tuyệt đối không sửa `0004-orders.sql`. Tránh phụ thuộc vào `PRAGMA foreign_keys=OFF`/`defer_foreign_keys` chưa được chứng minh giống nhau giữa Workerd và remote D1. SQL order cố định: create/copy `orders_s3`; create/copy `order_lines_s3` và `order_access_s3`; create/copy `order_idempotency_s3` trỏ tới access tạm; create empty `refund_requests` trỏ tới `orders_s3`; create/copy `order_history_s3` trỏ tới `orders_s3` và refund table; drop graph cũ theo thứ tự `order_idempotency → order_access → order_history → order_lines → orders`; rename graph tạm về tên cũ để SQLite rewrite dependent FK names; recreate indexes/triggers; cuối cùng create `order_commands` trỏ tới tên final. Copy nguyên mọi S2 column, composite FK, UNIQUE, money/snapshot CHECK và đặc biệt `order_lines_order_total_fk DEFERRABLE INITIALLY DEFERRED`; recreate nguyên `order_lines_prevent_delete`, `order_lines_prevent_reparent`, `orders_require_exactly_one_line`.
2. Chỉ thay đổi `orders.status` thành `CHECK (status IN ('pending_payment','paid','fulfilled','cancelled'))`. Thêm trigger `orders_status_transition` chỉ cho `pending_payment → paid`, `pending_payment → cancelled`, `paid → fulfilled`; same-status và mọi cạnh khác abort. Application không dùng same-status UPDATE để biểu diễn idempotency.
3. Mở rộng physical `order_history` nhưng giữ column `status` làm to-status để giảm migration surface. Schema mới có:
   - `sequence INTEGER NOT NULL CHECK (sequence >= 0)` và `UNIQUE(store_id, order_id, sequence)` làm lifecycle order duy nhất;
   - `action`: `order_created | mark_paid | mark_fulfilled | cancel | refund_requested`;
   - `previous_status`: nullable bốn-value Order status;
   - `status`: bốn-value to-status;
   - `source`: `storefront | console`;
   - `refund_request_id`: nullable composite FK theo Store.
   CHECK shape bắt buộc: create là `NULL → pending_payment`, Storefront, không refund; paid/cancel/fulfilled là các cạnh hợp lệ từ Console; refund là `paid → paid` hoặc `fulfilled → fulfilled`, Storefront, có request ID. Backfill mọi S2 history row thành sequence `0`, `order_created`, `previous_status=NULL`, `status='pending_payment'`, `source='storefront'` và giữ nguyên `id/store_id/order_id/created_at`. Mỗi applied action/refund cấp `MAX(sequence)+1` bên trong cùng serialized write batch; API/UI chỉ order theo `sequence`, không dùng random history ID để phá tie khi nhiều event cùng millisecond.
4. Thêm `refund_requests`: `id`, `store_id`, `order_id`, `reason`, `status='pending'`, `created_at`; composite Store FK/identity và `UNIQUE(order_id, store_id)` bảo đảm một request mỗi Order. `reason` có CHECK không chứa U+0000 và `length(reason) BETWEEN 1 AND 1000`; SQLite `length(TEXT)` và parser Phase 2 cùng đếm Unicode code points. Không thêm refund state vào `orders.status`.
5. Thêm `order_commands`, tách khỏi create-only `order_idempotency`: `id`, `store_id`, `request_key`, `order_id`, `action`, SHA-256 `payload_digest`, `outcome ('applied'|'already_applied')`, `result_status`, nullable `history_id`, nullable `refund_request_id`, `created_at`; `UNIQUE(store_id, request_key)`, Store-scoped FKs và index `(store_id, request_key, order_id)`. FK tới history được `DEFERRABLE INITIALLY DEFERRED` để một atomic batch có thể ghi command gate trước history. Không persist reason trong command ledger; digest ràng buộc canonical payload mà không nhân bản private text.
   - Enforce same-Order links, not merely same Store: parent history/refund tables expose `UNIQUE(id,store_id,order_id)`; command history/refund FKs and history refund FK include all three columns. The command→history FK remains deferred. Direct cross-Order/same-Store links must fail even when `foreign_key_check` would accept a weaker schema.
   - Command CHECKs preserve S2-style key bounds/charset and 64-lowercase-hex digest; enumerate ledger actions `mark_paid | mark_fulfilled | cancel | request_refund` (history uses `refund_requested`). `outcome='applied'` requires non-null `history_id`; `already_applied` requires null history and is allowed only for mark_paid/result paid or request_refund/result paid|fulfilled. Applied result statuses are paid/fulfilled/cancelled for matching Console actions, or paid|fulfilled for refund. request_refund requires a refund ID; mark_paid/cancel forbid it; mark_fulfilled may reference the acknowledged request. This makes an applied command with a missing history row fail the deferred FK instead of committing success.
6. Thêm status/refund list indexes: giữ `(store_id, created_at DESC, id DESC)`, thêm `(store_id, status, created_at DESC, id DESC)`; uniqueness của `refund_requests(order_id,store_id)` phục vụ pending-refund EXISTS/join.
7. Cập nhật `tests/support/catalog-test-env.ts`: import/register migration 0005; export `applyS2Migrations()` cho fixture chỉ qua 0004; giữ `applyCatalogMigrations()` là latest. Reset theo thứ tự `order_commands → order_idempotency → order_access → order_history → refund_requests → order_lines → orders → customers`, rồi giữ nguyên phần catalog còn lại. Không drop refund trước history vì history có FK tới refund. Mở rộng `stableId` trong `src/catalog/slug.ts` với chính xác `cmd` và `refund`.
8. Cập nhật history INSERT cuối batch của `createOrder` sang shape `sequence=0/order_created/NULL/pending_payment/storefront`; giữ nguyên Product-revision failing assertion và sáu-table create rollback/replay semantics. LSP đã xác nhận các caller phải đồng bộ: `src/worker/storefront-order-routes.ts` và toàn bộ direct calls trong `tests/integration/orders-persistence.test.ts`.

Phase 1 acceptance: migration test đi từ DB chỉ có 0001–0004 và dữ liệu Order thật sang 0005, không phải create trực tiếp trên schema mới rồi gọi đó là migration evidence. Sau copy chỉ còn đúng 15 domain tables, không còn `_s3`; `PRAGMA foreign_key_check` rỗng; row-for-row snapshot/access/create-idempotency/history identity còn nguyên; private link cũ và retry create cũ trả đúng Order, không tạo Order thứ hai; bốn status hợp lệ được DB chấp nhận, status rác và cạnh chuyển sai bị DB từ chối. Đây là DI02 Critical và A13 gate; Phase 2 không bắt đầu nếu gate này fail.

### Grounded migration details
- Create temporary tables without final indexes/triggers. Restore all five S2 indexes and all three S2 triggers after renaming; otherwise the exactly-one-line insert trigger can block the copy or index names collide.
- Rename `orders_s3` to `orders` first, then rename its temporary child tables; inspect final FK targets to ensure no `_s3` references survive.
- Before any destructive DDL, fail closed if an S2 Order has zero or multiple history rows. The S2 schema allows this drift although the create path writes exactly one. Add zero/two-history fixtures and assert a safe abort preserving the original graph. Do not delete, merge or fabricate events to satisfy sequence 0; stop for data-repair approval. Valid application-created S2 Orders migrate unchanged.
- `customers` is unchanged, not rebuilt. Domain table count excludes D1 metadata. Update the existing 13-table and paid-is-invalid fixtures in `tests/integration/migration-constraints.test.ts`; create a valid line-before-Order fixture for each accepted status rather than bypassing one-line rules.
- Seed old-shape SQL using the same S2 data constraints before applying 0005. Do not invoke the newly modified `createOrder` against schema 0004. After migration, use the current private read/create replay to prove continuity.
- Confirm local Wrangler's real migration execution as well as Workerd `applyD1Migrations` before leaving this gate; use a fresh isolated local persistence directory. Inject a late migration failure in the isolated fixture and prove the pre-migration graph/data remain intact before retrying. Never apply a destructive migration experiment to existing workspace data.
- This tightens fixture and migration execution details only; full-graph copy, no PRAGMA dependency and source scope are unchanged.

## Refactor
Keep create-only idempotency separate from operational commands. Reuse existing validation, response, projection and UI conventions. Once RED passes, simplify only touched code while preserving every scenario below. Run LSP references before changing exported symbols; migrate every production and test consumer, no compatibility branch.

## Test matrix
| Scenario / acceptance | Layer or behavior | Required observation |
|---|---|---|
| DI02 / A13 | Real S2 migration | Old capability/create key remain valid; exact data unchanged |
| DI03 / A2 | Snapshot preservation | Money, quantity, catalog/customer/file snapshot unchanged |
| A13 | Database invalid writes | CHECK/FK/one-line constraints remain enforced |

## Tests After (GREEN)
DI02: compare every copied row/column and history identity; 15 domain tables excluding D1 bookkeeping, no temporary tables; empty foreign_key_check. Old private link/create replay return original Order. Wrong total, second line, reparent, line delete and invalid transition still abort.

## Verification and regression gate
Run from repository root, Node >=22 and lockfile dependencies installed. Listed new tests are implementation deliverables, not tests that exist or have passed during planning.

```sh
npx vitest run tests/integration/s3-order-migration.test.ts tests/integration/migration-constraints.test.ts tests/integration/orders-persistence.test.ts
```

Local migration smoke: create an isolated temporary config whose `migrations_dir` contains copies of 0001–0004, with binding `DB`, and an isolated persistence directory. Apply S2, seed valid old-shape rows, add a copied 0005 with a deliberately failing final statement, and invoke the same apply command. Verify rollback to the exact S2 graph; replace only the temporary failed copy with actual 0005 and retry. Capture schema/data/FK observations. The temporary config/fixture files are smoke artifacts, not production config.

Implement one throwaway driver at `scripts/verification/s3-order-migration-smoke.mjs` that owns the entire sequence above with Node `mkdtemp`, argv-based Wrangler subprocesses, unique fixture IDs, before/after schema + row snapshots, expected failing exit and preserved-graph assertions, actual migration retry, empty foreign_key_check and `finally` cleanup of only its own temp directory. Resolve repo paths from the driver, never the caller's temporary cwd. Exit nonzero if any observation fails; emit a sanitized summary containing no capability or reason. Invoke from repository root:

```sh
node scripts/verification/s3-order-migration-smoke.mjs
```

The following is the internal Wrangler command used by that driver, not a substitute for its seed/failure/assertion sequence:

```sh
npx wrangler d1 migrations apply DB --local --config "$TEMP_CONFIG" --persist-to "$TEMP_STATE"
```

`TEMP_CONFIG` and `TEMP_STATE` must be newly created local paths; never point at workspace `.wrangler` or a remote binding. Live `npx wrangler d1 migrations apply --help` confirms these flags and per-failed-migration rollback. Remove only this smoke's temporary files after proof.

## Risk assessment and stop conditions
Migration must not rely on a foreign-key disabling pragma. DDL graph failure blocks all downstream work. Reset helpers must respect history → refund dependencies. Preserve indexes and all S2 constraints, not only counts.

Stop at this phase if required observations fail. Fix the owning root cause; do not weaken constraints, substitute mock success, or advance across the dependency gate. Local D1 proof is not remote D1 proof.

## Security considerations
Force BOOTSTRAP_STORE_ID; private authorization precedes body parsing and replay. Anonymous Console is an accepted demo risk, never authenticated Owner authorization. Keep capability only in existing fragment/header transport; never expose delivery/file identity, private URLs, request keys, reasons in errors/logs, or digests. Refund is request-only and remains pending after fulfillment.

## Todo
- [x] Write failing 1 behavioral coverage first.
- [x] Implement the complete 1 contract and migrate consumers.
- [x] Refactor touched code without weakening invariants.
- [x] Run the phase gate and record exact observations.

## Success criteria and next gate
Migrate real S2 Orders to the S3 schema without weakening any stored-data invariant. All Test matrix observations and the exact regression gate pass. Next: execution phase 2.
