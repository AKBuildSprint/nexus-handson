---
phase: 2
title: "Add Nexus identity, membership, and assignment schema"
status: pending
priority: P1
effort: 2d
dependencies: [1]
---

# Phase 2: Add Nexus identity, membership, and assignment schema

## Goal

Add Nexus membership/policy and current Order assignment, plus durable assignment events/command schema needed before Phase 5, while preserving every Store A record and truthful legacy actor. User confirmed separate accounts per Store with no Store picker on 2026-09-12.

Membership decision gate resolved on 2026-09-12: at most one active membership per account, separate login accounts across Stores. Phase 1 runtime/schema proof and implementation authorization remain prerequisites; this product confirmation does not mark any implementation task complete.

## Context Links

- [Plan](./plan.md)
- [Canonical membership and migration contracts](./contracts.md#migration-and-phase-ownership)
- [Auth/schema scout evidence](./reports/research-auth-260912-0224.md)
- `migrations/0001-store-products.sql:3-60`
- `migrations/0004-orders.sql:3-150`
- `packages/orders/src/order-types.ts:14-26`
- `packages/orders/src/transitions/order-transitions.ts:13-29`
- Scenarios S4-03, S4-04, S4-33–S4-36, S4-43

## Overview

- **Priority:** P1.
- **Current status:** Pending.
- **Domain boundary:** create `@nexus/identity`, not a generic shared package. Better Auth owns credentials/sessions only; Nexus owns Store role and permissions.
- **Data policy:** existing bootstrap history remains bootstrap history. New actions use Better Auth user IDs.

## Requirements

### Functional

- Membership fields: `store_id`, `user_id`, `role` (`owner|staff`), `status` (`active|revoked`), timestamps.
- Confirmed baseline: at most one active membership per account. Exactly one resolves private access without a Store picker; zero or multiple active memberships fail closed. Constraints, resolver, fixtures and UI must follow the separate-account-per-Store decision.
- Proposed schema uses `UNIQUE(user_id, store_id)` as the same-Store FK target and an active-only uniqueness constraint on `user_id`; a lifetime `UNIQUE(user_id)` would additionally forbid historical membership in another Store and must not be introduced silently.
- Assignment fields: Store+Order key, assignee user, assigning Owner, timestamps, and a composite FK to the current assignment history event. Store durable event assignee/time in history separately, so replay remains truthful after reassignment.
- Assignment target must be active Staff in the same Store; Owner identities are not assignable.
- Persist each assignment event's Store, Order, assignee, assigning real user and time; replay must retain that event after a later reassignment. Expand history/command action constraints in 0009, not a later migration unavailable to Phase 5.
- Pure evaluator returns allowed/denied for public, Customer, Owner, and assigned Staff actions.

### Non-functional

- Composite foreign keys prevent cross-Store Order assignment.
- Migration is append-only and populated-data safe.
- No role, Store, or actor authority comes from HTTP bodies.

## Architecture

`@nexus/identity` exports explicit modules, no barrel:

- `identity-types.ts`: `StoreRole`, `MembershipStatus`, `IdentityContext`, permission action/resource shapes.
- `permissions.ts`: pure central evaluator for catalog/order/assignment/refund actions.
- `membership-store.ts`: current membership lookup and D1 guard helpers.

Order assignment remains an Orders concern, so assignment SQL and types live in `@nexus/orders`; the identity package supplies membership facts and permission policy.

Audit correction (2026-09-12): this phase owns assignment storage and SQL CHECK expansion, not the TypeScript `assign` command-result/action or `assigned` history unions. Keep those existing unions and readers compiling unchanged until Phase 5 updates the complete result/reader/adapter/Console parser seam. Schema fixtures assert assignment rows directly; they do not require a Phase 5 command API or claim behavioral replay proof.

## File Inventory

| File | Action | Rough change | Test impact |
|---|---|---:|---|
| `/Users/plateau/Project/nexus-handson/migrations/0009-store-memberships.sql` | Create | membership + dependent history graph rebuild | Membership, assignment, durable event/command constraints; payments FKs preserved |
| `/Users/plateau/Project/nexus-handson/packages/identity/package.json` | Create | 12–18 lines | Workspace package |
| `/Users/plateau/Project/nexus-handson/packages/identity/src/identity-types.ts` | Create | 60–100 lines | Shared domain contracts |
| `/Users/plateau/Project/nexus-handson/packages/identity/src/permissions.ts` | Create | 100–160 lines | Central evaluator |
| `/Users/plateau/Project/nexus-handson/packages/identity/src/membership-store.ts` | Create | 80–130 lines | Store-scoped membership lookup/guards |
| `/Users/plateau/Project/nexus-handson/packages/orders/package.json` | Modify | 1 dependency | Orders consumes identity policy |
| `/Users/plateau/Project/nexus-handson/apps/worker/package.json` | Modify | 1 dependency | Worker consumes identity directly |
| `/Users/plateau/Project/nexus-handson/package.json` | Modify | 1 workspace dev dependency | Test/import resolution |
| `/Users/plateau/Project/nexus-handson/package-lock.json` | Modify | generated | Workspace lock |
| `/Users/plateau/Project/nexus-handson/packages/orders/src/order-types.ts` | Modify | Identity context only | Existing result/action/history unions unchanged; assignment envelope belongs to Phase 5 |
| `/Users/plateau/Project/nexus-handson/tests/integration/identity-schema.test.ts` | Create | 180–260 lines | Migration and permission invariants |
| `/Users/plateau/Project/nexus-handson/tests/unit/permissions.test.ts` | Create | 120–180 lines | Pure action matrix |
| `/Users/plateau/Project/nexus-handson/tests/support/catalog-test-env.ts` | Modify | migration9/reset closure | Retains schema4–8 rehearsal entrypoints |
| `/Users/plateau/Project/nexus-handson/tests/support/identity-test-env.ts` | Modify | Store/member fixtures | Real auth users, deterministic membership facts |
| `/Users/plateau/Project/nexus-handson/tests/integration/order-brief-migration.test.ts` | Modify only helper compatibility | existing populated fixture | Preserves schema7 semantics |

## Dependency Map

`Phase 1 auth user IDs -> migration 0009 memberships -> @nexus/identity evaluator -> Phases 3–6`.

Migration 0009 must provide Phase 5 assignment event/ledger support; 0010 later adds Refund decisions while preserving these events. No phase is independently deployable.

## Function and Interface Checklist

- [x] `IdentityContext` distinguishes Console member facts from public/Customer contexts; never authorize a caller by merely trusting a supplied role object.
- [x] `evaluatePermission(context, action, resource)` is total; actions distinguish catalog read/write/import/file/removal, order read/process/assign, Staff listing, Refund submission/decision. Unknown roles/actions deny.
- [x] `resolveActiveMembership(database, userId)` requires exactly one current active row, returns typed Store/member facts or an explicit absent/ambiguous result, and never chooses the first row/default Store.
- [x] Membership predicate helpers expose policy facts to domain SQL without importing Orders. Persistence/evaluator parity tests prove the same Owner/Staff/revoked matrix.
- [x] Assignment schema records current assignee separately from immutable event metadata; leave TypeScript `OrderCommandAction`, result and history unions unchanged until Phase 5.
- [x] Implement SQL support for canonical `assign`/`assigned` branches: nullable `order_history.assignee_user_id`, same-Store membership FK, unchanged event status, existing command `result_history_id`, and current assignment `history_id`. No new command-result table; preserve legacy null target fields and contract1 CHECK branches. Phase 5 owns the runtime envelope/reader/parser together.
- [x] Migration9 adds same-Store Order/member FKs and assignee lookup indexes; durable assignment-event assignee identity has a same-Store composite FK. New user-event branches require a real user, legacy branches retain historical null actors.
- [x] Rebuild history with dependent `order_commands` and `payments`; recreate exact FK/index closure and then any new assignment children. Do not reuse one-per-Order paid/canceled indexes for repeatable assignments.
- [x] `catalogMigrations`, through union/default and reset order include 9; assignments before Orders/memberships/history, payments/commands before history, membership/account/session before users. Legacy `resetCatalogThrough(4|5|6|7|8)` remains usable.

## Scout and Baseline Evidence

Existing related static inventory: `migration-constraints.test.ts` **7**, `order-brief-migration.test.ts` **8**, `order-operations-migration.test.ts` **4**: **19 cases**, none proves new identity behavior. New permission/identity tests: **0**. `migrations/0006-order-brief-contract.sql:39–45` already provides Order composite candidate keys, so membership/assignment creation does not itself require rebuilding Orders; history action expansion does require its FK closure. `migrations/0007-manual-payments.sql:28` is the payment→history dependency. No executed baseline is claimed; re-scout these exact constraints before writing migration9.

## Test Scenario Matrix

| Priority | Scenarios | Test level | Durable invariant |
|---|---|---|---|
| Critical | S4-03, S4-04 | Integration | No membership fallback, reuse, or implicit elevation |
| Critical | S4-33–S4-36 | Migration integration | IDs/FKs/history preserved; cross-Store assignment rejected |
| High | S4-43 | Integration | Actor IDs remain stable after membership status/name changes |
| High | policy matrix | Unit | Only named roles/actions are allowed |

## Tests Before

1. Run the 19 existing migration cases as the unchanged baseline. Create compiling evaluator interfaces, then capture a behavioral Red for each denied caller/action combination; import/type failures are setup failures.
2. From a valid populated schema8 fixture, deliberately assert the missing identity/event schema contract. Add Store A sentinels, Store B, invalid role/status, ambiguous membership defense, Owner-as-assignee, revoked Staff and crossed-Store references. Role/status eligibility tests target guarded domain SQL when not expressible as relational constraints.
3. Assert history and payments are byte-equivalent for protected fields, old actor IDs unchanged, and direct SQL fixtures persist distinct assignment events with their original assignees and result-history references. Runtime replay is a Phase 5 test. Deliberate guard violations must roll back, not merely omit one INSERT.

## Implementation Steps — Green

1. Run the required focused scout for migration constraints and current action names; update this inventory only for source movement.
2. Create the identity package and exact permission vocabulary. Include catalog read/write/import/file actions; order read/process/assign; Refund request/decide; protected removal.
3. Implement a total evaluator: unknown action, unknown role, revoked membership, missing assignment, and missing Customer match all deny.
4. Create migration 0009 with Store/user FKs, explicit membership composite candidate key and the confirmed at-most-one-active-membership rule. Add one-current-assignment-per-Order, same-Store assignee/assigner FKs and `store_id, assignee_user_id, order_id` lookup index.
5. Expand history and command CHECK constraints for assignment and durable assignee metadata now. Stage populated history/commands/payments, rebuild parent then dependent FK/index closure using the real D1-safe migration transaction, and compare preserved rows. Keep contract1/2 compatibility and historical actors. Do not seed credentials/membership in SQL; integration fixtures use real persisted test auth identities.
6. Extend Order context/types to carry authoritative `IdentityContext` rather than role/body fields.
7. Add D1 membership lookup helpers that return one active membership or null. No first-Store/default fallback.
8. Make invalid direct persistence fail through constraints where relationally expressible; keep role/status eligibility in guarded domain SQL.
9. Rehearse raw migrations through root Wrangler with an isolated `--persist-to` directory and run `PRAGMA foreign_key_check`; the test splitter drops PRAGMAs and alone cannot prove runner behavior. Never reset the user's `.wrangler` state. Capture rollback/retry from populated schema8 and verify payments retain exact evidence.

## Refactor

Remove any duplicate action lists introduced during the red phase. Route and UI code will consume evaluator outputs later; they must not grow separate permission switch statements. Keep assignment SQL out of the identity package.

## Tests After

- Test every evaluator action for Owner, assigned Staff, unassigned Staff, revoked member, Customer match/mismatch, and public caller.
- Test duplicate membership, cross-Store assignment, invalid assignee, and repeated migration behavior.
- Verify Store A catalog/order counts and all legacy history actor fields match before/after migration.
- Verify assignment-event FK/index closure, distinct repeated assignment events, recorded assignee survives reassignment, payment→history integrity, and failed migration rollback/retry using both the harness and raw local runner.

## Todo

- [x] Scout current migration and action contracts.
- [x] Write failing permission matrix and populated migration tests.
- [x] Create `@nexus/identity` with explicit modules.
- [x] Add migration 0009 membership, assignment event and command constraints with payments/history rebuild closure under the confirmed separate-account-per-Store policy.
- [x] Extend Order identity context; preserve existing result/action/history types until Phase 5's coordinated update.
- [x] Prove no implicit membership, role elevation, cross-Store assignment, or history rewrite.

## Success Criteria

The evaluator is the sole policy source; membership and assignment rows are Store-safe; existing Store A records are byte-equivalent for protected fields; invalid identities fail closed; no credential or membership is auto-created by login.

## Regression Gate

```sh
npx vitest run tests/unit/permissions.test.ts tests/integration/identity-schema.test.ts
npx vitest run tests/integration/migration-constraints.test.ts tests/integration/order-brief-migration.test.ts tests/integration/order-operations-migration.test.ts
npm run typecheck
```

## Risk Assessment

- **Foreign-key rebuild ordering:** signal is migration failure with populated Orders. Response: rehearse from migrations 1–8 and redesign migration 0009 before any remote application.
- **Policy duplication:** signal is action branching outside evaluator/domain guards. Response: delete duplicate rule and expose evaluator result.
- **Membership cardinality drift:** signal is provisioning or a resolver accepting simultaneous active memberships for one account. Response: reject the conflict and fix constraints/fixtures; use a separate account for the other Store. Do not add a Store picker or account-transfer feature silently.

## Security Considerations

User ID is identity, not authority. Every permission evaluation requires a current active membership and Store-scoped resource. Error contracts must not disclose whether a foreign Store/resource exists.

## Next Steps

Phase 3 uses these tables and types to produce trusted request context. Phases 4–6 must not begin private cutover before that context is available.
