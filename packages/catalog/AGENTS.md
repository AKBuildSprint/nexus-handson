# Catalog

Local constraints only. Root [`AGENTS.md`](../../AGENTS.md) is canonical.

Owns product catalog plus `import/`, `files/`, and `shared/`. Do not depend on `@nexus/orders` or any app.

CSV import stays additive exact-match against the fixed template. Delivery object identity and private snapshot fields stay out of public catalog and Customer output. Create-time Order item snapshots stay in [`src/private-order-snapshot.ts`](src/private-order-snapshot.ts). Papaparse stays in this capability.
