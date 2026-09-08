# `@nexus/storefront`

Local constraints. Root [`AGENTS.md`](../../AGENTS.md) wins on conflict.

- HTTP-only. NEVER import `@nexus/catalog` or `@nexus/orders`. Talk to `/api/storefront/*` through `src/api-client.ts`.
- Second origin. `VITE_STOREFRONT_API_BASE_URL` is the **API/Console** origin (fetch target, no path). Worker `STOREFRONT_ORIGIN` is **this** Storefront origin (browser `Origin` / CORS allow-list). They must be different origins. Example local: API `http://127.0.0.1:5173`, Storefront `http://127.0.0.1:5174`.
- Vite `projectRoot` is two levels up (`../..`). Wrangler `$schema` is `../../node_modules/wrangler/config-schema.json`. Assets `./dist` is relative to this folder.
- Root scripts: `--config apps/storefront/vite.config.ts` and `--config apps/storefront/wrangler.jsonc`. Deploy name is passed on the CLI (`deploy:storefront -- <name>`), not in wrangler config.
- Production Storefront build must not reach catalog/orders modules.
