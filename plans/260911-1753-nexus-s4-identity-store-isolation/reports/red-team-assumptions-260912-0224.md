# Red-team assumptions review

Date: 2026-09-12. Scope: plan-document review only for `plans/260911-1753-nexus-s4-identity-store-isolation`; no code, plan, dependency, migration, or test execution changes. This review intentionally ignores ordinary lint/type/build gates and does not treat unimplemented future files as failures.

## Findings

### High - Phase 7 is blocked by a scoped AGENTS rule that the plan only updates after proof

Location: `apps/console/AGENTS.md:7`, `phase-07-role-aware-experience.md:113-125`, `phase-08-migration-rehearsal-and-rollout.md:107-110`, `phase-08-migration-rehearsal-and-rollout.md:202-210`

Failure mode: Phase 7 requires a signed-out/sign-in Console, `auth-client`, `sign-in-screen`, signed-in shell identity, and stale-session clearing. The scoped Console rule still says "Do not add login" and "Console remains an anonymous bootstrap demo." Phase 8 then defers updating `AGENTS.md` until after local proof. A future implementer following repository instructions cannot legally create the Phase 7 proof, because the rule that permits it is scheduled after the proof.

Fix: Move the Console scoped-rule reconciliation into a prerequisite before Phase 7 implementation, or explicitly make Phase 7 update `apps/console/AGENTS.md` after Phases 3-6 server gates and before Console code edits. The updated rule should say S4 replaces the anonymous-demo constraint only for the accepted identity cutover, with no role switcher or Store picker unless the unresolved membership decision changes.

### High - Phase 8 provisioning transport omits the full auth environment contract

Location: `phase-01-start.md:60-69`, `wrangler.jsonc:17-31`, `phase-08-migration-rehearsal-and-rollout.md:74-80`, `phase-08-migration-rehearsal-and-rollout.md:168-178`

Failure mode: Phase 1 defines `createAuth(env)` around `DB`, `CONSOLE_ORIGIN`, and `BETTER_AUTH_SECRET`; current root Wrangler only has `STOREFRONT_ORIGIN`, `FILES`, and `DB`. Phase 8 says the `s4-provisioning` environment repeats DB/FILES with `remote: true`, but it does not make the auth-origin/secret contract an explicit proxy preflight. A provisioning script can obtain remote D1/R2 proxies and still fail at auth creation, or worse, grow an ad hoc secret/origin path that diverges from the Worker runtime contract.

Fix: Add a Phase 8 preflight checklist and test that validates the complete operator `Env` shape before provisioning: `DB`, `FILES`, `CONSOLE_ORIGIN`, `STOREFRONT_ORIGIN` if route code needs it, and `BETTER_AUTH_SECRET` or an explicitly typed secret override passed into the server-only auth factory. The dry run must verify presence and redaction without printing values. Remote apply should block if any required binding/var/secret is absent from the `s4-provisioning` path.

### High - Raw Wrangler migration rehearsal is required but not yet an executable gate

Location: `contracts.md:67-69`, `tests/support/catalog-test-env.ts:62-70`, `phase-08-migration-rehearsal-and-rollout.md:48-50`, `phase-08-migration-rehearsal-and-rollout.md:132-162`, `package.json:30-34`

Failure mode: The plan correctly notes that the test helper strips `PRAGMA` statements and therefore cannot prove raw D1 migration behavior. Phase 8 requires an isolated Wrangler rehearsal, but the listed narrow and broad gates only run Vitest/Playwright/typecheck/build and proposed S4 smoke scripts. `package.json` currently has only S1 fixture/smoke scripts. This leaves a realistic path where helper-based migration tests pass while the actual Wrangler migration runner, `--persist-to` path mapping, PRAGMAs, or FK behavior is never exercised.

Fix: Make raw migration rehearsal a named Phase 8 command/script and acceptance artifact. It should create an isolated persistence directory, apply migrations through root Wrangler against `nexus-s1-468cba-db --local --persist-to <dir>`, use the documented `v3` path when sharing state with `getPlatformProxy`, run `PRAGMA foreign_key_check`, and record the exact command plus redacted pre/post manifest. Keep it separate from the helper-based Vitest migration tests.

### Medium - Membership cardinality is visible but still too easy to implement before resolution

Location: `contracts.md:11`, `contracts.md:93-97`, `phase-02-identity-schema.md:38-40`, `phase-02-identity-schema.md:120-128`, `phase-08-migration-rehearsal-and-rollout.md:89-91`

Failure mode: The plan labels separate login accounts/no Store picker as an unresolved assumption, but Phase 2 still contains concrete schema, resolver, fixture, and UI-dependent implementation steps. If implementation starts before the user decides between one active Store membership per login and multi-Store membership without a picker, migration constraints, `resolveActiveMembership`, fixture identities, session bootstrap shape, and Phase 7 UI tests can all be built around the wrong cardinality. Changing this later is a schema and acceptance rewrite, not a small refactor.

Fix: Promote this to an explicit Phase 2 entry gate: no migration 0009, membership fixtures, `resolveActiveMembership`, Phase 3 session contract, or Phase 7 UI auth state may be implemented until the cardinality decision is recorded. If the team wants to proceed with independent work, limit it to Phase 1 auth runtime proof and pure permission vocabulary that does not encode Store cardinality.

## Scope confirmations

- Confirmed accepted scope is preserved in the plan: assigned-only Staff Orders, Staff read-only Products, and one final Refund Request decision with no S5 money movement.
- The phase 8 operator transport direction is source-supported in broad terms: Cloudflare documents `getPlatformProxy` options including `environment`, `configPath`, `persist`, `remoteBindings`, and `dispose()`, and remote resources require per-binding `remote: true`. Documented support is not a runtime pass.
- Future files, future tests, and NOT RUN scenario rows were not flagged merely for being unimplemented.

Status: DONE_WITH_CONCERNS
Summary: Completed the assumption/scope red-team pass and found four material plan risks: one AGENTS prerequisite cycle, one incomplete operator auth-env contract, one missing raw-Wrangler executable gate, and one membership-cardinality gate that should be hardened before schema work.
Concerns/Blockers: No code/tests were run by design. The membership product decision remains unresolved and should block Phase 2+ implementation.
