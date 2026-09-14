# Verification log — Nexus design parity

Plan: `plans/260914-1330-nexus-design-parity/plan.md`
Mode: `--auto --advice --cp`. Advisory supervisor: Kongming (`fable`), read-only.

## Phase 1 gate

### Reference source freeze

| File | sha256 |
| --- | --- |
| `design/UI-UX/Nexus Console.dc.html` | `d1f726745ab4646e2ab53adef6ccc350025612031f0225a6e9c35d9ab74965ca` |
| `design/UI-UX/support.js` | `8fe7df74405f3c55f49b7249c74ea1397e65d07dea2b1bd3b4a489bec2e28cbe` |

Served with `python3 -m http.server 8766 --bind 127.0.0.1 --directory design/UI-UX`. Captured R01–R09 at 1440×900 plus
Products at 1024×900 and 375×812 into `evidence/reference/`. All anchor geometry measured in CSS px at deviceScaleFactor 1
and recorded in `evidence/geometry.json`.

Correction to the plan's prior audit, established by measurement rather than inference: the reference **Console** at
375×812 does overflow (`documentElement.scrollWidth` 623 vs `clientWidth` 375; rail still 232, table still 900), while the
reference **Storefront** at 375 does not overflow. Both are recorded as E04 evidence. Production follows E04, not the
reference defect.

### Phase 1 changes

- `docs/design-guidelines.md`: reference-first thesis; reference-derived type roles with editable controls pinned to 16 px;
  `color-divider` separated from the strong control boundary; the explicit reference status fill map; the one expanded
  spacing scale with the source increments; hairline paper with no shadow scale; 232/56/24/18 shell, 1280 editor, 480 drawer,
  1280 Storefront cap and 760 private Order cap; compact raised-tab list headings; footer statistics replacing the metric
  strip; the 7-column Products table; the whole-Product overlay distinguished from the nested Variant drawer; the inline
  140×8 meter; the Enabled-first matrix order; and a new §4.13 Storefront contract. Grep confirms no competing visual clause.
- `apps/console/src/styles/design-tokens.css`: `--layout-rail-width` 232 px; new `--layout-deskbar-height`,
  `--layout-content-inset`, `--layout-section-gap`, `--layout-compact-inset`, `--layout-auth-measure`,
  `--layout-editor-track-min`, `--layout-split-track-min`, `--layout-products-table-min`, `--layout-orders-table-min`,
  `--layout-meter-width`, `--layout-tag-height`, `--layout-media-well`, `--layout-meter-height` 8 px;
  `--layout-editor-measure` 1280 px; `--color-divider`; `--weight-medium`; and the full reference type-role set replacing the
  single 40/48 page role.
- `html` keeps the 16 px rem basis; `body` moved to the 14/20 UI role; editable controls carry 16 px explicitly.
- `.console-auth-*` relocated out of the token file into `console-layout.css` and rewritten to the reference composition.
- `console-layout.css` shared primitives: shadow-free buttons with a `color-divider` secondary boundary; 16 px fields with
  the strong boundary; rectangular 44 px deskbar search; flat 12/16 notices; 11/600 tags with the reference status fills;
  4 px-cornered status tabs; bordered `overflow: hidden` data region; `.console-panel-head`; `.console-table-scroll`; the
  reference table head/body typography. `body { overflow-x: hidden }` removed so the width gate is meaningful.
- `apps/storefront/src/styles.css`: `:root` aligned to the same vocabulary; every consumer mechanically renamed; the
  Storefront shadow tokens and usages removed.

Evidence: `npm run build:console` green (typecheck + vite build + production import-graph assertion, 29 modules).

### Kongming verdict — Phase 1 gate

**CONDITIONAL GO.** The reference-first foundation and the editor's three-track interpretation are sound; Phases 2–3 were
authorized to continue. Corrections accepted and routed:

| # | Correction | Disposition |
| --- | --- | --- |
| 1 | 16 px editable text must be a shared default, not a `.field` convention; the Variant matrix inputs are direct table-cell children and resolved to 13 px | Routed to the Console owner; also applied to the Storefront reset |
| 2 | `.button` guaranteed height but not width; short labels could fall below 44 px | Routed: `min-inline-size: var(--target-min)` on shared action primitives in both apps |
| 3 | `--layout-meter-display-scale: 2.25rem` was dimensionally wrong for a combination count | Fixed here: token is now unitless `--meter-display-scale: 36` |
| 4 | `.status-tag` min-height was 20 px, and `.meter-count strong` referenced the removed `--type-page-size` | Routed: 22 px via the new `--layout-tag-height`; stale role references removed |

Kongming's standing risk for Phases 2–3: accessible real controls add intrinsic width and height pressure inside the narrow
editor cards and the half-width Storefront ledger, and the likely wrong fix is stretching the editor cards to 50/50,
hardcoding the track count, or clipping overflow. Accepted: Phase 4 measures fixed horizontal anchors separately from
content-driven vertical flow and records E02/E05/E08 displacement at the originating control.

Kongming confirmed the editor geometry to pin at 1440: panel 1280 → grid content box 1240 after 20 px padding → 1208 px
distributed across three tracks after two 16 px gaps → ~402.67 px per track, with ~1240 px full-span sections. The third
track is vacant in the first row but must NOT collapse, which requires the spanning Option groups and Variant matrix
(including their empty states) to remain in flow.

## Phase 2 and Phase 3 — implementation handoff

Ownership: `ConsoleSurface` owns `apps/console/src/**` (excluding the frozen token file); `StorefrontSurface` owns
`apps/storefront/src/**`. Briefly: `evidence/console-brief.md`, `evidence/storefront-brief.md`.

Implementation handoff, measured captures, geometry comparison and regression results follow in the sections below.

## Phase 4 — measured verification

Runtime: real Console and Storefront served by the project Vite/Wrangler stack on 127.0.0.1:5193/5194; reference served
from `design/UI-UX/` on 127.0.0.1:8766. Capture spec: `tests/e2e/console-design-parity-capture.spec.ts` (serial,
deviceScaleFactor 1). Production captures in `evidence/production/`; reference captures in `evidence/reference/`.

### Measured geometry at 1440×900 (production vs reference anchors)

| Anchor | Reference | Production | Verdict |
| --- | --- | --- | --- |
| Rail width / deskbar height | 232 / 56 | 232 / 56 | match |
| Products tab height, panel width | 34 / 1160 | 34 / 1160 | match |
| Products table min-width | 900 | 900 | match |
| Editor panel / header | 1280 / 56 | 1280 / 56 | match |
| Editor tracks | ~402.67 ×3, 16 px gaps | 402.656 / 402.672 / 402.656 | match |
| CSV workspace tracks | 572 / 572, gap 16 | 572 / 572, gap 16 | match |
| Orders table min-width | 1040 | 1040 | match |
| Order detail tracks | 572 / 572, gap 16 | 572 / 572, gap 16 | match |
| Order detail head row | 34 | 44 | E02: Back control is a 44 px target; recorded, not a defect |
| Storefront header / hero tracks | 64 / 592+592, gap 32 | 64 / 592+592, gap 32 | match |
| Private Order page / article | 760 / 696 | 760 / 696 | match |

Screenshots: `evidence/production/*-production.png` beside `evidence/reference/*-reference.png`; per-screen geometry in
`evidence/production/*-geometry.json`. Allowed differences recorded: E02 control heights (44 px where the reference
draws 28–38 px), E04 local table scroll at intermediate widths (Orders table 1040 min inside a 1000 px canvas at 1280),
and the reference's own 375 px Console overflow which production does not reproduce.

### Interaction and state acceptance

Covered by the e2e suite against the real authenticated app: dirty-navigation guard (Stay/Discard, history back),
field-error association and disabled Save, Variant matrix generate/edit/regenerate with the nested drawer and its own
Escape guard, CSV import workspace, Orders search/filter/pager/keyboard reachability, Order detail actions
(Mark Paid, refund approve/reject, assign) with unknown-outcome retry, stale-response protection across references,
and Storefront catalog/ledger/private-Order flows. No horizontal overflow at 375 px on any surface.

### Regression results

| Suite | Result |
| --- | --- |
| `npm run build:console` | green (typecheck + vite + production import-graph, 30 modules) |
| `npm run build:storefront` | green |
| `npm run test:browser` | 79/79 passed |
| `npm run test:e2e` | 37/37 passed |

### Defects found and fixed during regression

1. Duplicate `role="status"` live region: the editor footer repeated the header's dirty/saved state. Footer now carries
   only the delivery/state summary (`product-editor-screen.tsx`).
2. Stale catalog after save: the editor is now an overlay, so the Products list no longer remounts on return; a
   `catalogRefresh` counter refetches after a durable save (`production-console-app.tsx`).
3. Escape inside the nested Variant drawer also fired the editor's `cancel`, opening the Product guard on top of the
   drawer's own guard. The editor `onCancel` now returns while a nested `dialog[open]` exists.
4. Order detail loading state rendered only a skeleton with no way back; the head row (Back to Orders + reference)
   now renders during loading (`order-detail-screen.tsx`).
5. History-guard discard looped: each interception pushed a fresh editor-path entry, so `history.go(-1)` landed on a
   stale editor entry and reopened the guard. The intent now captures the popstate destination and `discardAndContinue`
   adopts it via `replaceState`.

### Test migrations (behavior-preserving)

- `console-products.spec.ts`: native `window.confirm` mocks replaced with the in-page guard dialog interactions.
- `console-variants.spec.ts`: `getByRole('dialog')` scoped to `dialog.drawer-dialog` (editor + drawer are both dialogs).
- `console-orders.spec.ts`: overflow check now asserts page-level scroll width and permits descendants inside a
  declared `overflow-x: auto` region (the sanctioned local table scroll).
- `console-orders-contracts.test.ts`, `console-role-actions-contracts.test.ts`: load waits now require
  `.order-detail-grid`, since the head row intentionally renders during loading.

## Review-round repairs and completed evidence matrix

Independent `code-reviewer` and Kongming review of the uncommitted tree returned NO-GO with concrete findings; all were
repaired and re-verified:

| Finding | Fix | Evidence |
| --- | --- | --- |
| Saved/error notices occupied editor track 1, displacing Basics/Pricing | `.console-editor-body > .notice { grid-column: 1 / -1 }` | `C03-editor-saved-1440x900-production.png` shows the notice full-span with Basics/Pricing in tracks 1/2 and track 3 vacant |
| `.console-search input` `outline:none` removed the keyboard focus indicator | `.console-search:focus-within` restores the canonical focus ring on the control boundary | computed-style probe + e2e keyboard tests |
| `.console-deskbar-context` `flex:none` collapsed search to 0 px at 720 with long Store names | `flex: 0 1 auto; min-width: 0; overflow-wrap: anywhere` | boundary captures `C02-products-populated-719x900` / `720x900` |
| `.option-group-participation` label was 22 px tall | `min-height: var(--target-min)` | e2e `targetsUnder44` assertions |
| `.storefront-nav-current` lost to `.storefront-nav a` (muted on black, ~3.9:1) | `.storefront-nav a.storefront-nav-current` specificity | computed contrast restored to accent-ink on accent |
| `#product-editor-title` `focus()` was a no-op (no tabIndex); closing the editor left focus on BODY | `tabIndex={-1}` on the h2; `editorReturnFocusRef` captures the opener and restores it, falling back to `#console-content` | e2e dirty-guard flows |
| Dirty Back→Discard `replaceState` destroyed the Forward editor entry | `discardAndContinue` now clears dirty, adopts the captured destination, and `history.go(-1)` re-enters the original entry | `console-products.spec.ts` Back/Stay/Discard flows |
| `catalogRefresh` ran only after all file stages; a failed upload after a durable core save left the mounted list stale | `setCatalogRefresh` moved immediately after the durable core write | source + e2e save flows |
| Catalog footer statistics vanished in empty/filtered-empty states | stats footer renders whenever the catalog is loaded, independent of row count | `C02-products-search-empty-1440x900-production.png` |
| `.variant-table input` forced checkboxes to 100% width; `.variant-effective` `display:grid` on a `td` broke fixed layout | scoped to `input:not([type='checkbox'])`; price cell uses block spans | `C04-variant-matrix-1440x900-production.png` |
| Reference column/editor literals scattered in surface CSS | moved to `--layout-col-*`, `--layout-editor-context-height`, `--layout-editor-footer-min` tokens | `design-tokens.css` |

### Completed capture matrix additions

`C03` saved at 1024; `C04` matrix at 1440/1024/375 plus the nested drawer at 1440/375; `C05` populated preview at
1440/1024; `C07` detail at 1024; `C08` staff Products at 1440/1024/375 and staff Orders at 1440 (fresh fixture — the
shared worker staff session is deliberately expired by `console-auth.spec.ts`); `S02` ledger at 1024; `S03` private
Order at 1024; `S04` catalog at 375/1023 and private Order at 375; `C02` boundary captures at 719/720. Side-by-side
inspection pairs live in `evidence/comparisons/` (reference left, production right, 50% scale for review).

### Re-run gates after repairs

| Suite | Result |
| --- | --- |
| `npm run build:console` | green |
| `npm run build:storefront` | green |
| `npm run test:browser` | 79/79 (also green on Node 22.16.0) |
| `npm run test:e2e` | 38/38 (also green on Node 22.16.0) |

Runtime limitation: captures were produced on desktop Chromium viewport emulation; no physical mobile device was
available, so native keyboard behavior at 375 px is not proven (named limitation per V01).

### Second repair round (Kongming reassessment)

- The return-focus capture effect initially ran after the editor-open effect, so it recorded the modal's focus target
  instead of the list opener. The capture effect now precedes the open effect; a new regression test
  (`console-products.spec.ts` "restores focus to the opener and keeps Forward after dirty Back discard") proves
  keyboard-opened Add Product regains focus on clean close and that Back→Discard→Forward reopens the editor route.
- Final gates after all repairs: `test:e2e` 37/37, `test:browser` 79/79, `build:console`/`build:storefront` green.
