# Migrations

Local constraints only. Root [`AGENTS.md`](../AGENTS.md) is canonical.

Append-only history. Never rewrite an applied `.sql` file, including 0001–0007.

Apply through root [`wrangler.jsonc`](../wrangler.jsonc): `npx wrangler d1 migrations apply nexus-s1-468cba-db --local`. Do not add a second migrations directory or Wrangler D1 binding.
