---
phase: 6
title: "Verification and Wrangler Deployment"
status: pending
priority: P1
effort: "1d"
dependencies: [5]
---

# Phase 6: Verification and Wrangler Deployment

## Context Links

- Sole acceptance authority: [`design/reconciled-acceptance-manifest.md`](../../design/reconciled-acceptance-manifest.md), version `nexus-s1-reconciled-1`
- Machine contract detail: [`design/contract-reconciliation.md`](../../design/contract-reconciliation.md)
- [Cloudflare platform evidence](./research/cloudflare-platform-evidence.md)
- [Workers testing](https://developers.cloudflare.com/workers/testing/)
- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)

## Overview

Verify and deploy solely from every ID in `nexus-s1-reconciled-1`. Produce a one-row-per-ID evidence ledger, preserve approved prototype evidence, complete local/runtime/browser/config proof, perform remote mutations in the manifest order, smoke the persisted workers.dev/D1/R2 identities, clean only recorded fixtures, and report the accepted anonymous-write risk. Missing evidence is failure.

## Requirements

- Functional:
  - Read the manifest version/constants/records and fail before work if absent, stale, or not `LOCKED_ACCEPTANCE_AUTHORITY`.
  - Create the exact ledger columns `manifest_id|environment|artifact_paths|command_or_scenario|observed|pass`; include every manifest ID exactly once.
  - Resolve `P/L/R/C` evidence to the manifest's exact prototype and report directories; prose cannot replace required artifacts.
  - Run local unit/workerd/built-harness/Playwright/config evidence for every required ID before remote migrations/deploy.
  - Apply remote D1 migrations, direct Wrangler deploy, and remote smoke only in the manifest's mutation order.
  - Verify exact detail/request ownership/errors, Product/Variant/schema/file/CSV/public/snapshot/routing/resource/deployment/risk contracts and all boundaries.
  - Record every remote fixture identity/object alias as it succeeds, then run manifest-driven FK-safe cleanup and absence proof.
- Non-functional:
  - Reuse exact Worker/D1/R2 identity; never regenerate/create duplicates.
  - `workers_dev:true`, `preview_urls:false`, exact SPA/API routing, no custom/public R2 route/domain or deploy wrapper.
  - Redact credentials/private object keys from public/request artifacts; private storage evidence remains reviewable by opaque alias/checksum.
  - Final HTML report links prototype evidence and every ledger artifact and explicitly states anonymous Console/upload risk.
  - Production build graph must exclude `design/`, prototype scenarios, and fixture providers.

## Architecture

### Manifest-led evidence pipeline

```text
nexus-s1-reconciled-1 records
       │
       ├── P existing approved prototype paths
       ├── L local unit/workerd/harness/Playwright artifacts
       ├── C config/version/build-graph artifacts
       └── R ordered workers.dev/API/D1/R2/deploy/cleanup artifacts
                         ↓
             one exact row per manifest ID
                         ↓
              linked HTML verification report
```

The verifier enumerates manifest groups `UI`, `API`, `DATA`, `MONEY`, `VAR`, `FILE`, `CSV`, `PRIV`, `SNAP`, `ROUTE`, `RES`, `TEST`, `DEPLOY`, and `RISK`. It compares ledger/manifest sets both directions; missing/extra/duplicate IDs fail. Every required `P/L/R/C` artifact must exist and match exact constants.

### Local/config gate before remote mutation

1. Confirm manifest version/status and all prototype registry paths, including `.artifacts/report/20260826-030504-nexus-prototype/report.html`, screenshots, and approved CSV.
2. Capture exact runtime/package/config identity: Node >=22; Vite plugin 1.54.0; Wrangler 4.126.0; Workers pool 0.22.0; Vitest 4.1.11; Playwright 1.62.1; Papa Parse 5.7.0.
3. Run local tests for detail/one-owner/label IDs, SchemaDraft ref validation/mapping/non-persistence, snapshot, D1/race/R2/privacy/parser/bulk and route_not_found.
4. Build and inspect module graph; fail any production reachability to `design/`, `prototype-scenarios`, scenario controls, or prototype fixture payload.
5. Built harness verifies `/console/*` SPA HTML and Worker-first JSON for exact `/api` and `/api/*`.
6. Playwright verifies every `UI-*` at desktop and exactly 375 px, including selected Product history, dirty guard, preview/apply, partial CSV groups, files, keyboard/focus, and no horizontal scroll.
7. Stop before remote mutation on any failed required local/config record.

### Exact remote mutation/deploy order

1. Inspect persisted names/config; assert Worker pattern, deterministic D1/R2 names, exact bindings/routing, and no forbidden route/domain/public bucket/`remote:true`.
2. Run `wrangler whoami`, capture confirmed account, list exact D1/R2, and resolve only the persisted identities. Stop on mismatch/ambiguity.
3. Apply all migrations to the persisted D1 database.
4. Build, then run direct `npx wrangler deploy`; capture exact workers.dev URL.
5. Run remote API/browser/storage smoke and append each fixture Product/import ID and private object alias/key to the private fixture manifest immediately.
6. Run a second no-change build/deploy; assert same URL/D1 ID/R2 bucket and no create commands.
7. Generate cleanup only from the fixture manifest. Delete in FK-safe D1 order and delete only unreferenced verification R2 objects. Preserve `store_nexus`, non-fixture rows, historical/snapshotted objects not proven disposable.
8. Query/list verification prefixes/IDs and prove absence plus bootstrap/non-test retention.

### Exact evidence coverage

- `UI-*`: prototype + local/remote browser screenshots, accessibility/history observations.
- `API/VAR-*`: captured requests/responses plus draft-ref duplicate/missing/cross-group rejection, ref-to-server-ID mapping, and no ref persistence.
- `DATA/MONEY/VAR-*`: local constraint/rollback and remote persisted journey evidence.
- `FILE-*`: boundary/checksum/compensation/retention/private-bucket evidence.
- `CSV-*`: local exact-45 feasibility plus actual remote CSV-015 500-row/8,501 import, parser/bounds/partial groups and rollback.
- `PRIV-*`: public allow-list response plus recursive forbidden-key scan.
- `SNAP-*`: private resolver exact DTO, selection guards, copied snapshot immutability, and no route/R2 URL.
- `ROUTE/RES-*`: local `C+L` routing gate, deployed `R` routing, Phase 3 D1→probe→R2 chronology, and identity reuse.
- `TEST-*`: DTO ownership/error/snapshot/race suites, harness/browser/build graph/report.
- `DEPLOY-*`: ordered migration/deploy/smoke/redeploy/fixture cleanup artifacts.
- `RISK-*`: final report statements and no auth UI/config claim.

## Related Code Files

- Modify: `/Users/itsddvn/projects/nexus-handson/package.json`
- Modify: `/Users/itsddvn/projects/nexus-handson/wrangler.jsonc`
- Create: `/Users/itsddvn/projects/nexus-handson/README.md`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/e2e/console-products.spec.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/e2e/console-variants.spec.ts`
- Modify: `/Users/itsddvn/projects/nexus-handson/tests/e2e/console-import.spec.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/spa-api-routing.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/remote-contract-smoke.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/plans/260826-0041-nexus-s1-product-catalog/reports/post-verify-*.html`
- Create: `/Users/itsddvn/projects/nexus-handson/plans/260826-0041-nexus-s1-product-catalog/reports/evidence/*`
- Create: `/Users/itsddvn/projects/nexus-handson/plans/260826-0041-nexus-s1-product-catalog/reports/evidence/verification-fixtures.json`
- Create: `/Users/itsddvn/projects/nexus-handson/plans/260826-0041-nexus-s1-product-catalog/reports/evidence/cleanup-verification-fixtures.sql`

## Implementation Steps

1. Parse `nexus-s1-reconciled-1`, enumerate every ID and required evidence class, create empty deterministic ledger/artifact directories, and fail on schema/version/status mismatch.
2. Link/check every prototype registry artifact; record approved comparison baseline.
3. Capture exact package/runtime/config facts for `TEST-001`, routing, resource identity, bindings, and forbidden settings.
4. Run suites for detail/ownership/label edits, draft refs, snapshot, money/schema, CSV/file/errors/privacy/D1/compensation.
5. Prove local all-new 8,501/45 and same-45 drift rollback; do not treat remote JSON-function probe as remote CSV-015 import evidence.
6. Build and inspect production graph/metafile; record absence of all design scenario/fixture imports.
7. Run built HTTP harness for exact SPA/API routing and raw file/import failure classes.
8. Browser-drive every approved `UI-*` at desktop and 375 px, including route/history/dirty guard, schema preview/local apply/save, complete delivery, file states, canonical template, partial eligible CSV groups, authoritative results, keyboard/focus/errors.
9. Compare ledger IDs/classes and stop before remote mutation if any required local/config/prototype evidence fails or is missing.
10. Confirm persisted config/account/resources in exact `RES-*` order; do not create/regenerate anything during Phase 6.
11. Apply remote migrations to persisted D1, build, and deploy directly with Wrangler; capture URL/identity chronology.
12. Before each remote smoke mutation, initialize fixture manifest; append every Product/import ID and private object alias/key immediately after success.
13. Remotely verify API-003 create stale-hash zero-write and successful ref→stable-ID atomic mapping, then exact API-005 no-write preview and API-006 recompute/stale/atomic apply, plus files/errors/deployed routes.
14. Import exact CSV-015 remotely; capture 500 row outcomes and D1 proof of exact 8,501 relational records, plus re-import, partial groups, byte/row bounds and cleanup.
15. Capture public catalog and recursively assert exact allow-list/no private delivery/storage/import data.
16. Run internal `SNAP-*` tests proving simple/Variant/default/override copied identities/options/price/access/private key, rejection cases, immutability after catalog edit, and no public route.
17. Run second no-change build/direct deploy and prove unchanged URL/D1/R2 identity with no resource create.
18. Generate cleanup SQL/object operations only from fixture manifest; execute direct Wrangler cleanup, then prove fixture absence and bootstrap/non-test retention.
19. Complete every ledger row, run exact manifest/ledger set comparison, and write the linked HTML report with accepted anonymous-write/workers.dev risk.

## Todo

- [x] Reconciled acceptance manifest mapped to evidence
- [x] Unit/runtime/integration suites pass
- [x] Browser design fidelity and accessibility pass
- [x] All numeric/file/import boundaries pass
- [x] Remote config/resource identity reviewed
- [x] Remote D1 migrations applied
- [x] First and second direct Wrangler deploy return same workers.dev URL/resources
- [x] Real deployed Product/Variant/CSV/R2 journey passes
- [x] Verification fixtures cleaned through direct Wrangler commands
- [x] Public API privacy projection passes
- [x] README and verification evidence complete

## Success Criteria

- [x] Ledger contains every manifest ID exactly once, no extra ID, and every required `P/L/R/C` artifact passes.
- [x] Existing approved prototype evidence is linked and deployed UI shows no browser-visible change at desktop/375 px.
- [x] Product/API/data/money/Variant/file/CSV/public/snapshot/routing/resource/test/deploy/risk records match exact manifest constants.
- [x] API-003 local+remote evidence proves exact-payload hash recompute, stale 409 zero-write, confirmation/limit/ref validation, and successful atomic stable-ID mapping.
- [x] API-005/006 local+remote evidence proves exact route/body/If-Match/DTO/no-write preview and recompute/stale-zero-write/atomic apply.
- [x] Local exact-45 success/drift rollback and actual Phase 6 remote CSV-015 500-row/8,501 import both pass.
- [x] Production graph excludes design fixtures; deployed `R` evidence completes ROUTE-001/002 after Phase 3 `C+L`.
- [x] Remote chronology matches Phase 3 D1→probe→R2 and Phase 6 migrations→deploy→smoke→redeploy→cleanup.
- [x] Worker URL matches persisted name; second deploy preserves URL, D1 ID, R2 bucket and runs no create command.
- [x] Remote Product/Variant/file/import/public journeys pass, including partial eligible CSV groups and exact `+1` boundaries.
- [x] Public DTO recursively contains no delivery/access/file/storage/R2/import data.
- [x] Private snapshot resolver passes exact copy/selection/immutability/no-route contract while public DTO remains recursively private-field-free.
- [x] Fixture-manifest cleanup removes only verification rows/unreferenced objects and proves absence while preserving bootstrap/non-test/history-retained data.
- [x] Final HTML report links all evidence and states anonymous Console/write/upload, S4 authorization ownership, and public workers.dev teaching risk.

## Risk Assessment

- Risk: evidence is summarized rather than mapped to every manifest ID.
  - Signal: ledger set differs, duplicate row exists, or required class/path is absent.
  - Response: fail completion and collect the exact missing artifact; never waive an ID.
- Risk: account/resource identity is wrong or ambiguous.
  - Signal: whoami/list/config disagree.
  - Response: stop before migration/deploy; resolve persisted identity without create/regeneration.
- Risk: remote platform behavior fails exact limits.
  - Signal: 500-row/45-query, 30-Variant, stream, or routing smoke hits a limit/error.
  - Response: keep deployment failed and revise implementation; do not reduce manifest scope.
- Risk: cleanup deletes non-fixture or retained historical objects.
  - Signal: candidate ID/key is absent from fixture manifest or may be snapshot/history referenced.
  - Response: do not delete; restrict cleanup to proven fixture ownership and report retained item privately.
- Risk: public DTO/build graph leaks private/fixture data.
  - Signal: recursive key scan or metafile denial finds a match.
  - Response: block deployment/report completion and fix allow-list/import graph.
- Risk: deployment is described as authorized/secure production.
  - Signal: report omits `RISK-*` or makes private/auth claims.
  - Response: correct report; explicitly state accepted anonymous mutation/upload and S4 boundary.

