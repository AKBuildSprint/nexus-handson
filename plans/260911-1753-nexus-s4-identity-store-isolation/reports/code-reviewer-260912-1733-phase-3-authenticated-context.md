## Code Review Summary

### Scope

- Files reviewed: `apps/worker/src/index.ts`, `apps/worker/src/auth.ts`, `apps/worker/src/console-session-routes.ts`, `apps/worker/src/http-response.ts`, Console route adapters, `storefront-cors.ts`, `tests/integration/console-auth-routes.test.ts`, `auth-runtime.test.ts`, `storefront-cors.test.ts`, `spa-api-routing.test.ts`, `tests/support/identity-test-env.ts`, `tests/support/catalog-test-env.ts`, and direct Order adapter callers.
- Focus: Phase 3 authenticated Console boundary, native auth allowlist, context resolution, cookie forwarding, origin proof, Storefront separation, and fixture honesty.
- Score: 8.1/10
- Critical count: 0
- Auto-mode verdict: APPROVE_WITH_WARNINGS. No critical blocker found, but this is below the 9.5 auto-approve threshold.

### Blocking Findings

None.

### High Priority

1. `apps/worker/src/index.ts:27-32` only projects successful native auth responses. Non-OK responses from the two mounted Better Auth endpoints return directly at line 29, bypassing the project wrapper that enforces `Cache-Control: no-store`, body projection, and consistent sanitization. The Phase 3 contract says the auth adapter should preserve status/cookies/rate-limit headers while sanitizing response bodies per the Nexus contract. Fix by routing both success and failure through a small projection path that preserves `Set-Cookie` / retry headers, deletes stale body headers, sets `no-store`, and returns only bounded error content.

2. `tests/support/catalog-test-env.ts:155-174` caches a Console session for the common `consoleRequest` helper, but `tests/integration/order-operations-routes.test.ts:150-156` still creates fresh default sign-ins through `unversionedConsoleRequest`. In the reproduced standalone run, the suite failed 9/10; most failures are the expected Phase 5 `authorizedActor` user-vs-bootstrap gap, but one failure was `Test sign-in failed with 429` from Better Auth rate limiting. That makes the controller's "solely order-operations domain" failure classification slightly too broad and can hide later regressions. Before Phase 5 uses this suite as a gate, make unversioned Console requests reuse an existing session or vary authenticated identities/IPs intentionally.

### Medium Priority

1. `apps/worker/src/index.ts:50-54` requires `BETTER_AUTH_SECRET` and `CONSOLE_ORIGIN` before serving any API path, including public `/api/storefront/*`. In a misconfigured local/preview environment, Console auth config failure would also take down public Storefront APIs with `route_not_found`. The production Env should include those bindings, so this is not a current functional failure, but it weakens the intended Storefront separation. Prefer moving the auth-binding requirement inside `/api/auth/*` and `/api/console/*`, leaving Storefront dependent only on `DB`, `FILES`, and `STOREFRONT_ORIGIN`.

2. `apps/worker/src/console-session-routes.ts:26-30` computes coarse `allowedActions` with `assignedUserId: context.user.id`, so Staff sessions can report `order:read`, `order:process`, and `refund:request` before a specific assigned Order is known. The plan allows coarse actions, but resource-level code must not treat this bootstrap list as authorization. Phase 5/7 tests should assert assigned-only behavior from the resource endpoint, not from this session projection.

### Low Priority

1. `apps/worker/src/http-response.ts:45` has an extra blank line after `jsonResponse`. No behavior impact.

### Spec Compliance

- Auth allowlist/dispatch order: PASS. `index.ts` handles exact POST `/api/auth/sign-in/email` and `/api/auth/sign-out` before Storefront preflight; other `/api/auth/*` paths return route-not-found.
- Console session route: PASS. `/api/console/session` returns user ID/name, Store ID/name, role, and allowed actions without token/password/account fields.
- Session and membership resolution: PASS. `resolveConsoleRequestContext` uses Better Auth `getSession`, resolves exactly one active membership, and returns 401/403/503 without anonymous fallback.
- Cookie propagation: PASS WITH WARNING. Internal `getSession` cookies are accumulated and appended to success and denial responses, including multiple cookies. Non-OK mounted auth endpoint responses still bypass the Nexus wrapper.
- Origin rules: PASS. Unsafe Console requests require exact `Origin`; `Sec-Fetch-Site` must be absent or `same-origin`. Missing, `null`, foreign, and cross-site cases are covered after authentication.
- Storefront separation: PASS WITH WARNING. Storefront routes ignore Console cookies and emit no credentialed CORS, but all API routing currently requires Console auth bindings.
- No bootstrap private route: PASS for Worker routes. Direct package tests still use bootstrap contexts where Phase 5 owns the domain transition.
- Adapter signatures: PASS. Console adapters accept trusted context; Order routes build user actor context and scoped lookup from `requestContext.identity.storeId`.
- Test fixture honesty: PASS WITH WARNING. Anonymous negative tests use `workerRequest`; setup uses `consoleRequest`; one unversioned helper still leaks fresh sign-ins into rate limiting.

### Verification

- Fresh local Node 24.20.0 focused gate:
  - `npx vitest run tests/integration/auth-runtime.test.ts tests/integration/console-auth-routes.test.ts tests/integration/storefront-cors.test.ts tests/integration/spa-api-routing.test.ts`: 33/33 passed.
  - `npx vitest run tests/integration/catalog-crud.test.ts tests/integration/product-create-schema.test.ts tests/integration/schema-regeneration.test.ts tests/integration/delivery-replacement.test.ts tests/integration/import-lifecycle.test.ts`: 19/19 passed.
  - `npm run typecheck`: exited 0.
- Reproduced known non-gate suite:
  - `npx vitest run tests/integration/order-operations-routes.test.ts`: 1/10 passed, 9 failed. The dominant failure is Phase 5 domain `authorizedActor` still rejecting user actors with 422; one failure is Better Auth limiter 429 from repeated helper sign-ins.
- Controller-supplied evidence:
  - Node 22.23.2 focused 33/33 plus `tsc` passed.
  - Node 24 focused 33/33 plus `tsc` passed.
  - Full integration 124/133 with the remaining failures in `order-operations-routes`.

### Edge Cases Checked

- Prefix lookalikes such as `/api/auth/sign-in/email/extra` are not mounted.
- Storefront preflight does not handle Console/auth paths and does not add credentialed CORS.
- Revoked membership remains 403 and does not synthesize logout.
- Expired session returns 401 with deletion cookie.
- Session table outage returns 503 without manufactured logout cookie.
- Store B Console cookie does not alter public Storefront Store A product listing.
- Console Order contract errors now occur only after authentication and membership checks.

### Recommended Actions

1. Wrap native auth failure responses through the same Nexus no-store/sanitized projection used for success.
2. Fix the unversioned Console helper before Phase 5 turns `order-operations-routes.test.ts` back into a required gate.
3. Consider narrowing the top-level API binding checks so public Storefront routes do not depend on Console auth secret/origin presence.
4. Carry the coarse `allowedActions` caveat into Phase 5/7: resource endpoints and UI controls must re-evaluate current assignment and domain transition state.

### Metrics

- Type Coverage: `tsc --noEmit` passed.
- Test Coverage: 52 passing tests rerun locally for Phase 3 and catalog/import/file fixtures; 9 expected non-gate failures reproduced in Order operations.
- Linting Issues: no lint script was present or run.

### Unresolved Questions

None blocking Phase 4, provided auth response projection and the test helper limiter leak are fixed before treating the auth boundary and Order route suite as release-quality gates.

## Re-review after Phase 3 fixes — 260912-1739

### Updated verdict

- Blocking findings: none.
- Score: 9.2/10.
- critical_count: 0.
- Auto-mode verdict: APPROVE_WITH_WARNINGS.
- Phase 4/5 readiness: GO for the next phase, with the remaining warnings tracked below.

### Fix verification

1. Non-OK auth projection is fixed in `apps/worker/src/index.ts:26-44`. The Worker now projects failed Better Auth responses into the Nexus `ErrorEnvelope`, maps 429/403/other statuses to bounded error codes/messages, preserves upstream headers, deletes stale `Content-Length`, and uses `jsonResponse`, which sets `Cache-Control: no-store` and JSON content type in `apps/worker/src/http-response.ts:35-42`. The bad-password path is covered in `tests/integration/console-auth-routes.test.ts:107-121`.
2. Auth dispatch dependencies are now scoped correctly. `/api/auth/*` requires `DB`, `BETTER_AUTH_SECRET`, and `CONSOLE_ORIGIN` at `apps/worker/src/index.ts:62-66`; `/api/console/*` requires Console auth configuration at `apps/worker/src/index.ts:72-78`; public Storefront routing only requires `DB` at `apps/worker/src/index.ts:104-108`. `tests/integration/console-auth-routes.test.ts:256-266` covers Storefront reads without Console auth config.
3. Concealed Console Order detail/mutation lookup now precedes contract checks for concrete targets in `apps/worker/src/console-order-routes.ts:151-239`. The stale-contract missing-target case is covered by `tests/integration/console-auth-routes.test.ts:54-59`.
4. Origin rules now include the exact positive boundary where `Origin` matches and `Sec-Fetch-Site` is absent. The negative and positive cases are covered in `tests/integration/console-auth-routes.test.ts:181-207`.
5. Shared fixture regression is fixed. `tests/support/catalog-test-env.ts:155-179` caches the Console session, and `tests/integration/order-operations-routes.test.ts:151-157` reuses it for unversioned Console requests.
6. The isolated order suite now fails only at the known Phase 5 boundary: 8 failures, each first observing 422 where tests still expect user-context Console domain commands to behave like bootstrap-owner operations. I did not reproduce the previous 429 fixture failure.

### Remaining warnings

1. Worker-level 429 projection should get one direct assertion before auth hardening is closed. `apps/worker/src/index.ts:29-44` should preserve native rate-limit headers, including `Retry-After` when Better Auth emits it, but current Worker-route tests assert the projected 401 sanitization path while native auth-runtime tests cover 429 separately. This is low risk because headers are copied before projection, but it is worth pinning at the HTTP adapter boundary.
2. The session route still exposes coarse `allowedActions` from `apps/worker/src/console-session-routes.ts:26-30`. That is acceptable as a capability hint, but Phase 5/7 must continue to prove resource authorization from the specific Order assignment/domain state rather than this session projection.
3. Console Order mutations are correctly wired to the authenticated user context now, so the 422 failures are expected until Phase 5 updates domain authorization. Treat the current order-suite failures as a known open phase boundary, not a Phase 3 regression.

### Fresh verification

- `npx vitest run tests/integration/auth-runtime.test.ts tests/integration/console-auth-routes.test.ts tests/integration/storefront-cors.test.ts tests/integration/spa-api-routing.test.ts`: 34/34 passed.
- `npm run typecheck`: passed.
- `npx vitest run tests/integration/order-operations-routes.test.ts`: 2/10 passed, 8 failed; all failures are expected 422 user-actor Phase 5 authorization gaps, with no 429 observed.
