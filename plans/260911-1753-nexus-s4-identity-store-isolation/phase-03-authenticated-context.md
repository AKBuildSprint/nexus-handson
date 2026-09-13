---
phase: 3
title: "Resolve authenticated Store context at the Worker boundary"
status: pending
priority: P1
effort: 2d
dependencies: [1, 2]
---

# Phase 3: Resolve authenticated Store context at the Worker boundary

## Goal

Mount Better Auth before all API adapters, resolve each Console request to one current active membership, and remove anonymous bootstrap context from private routing without changing public Storefront authorization.

## Context Links

- [Plan](./plan.md)
- [Canonical HTTP, Origin and error contracts](./contracts.md#proposed-http-and-client-contract)
- [Auth/request scout evidence](./reports/research-auth-260912-0224.md)
- `apps/worker/src/index.ts:15-34`
- `apps/worker/src/console-order-routes.ts:38-143`
- `apps/worker/src/storefront-cors.ts:38-70`
- `apps/worker/src/environment.ts:1-3`
- Scenarios S4-03, S4-12, S4-17, S4-23, S4-25, S4-31, S4-32, S4-38, S4-39

## Overview

- **Priority:** P1.
- **Current status:** Pending.
- **Boundary:** Console `/api/console/*` requires Better Auth session + active membership. Only allowlisted sign-in/sign-out POSTs route to Better Auth first. `/api/storefront/*` remains public/capability-authorized Store A and never derives Store from a Console cookie.

## Requirements

### Functional

- Before Storefront preflight, allow only POST `/api/auth/sign-in/email` and POST `/api/auth/sign-out` to Better Auth. All other native auth paths/methods, including get-session, signup and account-management routes, return unavailable without invoking the handler.
- Add `GET /api/console/session` returning `{user:{id,name},store:{id,name},role,allowedActions}`. This is Console-only, not a Customer projection; omit session token/account fields.
- Resolve session data and response headers through Better Auth, then resolve one current active membership from D1. Forward refresh/deletion cookies on the final Console response even if subsequent membership/resource checks deny access.
- Return a consistent unauthenticated response with no private payload; unknown/revoked membership fails closed.
- Preserve Order contract-version guard ordering after authentication/private resource concealment.

### Non-functional

- No `bootstrap_owner` fallback remains on private routes.
- Storefront preflight never handles auth paths and never emits credentialed CORS.
- Errors/logs redact cookies, passwords, capabilities, and Customer PII.
- Every Console success/error response has `Cache-Control: no-store`. An auth/D1 outage returns safe 503 without clearing a still-valid browser session as if it expired.

## Architecture

Worker composition becomes:

1. Apply the explicit two-endpoint auth allowlist, then route accepted calls to Better Auth and sanitize response bodies per `contracts.md`, preserving all cookie/status/rate-limit headers.
2. Handle explicit Storefront CORS/public adapters.
3. For `/api/console/*`, resolve `ConsoleRequestContext` from session+membership.
4. Pass that trusted context into private route adapters.
5. Route remaining public Storefront requests exactly as before.

Middleware establishes identity/membership and same-origin mutation proof; package evaluators and commit-time guards enforce resource actions. Follow canonical error order: 401 `unauthenticated` → 403 `store_access_denied` → 403 `origin_not_allowed` → concealed target 404 `not_found` → 403 `forbidden` → contract/body/state/key checks. Lookup outage is 503 `service_unavailable`; unknown routes stay route-not-found. Collections omit target lookup.

The one-active-membership/no-picker resolver follows the user's 2026-09-12 separate-account-per-Store confirmation recorded in contracts. Zero or ambiguous active memberships deny access. Signature-only catalog changes prove context delivery, not Store isolation: Phase 4 removes catalog Store A SQL, and Phases 5–6 provide domain action enforcement. Phase 3 cannot be deployed alone.

Audit correction (2026-09-12): internal `getSession` uses the pinned API form returning headers plus data; verify that form against Phase 1's installed version. Keep refresh enabled and capture every library `Set-Cookie` in request-local Worker state outside `IdentityContext`. Finalize all Console responses once, including bootstrap and early errors, appending cookies separately without exposing headers in JSON or forwarding to Storefront. Preserve existing attributes/no-store, never comma-join cookies, and never synthesize deletion cookies for a D1 outage.

## File Inventory

| File | Action | Rough change | Test impact |
|---|---|---:|---|
| `/Users/plateau/Project/nexus-handson/apps/worker/src/index.ts` | Modify | 40–70 lines | Dispatch order and protected boundary |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/auth.ts` | Modify | 30–60 lines | Session/context resolver |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/console-session-routes.ts` | Create | 70–110 lines | Session bootstrap/sign-out-facing contract |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/http-response.ts` | Modify | 10–25 lines | Uniform auth errors |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/storefront-cors.ts` | Modify | 5–15 lines | Explicit non-credential assertion |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/console-product-routes.ts` | Modify | signature only | Receives trusted context |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/console-import-routes.ts` | Modify | signature only | Receives trusted context |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/console-file-routes.ts` | Modify | signature only | Receives trusted context |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/console-order-routes.ts` | Modify | 30–50 lines | Deletes bootstrap context/lookup |
| `/Users/plateau/Project/nexus-handson/tests/integration/console-auth-routes.test.ts` | Create | 240–340 lines | Private/public/mixed-credential boundary |
| `/Users/plateau/Project/nexus-handson/tests/integration/storefront-cors.test.ts` | Modify | 30–50 lines | Never credentialed/auth-routed |
| `/Users/plateau/Project/nexus-handson/tests/integration/spa-api-routing.test.ts` | Modify | dispatch assertions | Auth/API/ASSETS ordering and lookalikes |
| `/Users/plateau/Project/nexus-handson/tests/support/catalog-test-env.ts` | Modify | environment + request construction | Preserve explicit anonymous/public requests |
| `/Users/plateau/Project/nexus-handson/tests/support/identity-test-env.ts` | Modify | authenticated request helper | Real cookies and explicit Origin, no default Owner fallback |
| `/Users/plateau/Project/nexus-handson/tests/integration/{catalog-crud,product-create-schema,schema-regeneration,delivery-replacement,import-lifecycle,console-orders,order-commands,order-operations-routes,order-routes,orders-persistence,private-order-snapshot,public-catalog}.test.ts` | Modify callers as discovered | fixture/context adaptation only | Explicit identity for Console setup requests, including those inside public tests; preserve negative anonymous cases |
| `/Users/plateau/Project/nexus-handson/tests/cloudflare-test-env.d.ts` | Modify if new binding access | env parity | Typed test runtime secrets/origins |

## Dependency Map

`Phase 1 auth factory + Phase 2 membership resolver -> trusted Console context -> catalog/order cutovers in Phases 4–6`.

## Function and Interface Checklist

- [x] Worker `fetch` recognizes only exact POST sign-in/email and sign-out before other adapters; reject native session/account/signup endpoints and prefix lookalikes. Preserve ASSETS-only non-API tests.
- [x] `resolveConsoleRequestContext(request, env)` validates current session then exactly one active membership and preserves library response cookies through a request-local response accumulator, including early denial paths; no cookie role cache, bootstrap actor, first-Store fallback or module caller state.
- [x] `assertConsoleMutationOrigin` requires exact configured Origin for every unsafe method, rejects absent/`null`/malformed/foreign origins; present `Sec-Fetch-Site` must be `same-origin`, absent allowed with explicit valid Origin. Keep library-native auth checks distinct.
- [x] `routeConsoleSessionRequest` returns the canonical bootstrap shape and coarse evaluator actions; no private credential/session fields.
- [x] All Console adapter signatures accept trusted context; remove `bootstrapOwnerContext` and rename/replace `lookupBootstrapOrderId` with scoped lookup. Catalog package cutover belongs to Phase 4.
- [x] `http-response` helpers produce canonical auth errors/no-store without raw exception details; outage differs from absent/expired session.
- [x] Every affected Worker environment literal/request caller gets explicit origin/secret/session as appropriate. Preserve unauthenticated helper behavior and use a separate authenticated helper; never silently attach Owner cookies to every test request.
- [x] Re-scout direct adapter imports and `worker.fetch` callers across tests/scripts before changing signatures; the named fixture list is a known inventory, not a substitute for call-site search.

## Scout and Baseline Evidence

Existing relevant static cases: Storefront CORS **3**, SPA/API dispatch **10** (two parameter tables plus one test), Console Orders **2**, Order operations routes **10**, public/private Order routes **4** = **29**. New `console-auth-routes.test.ts`: **0**. No executed baseline claimed. `index.ts:19–29` is anonymous dispatch; `console-order-routes.ts:38` and `:127` are bootstrap seams; `catalog-test-env.ts:120–134` currently sends unauthenticated requests on `https://local.invalid`. Reuse source observations from the linked research, then re-scout actual callers before execution.

Call-site search additionally confirms public-catalog, private-order-snapshot and orders-persistence fixtures create Products through Console routes. Adapt those setup calls explicitly; public requests remain anonymous/capability-authorized. Positive domain-action suites that require Phases 4–6 must not be reported green from Phase 3 signature/context checks or weakened to accept incorrect bootstrap behavior.

## Test Scenario Matrix

| Priority | Scenarios | Expected proof |
|---|---|---|
| Critical | S4-03, S4-25 | No session/membership/outage returns no private data or fallback |
| Critical | S4-31, S4-32, S4-39 | Credentials never cross Customer/Console/public boundaries; hostile origin denied |
| Critical | S4-38 | Old anonymous client cannot reach former bootstrap path |
| High | S4-23 | Supported origins/cookies work; mismatches recover to sign-in |

## Tests Before

1. Characterize the existing 29 cases, then add a compiling route test whose 401/no-private-payload assertion fails because the current anonymous route returns private data. Missing env bindings/imports, fixture errors and zero discovery do not count as behavioral Red.
2. Provision Owner A, Staff A, Owner B, and a user without membership through test-only server helpers.
   Add lifecycle Reds with real persisted sessions: a due-refresh request must extend the browser cookie with the DB session; an expired/deleted session must return 401 with library deletion cookies. Exercise refresh then membership 403/resource 404 and multiple-cookie forwarding. Fault injection must distinguish 503 from expiry; no fabricated logout cookie or token-bearing body.
3. Exercise distinct Store A/B identities and crossed target IDs, Customer capability plus unrelated Console cookie, public Storefront while signed into B, revoked/ambiguous membership, D1/session outage, exact Origin/Fetch Metadata matrix, and old bootstrap-shaped requests. Full private catalog Store isolation assertions become green only with Phase 4, so do not misreport signature tests as isolation proof.

## Implementation Steps — Green

1. Focused-scout Worker dispatch and test helper signatures at phase start.
2. Mount the two allowed Better Auth POST endpoints first. Preserve status, every Set-Cookie and Retry-After; omit sign-in body token/session/account metadata and return `{ok:true}` on success. Worker uses server-side `auth.api.getSession` internally; `/api/console/session` is the sole browser session projection. Library CSRF/rate-limit checks stay enabled. Test multiple-cookie copying and expired-cookie sign-out; do not reuse stale content-length after body projection.
3. Implement `resolveConsoleRequestContext(request, env)` using current session and membership on every private request. Obtain internal `getSession` response headers, retain its refresh/expiry cookies in request-local state, and finalize both success and early error responses through the same safe append path. Do not cache membership/role in cookies or disable refresh as a shortcut.
4. Add the canonical session bootstrap response including stable user ID/name, Store ID/name, role and evaluator-derived coarse actions. Do not return session token or password/account rows; attach no-store to all Console responses.
5. Change each Console route signature to require trusted context. Delete `bootstrapOwnerContext` and fixed Store order lookup; resource lookup uses `context.storeId`.
6. Preserve Storefront context as explicit Store A. Ignore/reject any body Store fields and ignore Console cookies there.
7. Implement the exact canonical 401/403/404/503 ordering; preserve concealed resource lookup before Order contract/body disclosure and never convert infrastructure outage to logout. Update all known environment constructors and request call sites using explicit auth helpers; retain dedicated public/anonymous fixtures.
8. Keep Better Auth CSRF checks for auth endpoints. Apply exact-Origin/Fetch Metadata policy to every unsafe Nexus Console method, including POST/PUT/PATCH/DELETE; safe GET/HEAD cannot perform business mutations. Exercise origin-only supported clients and contradictory Fetch Metadata.

## Refactor

Centralize only session/membership resolution and safe auth error creation. Do not create generic middleware frameworks or move route-specific validation out of adapters. Delete every anonymous private fallback and stale explanatory comment in source/tests.

## Tests After

- Verify auth dispatch precedes Storefront CORS and private routes.
- Verify disallowed native endpoints cannot mutate users/accounts/sessions or expose tokens. Exercise raw requests that do not auto-inject Order contract headers across missing/stale/malformed/valid header values; assert auth/membership/origin/concealment precede contract errors.
- Verify every Console route family receives the trusted Store A/B context.
- Verify revoked membership immediately denies the next request with cookie cache disabled.
- Verify due-refresh and expiry/deletion cookies survive bootstrap, ordinary private responses and later authorization errors; no-refresh-needed calls do not invent replacement cookies. Verify 503 does not synthesize logout and all bodies remain token-free.
- Verify logs/error bodies contain no cookies, credentials, capabilities, or private resource fields.
- Verify all Console success/error paths are no-store; expired sessions produce 401, missing/revoked membership 403, and simulated identity-storage outage 503 without anonymous fallback. Resource-level current visibility in SQL and commit/replay rechecks remain mandatory acceptance in Phases 4–6.

## Todo

- [x] Write failing mixed-credential and anonymous-cutover tests.
- [x] Mount only the two required auth POST endpoints with token-free success responses and intact cookie headers.
- [x] Add current session and membership resolution with tested refresh/deletion-cookie forwarding on success and denial paths.
- [x] Require trusted context in all Console adapter signatures.
- [x] Remove bootstrap Owner and implicit Store A private fallbacks.
- [x] Prove Storefront remains public Store A and non-credentialed.

## Success Criteria

Every recognized private Console request has a current authenticated user and active membership before adapter disclosure. Public/Customer routes remain separate and old anonymous clients are denied. This proves the request boundary only; Store B resource isolation and complete action enforcement must pass Phases 4–6 before delivery or deployment.

## Regression Gate

```sh
npx vitest run tests/integration/auth-runtime.test.ts tests/integration/console-auth-routes.test.ts tests/integration/storefront-cors.test.ts tests/integration/spa-api-routing.test.ts
npm run typecheck
```

## Risk Assessment

- **Dispatch shadowing:** auth paths handled by preflight/not-found. Signal: auth lifecycle test receives non-Better-Auth response. Response: keep auth branch first.
- **Membership cache staleness:** revoked Staff remains active. Response: no membership cookie/cache; query current row per private request and recheck in mutation batches.
- **Origin drift:** local/deployed cookies fail. Response: exact environment-owned Console origin; never wildcard or globally disable checks.

## Security Considerations

Authentication is not authorization. A valid session without current membership yields no Store. A capability cannot authorize Console; a Console cookie cannot broaden Customer/public routes. Nexus Console mutations require same-origin proof in addition to session cookies.

## Next Steps

Phases 4 and 5 consume trusted context. Execute shared-file edits sequentially unless ownership is explicitly partitioned. Keep the branch local until the full private cutover and acceptance gates pass; signature changes alone do not make it safe to share.
