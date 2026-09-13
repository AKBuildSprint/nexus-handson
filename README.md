# Nexus Console, API, and Storefront

Nexus has two independently built and deployed surfaces: the React/Vite Console served by the API Worker, and a static Storefront that calls that Worker from a distinct origin. Product and Order data is stored in D1 through the `DB` binding, while delivery files and retained CSV originals stay in a private R2 bucket through the `FILES` binding.

This repository is configured for public `workers.dev` teaching deployments. It has no custom domain and no public R2 route.

## Repository shape

- **Apps** are runnable and deployable: [`apps/console`](./apps/console) (HTML/Vite), [`apps/worker`](./apps/worker) (HTTP adapters), [`apps/storefront`](./apps/storefront) (distinct-origin static app). Console and the API Worker share root [`wrangler.jsonc`](./wrangler.jsonc) and same-origin `/console` plus `/api`; Storefront keeps its own [`apps/storefront/wrangler.jsonc`](./apps/storefront/wrangler.jsonc).
- **Packages** own business rules. [`packages/catalog`](./packages/catalog) owns products, CSV import, delivery files, and shared catalog contracts. [`packages/orders`](./packages/orders) owns Order reads, commands, command persistence, and transition rules. Worker composes both packages. Console consumes catalog only; Order UI types stay in the Console app. Storefront is HTTP-only. Orders may depend on catalog; catalog never depends on orders or apps; packages never depend on apps.
- **Tests** (`tests/unit`, `tests/integration`, `tests/browser`, `tests/e2e`) are evidence by risk. `tests/fixtures` and `tests/support` stay helpers, not discovery roots.
- **Migrations** are append-only D1 history. **Plans** hold decisions and contracts. **Docs** hold durable presentation knowledge. **Scripts** are operational verification tooling.

Root script names stay in [`package.json`](./package.json). Console Vite is [`apps/console/vite.config.ts`](./apps/console/vite.config.ts) and must keep the Cloudflare plugin on root Wrangler with repo-root `.wrangler` state. Storefront Vite is [`apps/storefront/vite.config.ts`](./apps/storefront/vite.config.ts).

## Current Order scope

Live Order statuses are `pending`, `paid`, `fulfilled`, and `canceled`. Storefront Create records one Order with 1–10 item lines. Console records a **manual Payment** (method plus Owner-supplied external reference, amount and currency from the Order snapshot) and may then **Fulfill**. A **pending** Order may be **Canceled**. There is no live Complete action and no `/complete` route.

Two references stay distinct:

- Internal `paymentReference` (`NP-…`): stable expected-payment identity created with the Order. Searchable and Customer-safe. Not bank-transaction evidence.
- Console-only `payments.external_reference`: Owner-supplied evidence of money received outside Nexus. Never fabricated for legacy rows.

Each Order has one final Refund Request lifecycle: **pending**, **approved**, or **rejected**. Customers and the Console-on-behalf path share that request; only an authenticated Owner can make the final Approve/Reject decision. Approval records intent and never claims that money moved. Refund execution remains S5, which must not auto-return money for `legacy_unrecorded` paid Orders that lack original payment evidence.

Legacy `completed` rows map to **paid** without invented payments or fulfill events. Console shows `paymentRecordState: legacy_unrecorded` when no payments row exists.

Every live Order GET/POST requires `X-Nexus-Order-Contract: 2`. Missing or other values return `409 client_contract_outdated` with no mutation, except private Order routes that fail the capability guard first as indistinguishable `404`. Old `/complete` and approval/execution routes stay `404`.

Order code lives in `packages/orders`: reads in [`queries/order-read.ts`](./packages/orders/src/queries/order-read.ts); create and command orchestration in [`commands/order-write.ts`](./packages/orders/src/commands/order-write.ts) and [`commands/order-commands.ts`](./packages/orders/src/commands/order-commands.ts); D1 ledger, result, batch, and recovery helpers in [`persistence/command-store.ts`](./packages/orders/src/persistence/command-store.ts); pure actor and eligibility rules in [`transitions/order-transitions.ts`](./packages/orders/src/transitions/order-transitions.ts). Types, validation, and [`private-access.ts`](./packages/orders/src/private-access.ts) stay at the package src root. Commands may import persistence and transitions; those two layers must not import each other. Create-time item snapshots come from [`packages/catalog/src/private-order-snapshot.ts`](./packages/catalog/src/private-order-snapshot.ts) so live catalog and delivery identity are not re-read into Customer output. Persist each create/command through one D1 `batch`; do not replace that with sequential independent writes.

The checked-out Console requires a prebound Google identity plus one active Nexus Store membership. Owners can manage the Store; Staff see Products read-only and can work only assigned Orders. Google authenticates the account while Nexus memberships remain the authorization source. See [Google Console login](./docs/google-console-login.md) for local configuration and provisioning inputs. Storefront public routes remain anonymous and Customer Order routes retain their exact bearer capability. This is locally verified behavior; no remote migration, provisioning, deployment, real Google consent, or smoke result is claimed. S5 owns verified payment ingress and money return, including no auto-return for `legacy_unrecorded`.

## Requirements

- Node.js 22 or newer
- npm (the lockfile is authoritative; install with `npm ci`)
- A Cloudflare login only for remote resource inspection, migrations, deployment, smoke verification, or cleanup

```sh
npm ci
```

The pinned verification toolchain is recorded in `package.json`: Cloudflare Vite plugin 1.54.0, Wrangler 4.126.0, Workers Vitest pool 0.22.0, Vitest 4.1.11, Playwright 1.62.1, and Papa Parse 5.7.0.

## Local development

Apply all D1 migrations to the local API binding first. Run npm and Wrangler from the repository root so migrations and local state resolve through root Wrangler:

```sh
npx wrangler d1 migrations apply nexus-s1-468cba-db --local
```

Run the API/Console and Storefront from separate terminals. These ports match the local `STOREFRONT_ORIGIN` in [`wrangler.jsonc`](./wrangler.jsonc); the Storefront's API origin is supplied independently at Vite build/dev time:

```sh
# Terminal 1: API and Console
npm run dev:console -- --host 127.0.0.1 --port 5173

# Terminal 2: Storefront
VITE_STOREFRONT_API_BASE_URL=http://127.0.0.1:5173 npm run dev:storefront -- --host 127.0.0.1 --port 5174
```

`npm run dev` remains the API/Console default. Open `/console/products` or `/console/orders` on the API/Console origin, and open `/` on the Storefront origin. Local D1/R2 state lives under Wrangler's ignored local state directory; production config does not set `remote: true`, so local development cannot silently mutate remote bindings.

## Checks

```sh
npm run typecheck
npm run test:unit
npm run verification:s4-rehearsal:test
npm run test:integration
npm run test:browser
npm run test:e2e
npm run build:console
VITE_STOREFRONT_API_BASE_URL=http://127.0.0.1:5173 npm run build:storefront
```

The two production builds are independent. `npm run build` remains the API/Console default; `build:console` is its explicit alias, while `build:storefront` uses [`apps/storefront/vite.config.ts`](./apps/storefront/vite.config.ts). The corresponding artifacts can be inspected independently with `npm run preview:console` and `npm run preview:storefront`; all command ownership remains in [`package.json`](./package.json).

Console deployment uses the generated `apps/console/dist/nexus_s1_468cba/wrangler.json` after building; root Wrangler remains its source configuration and the migration entrypoint. Do not deploy the relocated Console using a bare root `wrangler deploy`: an old root `.wrangler/deploy` redirect can select a stale bundle. Use `npm run deploy:console` so the build and selected artifact stay paired.

`npm test` runs the workerd and browser Vitest suites. The Console build type-checks, builds the Worker/client bundle, and rejects a production import graph that reaches prototype scenario data.

Playwright starts both local Vite applications itself at distinct origins. Its Product, Variant, Order, and CSV suites use unique verification names against the current local API state; they do not provide a general Product delete endpoint.

## Locked evidence tooling

`design/reconciled-acceptance-manifest.md` version `nexus-s1-reconciled-1` is the sole **S1 catalog** Phase 6 acceptance authority. It does not prove S3 Order criteria. Initialize its one-row-per-ID ledger without claiming any pass:

```sh
npm run verification:ledger:init
```

The initializer writes synchronized CSV and JSON ledgers under `plans/260826-0041-nexus-s1-product-catalog/reports/evidence/`. Approved prototype paths are pre-linked, while command, observation, and pass fields remain empty. The checker fails on a stale manifest, missing/duplicate/extra IDs, evidence classes, misclassified or missing artifacts, unreviewed observations, public private-object keys, and incomplete passes:

```sh
npm run verification:ledger:check
npm run verification:ledger:summary -- --output plans/260826-0041-nexus-s1-product-catalog/reports/evidence/report-input.json
```

The summary is report input only. It does not infer a pass from a command exit.

## Remote resource and deployment sequence

The persisted API-side identities are:

- Worker: `nexus-s1-468cba`
- D1 database: `nexus-s1-468cba-db` (`DB`)
- Private R2 bucket: `nexus-s1-468cba-private` (`FILES`)

The Storefront Worker name is intentionally not embedded in [`apps/storefront/wrangler.jsonc`](./apps/storefront/wrangler.jsonc); its deploy command requires an appended confirmed name. Inspect the authenticated account and exact resources before mutation:

```sh
npx wrangler whoami
npx wrangler d1 list
npx wrangler r2 bucket list
```

Do not create replacement resources when an identity is absent or ambiguous. Resolve that condition against [`resource-identities.json`](./resource-identities.json), [`wrangler.jsonc`](./wrangler.jsonc), and [`apps/storefront/wrangler.jsonc`](./apps/storefront/wrangler.jsonc) first.

Use confirmed values for `$D1_DATABASE_NAME`, `$STOREFRONT_WORKER_NAME`, and the two exact deployed HTTPS origins below; do not construct or guess a Worker origin. Deployment order is dependency-bearing:

```sh
# 1. After proven prior-writer quiescence and an authorized checkpoint, apply pending append-only migrations through 0011 to the existing database. Never rewrite applied migrations. An export taken while traffic is live is not the rollback checkpoint.
npx wrangler d1 migrations apply "$D1_DATABASE_NAME" --remote

# 2. Build/deploy Storefront against the exact existing API origin; capture its returned origin.
VITE_STOREFRONT_API_BASE_URL="$EXACT_API_ORIGIN" npm run deploy:storefront -- "$STOREFRONT_WORKER_NAME"

# 3. Build/deploy API/Console with the exact deployed Storefront origin.
npm run deploy:console -- "STOREFRONT_ORIGIN:$EXACT_STOREFRONT_ORIGIN"
```

[`migrations/0008-better-auth.sql`](./migrations/0008-better-auth.sql), [`migrations/0009-store-memberships.sql`](./migrations/0009-store-memberships.sql), and [`migrations/0010-refund-decisions.sql`](./migrations/0010-refund-decisions.sql) are the S4 schema. [`migrations/0011-google-account-binding-uniqueness.sql`](./migrations/0011-google-account-binding-uniqueness.sql) enforces one Nexus user per Google subject and one Google subject per Nexus user. Never rewrite an applied migration. The Storefront build-time `VITE_STOREFRONT_API_BASE_URL` and API Worker runtime `STOREFRONT_ORIGIN` are opposite sides of the two-origin contract. Each value must be an origin only, with no credentials, path, query, or fragment. The deploy arguments above are values appended to the scripts' existing `--name` and `--var` options in [`package.json`](./package.json).

Remote S4 cutover changes authentication, API authorization, and schema state together. Do not infer a `workers.dev` hostname from the Worker name. Do not apply 0008–0011 remotely without an observable drain or rehearsed write barrier, an abort deadline, and an authorized checkpoint. Follow the unexecuted [S4 remote runbook](./plans/260911-1753-nexus-s4-identity-store-isolation/reports/remote-runbook.md). If that condition cannot be proven, restore ordinary serving and stop before schema mutation.

There is intentionally no generic deploy wrapper. Root [`wrangler.jsonc`](./wrangler.jsonc) and [`apps/storefront/wrangler.jsonc`](./apps/storefront/wrangler.jsonc) keep `workers_dev: true` and `preview_urls: false`; only the API Worker binds D1/R2 and routes `/api` Worker-first.

No deployment is claimed by this README. A controller must capture both returned `*.workers.dev` origins and run the remote gates before reporting deployment success.

## S4 remote preparation

S4 uses the dry-run-first `verification:s4-fixtures`, `provision:s4-identities`, and `verification:s4-remote:smoke` commands plus the named `s4-provisioning` binding environment for local validation and remote-input validation only. Remote cutover is blocked because remote identity provisioning and authenticated S4 smoke apply are not implemented or reviewed. The [S4 remote runbook](./plans/260911-1753-nexus-s4-identity-store-isolation/reports/remote-runbook.md) records a future procedure and stop conditions; it is not an executable cutover awaiting authorization.

## Legacy S1 remote smoke and private fixtures

Create a unique lowercase verification prefix and initialize the ignored private fixture manifest. `$EXACT_API_ORIGIN` must be the exact deployed API/Console HTTPS origin captured from Wrangler, not a constructed hostname:

```sh
PREFIX=verify-260826-a1
BASE_URL="$EXACT_API_ORIGIN"
PRIVATE_FIXTURES=plans/260826-0041-nexus-s1-product-catalog/reports/evidence/private/verification-fixtures.json
npm run verification:fixtures -- init \
  --fixture-manifest "$PRIVATE_FIXTURES" \
  --prefix "$PREFIX" \
  --base-url "$BASE_URL"
```

Validate all inputs without requests, fixture writes, or synthetic responses:

```sh
BASE_URL="$BASE_URL" npm run verification:remote:smoke -- run \
  --fixture-manifest "$PRIVATE_FIXTURES" \
  --prefix "$PREFIX" \
  --dry-run
```

After the controller has completed the local/config gates and direct deployment, run the real smoke:

```sh
BASE_URL="$BASE_URL" npm run verification:remote:smoke -- run \
  --fixture-manifest "$PRIVATE_FIXTURES" \
  --prefix "$PREFIX"
```

The smoke runner captures request/response facts under each remote manifest-ID directory and appends returned Product, Variant, import, and opaque object-alias records to the private fixture manifest as they become known. It never writes a private object key to public evidence. Object keys are not exposed by the HTTP API; the controller must resolve them with direct, reviewable D1 queries and update only the ignored private fixture manifest. Unresolved, retained, or snapshot-ambiguous objects block cleanup generation.

## Cleanup

Cleanup is generated only from the exact validated private fixture manifest. Before generation, verify each private object key against D1/R2 and classify it as `active_fixture` or `unreferenced_fixture` only when deletion is proven safe. Never reclassify a historical retained or snapshot-ambiguous object merely to make cleanup proceed.

```sh
npm run verification:fixtures -- check --fixture-manifest "$PRIVATE_FIXTURES"
npm run verification:fixtures -- generate-cleanup \
  --fixture-manifest "$PRIVATE_FIXTURES" \
  --output-dir plans/260826-0041-nexus-s1-product-catalog/reports/evidence/private/cleanup
```

Generation creates private `cleanup.sql`, `absence.sql`, and argv-form direct Wrangler commands; it performs no mutation. The controller executes the recorded commands directly and captures results. D1 cleanup disables fixture Variants first, then deletes memberships, Variants, values, groups, Products, and imports in foreign-key-safe order. Post-cleanup queries must prove the exact fixture IDs absent and `store_nexus`/`nexus` retained.

Cleanup must never use a broad name or R2 prefix sweep. Preserve non-fixture rows, the bootstrap Store, and every retained, unresolved, or snapshot-ambiguous object.

## Accepted public risk

The checked-out Console catalog and Order routes require authenticated Store membership. Storefront catalog and Order creation remain public, while Customer Order access uses the bearer capability. Input bounds mitigate public quota abuse but do not remove it.

The Storefront's private Order capability remains only in the URL fragment and explicit API header. It is still a bearer secret: never log, publish, paste, or share a private Order URL or raw capability. Neither surface may expose delivery configuration, private object identity, the raw capability, or Console-only external payment evidence in public Customer output.

The current remote `workers.dev` deployment has not been migrated or smoke-tested in this work, so it may still expose the earlier anonymous Console behavior. Do not treat local S4 evidence as a remote security claim. Automated payment verification and money return are S5. Receipts and MCP are S6.
