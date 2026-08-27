---
title: "Nexus S2 Storefront and Orders"
description: "Implement an independent Storefront and an immutable, server-priced Order journey on the S1 shared catalog."
status: pending
priority: P1
effort: ""
branch: main
tags: [feature, frontend, backend, database, api]
blockedBy: []
blocks: []
created: 2026-08-27
---

# Nexus S2 Storefront and Orders

## Overview

Implement the approved S2 vertical slice without replacing S1 catalog ownership: an independently deployed Storefront reads the shared Worker API; Customer creates one `pending_payment` Order with server-decided money and private capability access; the same safe Order projection appears in the anonymous-demo Console.

**Scope challenge: HOLD.** S1 already supplies D1 catalog state, public Product/Variant projection, private catalog snapshot resolver, Worker dispatch, JSON conventions, and test harness. Essential work is the independent Storefront boundary, atomic/idempotent Order aggregate, restricted CORS, private read, and Console Orders surface. Payment, delivery, auth, cart, multi-line Orders, and email recovery remain out of scope.

## Architecture direction

```text
Independent Storefront static app
  └── configured API base ──cross-origin──> Nexus Worker
                                           ├── public catalog
                                           ├── order create/private read + CORS
                                           ├── Console Orders read
                                           └── shared D1 catalog + new Order aggregate
```

- Storefront is an independent static asset deployment; it does not bind D1/R2 or duplicate catalog logic.
- Nexus Worker remains the sole catalog and Order authority. Its configured Storefront origin is the only origin receiving Storefront CORS responses.
- Storefront generates the opaque capability client-side with Web Crypto, keeps it in memory while creating/retrying, and places it only in the final private URL fragment. The Worker receives it through one explicit request header, persists only its digest, and never sees it in a request URL.
- The Order command calls the existing private catalog snapshot resolver, captures the source Product revision, derives money from server state, and persists Customer, Order, one line, snapshots, history, capability digest, and idempotency result as one D1 transaction guarded by that captured revision.
- Customer and Console projections are reduced views. Neither may contain access content, private-file identity, raw capability token, or capability URL.

## Cross-plan dependencies

| Relationship | Plan | Rationale |
|---|---|---|
| Baseline only | [`Nexus S1 Product Catalog`](../260826-0041-nexus-s1-product-catalog/plan.md) | Checked-in S1 catalog interfaces are consumed as they exist; no future S1 plan output is required to begin S2. |

## Phases

| Phase | Name | Status | Dependency |
|---|---|---|---|
| 1 | [Independent Storefront Boundary](./phase-01-start.md) | Pending | None |
| 2 | [Order Persistence](./phase-02-order-persistence.md) | Pending | Phase 1 |
| 3 | [Order API and Privacy](./phase-03-order-api-and-privacy.md) | Pending | Phase 2 |
| 4 | [Storefront and Console](./phase-04-storefront-and-console.md) | Pending | Phase 3 |
| 5 | [Cross-Surface Verification](./phase-05-cross-surface-verification.md) | Pending | Phase 4 |

## Success criteria

- [ ] Console catalog edits are visible after Storefront refetch; no catalog replica exists.
- [ ] Simple and enabled Variant Product journeys create exactly one one-line `pending_payment` Order at server-computed money.
- [ ] Customer reuse is scoped by normalized email; later name changes do not rewrite historic Order snapshots.
- [ ] Valid private capability reopens only its Order; reference/email, altered token, cross-Store lookup, Customer/Console payloads, and logs do not expose secrets or delivery data.
- [ ] Retry/double submit is idempotent; aggregate-write failure rolls back all Order-related persistence.
- [ ] Storefront CORS is limited to the configured origin; Console retains its S1 anonymous-demo boundary.
- [ ] Two-origin integration and browser/E2E evidence cover both Customer journeys, Console Orders, privacy, CORS, atomicity, and catalog/file retention.

## Source authority

- Approved scope: [`S2 brainstorm report`](../reports/brainstorm-2026-08-27-nexus-s2-storefront-orders.md)
- Existing catalog/public projection: [`src/catalog/public-catalog.ts`](../../src/catalog/public-catalog.ts)
- Existing internal snapshot seam: [`src/catalog/private-order-snapshot.ts`](../../src/catalog/private-order-snapshot.ts)
- D1 batch transaction semantics: https://developers.cloudflare.com/d1/worker-api/d1-database/

## Open questions

None. Exact route and payload shapes and physical schema remain implementation decisions constrained by the approved report. The capability transport is fixed: a client-generated Web Crypto value travels only in an explicit header and the reopenable Storefront URL fragment; only its digest persists server-side.

<!-- slug: nexus-s2-storefront-orders -->