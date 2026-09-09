# Storefront

Local constraints only. Root [`AGENTS.md`](../../AGENTS.md) is canonical.

HTTP-only consumer of the API Worker from a distinct origin. Do not import `@nexus/catalog` or `@nexus/orders`. Own Wrangler is [`wrangler.jsonc`](wrangler.jsonc); deploy still requires an appended `--name`. Do not bind D1 or R2 here.

Token subset lives in [`src/styles.css`](src/styles.css) `:root` and must stay aligned with Console tokens. Never log, publish, or render the raw Order capability, delivery configuration, or Console-only payment evidence.
