---
phase: 1
title: "Verify Better Auth on Workers and establish its schema"
status: pending
priority: P1
effort: 1.5d
dependencies: []
---

# Phase 1: Verify Better Auth on Workers and establish its schema

## Goal

Prove the pinned Better Auth runtime, raw D1 adapter, password hashing, schema, session cookie, signup lockout, and database rate limiter inside the repository's real workerd harness before later phases depend on them.

## Context Links

- [Plan](./plan.md)
- [Canonical contracts](./contracts.md#origins-sessions-and-account-provisioning)
- [Auth research and source evidence](./reports/research-auth-260912-0224.md)
- [Brainstorm identity recommendation](../reports/brainstorm-260912-0038-nexus-s4-identity-store-isolation.md#identity-and-session-handling)
- [Scenarios S4-16, S4-23, S4-25, S4-32, S4-37](../reports/scenario-260912-0041-nexus-s4-identity-store-isolation.md)
- `wrangler.jsonc:3-31`
- `apps/worker/src/index.ts:15-34`
- `tests/support/catalog-test-env.ts:1-135`

## Overview

- **Priority:** P1; all later private routing depends on this proof.
- **Current status:** Pending.
- **Decision:** Pin `better-auth` 1.7.4. Pass `env.DB` directly. Use no admin, organization, JWT, OAuth, or secondary-storage plugin.
- **Schema owner:** existing append-only `migrations/`; never expose a migration HTTP route or run Better Auth migrations in production.

## Key Insights

- Better Auth 1.7.4 detects raw D1 and provides its own D1 Kysely dialect. A third-party dialect would add risk without value.
- The D1 dialect does not support interactive transactions. Nexus domain mutations continue using `D1Database.batch`; do not attempt to make Better Auth identity writes atomic with Order/Catalog writes.
- Tagged Better Auth source delegates hashing through a conditional export that selects native scrypt under the `node` condition. Prove the actual Vite/workerd resolution and hash/verify behavior; neither the native path nor memory/CPU use has been measured here. Current Cloudflare documentation confirms root/test compatibility date `2026-08-22` enables Node compatibility automatically.
- Session cookie cache conflicts with immediate revocation. Leave it disabled.

## Requirements

### Functional

- Email/password sign-in, get-session, expiry, and sign-out work through Better Auth's HTTP handler at `/api/auth/*` in workerd. Phase 1 invokes `auth.handler(Request)` directly; Phase 3 proves Worker dispatch, avoiding a dependency cycle.
- `disableSignUp: true` blocks public and direct HTTP signup.
- A server-only provisioning helper creates a credential account without an HTTP provisioning route, session issuance, implicit membership, or password overwrite on retry. Define duplicate/conflict and partial-write recovery explicitly.
- Database-backed rate limiting persists through D1.

### Non-functional

- `BETTER_AUTH_SECRET` is a Worker secret and test-only injected value; never commit it.
- Production uses exact HTTPS `CONSOLE_ORIGIN`; local uses `http://127.0.0.1:5173` and explicitly exercises localhost mismatch behavior.
- Storefront origin is not trusted by Better Auth. Cross-subdomain cookies remain disabled. CSRF/origin checks remain enabled.

## Architecture

Create the Better Auth factory in the Worker layer because D1 binding and HTTP handling are platform composition. Prefer request-local construction until measured cost justifies caching. Any cache must account for DB, secret and origin changes; a DB-only `WeakMap` is insufficient. Retain only immutable configuration, never session/membership/user state. Keep dependency injection instead of importing global `cloudflare:workers` environment state.

Configuration contract:

- `database: env.DB`
- `baseURL: env.CONSOLE_ORIGIN`
- `secret: env.BETTER_AUTH_SECRET`
- `emailAndPassword: { enabled: true, disableSignUp: true }`
- `trustedOrigins: [env.CONSOLE_ORIGIN]`
- `session.cookieCache` absent/disabled
- `rateLimit: { enabled: true, storage: 'database' }`
- `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']`

## File Inventory

| File | Action | Rough change | Test impact |
|---|---|---:|---|
| `/Users/plateau/Project/nexus-handson/package.json` | Modify | 2–4 lines | Adds pinned runtime dependency |
| `/Users/plateau/Project/nexus-handson/apps/worker/package.json` | Modify | explicit dependency | Declares Better Auth at its actual consumer |
| `/Users/plateau/Project/nexus-handson/package-lock.json` | Modify | generated | Lockfile integrity |
| `/Users/plateau/Project/nexus-handson/migrations/0008-better-auth.sql` | Create | 60–90 lines | Auth schema and rate limiter |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/auth.ts` | Create | 80–130 lines | Runtime factory and server-only provisioning primitive |
| `/Users/plateau/Project/nexus-handson/apps/worker/src/environment.ts` | Modify | 3–6 lines | Types `CONSOLE_ORIGIN`, `BETTER_AUTH_SECRET` |
| `/Users/plateau/Project/nexus-handson/worker-configuration.d.ts` | Regenerate | root Wrangler-derived env types | Keeps generated Console origin binding aligned; never hand-edit generated runtime types |
| `/Users/plateau/Project/nexus-handson/wrangler.jsonc` | Modify | 1 local non-secret var | Local Console origin only |
| `/Users/plateau/Project/nexus-handson/tests/support/catalog-test-env.ts` | Modify | 20–35 lines | Migration 8 and auth test env |
| `/Users/plateau/Project/nexus-handson/tests/cloudflare-test-env.d.ts` | Modify if test bindings used | auth binding types | Matches injected test env |
| `/Users/plateau/Project/nexus-handson/vitest.config.ts` | Modify only for required bindings/resolution | measured | Real workerd compatibility parity |
| `/Users/plateau/Project/nexus-handson/tests/support/identity-test-env.ts` | Create | auth fixtures and header helpers | Provisioning through real library; reused by later route suites |
| `/Users/plateau/Project/nexus-handson/tests/integration/auth-runtime.test.ts` | Create | 180–260 lines | Durable workerd compatibility contract |

## Dependency Map

`package + migration 0008 -> auth factory -> workerd integration proof -> Phases 2 and 3`.

## Function and Interface Checklist

- [x] `createAuth(env)` consumes typed `DB`, `CONSOLE_ORIGIN`, `BETTER_AUTH_SECRET`; repeated calls cannot retain another configuration or caller.
- [x] `provisionCredentialAccount` uses pinned `auth.$context`, `context.password.hash`, `internalAdapter.createUser(user, { method: 'email-password' })`, then `linkAccount({ userId, providerId: 'credential', accountId: userId, password: hash })`; compile these internal signatures against 1.7.4 before use.
- [x] Provisioning validates email/password bounds and hashes before writes. Define safe recovery for a user created without its account; exact existing identity is a no-op, conflicts abort without password reset/Store rebinding. No active membership is created until credentials succeed.
- [x] `catalogMigrations`, `CatalogMigrationThrough`, `applyCatalogMigrations`, `resetCatalogThrough`, and `resetCatalog` advance to schema8 while retaining 4/5/6/7 rehearsal entrypoints. Reset account/session before user; future membership/assignment children must precede their parents.
- [x] Auth fixture/request helpers explicitly set test `CONSOLE_ORIGIN=https://local.invalid` plus matching request URL/browser Origin, real session cookies and trusted test IP metadata. Separately vary URL/Origin/config to prove only configured Origin is trusted. Never add test origins to production or substitute `auth.api` for handler-based limiter/CSRF proof.

## Scout and Baseline Evidence

Current auth tests: **0**; the proposed runtime test and dependency do not exist. Source scout confirms schema7 is the helper default (`tests/support/catalog-test-env.ts:74–115`), Worker has no auth dispatch (`apps/worker/src/index.ts:19–29`), and test env currently declares only DB/FILES. Host Node is 24.20.0 and dependencies are absent; execute under Node 22 after `npm ci`. No test baseline or auth runtime pass is claimed. Use the linked research report's official tagged source URLs; re-scout the pinned installed package before implementation.

## Test Scenario Matrix

| Priority | Scenarios | Boundary | Expected proof |
|---|---|---|---|
| Critical | S4-25, S4-32 | Worker/D1 HTTP | D1/auth failure closes private auth; hostile origin cannot mutate |
| High | S4-16, S4-23, S4-37 | workerd auth lifecycle | Rate limit, cookie/origin behavior, sign-in/session/sign-out succeed |
| Medium | local origin variants | Worker config | `127.0.0.1` works; untrusted `localhost` fails explicitly |

## Tests Before

1. Establish a green unchanged workerd smoke after Node22/lockfile setup. Add minimal typed factory/provision seams so tests compile; missing dependency/import, invalid harness, or accidental missing-table exception is setup failure, not Red.
2. Capture named behavioral Reds: configured HTTP signup unexpectedly creates an identity; provisioned credentials cannot establish/read/revoke a real session; changed config reuses stale origin/secret; limiter permits beyond its configured limit after a fresh auth instance. Assert missing required DDL deliberately after valid schema7 setup, not by relying on a fixture crash.
3. Cover exact tables/indexes, expiry, hostile Origin, error redaction, and provisioning duplicates/partial failures. Include a bounded hash/verify smoke and record bundle resolution; keep local millisecond timing out of correctness tests.

## Implementation Steps — Green

1. Under Node22, run `npm ci` from root for the baseline. Add exact `better-auth: 1.7.4` to the consuming Worker workspace and any directly importing root test tooling, then update the root lockfile from the root. Do not use an unpinned `npx` package fallback.
2. Generate Better Auth DDL offline for the selected config, compare it to the researched 1.7.4 schema, and hand-author migration 0008 in the existing migration directory. Keep Better Auth's quoted camelCase identifiers byte-compatible.
3. Include `user`, `session`, `account`, `verification`, and `rateLimit`, plus Better Auth's expected unique/index constraints. Do not add admin-plugin columns.
4. Add the configuration-safe Worker auth factory with schema validation enabled. Verify same DB/different secret or origin creates the correct instance; never cache callers.
5. Implement the pinned server-only provisioning seam above. Inject hash/account-write failure and prove recovery cannot mint membership, overwrite credentials, or adopt a conflicting identity. Keep it unreachable from routing; Phase 8 owns operator transport and script.
6. Extend environment types, test helpers and local `CONSOLE_ORIGIN`; regenerate root types with the existing `npx wrangler types --strict-vars=false` command. Keep runtime secret values outside source; type any secret absent from generated bindings in the Worker env contract. Inject a deterministic secret only in test setup. Update all affected `Env` constructors/callers, preserving deliberate ASSETS-only dispatch fixtures.
7. Run the targeted workerd test. If any core flow invokes unsupported interactive transactions or exceeds Worker limits, stop: do not continue to Phase 2. Re-evaluate the pinned version or auth mechanism.

## Refactor

After the red test passes, remove spike-only logging and generated schema dump code. Keep only the auth factory, server-only provisioning primitive, migration, and consumer-observable integration tests. Do not retain a Kysely dependency, generated migration endpoint, or alternate adapter path.

## Tests After

- Add regression coverage that Storefront origin is not trusted and that cookie attributes are host-only, HttpOnly, Lax, and Secure for HTTPS.
- Verify changing the request body or origin cannot bypass signup lockout or limiter behavior.
- Inventory native auth routes and response fields from the pinned package for Phase 3's two-endpoint allowlist. Phase 1 internal get-session handler tests do not authorize exposing that endpoint publicly. Capture no raw token-bearing library response in logs/artifacts.
- Verify schema validation fails closed when one required column/table is absent.
- Verify session lookup and sign-out after fresh auth construction; explicit limiter enablement survives construction and missing/forged IP metadata cannot make the test a no-op. `auth.api` bypasses HTTP limiting and cannot prove this.
- Record exact installed DDL/version and workerd bundle resolution. Local success does not prove deployed CPU/account limits; retain that separately authorized rollout gate.

## Todo

- [x] Write failing Better Auth workerd lifecycle tests.
- [x] Pin Better Auth and update the root lockfile.
- [x] Add append-only migration 0008 with exact selected schema.
- [x] Add configuration-safe Worker auth factory and environment contract.
- [x] Prove disabled signup, server-only provisioning, session lifecycle, CSRF, and rate limiting.
- [x] Remove spike-only artifacts and record the verified version/config.

## Success Criteria

- All Phase 1 integration scenarios pass through the real workerd+D1 harness.
- No public provisioning route exists.
- No schema or runtime fallback silently creates users, uses memory sessions, disables CSRF, or trusts Storefront.
- The chosen version and DDL are explicit enough for populated migration rehearsal.

## Regression Gate

```sh
npx vitest run tests/integration/auth-runtime.test.ts
npm run typecheck
```

Both commands must exit 0. A hashing timeout, schema mismatch, cookie/origin failure, or interactive-transaction error blocks all later phases.

## Risk Assessment

- **CPU/memory limit:** sign-in hashing is the first likely deployment failure. Signal: workerd/remote CPU-limit error. Response: stop and re-plan credential hashing/runtime; never weaken password hashing silently.
- **Internal provisioning API drift:** Better Auth internal adapter is not a public stability guarantee. Signal: pinned upgrade breaks compile/test. Response: keep version pinned and re-prove before upgrade.
- **DDL drift:** schema validation reports missing tables/columns. Response: fix only a new unapplied migration during development; never rewrite an applied remote migration.

## Security Considerations

Keep `disableCSRFCheck` and `disableOriginCheck` unset. Never trust wildcard origins, Storefront, or forwarded IP headers. Never log passwords, session cookies, or raw auth errors containing credentials. Provisioning inputs arrive at execution through secrets/stdin, not fixtures or committed files.

## Next Steps

Phase 2 may start only after the runtime and schema gate passes. Before execution, scout the pinned dependency surface and generated DDL again because this is the plan's load-bearing version-sensitive assumption.
