# `@nexus/catalog`

Local constraints. Root [`AGENTS.md`](../../AGENTS.md) wins on conflict.

- Owns catalog, CSV import (`src/import/`), delivery files (`src/files/`), and former `shared/` (`src/shared/`).
- NEVER import `@nexus/orders` or `apps/*`.
- After flatten: catalog-root files use `./shared/…`; `import/` and `files/` use `../…` for catalog modules and `../shared/…` for shared. Do not keep old `../catalog/…` paths.
- Consumers import `@nexus/catalog/<file>` (nested: `@nexus/catalog/import/csv-parser`). No `index.ts` barrel.
- `papaparse` stays a dependency of this package. Keep root `papaparse` while scripts/tests still import it directly.
- D1/`R2Bucket` types come from the root Worker/test env. Do not invent a package-local `Env`.
