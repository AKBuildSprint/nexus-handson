---
title: "Nexus capability layout"
description: "Restructure current main into runnable apps and owned catalog/orders capabilities without changing behavior, HTTP API, or migrations."
status: completed
priority: P1
branch: thieung/nexus-capability-layout
tags: [refactor, tdd]
created: 2026-09-09
---

# Nexus capability layout

## Outcome and scope

User approved a fresh worktree from current main, not continuation of dirty old refactor worktrees. Previous issues #6/#7 and PR #8 are closed and are historical references only. Base: `3d08582b2238be62baf1d374c84c166faedfb65a`. Route: feature; mode: official; PR readiness only, no merge.

Preserve all behavior, HTTP API, asset delivery, CORS, order authorization/idempotency/transactions, and all seven migration files byte-for-byte. No new routes, schema edits, product features, dependency upgrades, framework, or generic shared package.

## Ownership contract

- `apps/console/src`: current `src/console`; its HTML and Vite config live in `apps/console`.
- `apps/storefront`: current `storefront`, HTTP-only consumer as today.
- `apps/worker/src`: current `src/worker`; HTTP adapters and platform composition only.
- `packages/catalog/src`: current `src/catalog`, plus owned `import/`, `files/`, `shared/` from the corresponding old directories. Catalog owns ingestion and delivery, not merely product DTOs. Existing implementation bodies remain unchanged.
- `packages/orders/src/queries/order-read.ts`: existing reads/projections; `commands/order-write.ts` and `commands/order-commands.ts`: existing creation/command orchestration; `persistence/command-store.ts`: extracted D1 ledger/result/batch helpers; `transitions/order-transitions.ts`: existing pure eligibility and actor rules extracted without changing check order. Types/validation/private-access remain at package src root. No empty layer folders and no generic repository abstraction. SQL predicates and atomic statement batches remain intact; SQL construction can remain within a command that owns its transaction.
- Private npm workspaces `apps/*`, `packages/*`; package imports use `@nexus/catalog/*`, `@nexus/orders/*` with concrete TypeScript subpath exports. No barrel compatibility layer or old src shims. Orders may depend on catalog, catalog never on orders/apps. Apps may depend on packages, not vice versa.
- Root `wrangler.jsonc` remains the single authored Console/API config and migration entrypoint, preserving `npx wrangler d1 migrations apply nexus-s1-468cba-db --local` and local state discovery. Freeze names, binding IDs, compatibility date, vars and API-first rules. Console deploy explicitly selects `apps/console/dist/nexus_s1_468cba/wrangler.json` generated from that source after build, avoiding stale root deploy redirects. Retain separate asset-only `apps/storefront/wrangler.jsonc`, its compatibility date and explicit deploy name. Root scripts retain names and forwarding (`--var`, `--name`). Keep same-origin Console+Worker topology and repo-root `.wrangler` state.
- `tests/{unit,integration,browser,e2e}` already exist: preserve layer ownership, fixtures/support remain helpers; update imports and infrastructure path references, not business expectations.
- `migrations`, `plans`, `docs`, `scripts` stay root. Historical plan/journal/brief evidence remains historical, not mass rewritten. Current README/design guidance/script invocations must use new paths.
- Root `AGENTS.md` is canonical; root `CLAUDE.md` links to it. User-approved scoped AGENTS: three apps, two capability packages, tests and migrations. No boilerplate in docs/plans or every layer subfolder. Concise evidenced rules; preserve token rules and point at relocated token sources. README carries the mental model.

## Phases

| # | Phase |
|---|---|
| 1 | [Capability and application cutover](./phase-01-start.md) |
| 2 | [Verification, guidance and PR delivery](./phase-02-verification.md) |

## Acceptance criteria

- [x] Three runnable apps and two owned capability packages; orders has real queries/commands/transitions/persistence code.
- [x] No old production src/storefront paths or compatibility re-exports remain.
- [x] All seven migrations remain root with identical names and SHA-256 checksums.
- [x] HTTP routes, status/body/header semantics, private data boundaries, transactions and replay behavior remain unchanged.
- [x] Existing root development, build, test, preview, deploy and verification commands use new paths.
- [x] Node 22 `npm ci`, typecheck, unit/integration/browser suites, both builds and relevant e2e pass; actual local Console/API and Storefront smoke pass.
- [x] Root CLAUDE/AGENTS and scoped AGENTS describe real ownership, commands and invariants; current docs links resolve.
- [x] Reviewed PR on main target, configured required checks terminal green (report N/A explicitly when no checks exist), issue/PR ready to ship stable; no merge.

## Validation log

User approved the fresh plan, both red-team corrections, and the scoped guidance outline. Baseline under Node 22: 142 unit/integration tests and 48 browser tests passed, both builds passed; seven migration hashes captured before edits.

### Red Team Review
- Runtime Assumption Destroyer: two findings accepted by user. R1 (High): free-port CORS mismatch (`wrangler.jsonc:18`, `playwright.config.ts:75-86`); use matching ignored local origin override only when needed. R2 (Medium): single-Wrangler wording was too broad (`package.json:26-27`); preserve independent Storefront config and dry-run it separately.
- Security Adversary: no additional actionable findings; verified authorization/parse/replay precedence, legacy ledger rejection, conflict recovery order, atomic batches and private snapshot seam against existing code/tests.
- Light-tier verification: both reviewers checked at least five claims per phase. Remaining runtime assertions will be proved after cutover; no unverified design decision blocks implementation.

### Whole-Plan Consistency Sweep
- Re-read plan.md and both phase files after correction; aligned config ownership, local origin handling and scoped guidance.
- Unresolved contradictions: 0. No behavioral scope added.

### Runtime correction approved by user
- Root `wrangler deploy --dry-run` selected the pre-move baseline bundle through old root `.wrangler/deploy/config.json`. `--cwd apps/console` failed because source and deploy configs have different base paths. Explicit generated-config dry-run selected the current app bundle and preserved all bindings.
- User chose direct generated config over a new metadata-copy mechanism. Propagated to root deploy script, README and both phases. No changed public command names or forwarding.
- Non-blocking review suggestion accepted: `actorAllowed` and `ExistingPaymentRow` stay module-private.

## Delivery result
- [PR #12](https://github.com/AKBuildSprint/nexus-handson/pull/12) targets main and is mergeable; [issue #11](https://github.com/AKBuildSprint/nexus-handson/issues/11) and PR carry `ready to ship stable`.
- Technical self-review posted on PR after matching all 123 changed files through paginated REST; no remaining Critical/Important findings. This does not replace independent maintainer approval.
- CI is **N/A**: PR reports no checks, workflows list is empty, main protection endpoint reports `Branch not protected`. Local verification is not presented as green CI.
- No merge or remote deployment. Phase completion is derived from checked tasks, not duplicated static status fields.

<!-- slug: nexus-capability-layout -->
