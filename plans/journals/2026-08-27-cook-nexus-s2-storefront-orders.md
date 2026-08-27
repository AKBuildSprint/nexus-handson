---
title: Cook Nexus S2 storefront and orders
date: 2026-08-27
summary: "Independent Storefront, private server-priced Orders, cross-surface verification, review fixes, and a blocked remote rollout"
---

# Cook Nexus S2 storefront and orders

## Context

Executed the accepted S2 vertical slice from the [active plan](../260827-1433-nexus-s2-storefront-orders/plan.md). Current completion evidence and the remote blocker are recorded in the sanitized [PM report](../reports/pm-2026-08-27-1733-nexus-s2-storefront-orders.md). This journal is chronological work history, not current product authority.

## What happened

1. Accepted the bounded direction: preserve the S1 catalog as the shared authority while adding an independently deployed Storefront and a one-line, `pending_payment` Order journey. Payment, delivery, authentication, cart, multi-line Orders, and email recovery remained out of scope.
2. Established separate Storefront and Console outputs with a two-origin local topology. The Storefront consumes the Worker API and does not duplicate catalog state or bind storage directly.
3. Added the D1 Order aggregate with atomic, idempotent creation and rollback behavior. Pricing and catalog snapshots come from server state; historic Order snapshots remain stable.
4. Added Storefront CORS, private Customer Order access, and safe Console reads. The opaque capability is generated client-side, sent in an explicit header, retained in the final URL fragment, and stored only as a digest. Customer and Console projections exclude capability and delivery-sensitive data.
5. Completed the Storefront purchase/reopen journey and responsive Console Orders surface, then added migration, route, browser-contract, and two-origin E2E coverage.
6. Closed issues found during implementation and review: enforced the Order-to-line lifetime invariant, removed a catalog-visibility refetch race, guarded production deployment against an unsafe Storefront origin, and made CSV assertions portable across CRLF checkouts.
7. Backend and frontend re-reviews both passed after those fixes.

## Verification

- Workerd: 25 files and 92 tests passed.
- Browser contracts: 4 files and 14 tests passed.
- Console and Storefront typechecks and production builds passed.
- Full Playwright rerun: 17/17 passed. One unrelated existing focus assertion flaked once, then passed in isolation and in the full rerun.
- Manual 375 px checks found no horizontal overflow on either surface and confirmed only safe fields were shown.

## Remote blocker and next action

Authenticated remote inspection returned Cloudflare error 7404 because the configured D1 resource was unavailable in the active account context. No remote migration, Worker provisioning, deployment, identity mutation, or remote smoke test occurred. Local work is complete; the active plan remains in progress at 39/42 items.

Next, reconcile the intended Cloudflare account/resource context and repeat controlled read-only inspection. Only then proceed with the append-only migration, provisioning, deployment, and remote smoke checks.

## Publishing

AgentWiki publishing was skipped because no AgentWiki capability was available in this session.

Status: DONE_WITH_CONCERNS  
Summary: Local S2 implementation, verification, and review closure are complete; only authenticated remote rollout work remains.  
Concerns/Blockers: The intended remote D1 resource is not available in the active Cloudflare context.
