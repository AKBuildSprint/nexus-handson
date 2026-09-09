---
title: "S3 brief reconciliation: Orders, manual payments and shared refunds"
description: "Align the existing worktree with the S3 PRD while preserving S2 Orders and the data contracts required by S4–S6."
status: completed
priority: P1
effort: ""
branch: thieung/Live-Build-Session-3
tags: [feature, backend, frontend, database, api]
blockedBy: []
blocks: []
created: 2026-09-09
---

# S3 brief reconciliation

## Outcome and authority

Deliver the nine S3 slice requirements and six acceptance criteria against actual S2 data. [Contracts](./contracts.md) define decisions; [acceptance](./acceptance.md) maps every requirement; [impact](./impact.md) enumerates affected callers. Primary source: `/Users/thieunv/Downloads/session-3-brief.md`, contextualized by briefs S1/S2/S4/S5/S6 from the same directory.

This plan supersedes Complete-only execution scope in `../260908-1505-order-operations-refund-request/plan.md`, `../reports/brainstorm-260908-2108-order-operations-refund-request.md` and `../../ORDER_OPERATIONS_PLAN.md`. Prior reports remain historical evidence, not proof of this contract.

Planning mode: **hard**, HOLD SCOPE. Existing domain/persistence/UI are known; risk is the populated migration, payment semantics and two-client cutover. Six dependency-separated phases; no needless rewrite or new workflow framework.

## Confirmed decisions

- User: old completed -> **paid**, never auto-Fulfilled; keep historical missing payment metadata honest.
- User: keep **anonymous bootstrap demo**, server-assigned bootstrap actor, no real Owner authorization claim. S4 adds identity/evaluator. This explicit exception remains visible in final acceptance.
- Include two-Product Orders for S2 continuity; preserve existing Variants. No Catalog redesign/deletion.
- Implement pending->paid->fulfilled and pending->canceled; real manual ledger, shared Customer/Console refund, filtered summary and payment-reference search.
- Keep S4 decisions/auth, S5 automation/access/reversal and S6 receipt/MCP out of scope; preserve required extension/data contracts instead.

## Phases

| # | Phase | Status | Depends on |
|---|---|---|---|
| 1 | [Populated schema and audit migration](./phase-01-start.md) | Pending | — |
| 2 | [Order aggregate and private continuity](./phase-02-order-aggregate-and-private-continuity.md) | Pending | 1 |
| 3 | [Payment transitions and shared refunds](./phase-03-payment-transitions-and-shared-refunds.md) | Pending | 2 |
| 4 | [Filtered inbox and API cutover](./phase-04-filtered-inbox-and-api-cutover.md) | Pending | 3 |
| 5 | [Console and Storefront journeys](./phase-05-console-and-storefront-journeys.md) | Pending | 4 |
| 6 | [Acceptance and deployed continuity](./phase-06-acceptance-and-deployed-continuity.md) | Pending | 5 |

Architecture: Storefront create/private + Console inbox/actions -> Worker-scoped context/capability guards -> shared Order reads/commands -> D1 Orders/items/payments/refunds/history/keys. Public/private projections never expose delivery configuration. R2 remains private and unchanged.
Execution dependency: `P1 -> P2 -> P3 -> P4 -> P5(Console || Storefront) -> P6`. No independent deployment until both clients have cut over. Phase5 alone has disjoint parallel ownership; all earlier shared Order files serialize.

## Execution checklist

- [ ] Migrate populated data without losing historical evidence
- [ ] Support multi-product Orders and stable private access
- [ ] Record manual Payment then Fulfill with durable history
- [ ] Serve accurate summary search pagination and shared refunds
- [ ] Complete both user journeys with robust retry states
- [ ] Verify actual S2 continuity and repeat behavior after redeploy

## Readiness and risks

**Ready for implementation (`ready to cook`)**, not deployed or implemented. All phase/acceptance checkboxes remain pending. Remote credentials/origins, an authorized pre-existing S2 test Order and demonstrable prior-writer quiescence are explicit rollout prerequisites; no blanket “done” from local mocked browser tests.

Deployment is a breaking API/body/state cutover: contract2 header rejects stale clients, checkpoint follows proven quiescence, migration failure is per-file. If drain/barrier cannot be proven, stop before remote schema mutation. No fake legacy payments, complete alias, data reset or unsafe old Worker rollback. See contracts C7 and phase6.

## Red Team Review

Four reviewers; **6 deduplicated findings accepted (2 High, 4 Medium), all plan corrections applied**. Evidence, disposition and deployment qualification in [review gates](./review-gates.md).

## Validation Log

Two user decisions confirmed and propagated. CLI format valid; source paths/commands/dependency and whole-plan checks recorded in [review gates](./review-gates.md). Remaining checks are implementation/deployment acceptance, not unfinished plan drafting.

## Handoff

Execute with `/ak:cook /Users/thieunv/orca/workspaces/nexus-practice/Live-Build-Session-3/plans/260908-1845-s3-brief-reconciliation/plan.md`. No automatic implementation/deploy authorized by this plan request.

<!-- slug: s3-brief-reconciliation -->
