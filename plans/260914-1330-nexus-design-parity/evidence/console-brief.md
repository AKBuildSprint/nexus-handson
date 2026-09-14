# Console surface brief — Nexus design parity, Phase 2 (C01–C08)

You own **`apps/console/src/**`** end to end (TSX + `styles/console-layout.css`).
Do NOT edit: `apps/console/src/styles/design-tokens.css`, `docs/design-guidelines.md`,
`apps/storefront/**`, `packages/**`, `migrations/**`, `tests/**`, `design/UI-UX/**`.
A Storefront agent works concurrently under `apps/storefront/**`. Never touch it.

## Authority

1. `plans/260914-1330-nexus-design-parity/reference-parity-contract.md` — the contract. Read it in full first.
2. `plans/260914-1330-nexus-design-parity/phase-02-console-surfaces.md` — your phase spec. Read it in full second.
3. `design/UI-UX/Nexus Console.dc.html` — the desktop visual target. It is a static HTML prototype; read the markup for exact composition (R01 sign-in 24–64, R02 shell 240–285, R03 Products 287–360, R04 editor 618–744, R05 CSV 362–428, R06 Orders 430–517, R07 detail 519–611). Do not edit it.
4. `plans/260914-1330-nexus-design-parity/evidence/geometry.json` — measured reference geometry at 1440. Match it within 2 CSS px outside the E01–E09 exception register.
5. `docs/design-guidelines.md` — the reconciled token system (already updated for this parity work). Follow it; do not re-litigate it.

Exceptions E01–E09 in the contract are the ONLY permitted differences. Accessibility
(E02: 44 px targets, 16 px editable text), responsive safety (E04), real behavior
(E05/E06), truthful copy (E08) and privacy (E09) always win over literal copying.

## Landed token contract (do not change it; consume it)

`apps/console/src/styles/design-tokens.css` now defines, among others:

- Geometry: `--layout-rail-width: 14.5rem` (232), `--layout-deskbar-height: 3.5rem` (56),
  `--layout-topbar-height: 4rem` (64 compact + Storefront), `--layout-content-inset: 1.5rem` (24),
  `--layout-section-gap: 1.125rem` (18), `--layout-compact-inset: 1rem`,
  `--layout-auth-measure: 23.75rem` (380), `--layout-auth-padding: 1.75rem` (28),
  `--layout-editor-measure: 80rem` (1280), `--layout-editor-track-min: 22.5rem` (360),
  `--layout-split-track-min: 21.25rem` (340), `--layout-drawer-width: 30rem` (480),
  `--layout-products-table-min: 56.25rem` (900), `--layout-orders-table-min: 65rem` (1040),
  `--layout-meter-width: 8.75rem` (140), `--layout-meter-height: 0.5rem` (8),
  `--layout-meter-display-scale: 2.25rem` (36 combinations = 100 % fill), `--layout-media-well: 6rem`.
- Type roles: `--type-ui-size/-line` 14/20, `--type-prose-size/-line` 14/21, `--type-data-size/-line` 13/19,
  `--type-kicker-size/-line` 10px + `--tracking-kicker` 0.14em, `--type-table-head-size/-line` 11/16 +
  `--tracking-table-head` 0.06em, `--type-table-name-size/-line` 14/20, `--type-subhead-size/-line` 18/24,
  `--type-heading-size/-line` 20, `--type-ledger-size/-line` 22/28, `--type-signin-size/-line` 28/34,
  `--type-order-title-size/-line` 32/38, `--type-card-title-size/-line` 19/25, `--type-price-size` 15,
  `--type-body-size/-line` 16/24 (editable controls — NEVER shrink), `--type-compact-size/-line` 14/21,
  `--type-meta-size/-line` 12/16, `--type-section-size/-line` 22/28.
- Weights: `--weight-regular/medium/semibold/bold` = 400/500/600/600.
- Colors: `--color-divider: #eae8e6` is new (decorative paper divider). `--color-border` stays `#8a8182` for inputs.
- Spacing: `--space-1-5` 6, `--space-2-5` 10, `--space-3-5` 14, `--space-4-5` 18, `--space-5` 20, `--space-7` 28, `--space-10` 40.
- `--shadow-soft` / `--shadow-panel` are retired: no paper surface may use them. Remove their remaining usages in `console-layout.css` (rail ~line 283, metric card ~432, inspection panel ~565, ~669, ~1835) — delete the declaration or replace with a `--color-divider` border.
- `body` is now `font-size: var(--type-ui-size)` (14/20). Editable controls must explicitly set `--type-body-size` (16 px).

Primitives ALREADY updated in `console-layout.css` (keep their intent, extend only where a screen needs more):
`.button` / `.button-primary` / `.button-danger` / `.button:disabled`, `.field*`, `#product-search`/`#order-search`
(now rectangular 4 px, max 620 px, 44 px, 16 px text), `.notice*`, `.status-tag`/`.outcome-tag` (22 px, 4 px radius,
11/600) with the reference status fill map, `.status-tabs`, `.data-region` (bordered, no shadow, `overflow: hidden`),
`.console-panel-head` (12/16 px, divider bottom), `.console-table-scroll`, `.console-table` (11/600/0.06em head on
canvas tint, 13/19 body, divider rules), `.product-link` (14/500 ink), and the `.console-auth-*` block.

## Locked status fills (apply exactly)

| State | Fill | Ink |
|---|---|---|
| Product Active | butter | ink |
| Order Paid, Order Fulfilled | butter | ink |
| Order Pending, Product Draft | `--color-surface-muted` | ink |
| Product Archived, Order Canceled | `--color-error-surface` | `--color-error-ink` |
| CSV Ready/Added/Retained, Variant Enabled | butter | ink |
| CSV Duplicate candidate, Variant Disabled | `--color-surface-muted` | ink |
| CSV Rejected, Will disable | error pair | error ink |
| `Refund pending` outline tag in a list row | white + `--color-border` frame | `--color-info-ink` |
| Refund request panel Pending tag | butter | ink |

## Required outcomes per surface

- **C01 sign-in** (`sign-in-screen.tsx`): reference R01. 380 px card, 28 px padding, 18 px gap, white, 1 px divider,
  4 px radius, no shadow; 36 px ink `N` mark; kicker `Nexus · Operations Console`; real `h1` **Sign in** 28/34 serif
  `-0.02em`; real lede paragraph; expired notice on the info surface with `role="status"`; a real failure on the error
  pair with `role="alert"`; 44 px Google button with the real labels **Continue with Google** / **Connecting to Google…**;
  the accurate access-help block (Google authenticates; active Store membership authorizes; Owners manage the Store;
  Staff see Products read-only and work only assigned Orders). Delete the demo cycle-preview link. Delete the now-unused
  `.console-auth-form` rule. Use the new `.console-auth-*` classes already in `console-layout.css`.
- **C02 shell + Products list** (`layout/console-shell.tsx`, `production-console-app.tsx`, `products/product-list-screen.tsx`):
  232 px white rail with right divider, identity block 18/16 px + bottom divider, nav 14/10 px gap 2 px with a 10 px
  uppercase section label, bottom block 14/16 px + top divider with the real user and Sign out. Deskbar 56 px white,
  24 px inline inset, hosted real search (rectangular, max 620 px) at the leading edge, one quiet `{storeName} · {role}`
  at the trailing edge — no kicker, no duplicate Sign out, no decorative search icon-button, no blur, no "Contract v2".
  **Search hosting (do it exactly as phase-02 C02 describes):** add a narrowly scoped desktop search host to `ConsoleShell`
  exposed via a local slot/context; `ProductListScreen`/`OrdersScreen` render exactly one real search form and portal it
  into the host only when the host exists AND the viewport is ≥ 720 px; otherwise render it inline at the top of the
  compact screen. The host registration must clear on compact layout and unmount. Preserve drafts, committed criteria,
  cursor/page resets, and focus/caret across 719↔720 resizes with no accidental submit or reset. Run LSP references
  before changing exported shell props and migrate BOTH `ProductionConsoleApp` and the development `ConsoleApp` plus
  meaningful test renders — no optional compatibility props to dodge caller migration.
  Products head: raised tab `h1` **Products** (Inter 13/600, white, top radius 4, 34 px, bottom edge collapsed onto the
  panel) + trailing real actions `Download CSV template` / `Import CSV` / `Add Product`.
  **Delete** `.metric-strip`, `.metric-card`, `.metric-card-accent::after`, `.metric-value`, `.metric-meta`, the serif
  40/48 title, `.page-kicker::after` and the owner description paragraph, but KEEP the `catalogCounts` computation and
  render it as the footer statistics row.
  Panel: bordered white, radius 4, `overflow: hidden`; head row = real status tabs + top pager; 7 columns with source
  widths slug 130 / name flexible / status 110 / type 100 / price 150 / variants 100 / updated 150, `table-layout: fixed`,
  `min-width: 900px`, wrapped in a scroll region; add the real `product.slug` cell; header on canvas tint, 10/12 px padding
  (16 px at outer edges); body 14 px vertical; `aria-label="Products in this Store"`.
  Footer row (`.console-table-footer`): inline `Products / Active / Simple / Variant` label+strong pairs at 12 px with
  tabular values from `catalogCounts`, spacer, bottom pager. Keep both real pagers, their `aria-label`s, range strings and
  disabled logic; add a static current-page chip and the real `25 / page` indicator — never numbered page buttons.
  Keep the mobile summary cards and every loading/error/empty/filtered-empty/template-error composition inside the panel.
- **C03 Product configuration overlay** (`production-console-app.tsx`, `products/product-editor-screen.tsx`): reference R04.
  Keep `/console/products/new` and `/console/products/:slug`, `parseRoute`, `routePath`, `pushState`/`popstate` and the
  post-create `replaceState`. Render the real Products list as an `inert` `aria-hidden` backdrop plus a native `<dialog>`
  opened with `showModal()` as a full-viewport transparent layout host (reset UA margin/border/max-size; viewport
  width/height; `box-sizing: border-box`; 24 px padding; centered panel; `::backdrop` = `--color-scrim`; 0 padding and
  full-width/full-height at ≤719 px). Render the dialog OUTSIDE any manually inert shell ancestor and intercept `cancel`.
  Panel: 1280 px max width, max-height 100 %, `overflow: auto`, radius 4, `--color-surface-muted`. Sticky white header 56 px
  with serif 18 px **Product configuration**, real status tag, durable dirty/saved state and one 44 px Close — no Save/Discard
  stack. 42 px context strip with the Console label, the real Product context and compact Back navigation; **omit** the dead
  Storefront preview tab (E07). Body: 20 px padding, grid `repeat(auto-fit, minmax(360px, 1fr))`, 16 px gap,
  `align-items: start`; white panels with 1 px divider, radius 4, 20 px padding, 14 px gap. Track 1 Basics (persisted
  slug/status pair shown as display-only metadata — `ProductEditorFixture` has no slug field; new Product says
  "Assigned after save"), Track 2 Pricing + Delivery (base price/currency pair, currency helper, divider, private delivery
  title/instructions, real `DeliveryEditor` file summary and `Choose PDF or ZIP`), then full-span (`grid-column: 1 / -1`)
  Option groups and Variant matrix. **Delete** `.editor-form { max-width: 60rem }` and the stacked `.editor-section` layout.
  Sticky footer min 60 px: real state/delivery summary at left, **Discard changes** when dirty, ONE primary **Save Product**
  at right. One footer at all breakpoints; migrate every helper that selects `button.desktop-save` / `.mobile-save-bar`.
  Keep field labels, ids, `htmlFor` and error ids (`#delivery-access-title-error`, `#delivery-access-title`) intact.
  Save persists, updates `revision`, sets `detailLifecycle: 'saved'`, keeps the overlay open and shows the durable
  `Product saved` notice (`role="status"`) — never the prototype's close-on-save. Replace the synchronous `window.confirm`
  dirty guard with the app-local accessible guard pattern used by the development/Variant flows, offering **Stay and
  continue editing** / **Discard changes** above the owning dialog, queueing the intended target exactly once, restoring
  focus on Stay, and never clearing dirty/files/schema state until Discard commits. Intercept Escape and Back before
  destructive clearing; prevent repeated intents while a guard is open. Keep the backdrop-loading contract: track
  loaded/loading/error explicitly, never infer readiness from `listItems.length`, keep abort/identity-generation guards,
  and never fabricate rows.
- **C04 Variant builder** (`products/variant-builder.tsx`, `variant-matrix.tsx`, `schema-change-preview.tsx`, `delivery-editor.tsx`):
  inline meter row (`N of 30 combinations` at 12 px with a tabular ink value, then a 140×8 px track: muted fill, divider
  frame, 2 px radius, butter fill, two 2 px ink markers at 27.8 % and 83.3 %, fill proportional to the source display scale
  36 while the business limit stays 30) with every boundary message and the generate action in the same row; confirmation
  label interpolates the real count (`I reviewed this {count}-combination matrix`), never a hard-coded 12. Option-group
  cards become one-row cards: 4 px-radius outlined participation tag, real group-name input, value chips (real 16 px inputs
  with 44 px targets and butter emphasis), dashed `Add value`, `N of 10 values` counter, `N of 5 option groups` counter,
  every error id and `aria-invalid`, the `One active Variant schema` notice, and the reference empty-state sentence for a
  simple Product. Matrix desktop order: Enabled 90 px / Combination 20 % / SKU 20 % / Price override 14 % / Effective price
  13 % / Delivery 14 % / Row action remainder — keep every real checkbox/input/edit action, row errors, the effective-price
  subline, `Product default` / `Variant override` / `Enabled` / `Disabled` text, and the mobile summary edit path. Keep the
  480 px nested `<dialog>` drawer (combination + Close header, SKU/override/Enabled/delivery-source radios/Product-default
  summary or Variant `DeliveryEditor`, footer with state text + Cancel + **Apply Variant changes**), `::backdrop` scrim,
  white radius-4 panel, sticky header/footer, full width at ≤719 px, all guard copy, required-field errors and focus return
  to the row's `Edit delivery for …` trigger; nested stack order and the parent dirty guard must hold. Keep
  `schema-change-preview.tsx` labels **Retained** / **New** / **Will disable**, the duplicate/conflicting SKU blockers and
  **Regenerate matrix**, restyled as a paper panel with a summary count row. Do NOT change the 5 groups × 10 values limits,
  page sizes, or the 10/11/30/31 thresholds.
- **C05 CSV** (`imports/csv-import-screen.tsx`, `imports/csv-preview-table.tsx`): head row = `Back to Products` +
  serif 22/28 **Import Products from CSV** + real `Start another import` when a durable result/failure exists + quiet
  trailing "One fixed template · no field mapping"; keep the additive exact-match notice; workspace grid
  `repeat(auto-fit, minmax(340px, 1fr))`, 16 px gap, `align-items: start` (delete the `2fr / 3fr` split), remove
  `.csv-source` sticky positioning, force one track at ≤719 px. Left panel 20 px padding / 14 px gap with the real
  template download, byte-checked dropzone, 2 px dashed `--color-border`, real `Choose CSV`/`Replace CSV`, file-check
  notice, selected-file summary, catalog-identity loading/error notices, warning confirmation, ≥31 blocker and the real
  `Import Products` primary with all its labels. Right panel keeps `<details open>` and the real provisional vs
  authoritative counts plus the real result/failure branches (`notice-success`/`notice-error`, `#import-result-title`,
  `#import-result-error-title`, `#import-failure-title`, their focus moves). Footer row keeps the real Ready /
  Duplicate candidate / Rejected and Added / Duplicate / Rejected counts.
- **C06 Orders list** (`orders/orders-screen.tsx`): raised tab `h1` text exactly **Orders** + the real
  `Pending refund requests` checkbox in the same head row + real deskbar search (C02 hosting). Panel as C02 with the real
  5 status tabs `All | Pending | Paid | Fulfilled | Canceled`, top pager, 8 columns Order 96 / Customer 150 / Email 170 /
  Items flexible / Total 100 / Payment ref 110 / Status 130 / Created 120, `min-width: 1040px`, 12 px body padding,
  status tag + `Refund request pending` tag, `aria-label="Storefront Orders"`, no unit prices. Footer row = the SIX real
  `orderSummary` statistics (`Matching Orders`, `Pending`, `Paid`, `Fulfilled`, `Canceled`, `Open refund requests`) as
  inline label/value pairs + bottom pager. Delete the separate `.order-matching-summary` markup (keep `summary.totalOrders`)
  and keep `Clear filters` / `First page` recovery and every state.
- **C07 Order detail** (`orders/order-detail-screen.tsx`): reference R07. Change NOTHING in the command layer
  (`loadOrder`, `refetchAfterWrite`, `confirmAction`, `assignOrderToStaff`, `decideRefund`, frozen attempt identities,
  15 s deadline, single command lock, `pending-role-command` recovery, `BroadcastChannel`, every notice kind). Header:
  Back to Orders + divider + real reference `h1` 18/600 tabular + status/refund tags + spacer + source-positioned permitted
  quick actions (never a command absent from `order.allowedActions`). Two 340 px-minimum tracks / 16 px gap, white panels
  20 px padding 14 px gap; left = Order snapshot, immutable item snapshots, Payment (none/recorded/legacy-unrecorded),
  History; right = refund request summary first when present (18 px title, butter Pending tag), manual-payment action
  region next, then a compact Assignment extension when `canAssign`, then any other confirming form in the same action
  region. Each command lives in exactly ONE interactive host. Keep every permission gate and the exact `detailIntro` copy.
- **C08 roles/auth/mobile**: keep the `sessionRevalidating` quarantine (`Checking Console session…` + `hidden`/`inert`
  wrapper), expiry/dismissal behavior, Staff read-only Products with redirects away from editor/import routes and no
  assignment/refund-decision controls, and `401` / `store_access_denied` session termination. At ≤719 px: compact
  shell/menu, 16 px inset, summary cards, single-column editor/CSV/detail, full-width dialogs, the SAME reachable sticky
  editor footer, and search rendered inline rather than portaled into a hidden deskbar. Verify 375/719/720/1023/1024
  have no page-level horizontal overflow, no clipped actions, and no `overflow-x: hidden` suppression.

## Hard rules

- No API, DTO, schema, migration, auth, permission or domain-transition change. No new feature, route, control or
  placeholder. No mock/DCLogic/fixture data.
- No second token ramp and no per-surface literal for a reference value. If a role is genuinely missing, message the
  integration owner (`Main`) through `hub` instead of inventing a token.
- Every interactive target ≥ 44×44 px with no overlapping hit areas; every editable control ≥ 16 px text.
- Primary actions keep `color-accent` fill + `color-accent-ink` text.
- Preserve accessible names, landmarks, field ids/labels/error associations, keyboard semantics, live regions and
  focus restoration. A first-`form` query, `.metric-card`, duplicate `.desktop-save`/`.mobile-save-bar`, native
  `window.confirm`, exact incidental prose or old column positions are NOT contracts.
- Do NOT edit tests. Instead, produce an exact list of the test files/lines/cases your change invalidates and what the
  new accessible surface is, for the Phase 4 owner to migrate.

## Definition of done

1. `npm run typecheck` clean.
2. `npm run build:console` clean (it includes typecheck and the production import-graph assertion).
3. No remaining use of `--shadow-soft` / `--shadow-panel`; no remaining `.metric-card`/`.metric-strip`/`.page-kicker::after`
   markup or rules; no `window.confirm` in the editor dirty path; no `overflow-x: hidden`.
4. A written handoff listing: files changed, every reference anchor you matched with its measured/expected value,
   any E-ID you applied and why, every test/helper you invalidated (file + line + new surface), and anything you could
   not achieve. Be explicit about what you did NOT verify in a browser.
