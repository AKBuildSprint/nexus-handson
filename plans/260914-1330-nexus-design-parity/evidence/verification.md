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

## 2026-09-15 — original-scale Sol parity repair

### Scope and diagnosis

The plan was reopened after direct comparison showed that the prior 50%-scale side-by-sides hid material composition
errors. This repair used the original 1440×900 reference PNGs and fresh device-scale-factor-1 production captures.
`sips` confirmed the checked reference, before and after desktop PNGs are 1440×900 pixels; the mobile after capture is
375×812 pixels.

Observed source defects, distinct from registered exceptions:

- Products actions had no flex spacer, so they began immediately after the raised Products tab instead of ending at
  the 1160 px panel edge.
- The editor added helper prose below nearly every field even though R04 has only the shared currency guidance and the
  file constraint. This inflated the first card from 320 px reference geometry to 418 px with the repair fixture and
  pushed Option groups below the useful viewport.
- The CSV additive notice inherited the generic stacked notice layout and the template download stretched across its
  grid track, unlike R05's one-row notice and content-width secondary action.
- Storefront's required E05 filters and top pager wrapped into a 100 px desktop block; the first card began at y=484
  rather than remaining close to the reference catalog. At 375 they became a cramped two-column control cluster.
- A selected catalog card used a black Selected button even though R08 keeps that control white and expresses
  selection with the card outline.
- Singular CSV preview data rendered “1 Product groups”.

### Repairs

- `product-list-screen.tsx`: restored the existing `console-tab-spacer` contract so Products actions end at x=1416
  at 1440.
- `product-editor-screen.tsx`, `delivery-editor.tsx`, `console-layout.css`: removed duplicate field helpers, retained
  errors and byte/file constraints, added visible required marks backed by native `required`, restored the one shared
  currency line, reduced only the access-instructions textarea to the source role, and made the display-only slug
  read like the adjacent control without making it editable.
- `csv-import-screen.tsx`, `csv-preview-table.tsx`, `console-layout.css`: made the additive notice one compact row,
  kept the download action content-width, and corrected group-count grammar.
- `styles.css`: compressed the E05 desktop Storefront filter/pager extension to one 44 px row, forces it into two
  coherent 44 px rows when the catalog track is narrower, and restored the reference white Selected button.

No API, route, DTO, auth, migration, payment, privacy, retry, or domain state changed.

### Native-scale evidence

Reference anchors:

- `evidence/reference/R02-R03-products-1440x900-reference.png`
- `evidence/reference/R04-editor-simple-top-1440x900-reference.png`
- `evidence/reference/R05-csv-1440x900-reference.png`
- `evidence/reference/R06-orders-1440x900-reference.png`
- `evidence/reference/R07-detail-pending-1440x900-reference.png`
- `evidence/reference/R08-storefront-1440x900-reference.png`
- `evidence/reference/R09-private-order-1440x900-reference.png`

Fresh baseline artifacts are retained under `evidence/repair-20260915/before/`. Fresh repaired artifacts are retained
under `evidence/repair-20260915/after/`; both folders contain measurements plus Products at 1440/1024/375,
Storefront catalog at 1440/1024/375, editor, CSV, Storefront ledger/private Order, Orders, and Order detail.

The first baseline run intentionally remains untouched. Its 1024/375 Products captures caught the original harness
before catalog completion; they prove the timing defect in that disposable capture, not loaded-state parity. The
final capture waits for a real Product link, catalog identities, CSV browser validation, loaded Orders, and the open
manual-payment panel before recording.

### Measured outcomes

- Products: Add Product moved from x=660.703 to x=1306.625 and now ends at the panel's x=1416 edge. Rail 232,
  deskbar 56, content inset 24, tab 34 and panel width 1160 remain unchanged.
- Editor: first card fell from 418 to 354 px; reference is 320 px with a short slug. The residual 34 px is the repair
  fixture's multi-line generated slug plus E02's 44 px controls. The reference modal 1280×852, header 56, 402.656 px
  tracks, 16 px gaps and sticky 61 px production footer remain intact.
- CSV: additive notice fell from 68 to 45 px; reference is approximately 46 px. The production workspace starts at
  y=205 instead of R05 y=182 because the real Back control makes the head 44 px under E02. Tracks remain 572/572
  with gap 16. Final Import Products computed `disabled=false`, black background and white text.
- Storefront 1440: header 64, content 1216, hero 592/592 with gap 32, workspace 594/594 with gap 28, cards 289 and
  ledger 594 are unchanged exact anchors. The top E05 extension fell from 100 to 44 px and first-card y moved from
  484 to 428. R08 first-card y is approximately 363; the remaining 65 px is the required top filter/pager extension
  plus E02's 44 px search control.
- Storefront 1024 and 375: filters and top pager now occupy separate coherent rows. At 375 the toolbar is 343×96,
  pager 343×44 and first card y=735. Document/client/body widths are all 375; no page-level horizontal overflow.
- Direct Chromium at scale 1 confirmed a single selected card, a 44 px white Selected control, 375 px
  `scrollWidth`, and an enabled primary action settling to black with white text.

### Runtime and scoped verification

- Node: 22.16.0. Dependencies installed with `npm ci` because `node_modules` was absent: 147 packages added.
- Reference URL: `http://127.0.0.1:8766/Nexus%20Console.dc.html`.
- Console/API URL: `http://127.0.0.1:5293`.
- Storefront URL: `http://127.0.0.1:5294`.
- Isolation: `.wrangler/sol-parity-repair`, worker-isolation on, dotenv/process-env loading off, local placeholder OAuth
  values, generated ephemeral auth secrets, fixture cookies from `provisionLocalAuthFixture`, and Storefront HTTP
  pointed at the isolated Console/API. No secret value is recorded here.
- Production smoke: Console search; editor dirty Escape → Stay → Escape → Discard; Storefront select, quantity
  increase/decrease, add to Order, customer fields and real Order POST; private Order route redacted; loaded Orders;
  open manual-payment panel. All passed.
- Scoped browser contracts:
  `npm run test:browser -- tests/browser/product-phase4-contracts.test.ts tests/browser/storefront-orders-contracts.test.ts tests/browser/console-auth-contracts.test.ts`
  — 3 files, 44 tests passed.
- LSP diagnostics: no errors in changed Console or Storefront TypeScript. Existing TypeScript 7 `FormEvent`
  deprecation hints remain outside this visual repair.
- Per instruction, formatter, lint, build and project-wide suites were not run; the coordinator owns those broader
  gates.

### Remaining registered differences and gate

- E01/E05: production keeps only real destinations, the real Store identity, real search/filter/top-and-bottom
  pagination, cart review, Back navigation and operational action panels. No demo-only My Order, Back to Console,
  View Storefront, noop navigation or mock switcher was introduced.
- E02: visible controls and labeled composite hit targets remain at least 44 px and inputs remain 16 px. Native
  checkbox/file inputs sit inside their 44 px labels. This intentionally moves Products/CSV vertical anchors below
  28–38 px reference controls.
- E04: 375 uses responsive cards/stacks rather than the demo's overflow.
- E08: screenshots show actual pending/manual-payment and pending private-Order states; missing prototype-only state
  in a given capture is not fabricated.
- E09: full generated slugs, Order/payment references, timestamps and real copy wrap instead of truncating. This
  explains nonuniform table rows and the editor fixture's taller slug field.

The plan, affected Phase 2/3 work, and Phase 4 remain open. Independent coordinator review is explicitly pending;
this worker did not mark the plan done.

## 2026-09-15 — independent Astra review and integration

GPT-5.6 Sol ran in the isolated `nexus-parity-sol-repair` worktree from
`37b17af53c8f386d154b33ec4cfb4418e264c3bb`. GPT-6-Astra reviewed the complete source
diff, integrated the seven source-file changes and retained evidence into
`feat-nexus-design-parity`, then exercised the integrated applications separately.
No commit, push or deployment was performed.

### Reviewer findings resolved

- The new horizontal CSV notice squeezed its explanatory text into a 117.953 px
  column at 375, producing a 197 px notice. Added wrapping and a flexible text
  track using the existing split-track token. The text now spans 309 px and the
  notice is 133 px tall; desktop remains 45 px tall. No overflow was hidden.
- The compact shared price guidance had removed the existing warning that changing
  currency does not convert prices. Restored that warning in the shared line and
  associated it with both inputs through `aria-describedby`; no extra per-field
  helper rows were restored.

### Independent runtime proof

- Node 22.16.0; isolated Console/API at `127.0.0.1:5393`, Storefront at
  `127.0.0.1:5394`, and `.wrangler/astra-parity-review` local persistence. Normal
  developer servers and their data were not reused or modified. Authentication
  used the existing local fixture helper and a fresh ephemeral test session.
- Products Add Product ends at x=1416 inside the 1160 px panel at 1440. Its target
  is 109.375×44 px, black fill and white text.
- Products document/body widths match the viewport at 1440, 1024, 1023, 720, 719
  and 375. Add Product stays in bounds and retains the primary action pair.
- A real Product was created and saved through the editor. With a short slug the
  Basics card is 320 px high, matching the reference; the first two tracks are
  402.656/402.672 px. Save Product is black/white when enabled. At 375 the editor
  has no horizontal overflow and editable text computes to 16 px.
- Storefront desktop toolbar is 44 px high and the first card begins at y=428.
  Selected controls are white with dark text, remain 44 px tall, and retain their
  pressed state and selected-card outline.
- At 375 the Storefront toolbar is 96 px high with a full-width 44 px pager row;
  document/body widths are 375. Quantity change, Add to Order, customer fields,
  enabled black/white Place Order, real checkout and the private Order route were
  exercised. The private Order also has document/body widths of 375.
- Original-size desktop PNGs and mobile captures were visually inspected.
  Reviewer captures and measurements are under `repair-20260915/astra-review/`.
  They supplement, rather than overwrite, Sol's before/after evidence.

### Final regression results on the integrated source

- `npm run build:console && npm run build:storefront`: passed, including
  TypeScript and the 30-module production import-graph check.
- `npm run test:browser`: 6 files, 79 tests passed.
- `npm run test:e2e`: 37 tests passed using independent ports 5493/5494 and
  `.wrangler/astra-parity-e2e`.
- Existing Vite future-native-loader extension warnings and Node color-environment
  warnings remain; neither failed a command. No formatter/lint script exists in
  the root package scripts, and none was invented.
- Removed the disposable fixture runner, cookie storage and worker assignment.
  No new permanent tests or compatibility code were added. Canonical tokens and
  design guidelines are intentionally unchanged: these repairs implement their
  existing contract.

### Acceptance boundary

Independent review of this repair is complete, including the two reviewer fixes.
The whole-plan visual acceptance remains open rather than being automatically
declared done from green tests: this round did not freshly recapture every R/C/S
state in the original matrix. Retained historical evidence is not presented as a
new full-matrix review. E01/E05 real operations, E02 accessible controls, E04
responsive adaptation and E08/E09 real states/data still explain visible
differences; they do not authorize new layout deviations. No physical-mobile or
deployed visual verification is claimed.

## 2026-09-15 — fresh Astra self-audit requested by the user

**Verdict: not ready for whole-plan visual acceptance.** This was an independent
read-only source audit, not another repair pass. The previous green regression
results do not establish visual fidelity.

### Confirmed findings

1. **P1 — Full-span editor panels still use the wrong composition.**
   At 1440, the empty Option groups panel is 201 px high versus 115 px in the
   reference. The matrix starts at y=891 versus y=783. The generic
   `.editor-card` padding/gap (`console-layout.css:1579–1625`) is also applied to
   these full-span sections, whereas the reference separates its padded header
   and body with a divider. The generated matrix is inset another 20 px on each
   side: x=121, width=1197.984 versus x=101, width=1237.984 in the reference.
   The always-present information notice (`variant-builder.tsx:310–313`) adds
   68 px even in the empty state. These differences are not the local 44 px
   target adjustments allowed by E02. Add option group also remains a white
   secondary button at line 307, although the reference uses the primary fill.
   Evidence: `audit-20260915-astra/editor-empty-{current,reference}-1440x900.png`
   and `editor-groups-{current,reference}-1440x900.png`.

2. **P2 — A never-saved new Product is labelled Saved.**
   Opening `/console/products/new` with empty fields immediately shows `Saved`
   in the header, while Save Product is disabled. The fallback at
   `product-editor-screen.tsx:298` treats clean create state as persisted state.
   E06 requires truthful durable save state; clean and persisted are different.
   Evidence: `audit-20260915-astra/editor-empty-current-1440x900.png`.

3. **P2 — CSV typography and primary-action width still differ.**
   The dropzone heading computes to 18 px and its helper to 14 px, versus 14/12
   in the reference (`csv-import-screen.tsx:283–284`; reference HTML:382–383).
   These are noneditable text, so E02 does not require the increase. With the
   real downloaded template successfully previewed, enabled Import Products
   measures 133.438 px wide rather than spanning the approximately 530 px
   content track. `.csv-import-actions` uses `justify-items: start`
   (`console-layout.css:2130–2133`). Selected-file metadata is also repeated in
   the validation notice and the additional file-summary block (TSX:299–307).
   Preserve validation/duplicate feedback, but restore the compact reference
   hierarchy and full-width import action.
   Evidence: `audit-20260915-astra/csv-preview-current-1440x900.png`
   versus `csv-reference-1440x900.png`.

4. **P2 — Pending Order Payment loses the reference empty-field structure.**
   Both compared Orders are Pending with no recorded payment. The reference
   keeps Source, Method, External reference, Recorded actor and Recorded time
   visible with honest empty values. The current branch replaces the entire
   structure with one sentence (`order-detail-screen.tsx:1018–1027`), reducing
   the Payment card to 99 px and changing the lower-column rhythm. This is a
   presentation issue, not a request to fabricate payment evidence or change
   payment rules. The separate real assignment controls remain an E05/E08
   extension and are not counted as a defect.
   Evidence: `audit-20260915-astra/order-detail-{current,reference}-1440x900.png`.

### Fresh checks and limits

- Captured 30 unique surface/viewport combinations and saved measured geometry
  in `audit-20260915-astra/measurements.json`. Original-size desktop captures
  were inspected, not merely generated.
- Rechecked sign-in, Products, empty and generated Product editor, nested Variant
  drawer, CSV empty/valid-preview states, Orders inbox, Pending Order detail,
  manual-payment form and public Storefront. Relevant 375 px captures have no
  document/body horizontal overflow; Products also has a fresh 1024 capture.
- Exercised generation, nested Stay/Discard and parent discard without saving
  the temporary Product. Downloaded and previewed the real CSV template without
  importing it. Opened manual payment without recording any payment.
- Confirmed the earlier right-aligned Products actions, wrapped mobile CSV
  notice, Storefront split/card dimensions and white selected-card button.
  Real fixture names/counts, truthful marketing copy, supported navigation,
  accessible target sizes and retained cart/pagers remain narrow exceptions.
- This is not a fresh full R/C/S state matrix: private Order/refund/fulfilled
  states and every responsive boundary were not re-exercised in this pass.
  No fresh build/full-suite result or deployment is claimed.
- No application source was changed in this audit. Plan acceptance remains open.

## 2026-09-15 — A01–A04 repair evidence (new dated bundle)

Bundle: `evidence/repair-20260915-a01a04/` (images + `measurements.json` +
`reference-measurements.json`). The reference anchors were re-measured directly
from the frozen demo served over loopback (`127.0.0.1:8766`), not copied from the
audit; demo `shasum -a 256` values still match `reference-hashes.txt`. The capture
harness is a disposable Playwright spec that reached the real authenticated
Console and the real public Storefront over the isolated fixture stack.

### A01 — full-span editor composition (1440)

| Anchor | Reference | Production | Delta |
| --- | --- | --- | --- |
| Editor panel | x=80 y=24 w=1280 | x=80 y=24 w=1280 | 0 |
| Editor body | y=123 padding 20 gap 16 | y=125 padding 20 gap 16 | +2 (context strip) |
| Basics card | y=143 h=320 | y=145 h=320 | 0 |
| Pricing card | y=143 h=493 | y=145 h=513 | +20 |
| Option groups panel | y=652 w=1239.98 h=115 | y=674 w=1239.98 h=126 | y +22, h +11 |
| — header | h=61 padding 14/16 | h=73 padding 14/16 | +12 (E02 button 44 vs 32) |
| — body | h=52 padding 16 gap 10 | h=51 padding 16 gap 10 | −1 |
| Variant matrix panel | y=783 w=1239.98 h=172 | y=816 w=1239.98 h=175 | y +33, h +3 |
| — header | h=61 | h=73 | +12 (E02 button) |
| — body (empty) | h=41 (table header only) | h=100 (notice) | +59 (E08 state) |
| Matrix table rectangle | x=101 w=1237.98 | x=101 w=1237.98 | 0 |
| Matrix header row | 41 | 40.5 | 0 |
| Matrix data row | 57 | 69 / 68.5 | +12 (E02 44 px inputs) |

Every delta is accounted for, none is a blanket E02 waiver:

- +2 editor body: the production context strip is 45 px because it hosts the real
  44 px `Back to Products` target (reference strip 43 px).
- +20 pricing card: real detail of the change is `.editor-card-body` 471 px vs the
  reference section's 453 px content. Delivery sub-controls are 44 px tall and the
  private instructions textarea renders 16 px text at a 24 px line box (E02),
  where the reference uses 38 px inputs, 30 px buttons and 21 px text.
- +12 per full-span header: `Add option group` and `Generate matrix` are real
  44 px targets, not the source's 32 px, and both are now the primary ink fill.
- +59 empty matrix body: production renders the required empty-state notice
  (`No combinations generated yet.`) instead of the reference's header-only table
  (E08 missing-state composition).
- Matrix column widths match the source allocation: `Enabled` occupies its
  source 90 px by stacking the real checkbox above its visible state text inside
  the 62 px content box (measured `clientWidth` = `scrollWidth` = 62 for both
  `Enabled` and `Disabled`), so `Row` keeps the source 145.23 px at 1440 and
  87.5 px at 1024. `Combination`/`SKU` 247.59, `Price override`/`Delivery`
  173.31 and `Effective price` 160.94 all match, and the table rectangle is exact.
- Generated row height is 69/68.5 px (source 57 px): the +12 delta is the real
  44 px SKU and override inputs. The row action is one compact single-line
  control (`Edit`, accessible name `Edit delivery for <combination>`), so no
  cell reflows into a character column and nothing overflows its cell at 1440
  or 1024.
- The generated panels are not compared by absolute height: the captured
  production Product has one option group with two values (2 rows, matrix panel
  253 px) while the reference fixture has two groups with four combinations
  (matrix panel 332 px). Only the comparable units — table rectangle, header
  row, data row, column widths — are asserted above.
- Under pressure the matrix header keeps its single row: the 12-combination
  confirmation state measures a 206 px panel at 1440 (meter row plus the required
  confirmation control) and the 35-combination blocked state 175 px, with the
  same 73 px header and the generate action disabled in both.

Direct repairs in this round: the always-on `One active Variant schema` notice is
gone; the full-span sections stopped inheriting the top-card 20 px padding/14 px
gap in favour of the reference divided header (14/16 px) over its own body inset
(16 px, 10 px gap); the matrix body is flush so the table reaches the panel's
inside edges (x=101, w=1237.98 — the audit baseline was x=121, w=1197.98); the
meter now shares the header row instead of forcing its own 100 % row (matrix head
104 px → 73 px); `Add option group` is the primary fill again; the always-on
matrix help paragraph was removed (its content is visible in the column headers,
the `Use base` placeholder and the `Base price` subline). The empty third desktop
track, nested drawer, mobile summaries and every generation gate are unchanged.

### A02 — clean creation versus persistence

Observed lifecycle in the real Console (`/console/products/new` → save → reload →
next create), captured in `A02-editor-*-1440x900-production.png`:

| Step | Header state | Save control |
| --- | --- | --- |
| Fresh create route | `Not saved` | disabled |
| After first edit | `Unsaved changes` | enabled once required fields are complete |
| Injected save failure (real Worker error envelope) | `Unsaved changes` | edits retained, error notice shown |
| Successful save | `Product saved` | durable notice, editor stays open |
| Reload of `/console/products/<slug>` | `Saved` | persisted values |
| Next `/console/products/new` | `Not saved` | empty form |

The label now derives from the existing create/persisted lifecycle
(`persistedSlug === null` and no completed save) instead of `dirty === false`
alone; no parallel persistence flag was added and no clean form is marked dirty.
The unsaved branch also covers unapplied nested Variant edits, which the editor
already treats as dirty for navigation, so a persisted Product with an unapplied
drawer edit no longer reads `Saved`.

The lifecycle now has durable regression coverage in the product suite
(`tests/e2e/console-products.spec.ts`, "keeps a clean new Product unpersisted
until a save succeeds"), asserting the same observable sequence: not saved on a
fresh create with Save disabled, unsaved after editing, edits retained and no
success claim after an injected failure, durable saved state with the entered
values after reload, and a clean claim again on the next create route.

### A03 — CSV source hierarchy

Measured at 1440 (`A03-preview-1440`), 1024 and 375 with the real downloaded
template previewed:

- Dropzone heading computes 14/20 px and helper 12/16 px (source 14/12 px).
  Both are non-editable text, so E02's input floor does not apply.
- `Import Products` is 530 px wide — exactly the `.csv-source` content track
  (572 px panel less 20 px padding and 1 px borders). `Download …csv` remains
  fit-content at 333.19 px, so it was not widened.
- File metadata renders once: the single file-check notice carries name,
  `0.8 KB · 3 data rows` and the browser-check sentence. The duplicate
  `Selected file preview` block was removed. The `sizeLabel` helper stays in use
  for the checking/valid/error summaries, and `.file-summary` stays in use by the
  delivery editor. Inside `.csv-source` the file name, size and row count now
  appear in exactly one block (`#csv-file-check`); the only other text matching a
  size pattern is the dropzone helper line `up to 1 MB and 500 data rows`, which
  is instruction copy, not file metadata.
- The wrapped additive notice from the earlier repair is unchanged (45 px at 1440,
  133 px at 375), and 375/1024/1440 have no page-level horizontal overflow.

### A04 — Pending Order with no payment

`A04-order-detail-pending-*` (1440/1024/375) show the restored five-field Payment
card with honest absent values. Each capture scrolls the card into view first, so
the images show the whole grouping rather than the page top. Card height is 216 px
at 1440, 385 px at 1024 and 377 px at 375 — natural wrapping at narrower widths,
never a fixed height; field count is 5 at every width, and the recorded state uses
the same structure:

| Field | No payment | Recorded (real manual payment) |
| --- | --- | --- |
| Source | `No payment recorded` | `manual` |
| Method | — | `Bank transfer` |
| External reference | — | `A04-RECEIPT-…` |
| Recorded actor | — | `E2E Nexus Operator` |
| Recorded time | — | real timestamp |

The Console-only evidence sentence is rendered once at the end of the card. No
synthetic payment identity was introduced; permission gates, assignment controls,
refund/command paths and the `legacy_unrecorded` warning are untouched.

### A01b — matrix pressure states

`A01b-matrix-warning-*` (12 combinations, confirmation required, generate
disabled) and `A01b-matrix-blocked-*` (35 combinations, blocked) at 1440/1024/375
record the header, meter and confirmation layout with the longest status copy and
its controls present, so the single-row meter header is proven under pressure and
not only in the two-row generated case.

### Post-repair regression (2026-09-15)

Run after the A01–A04 repair and the matrix column/row-action correction, on the
isolated loopback fixture stack (`PLAYWRIGHT_API_CONSOLE_BASE_URL` 127.0.0.1:5393,
`PLAYWRIGHT_STOREFRONT_BASE_URL` 127.0.0.1:5394, dedicated persistence root):

| Command | Result |
| --- | --- |
| `npm run build:console` | passed — typecheck, both Vite environments, 30-module production import graph |
| `npm run build:storefront` | passed |
| `npm run test:browser` | 79 passed (6 files) |
| `npm run test:e2e` | 39 passed — the 38 existing Console/Storefront specs plus the new clean-create lifecycle regression |

The disposable capture specs and the reference measurement helper are excluded
from these counts and are removed before delivery.

### Limits of this evidence

- One Console viewport per width per A-ID, plus the scrolled matrix views; the
  A-IDs do not restate the whole V02 matrix.
- The `A02` failure is injected at the network boundary with the real Worker error
  envelope; it is labelled as injection, not a server fault.
- No deployment, remote migration or provisioning is claimed.
