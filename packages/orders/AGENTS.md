# `@nexus/orders`

Local constraints. Root [`AGENTS.md`](../../AGENTS.md) wins on conflict.

- Order domain only. Depend on `@nexus/catalog` (`catalog-read`, `slug`, `catalog-types`, `private-order-snapshot`). Do not copy `BOOTSTRAP_STORE_ID` or `stableId`.
- NEVER import `apps/*`. NEVER let catalog import this package.
- Consumers import `@nexus/orders/<file>`. No barrel.
- HTTP/CORS/body limits stay in `apps/worker`. Keep command/read/write here.
