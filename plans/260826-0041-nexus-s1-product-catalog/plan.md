---
title: "Nexus S1 Product Catalog"
description: "Frontend-first plan for a deployed Cloudflare Product Console with bounded Variants, unified CSV import, private delivery files and a stable Storefront API."
status: in-progress
priority: P1
effort: "7.5d"
branch: main
tags: [feature, frontend, backend, database, api, infra]
blockedBy: []
blocks: []
created: 2026-08-26
---

# Nexus S1 Product Catalog

## Overview

Build Nexus from an implementation-empty repository. The Mobbin-backed Phase 2 prototype recorded in `design/approval.md` was explicitly approved on 2026-08-26. `design/contract-reconciliation.md` version `nexus-s1-reconciled-1` now maps that unchanged browser contract to exact Worker/D1/R2 behavior, and `design/reconciled-acceptance-manifest.md` is the sole downstream acceptance authority. Implementation remains one React/Vite Cloudflare Worker backed by D1 and private R2, followed by direct Wrangler deployment to one persisted randomly named workers.dev URL.

## Scope

- One bootstrap Store and one shared catalog.
- Simple Products plus one active Variant schema: 5 groups, 10 values/group, max 30 combinations.
- Product base price, optional Variant override and exact minor-unit storage.
- Product-default and complete Variant delivery overrides with private PDF/ZIP files up to 25,000,000 bytes.
- One unified CSV template/import: UTF-8, exactly 1,000,000 bytes, 500 data rows, additive exact-match.
- Canonical `GET /api/storefront/products` Customer-safe projection.
- Private no-route S2/S5 snapshot resolver copies selected identities/options, effective price/currency, access content, and immutable private-file key.
- Public Console/write/upload routes are an explicit accepted S1 risk.
- Direct Wrangler resource creation/migrations/deploy; workers.dev only, no custom domain.

## Execution Gate

Before Cloudflare mutation, Phase 3 scaffolds minimal Worker/API 404 and passes routing `C+L` plus local exact-45/500-row gates. Only then persist final names, whoami/list, controlled D1 create, remote JSON probe, then R2. Preview/apply routes and stable-ID persistence tests are Phase 4 after migrations; deployed routing/remote CSV-015 are Phase 6. No scope reduction.

## Phases

| Phase | Name | Status | Dependency | Objective |
|---|---|---|---|---|
| 1 | [Frontend Design Research](./phase-01-frontend-design-research.md) | Pending | None | Freeze Mobbin-backed screen/state/token contract |
| 2 | [Frontend Prototype and Approval](./phase-02-frontend-prototype-and-approval.md) | Pending | Phase 1 | Build real browser prototype and obtain user approval |
| 3 | [Design Reconciliation and Cloudflare Foundation](./phase-03-design-reconciliation-and-cloudflare-foundation.md) | Pending | Phase 2 approval | Reconcile plan, persist Worker identity, create D1/R2 foundation |
| 4 | [Catalog Domain API and Private Files](./phase-04-catalog-domain-api-and-private-files.md) | Pending | Phase 3 | Implement Product/Variant/API/R2 vertical slice |
| 5 | [Unified CSV Import and Frontend Integration](./phase-05-unified-csv-import-and-frontend-integration.md) | Pending | Phase 4 | Implement template, preview, import transaction and result UI |
| 6 | [Verification and Wrangler Deployment](./phase-06-verification-and-wrangler-deployment.md) | Pending | Phase 5 | Prove all contracts and deploy directly to workers.dev |

## Architecture Decisions

- Node 22+ (current local Node 24.13.1), npm, strict TypeScript, React/Vite, `@cloudflare/vite-plugin@1.54.0`, Wrangler `4.126.0`.
- One native module Worker with direct route dispatch, one D1 binding `DB`, one private R2 binding `FILES`, and no ORM/router dependency unless implementation evidence makes direct dispatch insufficient.
- SPA assets use `assets.directory`, `not_found_handling: "single-page-application"`, and `run_worker_first: ["/api", "/api/*"]`; Console deep links return SPA HTML and every API path returns JSON.
- `design/reconciled-acceptance-manifest.md` version `nexus-s1-reconciled-1` is the Phase 3-6 machine/evidence authority.
- `papaparse@5.7.0` owns RFC 4180 parsing in browser and workerd through one shared CSV contract and fixture set.
- D1 JSON bulk stays exactly 45 statements. Product chunks conditionally transition matched preflight revision/fingerprint to computed post-import state; counted final metadata insert rechecks poststate and fails NOT NULL on drift, providing same-count rollback/race closure.
- SchemaDraft uses request-local refs, but Phase 3 proves only pure validation/mapping. Phase 4 after migrations implements exact preview/apply routes, hash/stale/no-write/atomic stable-ID lifecycle; nonstructural update remains separate.
- Raw streamed delivery-file upload uses R2-first/D1-second compensation; remove/default transitions retain historical objects.
- Browser CSV preview is advisory; Worker stores the unchanged original first and independently revalidates; eligible groups may commit while rejected groups remain authoritative results.
- A private, tested, no-route S2/S5 snapshot resolver copies selected Product/Variant/options, effective minor price/currency, effective access content, and immutable private-file key.
- Workers pool `0.22.0` + Vitest `4.1.11`, built Worker harness, Playwright `1.62.1`, remote smoke, manifest-led cleanup, and production fixture-graph denial form the verification ladder.

## Research

- [Mobbin UI references](./research/mobbin-ui-reference.md)
- [Cloudflare platform evidence](./research/cloudflare-platform-evidence.md)
- [Contract architecture scout](./reports/scout-contract-architecture.md)
- [Validated brainstorm report](../reports/brainstorm-2026-08-25-session-1-nexus-product-console.md)

## Success Criteria

- [ ] Approved Phase 2 prototype behavior remains unchanged and is traceable to prototype evidence.
- [ ] Every `nexus-s1-reconciled-1` manifest ID has the required prototype/local/remote/config evidence.
- [ ] Exact detail/error, label-only/one-owner DTOs, SchemaDraft ref→server-ID/non-persistence, and ambiguous/invalid-ref zero-write rejection pass.
- [ ] Product/Variant/CSV/file bounds, decimal money, schema preview/apply, partial eligible imports, same-45-statement drift rollback and compensation pass.
- [ ] CSV-015 proves exact 500-row/8,501 locally before Phase 4 and as an actual remote import only in Phase 6.
- [ ] Public catalog is built from its exact allow-list and recursively contains no delivery/storage/import fields.
- [ ] Private snapshot resolver copies exact simple/Variant/default/override selection, price, access, and immutable file key without adding a public route.
- [ ] `/console/*` deep links serve SPA HTML while `/api` and `/api/*`, including 404, remain Worker-first JSON.
- [ ] One persisted random Worker/D1/R2 identity is created in the required order and reused by the second deploy.
- [ ] Real deployed create/edit/list/reopen, Variant, template/import/re-import and private-file journeys pass, then verification fixtures are safely removed.
- [ ] Production import graph contains no prototype scenario/fixture provider.
- [ ] Final evidence states anonymous Console/write/upload risk, workers.dev teaching boundary, and S4 authorization ownership.

## Cross-Plan Dependencies

None. S2 and S5 briefs consume the S1 interfaces but are future implementation owners, not blocking plans.

## Open Questions

None. Any backend/API change caused by approved frontend behavior is handled by the mandatory Phase 3 reconciliation gate.

<!-- slug: nexus-s1-product-catalog -->