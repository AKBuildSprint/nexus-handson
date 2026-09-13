## Code Review Summary

### Scope

- Files: `apps/worker/src/auth.ts`, `apps/worker/src/environment.ts`, `apps/worker/package.json`, `package.json`, `package-lock.json`, `migrations/0008-better-auth.sql`, `tests/integration/auth-runtime.test.ts`, `tests/support/identity-test-env.ts`, `tests/support/catalog-test-env.ts`, `tests/integration/order-operations-routes.test.ts`, `wrangler.jsonc`, `worker-configuration.d.ts`
- Focus: Phase 1 of `plans/260911-1753-nexus-s4-identity-store-isolation/phase-01-start.md`
- Fresh verification: `node -v` reported `v24.20.0`; `npx vitest run tests/integration/auth-runtime.test.ts tests/integration/order-operations-routes.test.ts` passed 2 files / 21 tests; `npm run typecheck` exited 0.
- Score: 8/10
- Critical count: 0
- Phase 2 gate: GO, with the concurrency warning below carried into Phase 8/operator design.

### Overall Assessment

Phase 1 is materially implemented and matches the accepted phase boundary. The implementation pins Better Auth 1.7.4 in the Worker consumer and root test/runtime dependency, adds append-only schema 0008, creates a Worker-layer auth factory, and proves direct `auth.handler(Request)` behavior through the workerd+D1 test harness. The Worker router does not yet mount `/api/auth/*`, which is consistent with Phase 1: dispatch and allowlisting belong to Phase 3.

Spec compliance is strong for the load-bearing Phase 1 items: disabled signup, real email/password sign-in, session read/sign-out, D1-backed limiter, origin trust, host-only cookie attributes, schema validation failure, and retry-safe provisioning all have tests. Shared order route fixtures were updated with the new required env bindings and still pass.

### Critical Issues

None found.

### High Priority

None found.

### Medium Priority

1. `apps/worker/src/auth.ts:75` recovery is retry-safe, but not itself a full concurrency boundary. Two simultaneous provisioning calls for the same previously partial user can race through the `existing.accounts.length === 0` branch; one may link the credential account while the other returns `provisioning_failed`. That does not create duplicate credentials or overwrite a password, and retry converges to the exact identity, so it is not a Phase 1 blocker. It does mean Phase 8 must keep the planned serialized operator provisioning boundary rather than exposing this primitive as a parallel-safe command runner.

### Low Priority

1. `tests/integration/auth-runtime.test.ts:260` verifies incomplete schema redaction by catching the thrown library error from direct `auth.handler`. That is acceptable for Phase 1 because Worker error translation is explicitly Phase 3, but Phase 3 must add the 503/no-private-error-body route-level proof before any public auth dispatch is mounted.

### Edge Cases Found by Scout

- Public route exposure: `apps/worker/src/index.ts` still has no `/api/auth/*` branch, and `rg` found no provisioning route. This preserves the Phase 1 direct-handler boundary and blocks accidental public provisioning.
- Shared fixture regression: `tests/support/catalog-test-env.ts` now defaults to migration 8 and injects `CONSOLE_ORIGIN` / `BETTER_AUTH_SECRET`; `tests/integration/order-operations-routes.test.ts` still passed after those changes.
- Origin/rate-limit: hostile Storefront/localhost/null origins are denied; configured loopback mismatch is denied; rate limiting persists across fresh auth instances in D1; changed sign-in bodies do not bypass the limiter through unconfigured forwarded headers.
- Schema/indexes: migration 0008 includes `user`, `session`, `account`, `verification`, `rateLimit`, expected unique constraints on email/token/key, and explicit user/verification indexes. Installed Better Auth internals could not be read directly because a local hook blocks `node_modules` access, so the review relies on migration inspection plus workerd schema-validation behavior.

### Suggestions

1. In Phase 8, make provisioning explicitly single-writer per normalized email and document retry semantics: exact match is no-op, partial user without credential may be completed, conflicting name/password/provider fails, and concurrent invocations are outside the primitive's guarantee.
2. In Phase 3, keep the auth route allowlist narrow and prove route-level behavior separately: no public get-session endpoint, native `Set-Cookie` forwarding, sanitized 503 on D1/auth outage, no Storefront trusted origin, and exact `Origin` / `Sec-Fetch-Site` rules for Nexus cookie-authenticated mutations.

### Metrics

- Type Coverage: TypeScript gate passed (`tsc --noEmit`).
- Test Coverage: Focused Phase 1/fixture gate passed 21/21 locally in this review; prior Node 22.23.2 evidence was supplied by the controller.
- Linting Issues: No lint script was discovered or run; typecheck passed.

### Unresolved Questions

- None blocking Phase 2.
