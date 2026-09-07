---
phase: 5
title: "Build private Customer refund flow"
status: pending
priority: P1
effort: ""
dependencies: [3]
---

# Phase 4B: Build private Customer refund flow

## Goal
Persist one Customer refund intent through retries and render the durable request on every private-page reopen.

## Context and ownership
- [Input strategy](../../ORDER_OPERATIONS_PLAN.md), Phase 4B.
- [Accepted business contract](../reports/brainstorm-260906-1738-nexus-s3-order-operations.md).
- [Scenario authority](../reports/scenario-260907-0155-nexus-s3-order-operations.md).
- Execution phase ID: 5; source label: 4B. Dependencies use execution IDs. Status is pending; no S3 implementation proof is claimed.
- May run alongside execution phase 4 after phase 3 passes.

## Files to Create / Modify
All paths below are relative to the repository root. No production files are changed during planning.

- Modify: `storefront/src/storefront-view-types.ts`
- Modify: `storefront/src/api-client.ts`
- Modify: `storefront/src/storefront-app.tsx`
- Modify: `storefront/src/styles.css`
- Modify: `tsconfig.json`
- Modify: `tests/browser/storefront-orders-contracts.test.ts`
- Delete: none. No shims, compatibility overloads, or second design system.

## Tests Before (RED)
Write status/payment/refund eligibility matrix and reason boundary browser assertions before UI. Test trim, non-string API cases, U+0000, 1/1000/1001 Unicode code points (including astral characters), no NFKC rewrite, inert HTML. Simulate lost response after actual server commit in final integration, and contract-test unchanged retry key locally.
**[Red-team R2, R3]** Hold A's refund response, change private route to B through the existing same-document navigation, load B, and release A: B keeps its own data and uses a fresh command key even for the same reason. Repeat with a capability change and delayed error/GET; no stale handler may change the active view or retry state. Exercise the actual Worker-shaped error envelope without JSON `status`/`retryable`, plus network and 5xx/408/429 errors, for checkout and refund retry preservation.

Record the failing command and the behavioral assertion that fails before changing source. An import failure may establish the initial missing surface, but replace it with observable-contract assertions before GREEN. Existing S2 regressions remain in the gate.

## Requirements, architecture and implementation steps
Phase 4B chỉ phụ thuộc Phase 3 và có thể chạy song song với 4A: owns `storefront/**`, Storefront browser test, and the root `tsconfig.json` include change; none overlap Console ownership.

1. Mở rộng `storefront/src/storefront-view-types.ts` với bốn status, `refundRequest`, nullable `paymentNextStep`, và refund command response. **[Red-team R3]** `StorefrontApiError` đọc `code`, `message`, `fields`, `incidentId` từ JSON `error`; lấy `status` từ `Response.status`, không từ body. Tính `retryable` tại client, giữ chính sách hiện có `status >= 500 || status === 408 || status === 429`; lỗi mạng giữ ý định retry. JSON lỗi thiếu hoặc không parse được vẫn phân loại theo HTTP status, không biến 4xx thành retryable hoặc lỗi thành thành công. Không đòi Worker gửi `status`/`retryable` trong JSON. Giữ hành vi này cho checkout và refund; thêm `submitRefundRequest(reference, capability, reason, idempotencyKey)` tới exact Phase 3 path.
2. Refactor `PrivateOrderPage` trong `storefront/src/storefront-app.tsx`: render real status; chỉ render Payment next step khi non-null; render Refund form chỉ khi status `paid|fulfilled` và request null; `pending_payment|cancelled` không có form. Khi request tồn tại, render server reason/time/status “Received — awaiting response” và không render form thứ hai.
3. Client validation dùng cùng rule observable như server: JavaScript trim, reject U+0000, đếm 1–1000 Unicode code points bằng `for...of` và dừng tại 1001, không tạo mảng ký tự **[Red-team R1]**; reason dùng `<textarea>`, React text rendering only, không `dangerouslySetInnerHTML`. Invalid input không tạo/giữ submit attempt.
   - Treat ill-formed UTF-16 (unpaired surrogates from escaped JSON or programmatic input) as invalid Unicode text, with the same server/client 422 `/reason` policy. Reject rather than silently replacing text before digest/storage. Keep valid astral characters, combining marks and ZWJ sequences unchanged; code-point count is not grapheme count.
4. **[Red-team R2]** Keep `{ reference, routeGeneration, trimmedReason, key }` in a ref through network/5xx/lost-response for the same private route. Within that route, a semantic reason edit or invalid reason clears the attempt; trim-only edits retain it. A reference **or capability** change increments the private-page route generation, clears Order/form/error/attempt state and loads the new authorized Order; an invalid/missing capability must not leave the previous Order visible.
   - Capture reference and generation for every private GET and refund submit. Success, error and finally handlers may update Order, form, pending state or retry identity only while that captured route is still active. Abort stale GETs as cleanup, but use generation checks too; a mutation may already have committed and navigation must not be treated as server rollback. An A→B→A navigation creates a fresh generation, so the first A response is stale too.
   - Refund success decodes `{ order, command }` and, only for the active route, replaces current Order with `response.order`, not the wrapper. Create keeps its existing bare Order response. Reload/new browser luôn GET server state. Capability vẫn chỉ đọc từ fragment và chỉ gửi qua `X-Nexus-Order-Capability`; chỉ giữ trong route memory hiện có, không copy vào history.state, key, path/query/DOM/error/log.
5. Thêm Storefront styles trong existing `storefront/src/styles.css`; giữ loading/error/retry and 375px no-overflow patterns. Cập nhật root `tsconfig.json` include `storefront/src` để `npm run typecheck` thực sự kiểm tra Customer app; không tạo typecheck pass giả chỉ từ Vite transpilation.

## Refactor
Keep create-only idempotency separate from operational commands. Reuse existing validation, response, projection and UI conventions. Once RED passes, simplify only touched code while preserving every scenario below. Run LSP references before changing exported symbols; migrate every production and test consumer, no compatibility branch.

## Test matrix
| Scenario / acceptance | Layer or behavior | Required observation |
|---|---|---|
| IN01 / IN02 | Input and rendering | Code-point limits match server; reason remains inert text |
| ER02 / ER03 / CO01 | Retry identity and route lifetime | Same route/normalized intent keeps key; route change gets a new key; stale success/error/GET cannot replace the active Order or retry state |
| ST03 / BL03 / US02 | Durability | Received request persists; no duplicate form or refund-money claim |

## Tests After (GREEN)
IN01/IN02: validation and inert text, including isolated-surrogate rejection. ER02/ER03: retryable failures preserve exact route-bound normalized intent/key; a semantic reason edit clears it, a trim-only edit keeps it. R2: delayed A responses never replace B or revive old retry state; reference/capability changes reset the view and attempt. R3: checkout/refund retain HTTP-derived retryability with the actual JSON envelope. ST03/US02/BL03: pending record replaces form, survives reload, does not change money or delivery. Root tsconfig includes storefront/src; the shared typecheck result is owned by Phase 6 after the UI join.

## Verification and regression gate
Run from repository root, Node >=22 and lockfile dependencies installed. Listed new tests are implementation deliverables, not tests that exist or have passed during planning.

**[Red-team R6]** Require the same Chromium setup as Phase 4: after installing lockfile dependencies, run `npx playwright install chromium` once per runner/browser cache before browser verification. On a Linux runner missing system libraries, use `npx playwright install --with-deps chromium` during setup. This phase may start without Phase 4, so it must not assume that sibling installed the browser.

```sh
npx vitest run --config vitest.browser.config.ts tests/browser/storefront-orders-contracts.test.ts
```

**[Red-team R4]** Root `npm run typecheck` runs only in Phase 6 after both UI write sets are complete; it is not an independent Phase 5 gate. Keep the tsconfig include change here. In a shared checkout, parallelize implementation only: neither UI worker runs validation while its sibling still edits. Once both write sets settle, run each scoped browser gate, then Phase 6's shared checks. No extra TypeScript config or serialized product dependency is introduced.

## Risk assessment and stop conditions
Only this phase owns Storefront files, root tsconfig and its browser test. Never persist or render raw capability outside existing fragment/header boundary. API projections, not localStorage or success labels, prove durable request state.

Stop at this phase if required observations fail. Fix the owning root cause; do not weaken constraints, substitute mock success, or advance across the dependency gate. Local D1 proof is not remote D1 proof.

## Security considerations
Force BOOTSTRAP_STORE_ID; private authorization precedes body parsing and replay. Anonymous Console is an accepted demo risk, never authenticated Owner authorization. Keep capability only in existing fragment/header transport; never expose delivery/file identity, private URLs, request keys, reasons in errors/logs, or digests. Refund is request-only and remains pending after fulfillment.

## Todo
- [x] Write failing 4B behavioral coverage first.
- [x] Implement the complete 4B contract and migrate consumers.
- [x] Refactor touched code without weakening invariants.
- [x] Run the phase gate and record exact observations.

## Success criteria and next gate
Persist one Customer refund intent through retries and render the durable request on every private-page reopen. All Test matrix observations and the exact regression gate pass. Next: execution phase 6 after both UI phases pass.
