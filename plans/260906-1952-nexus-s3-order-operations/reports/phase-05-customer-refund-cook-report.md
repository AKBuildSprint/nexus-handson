# Phase 5 cook report — Customer refund Storefront

Worker: `task_feb06e9cebfa` / `ctx_8fae0c280bc6`
Cook mode: `code` + `--advice`. Coordinator `--auto` close approved. Plan/git untouched.

Host worker model: `xai-oauth/grok-4.6`.

## Brainstorm (reused)

- Outcome: one Customer refund intent survives retries; private reopen shows the durable request.
- Constraints: capability only fragment + `X-Nexus-Order-Capability`; request-only pending; HTTP retryable `status >= 500 || 408 || 429`; generation-gated handlers.
- Non-goals: money movement, Console, Phase 6 typecheck/join, remote, commit.
- Acceptance: IN01/IN02, ER02/ER03, R2, R3, ST03/US02/BL03.

## Scout

Storefront Vite/React. `PrivateOrderPage` hardcoded Pending payment, always rendered payment next step, no refund, unguarded GET. Worker `POST /api/storefront/orders/:reference/refund-requests` already returns `{ order, command }`.

## Kongming runtime (OMP override preserved)

Spawned kit agent `kongming` with no skill-default model remap.

| Checkpoint | Agent | Observed runtime | Effort | Fallback |
|---|---|---|---|---|
| Pre-implement | `KongmingPhase5` | `openai-codex/gpt-5.6-sol` (`model_change`, `resolvedModelIsFallback: false`) | `thinkingLevel: xhigh` | none |
| Post-phase | `KongmingPhase5Done` | `openai-codex/gpt-5.6-sol` (`model_change`, `resolvedModelIsFallback: false`) | `thinkingLevel: xhigh` | none |

Pre-implement verdict: **GO** with identity-gated render (not effect-only reset); success may install `response.order` after semantic edit; late error must not revive old key.

## Changed files

- `storefront/src/storefront-view-types.ts`
- `storefront/src/api-client.ts`
- `storefront/src/storefront-app.tsx`
- `storefront/src/styles.css`
- `tsconfig.json` (`include` + `storefront/src`)
- `tests/browser/storefront-orders-contracts.test.ts`

Report: `plans/260906-1952-nexus-s3-order-operations/reports/phase-05-customer-refund-cook-report.md`

Out of scope untouched: session-1..6-brief.md deletions, `.agentkit/`, `.claude/`, `ORDER_OPERATIONS_PLAN.md`, omp-session HTML.

## RED

```sh
npx vitest run --config vitest.browser.config.ts tests/browser/storefront-orders-contracts.test.ts
```

Result: **1 file failed**. **3 passed / 10 failed** (13 tests). S2 tests still passed. Refund assertions failed on hardcoded `Pending payment`, missing Paid/Fulfilled, missing refund textarea.

Playwright Chromium already present (`npx playwright install chromium` no-op).

## GREEN / smoke / tester

Same command.

| Run | Result |
|---|---|
| Host GREEN after UI | 13 passed / 13 |
| `tester` subagent `Phase5Tester` | 13 passed / 13, 1.06s |
| After unused `_input` | 13 passed / 13 |
| After A→B→A + checkout HTTP matrix | **15 passed / 15**, 1.09s |
| Reviewer recheck | **15 passed / 15**, 1.45s |

Root `npm run typecheck` not run (Phase 6). Reviewer scoped no-emit tsc over Storefront + this test: exit 0.

## Route / capability stale cases (R2)

Covered in `tests/browser/storefront-orders-contracts.test.ts`:

- Delayed A refund success does not replace B; B mints a new key for the same reason (`does not let delayed order A replace B…`)
- Immediate old-view drop on capability change; missing capability does not keep previous Order; delayed GET/error ignored (`clears the previous Order immediately on capability change…`)
- A→B→A: first A GET `$11.11`/`Paid` ignored; B GET ignored; third GET `Fulfilled` wins (`rejects the first A GET after A to B to A navigation`)
- In-flight R1 success after semantic R2 still installs `response.order`; late 503 does not revive Retry refund

`PrivateOrderPage` is keyed by `reference:capability`.

## HTTP-derived retry tests (R3)

Retryable from `Response.status` only (`>=500 \|\| 408 \|\| 429`). Worker JSON has no `status`/`retryable`. Envelope `code`/`fields`/`incidentId`/`apiMessage` retained; user-facing `Error.message` stays generic.

- Refund: lost-response, 503, 408, 429, same key; trim-only keeps key (`keeps one route-bound refund key…`)
- Checkout: 503, 408, 429 Worker envelopes, same key (`retries checkout on Worker 5xx 408 and 429…`)
- Checkout + refund: 4xx malformed JSON / 422 envelope not retryable; new key (`does not treat 4xx…`)

## Review

- Simplifier: HTTP-only retry decode; `getValidRefundReason`.
- code-reviewer `Phase5Review`: **9.5/10**, **GO**, critical `[]`. Follow-ups applied (unused `_input`, A→B→A, checkout HTTP matrix, `apiMessage`). HARD-GATE-NO-SIDE-EFFECTS: PASS.
- Warnings: mocked fetch ≠ Phase 6 Worker/Console proof; root typecheck/build remain Phase 6.
- Suggestion (non-blocking): `routeGeneration` is constant inside a keyed page lifetime; later cleanup may drop redundant generation bookkeeping.

## Not done (coordinator)

Plan checkbox/status, commit, journal (`ak config prefs resolve` failed; finalize owned by coordinator), Phase 6 join, remote D1.
