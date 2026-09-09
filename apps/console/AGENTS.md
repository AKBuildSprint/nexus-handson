# Console

Local constraints only. Root [`AGENTS.md`](../../AGENTS.md) is canonical.

Vite root is this app. Keep the Cloudflare plugin `configPath` on repo-root `wrangler.jsonc` and `persistState` under repo-root `.wrangler`. Do not add an app-local Wrangler.

Tokens: [`src/styles/design-tokens.css`](src/styles/design-tokens.css). Destinations remain Products and Orders. Import `@nexus/catalog/*` only — do not depend on `@nexus/orders`. Order UI types stay in this app.

Do not add login, role switching, or custom-domain chrome. Console remains an anonymous bootstrap demo.
