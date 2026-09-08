# Agent rules

Authority for this repo. Nested `AGENTS.md` files add local constraints only; they never override this file. Human product/deploy narrative lives in `README.md` — do not duplicate it here.

Claude Code: follow this file via `CLAUDE.md`.

## Tooling

- Node ≥ 22. Install with `npm ci` from the **repo root**. Lockfile is `package-lock.json` (npm workspaces). Do not switch to pnpm/yarn.
- Every `package.json` script assumes CWD = repo root.
- `tests/unit` and `tests/integration` run in **workerd** (`vitest.config.ts` + `cloudflareTest`). Do not put host-filesystem checks there. Use `npx tsx scripts/assert-workspace-layout.ts` for layout/identity.
- Layout, wrangler identities, and migration SHA-256: `npm run assert:workspace-layout`.

## Do not

- Rewrite or reformat `migrations/0001-store-products.sql` … `0005-order-operations.sql`. Append-only new files only.
- Move root `wrangler.jsonc` or `migrations/`. Do not add `migrations_dir` unless that config file moves (it must not).
- Add `packages/shared` or extra workspace packages unless explicitly requested.
- Import `@nexus/orders` from `@nexus/catalog`.
- Import `@nexus/catalog` or `@nexus/orders` from `apps/storefront`.
- Point production Console (`apps/console/src/main.tsx`) at `console-app.tsx` or `design/`.
- Log, print, or commit a raw private Order capability, private object key, or `.dev.vars`.
- Create replacement Cloudflare Worker/D1/R2 identities when `resource-identities.json` / `wrangler.jsonc` already name them.
- Claim a remote deploy or remote D1 proof from local tests.
- Weaken or delete tests to go green.

## Boundaries

- `packages/catalog` — catalog + CSV import + delivery files + former `shared/`.
- `packages/orders` — orders only; may import `@nexus/catalog/*`.
- `apps/worker` — HTTP/CORS/Env composition. Domain stays in packages.
- `apps/console` — may import catalog/orders (CSV preview, money, types).
- `apps/storefront` — HTTP-only second origin.
- Package imports: `@nexus/catalog/<file>` and `@nexus/orders/<file>` (`exports`: `"./*": "./src/*.ts"`). No barrels.

## Two origins

`STOREFRONT_ORIGIN` is the **Storefront** origin (Worker CORS allow-list; must equal the browser Origin). `VITE_STOREFRONT_API_BASE_URL` is the **API/Console** origin (Storefront fetch target). Opposite sides of one contract: two distinct origins, each origin-only (no path/query/credentials). A Storefront page whose origin ≠ `STOREFRONT_ORIGIN` cannot read Storefront API in a browser. Vite-dev CORS is not production CORS.

Local default: Console/API `http://127.0.0.1:5173`, Storefront `http://127.0.0.1:5174`. If you move Storefront's port, change `STOREFRONT_ORIGIN` to that new Storefront origin — do **not** set it equal to `VITE_STOREFRONT_API_BASE_URL`. If you move the API port, change `VITE_STOREFRONT_API_BASE_URL` to the new API origin.

## Before reporting done

From repo root:

```sh
npm run typecheck
npm run test:unit
npm run test:integration
npm run assert:workspace-layout
```

For UI, Vite, Wrangler `main`, or origin/CORS changes also run `npm run test:browser`, `npm run build:console`, and `VITE_STOREFRONT_API_BASE_URL=http://127.0.0.1:5173 npm run build:storefront`. Prove two-origin behavior in a browser or Playwright with Storefront origin = `STOREFRONT_ORIGIN` and API origin = `VITE_STOREFRONT_API_BASE_URL` (they differ). Do not curl with a synthetic `Origin`.

`npm run test:e2e` is the two-origin Playwright suite (Playwright starts both apps). Use it when the change can break Console/Storefront journeys; do not treat workerd tests as that proof.

## Scoped files

- `packages/catalog/AGENTS.md`
- `packages/orders/AGENTS.md`
- `apps/worker/AGENTS.md`
- `apps/storefront/AGENTS.md`
