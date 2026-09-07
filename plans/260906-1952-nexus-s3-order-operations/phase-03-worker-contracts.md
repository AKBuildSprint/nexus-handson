---
phase: 3
title: "Expose safe Worker read and write contracts"
status: pending
priority: P1
effort: ""
dependencies: [2]
---

# Phase 3: Expose safe Worker read and write contracts

## Goal
Expose paged Console operations and capability-authorized refunds with coherent, redacted server projections.

## Context and ownership
- [Input strategy](../../ORDER_OPERATIONS_PLAN.md), Phase 3.
- [Accepted business contract](../reports/brainstorm-260906-1738-nexus-s3-order-operations.md).
- [Scenario authority](../reports/scenario-260907-0155-nexus-s3-order-operations.md).
- Execution phase ID: 3; source label: 3. Dependencies use execution IDs. Status is pending; no S3 implementation proof is claimed.
- Sequential gate; no overlapping writers on shared files.

## Files to Create / Modify
All paths below are relative to the repository root. No production files are changed during planning.

- Modify: `src/orders/order-read.ts`
- Modify: `src/orders/order-types.ts` (list criteria and hasPendingRefund with mapper cutover).
- Modify: `src/worker/console-order-routes.ts`
- Modify: `src/worker/storefront-order-routes.ts`
- Modify: `src/worker/storefront-cors.ts`
- Create: `src/worker/order-operation-body.ts` (one bounded JSON reader shared by the two new mutation routes; existing create parsing stays unchanged).
- Modify: `tests/integration/orders-persistence.test.ts`
- Modify: `tests/integration/console-orders.test.ts`
- Modify: `tests/integration/order-routes.test.ts`
- Modify: `tests/integration/storefront-cors.test.ts`
- Modify: `tests/integration/spa-api-routing.test.ts`
- Delete: none. No shims, compatibility overloads, or second design system.

## Tests Before (RED)
Add direct Worker route assertions first: private authorization precedence even with malformed JSON/known keys, Store isolation, no-store/redaction, Unicode literal search, duplicate-timestamp pagination and read/write overlap. Expect 404 for not-yet-added routes; missing filters/projection fields must cause meaningful failures.
**[Red-team R1]** Add byte-boundary cases before the new reader: valid JSON at 16,384 bytes succeeds, 16,385 bytes returns sanitized `413 payload_too_large`, including missing or understated Content-Length. A fully escaped 1,000-astral-code-point reason still fits and succeeds. Unauthorized oversized refund bodies remain uniform 404 and are not read; authorized in-bound malformed JSON remains 400. Assert zero command/history/refund writes on rejected bodies.

Record the failing command and the behavioral assertion that fails before changing source. An import failure may establish the initial missing surface, but replace it with observable-contract assertions before GREEN. Existing S2 regressions remain in the gate.

## Requirements, architecture and implementation steps
1. Mở rộng `src/orders/order-read.ts`; LSP đã xác nhận `listConsoleOrders` hiện có đúng hai caller (`src/worker/console-order-routes.ts`, `tests/integration/orders-persistence.test.ts`) ngoài declaration/import. Đổi thành `listConsoleOrders(database, criteria): Promise<{ orders; nextCursor: string | null; hasAnyOrders: boolean }>` và migrate cả hai caller, không giữ compatibility overload.
   - Add required `hasPendingRefund` to the list type and its mapper in this same phase. Existing detail/private aggregate readers were completed in Phase 2; do not introduce a second implementation or defer command return correctness to this phase.
2. Console list contract: `GET /api/console/orders?q=&status=all|pending_payment|paid|fulfilled|cancelled&refund=all|pending&cursor=`. Page size cố định 25; không thêm client-controlled `limit`. Cursor opaque base64url JSON `[createdAt,id]`, validate exact two strings, dùng SQL keyset predicate `created_at < ? OR (created_at = ? AND id < ?)` và sort `created_at DESC, id DESC`. SQL áp dụng Store/status/refund/cursor rồi đọc bounded chunks 100 rows; Worker dùng `normalizeComparisonKey` cho query và từng purchase-time `orders.reference/customer_name/customer_email_normalized`, literal `.includes()` nên `%/_` không bao giờ là wildcard và non-ASCII case normalization giống JavaScript ở cả phía query/data. Giữ tối đa 26 match trong memory, trả 25; chỉ phát `nextCursor` ở row thứ 25 khi đã tìm thấy match thứ 26. `hasAnyOrders` bỏ qua criteria để UI phân biệt Store rỗng với no-match. Không join live `customers/products`, không gửi full set về browser và không materialize toàn bộ candidate set trong Worker.
3. `readConsoleOrderDetail` phải lấy base Order/refund cùng history trong một read-only `D1Database.batch`; current private projection/replay lấy base Order+refund bằng một SQL statement. Derive `allowedActions` chỉ từ cùng snapshot: pending là `['mark_paid','cancel']`, paid là `['mark_fulfilled']` dù có refund, fulfilled/cancelled là `[]`. Console `GET /api/console/orders/:reference` trả flat `ConsoleOrderDetailProjection`: immutable purchase snapshot, current status, Customer snapshot, history theo `sequence`, current refund và actions; concurrent write chỉ có thể cho response hoàn toàn trước hoặc sau commit, không status/history/refund bị xé. Không trả raw capability/private URL/access instructions/private-file identity/idempotency digest. Malformed/missing reference trả `404 order_not_found`.
4. Console mutation contract: `POST /api/console/orders/:reference/actions`, headers `Content-Type`, `Idempotency-Key`, body strict Phase 2. Success `200 { order, command }`; illegal state/ack/idempotency codes theo Phase 2. Unexpected failures giữ `jsonError`, `Cache-Control: no-store`, sanitized incident log; không log body, key, capability, private URL hay reason.
5. Storefront giữ create `POST /api/storefront/orders` và private `GET /api/storefront/orders/:reference`. Customer projection luôn có `paymentNextStep: string | null`: string hiện tại chỉ khi `pending_payment`, `null` cho `paid|fulfilled|cancelled`; thêm current `refundRequest`.
   - Apply the existing `customerResponse` mapping consistently to create, private GET and the nested `order` in refund success/replay. Domain command results deliberately do not carry `paymentNextStep`; every Customer HTTP Order does, and it is null after paid/fulfilled/cancelled.
   - Assert Console list responses omit `refundRequest`, `reason`, history and command metadata recursively; list exposes only `hasPendingRefund`. Console detail and authorized private responses intentionally expose the request. This prevents the existing shared Customer spread from widening the anonymous list projection accidentally.
6. Thêm `POST /api/storefront/orders/:reference/refund-requests` với capability + idempotency headers và body strict `{reason}`. Route authorize reference/capability trước khi đọc JSON/key/body hoặc command cache; winner trả `201 {order,command}`, exact replay/existing request trả `200`, auth failure luôn uniform private `404`, còn authorized invalid JSON/header/reason/state giữ error contract Phase 2. `requestedMethodForPath` cho đúng path này POST; header allow-list hiện tại đã đủ. Wrong origin/method/header tiếp tục không nhận CORS grant; CORS không được mô tả như auth.
   - Authorize failures map to uniform 404 only for reference/capability validation or absent matches; unexpected D1 errors use the sanitized 500 path. Authorized malformed JSON/headers/reason remain 400/422. Add a distinct refund POST path matcher rather than widening the existing private GET regex.
   - **[Red-team R1]** Both new POST routes use `readOrderOperationJson(request): Promise<unknown>` from `src/worker/order-operation-body.ts`, implemented in this phase with the existing `OrderValidationError`/`jsonError` conventions. Maximum encoded body size is **16 KiB (16,384 bytes)**, including JSON syntax and whitespace; this transport bound is separate from the trimmed reason's 1–1000-code-point rule and accommodates 1,000 astral characters even as JSON surrogate escapes.
   - For refund, complete reference/capability authorization before inspecting Content-Length or reading any body byte; a missing/wrong capability still yields private 404. For Console actions, bound the body before parsing/validating it. A valid declared length above the limit may reject early, but absent, invalid or understated lengths never bypass the actual stream-byte count. Cancel the reader immediately on overflow; do not concatenate/decode the overflowing input or call `request.json()` first. Accumulate at most the limit, decode and JSON-parse only after EOF. Overflow uses `OrderValidationError('payload_too_large', 'The request body is too large.', [], 413)`; in-bound malformed JSON retains `400 invalid_json`. All failures use no-store/sanitized envelopes and never log body/header secrets.
   - Do not retrofit this limit into S2 create or unrelated routes. `tests/integration/console-orders.test.ts` owns action size boundaries; `tests/integration/order-routes.test.ts` owns refund size/auth-precedence boundaries. Use direct Request streams when an HTTP client refuses an understated Content-Length. Both are existing Phase 3 gate files.
7. Reuse `jsonResponse/jsonError`, `BOOTSTRAP_STORE_ID`, `digestOrderCapability`, reference/capability validation và existing route dispatch. Không gọi catalog snapshot resolver trong any S3 action/refund; operational reads/writes chỉ dùng copied Order aggregate.
8. Mở rộng integration routes: `tests/integration/console-orders.test.ts` sở hữu Unicode/literal search, filter/keyset/empty/detail/action envelopes, redaction và detail-vs-write snapshot overlap; `tests/integration/order-routes.test.ts` sở hữu private read/refund/replay/input/XSS, gồm wrong/malformed capability + invalid body/known key vẫn 404 nhưng valid capability + invalid body trả 400/422; `tests/integration/storefront-cors.test.ts` sở hữu refund preflight allowed/denied; `tests/integration/spa-api-routing.test.ts` thêm `/console/orders/:reference` asset deep link. Privacy assertions quét nested keys/body/log spies và fixture Store thứ hai; không chỉ kiểm tra status code.

Phase 3 chỉ pass khi API direct-call có thể chứng minh server từ chối toàn bộ illegal matrix dù bỏ qua UI, `%/_` là literal, pagination không lặp/mất row với duplicate timestamps, replay authorization xảy ra trước cached result, và response/log không chứa capability, delivery/private-file identity hoặc request data qua private error.

## Refactor
Keep create-only idempotency separate from operational commands. Reuse existing validation, response, projection and UI conventions. Once RED passes, simplify only touched code while preserving every scenario below. Run LSP references before changing exported symbols; migrate every production and test consumer, no compatibility branch.

## Test matrix
| Scenario / acceptance | Layer or behavior | Required observation |
|---|---|---|
| AU01 / AU02 / CO01 / CO02 | Private boundary | Authorize before parse/cache; uniform denial; no secret data |
| ST04 / AU03 | Direct API and CORS | Illegal commands rejected; only configured preflight granted |
| SC02 / US01 / A1 | List and detail | Literal Unicode matching; AND filters; 25 items; stable cursor |
| DI03 / A2 | Read snapshot | Status/history/refund coherent and purchase data unchanged |

## Tests After (GREEN)
AU01/AU02/CO01/CO02: denial body/header/side-effect/log equivalence, nested output redaction, another Store fixture. ST04 bypasses UI. AU03 verifies exact preflight allow/deny. SC02/US01 cover search/filter cursor and detail. Coherent status/history/refund before or after write, never torn.

## Verification and regression gate
Run from repository root, Node >=22 and lockfile dependencies installed. Listed new tests are implementation deliverables, not tests that exist or have passed during planning.

```sh
npx vitest run tests/integration/order-operations.test.ts tests/integration/order-routes.test.ts tests/integration/console-orders.test.ts tests/integration/storefront-cors.test.ts tests/integration/spa-api-routing.test.ts tests/integration/private-order-snapshot.test.ts
```

## Risk assessment and stop conditions
Memory-bounded scanning is not bounded total work. Preserve exact literal Unicode matching; measure sparse/no-match traversal and stop for plan revision if D1 request limits prevent completion. CORS remains browser policy, not authorization. Do not include private text in incident logs.
- Scale evidence: seed 201 static Orders with duplicate timestamps and sparse matches; assert traversal across three chunks and a terminal short/empty chunk without lost matches. Also run a 5,001-candidate no-match fixture with a counted D1 wrapper: total calls must follow scan chunks plus Store existence/read overhead, and results must be complete, never silently truncated.
- Deployment limitation, not a new product cap: D1 documents 50 queries/invocation on Free and 1,000 on Paid. A full no-match scan costs approximately `ceil(N/100)` chunk reads plus terminal/existence overhead; 5,001 candidates exceed Free. Local acceptance does not prove unbounded remote scale. If the intended deployment dataset/query budget cannot satisfy this algorithm, stop before deployment and replan with the user; do not silently change Unicode semantics, cap results, add normalized storage columns, or claim remote support. Source: https://developers.cloudflare.com/d1/platform/limits/.

Stop at this phase if required observations fail. Fix the owning root cause; do not weaken constraints, substitute mock success, or advance across the dependency gate. Local D1 proof is not remote D1 proof.

## Security considerations
Force BOOTSTRAP_STORE_ID; private authorization precedes body parsing and replay. Anonymous Console is an accepted demo risk, never authenticated Owner authorization. Keep capability only in existing fragment/header transport; never expose delivery/file identity, private URLs, request keys, reasons in errors/logs, or digests. Refund is request-only and remains pending after fulfillment.

## Todo
- [x] Write failing 3 behavioral coverage first.
- [x] Implement the complete 3 contract and migrate consumers.
- [x] Refactor touched code without weakening invariants.
- [x] Run the phase gate and record exact observations.

## Success criteria and next gate
Expose paged Console operations and capability-authorized refunds with coherent, redacted server projections. All Test matrix observations and the exact regression gate pass. Next: execution phases 4 and 5, independently.
