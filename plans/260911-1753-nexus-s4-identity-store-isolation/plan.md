---
title: "Nexus S4 identity and Store isolation"
description: "Cut the existing Nexus Console over to real identity, Store-scoped authorization, assigned Staff work, and final Owner Refund decisions without reseeding Store A."
status: completed
priority: P1
effort: 17d
issue: null
branch: main
tags: [feature, auth, backend, database, frontend, critical]
blockedBy: []
blocks: []
created: 2026-09-12
---

# Nexus S4 identity and Store isolation

## Overview

Implement the complete S4 authorization cutover against the existing D1/R2 data model. Store A remains `store_nexus`; historical data, Customer capabilities, immutable purchase snapshots, payment evidence, and retained file references remain intact. Better Auth supplies prebound Google identity and sessions. Nexus-owned memberships, permissions, assignment, and Refund lifecycle rules remain explicit domain concerns.

Scope: HOLD; `--deep --tdd`. The three user-confirmed rules remain assigned-only Staff Orders, read-only Staff Products, and one final Refund Request per Order. Approval awaits S5 execution. No signup/team UI, Store picker, new delete API, money movement or MCP. Eight phases keep distinct proof boundaries; execute sequentially when file ownership overlaps.

Architecture: one D1 with application-enforced Store scope and `@nexus/identity` policy; Worker handles platform/HTTP, packages own writes. Better Auth 1.7.4 raw D1 support and the actual workerd lifecycle are verified by Phase 1. Interfaces, decisions, migration ordering, atomic/replay predicates and the performance budget: [Implementation contracts](./contracts.md).

## Cross-Plan Dependencies

No unfinished implementation output blocks S4. S1/S2 still have historical verification metadata; their anonymous-access checks must not be reused as S4 acceptance. S3 reconciliation and capability layout are completed baseline plans. See [dependency scan](./reports/validation-260912-0224.md). S5 execution is out of scope.

## Phases

| # | Phase | Status | Depends on |
|---|---|---|---|
| 1 | [Verify Better Auth on Workers and establish its schema](./phase-01-start.md) | Complete | — |
| 2 | [Add Nexus identity, membership, and assignment schema](./phase-02-identity-schema.md) | Complete | 1 |
| 3 | [Resolve authenticated Store context at the Worker boundary](./phase-03-authenticated-context.md) | Complete | 1, 2 |
| 4 | [Cut every private catalog path over to Store scope](./phase-04-catalog-store-scope.md) | Complete | 2, 3 |
| 5 | [Enforce assigned-only Order access and atomic assignment](./phase-05-assigned-order-access.md) | Complete | 2, 3 |
| 6 | [Persist final Refund decisions and safe projections](./phase-06-refund-decisions.md) | Complete | 5 |
| 7 | [Deliver the role-aware Console and Customer experience](./phase-07-role-aware-experience.md) | Complete | 4, 5, 6 |
| 8 | [Rehearse populated migration, isolation, and rollout](./phase-08-migration-rehearsal-and-rollout.md) | Complete | 1–7 |

Phase inventories/checklists record current source; re-scout before execution only if it moved. No phase is independently safe to deploy before the complete cutover passes.

## TDD Strategy

Each phase records baseline → behavioral Red → Green → Refactor, exact files, interface checklist, scenarios and focused commands. Dependency/import/setup errors do not count as Red. Worker/D1 proves authorization/atomicity; raw Wrangler proves populated migrations; real browsers prove sessions/UI. The [49-scenario acceptance map](./acceptance.md) now links the completed local evidence.

## Global Acceptance Criteria

- [x] Store A Owner signs in and sees the same pre-S4 Products, Customers, Orders, history, payment evidence, snapshots, and retained R2 associations.
- [x] Store A Staff sees and processes only assigned Orders; stale direct actions after reassignment or membership removal fail without replay disclosure.
- [x] Store B cannot read or mutate Store A resources through IDs, slugs, references, cursors, imports, schema previews, or file operations.
- [x] Staff cannot perform Product mutations, assignment, Refund decisions, or protected deletion/removal operations.
- [x] Competing Approve/Reject calls persist exactly one terminal decision and one audit event. Identical retries replay; conflicting intent fails.
- [x] Approval leaves the Order Paid/Fulfilled and payment evidence unchanged; UI copy says awaiting execution, never Refunded.
- [x] Matching Customer capability sees only the safe decision. Guessed/other capabilities and public routes reveal no private state.
- [x] Sign-out, expiry, and identity replacement clear private client state and discard stale in-flight responses.
- [x] Console works at 375 px without horizontal page scroll; primary actions use `color-accent` with `color-accent-ink`.
- [x] Public Storefront still reads Store A Products and creates Store A Orders regardless of any Console cookie.

## Rollout Boundary

No remote migration, credential provisioning, deployment, or production smoke is authorized by this plan. Phase 8 records a future procedure and stop conditions; remote provisioning and authenticated smoke apply remain unimplemented. Remote work requires reviewed operator tools, exact Console/Storefront origins, an authorized D1 checkpoint, a proven old-writer barrier, runtime secrets supplied outside git, and explicit mutation authorization.

## Red Team Review

Four independent review lenses, 14 findings adjudicated: [review report](./reports/red-team-260912-0224.md). Technical corrections are reflected in the phase files. User confirmed separate accounts per Store on 2026-09-12; the membership decision gate is resolved. Local implementation is complete; remote operations remain unauthorized and blocked.

Follow-up audit, approved 2026-09-12: applied 4 findings (2 High, 2 Medium)—Node/workerd test separation, safe CSV unknown-commit retention, Phase 5 ownership of the compiling assignment result seam, and session refresh/deletion-cookie forwarding. [Applied audit and verification](./reports/audit-260912-1301-nexus-s4-identity-store-isolation.md). Approval covers these plan corrections only.

### Whole-Plan Consistency Sweep

Reread this index, all eight phases, contracts and acceptance; checked decision deltas across runner commands/inventories, CSV compensation, assignment ownership, session lifecycle, destructive migration rollback, Variant retention and remote readiness wording. Historical reports remain dated snapshots. Unresolved local blockers: 0.

## Validation Log

[Final local validation](./reports/phase-08-local-validation.md) records unit 40/40, Node operator 6/6, integration 188/188, browser 62/62, Playwright 30/30, typecheck and both builds under Node 22. [Final blocker review](./reports/code-reviewer-260912-phase-8-blocker-closure.md) is GO at 9.8/10 with zero critical/high findings. These local results do not establish deployment readiness or remote authentication state.

Membership confirmation, 2026-09-12: “Tài khoản riêng cho từng Store trong S4 (khuyến nghị)”. S4 uses at most one active membership per account and no Store picker; schema, resolver, fixtures and UI now reflect this confirmed decision.

## Sources

[S4 brief](../../session-4-brief.md) · [Brainstorm](../reports/brainstorm-260912-0038-nexus-s4-identity-store-isolation.md) · [Scenarios](../reports/scenario-260912-0041-nexus-s4-identity-store-isolation.md) · [Auth research and official URLs](./reports/research-auth-260912-0224.md) · [Domain research](./reports/research-domain-260912-0224.md)

<!-- slug: nexus-s4-identity-store-isolation -->
