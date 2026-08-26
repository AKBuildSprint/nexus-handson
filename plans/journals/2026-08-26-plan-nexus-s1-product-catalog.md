---
title: Plan Nexus S1 product catalog
date: 2026-08-26
summary: "Frontend-first Mobbin design gate, Cloudflare catalog architecture, red-team corrections and Wrangler deployment plan"
---

# Plan Nexus S1 product catalog

## What happened

Created and validated the six-phase implementation plan at `plans/260826-0041-nexus-s1-product-catalog/`. Researched Mobbin Product/Variant/import flows and current Cloudflare Vite, D1, R2, testing and Wrangler behavior.

## Decisions

- Frontend design/prototype first; explicit user approval blocks backend work.
- Phase 3 reconciles approved UI into a versioned acceptance manifest and downstream phases.
- One active Variant schema, 30-combination cap, unified CSV at 1 MB/500 rows.
- One React/Vite Worker, D1 and private R2; direct Wrangler deploy to one persisted random workers.dev name.
- Public Console remains an accepted S1 risk; S4 owns authorization.

## Review

Red team found and corrected acceptance-authority ambiguity, CSV Cartesian bypass, unproven 500-row D1 path, composite membership constraints, import failure classes, preview-fixture ownership, remote cleanup and repeat-deploy gaps. `ak plan validate` passed after reindex.

## Next steps

Execute Phase 1 Mobbin design contract, then Phase 2 prototype and stop for explicit design approval before Phase 3.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
