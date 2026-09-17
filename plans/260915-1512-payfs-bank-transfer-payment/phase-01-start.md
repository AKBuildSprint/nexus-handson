---
phase: 1
title: "Atomic PayFS settlement and compatibility"
status: pending
priority: P1
effort: "1 phase"
dependencies: []
---

# Phase 1: Atomic PayFS settlement and compatibility

## Outcome

Create the smallest package-owned provider receipt ledger and command that can atomically settle one exact PayFS credit. Keep the populated manual `payments` table unchanged and make existing Console detail truthful for provider-paid Orders.

## Requirements

- Add `migrations/0013-payfs-webhook-payments.sql` as an additive companion schema. It must preserve all 0012 data and foreign keys.
- Persist globally unique provider/transaction identity, a deterministic normalized-fact fingerprint, terminal `confirmed` or `ignored` outcome, bounded allowlisted reason, and only confirmed Order/history links.
- Parse the documented flat PayFS transaction payload strictly. Preserve IDs/account numbers as bounded strings; require positive safe-integer whole-VND `amount`, valid date shape, and exact known fields.
- Match only a `credit` against configured merchant bank/account, exactly one generated payment reference token, and a current pending VND Order with the exact total.
- Use a dedicated `confirmPayfsCredit` package command. It must not call Console `markPaid`, widen user authorization, or create a fake browser idempotency key.
- Confirmed settlement writes a system `order_paid` history entry, `pending -> paid`, and receipt in one D1 batch. Semantic rejection writes only a terminal ignored receipt.
- Replay and concurrent-delivery recovery reread provider receipts. Conflicting facts for one transaction ID reject without overwrite or retargeting.
- Existing Console detail must project a `payfs` payment source truthfully without showing provider transaction ID or a fabricated external reference. Manual detail behavior remains unchanged.

## Touchpoints

- New: `migrations/0013-payfs-webhook-payments.sql`
- Modify: `packages/orders/src/order-types.ts`
- Modify: `packages/orders/src/order-validation.ts`
- Modify: `packages/orders/src/transitions/order-transitions.ts`
- Modify: `packages/orders/src/commands/order-commands.ts`
- Modify: `packages/orders/src/persistence/command-store.ts`
- Modify: `packages/orders/src/queries/order-read.ts`
- Modify: `apps/console/src/orders/order-ui-types.ts`
- Modify: `apps/console/src/orders/order-detail-screen.tsx`
- Modify: `tests/support/catalog-test-env.ts`
- Modify: `tests/integration/order-brief-migration.test.ts`
- Modify: `tests/integration/order-commands.test.ts`
- Create: `tests/unit/payfs-credit.test.ts`
- Modify: `tests/browser/console-orders-contracts.test.ts`

## Tests

Prove migration preservation and foreign keys; exact settlement; debit/recipient/reference/amount/currency/state rejection; reference-boundary and ambiguity rules; replay/conflicting ID/concurrent delivery; conflict with manual payment/cancel; batch rollback; Console provider-payment presentation; unchanged manual/refund paths.

## Success criteria

- [x] One exact credit produces precisely one linked receipt/history/paid graph.
- [x] A failed or losing confirmation creates no partial financial graph.
- [x] Provider receipts never expose transaction IDs through Console or Storefront responses.
- [x] Existing manual payments and refunds retain their contracts.
