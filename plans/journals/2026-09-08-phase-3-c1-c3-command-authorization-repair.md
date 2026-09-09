---
title: Phase 3 C1/C3 command authorization repair
date: 2026-09-08
summary: Lookup/actor before parse; exact storefront customer match; refund customer lookup inside try.
---

# Phase 3 C1/C3 command authorization repair

## What happened
Coordinator-acceptance repair on phase 3: four command exports parsed input before Store-scoped Order lookup, and recordedActor silently replaced storefront/bootstrap_owner identities.

## Decision
Shared prepareCommand now reads the Order once, authorizes the actor, then parses/hashes/ledgers. Storefront actor.id must equal order.customer_id; bootstrap_owner id must be null. Storefront HTTP refund supplies that customer id from a query inside the existing refund try/catch.

## Next steps
Coordinator owns plan index/commit. Phase 4 still owns HTTP/inbox cutover.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
