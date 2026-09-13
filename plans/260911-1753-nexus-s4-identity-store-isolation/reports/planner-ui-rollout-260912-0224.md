---
type: planner-report
date: 2026-09-12
title: "Phase 07/08 UI and rollout deep-TDD rewrite"
status: done-with-concerns
scope: "plans/260911-1753-nexus-s4-identity-store-isolation"
---

# Planner Report: UI and Rollout Rewrite

## Summary

Rewrote only:

- `phase-07-role-aware-experience.md`
- `phase-08-migration-rehearsal-and-rollout.md`

Added this report:

- `reports/planner-ui-rollout-260912-0224.md`

No application code, tests, evergreen docs, config, migrations, deployment, or plan index files were changed by this subtask.

## Evidence Used

- Root rules require Products/Orders-only Console destinations, root Wrangler ownership, Node 22, no applied migration rewrites, and anonymous-demo wording until S4 is real: `AGENTS.md:1`, `AGENTS.md:11`, `AGENTS.md:23`.
- `contracts.md` supplied the canonical proposed endpoints, status/error/CSRF behavior, atomicity, migration ownership, TDD rules, performance-measurement rule, and Node24-host versus Node22-verification distinction.
- `acceptance.md` supplied the complete 49-row scenario evidence map with NOT RUN status, so Phase 8 now links to it instead of duplicating a ledger.
- README current state still says Console is anonymous bootstrap and real identity is S4: `README.md:33`, `README.md:193`.
- README remote sequence requires exact resources/origins, writer quiescence, and no guessed workers.dev hostnames: `README.md:104`, `README.md:122`, `README.md:137`.
- Console private state is centralized in `ProductionConsoleApp`: route types at `apps/console/src/production-console-app.tsx:45`, state at `apps/console/src/production-console-app.tsx:234`, Order list fetch at `apps/console/src/production-console-app.tsx:326`, shell render at `apps/console/src/production-console-app.tsx:655`.
- Console shell hardcodes anonymous identity: `apps/console/src/layout/console-shell.tsx:56`, `apps/console/src/layout/console-shell.tsx:86`.
- Console API client has no auth/session classification today: `apps/console/src/api-client.ts:84`, Product callers at `apps/console/src/api-client.ts:101`, Order callers at `apps/console/src/api-client.ts:131`, mutation callers at `apps/console/src/api-client.ts:214`.
- Order UI currently exposes S3 actions and pending-only Refund state: `apps/console/src/orders/order-ui-types.ts:1`, `apps/console/src/orders/order-detail-screen.tsx:27`, `apps/console/src/orders/order-detail-screen.tsx:778`.
- Storefront parses capability from URL fragment and uses pending-only Refund type/copy: `apps/storefront/src/storefront-app.tsx:34`, `apps/storefront/src/storefront-app.tsx:461`, `apps/storefront/src/storefront-view-types.ts:64`.
- Worker routes all Console endpoints without auth today: `apps/worker/src/index.ts:22`, `apps/worker/src/console-order-routes.ts:38`, `apps/worker/src/console-product-routes.ts:71`, `apps/worker/src/console-file-routes.ts:25`, `apps/worker/src/console-import-routes.ts:31`.
- Existing remote smoke is catalog-focused and credentialless: `tests/integration/remote-contract-smoke.ts:31`, `tests/integration/remote-contract-smoke.ts:80`, `tests/integration/remote-contract-smoke.ts:313`, `tests/integration/remote-contract-smoke.ts:480`.
- Existing private fixture helper is path-pinned to S1 evidence: `scripts/verification/verification-fixtures.ts:11`, `scripts/verification/verification-fixtures.ts:129`.

## Test Counts

Lexical counts from current `tests/**/*.test.ts` and `tests/**/*.spec.ts`:

| Layer | Files | `describe` calls | `it/test` calls |
|---|---:|---:|---:|
| `tests/unit` | 10 | 10 | 31 |
| `tests/integration` | 19 | 20 | 106 |
| `tests/browser` | 4 | 4 | 48 |
| `tests/e2e` | 5 | 0 | 27 |
| Total | 38 | 34 | 212 |

## Changes Made

### Phase 7

- Added current UI/API/type evidence with `file:line`.
- Enumerated existing browser/E2E auth-adjacent consumers and lexical counts.
- Replaced broad implementation prose with explicit data flow, interface dependency checklist, exact file inventory, and Red -> Green -> Refactor gates.
- Aligned endpoints to `contracts.md`: `GET /api/console/session`, `GET /api/console/staff`, assignment endpoint, refund approve/reject endpoints.
- Narrowed commands to exact Vitest browser and Playwright files; avoided broad integration selectors.
- Added stale session, lost response, retry scope, Back/popstate, and identity-generation requirements.
- Distinguished UI affordances from enforcement; Phase 7 is not server-authorization proof.

### Phase 8

- Added current rollout/provisioning/remote-smoke evidence with `file:line`.
- Marked existing `verification:remote:smoke` as S1/catalog evidence only.
- Linked `acceptance.md` as the scenario evidence owner instead of creating a duplicate ledger.
- Added S4-specific private fixture/provisioning design; no public provisioning endpoint.
- Made Better Auth runtime proof a prerequisite owned by Phase 1; Phase 8 must fail closed if absent.
- Reflected Phase 2/0009 ownership of assignment history/commands plus payment FK closure before Phase 5.
- Added exact local targeted commands and separated full broad gates.
- Added remote runbook prerequisites, abort rules, rollback strategy, secret-safe evidence rules, and non-public operator transport constraints.
- Prevented fabricated remote/runtime claims, fake remote D1 binding assumptions, and anonymous-writer rollback after S4 schema mutation.

## Concerns

- `plan.md` and other phase files were not edited by this subtask. Any remaining inconsistencies there are outside this assigned ownership and should be handled by the main/index owner or the phase owners.
- Phases 1-6 may still need their own deep/TDD corrections from other agents before the plan is coherent end-to-end.
- No plan validation or tests were run; this was documentation-only planning work.

## Unresolved Questions

- Membership cardinality/store-picker remains pending per `contracts.md`; Phase 7/8 now avoid treating separate accounts/no picker as a confirmed user decision.
