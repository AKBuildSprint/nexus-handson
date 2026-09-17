---
phase: 2
title: "Webhook adapter and local proof"
status: pending
priority: P1
effort: "1 phase"
dependencies: [1]
---

# Phase 2: Webhook adapter and local proof

## Outcome

Expose a public, API-key-only PayFS webhook endpoint that delegates to the atomic Phase 1 command and acknowledges only durable terminal outcomes.

## Requirements

- Add optional Worker bindings for `PAYFS_WEBHOOK_API_KEY`, `PAYFS_MERCHANT_BANK`, and `PAYFS_MERCHANT_ACCOUNT`. Missing values fail closed only on the PayFS route.
- Add `apps/worker/src/payfs-webhook-routes.ts` to enforce exact path/method, a bounded request body, API-key equality, strict JSON parsing, and safe outcome mapping.
- Dispatch the PayFS route in `apps/worker/src/index.ts` before Storefront preflight and Console authentication. It must require no Console session, capability, Origin, Nexus contract header, or client idempotency key.
- Do not add CORS headers, cron, PayFS query calls, external email, or Worker-side SQL.
- Return `200` only after a confirmed, replayed, or terminally ignored durable receipt; `400` for invalid payload/conflicting facts; `401` for failed authentication; `405` for non-POST; `503` for missing configuration; `500` for retryable internal failure.
- Keep acknowledgements generic: no transaction ID, Order reference, recipient-match result, raw content, key, or secret.

## Touchpoints

- Modify: `apps/worker/src/environment.ts`
- Modify: `apps/worker/src/index.ts`
- Create: `apps/worker/src/payfs-webhook-routes.ts`
- Modify: `tests/support/catalog-test-env.ts`
- Modify: `tests/integration/order-operations-routes.test.ts`
- Modify: `README.md` only after verified behavior

## Tests

Exercise the real Worker dispatcher with synthetic bindings. Prove the no-credential/no-CORS boundary; authentication failure has no write; valid confirmation, durable replay, terminal rejection, malformed payload, wrong methods including `OPTIONS`, absent configuration, and failed persistence use their documented safe outcomes. Run local D1 migration and a VND exact-match/replay/mismatch smoke.

## Success criteria

- [x] The Worker accepts one exact API-key-authenticated PayFS credit and confirms its Order once.
- [x] All public errors and acknowledgements are safe and generic.
- [x] Existing manual payment/refund/Storefront routes still behave as before.
- [x] Local proof covers confirmation, replay, and a non-settling mismatch; no remote deployment is claimed.
