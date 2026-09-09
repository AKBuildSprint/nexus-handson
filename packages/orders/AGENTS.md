# Orders

Local constraints only. Root [`AGENTS.md`](../../AGENTS.md) is canonical.

- Reads/projections: [`src/queries/order-read.ts`](src/queries/order-read.ts)
- Create and command orchestration: [`src/commands/order-write.ts`](src/commands/order-write.ts), [`src/commands/order-commands.ts`](src/commands/order-commands.ts)
- D1 ledger/result/batch/recovery helpers: [`src/persistence/command-store.ts`](src/persistence/command-store.ts)
- Pure actor and eligibility rules: [`src/transitions/order-transitions.ts`](src/transitions/order-transitions.ts)
- Types, validation, and private-access stay at `src/` root

May import `@nexus/catalog/*`. Never import apps. Commands may import persistence and transitions; persistence and transitions must not import each other. SQL construction stays in the command that owns the transaction. Persist through one D1 `batch`; never split a transaction into sequential independent writes. Do not add a generic repository or a package barrel.

Private capability remains a bearer secret. Customer projections must not include Console-only payment evidence.
