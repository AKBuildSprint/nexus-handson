---
phase: 2
title: "Implement atomic operational commands"
status: pending
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: Implement atomic operational commands

## Goal
Apply commands exactly once under overlapping D1 batches, with durable replay and unchanged purchase snapshots.

## Context and ownership
- [Input strategy](../../ORDER_OPERATIONS_PLAN.md), Phase 2.
- [Accepted business contract](../reports/brainstorm-260906-1738-nexus-s3-order-operations.md).
- [Scenario authority](../reports/scenario-260907-0155-nexus-s3-order-operations.md).
- Execution phase ID: 2; source label: 2. Dependencies use execution IDs. Status is pending; no S3 implementation proof is claimed.
- Sequential gate; no overlapping writers on shared files.

## Files to Create / Modify
All paths below are relative to the repository root. No production files are changed during planning.
- Create: `src/orders/order-operations.ts`
- Create: `tests/integration/order-operations.test.ts`
- Modify: `src/orders/order-types.ts`
- Modify: `src/orders/order-validation.ts`
- Modify: `src/orders/order-read.ts`
- Modify: `tests/integration/orders-persistence.test.ts`
- Delete: none. No shims, compatibility overloads, or second design system.
- Intentionally unchanged: `src/orders/private-access.ts` remains the authorization reader; `tests/integration/private-order-snapshot.test.ts` stays an S2 regression, not an S3 operational test.

## Tests Before (RED)
Write domain transition/replay and barrier race tests against real env.DB before command SQL. Fail on absent command API or wrong effect. Both callers must arrive at a test-only batch barrier; release in each required order, with fresh reads after completion. Add cross-Order same-key simultaneous commands and forced history/ledger abort before implementation.

Record the failing command and the behavioral assertion that fails before changing source. An import failure may establish the initial missing surface, but replace it with observable-contract assertions before GREEN. Existing S2 regressions remain in the gate.

## Requirements, architecture and implementation steps
1. Mở rộng `src/orders/order-types.ts`:
   - `OrderStatus = 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled'`;
   - `OrderRefundRequest = { id: string; reason: string; status: 'pending'; createdAt: string }`;
   - `OrderHistoryEntry = { sequence; action; fromStatus; toStatus; source; refundRequestId; createdAt }`;
   - `ConsoleOrderAction = 'mark_paid' | 'mark_fulfilled' | 'cancel'`;
   - detail thêm `history`, `refundRequest`, `allowedActions`; private projection thêm `refundRequest`. Required list `hasPendingRefund` type and mapper change move together in Phase 3.
   - Decouple Console list projection from Customer-only `refundRequest` when widening `CustomerOrderProjection` (currently `ConsoleOrderProjection extends CustomerOrderProjection`). Reuse common purchase fields, but do not spread the new private projection into list responses. Detail may expose the request by contract; list remains purchase fields + Customer snapshot, gaining only `hasPendingRefund` in Phase 3.
   - `OrderCommandResult = { outcome: 'applied' | 'already_applied'; replayed: boolean; resultStatus: OrderStatus }` luôn đi cùng current Order projection; UI không lấy `resultStatus` cũ để ghi đè current `order.status`.
2. Mở rộng `src/orders/order-validation.ts` nhưng không thay create parser. Reuse `objectAt`, `rejectUnknown`, `IDEMPOTENCY_KEY`, `CAPABILITY`; thêm strict parser cho:
   - Console body `{ action, acknowledgedRefundRequestId }`, field thứ hai bắt buộc là `null` cho paid/cancel và `null | /^refund_[a-f0-9]{32}$/` cho fulfill;
   - Refund body `{ reason }`; lưu đúng chuỗi sau JavaScript `trim()`, không NFKC-transform nội dung Customer; reject non-string, empty, U+0000, hoặc quá 1000 Unicode code points bằng `422 validation_failed` với path `/reason`. **[Red-team R1]** Đếm bằng `for...of`, dừng tại code point thứ 1001; không tạo mảng `[...reason]`. Phase 3 chặn body vượt 16 KiB trước JSON parsing cho hai mutation mới; không đổi create parser hoặc giới hạn nội dung 1–1000 code points.
   - Reject ill-formed UTF-16 (unpaired surrogates) with 422 `/reason` before hashing/binding; never silently replace private text. Add paired astral, combining-mark, ZWJ and isolated-surrogate cases to the same IN01 matrix. This preserves valid Unicode code points and exact stored text, not UTF-16-unit counting.
   - list query chỉ nhận `q`, `status`, `refund`, `cursor`; unknown/invalid trả `422 validation_failed`.
3. Tạo `src/orders/order-operations.ts`; không có equivalent hiện tại và không nhét operational semantics vào create-only `order-write.ts`. Exports chính xác:
   - `executeConsoleOrderAction(input: { database: D1Database; reference: string; body: unknown; idempotencyKey: unknown }): Promise<{ order: ConsoleOrderDetailProjection; command: OrderCommandResult }>`;
   - `requestOrderRefund(input: { database: D1Database; orderId: string; body: unknown; idempotencyKey: unknown }): Promise<{ order: CustomerOrderProjection; command: OrderCommandResult }>`; chỉ API boundary được gọi hàm này sau private authorization.
   - Implement `readConsoleOrderDetail(database, reference)` in `src/orders/order-read.ts` now: one read-only batch returns base Order/refund and history ordered by sequence; derive allowedActions from that same snapshot. Extend `readCustomerOrderById` with a single-statement refund join. Commands return these complete projections in Phase 2; Phase 3 only exposes/reuses them and adds list pagination. Keep `paymentNextStep` in the existing Worker response mapper, not the domain projection.
4. Canonical payload digest dùng SHA-256 của JSON với key order cố định:
   - paid/cancel: `{"action":"mark_paid"}` / `{"action":"cancel"}`;
   - fulfill: `{"action":"mark_fulfilled","acknowledgedRefundRequestId":null|string}`;
   - refund: `{"action":"request_refund","reason":"<trimmed>"}`.
   `order_id` được so riêng. Cùng Store/key nhưng khác Order, action hoặc digest trả `409 idempotency_conflict`, không đọc/mutate command khác.
5. Console action resolve reference trong `BOOTSTRAP_STORE_ID`. Với private refund, `routeStorefrontOrderRequest` phải decode reference rồi gọi `findOrderIdByCapability` trong một khối catch chỉ bao quanh reference/capability authorization; malformed/missing/wrong/cross-Order capability thành cùng `404 not_found`. Chỉ sau khi có authorized `orderId` mới parse JSON, Idempotency-Key và reason rồi gọi `requestOrderRefund`, để caller hợp lệ vẫn nhận `400 invalid_json`/invalid header hoặc `422 validation_failed`. Không bọc các validation sau authorization trong private-404 catch.
   - This is the Phase 3 route boundary contract, not a Phase 2 route edit. Phase 2 domain tests may call `requestOrderRefund` with an authorized fixture Order ID; only Phase 3 exposes it publicly. Unexpected DB failures propagate as sanitized persistence errors, not fabricated authorization denial.
6. Replay fast path: nếu `order_commands` đã có key và exact Order/action/digest, không chạy mutation; đọc current aggregate rồi trả stored `outcome/resultStatus` với `replayed=true`. Vì vậy Paid K1 replay sau Fulfill trả current Order `fulfilled` nhưng xác nhận K1 đã thành công. Rejected commands không có ledger row.
7. New Console action sinh một candidate command/history ID rồi chạy đúng một `D1Database.batch`:
   - INSERT candidate command bằng `INSERT … SELECT … ON CONFLICT(store_id,request_key) DO NOTHING` chỉ khi commit-time state thỏa rule; `mark_paid` cho `pending_payment` với outcome `applied`, hoặc current `paid` với `already_applied`; `mark_fulfilled` chỉ cho `(paid + không có refund + acknowledgement=null)` hoặc `(paid + acknowledgement ID trùng request hiện tại)`; `cancel` chỉ cho `pending_payment`;
   - conditional UPDATE status và INSERT history chỉ tham chiếu candidate command ID vừa sinh, nên một row của request cạnh tranh không thể dùng command row của winner;
   - history cấp `MAX(sequence)+1` trong transaction và chỉ ghi cho `outcome='applied'`, gắn request ID vào fulfilled history khi đã xác nhận.
8. New Refund Request chạy đúng một `D1Database.batch`:
   - INSERT request bằng `INSERT … SELECT` chỉ khi current status là `paid|fulfilled` **và `NOT EXISTS (SELECT 1 FROM order_commands WHERE store_id = ? AND request_key = ?)` inside the transaction**, rồi `ON CONFLICT(order_id,store_id) DO NOTHING`. This commit-time key guard prevents a losing same-key/different-Order or different-action caller from leaving a refund before the ledger conflict is classified.
   - INSERT candidate command conflict-safe, selecting the actual winning `refund_requests` row by `(store_id,order_id)`, never a non-inserted candidate refund ID. Outcome is `applied` only if that row ID equals the candidate refund ID; otherwise `already_applied`. History ID is non-null only for the applied candidate.
   - INSERT one sequenced `refund_requested` event only if **both** the candidate command ID exists with outcome `applied` and the winning refund ID equals this caller's candidate. Do not gate history only on the refund row or a shared request key.
   - Different key/reason after an existing request returns the first request without overwrite; same key with changed Order/action/reason returns `idempotency_conflict`. `pending_payment|cancelled` writes no request/history/command. A known competing key means the first INSERT is zero-row; subsequent conflict-safe statements cannot mutate the loser Order.
   - Add simultaneous same-key/different-Order and cross-action refund regressions with both callers paused before batch. Assert losing Order has zero refund/event writes, original command unchanged, winner one effect and loser 409. Post-read conflict alone is insufficient proof because a zero-row `ON CONFLICT` does not roll back earlier writes.
9. Sau mọi batch outcome — success, zero-row guard hoặc exception — luôn re-read `order_commands` bằng `(store_id, request_key)` trước khi classify state/error, đúng pattern `createOrder` lines 183–187. Exact Order/action/digest trả stored result và current aggregate (`replayed=true` nếu row không phải candidate của caller); mismatch trả `409 idempotency_conflict`; không có row mới phân loại `refund_acknowledgement_required`, `order_state_conflict` hoặc persistence failure. Vì vậy hai concurrent request cùng key đều nhận cùng successful result; new Mark paid trên current `paid` là trường hợp already-applied duy nhất, còn new key trên `fulfilled`, `cancelled`, second Fulfill hoặc second Cancel không được nâng thành replay.
10. Concurrency không dựa vào pre-read hoặc button disable. D1 batch là atomic boundary; UNIQUE command/refund constraints và `orders_status_transition` chọn một serializable winner. Paid-vs-Cancel chỉ một batch tạo command/history; refund-vs-Fulfill có đúng hai legal commit orders: refund trước chặn unacknowledged Fulfill, Fulfill trước vẫn cho refund trên `fulfilled`. Mọi error ở history/command cuối batch rollback status/refund và cho phép retry sạch.
11. Sau server trả `refund_acknowledgement_required`, client phải refetch, hiển thị request và tạo idempotency key mới cho intent có confirmation. Nếu UI đã thấy request trước khi click, dialog chỉ gửi một confirmed command với key mới; cancel/Escape không gửi request. Điều này phân biệt payload-change khỏi retry nguyên intent và khóa câu hỏi §18.2.

Phase 2 tests tạo `tests/integration/order-operations.test.ts`. Dùng wrapper `D1Database` chỉ trì hoãn `batch()` ở một shared barrier rồi delegate về cùng `env.DB.batch`; hai promises phải cùng tới barrier trước release, sau đó assert từ fresh snapshot reads. Không thêm production-only test hook. Parameterize transition matrix ST04; TM01 chạy simultaneous same-key cho Paid/Fulfill/Cancel/Refund và đòi cả hai caller nhận equivalent success; TM02 K1 replay versus K3 reject; TM03/TM04; cả hai commit orders TM05; DI01 hai reason; IN03 changed Order/action/reason; BL01/BL02; DI03 snapshot before/after. Inject `RAISE(ABORT)` trigger ở history/command write để ER01 chứng minh rollback giữa transaction; lost-response ER02 phải bỏ response sau commit rồi retry cùng key, không giả lỗi trước handler. Ép create/Paid/Fulfilled cùng `created_at` trong fixture và assert history sequence vẫn là 0/1/2.

## Refactor
Keep create-only idempotency separate from operational commands. Reuse existing validation, response, projection and UI conventions. Once RED passes, simplify only touched code while preserving every scenario below. Run LSP references before changing exported symbols; migrate every production and test consumer, no compatibility branch.

## Test matrix
| Scenario / acceptance | Layer or behavior | Required observation |
|---|---|---|
| TM03 / ER01 / DI03 | Critical domain | Exactly one legal history branch; rollback every write; snapshot preserved |
| TM01 / TM02 / TM04 / IN03 | Replay and key binding | Equivalent successful outcome for same intent; mismatches write nothing |
| TM05 / DI01 / BL02 | Refund concurrency | Both serial orders; exact acknowledgement; first reason preserved |
| ER02 / ER03 / BL01 / IN01 | Failure and boundaries | Retry original committed intent; no false success; zero total manual; Unicode rules |

## Tests After (GREEN)
P0: TM03 both commit orders, ER01 rollback, DI03 snapshot/money. P1: TM01 for all four operations, TM02 original-key replay versus new-key rejection, TM04, TM05 both orders, DI01, ER02 committed lost response, ER03 database unavailable, BL01/BL02, IN01/IN03. Force identical event timestamps and verify sequence 0/1/2.

## Verification and regression gate
Run from repository root, Node >=22 and lockfile dependencies installed. Listed new tests are implementation deliverables, not tests that exist or have passed during planning.

```sh
npx vitest run tests/integration/order-operations.test.ts tests/integration/orders-persistence.test.ts tests/integration/private-order-snapshot.test.ts
```

## Risk assessment and stop conditions
A request inserted before its command gate must never survive a losing same-key collision. Candidate IDs gate all effects. Re-read ledger after every batch outcome before classifying. Projection readers required by command return types must be implemented in this phase, not deferred to Phase 3.

Stop at this phase if required observations fail. Fix the owning root cause; do not weaken constraints, substitute mock success, or advance across the dependency gate. Local D1 proof is not remote D1 proof.

## Security considerations
Force BOOTSTRAP_STORE_ID; private authorization precedes body parsing and replay. Anonymous Console is an accepted demo risk, never authenticated Owner authorization. Keep capability only in existing fragment/header transport; never expose delivery/file identity, private URLs, request keys, reasons in errors/logs, or digests. Refund is request-only and remains pending after fulfillment.

## Todo
- [x] Write failing 2 behavioral coverage first.
- [x] Implement the complete 2 contract and migrate consumers.
- [x] Refactor touched code without weakening invariants.
- [x] Run the phase gate and record exact observations.

## Success criteria and next gate
Apply commands exactly once under overlapping D1 batches, with durable replay and unchanged purchase snapshots. All Test matrix observations and the exact regression gate pass. Next: execution phase 3.
