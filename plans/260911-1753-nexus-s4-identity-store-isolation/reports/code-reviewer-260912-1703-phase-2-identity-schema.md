## Code Review Summary

### Scope

- Files reviewed: `migrations/0009-store-memberships.sql`, `packages/identity/src/identity-types.ts`, `packages/identity/src/permissions.ts`, `packages/identity/src/membership-store.ts`, `packages/orders/src/order-types.ts`, `tests/unit/permissions.test.ts`, `tests/integration/identity-schema.test.ts`, `tests/support/catalog-test-env.ts`, `tests/support/identity-test-env.ts`, relevant package manifests and Order callers.
- Focus: Phase 2 identity schema and policy implementation against `plans/260911-1753-nexus-s4-identity-store-isolation/phase-02-identity-schema.md`.
- Score: 8.4/10
- Critical count: 0
- Auto-mode verdict: APPROVE_WITH_WARNINGS. No critical blockers found, but the score is below the 9.5 auto-approve threshold.

### Overall Assessment

Phase 2 is substantially implemented and follows the accepted phase boundary. The new `@nexus/identity` package is narrow and domain-named, the Order package consumes only identity types, and TypeScript assignment command/result/history unions remain unchanged for Phase 5. Migration 0009 is append-only, rebuilds the dependent history/command/payment closure, preserves legacy rows, adds membership cardinality, records assignment event metadata, and adds current-assignment constraints with same-Store FKs. No public provisioning or membership route was introduced.

Fresh review verification:

- `node -v`: `v24.20.0`
- `npx vitest run tests/unit/permissions.test.ts tests/integration/identity-schema.test.ts`: 10/10 passed.
- `npx vitest run tests/integration/migration-constraints.test.ts tests/integration/order-brief-migration.test.ts tests/integration/order-operations-migration.test.ts`: 19/19 passed. The expected interrupted-migration path printed a Miniflare rollback warning while still exiting 0.
- `npx vitest run tests/integration/order-commands.test.ts tests/integration/orders-persistence.test.ts tests/integration/order-operations-routes.test.ts`: 40/40 passed.
- `npm run typecheck`: exited 0.
- Raw local Wrangler: `npx wrangler d1 migrations apply nexus-s1-468cba-db --local --persist-to /tmp/nexus-s4-phase2-review.2WfwqP` applied migrations 0001-0009 with Wrangler 4.126.0; reapply reported "No migrations to apply"; querying the same sqlite DB showed migrations 0001-0009, Phase 2 tables present, and `PRAGMA foreign_key_check` returned no rows.
- Controller-supplied evidence also includes Node 22.23.2 focused Phase 2/typecheck pass and populated 1-8 -> 9 raw Wrangler preservation.

### Critical Issues

None found.

### High Priority

1. `packages/identity/src/permissions.ts:38-41` treats any active non-owner console role as Staff. The plan explicitly requires unknown roles/actions to deny, but the implementation checks `context.role === 'owner'` and then falls through to Staff permissions. Today `store_memberships.role` constrains persisted rows to `owner|staff`, so this is not immediately exploitable through the current resolver. It is still a trust-boundary bug in the policy primitive: a malformed context or future role could receive `catalog:read`, `catalog:file:read`, and assigned Order permissions. Fix by adding an explicit `if (context.role === 'staff') ...; return false;` branch and a unit test using an intentionally malformed role object.

### Medium Priority

1. `tests/integration/identity-schema.test.ts:257-271` proves invalid owner/revoked assignees are rejected by `order_assignments`, but first inserts invalid `assigned` rows into `order_history`. Migration 0009 allows those rows because `order_history_assignee_membership_fk` only checks same-Store membership, not role/status (`migrations/0009-store-memberships.sql:51-52`, `80-88`). This matches the stated split if Phase 5 always writes event + current assignment in one failing D1 batch, but the test currently does not assert rollback/no stray event for invalid attempts. Add a Phase 2 or Phase 5 guard test proving the failed assignment batch leaves no invalid `assigned` history or `assign` command result behind; if isolated invalid assignment history should be impossible, add insert/update triggers on `order_history` for `action='assigned'`.

### Low Priority

1. `packages/orders/src/order-types.ts:197` places the `IdentityContext` type import after declarations. It compiles and is valid module syntax, but this file otherwise keeps imports at the top. Move it to the top when next touching the file.

### Spec Compliance

- Membership fields and status/role checks: PASS. `store_memberships` has `store_id`, `user_id`, role/status, timestamps, `revoked_at`, FK to `stores` and Better Auth `"user"`.
- At most one active membership per account: PASS. `store_memberships_one_active_user` is a partial unique index on active `user_id`; revoked history in another Store remains valid.
- Resolver cardinality: PASS. `resolveActiveMembership` reads active rows with `LIMIT 2` and returns absent/resolved/ambiguous without choosing a default Store.
- Assignment graph: PASS WITH WARNING. Current assignment has Store+Order, assignee, assigning Owner, timestamps and exact history event reference. Current-assignment triggers enforce active Staff and active Owner; isolated history/command rows still need Phase 5 batch rollback proof.
- Pure evaluator: PASS WITH WARNING. Declared action matrix covers Owner, Staff, Customer and public contexts, but unknown roles should deny explicitly.
- Phase ownership: PASS. Existing Order command/action/history/result TypeScript unions are preserved for Phase 5. Runtime assignment route/API was not added.
- Migration preservation/FK closure: PASS. Harness tests, raw Wrangler apply/reapply, and FK checks passed.
- Compatibility: PASS. Existing migration and Order route/domain regressions passed; shared migration helper preserves through 4/5/6/7/8 and defaults to 9.

### Edge Cases Found

- No public provisioning route or `/api/auth/*` Worker dispatch was introduced in Phase 2.
- Storefront contexts now carry public/customer `IdentityContext`, while anonymous bootstrap Console still uses `identity: null`; this preserves existing anonymous-demo behavior until Phase 3 cuts over private routing.
- The active membership resolver has a defensive ambiguous branch even though the DB constraint should normally prevent it.
- Current-assignment table triggers cover active Owner/Staff at insert and update time, including matching event actor/assignee/timestamp.

### Recommended Actions

1. Fix unknown role fallback in `evaluatePermission` before Phase 3 consumes the evaluator at the Worker boundary.
2. Add a rollback/no-stray-event assertion for failed assignment attempts before implementing Phase 5 command writes.
3. Keep the raw Wrangler populated-preservation evidence attached to Phase 2/8 records; helper-based migration tests alone are not sufficient.

### Metrics

- Type Coverage: `tsc --noEmit` passed.
- Test Coverage: focused review reran 69 passing tests across Phase 2, baseline migrations, and Order regressions.
- Linting Issues: no lint script was present or run.

### Unresolved Questions

None blocking Phase 3 if the high-priority evaluator fallback is fixed or consciously carried as a pre-Phase-3 fix item.
