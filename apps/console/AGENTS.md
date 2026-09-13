# Console

Local constraints only. Root [`AGENTS.md`](../../AGENTS.md) is canonical.

Vite root is this app. Keep the Cloudflare plugin `configPath` on repo-root `wrangler.jsonc` and `persistState` under repo-root `.wrangler`. Do not add an app-local Wrangler.

Tokens: [`src/styles/design-tokens.css`](src/styles/design-tokens.css). Destinations remain Products and Orders. Import `@nexus/catalog/*` only — do not depend on `@nexus/orders`. Order UI types stay in this app.

Console uses prebound Google sign-in and shows the resolved Store and Owner/Staff role. Do not add signup, role switching, Store switching, team administration, or custom-domain chrome.
