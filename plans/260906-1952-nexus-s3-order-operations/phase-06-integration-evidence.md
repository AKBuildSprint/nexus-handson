---
phase: 6
title: "Close integrated Critical and High evidence"
status: pending
priority: P1
effort: ""
dependencies: [4, 5]
---

# Phase 5: Close integrated Critical and High evidence

## Goal
Prove the complete S3 outcome on actual two-origin routes while retaining S2 regressions.

## Context and ownership
- [Input strategy](../../ORDER_OPERATIONS_PLAN.md), Phase 5.
- [Accepted business contract](../reports/brainstorm-260906-1738-nexus-s3-order-operations.md).
- [Scenario authority](../reports/scenario-260907-0155-nexus-s3-order-operations.md).
- Execution phase ID: 6; source label: 5. Dependencies use execution IDs. Status is pending; no S3 implementation proof is claimed.
- Sequential gate; no overlapping writers on shared files.

## Files to Create / Modify
All paths below are relative to the repository root. No production files are changed during planning.

- Modify: `tests/e2e/console-orders.spec.ts`
- Modify: `tests/e2e/storefront-orders.spec.ts`
- Modify: `tests/browser/console-orders-contracts.test.ts`
- Modify: `tests/browser/storefront-orders-contracts.test.ts`
- Modify: `README.md`
- Modify: `plans/260906-1952-nexus-s3-order-operations/reports/acceptance-matrix.md` (durable sanitized execution evidence).
- Delete: none. No shims, compatibility overloads, or second design system.

## Tests Before (RED)
Before final integration edits, add failing missing two-origin journeys, not forty duplicated E2E tests. Pin unique per-run fixtures, fresh target-Order reads, lost-response after commit, and private-log checks. Earlier phases already own their RED/GREEN cycles; this phase must not become the first test pass.

Record the failing command and the behavioral assertion that fails before changing source. An import failure may establish the initial missing surface, but replace it with observable-contract assertions before GREEN. Existing S2 regressions remain in the gate.

## Requirements, architecture and implementation steps
1. Sau 4A+4B, cập nhật browser contracts thay vì tạo 40 E2E tests:
   - Console: list URL/back preservation, empty/no-match, current statuses/actions, pending/error/conflict, delayed old GET ignored, mobile/keyboard fulfill dialog cancel/confirm.
   - Storefront: status/payment guidance matrix, reason boundaries `null`, whitespace, 1/1000/1001 Unicode code points, retry key reuse, persisted request view, HTML/script reason rendered as inert text.
   - **[Red-team R2, R3, R5]** Retain the new scoped browser proofs for private route-bound attempts/stale responses, HTTP-derived error retryability, and history-backed pagination. Add the page-3 → detail → actual reload → Back → Previous journey to `tests/e2e/console-orders.spec.ts`; fixture a static multi-page list and observe page 2 under the same criteria. These extend existing scenario evidence, not new product features.
2. Mở rộng two-origin Playwright journeys trên actual Worker/Console `5173` và Storefront `5174`:
   - ST01: search → detail → Paid → Fulfilled; Customer refresh sees both transitions and no payment guidance after Paid;
   - ST02: Cancel; private link remains readable and exposes no Refund form;
   - ST03+US02: Customer submits refund; Console sees same ID/reason/time; a new browser context opens complete private link and sees the same request;
   - BL02+EN01: at 375px and keyboard, unconfirmed Fulfill is blocked, exact request is confirmed, Order becomes fulfilled, request remains pending;
   - ST05+IT02: stale tab Cancel conflicts and refreshes; deliberately delayed pending GET cannot roll UI back.
3. Cross-surface assertions use fresh API/DB reads, count exact history action/request IDs for the target Order, and compare pre/post snapshot/money fields. Never infer success from mocked response, row-count growth across the whole DB, or an S2 test already green.
4. Keep S2 regressions: create server money, one-line Order, capability binding, private link, create retry, catalog/Customer/file snapshot retention, CORS allow/deny, Console projection redaction. Existing S1 evidence ledger paths remain untouched; they are not reused as S3 proof.
5. Local implementation acceptance ends with focused Workerd, browser, two-origin Playwright, typecheck and both builds. Remote deployment was not requested in this implementation strategy; do not claim remote migration/deployment/pass from local output.
   - **[Red-team R4]** This is the shared verification join. Both UI write sets must be complete before any shared-checkout validation. Root typecheck is owned here, not by Phase 5; it must include `storefront/src` and the completed Console cutover. Run scoped UI gates after writers settle, then the integrated commands below; no validation against sibling edits in flight.
6. Record each scenario in this plan's `reports/acceptance-matrix.md`: replace NOT RUN only after storing command, fixture/input, exact observed outcome and sanitized evidence path. This file is an execution evidence output owned exclusively by this final phase; never reuse S1 ledgers. Carry the Phase 1 isolated local Wrangler migration/late-failure proof into A13 acceptance, not only Vitest output.
7. After successful runtime proof, update `README.md` explicitly: Console Orders are no longer read-only. Anonymous callers can view detail Customer/refund reason and perform manual status mutations in the bootstrap Store. Keep the existing warning that the demo is not authenticated, provider-confirmed payment or delivery; document private refund capability, pending-only semantics and S3 local checks.

## Refactor
Keep create-only idempotency separate from operational commands. Reuse existing validation, response, projection and UI conventions. Once RED passes, simplify only touched code while preserving every scenario below. Run LSP references before changing exported symbols; migrate every production and test consumer, no compatibility branch.

## Test matrix
| Scenario / acceptance | Layer or behavior | Required observation |
|---|---|---|
| 9 Critical | Blocking acceptance | All exact observations recorded before High acceptance |
| 25 High | Complete required coverage | All IDs have evidence owner and actual observed result |
| A1–A13 / IT01 / IT03 | End-to-end and regressions | Both builds/typecheck; S2 create/private and S3 journeys pass |

## Tests After (GREEN)
Run all exact commands below. P0 nine Critical targets first; P1/P2 High domain/API next; P3 cross-surface after. ST01, ST02, ST03+US02, BL02+EN01 and ST05+IT02 use actual routes, both origins and fresh contexts. Record all 34 Critical/High rows with command, input, observation and sanitized evidence, never S2 pass substitution.

## Verification and regression gate
Run from repository root, Node >=22 and lockfile dependencies installed. Listed new tests are implementation deliverables, not tests that exist or have passed during planning.

**[Red-team R6]** Fresh runner prerequisite: install the lockfile-selected Chromium with `npx playwright install chromium` before browser/E2E commands. Reuse the Phase 4/5 installation only on the same runner/cache; a package install alone is not proof of a browser binary. On Linux images lacking system libraries, runner setup uses `npx playwright install --with-deps chromium` with the required privileges. This setup command is not a test pass.

```sh
npx vitest run tests/integration/s3-order-migration.test.ts tests/integration/migration-constraints.test.ts tests/integration/orders-persistence.test.ts
npx vitest run tests/integration/order-operations.test.ts tests/integration/order-routes.test.ts tests/integration/console-orders.test.ts tests/integration/storefront-cors.test.ts tests/integration/spa-api-routing.test.ts tests/integration/private-order-snapshot.test.ts
npx vitest run --config vitest.browser.config.ts tests/browser/console-orders-contracts.test.ts tests/browser/storefront-orders-contracts.test.ts
CI=1 npx playwright test tests/e2e/console-orders.spec.ts tests/e2e/storefront-orders.spec.ts
npm run typecheck
npm run build:console
VITE_STOREFRONT_API_BASE_URL=http://127.0.0.1:5173 npm run build:storefront
```

Also require the [Phase 1 isolated Wrangler migration smoke](./phase-01-start.md#verification-and-regression-gate) observation record. If missing, re-run with fresh temporary config/state before closing A13.

## Risk assessment and stop conditions
CI=1 prevents reusing another checkout. Occupied ports fail closed. Real capability traces/screenshots are sensitive; no publishing. No remote deployment/migration claim. After proof, update existing README S3 behavior and remove only throwaway artifacts created for this work.

Stop at this phase if required observations fail. Fix the owning root cause; do not weaken constraints, substitute mock success, or advance across the dependency gate. Local D1 proof is not remote D1 proof.

## Security considerations
Force BOOTSTRAP_STORE_ID; private authorization precedes body parsing and replay. Anonymous Console is an accepted demo risk, never authenticated Owner authorization. Keep capability only in existing fragment/header transport; never expose delivery/file identity, private URLs, request keys, reasons in errors/logs, or digests. Refund is request-only and remains pending after fulfillment.

## Todo
- [x] Write failing 5 behavioral coverage first.
- [x] Implement the complete 5 contract and migrate consumers.
- [x] Refactor touched code without weakening invariants.
- [x] Run the phase gate and record exact observations.

## Success criteria and next gate
Prove the complete S3 outcome on actual two-origin routes while retaining S2 regressions. All Test matrix observations and the exact regression gate pass. All 34 Critical/High scenarios require actual evidence before closing S3. No deploy, commit, or publish is authorized by this plan.
