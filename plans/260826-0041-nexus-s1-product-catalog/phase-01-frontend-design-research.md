---
phase: 1
title: "Frontend Design Research"
status: pending
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Frontend Design Research

## Context Links

- [Validated brainstorm contract](../reports/brainstorm-2026-08-25-session-1-nexus-product-console.md)
- [Mobbin UI reference research](./research/mobbin-ui-reference.md)
- [S1 technical brief](../../session-1-brief.md)

## Overview

Freeze the Operations Console information architecture, visual language, interaction states and responsive behavior before backend/data work. Use the inspected Mobbin flows as interaction evidence, not as a branding template.

## Requirements

- Functional:
  - Product list: loading, empty, populated and request-error states.
  - Product editor: basics, decimal price/currency, status, public description, default delivery and private file.
  - Variant builder: 0-5 groups, 10 values/group, one active schema, editable suggested SKUs, price/delivery override states.
  - Combination meter: 0-10 normal, 11-30 warning/confirmation, 31+ blocked.
  - Schema regeneration: retained, new and obsolete/disabled combinations.
  - CSV workspace: unified template download, browser preview, detected Product types, row outcomes and errors.
- Non-functional:
  - Dashboard/product UI dials: variance 3, motion 2, density 6.
  - Keyboard-first navigation, visible focus, associated validation errors and 44px touch targets.
  - Desktop working canvas plus a composed 375px layout; no horizontal page scroll.
  - No backend route, DTO or persistence assumption presented as approved fact.

## Architecture

Design read: product operations dashboard for a Store operator, industrial-utilitarian, restrained and data-first.

- Navigation: compact Console rail; Products is primary destination.
- Product list: table-first surface with Add Product, Import CSV and Download template actions.
- Product editor: sticky action bar and grouped sections; status separated from content.
- Variant matrix: option groups first, then generated rows with combination, SKU, effective price, status and focused delivery override editing.
- CSV import: dedicated workspace. Template/upload on one side; preview/server results and row errors on the other.
- Depth strategy: hairline dividers and surface tints only.
- Memorable element: combination meter that makes the 10-warning/30-cap rule visible before generation.

Mobbin evidence:

- [Shopify Adding variants](https://mobbin.com/flows/fac2b590-3de3-45b0-9581-c453ed412e2a)
- [Shopify Adding a product](https://mobbin.com/flows/8db969f5-0dc2-4d15-a584-3fb719d63b65)
- [Shopify Editing a variant](https://mobbin.com/flows/a136c90d-2af3-42ca-b5cb-e7e8875a9bed)
- [Shopify Importing products](https://mobbin.com/flows/e71975c4-268e-4da8-873b-098e3281df92)
- [Salesforce Importing products](https://mobbin.com/flows/c9d0c0c8-2314-4979-8567-3a9a29fe6230)
- [Squarespace Import products](https://mobbin.com/flows/33decfd4-a722-43ff-bce0-90bab6fff9a5)

## Related Code Files

- Existing evidence: `/Users/itsddvn/projects/nexus-handson/plans/260826-0041-nexus-s1-product-catalog/research/mobbin-ui-reference.md`
- Create: `/Users/itsddvn/projects/nexus-handson/docs/design-guidelines.md`
- Create: `/Users/itsddvn/projects/nexus-handson/design/console-journey-state-matrix.md`
- Create in Phase 2: `/Users/itsddvn/projects/nexus-handson/design/approval.md`
- No source/backend/config files in this phase.

## Implementation Steps

1. Re-open the cited Mobbin flows. Confirm adopted/rejected patterns against actual screens.
2. Declare the final visual thesis, typography, restrained color strategy, density, radius, spacing and motion tokens.
3. Draw route-level information architecture for Product list, new/edit Product and CSV import.
4. Enumerate every default/loading/empty/dirty/warning/error/success/disabled state.
5. Specify Variant group editing, selection, combination meter, regeneration preview and per-row override interactions.
6. Specify CSV template, dropzone, browser preview, 1 MB/500-row limits, confirmation and server-result presentation.
7. Map labels, help text and errors to the domain language in the brainstorm contract.
8. Record responsive transformations and accessibility behavior.
9. Write `docs/design-guidelines.md` and `design/console-journey-state-matrix.md`.

## Todo

- [x] Mobbin patterns adopted/rejected with canonical links
- [x] Visual thesis and token contract written
- [x] Product list/editor/Variant/import state inventory complete
- [x] Responsive and accessibility behavior specified
- [x] Design artifacts ready for prototype implementation

## Success Criteria

- [x] Every S1 frontend acceptance criterion maps to a named screen and state.
- [x] Variant 10/11/30/31 behavior is visible without reading technical docs.
- [x] CSV simple/Variant auto-detection and row-error presentation are unambiguous.
- [x] Design contains no inventory, sales analytics, custom-domain, auth or CSV-upsert scope.
- [x] Phase 2 can build the full prototype without deciding backend behavior.

## Risk Assessment

- Risk: Mobbin patterns pull physical-commerce concepts into a digital-product scope.
  - Signal: inventory, shipping, barcode, vendor or sales-channel controls appear.
  - Response: remove them; retain only catalog, Variant and import interaction patterns.
- Risk: dense Variant tables fail at 375px.
  - Signal: horizontal page scrolling or hidden primary actions.
  - Response: use row summaries plus focused drawers; keep the desktop matrix table.
- Risk: visual direction is generic admin UI.
  - Signal: no memorable combination-boundary affordance or clear hierarchy.
  - Response: revise tokens/layout before Phase 2, not after backend work.
