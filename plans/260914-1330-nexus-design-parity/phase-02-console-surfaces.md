---
title: "Phase 2: Console Surfaces"
status: in_progress
---

# Phase 2: Console Surfaces

## Overview

Rebuild every Console surface as a presentation cutover onto `design/UI-UX/Nexus Console.dc.html` (R01–R07) while keeping the existing routes, HTTP contracts, permissions, retry identity, and complete operational states. This phase owns Console markup and Console surface CSS. It does not invent screens, controls, or data.

Read `reference-parity-contract.md` first. Exception IDs below are the contract's; do not add new ones.

## Dependency on Phase 1 (blocking)

Phase 1 owns `apps/console/src/styles/design-tokens.css` and the shared primitive block of `console-layout.css`. Phase 2 starts only after Phase 1 lands these roles. If a role is missing, request it from Main in Phase 1 — never introduce a per-surface literal or a second token ramp.

| Role Phase 2 consumes | Target | Existing value to replace |
|---|---|---|
| `--layout-rail-width` | 232 px (`14.5rem`) | `16rem` (`design-tokens.css` `:root`) |
| `--layout-deskbar-height` (new) | 56 px (`3.5rem`) | `--layout-topbar-height: 4rem`, reused by the deskbar |
| `--layout-topbar-height` | unchanged | compact shell at ≤719 px |
| `--layout-content-inset` (new) | 24 px (`1.5rem`) | `--space-8` (32 px) in `.console-main` |
| `--layout-section-gap` (new) | 18 px (`1.125rem`) | `--space-8` in `.page-stack` |
| `--color-divider` (new) | `#eae8e6` | pale value currently borrowed from `--color-surface-strong` |
| `--color-border` | `#8a8182` control boundary | already correct, keep on inputs |
| Status fill roles (positive / neutral / negative) | see “Locked status fills” | currently `status-active` / `status-draft` / `status-archived` pairs |
| `--layout-drawer-width` | 480 px, keep | already `30rem` |
| `--target-min` | 44 px, keep | already `2.75rem` |
| Type roles: tab label 13, panel title 18/24, CSV/ledger title 22/28, sign-in 28/34, detail heading 18 | reference values | `--type-page-size: 2.5rem` stays available, must no longer be used by list screens |

Phase 1 also owns the shared primitive rules inside `console-layout.css` (`.button`, `.field`, `.notice`, `.status-tag`, `.skeleton-*`, focus). Phase 2 edits only the Console surface rules below those primitives. Main arbitrates any conflict.

## Locked status fills (mirror exactly)

Extracted from the reference (`HTML 793–797` product, `799–804` order). E03 keeps the 4 px tag corner and the ink primary action; it does not license arbitrary legacy colors.

| State | Fill | Ink |
|---|---|---|
| Product Active | butter `#f1f29f` | `#1b1c1b` |
| Order Paid, Order Fulfilled | butter `#f1f29f` | `#1b1c1b` |
| Order Pending, Product Draft | muted `#f6f3f1` | `#1b1c1b` |
| Product Archived, Order Canceled | `#ffdad6` | `#93000a` |

Apply through the reusable tag presentation rules; no domain transition changes. The small list/header `Refund pending` outline tag is neutral as in HTML486; the actual Refund request panel's Pending tag is butter as in HTML590. Do not apply a blanket “never butter” rule to all refund surfaces.

## Geometry contract

Panel/control/tag radius4 (E03); every interactive target≥44px; editable text≥16px through a distinct input role, not an assumption about body font inheritance. Ordinary paper panels/tables/deskbar use borders, not shadows.

| Surface | Desktop 1440 | 1024 | 375 |
|---|---|---|---|
| Shell | 232 px rail + 56 px deskbar, 24 px inset, 18 px gap | same shell | compact topbar + menu, 16 px inset (E04) |
| Products table | 7 columns, min-width 900 px, header 10/12 px, body 14 px | local `overflow-x` region (E04) | summary cards, table hidden |
| Orders table | 8 columns, min-width 1040 px, body 12 px | local `overflow-x` region | summary cards |
| Editor overlay | scrim + 24 px padding, panel max-width 1280 px, body `repeat(auto-fit,minmax(360px,1fr))` gap 16 padding 20 | 2 tracks | full-width, single forced track |
| CSV workspace | 2 equal tracks, gap 16 | 2 tracks | 1 track |
| Order detail | 2 tracks, gap 16 | 2 tracks | 1 track |

Editor body math: a1280px panel minus40px body inset leaves1240px; two16px gaps leave1208px for THREE tracks≈402.67px at1440. Basics occupies track1, Pricing/Delivery track2; full-span groups/matrix keep track3 from collapsing. At1024 the overlay spans the viewport minus48px outer inset (the rail does NOT reduce overlay width) and resolves to two tracks. At≤719 force one safe track. CSV/detail source340px minima likewise require responsive-safe minima or explicit single-column rules whenever their actual container cannot fit two tracks.

## C01 Sign-in

Owner: `apps/console/src/sign-in-screen.tsx`. The `.console-auth-page` / `.console-auth-card` / `.console-auth-form` rules currently live in `design-tokens.css:91–119`, which is a token file (Console-only: imported by `apps/console/src/main.tsx`). Relocate those three surface rules into `console-layout.css` as part of this phase and edit them there; because Phase 1 owns `design-tokens.css`, coordinate the relocation with Main and never edit token declarations. Reference R01 (`HTML 24–64`).

Layout: canvas-centred card, max-width 380 px, padding 28 px, gap 18 px, white surface, 1 px `--color-divider` border, radius 4.

- Add the 36 px ink `N` mark (serif 18 px, `aria-hidden="true"`).
- Keep kicker `Nexus · Operations Console` (11/600/0.08em uppercase muted) and the real `h1` **Sign in** at 28/34 serif, `-0.02em`.
- Keep the real paragraph “Continue with the Google account provisioned for your Store.”
- Notices: `expired` renders on the muted/info surface with `role="status"`; a real sign-in failure renders on the error pair with `role="alert"`. Keep both real message strings.
- Keep the 44 px Google button and its real label **Continue with Google** plus the disabled **Connecting to Google…** state.
- Add the source's accurate access-help block: Google authenticates; active Store membership authorizes; Owners manage the Store; Staff see Products read-only and work only assigned Orders. Assignment visibility is enforced server-side by `packages/orders/src/order-access.ts` (`consoleVisibilitySql`, lines5–22); absence of a frontend assignee filter does not mean unrestricted Staff access. Keep these permissions unchanged.
- Remove the demo’s cycle-preview link (E07). Remove the unused `.console-auth-form` rule.

States to render: `expired`, canceled/failed sign-in (`?error=google_sign_in_failed`), submitting, session-resolving (`Checking Console session…`).

## C02 Shell and Products list

Owners: `apps/console/src/layout/console-shell.tsx`, `production-console-app.tsx`, `products/product-list-screen.tsx`, `.console-*`/`.page-*`/`.data-region`/`.console-table`/`.product-pager` rules. Reference R02 (`HTML 240–285`) and R03 (`287–360`).

### Shell changes

- `.console-rail`:232px white/right divider/no shadow. Do not apply one inset to the whole rail: source identity block uses18px16px with bottom divider; nav uses14px10px; bottom user block uses14px16px with top divider. Top has32px N mark + real Store name13/600 and role11px. Preserve full identity text via wrapping (E03), no ellipsis. Keep two destinations only, source36px visual rhythm adapted to44px targets. Bottom real user/initials/sign-out and quiet supported context; omit View Storefront only because the current Console has no supported public Storefront URL source (E01), never add a dead/hard-coded link.
- `.console-deskbar`: 56 px, solid white, bottom divider, 24 px inline inset. Leading: the hosted screen search. Trailing: one quiet `{storeName} · {Owner|Staff}` text. Remove the kicker sentence, the duplicate Sign out, the decorative search icon-button, all backdrop blur, and any “Contract v2”-style decoration (E07).
- Keep `.skip-link`, `#console-content` focusability, and the compact `.console-topbar` + `.mobile-nav-panel` at ≤719 px untouched.

### Hosting the real search in the deskbar

Do this, do not move state:

1. Add a narrowly scoped desktop search host to `ConsoleShell` and expose its element through a local slot/context; keep Product/Order search state owned by its current screen. Obtain LSP references before changing exported props; migrate BOTH `ProductionConsoleApp` and development `ConsoleApp` explicitly, plus meaningful test renders. Do not use optional compatibility props merely to avoid caller migration.
2. `ProductListScreen`/`OrdersScreen` render exactly one real search form/input: portal into the host only when it is present AND the viewport is desktop (≥720px), otherwise render inline at the top of the compact screen. The host registration must clear on compact layout/unmount; a CSS-hidden deskbar can still contain a non-null node, so node existence alone is not the condition.
3. Preserve drafts, committed criteria, cursor/page resets and input value through719↔720 resizing. If the focused input changes host, restore focus/caret without submitting/resetting the form. Verify search remains visible, focusable and functional on mobile rather than portaled into `display:none`.
4. Use the Products host for list and its real editor backdrop; the Orders host for Orders/detail where its existing search context is supported. Never render a fake empty search control on a screen without a real search action.
5. Keep visible concise labels associated with the real input (E02); compact label positioning may differ locally from the unlabeled source. Search is rectangular radius4, source max620px,44px target/16px editable text. Preserve complete form submission semantics, not a test's first-`form` query. Remove unsupported⌘K decoration.

### Products list composition

- Replace `.page-header` with a raised-tab head: `<h1>Products</h1>` styled as the demo’s 13/600 tab (white, top radius 4, divider border with the bottom edge collapsed onto the panel), 34 px tall; spacer; trailing quiet context (keep the exact read-only sentence “Read-only Product catalog for this Store.” when `readOnly`); then the real actions `Download CSV template` (with its loading/retry labels), `Import CSV`, `Add Product`. Remove the serif 40/48 title, the `.page-kicker::after` butter dot, and the owner description paragraph.
- Delete `.metric-strip`/`.metric-card`/`.metric-card-accent::after`/`.metric-value`/`.metric-meta`. Keep the `catalogCounts` computation and render it as the footer statistics row described below.
- Panel: restyle `.data-region` to white with a 1 px divider border, radius 4, `overflow: hidden`, no shadow; add `.console-panel-head` (divider bottom, 12/16 px padding) holding the real status tabs plus the top pager, whose existing `Showing x–y of n · Page a of b` copy carries the reference's range text — do not add a second range readout.
- Status tabs retain their existing selection/keyboard/filter semantics and All/Draft/Active/Archived labels. Use source compact radius4/ink-selected treatment with44px targets (E02; source30). Products has no source per-tab counts; do not invent them. Keep filters in the paper header, not large floating pills.
- Table: 7 columns with the reference widths — slug 130, name flexible, status 110, type 100, effective price 150 (end), enabled variants 100 (end), updated 150 (end) — `table-layout: fixed`, `min-width: 900px`, wrapped in a scroll region. Add the real `product.slug` cell (12 px muted, `overflow-wrap: anywhere`); keep the name cell as the real `a.product-link` (14/500, underline offset 3 px). Header row on canvas tint, 11/600/0.06em uppercase muted, 10 px vertical / 12 px horizontal padding, 16 px at the outer edges; body rows 14 px vertical padding with 1 px divider bottoms. Keep `aria-label="Products in this Store"`.
- Keep the mobile `.product-list-mobile` summary cards and the table-hidden rule at ≤719 px.
- Keep loading skeletons, `error` (`role="alert"`), `empty`, filtered-empty (h3 `No Products match these filters.` + `Clear filters`) and `template-error` compositions inside the panel, restyled to the reference’s padded block.

### Pagination and statistics

Keep both pagers (`ProductListPager placement="top"` in `.console-panel-head`, `"bottom"` in the footer row) with the existing `aria-label={`Product pages ${placement}`}`, the existing range/page strings, and the disabled logic. Add a static, non-interactive `{page}` chip and a `25 / page` indicator (real `PRODUCT_PAGE_SIZE`) — never a numbered page button.

Footer row (`.console-table-footer`, canvas tint, divider top, 12/16 px padding, `flex-wrap`): `Products`, `Active`, `Simple`, `Variant` as inline `label <strong>value</strong>` pairs at 12 px (value ink, tabular); spacer; pager. Drop the metric-card prose meta lines. Real values only (`catalogCounts`).

Acceptance for C02: accessible Products heading and two real destinations;232/56 white shell; compact table and live footer statistics; both meaningful pagers; real search visible and working in desktop host and mobile inline position, including resizing while a query is entered.

## C03 Product configuration overlay

Owners: `production-console-app.tsx`, `products/product-editor-screen.tsx`. Reference R04 (`HTML 618–744`).

Route and shell contract: keep `/console/products/new` and `/console/products/:slug`, `parseRoute`, `routePath`, `pushState`/`popstate`, and the post-create `replaceState` to the saved slug. Direct navigation and reload must render the same overlay.

Composition:

- The app renders, for `route.kind === 'new' | 'edit'`: the real Products list surface as a backdrop, `inert` and `aria-hidden="true"`, plus the overlay.
- Backdrop source: keep the same real Product list instance/state/layout behind the overlay, including its heading, actions, filters, table and footer; make it inert while covered. No stripped-down backdrop renderer, duplicated second list or hidden compatibility form. Ensure unique IDs by rendering one list and one distinct editor, not cloning either.
- Direct editor entry may load the real catalog for its backdrop using existing auth/identity generation and abort guards. Track loaded/loading/error state explicitly; do NOT use `listItems.length` as a loaded flag because a successfully loaded empty catalog is valid. Avoid effect loops, duplicate fetches and stale cross-identity backdrop data; normal list→editor navigation retains existing list/filter/page state.
- Overlay: use a native `<dialog>` opened with `showModal()` as the full-viewport transparent layout host. Explicitly reset UA margin/border/max-size, use viewport width/height, border-box padding24, and center the internal panel; apply open-state grid styling only while open. `::backdrop` provides the scrim. At≤719 use0 outer padding/full-width/full-height panel. Render dialog outside any manually inert shell ancestor, and intercept `cancel` so dirty checks happen before native closure.
- Panel: `width: 100%`, `max-width: 1280px`, `max-height: 100%`, `overflow: auto`, radius 4, background `--color-surface-muted`, internal scroll.
- Sticky header56px, white/divider: source title **Product configuration** at18px serif, real status tag, spacer, durable dirty/saved state,44px Close control. No Save/Discard/Back button stack in this header; the reference primary actions are in the footer. Associate the dialog with the title and real Product context. Focus the name input for create or the appropriate heading/field for edit.
- Context strip42px: noninteractive Console label plus real Product context; omit dead Storefront preview tab (E07). Put compact Back to Products navigation here if needed by the existing workflow, not another primary action. Keep name/slug context accessible without replacing the source header with an arbitrarily long Product title.
- Body: `padding: 20px`, `display: grid`, `grid-template-columns: repeat(auto-fit, minmax(360px, 1fr))`, `gap: 16px`, `align-items: start`. All panels are white, 1 px divider, radius 4. Only Basics and Pricing/Delivery use uniform 20 px padding and 14 px gap; full-span panels use the separate header/body composition below:
  - Track1 — Basics: persisted slug/status pair, name, public description. Current `ProductEditorFixture` has no slug field: pass loaded persisted slug as display-only view metadata, not a new editable domain field. New Product uses honest “Assigned after save” context until a real slug exists; no fixture/generated placeholder slug is submitted.
  - Track 2 — Pricing + Delivery: base price/currency pair, currency helper, divider, private delivery title/instructions, private file summary + `Choose PDF or ZIP` control (keep the real `DeliveryEditor`, its byte checks, its 25 MB limit, and the pending-file state).
  - Full-span (`grid-column: 1 / -1`) — Option groups, then the Variant matrix. Do not inherit the top cards' uniform padding/gap. Use a compact header with 14 px vertical / 16 px horizontal padding and a bottom divider; Option groups body has 16 px padding, while the desktop matrix table reaches the inside panel edges. Resolve dimensions through existing tokens; source control heights expand locally under E02. Delete `.editor-form { max-width: 60rem }` and the `.editor-section` stacked layout.
- Sticky footer minimum60px, white/divider: concise real state/delivery summary at left, Discard changes when dirty and ONE primary Save Product at right. Keep save/failed-save labels and handlers. Use one footer/action set across breakpoints, sticky inside the scrollable panel; remove duplicate desktop/header/mobile save hosts once migrated. At375 allow wrapping/growing and reserve content space so no field is hidden behind it. Migrate helpers that currently select `button.desktop-save`/`.mobile-save-bar`; do not duplicate controls for them.
- Field labels stay intact (`Product name`, `Base price`, `Currency`, `Product status`, `Customer-visible description`, `Private access title`, `Private access instructions`) with their `htmlFor`/id pairs and error ids (`#delivery-access-title-error`, `#delivery-access-title`).

Save lifecycle: keep production behavior — `saveProduct` persists, updates `revision`, sets `detailLifecycle: 'saved'`, leaves the overlay open and shows the durable `Product saved` notice (`role="status"`). Never adopt the prototype’s `closeEditor` noop close (E06).

Clean create state is not persisted state: before the first successful save, show honest **Not saved** context, not **Saved** or **Product saved**. An untouched new form stays clean with its existing disabled-save/dismissal behavior; do not mark it dirty merely to change the label. Dirty, saving and save-error take precedence. Only loaded persisted data or a successful save may show a clean persisted state; returning to a fresh create route must reset it.

Dismissal: retain a single dirty-navigation decision path, but replace synchronous `window.confirm` with the existing app-local accessible guard pattern used by the development/Variant flows. It must explicitly offer **Stay and continue editing** / **Discard changes** and sit above the owning dialog. Queue the intended Close/Back/navigation/history target without clearing dirty/files/schema state; Stay cancels the intent and restores focus, Discard commits it exactly once. Reuse the current guard/history reconciliation pattern rather than add a second router. Intercept Escape/cancel and Browser Back before destructive state clearing; prevent repeated intents while a guard is open. The footer Discard keeps its current restore-saved semantics instead of being conflated with leave-and-discard. Native browser-leave protection may complement this. Existing tests that pin `window.confirm` or its wording must migrate to the observable keep/discard behavior, not dictate presentation.

States: `create`, `loading` (skeleton header + panel), `ready`, `dirty`, `saving`, `saved`, `save-error`, `error`, field/child/server blockers, delivery blockers, variant blockers, `sessionRevalidating` quarantine.

Acceptance for C03: deep link `/console/products/<slug>` renders the overlay over a non-fabricated backdrop; three editor tracks at 1440 with an empty third, full-span groups/matrix; Esc and ✕ ask before discarding; the saved notice stays visible after save; nested focus returns.

## C04 Variant builder: meter, matrix, drawer, files, regeneration

Owners: `products/variant-builder.tsx`, `variant-matrix.tsx`, `schema-change-preview.tsx`, `delivery-editor.tsx`.

- Meter: reference inline count,140×8 track, muted/divider frame, butter fill and ink thresholds. Use source display scale36 consistently for fill and10/30 markers; the BUSINESS limit remains30, not36. Preserve descriptive accessible count+consequence, explicit threshold labels and warning/blocked message. Confirmation label must interpolate the actual count (“I reviewed this {count}-combination matrix”), never hard-code12 from a fixture. At0 generation is disabled with the existing empty guidance;1–10 ready;11–30 confirmation required;31+ blocked.
- Group limits stay 5 groups × 10 values. Exact 11 and 31 combination counts are not constructible from those limits; the suites already cover reachable 10/12/30/35 (`tests/e2e/console-variants.spec.ts:42–75`) and Phase 4 uses component fixtures for the 11/31 copy. Never change the limits to fabricate those labels.
- Option groups (`.option-group`): keep the real per-group name input, the `Participating` / `Not participating` checkbox, `Add value` (disabled at 10 values), per-value removal, group/value counters, and every error/label association. Restore the compact group-row composition while retaining 44 px targets and 16 px editable text. Use the primary fill/ink for **Add option group**. Remove the always-present `One active Variant schema` notice and duplicate explanatory blocks; retain one concise limits/participation explanation in the header/body and all conditional validation, warning and regeneration feedback. Use one simple-Product empty sentence rather than stacked informational notices. This supersedes the earlier instruction to keep the unconditional notice.
- Matrix: reorder desktop columns to source Enabled90px / Combination20% / SKU20% / Price override14% / Effective price13% / Delivery14% / Row action remainder. Real checkbox/input/edit actions remain44px/16px where applicable. Preserve Base price/Override as an effective-price subline and Product default/Variant override in delivery; remove a redundant separate Price source column only after keeping this information visible. Keep row-associated errors and existing mobile summary/edit behavior. Class names and old column indexes are not compatibility requirements.
- Drawer: keep the distinct 480 px nested `<dialog>` child for row/delivery override — header (combination + Close), body (SKU, price override, Enabled, delivery-source radios, Product-default summary or the Variant-override `DeliveryEditor`), footer (state text + Cancel + **Apply Variant changes**). `::backdrop` uses `--color-scrim`; panel is white/radius 4 with sticky header and footer; ≤719 px is full-width. Keep the `Discard unsaved Variant changes?`, `Use Product default instead?`, `Stay and continue editing`, `Discard Variant changes`, `Keep Variant override`, `Use Product default` guard copy, the required-field errors, and focus return to the row’s `Edit delivery for …` trigger. Nested-dialog stack order and the parent dirty guard must still hold (E06).
- Regeneration (`schema-change-preview.tsx`): keep the `Preview regeneration` heading, `Retained` / `New` / `Will disable` tags, the duplicate/conflicting SKU blockers, and **Regenerate matrix**; restyle the block as a paper panel with a summary count row.

States: no groups/simple Product;0 disabled-empty;1–10 ready;11–30 warning+confirmation;31+ blocked; structural dirty/regenerating/preview; SKU/price errors; drawer clean/dirty/guarded; no file/selected/validating/valid/invalid-bytes-or-type/oversize/replacement/remove/save-or-upload-failure; delivery-mode conflict.

## C05 CSV split workspace

Owner: `imports/csv-import-screen.tsx`, `imports/csv-preview-table.tsx`, `.csv-*`/`.dropzone` rules. Reference R05 (`HTML 362–428`).

- Head row: keep `Back to Products`, make the title the 22/28 serif `Import Products from CSV`, keep `Start another import` when a durable result/failure exists, and move the “One fixed template · no field mapping” context to a quiet trailing span.
- Keep the additive notice (`Additive exact-match`) on the info/muted surface.
- Workspace: `grid-template-columns: repeat(auto-fit, minmax(340px, 1fr))`, `gap: 16px`, `align-items: start` (replaces `2fr / 3fr`); remove the sticky positioning of `.csv-source`; force `minmax(0,1fr)` at ≤719 px.
- Left panel (`.csv-source`, white paper, 20 px padding, 14 px gap): `Template and file` at 18/24 serif, the real `Download <CSV_FILENAME>` control with loading/retry labels, then the byte-checked dropzone (2 px dashed `--color-border`, muted fill, centered content, real `Choose CSV`/`Replace CSV` label wrapping `#csv-file`). Dropzone heading uses the reference 14 px UI role, helper 12 px; editable controls still use 16 px and 44 px targets. Keep file-check status plus filename/size/row count in ONE compact summary; remove the duplicate selected-file summary markup, not unique validation feedback. Preserve catalog-identity loading/errors, warning confirmation, ≥31 blockers and upload/import/result recovery. **Import Products** spans the full inner track (about 530 px at 1440), with existing progress/retry labels and a separate readable disabled reason. The template-download action remains content-width.
- Right panel (`.csv-preview`, white paper, header divider row): `Browser preview` at 18/24 serif + the provisional note + the real `N Product groups · N rows` count; then the grouped outcome rows (slug, detected type, derived combinations, outcome tag) and the source-row rows in source order. Keep the `<details open>` disclosure structure and its keyboard behavior; restyle the summary row to the reference composition (`Row N · slug · sku` + outcome tag) and the group header to slug + bordered type tag + detail + outcome tag.
- Footer statistics row: keep the real `Ready` / `Duplicate candidate` / `Rejected` counts (browser preview) and the authoritative result counts (`Added` / `Duplicate` / `Rejected`) in the result branch.
- Keep the durable result and failure branches (`notice-success` / `notice-error`, `#import-result-title`, `#import-result-error-title`, `#import-failure-title` and their focus moves) — E08 composition, unchanged semantics.

States: `catalog loading/error`, `file idle/checking/valid/error`, no validation, validation ready, warning + confirmation, blocked ≥31, `uploading`, `checking`, authoritative result (all-rejected / all-duplicate / mixed), request failure, result-decode failure, `Start another import`.

## C06 Orders list

Owner: `orders/orders-screen.tsx`, `.order-*`/`.orders-table` rules. Reference R06 (`HTML 430–517`).

- Head: raised-tab `<h1>Orders</h1>` (text exactly `Orders`, never the demo’s filter-dependent `Refund requests` label) with the spacer and the real `Pending refund requests` checkbox moved into this head row (the demo places it there). Remove the `.page-kicker` and the description paragraph; `railNote` already carries context.
- Keep the real search form in the deskbar (C02 hosting): `#order-search` + `Search` submit + Enter submit + the real draft/commit split and cursor reset.
- Panel: `.data-region` restyle as C02. Header row: the real status tabs `All | Pending | Paid | Fulfilled | Canceled` (same roles/keys/`aria-selected` as today, 5 tabs) + spacer + the top pager, whose existing range/page copy carries the reference's range readout.
- Table: 8 columns, `min-width: 1040px`, body 12 px padding — Order 96 (link), Customer 150 (initials circle + name), Email 170 (split out of the current stacked cell), Items flexible (title + detail), Total 100 (end, tabular), Payment ref 110, Status 130 (status tag + `Refund request pending` tag), Created 120 (end). Wrap in a scroll region (E04). Keep `aria-label="Storefront Orders"` and keep unit prices out of the list.
- Footer row: the six real server-summary statistics from `orderSummary` — `Matching Orders`, `Pending`, `Paid`, `Fulfilled`, `Canceled`, `Open refund requests` — as inline label/value pairs (the demo shows five because its fixture lacks one; do not drop a real value), spacer, bottom pager.
- Keep `.order-list-mobile` summary cards, `MatchingSummary` removal (its markup is replaced by the footer statistics; keep the `summary.totalOrders` value), the range/page strings, the disabled logic, and the `no-results` actions (`Clear filters`, `First page`).
- States: `loading`, `ready`, `empty`, `no-results` (result set changed vs no match), `error` (retry) and `error` + `contractOutdated` (reload), filter/search/refund-pending combinations, cursor paging with `hasPreviousPage`/`hasNextPage`.

## C07 Order detail, status, actions, assignment, refund

Owner: `orders/order-detail-screen.tsx`, `.order-detail-*`/`.order-history`/`.order-items-*` rules. Reference R07 (`HTML 519–611`).

Keep the entire command layer as-is: `loadOrder`, `refetchAfterWrite`, `confirmAction`, `assignOrderToStaff`, `decideRefund`, the frozen attempt identities, the 15 s mutation deadline, the single command lock, `pending-role-command` recovery, the `BroadcastChannel` refresh, and every notice kind.

- Header: Back to Orders + divider + real reference h1(18/600 tabular) + status/refund tag + spacer + source-positioned permitted quick actions. Never show commands absent from `allowedActions`. Retain the current command labels/retry semantics, not fixture labels that imply another operation.
- Two source340px-minimum tracks/gap16, safely collapsing when the actual container is too narrow:
  - Left: Order snapshot and immutable item snapshots; Payment including current none/recorded/legacy-unrecorded evidence; History with real timestamps/actors/action semantics.
  - Payment `none`: preserve the same five-field structure as recorded payment — Source, Method, External reference, Recorded actor, Recorded time. Use truthful no-payment text and em dashes for absent values; retain the compact Console-only evidence explanation. Do not collapse the card to a lone sentence or invent actors/references/timestamps. Keep the distinct `legacy_unrecorded` warning and the instruction not to ask for payment again; real recorded evidence stays unchanged.
  - Right: current Refund request summary first when present (source title18px, Pending butter tag); manual-payment action region next; compact Assignment extension after the reference sections when `canAssign`; other existing confirming forms occupy this same action region when invoked.
- Keep each command in ONE interactive host. Header quick actions may open their real confirming panel; do not duplicate Approve/Reject or Mark Paid submit buttons in header and sidebar just to fill the layout. Show pending payment's permitted real Record manual payment/Cancel workflow in the source right-hand paper region; inapplicable status panels are absent rather than a disabled fake form.
- Preserve fields/acknowledgment and confirmation for payment, fulfillment, cancel, customer refund, approve/reject and assignment; source mock display-spans become real existing controls. Panel headings receive focus on open, closure restores the trigger. No assignment filter, new command, altered permission or state transition is introduced.
- Keep every notice composition verbatim: `unknown` (retry the same action), `conflict` (idempotency / previous-contract reload), `outdated` (reload, never retry), `read-after-write`, `recovery-unavailable`, `error`, `state === 'error' && order` (latest Order could not be loaded), `not-found`, and the load-error/outdated empty states.
Permission map (evidence: the `order-detail` branch of `production-console-app.tsx` and the gates in `order-detail-screen.tsx`):

| Control | Required |
|---|---|
| `mark_paid`, `fulfill`, `cancel`, `request_refund` | present in `order.allowedActions` |
| `approve_refund`, `reject_refund` | `order.allowedActions` **and** `order.refundRequest?.status === 'pending'` |
| `Assign` | `session.allowedActions` includes `order:assign` **and** `staff:list`, with a real staff candidate list |
| Products create/edit/import | `session.role === 'owner'`; `staff` is redirected to `/console/products` |

Status and label parity: `Pending | Paid | Fulfilled | Canceled` with the `Unknown status` fallback, `Refund request pending | approved | rejected`, the `Refund request pending` tag in the list, and the exact `detailIntro` copy per status.

States: `loading`, `ready`, `not-found`, `error`, `outdated`, `conflict` (idempotency / legacy key), `unknown`, `read-after-write`, `recovery-unavailable`, per-action `inFlight`, per-field 422 errors, refund pending/approved/rejected, payment `none`/`recorded`/`legacy_unrecorded`, assignment loading/ready/busy/retry.

## C08 Roles, auth recovery, mobile

- `sessionRevalidating` quarantine: keep `Checking Console session…` plus the `hidden`/`inert` wrapper so background content is not reachable; styling only.
- `expired`/`signed-out` returns to the C01 card; `handleSignOut` still clears private state, replaces history to `/console/products`, and re-resolves on failure.
- Staff: read-only Products (no Add/Import/Template), redirect away from `new`/`edit`/`import`, no assignment/refund-decision controls; `401` / `store_access_denied` still ends the session on every fetch path.
- Mobile≤719 (E04): compact shell/menu,16px inset, summary cards, safe single-column editor/CSV/detail, full-width parent/child dialogs and the SAME reachable sticky editor footer. Search is inline, not hidden in a desktop portal. Verify375/719/720/1023/1024 no page overflow/clipped actions; intermediate multi-track grids collapse based on actual available width.

## State coverage matrix

| Surface | Production state names | Required visible composition |
|---|---|---|
| Products | `loading`, `filtered-loading`, `row-opening`, `populated`, `empty`, `error`, `template-error` | panel skeleton / dimmed rows / opening row / 7-column table + stats / empty CTA / error alert + retry / template notice |
| Editor | `create`, `loading`, `ready`, `dirty`, `saving`, `saved`, `save-error`, `error` | overlay header + strip + tracks + footer / saved notice / blocker summary |
| Variant | ready, warning, blocked, structural dirty, preview open, drawer clean/dirty/guarded | meter copy + confirmation / disabled generate / preview outcomes / drawer footer state |
| CSV | idle, checking, valid, error, uploading, checking-import, result, request failure, result failure | split workspace, notices, provisional vs authoritative counts |
| Orders list | `loading`, `ready`, `empty`, `no-results`, `error`, `contractOutdated` | panel states + stats row + dual pager |
| Order detail | `loading`, `ready`, `not-found`, `error` + 6 notice kinds | head actions + two tracks + notice stack |

## Behavioral contracts and test migration

Preserve accessible navigation/current location, unique field IDs/labels/error associations, filter keyboard semantics, real pagination ranges, route URLs, durable save/errors, row identity/source information and auth/privacy. These are contracts. A first-`form` query, `.metric-card`, duplicated `.desktop-save`/`.mobile-save-bar`, native `window.confirm`, exact incidental prose, or old column positions are not contracts. Migrate affected meaningful tests/helpers to the actual accessible surface; remove implementation-only assertions instead of preserving invisible compatibility DOM. Test the keep/discard outcome, not the old dialog API.

Reported to Phase 4 as presentation-contract updates (Phase 4 owns test edits; Phase 2 must not leave these stale):

| Test | Line | Change |
|---|---|---|
| `tests/browser/product-phase4-contracts.test.ts` | 134–135, 174–175 | `.metric-card` / `.metric-label` / `.metric-value` assertions move to the footer statistics row, keeping the live `26` / `10` value assertions |
| `tests/browser/console-orders-contracts.test.ts` | 722–723 | `.metric-card` with `Matching Orders` moves to the footer statistics row, keeping the `30` assertion |
| `tests/e2e/console-products.spec.ts`, `tests/browser/console-auth-contracts.test.ts` | current native-confirm and save-host cases | Exercise the new accessible Stay/Discard guard, one sticky Save action, real persistence, deep-link reload, Back/Forward and focus restoration; remove native-confirm message/API pins |

## Non-goals

- No API, Worker, schema, migration, auth, permission, or domain-transition change; no new Order command, refund step, or assignment rule.
- No new preview, shortcut, provisioning, or Storefront-link feature; no inert placeholder control (E07).
- No third Console destination; no rail counts; no per-tab counts computed from page-only totals.
- No second token ramp, no local literals for reference values, no shadows reintroduced for paper surfaces.
- No change to group/value limits, page sizes (Products 25, Storefront 24, Orders 25), search semantics, or URL criteria sync.
- No new routing/domain workflow, compatibility surface, fixture arrays or `DCLogic`; the presentation guard/overlay must preserve existing intent and persistence semantics.
- No notice, list cell, or panel renders a private capability URL or token; payment/Order references stay exactly as already projected by the API (E09).

## Acceptance (C01–C08)

- **C01** — Sign-in at 1440/1024/375 shows the mark, kicker, 28/34 serif title, muted expired notice, error-pair failure notice, 44 px Google button with the real label, and the accurate access-help block; the demo cycle link is absent.
- **C02** — Rail 232 px white + deskbar 56 px white with the hosted real search; exactly two destinations; Products head is a compact raised tab with the real h1; the 7-column panel matches the reference widths and both pagers plus the live footer statistics render; the metric cards are gone.
- **C03** — `/console/products/new` and `/console/products/:slug` deep link and reload into the centred scrimmed overlay over a real (never fabricated) backdrop; at 1440 the editor shows three auto-fit tracks with an empty third and full-span groups/matrix; Save persists, keeps the overlay open, and leaves the durable Saved notice; ✕/Back/Esc guard dirty state and restore focus.
- **C04** — The meter shows `N of 30 combinations` with the aligned fill/markers and keeps every boundary copy and confirmation gate; the matrix matches the reference column order while keeping SKU, override, enabled, delivery-source and row-action controls; the nested 480 px drawer keeps its modes, guards, file validation, and focus return; regeneration preview keeps Retained/New/Will disable and its blockers.
- **C05** — CSV is a two-track paper workspace (single column on mobile) with the real template/upload controls, dropzone, notices, provisional browser preview and authoritative result/failure branches, and no horizontal overflow at 375 px.
- **C06** — Orders shows the raised tab, the refund-pending filter in the head row, the 8-column table inside the panel, the six server-filtered statistics, and both cursor pagers; empty/no-results/error/outdated states remain.
- **C07** — Order detail shows the head action set driven by real `allowedActions`, the two-track snapshot/payment/history and refund/assignment/action composition, real status and refund labels, and every notice/retry composition unchanged.
- **C08** — Staff see read-only Products, are redirected from editor/import routes, and never receive assignment or refund-decision controls; quarantine, expiry, and failure recovery behave as before; 375/719/720/1023/1024 px render with no clipped actions and no page-level horizontal overflow.

## Phase 4 evidence register (Console C01–C08)

Produce paired reference/production captures at 1440 for each row, plus 1024 and 375 production captures, per the contract’s fidelity gates.

| ID | Route(s) | Reference | States to capture |
|---|---|---|---|
| C01 | `/console/products` while signed out; same protected route with `?error=google_sign_in_failed` for existing error handling | R01 | default, expired, failure, submitting; do not invent a new login route |
| C02 | `/console/products` | R02 + R03 | populated, filtered (search + Draft/Archived), filtered-empty, loading, error, staff read-only, page 2 |
| C03 | `/console/products/new`, `/console/products/:slug` | R04 | create, ready, dirty, saving, saved, save-error, blockers, direct reload |
| C04 | editor → groups/matrix | R04 (editor variant panel) | 0/10/12/30/35 meter, warning confirmation, blocked, preview, drawer default/override/dirty-guard, mobile card + full-width drawer |
| C05 | `/console/products/import` | R05 | choice, checking, valid, warning, blocked, uploading, result, request failure, result failure |
| C06 | `/console/orders` | R06 | ready, empty, no-results, error, contract-outdated, refund-pending filter, page 2 |
| C07 | `/console/orders/:reference` | R07 | pending, paid, fulfilled, canceled, refund pending/approved/rejected, assignment, each confirming panel, unknown/conflict/outdated/read-after-write notices |
| C08 | any | R01–R07 | quarantine, expiry, staff role, 375/719/720/1023/1024 boundaries |

Collect the HTML/`support.js` hashes before capture and record measured geometry plus every allowed difference (E01–E09); a screenshot alone is not a pass.

## Risks

- Search portal must unregister at compact width and preserve draft/focus across host changes; update all shell callers explicitly rather than leave compatibility defaults.
- Backdrop loading must distinguish an empty successfully loaded catalog from not-yet-loaded data; preserve request abort/identity-generation guards and do not derive readiness from row count.
- Reordering the Variant columns and removing the redundant Price-source column must not remove the `Override` / `Product default` / `Variant override` / `Enabled` / `Disabled` text the suites assert inside each row.
- Nested `<dialog>` top-layer ordering (editor → drawer) must be verified with keyboard, Esc, and focus return on both 1440 and 375.
- Every reference control height of 28–38 px becomes 44 px under E02; do not shrink targets to win a pixel comparison.

## 2026-09-15 repair review

Sol repaired the Products action alignment, editor density and CSV composition; Astra integrated and reviewed
the changes, fixed responsive CSV notice wrapping and restored the currency-conversion warning with accessible
input associations. Independent runtime proof and green integrated builds/browser/E2E results are recorded in
`evidence/verification.md`; fresh reviewer images are in `evidence/repair-20260915/astra-review/`.
The subsequent self-audit confirmed four implementation defects, not just missing screenshots.
This phase remains `in_progress` until A01–A04 below and the original C01–C08 acceptance gates pass.

## Audit repair backlog — 2026-09-15

Source: [fresh Astra audit](./evidence/verification.md#2026-09-15--fresh-astra-self-audit-requested-by-the-user)
and [measured evidence](./evidence/audit-20260915-astra/measurements.json).
These are corrections inside Phase 2, not a new phase or a wider exception register.
One Console owner implements them; the integration owner owns verification. Reuse existing
tokens and current lifecycle/command paths. No backend, auth, migration or Storefront redesign.

 - [x] **A01 / P1 — Repair full-span editor composition (C03/C04).**
  Files: `apps/console/src/products/variant-builder.tsx`,
  `apps/console/src/products/variant-matrix.tsx` and Console surface CSS.
  Separate full-span header/body spacing from the top-card rules; remove redundant always-on
  notices; keep conditional blockers and generation/participation information compact; restore
  primary Add option group and the matrix's edge-to-edge inner table. Keep the empty third
  desktop track, existing nested drawer, mobile summaries and all generation gates.
  Before: empty groups 201 px versus reference 115 px; matrix y=891 versus 783;
  table x=121 / width=1197.984 versus x=101 / width=1237.984.
  Pass: horizontal anchors within 2 CSS px; reference header/divider/body hierarchy restored;
  every vertical delta attributed to a specific necessary control/state, never a blanket E02.
  Do not force a literal 115 px panel by shrinking 44 px controls.

 - [x] **A02 / P2 — Distinguish clean creation from persistence (C03).**
  File: `apps/console/src/products/product-editor-screen.tsx`; inspect production lifecycle
  callers before any exported interface change. Derive display state from existing create/
  persisted lifecycle, not `dirty === false` alone; add no parallel persistence flag.
  Pass: untouched `/console/products/new` does not claim saved; editing shows dirty;
  failed save keeps edits and does not claim success; successful save stays open with durable
  saved feedback; reload shows real persisted values; opening another new Product resets
  the saved claim. Keep current save enablement and Stay/Discard behavior.

 - [x] **A03 / P2 — Restore compact CSV source hierarchy (C05).**
  Files: `apps/console/src/imports/csv-import-screen.tsx` and Console surface CSS.
  Use 14/12 px dropzone text roles, consolidate duplicate file metadata into the existing
  status summary, and make the import action fill the source content track. Do not widen
  the template download action or regress the already-fixed wrapped additive notice.
  Pass: enabled Import Products fills the inner track at 1440/1024/375 (within 2 CSS px);
  filename/size/check results remain visible once; valid, invalid, warning, uploading and
  authoritative result/retry states retain their real behavior and readable notices.

 - [x] **A04 / P2 — Restore empty Payment field structure (C07).**
  File: `apps/console/src/orders/order-detail-screen.tsx`; reuse existing detail-field styles.
  Render the five-field layout for `paymentRecordState === 'none'` with honest absent values,
  not the current 99 px single-sentence card. Keep recorded and legacy-unrecorded semantics,
  real assignment controls, permission gates and command/retry paths untouched.
  Pass: a Pending Order with no payment matches the reference field ordering/grouping;
  recorded evidence still shows actual values; legacy evidence still warns against paying
  again. No synthetic payment identity or customer-visible evidence is introduced.

Execution: finish A01–A04, run the targeted runtime checks in Phase 4, then complete the
whole-plan V02–V06 gates. Historical 79/37 test results are not post-repair verification.
