---
title: "PayFS webhook-only payment confirmation"
description: "Confirm exact eligible VND bank-transfer Orders from authenticated PayFS webhooks, with durable deduplication and no reconciliation, email, or new payment UI."
status: completed
priority: P1
effort: "2 phases"
issue: null
branch: "itsddvn/payment-intergration"
tags: [feature, payments, backend, database, api, critical]
blockedBy: []
blocks: []
created: 2026-09-15
---

# PayFS webhook-only payment confirmation

## Outcome

A public `POST /api/payfs/webhook` accepts a documented PayFS `transaction.credit` notification and changes only the exact matching Nexus Order from `pending` to `paid`, once. The Worker authenticates the sender with `X-Client-API-Key`; package-owned D1 code performs all payment evidence, history, and transition writes atomically.

## Confirmed scope

- PayFS authentication is API key only. HMAC signature and timestamp validation are explicitly deferred.
- A confirmation requires: `credit`; a positive, safe-integer VND amount; exact configured merchant bank and account; exactly one matching generated Nexus payment reference in the transfer content; and a pending VND Order whose total equals the received amount.
- The provider `transaction_id` is globally deduplicated. A duplicate cannot create another history record, payment receipt, or transition.
- Existing Console payment detail must remain truthful for PayFS-confirmed Orders. This is a compatibility repair, not a new Console payment workflow.
- Manual payment, refunds, existing Storefront behavior, and existing public/Console contracts remain intact except for the additive provider-payment detail variant.

## Explicit non-goals

No PayFS transaction querying, scheduled reconciliation, cron, email/outbox/reminders, Console recheck/work queue/incident acknowledgement, Storefront transfer instructions, QR/VietQR, hosted checkout, cards, wallets, automatic refunds, remote migration/deployment, or callback registration.

## Security and reliability boundary

The Worker must fail closed if its database or required PayFS configuration is absent. It must not require a Console session, Customer capability, browser Origin, Nexus contract header, or client idempotency key. It must not log or return API keys, bank account details, raw content, provider IDs, or matched Order identifiers.

API-key-only authentication has an accepted high residual risk: possession of a webhook key can forge a new matching credit. Exact recipient/reference/amount checks, TLS, secrets-only storage, and durable transaction deduplication reduce accidental errors but do not provide payload integrity or replay freshness. A missing webhook has no automatic recovery; normal manual payment remains the fallback.

## Architecture

```text
PayFS transaction.credit
  -> POST /api/payfs/webhook
  -> Worker: method, configuration, API-key and payload gate
  -> @nexus/orders: exact match + durable provider receipt
  -> one D1 batch: system order_paid history, pending -> paid, confirmed receipt
  -> safe 200 acknowledgement only after durable terminal outcome
```

`payments` remains the populated manual ledger. An additive companion receipt table carries PayFS transaction identity and links confirmed receipts to the Order and system history. No Worker-side SQL and no reuse of the identity-bound Console `markPaid` command.

## Invariants

1. Customer input, browser state, and payload `account_id` never select an Order or Store.
2. The trusted Store binding and merchant recipient come from Worker configuration; `account_id` is validated evidence only.
3. The matcher recognizes a complete generated `NP` + 32 hexadecimal payment-reference token with token boundaries. Repeated instances of the same token are acceptable; two distinct tokens reject the credit.
4. Every confirmed receipt, `order_paid` history event, and `pending -> paid` transition commits together or rolls back together.
5. The same `transaction_id` plus the same normalized facts replays its durable outcome. The same ID with different facts is rejected and never retargeted.
6. Rejected semantic credits have no financial side effect. They receive a durable ignored receipt only after structural validation and API-key authentication.
7. All client responses remain free of provider evidence, recipient-match detail, and secrets.

## Phases

| # | Phase | Status | Depends on | Outcome |
|---|---|---|---|---|
| 1 | [Atomic PayFS settlement and compatibility](./phase-01-start.md) | Pending | — | Add exact validation, provider receipt dedupe, atomic system settlement, and truthful existing Console detail projection. |
| 2 | [Webhook adapter and local proof](./phase-02-payfs-domain-ledger.md) | Pending | 1 | Add the API-key-only Worker endpoint, safe HTTP semantics, local migration, and focused integration proof. |

## Acceptance criteria

- [ ] A configured, API-key-authenticated exact PayFS credit creates one confirmed provider receipt, one system `order_paid` history record, and one `paid` transition.
- [ ] Replaying a credit, racing duplicate deliveries, or losing the first response cannot create a second durable payment effect.
- [ ] A wrong/missing key, malformed payload, debit, invalid amount, wrong merchant recipient, missing/ambiguous reference, wrong total, non-VND, or non-pending Order leaves all financial state unchanged.
- [ ] Same transaction ID with conflicting normalized facts is rejected and cannot overwrite or retarget the original receipt.
- [ ] Existing manual-payment and refund behavior remains unchanged; existing Console detail never labels a PayFS payment as a missing legacy payment or exposes its transaction ID.
- [ ] The endpoint returns only safe documented outcomes, has no Storefront CORS behavior, and returns 2xx only after a durable terminal outcome.
- [ ] Focused tests and a local Worker smoke prove one valid VND confirmation and duplicate/mismatch safety. No remote deployment or callback registration is claimed.

## Public contract

`POST /api/payfs/webhook` is the only new endpoint. It accepts the documented flat PayFS transaction payload and `X-Client-API-Key`.

| Condition | Response |
|---|---|
| Exact credit committed | `200` safe `confirmed` acknowledgement |
| Identical durable replay | `200` safe `already_processed` acknowledgement |
| Durable semantic rejection | `200` safe `ignored` acknowledgement |
| Invalid payload or conflicting transaction facts | `400` generic error |
| Missing/wrong API key | `401` generic error |
| Wrong method, including `OPTIONS` | `405`, `Allow: POST` |
| Missing Worker configuration/database | `503` generic error |
| Persistence/internal failure | `500` retryable generic error |

The Console payment projection gains a source-discriminated `payfs` variant with no provider transaction ID and no external-reference display. Manual projection fields remain unchanged.

## Verification strategy

- Unit: payload shape, amount, date, recipient, reference-boundary, and matching cases.
- Migration/domain: populated database preservation, foreign keys, exact settlement, duplicate/conflicting transactions, concurrent manual/cancel races, and rollback on injected batch failures.
- Worker: API-key gate, method/configuration status, real dispatcher path, safe response shape, no CORS, no credentials/capabilities/contract headers, and no privacy leakage.
- Local smoke: create a VND Order, post an exact synthetic credit through the Worker, observe `paid`, replay it, then post a mismatch and prove no collateral settlement.

## Deployment boundary

Live enablement requires replacement webhook credentials and recipient configuration in Worker secrets plus a reachable callback origin. It remains outside this plan; this plan does not deploy, rotate secrets, register a callback, migrate remote D1, or claim S4 readiness.

## References

- PayFS webhook contract: https://docs.payfs.vn/vi/developers/webhooks
- D1 batch semantics: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
- Existing manual payment implementation: `packages/orders/src/commands/order-commands.ts`

<!-- slug: payfs-bank-transfer-payment -->
