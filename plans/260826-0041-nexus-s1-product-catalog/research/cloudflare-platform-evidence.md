# Cloudflare platform evidence

## Recommendation

After frontend approval, use Node 22, TypeScript, React/Vite, `@cloudflare/vite-plugin`, one native module Worker, Wrangler SQL migrations, native D1/R2 bindings, `@cloudflare/vitest-plugin`, Wrangler `createTestHarness()` and Playwright.

Avoid an ORM. Start with direct Worker route dispatch; add a router only if the approved surface makes dispatch materially complex.

Use Vite for dev/build and Wrangler directly for resources/deploy:

```text
vite build
wrangler deploy
```

No deploy wrapper or custom domain.

## Verified platform behavior

| Topic | Verified behavior | Plan consequence |
|---|---|---|
| Vite plugin | Runs Worker code in workerd and builds SPA/full-stack assets. | Use it after design approval; do not hand-code generated asset output paths. |
| SPA/API routing | SPA fallback and `run_worker_first` route patterns coexist. | Route `/api` and `/api/*` to Worker first so API 404 never returns HTML. |
| workers.dev | Worker `name` becomes `<name>.<subdomain>.workers.dev`; URL is public. | Generate suffix once, persist full name, set `workers_dev: true`, `preview_urls: false`, no custom route. |
| Worker limits | Request body is at least 100 MB; isolate memory 128 MB. | 25 MB upload fits but must stream; CSV stays capped at 1 MB/500 rows. |
| D1 batch | Statements execute sequentially as one transaction; failure rolls back the sequence. | Use bounded prepared multi-row statements in one `DB.batch()` per catalog mutation/import commit. |
| D1 Free limits | 50 queries/invocation, 100 bound parameters/query, 100 KB SQL/query. | Chunk Variant/membership inserts by parameter count and keep every batch below 50 statements. |
| R2 put/delete | `put()` accepts `ReadableStream`; writes/deletes are strongly consistent. | Stream delivery files; put first, write D1 metadata second, delete new object on D1 failure. |
| Private bucket | Bucket is private until public access is enabled; Worker routes can still expose it. | Never enable r2.dev/custom domain; no direct file read route in S1. |
| Testing | Cloudflare recommends Workers Vitest and `createTestHarness()`; harness integrates with Playwright. | Unit/runtime tests in workerd, built HTTP harness tests, then browser and remote smoke. |

## Direct Wrangler configuration

- `name`: `nexus-s1-<six lowercase alphanumeric characters>`, generated once.
- `main`: one Worker entry.
- `compatibility_date`: current at scaffold time.
- `workers_dev: true`.
- `preview_urls: false`.
- No `route` or `routes`.
- `assets.not_found_handling: "single-page-application"`.
- `assets.run_worker_first: ["/api", "/api/*"]`.
- One D1 binding `DB` with migrations directory.
- One private R2 binding `FILES`; no `r2.dev` or custom domain.
- Local bindings for routine development; no persisted production `remote: true`.

Direct lifecycle after design approval:

```text
wrangler whoami
wrangler d1 create <worker-name>-db
wrangler r2 bucket create <worker-name>-private
wrangler d1 migrations apply <database> --local
vite build
wrangler d1 migrations apply <database> --remote
wrangler deploy
```

Persist returned D1 ID and bucket name in `wrangler.jsonc`. Reruns reuse them rather than creating new resources.

## Upload and transaction consequences

### Delivery file

- Contract unit: 25,000,000 bytes.
- Use raw-body upload endpoint and a stream that counts actual bytes.
- Inspect PDF/ZIP prefix before forwarding reconstructed stream to R2.
- Never clone/fully buffer a 25 MB request.
- Store minimal detected metadata.
- R2 and D1 have no shared transaction. Use R2-first write plus bounded idempotent delete compensation.

### Variant writes

- Maximum memberships: 30 Variants × 5 groups = 150 rows.
- Generate stable IDs before creating membership statements.
- Chunk multi-row statements by `floor(100 / bound-columns-per-row)`.
- Put all chunks for one mutation in one `DB.batch()` and force a late-statement failure test to prove rollback.

### CSV

- Product decision: UTF-8, max 1 MB and 500 data rows.
- Parse incrementally or from the bounded 1 MB body.
- Verify parser/package behavior before locking it.
- Preclassify Product groups, then commit accepted groups plus import metadata atomically.
- Benchmark a representative 500-row file on deployed workers.dev; account plan/CPU remains unknown.

## Verification surfaces

1. User-approved frontend prototype before platform work.
2. Workers Vitest: D1/R2/domain behavior in workerd.
3. Built HTTP harness: SPA/API routing, streamed upload boundaries and compensation.
4. Playwright against harness: approved Product/Variant/import flows, responsive and keyboard states.
5. Remote workers.dev smoke: stable name/URL, migrations, Product journey, max Variant mutation, representative CSV and private R2 behavior.
6. Config review: one Worker, one D1, one private R2, no custom route/domain.

## Official sources

- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [Vite plugin static assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)
- [SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R2 privacy](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/#5-bucket-access-and-privacy)
- [Workers testing](https://developers.cloudflare.com/workers/testing/)
- [Workers test harness](https://developers.cloudflare.com/workers/testing/test-harness/)

## Status

**Status:** DONE_WITH_CONCERNS
**Summary:** Current Cloudflare docs support the frontend-first Vite/Worker/D1/R2 plan and direct Wrangler workers.dev deployment.
**Concerns/Blockers:** Workers plan/CPU is unknown; remote 500-row CSV benchmark is mandatory. `workers.dev` is public and not positioned by Cloudflare as business-critical production, but this is an accepted S1 constraint.
