---
phase: 8
title: "Rehearse populated migration, isolation, and rollout"
status: pending
priority: P1
effort: 2.5d
dependencies: [1, 2, 3, 4, 5, 6, 7]
---

# Phase 8: Rehearse populated migration, isolation, and rollout

## Goal

Prove S4 end-to-end against a populated Store A clone plus Store B isolation fixtures, produce secret-safe provisioning and rollout runbooks, reconcile current-state docs only after local proof, and fail closed on remote prerequisites. This phase prepares remote execution; it does not authorize remote mutation.

## Current Evidence

- `contracts.md` is canonical for S4 endpoints, CSRF/origin, atomicity, migration ownership, TDD rules, Node/runtime baseline, and performance measurement.
- `acceptance.md` owns the 49 scenario-to-evidence allocation and links the completed local evidence. Phase 8 consumes it instead of creating a duplicate scenario ledger.
- Current README says Console Order actions are anonymous bootstrap demo and S4 owns membership/evaluator: `README.md:33`. Accepted public risk still says Console catalog and Order routes are anonymous demos: `README.md:193`.
- Existing remote deployment sequence requires exact resources/origins and forbids guessed worker hostnames: `README.md:104`, `README.md:122`, `README.md:137`.
- Existing remote smoke/fixtures are S1 catalog-focused, not S4 auth provisioning: `README.md:143`, `tests/integration/remote-contract-smoke.ts:31`, request capture at `tests/integration/remote-contract-smoke.ts:80`, and run guard at `tests/integration/remote-contract-smoke.ts:480`.
- Existing fixture manifest is intentionally private and path-pinned under the old S1 evidence directory: `scripts/verification/verification-fixtures.ts:11`, `scripts/verification/verification-fixtures.ts:129`.
- Existing package scripts expose broad gates and remote smoke but no S4 provisioning/rehearsal scripts: `package.json:10`.
- Current bindings: root Worker `nexus-s1-468cba`, DB `nexus-s1-468cba-db`, R2 `nexus-s1-468cba-private` in `wrangler.jsonc:3`, `wrangler.jsonc:20`, `wrangler.jsonc:26`; Storefront worker name is supplied by deploy command in `apps/storefront/wrangler.jsonc:3`; resource identities match in `resource-identities.json:2`.
- Existing migrations are `0001` through `0007`; proposed S4 ownership from `contracts.md` is `0008` Better Auth DDL, `0009` memberships/assignment plus history/command CHECK expansion needed before Phase 5, and `0010` Refund decisions/finality. Applied migrations must not be rewritten.

## Existing Test Inventory

Lexical count on 2026-09-12: 38 test/spec files, 212 `it`/`test` calls total:

- Unit: 10 files, 31 tests.
- Integration: 19 files, 106 tests.
- Browser: 4 files, 48 tests.
- E2E: 5 files, 27 tests.

Phase 8 relevant current consumers:

- Populated migration patterns: `tests/integration/order-brief-migration.test.ts`, `tests/integration/order-operations-migration.test.ts`, `tests/integration/migration-constraints.test.ts`.
- D1/R2 atomicity/failure patterns: `tests/integration/order-commands.test.ts`, `tests/integration/order-operations-routes.test.ts`, `tests/integration/delivery-replacement.test.ts`.
- Two-origin browser run ownership: `playwright.config.ts:29` starts Console/API and Storefront; projects are split at `playwright.config.ts:40`.
- Remote smoke currently writes public sanitized evidence and private fixture manifest entries for catalog resources only: `tests/integration/remote-contract-smoke.ts:123`, `tests/integration/remote-contract-smoke.ts:247`, `tests/integration/remote-contract-smoke.ts:313`.

## Requirements

### Functional

- Build a deterministic populated schema7 fixture with Store A `store_nexus`: Products, Variants, Customers, Orders, command ledger, history, payments, pending Refund requests, legacy paid Orders without payment evidence, Customer capabilities and retained R2 associations. A separate intermediate schema9 fixture adds Phase 5 assignment history/commands before proving preservation through migration0010; do not seed S4 tables into a pre-S4 schema.
- Apply new S4 append-only migrations locally and compare protected pre/post manifests: IDs, counts, foreign keys, snapshots, hashes/digests, payment evidence gaps, historical actor provenance, command rows, capabilities, assignment events, terminal Refund fields, and object-key associations.
- Rehearse raw new migrations through an isolated Wrangler local database in addition to helper-based migration tests, because `contracts.md` notes helper splitting strips PRAGMA statements.
- Provision Owner A, Staff A1, Staff A2, Owner B, Staff B, Store B catalog/orders, assignments, and terminal Refund fixtures through non-public operator tooling only.
- Run Store B crossed-resource, assigned-only Staff, Owner-only actions, Customer capability, public Storefront, stale-session, CSRF/origin, and decision race acceptance flows.
- Produce a remote runbook with checkpoint, writer barrier, migration, secret provisioning, deploy, smoke, abort, and rollback/restore choices.

### Non-functional

- No raw passwords, session cookies, raw capabilities, private Order URLs, private object keys, or secret values in git, argv logs, public evidence, screenshots, test traces, or plan reports.
- Provisioning is dry-run-first and repeat-safe: exact rerun is no-op; conflicting existing identity/store/role fails without password reset or account repurposing.
- No public provisioning endpoint. No remote default target. No implicit production/remote mutation.
- Host during planning is Node 24.20.0, but implementation verification must run under project-required Node 22 and record the exact version. No dependency/runtime baseline is claimed now.
- Documentation updates after local gates describe the checked-out S4 implementation. Preserve a separately labeled deployed-state warning until authorized remote cutover and authenticated smoke prove the public surface changed; local success cannot establish remote auth.

## Test Scenario Matrix

| Severity | Scenario IDs | Boundary and expected observation |
|---|---|---|
| Critical | S4-28, S4-33, S4-34 | Raw migration/drained checkpoint: protected graph and legacy provenance preserved |
| Critical | S4-29–S4-32, S4-35, S4-36, S4-49 | Real D1/R2/auth acceptance: no cross-Store/unassigned effect or disclosure |
| Critical | S4-41, S4-42, S4-44, S4-48 | Safe projections/artifacts and retained purchased objects |
| High | S4-01, S4-15, S4-16, S4-37, S4-40, S4-43, S4-47 | Existing Owner data, benchmark, lifecycle, truthful decision/evidence gaps |
| Medium | S4-06, S4-21 | Phase7 browser observations included in final acceptance record |

## Data Flow

1. Rehearsal script creates or imports a local isolated pre-S4 D1/R2 state.
2. Manifest capture reads authoritative D1 rows and R2 associations, then writes redacted local evidence.
3. Migration runner applies only append-only S4 migrations.
4. Manifest comparison verifies Store A preservation and new auth/membership/assignment/refund-decision constraints.
5. Operator provisioning script receives target, environment, and secrets through stdin/env/Wrangler secret binding, never URL or public HTTP.
6. Provisioner calls server-only auth creation plus Nexus domain membership/fixture commands against the selected binding/transport. It must not pretend a remote D1 HTTP handle is a local `D1Database`.
7. Acceptance tests sign in through the actual app, exercise Store A/B/Customer/public paths, and write redacted evidence against the ownership map in `acceptance.md`.
8. Remote runbook repeats the same sequence only after explicit authorization and exact resource/origin confirmation, using the Wrangler binding-proxy transport below. No provisioning HTTP endpoint or separately deployed admin Worker is needed.

## Architecture: operator transport

Use the pinned Wrangler package's Node-only `getPlatformProxy` to obtain real binding proxies for the existing server-only provisioning/domain functions; do not implement a D1 REST adapter. Dry-run validates inputs/config without creating the proxy or contacting Cloudflare. Local apply uses root config, `remoteBindings: false`, and an explicit isolated persistence path. The raw-migration runner uses that same path with Wrangler's documented `v3` suffix convention. Prove shared state with a non-secret run sentinel and populated Order/history/payment/Refund graph: write through the proxy and read through Wrangler before migration, then reverse-read after raw migration. Repeat with an intermediate schema9 assignment event. Record the normalized persist paths, local DB identity, migration entries and FK-check result; an empty/different database is a failed rehearsal. Workerd test-pool memory fixtures are separate evidence and cannot stand in for this raw-runner populated graph.

For separately authorized remote apply, a named `s4-provisioning` environment in the **root** `wrangler.jsonc` repeats the exact existing DB/FILES binding identities with `remote: true`; root/default development bindings remain local. Require exact target/account/resource confirmation before `getPlatformProxy({configPath:'wrangler.jsonc',environment:'s4-provisioning',remoteBindings:true})`. Never deploy that environment. Supply auth inputs through stdin/secret facilities, and call `dispose()` in `finally` to stop the owned workerd/proxy connection. Verify the pinned API and local hash/provision/sign-in round-trip before remote use; a mismatch blocks remote execution, not a fallback to public administration.

Operator preflight constructs the typed auth environment explicitly: DB proxy, FILES proxy when fixtures need files, exact `CONSOLE_ORIGIN`, and runtime-only `BETTER_AUTH_SECRET`; add `STOREFRONT_ORIGIN` only for callers requiring the full Worker environment. Named Wrangler environments do not implicitly inherit all vars/secrets. Validate presence/config without printing secrets before creating auth or writing credentials. Dry-run missing-secret/config tests must make zero proxy/network/write calls.

Reuse Phase 7 `scripts/verification/local-binding-context.ts` for every local proxy/path/disposal operation. CLI `--persist-to` resolves to its explicit `persistRoot`; E2E passes `NEXUS_TEST_PERSIST_ROOT` to the same contract. Phase 8 adds graph manifests and raw-CLI cross-reads, not a second persistence/provisioning transport implementation. The low-level helper stays schema-independent; Phase 1 owns credential creation and Phase 8 owns operator preflight and separately authorized remote selection.

Source: [Wrangler API](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy) and [remote bindings](https://developers.cloudflare.com/changelog/post/2025-09-16-remote-bindings-ga/), inspected 2026-09-12. Documented support is not a runtime pass.

## Interface and Dependency Checklist

Audit correction (2026-09-12, runner boundary): raw Wrangler/proxy/filesystem/operator tests run in Node, not the default workerd pool. Create standalone `vitest.node.config.ts` with Node environment and `tests/node/**/*.test.ts` only; do not import/merge the Workers/browser config or load its plugins. Keep domain acceptance under the existing `vitest.config.ts`. Node tests use real local binding proxies for D1/R2 and must not import `cloudflare:test` or the workerd-only `catalog-test-env.ts`; share only pure fixture data/builders. Prove correct runner and nonzero discovery before recording behavioral Red. Reuse Phase 7's local helper and dispose all owned proxies/processes.

- [x] Phase 1 has proven selected Better Auth package/version in Workers runtime; Phase 8 must not claim runtime compatibility before that evidence exists.
- [x] Phase 2/0009 owns memberships, assignment, assignment history/commands, and payment FK closure before Phase 5; Phase 8 rehearses and verifies.
- [x] Phase 3 owns session/auth endpoints, exact-Origin mutation policy, and CSRF behavior; Phase 8 tests them.
- [x] Phases 4-6 own server enforcement for Product, Order, assignment, and Refund decisions; Phase 8 acceptance verifies all private path families.
- [x] Phase 7 owns browser UI/session clearing; Phase 8 runs real two-origin flows and mobile checks.
- [x] Local and remote scripts must resolve resources through `resource-identities.json`, root `wrangler.jsonc`, and authenticated Wrangler inspection before remote mutation.
- [x] Existing `verification-fixtures.ts` is S1-path-pinned; either create S4-specific private fixture tooling or generalize the path intentionally with tests.
- [x] Verify the confirmed separate-account-per-Store policy in provisioning/fixtures: distinct accounts across A/B, at most one active membership each, no implicit login repurposing or Store picker. Preserve revoked membership history and exact-rerun no-op behavior.

## File Inventory

| File | Existing / proposed | Action | Ownership |
|---|---|---|---|
| `scripts/provision-s4-identities.ts` | Proposed | Create dry-run-first, secret-safe local/remote operator provisioning | Phase 8 only |
| `scripts/verification/s4-populated-rehearsal.ts` | Proposed | Create pre/post manifest, migration, FK, R2 association proof | Phase 8 only |
| `scripts/verification/s4-private-fixtures.ts` | Proposed | Prefer S4-specific private manifest path over reusing S1 path-pinned helper | Phase 8 only |
| `scripts/verification/local-binding-context.ts` | Proposed in Phase 7 | Reuse validated local root/v3 mapping and proxy lifecycle; extend tests if needed, no duplicate helper | Phase 8 consumes |
| `scripts/verification/s4-remote-smoke.ts` | Proposed | Implement the named dry-run-first authenticated smoke command with sanitized evidence | Phase 8 only |
| `tests/fixtures/s4-populated-store.ts` | Proposed | Deterministic Store A/B graph for integration/E2E setup | Phase 8 only |
| `tests/node/s4-populated-rehearsal.test.ts` | Proposed | Node-runner raw migration/provisioning/redaction/failure tests | Phase 8 only |
| `vitest.node.config.ts` | Proposed | Standalone Node environment, tests/node include only, no Workers/browser plugin | Phase 8 only |
| `tsconfig.json` | Existing | Include new Node config in root typecheck; preserve current app/Worker coverage | Phase 8 only |
| `tests/integration/s4-acceptance.test.ts` | Proposed | Cross-store/assignment/decision/capability acceptance matrix | Phase 8 only |
| `tests/e2e/console-auth.spec.ts` | Proposed in Phase 7 | Extend to full Owner/Staff/Store B smoke | Phase 8 coordinates |
| `tests/e2e/console-orders.spec.ts:142` | Existing | Extend with role/assignment/decision journey after Phase 7 | Phase 8 coordinates |
| `tests/e2e/storefront-orders.spec.ts:306` | Existing | Extend with public Store A and Customer terminal decision continuity | Phase 8 coordinates |
| `package.json:10` | Existing | Register named S4 scripts plus `verification:s4-rehearsal:test` invoking the Node config/file; test CLI contracts | Phase 8 only |
| `wrangler.jsonc` | Existing | Add explicit operator-only remote-binding environment; keep root local defaults and resource identities | Phase 8 only |
| `README.md:33`, `README.md:193` | Existing | Update current-state claims only after local S4 gates pass | Phase 8 only |
| `docs/design-guidelines.md` | Existing | Reconcile obsolete auth exclusions only after UI proof | Phase 8 only |
| `AGENTS.md`, `apps/console/AGENTS.md` | Existing | Remove anonymous-demo rule only after proof | Phase 8 only |
| `plans/260911-1753-nexus-s4-identity-store-isolation/reports/remote-runbook.md` | Proposed | Write executable but unexecuted runbook with placeholders/stop conditions | Phase 8 only |

## Red -> Green -> Refactor Gates

1. **Tests Before — populated characterization:** establish the standalone Node runner, then add `tests/node/s4-populated-rehearsal.test.ts` that seeds a pre-S4 graph through the real local proxy, captures manifest, invokes raw Wrangler migrations, and expects Store A protected fields unchanged. Use the explicit Node config below; worker-pool setup errors and missing discovery are not Red. Phases 1–6 already supply the schema; these acceptance assertions may pass immediately and must not be made artificially Red. New rehearsal-tool behavior (missing protected-field comparison, wrong isolation path or failure recovery) supplies the behavioral Red for this phase.
2. **GREEN migration proof:** implement rehearsal script and fixture helpers; compare Store A IDs, references, snapshots, actor provenance, command/capability digests, payment gaps, assignment events, and R2 associations.
3. **RED provisioning:** add Node-runner tests for dry-run output, exact rerun no-op, conflicting identity fail, partial credential-success/membership-failure recovery, and redaction.
   - Expected first failure: `expected exit code 0 for dry-run` or `expected output not to contain secret`, not missing `tsx`.
4. **GREEN provisioning:** implement server-only provisioner. Inputs: explicit `--target local|remote`, expected resource identity, dry-run default, credential values through stdin/env/secret binding, no public route.
5. **RED acceptance matrix:** add integration tests for Store B crossed IDs/slugs/references/import/file paths, Staff assigned-only summaries/detail/actions, Owner-only decisions, Customer capability separation, and CSRF/origin denials.
   - Expected result after Phases 3–6: denial/no disclosure. If already green, record characterization; if it fails, fix the owning phase rather than claim Phase 8 introduces authorization for the first time.
6. **GREEN acceptance:** wire tests to implemented Phases 3-6 and update the evidence records referenced by `acceptance.md` for Critical/High S4 rows; do not create a competing scenario ledger.
7. **RED remote smoke design:** add dry-run validation for S4 remote smoke requiring exact API origin, Storefront origin, fixture manifest, pre-provisioned credentials by reference only, and auth-capable private evidence redaction.
   - Expected first failure after the tool is callable: assertion that dry-run makes no requests/writes or rejects an ambiguous target fails. Missing tool/module/config is setup failure, not behavioral Red.
8. **GREEN remote smoke/runbook:** create authenticated smoke runner or runbook that logs in, exercises Owner/Staff/Customer/public flows, and redacts credentials/cookies/capabilities. Keep it dry-run by default.
9. **Refactor:** remove throwaway fixture dumps, keep reusable helpers, and avoid broad `npm run test:integration -- <file>` in phase-level validation commands.

## Tests After

Rerun the same dry-run/repeat/conflict/redaction/isolation-path tests after Refactor. Then run populated raw migrations and complete cross-layer acceptance as regression gates; do not fabricate a missing-feature Red for behavior already delivered in earlier phases.

## Narrow Regression Commands

Use exact files during development:

```sh
npx vitest run --config vitest.node.config.ts tests/node/s4-populated-rehearsal.test.ts
npx vitest run tests/integration/s4-acceptance.test.ts
npx vitest run --config vitest.browser.config.ts tests/browser/console-auth-contracts.test.ts tests/browser/console-orders-contracts.test.ts tests/browser/storefront-orders-contracts.test.ts
npx playwright test tests/e2e/console-auth.spec.ts tests/e2e/console-orders.spec.ts tests/e2e/storefront-orders.spec.ts
npm run typecheck
```

Only after targeted gates are green under Node 22:

```sh
npm run test:unit
npm run verification:s4-rehearsal:test
npm run test:integration
npm run test:browser
npm run test:e2e
npm run build:console
VITE_STOREFRONT_API_BASE_URL=http://127.0.0.1:5173 npm run build:storefront
```

Remote dry-run only, no mutation:

```sh
npm run verification:s4-fixtures -- init --fixture-manifest "$PRIVATE_S4_FIXTURES" --prefix "$PREFIX" --base-url "$EXACT_API_ORIGIN"
npm run verification:s4-remote:smoke -- run --fixture-manifest "$PRIVATE_S4_FIXTURES" --prefix "$PREFIX" --api-origin "$EXACT_API_ORIGIN" --storefront-origin "$EXACT_STOREFRONT_ORIGIN" --dry-run
```

Those S4 script names are proposed; adding them requires package.json updates and tests in this phase.

### Named raw-migration gate

Add proposed root script `verification:s4-rehearsal` for `scripts/verification/s4-populated-rehearsal.ts`. Run `npm run verification:s4-rehearsal -- --persist-to "$S4_REHEARSAL_DIR" --baseline-root "$S4_BASELINE_ROOT"` with validated absolute paths to newly created isolated state and a disposable pre-S4 checkout. Pin the baseline commit in the execution report; current inspected baseline is `a3a67f6`, not a forever-coded constant.

Before the populated CLI gate, run proposed `npm run verification:s4-rehearsal:test`, defined as `vitest run --config vitest.node.config.ts tests/node/s4-populated-rehearsal.test.ts`. Both the Node orchestration tests and the populated raw-CLI run are required; a green workerd acceptance suite does not substitute for either. The standalone config is included in root `tsconfig.json`; no change to the default workerd suite's include/plugin is required.

The script uses the baseline checkout's root Wrangler config/migrations to run genuine `wrangler d1 migrations apply nexus-s1-468cba-db --local --persist-to <path>` through schema7, then seeds the representative graph through a proxy with `<path>/v3`. It runs the same migrations-apply command from the implementation checkout's root config against that identical state to apply8–10. This preserves the actual `d1_migrations` bookkeeping without editing applied SQL, inventing a `--through` Wrangler flag, or introducing a second migrations owner. Read the sentinel and full pre/post manifest through both proxy and raw CLI, run raw `PRAGMA foreign_key_check`, and capture migration entries. Intermediate9→10 preservation is also tested with the Phase6 fixture/rebuild gate. Dispose proxies and remove only owned disposable checkout/state after evidence and recovery checks. A missing/split sentinel or wrong applied-version history fails this named gate.

## Performance Measurement

Use the S4-15 fixture from `contracts.md`: 10,000 Orders, 200 assigned, page size 25, 20 warmed samples for list/search/summary separately. Capture Node version, runtime, dataset, query, p95, D1 rows-read/query plan, and Owner comparison. Target local p95 under 1s and Staff <=1.25x Owner, but keep timing out of permanent CI correctness assertions. Correctness tests assert scope/counts and index use; timing is recorded evidence with diagnosis if missed.

## Remote Runbook Design

Remote execution is blocked unless all prerequisites are true:

- Authenticated Wrangler account and exact resource list captured with `npx wrangler whoami`, `npx wrangler d1 list`, and `npx wrangler r2 bucket list`.
- Exact API/Console and Storefront HTTPS origins captured from deploy output or existing verified state; no constructed `workers.dev` hostname.
- Authorized D1 checkpoint/export captured after all D1/R2 mutation entrypoints are quiescent and drained; an export during active writes is not the rollback checkpoint.
- Old anonymous writer is stopped or provably barred before S4 schema mutation and kept barred through migration/provisioning/deploy/smoke.
- Better Auth secret/session config is installed through Wrangler secrets or runtime-only input, not committed or passed in public argv.
- Provisioning dry-run is reviewed, then real provisioning is separately authorized.
- Smoke evidence writes redacted public observations and private fixture manifest entries only.

Abort rules:

- If exact resource/origin identity is absent or ambiguous, stop before mutation.
- If writer barrier cannot be proven, stop before migration.
- If migration/provisioning fails, do not restart anonymous incompatible code against mutated schema. Choose explicit forward-fix or checkpoint restore with a compatible artifact.
- If smoke sees credential/capability/object-key leakage, stop, rotate/revoke affected secrets, remove unsafe private artifacts, and re-run from a fresh checkpoint.

## Rollback

- Local rehearsal rollback: discard isolated local D1/R2 state and rerun from seed; never edit applied migrations.
- Remote rollback: restore the authorized checkpoint only under an explicitly chosen compatible artifact. Do not roll back to the pre-S4 anonymous writer after S4-only schema/data exists.
- Documentation rollback: if proof is incomplete, keep README/AGENTS anonymous-demo warnings rather than claiming S4 current state.
- Provisioning rollback: disable/revoke generated accounts or memberships through explicit operator commands; never delete historical Store A data to clean failed provisioning.

## Risk Assessment

- **High x High: mixed writer cutover corrupts populated data.** Mitigation: writer barrier, abort deadline, checkpoint, and no anonymous rollback after S4 mutation.
- **High x High: secret/capability leakage.** Mitigation: stdin/env/secret binding, redacted evidence serializers, no raw private URLs in traces/screenshots/logs, rotate on leak.
- **High x Medium: false remote confidence from S1 smoke.** Mitigation: S4-authenticated smoke is separate; existing `verification:remote:smoke` remains catalog evidence only.
- **Medium x High: Better Auth runtime drift.** Mitigation: Phase 1 runtime proof is a prerequisite; Phase 8 blocks if it is absent or stale.
- **Medium x Medium: docs overclaim current auth.** Mitigation: update docs only after local proof and cite exact gates.

## Success Criteria

- Populated Store A pre/post manifest proves preservation of IDs, snapshots, payments, capabilities, command/history provenance, assignment events, Refund requests/decisions, and R2 associations.
- Store B isolation and Staff assigned-only boundaries are proven across API, browser, and public/Customer surfaces.
- Provisioning is secret-safe, dry-run-first, repeat-safe, and not exposed over public HTTP.
- `acceptance.md` scenario rows for all Critical/High cases have real boundary evidence, and both Medium rows have their visual observations. A documented blocker is honest reporting but cannot count as a passing acceptance criterion or phase completion.
- Full local gates pass under Node 22 after targeted gates, including standalone Node orchestration tests, populated raw-CLI rehearsal and separate workerd acceptance.
- Remote runbook records stop-safe future procedure. Remote migration stays blocked until remote provisioning and authenticated smoke apply are implemented, reviewed, and separately authorized for a concrete target.
- README/design/AGENTS describe checked-out S4 behavior after local proof while explicitly retaining deployed-state uncertainty/anonymous risk until remote smoke. Never assert an external deployment was updated from local tests. The user's later approval to implement this S4 plan authorizes its scoped login cutover despite historical no-login instructions; that does not authorize remote changes.
