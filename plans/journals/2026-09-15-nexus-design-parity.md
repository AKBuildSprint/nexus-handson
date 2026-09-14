---
title: Nexus HTML demo visual parity
date: 2026-09-15
summary: "Reproduced the Nexus Console HTML demo's composition in the real Console and Storefront: 232 px rail, 56 px deskbar, tab-like list titles, footer statistics, centered 1280 px Product editor overlay, split CSV workspace, catalog-left/ledger-right Storefront, and 760 px private Order paper."
---

# Nexus HTML demo visual parity

## Context

The user clarified the cook outcome: the real application must look like `design/UI-UX/Nexus Console.dc.html`, not merely share its fonts and colors. The plan (`plans/260914-1330-nexus-design-parity/`) locked desktop geometry to the reference with a closed E01–E09 exception register for accessibility, responsive safety, real data, and truthful copy.

## What happened

Phase 1 froze reference hashes/captures, rewrote `docs/design-guidelines.md` to the reference-first contract, and cut the canonical token system over (232 px rail, 56 px deskbar, 1280 px editor measure, reference type roles, `color-divider`, status fill map). Phases 2–3 recomposed every Console and Storefront surface; Phase 4 measured anchors against the reference (all within 2 CSS px outside registered exceptions) and ran the full regression gates.

Independent review (code-reviewer + Kongming) returned NO-GO on the first checkpoint with concrete defects; all were repaired: editor notices now span the grid instead of displacing Basics/Pricing, search controls regained a `:focus-within` ring, the deskbar Store identity can shrink/wrap, the participation label and Storefront nav-current meet target/contrast minimums, editor title is focusable and focus returns to the opener (or `#console-content`), dirty Back→Discard uses `history.go(-1)` so Forward still reaches the editor, `catalogRefresh` fires after the durable core write even when a file stage fails, catalog footer statistics render in empty/filtered states, variant-table inputs no longer stretch checkboxes, and intrinsic column/editor measures moved into tokens.

## Decisions

- Kept `/console/products/new` and `/console/products/:slug` routes with the editor rendered as a centered overlay; the 480 px Variant drawer stays a nested dialog.
- Metrics moved to inline footer statistics; top/bottom pagers retained (E05).
- Storefront hero copy uses the truthful E08 wording; snapshot rows derive from the live catalog.
- Disposable capture spec was used to complete the evidence matrix, then removed; paired captures, geometry JSON, and side-by-side comparisons are retained under `evidence/`.

## Validation

`build:console` (typecheck + vite + import graph, 30 modules), `build:storefront`, `test:browser` 79/79, `test:e2e` 38/38 — all green, and the browser/E2E suites were also verified on Node 22.16.0. Evidence bundle: `plans/260914-1330-nexus-design-parity/evidence/` (reference/, production/, comparisons/, geometry.json, verification.md).

## Remaining work

Captures used desktop Chromium viewport emulation; native mobile keyboard behavior at 375 px is a named limitation. No deployment or remote smoke was performed or authorized.
