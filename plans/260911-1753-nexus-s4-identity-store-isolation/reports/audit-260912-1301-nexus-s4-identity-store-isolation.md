---
title: "S4 approved audit corrections"
date: 2026-09-12
status: applied-to-plan
scope: planning-only
---

# S4 approved audit corrections

## Summary

User approved applying the four findings from the preceding read-only audit. Applied 2 High and 2 Medium plan corrections; no implementation, dependency install, application tests, migration, provisioning, deployment or commit. Separate login accounts per Store, assigned-only Staff Orders, read-only Staff Products and final Refund decisions awaiting S5 are unchanged.

## Findings and applied decisions

| Severity | Evidence from audit | Applied correction |
|---|---|---|
| High | `vitest.config.ts:4-16` loads the Workers plugin for unit/integration paths; Phase 8 requires Node-only Wrangler/proxy/filesystem orchestration | Phase 8 creates standalone `vitest.node.config.ts`, `tests/node/s4-populated-rehearsal.test.ts`, root typecheck inclusion and `verification:s4-rehearsal:test`. Domain acceptance remains workerd; raw CLI populated proof remains separately required. |
| High | `packages/catalog/src/import/import-command.ts:53-75,145-147` unconditionally compensates on a thrown write; `import/import-write.ts:134-163` persists the original key in D1 | Phase 4 classifies commit outcome using Store/import/key identity. Delete only on proven rollback/definitive absence with no outstanding commit; retain on committed/unknown/read failure. Internal ownership checks cannot mistake revoked-member concealment for absence. Real commit-then-error and rollback/outage/delete-failure tests required. |
| Medium | `packages/orders/src/order-types.ts:63-70` and `packages/orders/src/persistence/command-store.ts:122-162` share a generic result shape; previous Phase 2 union expansion preceded Phase 5 reader implementation | Phase 2 owns assignment SQL schema/CHECK branches and identity context only. Phase 5 owns strict action/result/history types, readers, Worker adapter, minimal Console result types/parser and contract tests together. Phase 7 consumes them for interactive controls/refetch. |
| Medium | Internal session call in contracts/Phase 3 preserved only data; pinned Better Auth session source sets/deletes cookies on refresh/expiry | Phase 3 keeps refresh enabled, receives headers plus data, and appends every cookie separately on final Console success/denial responses. No header state in domain identity or public routes; outages do not synthesize logout. Phase 7 verifies actual browser expiry refresh/cleanup. |

Primary external evidence reviewed during the audit: [Wrangler Node-only getPlatformProxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy), [Better Auth 1.7.4 session implementation](https://github.com/better-auth/better-auth/blob/v1.7.4/packages/better-auth/src/api/routes/session.ts#L287-L397). Pinned/source support is not runtime proof.

## Rejected suggestions

- New private mutation limiter: not required by S4-16, which scopes repeated invalid login and public submission checks. No new limiter/SLA added without product scope.
- Durable security-denial event store: successful business audit events and sanitized diagnostics are in scope; a new retention/storage pipeline is not established by the brief. No denial ledger added.
- Treat omission of an explicit `order_idempotency` manifest entry as a High migration blocker: current proposed rebuilds do not touch that table; existing public create/replay regression coverage remains required. No evidence warrants expanding the migration closure.

## Whole-plan consistency sweep

Decision deltas: 4. Read index, all eight phase files, contracts, acceptance and current aggregate validation/review records. Reconciled runner path/config/script/typecheck ownership; CSV upload compensation and failure tests; assignment schema versus complete TypeScript/reader/client phase ownership; session response headers, browser lifecycle and scenario allocation. Original independent reports remain historical evidence, not executable plan authority.

Owning files updated: `plan.md`, `contracts.md`, `acceptance.md`, Phases 2/3/4/5/7/8, prior aggregate red-team and validation records, and this report. Phases 1/6, source brainstorm/scenarios and unrelated WIP remain unchanged. Unresolved contradictions for these four deltas: 0.

## Verification and recommendations

Use structural CLI validation, exact 49-scenario/severity comparison, local-link/heading checks and stale-reference checks for this documentation change. These checks do not establish any Red/Green application pass. All eight implementation phases and all 49 behavioral acceptance rows remain pending/NOT RUN. Implementation must begin with Phase 1's Node 22/workerd compatibility gate only after separate authorization; remote actions retain their own explicit approval boundary.

Executed planning checks:

- `ak plan validate ... --json`: `valid:true`; status: 8 phases, 0 done, 98 tasks, 0 done.
- Source comparison: 49 rows, 49 unique IDs, 0 severity mismatches; 30 Critical / 17 High / 2 Medium.
- 21 plan-package Markdown files, 59 local links: 0 missing file/heading targets. No stale integration-path rehearsal command in active docs.
- All 12 changed plan-package files have no trailing whitespace. Initial whole-package scan flagged five existing intentional two-space Markdown hard breaks in the untouched historical scope review; preserved them, not a content defect.
- Rebuilt CLI plan index from files; no phase-state changes. Journal CLI initially resolved an incorrect outside-repo directory; moved only its newly created journal to project `plans/journals/2026-09-12-apply-approved-nexus-s4-plan-audit.md`. No CLI/skill code changes or publication.

## Unresolved questions

None for these approved plan corrections. Runtime proof, populated migrations, browser evidence and remote prerequisites remain execution gates, not completed work.
