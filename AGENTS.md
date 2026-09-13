# Agent rules

This file is canonical. Scoped `AGENTS.md` under `apps/`, `packages/`, `tests/`, and `migrations/` add local constraints only — do not copy these rules there.

Follow [`docs/design-guidelines.md`](docs/design-guidelines.md) for presentation WHY. Executable tokens: [`apps/console/src/styles/design-tokens.css`](apps/console/src/styles/design-tokens.css). Storefront subset: [`apps/storefront/src/styles.css`](apps/storefront/src/styles.css) `:root`. Keep those files aligned. Do not add a second type pair, color ramp, radius, or shadow scale.

Run npm, Wrangler, Vite, and tests from the repository root. Root [`wrangler.jsonc`](wrangler.jsonc) owns Console/API config and local D1/R2 state. Do not add a second Console/API Wrangler. Storefront config is [`apps/storefront/wrangler.jsonc`](apps/storefront/wrangler.jsonc) only.

## Do

- Brand chrome **Nexus** (Operations Console / STOREFRONT).
- New color, type, space, radius, shadow: add a token first, then use `var(--…)`.
- Metric / snapshot numbers: Products and catalog snapshots from loaded catalog rows; Order inbox metrics from ConsoleOrderSummary for current server filters, never the current page of Orders.
- Console destinations: **Products** and **Orders** only.
- `npm ci`; Node 22. Local D1: `npx wrangler d1 migrations apply nexus-s1-468cba-db --local`.
- Worker composes `@nexus/catalog/*` and `@nexus/orders/*`. Console consumes catalog only; keep Order UI types in the Console app. Storefront stays HTTP-only. Orders may depend on catalog. Catalog and packages never depend on apps. Catalog never depends on orders.
- Worker stays HTTP adapters and platform composition. Domain writes, SQL batches, and transition rules stay in packages.

## Don't

- Faire, Atelier, North Studio, or other marketplace branding.
- Safety-orange, Barlow Condensed, Source Sans 3, Familjen Grotesk.
- Invented revenue, Net-60, MOQ, boutique, or analytics nav.
- Rewrite applied files under `migrations/`.
- One-off hex / `px` / box-shadow beside the token files.
- Compatibility barrels, old `src/` shims, or a generic shared package.
- Claim that the checked-out S4 authentication and Store isolation are deployed without remote migration, provisioning, and smoke evidence.

Before reporting UI work done: check 375 px for horizontal scroll, and that primary actions still use `color-accent` fill with `color-accent-ink` text.
