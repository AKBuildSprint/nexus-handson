---
title: Refine Nexus S4 deep TDD plan
date: 2026-09-12
summary: Complete eight-phase planning contracts and 49-scenario map; implementation remains pending.
---

# Refine Nexus S4 deep TDD plan

## What happened

Refined the existing plans/260911-1753-nexus-s4-identity-store-isolation plan from the user-named brainstorm and scenario reports using ak-plan --deep --tdd. Source research covered auth/schema/runtime, domain/replay/migration behavior and UI/operator consumers. Four independent review lenses produced 14 findings, adjudicated in the plan-local red-team report.

## Decisions and evidence

Preserved assigned-only Staff Orders, read-only Staff Products, one final Refund request and no S5 money movement. Added explicit auth endpoint/response privacy contracts, assignment result and migration ownership, complete replay/atomicity guards, shared local binding lifecycle and populated raw-Wrangler proof. Kept remote authority separate and local documentation claims distinct from deployed state.

Structural validation passed. Acceptance maps all 49 source scenarios with their exact severities. All 8 implementation phases and 97 tasks remain pending. Host Node24 differs from required Node22; dependencies are absent. Researcher test discovery failed before valid collection and is not behavioral Red or a passing baseline. No application code, migrations or deployment changed.

## Next checkpoint

User review of the completed plan. Explicitly accept or replace proposed one-active-Store membership per account before Phase2 schema/resolver and dependent implementation. After implementation authorization, Phase1 proves the pinned auth runtime; no runtime/migration/browser pass is claimed now.

AgentWiki publish skipped. No social publishing requested or performed.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
