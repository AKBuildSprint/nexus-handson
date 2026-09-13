# Auth, membership, and request-boundary research

Date: 2026-09-12. Scope: read-only repository and official-source research for Phases 1–3; no implementation, dependency installation, runtime-auth probe, migration, or deployment completed.

## Conclusions

The selected Better Auth 1.7.4/raw D1 approach is supported by tagged upstream source. Keep it, but label workerd hashing, generated DDL, HTTP session lifecycle, limiter persistence, and provisioning recovery as **unverified execution gates**. The larger correctness gap is authorization on every commit/replay branch, not the adapter choice.

### 1. Version/runtime claims: confirmed source, pending local proof

- [Tagged 1.7.4 dialect source](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.4/packages/kysely-adapter/src/dialect.ts), lines 151–161, detects D1 using `batch`, `exec`, `prepare`, creates its own dialect, and sets `transaction = false`. No third-party dialect/ORM is needed. The older brainstorm's community-dialect recommendation is superseded by this version-specific evidence.
- [Tagged password implementation](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.4/packages/better-auth/src/crypto/password.ts) delegates to `@better-auth/utils/password`, which chooses native scrypt under the `node` export condition. This does not prove which conditional export the real Vite/workerd bundle resolves. Capture that resolution and a real hash/verify/sign-in test before stating that the deployed path uses native scrypt. The asserted 32 MiB working set was not independently verified here.
- [Cloudflare crypto documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/) explicitly says compatibility dates from 2026-08-04 enable Node compatibility automatically. Root `wrangler.jsonc:5` and `vitest.config.ts:8` both use 2026-08-22. Do not add compatibility flags merely from older advice. Crypto support is documented; CPU/memory under the actual account's limits remains a later authorized remote gate.
- Phase 1 tests must call `auth.handler(Request)` for lifecycle/CSRF/rate limiting. `/api/auth/*` is mounted only in Phase 3, so testing the Worker route before then creates an unnecessary phase dependency. Phase 3 tests then verify the actual dispatch contract.

### 2. Provisioning needs a precise failure contract

[Tagged signup source](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.4/packages/better-auth/src/api/routes/sign-up.ts), lines 180–188, rejects disabled signup before creating a user. Calling `auth.api.signUpEmail` on that same configuration does not provide a privileged bypass. Its normal creation sequence validates/normalizes input, hashes first, creates the user, then links a credential account.

[Tagged internal adapter](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.4/packages/better-auth/src/db/internal-adapter.ts), lines 255–273, requires a provisioning-source argument for `createUser`. The phase should name `auth.$context`, `context.password.hash`, `internalAdapter.createUser(user, { method: 'email-password' })`, and `internalAdapter.linkAccount({ userId, providerId: 'credential', accountId: userId, password: hash })` as the pinned seam to compile/prove, rather than promising an unspecified helper.

Required provision tests: normalized duplicate email, malformed/bounded password, hash failure before persistence, account-link failure after user creation, membership failure, safe retry without password overwrite or implicit Store rebinding, and no session minted as a side effect. Raw D1's lack of interactive transactions means these writes are not automatically one atomic operation. Define an explicit incomplete-account recovery/abort rule. Do not silently adopt a colliding existing user or change credentials on retry. Create active membership only after a verified credential identity exists; an incomplete user must have no Store authority. Operator passwords must enter through a hidden prompt/stdin or secret facility and never command arguments, logs, or reports.

Memoizing solely by `env.DB` can retain a stale origin/secret/config in tests or reused bindings. Prefer request-local construction unless measured cost justifies caching, or make the cache sensitive to the auth configuration. Test two configurations using the same D1 binding. This is a design recommendation, not a proven current bug.

### 3. Membership/assignment schema can be additive

- `migrations/0006-order-brief-contract.sql:39` already defines Store/customer foreign keys and `UNIQUE(id, store_id)` on Orders. Assignment can reference that tuple without rebuilding Orders in migration 0009.
- Define membership's composite candidate key explicitly, e.g. `UNIQUE(user_id, store_id)`, in addition to `UNIQUE(user_id)`, so assignment FKs can use the exact same tuple. Add FKs for both assignee and assigning Owner; runtime predicates still validate their role/status. A FK alone cannot establish active Staff eligibility.
- `UNIQUE(user_id)` means one membership row across all statuses, stronger than merely one active membership. Keep the accepted no-Store-picker behavior, but say whether revocation is an in-place status change and whether cross-Store reassignment of the login is unsupported. Do not silently replace it with a partial active-only index.
- Preserve legacy actor strings/IDs: current types already include `user` (`packages/orders/src/order-types.ts:14`) and schema7 payment actors already accept it (`migrations/0007-manual-payments.sql:18`). Membership revocation must not cascade-delete audit history or rewrite `bootstrap_owner` into a real identity.
- Add `apps/worker/package.json` to dependency ownership: Worker currently explicitly declares catalog/orders and will import identity and Better Auth directly. Also declare identity on catalog if Phase 4 imports it. Do not rely solely on root workspace hoisting.
- Extend `tests/support/catalog-test-env.ts:74–115`: migration list, through-version union, default latest version, and FK-safe reset order all currently stop at 7. Include assignments before Orders/memberships; membership/session/account before auth users. Preserve old-version rehearsal entrypoints. Extend test env typing if auth bindings are read from `cloudflare:test` (`tests/cloudflare-test-env.d.ts:1`).

### 4. Request and commit boundaries must have explicit coverage

Worker dispatch currently composes anonymous adapters (`apps/worker/src/index.ts:19–29`). `bootstrapOwnerContext` and `lookupBootstrapOrderId` are the concrete private defaults to remove (`apps/worker/src/console-order-routes.ts:38`, `:127`). A signature-only catalog adapter change in Phase 3 cannot demonstrate Store B isolation while catalog SQL still fixes Store A; Phase 3 should prove identity/context routing and block partial deployment, then Phases 4–6 prove resource scope.

Keep auth endpoint checks and Nexus mutation checks separate. [Better Auth security docs](https://better-auth.com/docs/reference/security) cover its own endpoints, including Origin/Referer and Fetch Metadata; they do not install CSRF protection on Nexus routes. Specify exact behavior for missing Origin, `Origin: null`, hostile origin, same-site different origin/port, cross-site Fetch Metadata, and safe GET versus mutating methods. Require same-origin evidence for Console mutations, preserving the distinct Storefront CORS policy (`apps/worker/src/storefront-cors.ts:34–87`). Test capabilities plus unrelated Console cookies both ways.

[Session docs](https://better-auth.com/docs/concepts/session-management) support disabling cookie cache for immediate session revocation. Query membership fresh as well: session validity alone is not membership validity. [Rate-limit docs](https://better-auth.com/docs/concepts/rate-limit) state that server-side `auth.api` calls bypass limiting; use HTTP handler requests with deterministic IPs and create a fresh auth instance to prove D1 persistence. Test missing/untrusted IP metadata rather than accidentally passing a no-op limiter test.

`prepareCommand` authorizes before initial replay (`packages/orders/src/commands/order-commands.ts:73–94`), but its current pure `authorizedActor` accepts only bootstrap/Customer (`packages/orders/src/transitions/order-transitions.ts:13–29`). Extend this seam while preserving public Customer semantics. Also enumerate all later result branches:

- `bindExistingResult` at `packages/orders/src/persistence/command-store.ts:207`: new-key binding to an existing event writes a ledger row and returns a result.
- `recoverFailedBatch` at `:254`: failure recovery reads ledger and result.
- `runCommandBatch` at `:278`: `onConflictReplay` and post-success result reads.

Each needs current authorization before disclosure, and every private write must include a commit-time membership/assignment predicate. Merely placing a `SELECT` inside a batch does not abort later statements. Use guarded writes plus a final integrity assertion that forces rollback if authority disappeared; demonstrate zero changes to history, payments, ledger, and Orders on denial. Inject revocation/reassignment between initial authorization and batch execution, and before recovery/replay. Use the real D1 with a deterministic interleaving hook/proxy; do not fake successful persistence.

## Existing test inventory and exact commands

Counts below are **static source inventory**, not executed results. `spa-api-routing` contains two parameter tables (3 + 6) plus one test, therefore 10 cases rather than 3 declarations. Newly named auth/identity files do not yet exist.

| Phase | Existing relevant cases | Missing durable evidence |
|---|---:|---|
| 1 | 0 auth runtime cases | raw D1 auth lifecycle; exact DDL; provision failures; CSRF; persisted limiter; hashing/bundle path |
| 2 | migration-constraints 7; order-brief-migration 8; order-operations-migration 4 = 19 | membership and assignment constraints; complete permission matrix; populated 7→8→9 rehearsal; revoked membership/history preservation |
| 3 | storefront-cors 3; spa-api-routing 10; console-orders 2; order-operations-routes 10; order-routes 4 = 29 | real login/session routing; 401/403/404 ordering; all Console route families; mixed credentials; Origin/Fetch Metadata; revoked session/membership |
| Commit seams feeding Phases 5–6 | order-commands 18 | revoked/reassigned commit and every replay/recovery branch; zero unauthorized effects |

The phase commands `npm run test:integration -- path/to/file` append a file to the existing `tests/integration` positional filter in package.json, so they do not reliably narrow selection. Use the unfiltered existing `test:workerd` script:

```sh
# Repository root; activate Node 22 and install pinned lockfile before execution.
npm ci
npm run test:workerd -- tests/integration/auth-runtime.test.ts
npm run test:workerd -- tests/unit/permissions.test.ts tests/integration/identity-schema.test.ts
npm run test:workerd -- tests/integration/console-auth-routes.test.ts tests/integration/storefront-cors.test.ts tests/integration/spa-api-routing.test.ts
npm run test:workerd -- tests/integration/order-commands.test.ts
npm run typecheck
```

For TDD, record a green existing focused baseline first; then record each new assertion failing for the intended missing behavior, not solely module-not-found. Do not mark any new auth test passed based on source inspection.

Environment observed here: `node --version` returns v24.20.0. `npx vitest list ...` found no installed Vitest and attempted an unpinned Vitest 5 fallback; it did not produce a valid inventory/run result. No ongoing process remained, and no tracked file changes resulted. Do not repeat that command before `npm ci`; use the package scripts so absent dependencies fail rather than fetching latest.

## Unresolved execution gates

No new product decision is required for this refinement. Workerd auth/hash proof, exact generated schema, provision recovery implementation, and deployed account limits remain unverified and must stay explicit. Remote actions remain outside this planning task.
