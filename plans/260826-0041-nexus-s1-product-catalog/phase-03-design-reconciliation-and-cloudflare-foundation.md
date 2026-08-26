---
phase: 3
title: "Design Reconciliation and Cloudflare Foundation"
status: pending
priority: P1
effort: "1d"
dependencies: [2]
---

# Phase 3: Design Reconciliation and Cloudflare Foundation

## Context Links

- [Approved Phase 2 record](../../design/approval.md)
- [Design-to-machine reconciliation](../../design/contract-reconciliation.md)
- [Versioned acceptance authority](../../design/reconciled-acceptance-manifest.md)
- [Cloudflare platform evidence](./research/cloudflare-platform-evidence.md)
- [Contract architecture scout](./reports/scout-contract-architecture.md)
- [S1 technical brief](../../session-1-brief.md)

## Overview

Lock contracts, scaffold assets/minimal Worker/API 404, and pass routing `C+L` plus local parser/exact-45 gates before any Cloudflare mutation. Only then persist final names, whoami/list, controlled D1 create, remote JSON probe, then R2. Phase 3 does not implement schema preview/apply persistence.

## Requirements

- Functional:
  - Treat `design/contract-reconciliation.md` as the complete approved action/state-to-route/DTO/D1/R2/error crosswalk and `design/reconciled-acceptance-manifest.md` version `nexus-s1-reconciled-1` as the Phase 3-6 acceptance authority.
  - Lock exact API/detail/ownership/draft-ref/snapshot contracts; Phase 3 may prove only pure draft-ref validation/mapping, never preview/apply route or persistence behavior.
  - Preserve every fixed brainstorm decision and approved browser behavior; renewed approval is required only for a browser-visible change.
  - Lock `papaparse@5.7.0` as the one RFC 4180 parser for browser and workerd.
  - Prove exact 500-row/8,501-record success in 45 statements and a concurrent Product revision/fingerprint drift rollback that fails at counted statement 45, never statement 46.
  - After controlled persisted D1 resolution/creation, probe remote `json_valid`, `json_each`, `json_extract` and cleanup before Phase 4 or R2 creation.
  - Scaffold one React/Vite SPA plus one native module Worker and exact JSON API 404 behavior.
  - Prove `ROUTE-001/002` configuration and local SPA/API harness behavior before whoami, resource listing, or creation.
  - Configure one D1 binding `DB` and one private R2 binding `FILES`.
- Non-functional:
  - Node 22+; current verified package targets are Vite plugin `1.54.0`, Wrangler `4.126.0`, Workers Vitest pool `0.22.0`, Vitest `4.1.11`, Playwright `1.62.1`, Papa Parse `5.7.0`.
  - Strict TypeScript, npm lockfile, no ORM, and direct route dispatch unless implementation evidence makes a router necessary.
  - Static assets use `assets.directory`, `not_found_handling: "single-page-application"`, and `run_worker_first: ["/api", "/api/*"]`.
  - Direct Wrangler resource/deploy operations only; no dashboard Builds, custom domain, public R2, or deploy wrapper.
  - Persist Worker, database, and bucket names before remote mutation; local bindings for development and no persisted production `remote:true`.

## Architecture

```text
React/Vite Console assets
          │
          ├── /console/* → SPA fallback from assets.directory
          │
          └── /api + /api/* → Worker first, JSON including 404
                                  ├── direct route dispatch
                                  ├── D1 binding: DB
                                  └── private R2 binding: FILES
```

Routing scaffold first:

- Configure `assets.directory`, SPA not-found handling, and Worker-first `["/api","/api/*"]` without final remote identity.
- Add minimal native Worker dispatch and JSON `route_not_found`.
- Prove local `/console/*` HTML plus `/api` JSON/404 and config evidence.

Only after that `C+L` gate and local parser/exact-45 gates:

1. Generate/persist final Worker `nexus-s1-<six lowercase alphanumeric>`, D1 `<worker>-db`, R2 `<worker>-private`, bindings `DB`/`FILES`.
2. Set `workers_dev:true`, `preview_urls:false`; no custom/public route/domain or production `remote:true`.
3. Run whoami/list/classify; resolve/create D1 only if absent and persist ID.
4. Run/clean remote JSON probe; stop before R2/Phase 4 on failure.
5. After probe success resolve/create R2. Reruns reuse without create.

Feasibility architecture is fixed by manifest `CSV-001`, `CSV-015..019`, and `RES-007`:

- Exact all-new fixture success inserts 500 Products + 2,500 groups + 2,500 values + 500 Variants + 2,500 memberships + one import = 8,501 records.
- One JSON binding per `json_each(?)`; chunks Product 100, group 250, value 250, Variant 100, membership 250.
- Four lookups + 41 writes = 45. Product chunks conditionally transition matched Products from preflight revision/fingerprint to computed post-import state; Duplicate-only state is unchanged.
- Counted statement 45 inserts import metadata only after re-reading every computed poststate; mismatch makes required ID NULL, fails NOT NULL, and rolls back statements 1-44.
- Success is all-new 8,501 records. Race proof pre-seeds one exact Product, mutates after reads, observes conditional transition no-op and statement-45 failure at the same 45 count. No 46th statement/hook.
Phase 3 requires only `C+L` for `ROUTE-001/002` and local `L` for CSV-015; their deployed routing/actual remote 500-row import evidence belongs to Phase 6. The only Phase 3 remote feasibility action is the controlled D1 JSON-function/cleanup probe after D1 resolution. Stop on any staged failure, ambiguity, non-45 count, binding overflow, rollback residue, or parser divergence; never cut scope.

## Related Code Files

- Must exist/approve: `/Users/itsddvn/projects/nexus-handson/design/approval.md`
- Create: `/Users/itsddvn/projects/nexus-handson/design/contract-reconciliation.md`
- Create: `/Users/itsddvn/projects/nexus-handson/design/reconciled-acceptance-manifest.md`
- Modify: `/Users/itsddvn/projects/nexus-handson/plans/260826-0041-nexus-s1-product-catalog/plan.md`
- Modify: `/Users/itsddvn/projects/nexus-handson/plans/260826-0041-nexus-s1-product-catalog/phase-03-design-reconciliation-and-cloudflare-foundation.md`
- Modify: `/Users/itsddvn/projects/nexus-handson/plans/260826-0041-nexus-s1-product-catalog/phase-04-catalog-domain-api-and-private-files.md`
- Modify: `/Users/itsddvn/projects/nexus-handson/plans/260826-0041-nexus-s1-product-catalog/phase-05-unified-csv-import-and-frontend-integration.md`
- Modify: `/Users/itsddvn/projects/nexus-handson/plans/260826-0041-nexus-s1-product-catalog/phase-06-verification-and-wrangler-deployment.md`
- Modify: `/Users/itsddvn/projects/nexus-handson/package.json`
- Modify: `/Users/itsddvn/projects/nexus-handson/tsconfig.json`
- Modify: `/Users/itsddvn/projects/nexus-handson/vite.config.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/wrangler.jsonc`
- Create: `/Users/itsddvn/projects/nexus-handson/worker-configuration.d.ts`
- Modify: `/Users/itsddvn/projects/nexus-handson/src/console/main.tsx`
- Preserve outside production graph: `/Users/itsddvn/projects/nexus-handson/design/prototype-scenarios.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/worker/index.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/worker/environment.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/worker/http-response.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/shared/catalog-limits.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/vitest.config.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/playwright.config.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/csv-bulk-feasibility.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/scripts/assert-production-import-graph.ts`

## Implementation Steps

1. Confirm approval and locked reconciliation/manifest.
2. Lock exact DTO, one-owner, draft-ref, error, snapshot, phase/evidence boundaries.
3. Lock versions and shared Papa Parse contract.
4. Scaffold Vite/assets plus minimal Worker/API JSON 404 without final remote identity.
5. Configure local harness and pass `ROUTE-001/002` `C+L` evidence.
6. Generate exact CSV fixture and prove browser/workerd parity.
7. Implement/prove four reads + 41 writes, exact-45 success and drift rollback.
8. Pure-test draft-ref validation and deterministic ref→prospective-ID mapping in memory only; no route/D1 persistence claim.
9. After all local gates, generate/persist final Worker/D1/R2 names and exact bindings.
10. Run whoami/list/classify; resolve/create D1 and persist ID.
11. Run/clean remote JSON probe; stop before R2/Phase 4 on failure.
12. After probe success resolve/create private R2.
13. Generate final Worker binding types/config without changing routed behavior.
14. Add production design-fixture graph denial.
15. Record that preview/apply route, stable-ID persistence, stale hash and schema lifecycle tests are Phase 4 after migrations.

## Todo

- [x] User design approval verified
- [x] Reconciled acceptance manifest created
- [x] Downstream phases reconciled and locked to manifest
- [x] Worker/D1/R2 names persisted before mutation
- [x] Direct Wrangler account/resource setup repeatable
- [x] 500-row parser/D1 bulk feasibility proven locally and remotely probed
- [x] One D1 and one private R2 binding configured
- [x] Local SPA/API routing foundation verified
- [x] Design scenarios excluded from production import graph

## Success Criteria

- [x] Recorded design approval and `nexus-s1-reconciled-1` documents precede every backend/remote mutation.
- [x] Downstream phases have no missing/contradictory approved action, field, state, route, DTO, transaction, R2, error, or evidence boundary.
- [x] Exact Product detail/request ownership/error and private S2/S5 snapshot records are present and assigned to Phase 4/6 evidence.
- [x] Exact DTO/draft-ref/snapshot records are assigned downstream; Phase 3 ref proof is pure only and claims no API/D1 persistence.
- [x] Papa Parse parity and all-new/same-45 drift rollback pass locally.
- [x] Minimal Worker/API 404 and `ROUTE-001/002` `C+L` pass before any whoami/list/create.
- [x] Only after local gates: final names → whoami/list → D1 → remote probe/cleanup → R2.
- [x] Preview/apply route/persistence/stale-hash/stable-ID lifecycle evidence is deferred to Phase 4; deployed routing/CSV-015 remote import to Phase 6.

## Risk Assessment

- Risk: an approved UI family is silently omitted or a provisional route changes visible behavior.
  - Signal: a `UI-*`/`API-*` manifest ID has no exact implementation/evidence owner.
  - Response: stop and patch reconciliation plus all downstream phases; seek approval only if the browser must change.
- Risk: resource create succeeds before identity is persisted.
  - Signal: exact name exists remotely but local config lacks returned ID.
  - Response: stop, list in confirmed account, recover/persist exact identity, and never generate/create another.
- Risk: parser/bulk/race feasibility fails.
  - Signal: divergence, fixture mismatch, count other than 45, >100 bindings, guarded statement 45 fails to catch drift, rollback residue, or remote probe/cleanup failure.
  - Response: stop before Phase 4 and revise implementation; retain every approved limit and one-owner/snapshot contract.
- Risk: workers.dev/public Console is mistaken for secure production.
  - Signal: implementation/report claims authorization, privacy, or business-critical production posture.
  - Response: correct the claim and preserve manifest `RISK-001..003`.

