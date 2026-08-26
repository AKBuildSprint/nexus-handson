# Nexus Product Catalog Console

Nexus is a React/Vite catalog Console served by a Cloudflare Worker. Product data is stored in D1 through the `DB` binding, and delivery files plus retained CSV originals are stored in a private R2 bucket through the `FILES` binding. The Console supports simple and Variant Products, private delivery configuration, schema preview/apply, and the unified CSV import contract.

This repository is configured for a public `workers.dev` teaching deployment. It has no custom domain and no public R2 route.

## Requirements

- Node.js 22 or newer
- npm (the lockfile is authoritative; install with `npm ci`)
- A Cloudflare login only for remote resource inspection, migrations, deployment, smoke verification, or cleanup

```sh
npm ci
```

The pinned verification toolchain is recorded in `package.json`: Cloudflare Vite plugin 1.54.0, Wrangler 4.126.0, Workers Vitest pool 0.22.0, Vitest 4.1.11, Playwright 1.62.1, and Papa Parse 5.7.0.

## Local development

Apply all D1 migrations to the local binding before starting the app:

```sh
npx wrangler d1 migrations apply nexus-s1-468cba-db --local
npm run dev
```

Vite serves the Console and Worker locally. Open `/console/products`. The supported Console routes are:

- `/console/products`
- `/console/products/new`
- `/console/products/:productSlug`
- `/console/products/import`

Local D1/R2 state lives under Wrangler's ignored local state directory. Production config does not set `remote: true`; local development therefore cannot silently mutate the remote bindings.

## Checks

```sh
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:browser
npm run test:e2e
npm run build
```

`npm test` runs the workerd and browser Vitest suites. `npm run build` type-checks, builds the Worker/client bundle, and rejects a production import graph that reaches prototype scenario data.

Playwright starts the local Vite application itself. Its Product, Variant, and CSV suites use unique verification names against the current local API state; they do not provide a general Product delete endpoint.

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

The persisted identities are:

- Worker: `nexus-s1-468cba`
- D1 database: `nexus-s1-468cba-db` (`DB`)
- Private R2 bucket: `nexus-s1-468cba-private` (`FILES`)

Inspect the authenticated account and exact resources before mutation:

```sh
npx wrangler whoami
npx wrangler d1 list
npx wrangler r2 bucket list
```

Do not create replacement resources when an identity is absent or ambiguous. Resolve that condition against `resource-identities.json` and `wrangler.jsonc` first. The configured remote sequence uses direct Wrangler commands:

```sh
npx wrangler d1 migrations apply nexus-s1-468cba-db --remote
npm run build
npx wrangler deploy
```

There is intentionally no deploy wrapper. `wrangler.jsonc` sets `workers_dev: true`, `preview_urls: false`, SPA asset fallback, and Worker-first routing for `/api` and `/api/*`. It defines no `route`, `routes`, custom domain, `r2.dev` exposure, or public R2 read route.

No deployment is claimed by this README. A controller must capture the returned `*.workers.dev` URL and run the remote gates before reporting deployment success.

## Remote smoke and private fixtures

Create a unique lowercase verification prefix and initialize the ignored private fixture manifest. The base URL must be the exact deployed HTTPS `workers.dev` origin:

```sh
PREFIX=verify-260826-a1
BASE_URL=https://nexus-s1-468cba.<account-subdomain>.workers.dev
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

Console read, write, import, and upload routes are intentionally anonymous in S1. Anonymous users can mutate the catalog and consume Worker, D1, and R2 quota; size, type, and combination bounds mitigate but do not remove abuse risk. The `workers.dev` site is a public teaching deployment, not a custom-domain or business-critical production/security claim. Real identity and permissions belong to S4.
