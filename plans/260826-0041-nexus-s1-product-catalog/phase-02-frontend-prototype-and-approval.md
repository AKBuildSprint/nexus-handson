---
phase: 2
title: "Frontend Prototype and Approval"
status: pending
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 2: Frontend Prototype and Approval

## Context Links

- [Frontend design research](./phase-01-frontend-design-research.md)
- [Mobbin reference report](./research/mobbin-ui-reference.md)
- [Validated product contract](../reports/brainstorm-2026-08-25-session-1-nexus-product-console.md)

## Overview

Build a browser-visible, responsive frontend prototype first. Obtain explicit user approval before creating Worker routes, D1 migrations, R2 bindings or backend domain code.

## Requirements

- Functional:
  - Product list with empty/populated/error states and Add/Import/Download actions.
  - Simple Product create/edit flow with dirty/save/error/success states.
  - Variant Product editor with groups, values, generated combinations, suggested editable SKU, effective price and enabled state.
  - Combination meter and confirmation/blocking states at 10/11/30/31.
  - Structural schema-change preview with retained/new/obsolete rows.
  - Product-default and complete Variant delivery override UI, including file selection/replacement states.
  - Unified CSV workspace with template, preview, 1 MB/500-row boundary, auto-detection, counts and row reasons.
- Non-functional:
  - Production-grade React components and CSS tokens; no default component-library skin.
  - Design scenarios live only in an explicit preview harness, never production fallback behavior.
  - Every control has hover, focus-visible, active, disabled and relevant loading/error/success states.
  - Browser verification at desktop and 375px before asking for approval.

## Architecture

Use Vite + React + TypeScript for the frontend prototype. Keep components presentation-focused with typed props and explicit event callbacks. A design-only scenario provider supplies representative states. Phase 3 isolates it outside production inputs and proves the production import graph is clean; Phase 4 connects approved components to real routes.

Component hierarchy:

```text
ConsoleShell
├── ProductListScreen
├── ProductEditorScreen
│   ├── ProductBasicsSection
│   ├── DeliveryEditor
│   └── VariantBuilder
│       ├── OptionGroupEditor
│       ├── CombinationMeter
│       ├── SchemaChangePreview
│       └── VariantMatrix
└── CsvImportScreen
    ├── TemplateAndDropzone
    ├── BrowserPreview
    └── ImportResultTable
```

Approval boundary:

```text
Mobbin evidence → design contract → working prototype → browser review
                                                      ↓
                                               explicit user approval
                                                      ↓
                                      Phase 3 reconciliation may begin
```

## Related Code Files

- Create: `/Users/itsddvn/projects/nexus-handson/package.json`
- Create: `/Users/itsddvn/projects/nexus-handson/package-lock.json`
- Create: `/Users/itsddvn/projects/nexus-handson/tsconfig.json`
- Create: `/Users/itsddvn/projects/nexus-handson/vite.config.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/index.html`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/main.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/console-app.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/layout/console-shell.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/products/product-list-screen.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/products/product-editor-screen.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/products/variant-builder.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/products/variant-matrix.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/products/schema-change-preview.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/products/delivery-editor.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/imports/csv-import-screen.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/imports/csv-preview-table.tsx`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/styles/design-tokens.css`
- Create: `/Users/itsddvn/projects/nexus-handson/src/console/styles/console-layout.css`
- Create: `/Users/itsddvn/projects/nexus-handson/design/prototype-scenarios.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/design/approval.md`
- Modify: `/Users/itsddvn/projects/nexus-handson/docs/design-guidelines.md`

## Implementation Steps

1. Scaffold the minimal npm/Vite/React/TypeScript frontend only. Do not add Wrangler, D1, R2, Hono or API routes yet.
2. Implement design tokens and the responsive Console shell from Phase 1.
3. Implement Product list states and navigation between list/new/edit prototype screens.
4. Implement grouped Product fields with accessible labels, blur validation and sticky actions.
5. Implement Variant group/value editing, participating-group selection and live combination count.
6. Implement 11-30 warning confirmation and 31+ blocked states.
7. Implement generated Variant rows with suggested editable SKUs, price override, enabled state and focused delivery override editing.
8. Implement schema-regeneration preview with retained/new/obsolete outcomes.
9. Implement unified CSV template/upload/preview/result states, including 1 MB/500-row client rejection.
10. Add explicit design scenarios for loading, empty, dirty, warning, conflict, upload and server-error surfaces.
11. Launch the actual frontend prototype; verify keyboard, desktop and 375px behavior in a browser.
12. Review with the user. Record accepted prototype state and requested revisions in `design/approval.md`.
13. Apply revisions and repeat browser review until approval is explicit.

## Todo

- [x] Frontend scaffold contains no backend/platform code
- [x] Product list and editor prototype complete
- [x] Variant matrix and schema-change states complete
- [x] Delivery/file states complete
- [x] Unified CSV workspace complete
- [x] Desktop/mobile/keyboard browser review passed
- [x] User approval recorded in `design/approval.md`

## Success Criteria

- [x] User can traverse every named S1 Console journey in the prototype.
- [x] 10/11/30/31 limits, SKU editing and schema regeneration are understandable from UI alone.
- [x] Unified CSV simple/Variant detection and grouped errors are previewable.
- [x] No backend/data/config implementation started before approval.
- [x] User explicitly approves information architecture, visual direction, density and interactions.
- [x] Phase 3 remains blocked until `design/approval.md` records approval.

## Risk Assessment

- Risk: prototype scenarios become accidental production data.
  - Signal: production entry imports `design/prototype-scenarios.ts`.
  - Response: Phase 3 isolates preview inputs and adds a production import-graph assertion before Worker integration.
- Risk: UI approval occurs without mobile or error states.
  - Signal: approval artifact lacks 375px/error-state evidence.
  - Response: keep phase pending and complete browser review.
- Risk: approved interactions require a different mutation boundary than the provisional backend plan.
  - Signal: one screen submits multiple independently recoverable operations.
  - Response: update Phases 3-6 during the mandatory reconciliation step; do not distort the approved UI.
