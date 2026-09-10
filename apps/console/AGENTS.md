# Console

Local constraints only. Root [`AGENTS.md`](../../AGENTS.md) is canonical.

Vite root is this app. Keep the Cloudflare plugin `configPath` on repo-root `wrangler.jsonc` and `persistState` under repo-root `.wrangler`. Do not add an app-local Wrangler.

Tokens: [`src/styles/design-tokens.css`](src/styles/design-tokens.css). Destinations remain Products and Orders. Import `@nexus/catalog/*` only — do not depend on `@nexus/orders`. Order UI types stay in this app.

Google-only login protects the Console. Keep role switching and custom-domain chrome out of scope; allowed accounts share single-store operator access. Follow `docs/google-console-login.md` at the repository root for setup and access behavior.
