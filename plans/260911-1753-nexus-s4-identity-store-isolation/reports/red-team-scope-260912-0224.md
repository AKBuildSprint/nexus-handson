# Red-team scope and contract review

Reviewer: code-reviewer
Lens: Scope & Complexity Critic + Contract Verifier
Date: 2026-09-12
Scope: `plan.md`, `contracts.md`, `acceptance.md`, phases 1-8, and source consumers/config. No runtime/install/test execution.

## Overall assessment

The plan has absorbed the major security and rollout corrections: explicit native auth allowlist, raw Order-header matrix, local origin config, raw-Wrangler populated rehearsal, and operator Env/proxy boundaries are now present. Remaining risk is mostly in consumer coverage and one under-specified command contract. These are fix-before-cook items because they would otherwise surface as broken E2E setup, ambiguous API shapes, or accidental one-off assignment handling.

## Findings

### High: Storefront E2E still has Console-authenticated setup hidden under "Customer journeys"

The phase text names `tests/e2e/storefront-orders.spec.ts` but scopes Phase 7 ownership to "terminal decision/mobile Customer journeys" (`phase-07-role-aware-experience.md:111`) and Phase 8 to "public Store A and Customer terminal decision continuity" (`phase-08-migration-rehearsal-and-rollout.md:117`). The actual file is not only Customer/public. It creates Products through Console pages (`tests/e2e/storefront-orders.spec.ts:47-53`, `tests/e2e/storefront-orders.spec.ts:91-104`), directly posts Console Order mutations through `page.request` without session cookies or Origin (`tests/e2e/storefront-orders.spec.ts:57-80`), edits Console Products mid-test (`tests/e2e/storefront-orders.spec.ts:315-345`), and drives Console Order actions inside the combined Storefront test (`tests/e2e/storefront-orders.spec.ts:610-640`).

Impact: S4 can correctly protect Console and still break Storefront E2E setup/public-continuity evidence because these hidden Console setup calls will start returning unauthenticated/origin errors. Worse, a quick fix may add broad test bypasses that undermine the same-origin/session contract.

Required correction: make `tests/e2e/storefront-orders.spec.ts` an explicit Phase 7 consumer for Owner-authenticated Console setup and exact-Origin API helpers, not just a Customer terminal-state consumer. The reusable `console-auth-fixtures.ts` should cover Console page login, setup Product creation, and direct `page.request` mutations with safe credential/trace handling.

### High: Assignment command persistence is specified, but its returned contract is not

`contracts.md` gives assignment a bespoke HTTP response of `reference`, recorded assignee, and event time (`contracts.md:24`), while Phase 5 says assignment is an Order command whose command result points to a durable event (`phase-05-assigned-order-access.md:62`, `phase-05-assigned-order-access.md:89`). The current command system is built around `OrderCommandResult` with an Order status, optional payment ID, and optional refund projection (`packages/orders/src/order-types.ts:63-70`), and `order_commands` requires `result_history_id` with action limited to current Order state actions (`migrations/0006-order-brief-contract.sql:310-339`).

Impact: implementers have two incompatible paths: force assignment into the existing status-shaped command result, or invent an endpoint-only result that bypasses shared replay/recovery. Either choice can duplicate idempotency code or make assignment replays inconsistent with the promised command ledger semantics.

Required correction: define the assignment result type and persistence shape before implementation. Either extend the command-result reader/envelope with an explicit assignment projection, or document that assignment uses a separate assignment-command result table/reader while still sharing idempotency checks. Include the exact migration fields and API/client type updates in Phase 2/5/7.

### Medium: Phase 7 E2E auth fixture owns a local binding proxy but package/script ownership is split with Phase 8

Phase 7 proposes `tests/support/console-auth-fixtures.ts` provisioning through Phase 1 helper and local `getPlatformProxy`, independent of Phase 8 (`phase-07-role-aware-experience.md:115`, `phase-07-role-aware-experience.md:129`). Phase 8 separately owns named rehearsal/provision scripts and root `package.json` updates (`phase-08-migration-rehearsal-and-rollout.md:118`, `phase-08-migration-rehearsal-and-rollout.md:174`, `phase-08-migration-rehearsal-and-rollout.md:178-180`). Source today has only broad scripts and no S4-specific auth/proxy helper (`package.json:10-34`), while Playwright starts normal Console/Storefront servers (`playwright.config.ts:74-87`) and Console Vite hardcodes the default `.wrangler/state` persistence (`apps/console/vite.config.ts:53-55`).

Impact: local auth E2E can end up with two independent provisioning/proxy implementations or two different persisted D1 states: one from Playwright's server, one from the proxy fixture. That yields false failures or, worse, tests passing against an empty/different database while the browser uses another.

Required correction: assign the local E2E proxy/persistence contract to one phase with one helper module and one path variable. Phase 7 can own it, but then Phase 8 should explicitly reuse the same low-level helper for local state identity checks rather than adding a parallel implementation. Add a Phase 7 success criterion that a proxy-written sentinel is read by the browser-served Worker before any auth E2E proceeds.

## Non-findings

- The native auth allowlist is now reflected in `contracts.md` and Phase 3; do not reopen broad `/api/auth/*` routing unless a concrete client requirement appears.
- The plan correctly preserves the requested product scope: assigned-only Staff, Staff read-only Products, one final Refund Request per Order, and no S5 money movement.

## Recommended actions

1. Update Phase 7 inventory and gates for `tests/e2e/storefront-orders.spec.ts` as a Console-authenticated setup consumer.
2. Add an explicit assignment command result contract spanning migration, domain reader, HTTP response, and Console client types.
3. Consolidate Phase 7 local proxy/provisioning and Phase 8 rehearsal helper ownership so they cannot target different local D1 state.

Status: DONE_WITH_CONCERNS
Summary: Three residual consumer/contract risks remain after the latest plan corrections. They are fixable in the plan before implementation and do not require cutting requested S4 scope.
Concerns/Blockers: None blocking this review; block implementation handoff until these contract edits are reconciled.
