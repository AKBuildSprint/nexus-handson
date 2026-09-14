---
title: "Phase 1: Reference Baseline and Canonical Token Cutover"
status: todo
---

# Phase 1: Reference Baseline and Canonical Token Cutover

## Objective

Make the HTML demo the executable visual target before changing screens. This phase changes the ONE canonical design system and its documentation, not just substitutes variables for existing production literals. A cook that finishes with the old large Console headings, elevated metric cards, 256 px rail, or Storefront editorial layout has failed even if every CSS declaration uses a token.

Dependency: none. Blocks both Phase 2 and Phase 3. Read [reference-parity-contract.md](./reference-parity-contract.md) in full; source regions R01–R09 and exceptions E01–E09 are mandatory.

## Owned files and integration boundary

Modify during cook:

- `docs/design-guidelines.md`: replace superseded visual thesis, token/layout values and component arrangement with the reference-first contract. Preserve domain, privacy, accessibility, live-data and state rules.
- `apps/console/src/styles/design-tokens.css`: canonical semantic values and existing auth primitive styling.
- `apps/console/src/styles/console-layout.css`: global defaults and shared controls/tags/notices/focus; Phase 2 subsequently owns screen layout.
- `apps/storefront/src/styles.css`: aligned `:root` subset and shared control foundations only; Phase 3 subsequently owns its screen layout.

Do not modify `design/UI-UX/Nexus Console.dc.html`, `design/UI-UX/support.js`, packages, API adapters, migrations, auth configuration or production fixtures. Do not create `reference.css`, a theme wrapper, a shared generic package, new font imports or compatibility tokens for retired designs.

Execution ownership: one Phase 1 owner edits these shared files serially. Phases 2/3 begin only after the token/guideline contract is published. Later token changes return to the integration owner, who updates Console tokens, Storefront subset and guidelines together before consumers use them.

## P01 — Freeze usable reference evidence

1. Record checksums of both demo files with `shasum -a 256 "design/UI-UX/Nexus Console.dc.html" design/UI-UX/support.js`.
2. Serve via the loopback command in the reference contract. Wait for fonts and populated repeated rows; do not screenshot a partially hydrated template.
3. Capture 1440×900 reference views R01–R09: sign-in; Products; new/simple/Variant editor; CSV; Orders; Order detail; Storefront catalog/ledger; private Order. Capture editor and long ledgers both at top and bottom.
4. Measure the reference anchors in the browser: rail, deskbar, content inset, auth panel, editor panel/body tracks/header/footer, Storefront content width/columns/media well, private Order cap. Keep a geometry record in the Phase 4 evidence bundle.
5. Capture reference Products at 1024 and 375 and record that the 375 reference overflows (previous audit: 623 px document width with 232 px rail). This is E04 evidence, not a mobile implementation target.

Acceptance: reference screenshots have real rows/cards and fonts, geometry is measured in CSS px, source hashes are retained, and each capture has a named state and viewport. These are baseline evidence, not production completion claims.

## P02 — Reconcile the canonical guideline before implementation

Update the following sections in `docs/design-guidelines.md`; do not leave competing instructions in place:

- §2 visual thesis/principles: replace butter title-rule/white elevated metric-card emphasis with compact bordered paper, tab-like list headings and footer statistics. Keep cream/white/ink/butter palette and meaningful state feedback.
- §3.1 typography: context-specific compact Inter list headings, Source Serif form/ledger/hero titles, reference role sizes below, 16 px input exception. Retire the global assumption that every Console h1 is 40/48 serif.
- §3.2 color: preserve canonical primary ink/white pair and strong input border; define pale decorative dividers separately. Map Active/Paid/Fulfilled to butter/ink, Draft/Pending to muted/ink, Archived/Canceled to error-surface/error-ink per the reference, without changing lifecycle behavior.
- §3.3 spacing: extend only the existing scale with source-required increments, and document the narrow component roles. Do not round every 18/20/28 px source value to 16/24/32 and call that parity.
- §3.4 shape/depth: ordinary panels/secondary controls are border-led without decorative shadows. Existing 4 px control/surface and 40 px pill system remains; E03 covers source 3 px badges.
- §3.7 layout: 232 px desktop rail, 56 px desktop deskbar, 1280 px whole-Product overlay, 480 px focused Variant drawer, 1280 px Storefront content cap and 760 px private Order cap. Preserve compact breakpoint behavior; distinguish desktop deskbar from the 64 px compact topbar and Storefront header.
- §4.1–4.5 shell/header/list rules: retain two destinations and real identity, replace title/metric placement, document source-style columns and compact top/bottom pagination adaptation. Slug/Email/source fields use existing DTO data only.
- §4.6 and §4.8 editor: whole Product overlay is distinct from nested Variant drawer; real save/dirty/deep-link behavior survives. Describe reference auto-fit body tracks accurately.
- Storefront presentation rules: replace full-width four-up grid/ink editorial band with catalog-left/ledger-right, demo marketing headline, two-row snapshot and narrow private Order paper.
- §5 adopted external patterns: keep domain/interaction rationale, remove any obsolete visual mandate that contradicts the HTML. §6–§8 state/accessibility requirements remain; source omissions do not revoke them.

Acceptance: no active guideline clause simultaneously mandates old and new visuals. Every retained difference maps to E01–E09. This is the user-requested visual revision to the existing system, not permission to change any backend or privacy contract.

## P03 — Token mapping and cutover

Inventory all existing token consumers before changing meaning. Reuse semantic names that still mean the same thing; add a name only where two contexts need genuinely different values. Remove unused retired roles after migrating every consumer. Do not preserve `old-*`, `legacy-*`, or `demo-*` aliases.

### Geometry targets

| Existing role or new semantic role | Target | Consumer / reference |
| --- | --- | --- |
| `layout-rail-width` | 232 px | Console rail, R02 |
| Dedicated desktop deskbar height | 56 px | R02; do not also shrink compact header |
| `layout-topbar-height` for compact chrome | 64 px | E04; Storefront header also 64 px |
| Main desktop inset / screen gap | 24 / 18 px | R02–R07 |
| Auth measure / inner padding / gap | 380 / 28 / 18 px | R01 |
| Whole Product panel max width / outer inset | 1280 / 24 px | R04 |
| Editor body padding / gap / track minimum | 20 / 16 / 360 px | R04; responsive-safe min width under E04 |
| Editor header / footer minimum height | 56 / 60 px | R04; grow only for E02/E04 wrapping |
| `layout-drawer-width` | 480 px | Existing focused Variant editor, E06 |
| Storefront measure / vertical inset / inline inset | 1280 / 40 / 32 px | R08 |
| Storefront hero gap / content split gap | 32 / 28 px | R08 |
| Catalog card padding / gap / media height | 18 / 10 / 96 px | R08 |
| Purchase ledger padding / gap | 20 / 14 px | R08 |
| Private Order measure / paper padding / section gap | 760 / 28 / 24 px | R09 |
| Compact inline inset | 16 px | E04 |
| `target-min` and Storefront `target` | 44 px minimum | E02, all pointer targets |

Source fine-grained spacing belongs to a single expanded scale (e.g. 6, 10, 14, 18, 20, 28, 40 px where needed), not component-specific magic numbers. Use named layout roles for intrinsic measures such as table column widths and meter geometry; CSS percentages/minmax/fr remain technical layout expressions, not another scale.

### Typography and visual-role targets

- Font families remain `Source Serif 4` and `Inter`; imports already load 400/500/600. Use one `weight-medium` role for source 500 where needed; retain 400 and 600 semantics.
- Text roles: source UI/body14/20; prose/status14/21; secondary data/card description13/19; short kickers10px; metadata/header11/16 or12/18 by context; Product table names14/20; form group titles18; brand/refund section20; CSV/ledger22/28; sign-in28/34; private Order32/38; hero42/48 with supporting prose15/23; Storefront card title19/25 and price15px. Include these reference-derived roles in the one canonical scale; do not round them to the nearest legacy role.
- Inputs remain 16 px with at least 44 px target. Do not globally reduce `type-body-size` to 14 and accidentally shrink all input text. Give UI prose and editable controls distinct semantic roles.
- Keep the existing root rem basis (normally 16 px at default browser settings). Encode a target such as 232 px as its equivalent canonical rem token; apply source 14 px to the UI body role, not to `html` in a way that silently shrinks every rem-based layout/target. Verify computed geometry at default zoom and browser text scaling.
- Compact list h1 uses Inter 13/20 with 600 weight and source tab frame, not a visually hidden h1 alongside a duplicate decorative label.
- Money/count/date/reference cells use tabular numbers. Source negative tracking applies to serif display headings, not all labels.
- Add/reuse `color-divider` for pale `#eae8e6`; do not redefine strong `color-border` used by inputs. Map white/cream/muted/info/butter/error surfaces to existing semantic roles.
- `color-accent` remains black and `color-accent-ink` white (E03); source near-black is documented as an accepted narrow difference. Primary/active nav may not become butter-filled.
- Remove ordinary `shadow-soft`/`shadow-panel` usage from reference paper surfaces. Remove unused shadow variables only after all legitimate consumers are migrated; no new shadow ramp.
- Retain 4 px radii, hairline/emphasis border roles, 2 px focus ring + 2 px offset, existing 100/180/240 ms motion roles and reduced-motion behavior. No backdrop blur on the Storefront header.

Acceptance: same-named shared semantic values agree between Console and Storefront, each target maps to a token/technical layout expression, and no obsolete global heading/paper rule overrides the new primitives.

## P04 — Shared primitives

1. Buttons: primary ink fill/white text; secondary white + decorative boundary with sufficiently visible interactive affordance; danger semantic ink/border. Default/hover/focus/pressed/disabled/loading all remain readable and reachable. Reserve label width through loading; repeated action is prevented.
2. Targets: implement at least 44×44 px nonoverlapping hit boxes. Increase control rows when necessary; do not overlap pseudo-element hit areas across dense filters/table actions. Treat the height change as E02, not permission for oversized paddings elsewhere.
3. Fields: persistent labels; strong control borders; input font 16 px; 44 px minimum; paired field layouts wrap safely; textarea resizes vertically. Native selects/checkboxes replace reference display spans.
4. Status tags: compact text + 4 px frame/tint; no oversized pills. Apply the reference status fill/text mapping from the shared contract while retaining existing domain-to-label mapping. Additional refund/assignment/regeneration statuses remain explicit and use existing semantic roles.
5. Notices: flat info/error/butter paper at the affected scope. Dirty/save/CSV/checkout/refund failures remain durable, never toast-only.
6. Tables: compact headers and cells; source row dividers; no shadow framing. Skeleton geometry matches rows; empty/error region keeps header/actions. Interactive rows remain tall enough for E02.
7. Focus/dialog layers: keep shared token ownership for z-index; Product overlay above shell, focused Variant drawer above Product overlay, dirty confirmation above its owning dialog. Only the top modal traps focus; underlying content inert while covered.
8. Remove page-level overflow suppression as a way to pass width checks. Existing `body { overflow-x: hidden }` in Console must not conceal inaccessible content. Fix grids/intrinsic sizes, and measure both document/body plus control rectangles.

## Phase gate and handoff

- [ ] P01 reference captures/checksums/geometry recorded.
- [ ] P02 canonical guidelines reconciled without competing visual rules.
- [ ] P03 Console and Storefront shared token vocabulary aligned.
- [ ] P04 primitives preserve focus, input size, targets and durable state.
- [ ] Hand off token names and exact surface-file ownership to Phase 2/3.

Use a real existing screen to smoke shared controls, fonts and computed tokens after the cutover. This is not a declaration of screen parity; final cross-surface browser and regression commands run once in Phase 4. Do not write source-text/token-name snapshot tests as proof of visual similarity.

## Risks and failure handling

- Token changes can resize unrelated surfaces: record consumers before editing; distinguish page title/form/input roles, do not patch over them with per-screen literals.
- Reference and old guidelines disagree: the approved target is this contract, so update the canonical guideline before screen work rather than preserving contradictory old styling.
- Reference controls are small: E02 keeps accessibility; report its exact local geometric impact instead of waiving a whole screen.
- A frozen domain/security rule cannot be met within the layout: keep the behavior, isolate the smallest layout conflict and stop for a decision only if E01–E09 cannot resolve it. Never silently drop the behavior.
