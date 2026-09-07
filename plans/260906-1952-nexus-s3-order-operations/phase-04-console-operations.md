---
phase: 4
title: "Build Console order operations"
status: pending
priority: P1
effort: ""
dependencies: [3]
---

# Phase 4A: Build Console order operations

## Goal
Provide URL-preserved search/detail and manual actions without stale reads rolling back current server state.

## Context and ownership
- [Input strategy](../../ORDER_OPERATIONS_PLAN.md), Phase 4A.
- [Accepted business contract](../reports/brainstorm-260906-1738-nexus-s3-order-operations.md).
- [Scenario authority](../reports/scenario-260907-0155-nexus-s3-order-operations.md).
- Execution phase ID: 4; source label: 4A. Dependencies use execution IDs. Status is pending; no S3 implementation proof is claimed.
- May run alongside execution phase 5 after phase 3 passes.

## Files to Create / Modify
All paths below are relative to the repository root. No production files are changed during planning.
- Create: `src/console/orders/order-detail-screen.tsx`
- Modify: `src/console/orders/order-ui-types.ts`
- Modify: `src/console/api-client.ts`
- Modify: `src/console/production-console-app.tsx`
- Modify: `src/console/orders/orders-screen.tsx`
- Modify: `src/console/styles/console-layout.css`
- Modify: `tests/browser/console-orders-contracts.test.ts`
- Delete: none. No shims, compatibility overloads, or second design system.

## Tests Before (RED)
Write browser contracts before UI: URL/back restores criteria and cursor; real statuses/actions; delayed pending GET after Paid ignored; retry preserves command key; state conflict refreshes; reason is inert text. Fulfill confirmation cancel/Escape sends no POST and returns focus; same assertion at 375px.
**[Red-team R5]** Reach page 3, open detail, remount/reload the app, go Back and then Previous: recover page 2 with unchanged criteria and no duplicate/lost rows on the static fixture. Also cover browser Back/Forward between list pages, filter-reset history entries, and a direct cursor URL without saved ancestry.

Record the failing command and the behavioral assertion that fails before changing source. An import failure may establish the initial missing surface, but replace it with observable-contract assertions before GREEN. Existing S2 regressions remain in the gate.

## Requirements, architecture and implementation steps
1. Mở rộng `src/console/orders/order-ui-types.ts` theo exact Phase 3 response; `src/console/api-client.ts` có `fetchOrders(criteria, signal)`, `fetchOrderDetail(reference, signal)`, `executeOrderAction(reference, action, acknowledgedRefundRequestId, idempotencyKey)`. `ConsoleApiError` giữ status/code/fields/incidentId; network/5xx là retryable, 409 state/ack luôn refetch trước intent mới.
2. Đổi `ProductionConsoleApp` route thành `{kind:'orders-list'; criteria}` và `{kind:'order-detail'; reference}`. List criteria/cursor được parse/serialize ở URL `/console/orders?...`; row link push `/console/orders/:reference`; browser Back phục hồi chính URL/list state trước đó. Direct detail deep link phải hoạt động. Không copy ProductList behavior remount về query rỗng.
3. Nâng `OrdersScreen` thành server-paged list: search reference/name/email; status tabs theo keyboard pattern đang có ở `ProductListScreen`; pending-refund filter; real status tag; clear filters; Previous/Next dùng cursor ancestry do parent khôi phục từ history entry **[Red-team R5]**. `orders=[] && !hasAnyOrders` hiển thị “No Orders have been placed.”; `orders=[] && hasAnyOrders` hiển thị no-match + clear filters; fetch error không biến thành empty.
   - URL criteria remain authoritative for each fetch. Store only `{ ordersList: { criteria, cursorStack } }` under a namespaced key in `history.state`, preserving unrelated history fields; never store Orders, Customer data, reasons, capabilities or command keys there. `criteria` includes normalized q/status/refund and current cursor. The stack contains visited page-start cursors through the current page, initially `[null]`; its last element must equal the URL cursor.
   - Save an entry snapshot on list initialization, pagination and before opening detail. On initial render and every popstate, restore it only when its shape and criteria/current cursor match the URL. Next pushes the returned cursor; Previous drops the current stack entry and fetches its predecessor. Browser Back/Forward restores that entry's own stack rather than reusing the most recent parent state.
   - On normalized q/status/refund changes or Clear filters, reset to `[null]`, remove the cursor URL parameter and fetch page one (SC03). Preserve the prior list history entry when navigating to detail, so reload followed by Back restores both criteria and ancestry.
   - A direct cursor URL with missing/invalid/mismatched history state fetches the URL page with stack `[currentCursor]`, disables Previous when no predecessor is known, and offers “First page” to clear the cursor. Never infer a reverse cursor or silently fetch page one instead of the requested page. Include `hasPendingRefund` in list UI types, not the full reason/request.
4. Tạo `src/console/orders/order-detail-screen.tsx` vì repo chưa có equivalent: render snapshot/money, Customer snapshot, current status, chronological history, Refund Request plain text/time/“Received — awaiting response”, và chỉ server-provided `allowedActions`. Copy UI giữ đúng semantics: `Mark paid` là manual confirmation, Fulfilled không hứa delivery, Refund Request không phải refunded.
5. Mỗi action tạo `crypto.randomUUID()` một lần và giữ cùng key qua network/5xx retry; pending state disable duplicate click nhưng server vẫn là authority. Sau success dùng returned current detail rồi refetch; sau 409 discard attempt key, increment request generation, refetch, không tự đổi Cancel thành action khác.
6. Dùng monotonic detail request generation cùng AbortController: mutation/refetch tăng generation; một GET pending cũ trả sau Paid không được overwrite `paid` hoặc bật lại Cancel. List requests cũng abort/sequence theo criteria.
7. Fulfill khi detail có request mở native `<dialog>` theo existing `showModal`/`onCancel`/focus-restore pattern, đọc reason và current request ID, có “Cancel” và “Confirm fulfillment”. Ở 375px và keyboard, reason/cả hai controls phải reachable; Escape/cancel đóng dialog và gửi zero mutation.
8. Bổ sung status/refund/detail/dialog styles trong existing `src/console/styles/console-layout.css`; reuse token, table/card, notice, `.status-tag`, 719px breakpoint, không tạo design system thứ hai.

## Refactor
Keep create-only idempotency separate from operational commands. Reuse existing validation, response, projection and UI conventions. Once RED passes, simplify only touched code while preserving every scenario below. Run LSP references before changing exported symbols; migrate every production and test consumer, no compatibility branch.

## Test matrix
| Scenario / acceptance | Layer or behavior | Required observation |
|---|---|---|
| US01 / A1 | Navigation | Detail deep link, Back criteria and paging restored |
| IT02 / ST05 / TM02 | Stale and retry | Old GET ignored; current order wins over historical resultStatus |
| IN02 / EN01 / BL02 | Safe confirmation | Inert reason; keyboard/mobile cancel zero writes; confirm exact ID |

## Tests After (GREEN)
US01/ST05/IT02: preserved URL and generation sequencing. IN02: hostile HTML displayed as text. EN01/BL02: exact refund ID acknowledgement, all dialog controls reachable by keyboard and at 375px. Loading/error/no-match/empty differ; no success inferred from failed fetch.

## Verification and regression gate
Run from repository root, Node >=22 and lockfile dependencies installed. Listed new tests are implementation deliverables, not tests that exist or have passed during planning.

**[Red-team R6]** Before browser verification, install the Chromium revision selected by the repository lockfile:

```sh
npx playwright install chromium
```

Run once per runner/browser-cache setup after dependency installation; Phase 5 uses the same prerequisite and Phase 6 rechecks it on a fresh runner. On Linux images missing browser system libraries, use `npx playwright install --with-deps chromium` during runner setup with the required OS privileges. A missing binary/library is a setup failure, not S3 evidence.

**[Red-team R4]** In a shared checkout, only implementation overlaps Phase 5; wait for both UI write sets to settle before either scoped browser gate. Root typecheck remains exclusively at the Phase 6 join, not in a sibling's independent gate.

```sh
npx vitest run --config vitest.browser.config.ts tests/browser/console-orders-contracts.test.ts
```

## Risk assessment and stop conditions
Only this phase owns Console files and its browser test while Phase 4B runs. Parent route state, not list child alone, owns navigation and stale reads. Do not let a retry use edited acknowledgement payload with an old key.

Stop at this phase if required observations fail. Fix the owning root cause; do not weaken constraints, substitute mock success, or advance across the dependency gate. Local D1 proof is not remote D1 proof.

## Security considerations
Force BOOTSTRAP_STORE_ID; private authorization precedes body parsing and replay. Anonymous Console is an accepted demo risk, never authenticated Owner authorization. Keep capability only in existing fragment/header transport; never expose delivery/file identity, private URLs, request keys, reasons in errors/logs, or digests. Refund is request-only and remains pending after fulfillment.

## Todo
- [x] Write failing 4A behavioral coverage first.
- [x] Implement the complete 4A contract and migrate consumers.
- [x] Refactor touched code without weakening invariants.
- [x] Run the phase gate and record exact observations.

## Success criteria and next gate
Provide URL-preserved search/detail and manual actions without stale reads rolling back current server state. All Test matrix observations and the exact regression gate pass. Next: execution phase 6 after both UI phases pass.
