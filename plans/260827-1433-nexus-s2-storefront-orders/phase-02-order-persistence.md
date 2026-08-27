---
phase: 2
title: "Order Persistence"
status: completed
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: Order Persistence

## Overview

Add the immutable Order aggregate to D1 and a focused Orders domain namespace. The aggregate persists Customer reuse, one Product line, server-resolved catalog snapshot, private capability digest, initial history, and idempotency outcome without relying on mutable catalog records after purchase.

## Requirements

- Append a new migration after `0003-imports.sql`; never rewrite S1 migrations.
- Customer identity is unique per Store by server-normalized email. The newest name updates the Customer record, while the Order stores a separate purchase-time Customer snapshot.
- Every Order has exactly one line, quantity integer `1–99`, status `pending_payment`, server-decided amount/total/currency, and immutable internal catalog snapshot.
- The existing resolver must return the exact Product revision read with the internal snapshot. The batch revalidates that captured revision before committing a snapshot so a concurrent catalog edit aborts the whole aggregate.
- Capability persistence stores only a one-way digest. The raw high-entropy capability arrives from the Storefront command and is never written to a database row, diagnostic object, or log.
- Customer create/reuse, Order aggregate, capability digest, initial history, and idempotency result commit or roll back together.

## Architecture

Create a bounded `src/orders/` namespace rather than extending catalog write code with Order concerns. It owns input validation, normalized-email identity, command persistence, read projections, and capability digest handling. It consumes a catalog resolver result that couples the immutable snapshot with the exact Product revision used to obtain it.

The command must not trust a pre-read snapshot by itself. It resolves the snapshot and revision, then commits through one ordered `D1PreparedStatement[]` batch whose final assertion fails unless that same Product revision remains current. Reuse the existing S1 counted/failing-assertion pattern rather than treating a zero-row conditional update as success. A price, status, Variant, or delivery edit between the read and batch must roll back every Order write. D1 documents `batch()` as a transaction that rolls back the full sequence when one statement fails.

## Related Code Files

- Create: `migrations/0004-orders.sql`
- Create: `src/orders/order-types.ts`, `src/orders/order-validation.ts`, `src/orders/order-write.ts`, `src/orders/order-read.ts`, `src/orders/private-access.ts`
- Modify: `src/catalog/catalog-types.ts`, `src/catalog/private-order-snapshot.ts` — carry the captured Product revision only through the internal resolver result
- Modify: `src/catalog/slug.ts` — extend stable-ID allocation only for the new durable entity prefixes, without changing existing IDs
- Reuse without widening public fields: `src/catalog/public-catalog.ts`
- Modify: `tests/support/catalog-test-env.ts`, `tests/integration/migration-constraints.test.ts`, `tests/integration/private-order-snapshot.test.ts`
- Create: focused `tests/integration/orders-persistence.test.ts`

## Implementation Steps

1. Define internal Order/Customer/line/history/access/idempotency projections with an explicit split between persisted internal snapshot and safe read projections. Extend the private catalog resolver result so its snapshot is inseparable from the exact Product revision read from D1; keep access title/instructions/private-file key internal.
2. Add an append-only migration with Store-scoped foreign keys, uniqueness/indexes, one-line/quantity/status invariants, normalized-email reuse, idempotency uniqueness, and capability-digest lookup. Model immutable snapshots as copied purchase-time data, not mutable Product joins.
3. Update the Workerd migration list and FK-safe reset order. Extend migration constraint evidence for every new table/index/invariant.
4. Implement server-only parsing/normalization for name, email, Product ID, nullable Variant ID, quantity, idempotency input, and an opaque capability supplied by the API boundary. Reject unknown, malformed, missing, disabled, stale, or out-of-range values before an aggregate can commit.
5. Implement the Order command: resolve the existing catalog snapshot plus Product revision; derive amount and total from snapshot price and quantity; digest the opaque capability; write the entire aggregate through one batch whose final assertion fails if the captured catalog revision changed. Keep the request's idempotency identity and capability bound to its one persisted result.
6. Implement internal read projections for later Worker routes and Console listing. They must not expose raw capability, access content, or private-file identity.
7. Preserve S1 delivery replacement semantics and add regression evidence that an Order snapshot retains its original private-file key after catalog file replacement/removal. Do not introduce physical cleanup in S2.

## Todo

- [x] Append and register the Orders migration.
- [x] Implement atomic, idempotent Order aggregate persistence.
- [x] Preserve immutable Customer/catalog/delivery snapshots.
- [x] Prove storage constraints and rollback behavior in Workerd integration coverage.

## Success Criteria

- [x] A Simple Product and an enabled Variant produce valid internal snapshots; missing/disabled/mismatched Variant selection does not persist an Order.
- [x] Quantity bounds, normalized email reuse, latest-name update, historic Customer snapshot, pending status, server money, and exactly-one-line constraints hold.
- [x] A price/status/Variant/delivery edit interleaved after resolver read and before batch assertion aborts the full aggregate; no stale snapshot commits.
- [x] Repeated/concurrent-equivalent idempotency input yields one aggregate/result; injected later failure leaves no partial Customer, Order, line, history, access, or idempotency rows.
- [x] Raw capability token and private snapshot fields are absent from persistence projections intended for responses/logging.

## Risk Assessment

- Resolver reads and catalog writes can race. Bind the write assertion to the precise Product revision returned by the resolver; a later “current revision” read is not sufficient.
- Idempotency retry after an uncertain client/network outcome must reuse the same caller-held idempotency identity and opaque capability to return the original persisted result, not create a second Order.

## Security Considerations

- The Storefront generates a cryptographically strong opaque capability with Web Crypto; the server validates its bounded encoding, persists and compares only its one-way digest, and never logs it.
- Scope every Customer, Order, access, and idempotency query by Store. Do not make reference/email a private-read credential.
