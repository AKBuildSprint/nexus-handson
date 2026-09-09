# Agent rules

Follow [`docs/design-guidelines.md`](docs/design-guidelines.md) for presentation WHY. Executable tokens: [`src/console/styles/design-tokens.css`](src/console/styles/design-tokens.css). Storefront subset: [`storefront/src/styles.css`](storefront/src/styles.css) `:root`. Keep those files aligned. Do not add a second type pair, color ramp, radius, or shadow scale.

## Do

- Brand chrome **Nexus** (Operations Console / STOREFRONT).
- New color, type, space, radius, shadow: add a token first, then use `var(--…)`.
- Metric / snapshot numbers: Products and catalog snapshots from loaded catalog rows; Order inbox metrics from ConsoleOrderSummary for current server filters, never the current page of Orders.
- Console destinations: **Products** and **Orders** only.
- `npm ci`; Node 22. Local D1: `npx wrangler d1 migrations apply nexus-s1-468cba-db --local`.

## Don't

- Faire, Atelier, North Studio, or other marketplace branding.
- Safety-orange, Barlow Condensed, Source Sans 3, Familjen Grotesk.
- Invented revenue, Net-60, MOQ, boutique, or analytics nav.
- Rewrite applied files under `migrations/`.
- One-off hex / `px` / box-shadow beside the token files.

Before reporting UI work done: check 375 px for horizontal scroll, and that primary actions still use `color-accent` fill with `color-accent-ink` text.
