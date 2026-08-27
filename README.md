# Nexus Console, API, and Storefront

Nexus has two independently built and deployed surfaces: the React/Vite Console served by the API Worker, and a static Storefront that calls that Worker from a distinct origin. Product and Order data is stored in D1 through the `DB` binding, while delivery files and retained CSV originals stay in a private R2 bucket through the `FILES` binding.

This repository is configured for public `workers.dev` teaching deployments. It has no custom domain and no public R2 route.

## Requirements

- Node.js 22 or newer
- npm (the lockfile is authoritative; install with `npm ci`)
- A Cloudflare login only for remote resource inspection, migrations, deployment, smoke verification, or cleanup

```sh
npm ci
```

The pinned verification toolchain is recorded in `package.json`: Cloudflare Vite plugin 1.54.0, Wrangler 4.126.0, Workers Vitest pool 0.22.0, Vitest 4.1.11, Playwright 1.62.1, and Papa Parse 5.7.0.

## Local development

Apply all D1 migrations to the local API binding first:

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
npm run test:integration
npm run test:browser
npm run test:e2e
npm run build:console
VITE_STOREFRONT_API_BASE_URL=http://127.0.0.1:5173 npm run build:storefront
```

The two production builds are independent. `npm run build` remains the API/Console default; `build:console` is its explicit alias, while `build:storefront` uses [`storefront/vite.config.ts`](./storefront/vite.config.ts). The corresponding artifacts can be inspected independently with `npm run preview:console` and `npm run preview:storefront`; all command ownership remains in [`package.json`](./package.json).

`npm test` runs the workerd and browser Vitest suites. The Console build type-checks, builds the Worker/client bundle, and rejects a production import graph that reaches prototype scenario data.

Playwright starts both local Vite applications itself at distinct origins. Its Product, Variant, Order, and CSV suites use unique verification names against the current local API state; they do not provide a general Product delete endpoint.

## Locked evidence tooling

`design/reconciled-acceptance-manifest.md` version `nexus-s1-reconciled-1` is the sole Phase 6 acceptance authority. Initialize its one-row-per-ID ledger without claiming any pass:

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

The Storefront Worker name is intentionally not embedded in [`storefront/wrangler.jsonc`](./storefront/wrangler.jsonc); its deploy command requires an appended confirmed name. Inspect the authenticated account and exact resources before mutation:

```sh
npx wrangler whoami
npx wrangler d1 list
npx wrangler r2 bucket list
```

Do not create replacement resources when an identity is absent or ambiguous. Resolve that condition against [`resource-identities.json`](./resource-identities.json), [`wrangler.jsonc`](./wrangler.jsonc), and [`storefront/wrangler.jsonc`](./storefront/wrangler.jsonc) first.

Use confirmed values for `$D1_DATABASE_NAME`, `$STOREFRONT_WORKER_NAME`, and the two exact deployed HTTPS origins below; do not construct or guess a Worker origin. Deployment order is dependency-bearing:

```sh
# 1. Apply pending migrations, including the append-only Orders migration, before the API deploy.
npx wrangler d1 migrations apply "$D1_DATABASE_NAME" --remote

# 2. Build/deploy Storefront against the exact existing API origin; capture its returned origin.
VITE_STOREFRONT_API_BASE_URL="$EXACT_API_ORIGIN" npm run deploy:storefront -- "$STOREFRONT_WORKER_NAME"

# 3. Build/deploy API/Console with the exact deployed Storefront origin.
npm run deploy:console -- "STOREFRONT_ORIGIN:$EXACT_STOREFRONT_ORIGIN"
```

[`migrations/0004-orders.sql`](./migrations/0004-orders.sql) is appended after the S1 migrations; never rewrite an applied migration. The Storefront build-time `VITE_STOREFRONT_API_BASE_URL` and API Worker runtime `STOREFRONT_ORIGIN` are opposite sides of the two-origin contract. Each value must be an origin only, with no credentials, path, query, or fragment. The deploy arguments above are values appended to the scripts' existing `--name` and `--var` options in [`package.json`](./package.json).

There is intentionally no generic deploy wrapper. The two Wrangler configs keep `workers_dev: true` and `preview_urls: false`; only the API Worker binds D1/R2 and routes `/api` Worker-first.

No deployment is claimed by this README. A controller must capture both returned `*.workers.dev` origins and run the remote gates before reporting deployment success.

## Remote smoke and private fixtures

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

Console read/write/import/upload routes and its read-only Orders view remain intentionally anonymous through this teaching slice. Anonymous visitors can mutate catalog state, create Storefront Orders, view the Console's reduced Customer/Order projection, and consume Worker, D1, and R2 quota; input bounds mitigate but do not remove abuse risk.

The Storefront's private Order capability remains only in the URL fragment and explicit API header. It is still a bearer secret: never log, publish, paste, or share a private Order URL or raw capability. Neither surface may expose delivery configuration, private object identity, or the raw capability in public output.

These public `workers.dev` surfaces are anonymous demos, not a custom-domain, business-critical production, payment, or security claim. Real identity and permissions remain later-scope work.
