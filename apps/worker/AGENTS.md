# Worker

Local constraints only. Root [`AGENTS.md`](../../AGENTS.md) is canonical.

HTTP adapters and platform composition only. Do not move catalog/order domain writes, SQL batches, or transition rules here.

Same-origin Console+API through root `wrangler.jsonc`. Storefront CORS uses runtime `STOREFRONT_ORIGIN`. Keep current Order contract and private-capability status/body semantics (409 vs indistinguishable 404). Packages must not import this app.
