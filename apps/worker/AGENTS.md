# `@nexus/worker`

Local constraints. Root [`AGENTS.md`](../../AGENTS.md) wins on conflict.

- HTTP composition only: Env, JSON envelope, CORS, route modules. Domain logic stays in `@nexus/catalog` and `@nexus/orders`.
- Do not reorder `src/index.ts` fetch dispatch without an explicit API-behavior change. `/api` requires `DB`+`FILES`; everything else is `ASSETS`.
- Root `wrangler.jsonc` `main` is `apps/worker/src/index.ts`. Bindings `DB`/`FILES`, D1 id, and `run_worker_first` `/api` stay there. After changing `main`, regenerate `worker-configuration.d.ts` with `npx wrangler types`.
- Tests import the worker as `apps/worker/src` (see `tests/support/catalog-test-env.ts`). Workerd tests do not load `wrangler.jsonc`; they apply `migrations/*.sql` via that helper.
