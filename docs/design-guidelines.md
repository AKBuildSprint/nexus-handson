# Nexus design guidelines

## 1. Purpose and scope

This document freezes the presentation contract for the Nexus Console and Storefront as shipped. Executable token values live in [`apps/console/src/styles/design-tokens.css`](../apps/console/src/styles/design-tokens.css). The Storefront repeats a subset in [`apps/storefront/src/styles.css`](../apps/storefront/src/styles.css) and must stay aligned. Do not introduce a second type pair, color ramp, or shadow scale beside those files.

It does not approve backend endpoints, DTOs, database fields, or persistence. Domain language remains:

- A **Product** is either simple or has one active **Variant** schema.
- A Product can have 0 to 5 **option groups**, with at most 10 values per group.
- Generated combinations are normal from 0 to 10, require confirmation from 11 to 30, and are blocked at 31 or more.
- Product pricing has one currency and a decimal base price. A Variant may show a decimal price override in the same currency.
- Display stored minor-unit amounts using each currency's fraction digits: VND has 0, USD has 2. Never assume every currency uses cents.
- Product delivery has an access title, access instructions, and an optional private PDF or ZIP file up to 25 MB.
- CSV import uses one fixed template, is additive exact-match, and is limited to 1 MB and 500 data rows.

The product brand is **Nexus**. Do not restyle chrome as Faire, Atelier, or another marketplace identity.

## 2. Final visual thesis

**Design read:** a Store operator Console and Customer Storefront built as compact white paper on a cream canvas, with hairline dividers instead of elevation and one ink action per view.

**Aesthetic thesis:** cream paper canvas `#fbf8f6`; white paper panels bounded by `--color-divider` hairline borders; compact Inter interface text; Source Serif 4 reserved for form, ledger, hero and paper titles; ink-black primary actions; butter `#f1f29f` for Active/Paid/Fulfilled state only. The memorable element is the **compact bordered table with inline footer statistics**, not an elevated metric card or a title rule.

**Visual authority:** [`design/UI-UX/Nexus Console.dc.html`](../design/UI-UX/Nexus%20Console.dc.html) is the desktop target for geometry, hierarchy, typography roles, surface treatment, spacing and component arrangement. This guideline documents the reconciled token system that produces it; where this document and the reference disagree, the reference wins and this document is the defect.

### Product design dials

| Dial | Frozen value | Consequence |
| --- | ---: | --- |
| Design variance | 3/10 | Fixed 232 px rail, tab-like list headings, one bordered panel per list; Storefront uses hero + catalog-left/ledger-right. |
| Motion intensity | 2/10 | State feedback only. No page-load choreography, no hover lift on catalog cards. |
| Visual density | 7/10 | Compact tables with inline footer statistics; compact section titles; hairline-divided paper instead of stacked cards. |

### Physical scene and theme choice

The operator works on a laptop in office light. The Customer browses the catalog on a cream paper field. Light theme only. There is no dark mode and no editorial ink band.

### Design principles

1. **Show structure before detail.** Identity, status, price, and schema remain scannable before delivery fields.
2. **Keep consequential state durable.** Validation, import results, and save failures stay on the working surface.
3. **Ink is action.** Primary buttons, active nav, and the Storefront Catalog pill use `color-accent`. Butter is status only — never a CTA fill.
4. **Borders, not elevation.** Ordinary paper surfaces, tables, the deskbar and the rail use hairline `color-divider` borders. There is no decorative shadow scale on paper.
5. **Live counts only.** Metric and snapshot numbers come from loaded catalog rows, and Order statistics come from the server summary for the active filters. Invented revenue or wholesale terms are rejected.
6. **Name the next step.** Empty, warning, and error states say what is affected and what resolves it.

## 3. Token contract

Named tokens below are the frozen values. One-off hex, `rem`, or shadow literals beside them are out of contract.

### 3.1 Typography

Two families:

- **Display:** `Source Serif 4`, weight 400. Sign-in, form, ledger, hero, paper-title and private Order titles only. Not for buttons, labels, table data, or list headings.
- **Body and UI:** `Inter`, weights 400, 500 and 600. Navigation, forms, tables, status, help, data, and compact list headings.

Icons: `Material Symbols Outlined` at 24 / 400 / FILL 0. Do not mix a second icon family.

| Token | Size / line height | Use |
| --- | --- | --- |
| `type-hero-size` / `line` | 42 / 48 px | Storefront hero heading only. |
| `type-order-title-size` / `line` | 32 / 38 px | Private Order title only. |
| `type-signin-size` / `line` | 28 / 34 px | Console sign-in title only. |
| `type-ledger-size` / `line` | 22 / 28 px | CSV workspace title, Purchase ledger title. |
| `type-heading-size` / `line` | 20 px | Refund request heading, Storefront serif section headings. |
| `type-subhead-size` / `line` | 18 / 24 px | Editor panel title, paper panel titles, Product configuration, Order detail card titles. |
| `type-card-title-size` / `line` | 19 / 25 px | Storefront catalog card name. |
| `type-price-size` | 15 px | Storefront catalog card price. |
| `type-table-name-size` / `line` | 14 / 20 px | Product list row name link. |
| `type-body-size` / `line` | 16 / 24 px | **Editable controls only.** Never shrink this role. |
| `type-ui-size` / `line` | 14 / 20 px | Interface body text, buttons, notices. |
| `type-prose-size` / `line` | 14 / 21 px | Status and notice prose, Storefront ledger prose. |
| `type-data-size` / `line` | 13 / 19 px | Secondary table data, detail values, card description, kickers with sentence case. |
| `type-compact-size` / `line` | 14 / 21 px | Secondary controls and captions. |
| `type-meta-size` / `line` | 12 / 16 px | Field labels, help text, small metadata, footer statistics labels. |
| `type-table-head-size` / `line` | 11 / 16 px | Table headings, status tags, compact kickers, auth kicker. |
| `type-kicker-size` / `line` | 10 px | Uppercase kickers with `tracking-kicker` (0.14em): rail section labels, Purchase ledger kicker, private Order kicker. |

Rules:

- No more than these steps. Adding a component-specific size beside them is out of contract.
- Compact Console list headings are Inter `type-compact-size` / weight 600 in a tab frame, carrying the real `h1`. There is no large serif list title and no visually hidden duplicate label beside a decorative one.
- `font-variant-numeric: tabular-nums` for money, counts, timestamps, SKUs, references and metrics.
- `text-wrap: balance` on headings; `text-wrap: pretty` on explanatory copy.
- Negative letter tracking (`-0.02em`) belongs to serif display headings only, never to Inter labels or data.
- Field labels are persistent. Placeholders never substitute for labels.
- Do not use Barlow Condensed, Source Sans 3, or Familjen Grotesk. Those faces are retired.

### 3.2 Color

Strategy is **restrained**: cream canvas and white paper carry the field; hairline dividers do the structural work; ink fill is the primary action (≤ 10% of a view); butter marks Active/Paid/Fulfilled status only.

| Token | Frozen value | Role |
| --- | --- | --- |
| `color-canvas` | `#fbf8f6` | Page background (cream paper). |
| `color-surface` | `#ffffff` | Panels, tables, inputs, rail, deskbar, Storefront header. |
| `color-surface-muted` | `#f6f3f1` | Editor panel background, media wells, muted tags and totals boxes, hover band. |
| `color-surface-strong` | `#eae8e6` | Disabled fill. |
| `color-ink` | `#1b1c1b` | Primary text. |
| `color-ink-muted` | `#6c6a6a` | Secondary text, kickers, help, table headings, footer statistics labels. |
| `color-border` | `#8a8182` | Strong boundary: inputs, drop target, outlined tags, focus-relevant controls. |
| `color-border-strong` | `#7e7576` | Strongest divider where an input boundary must outrank paper. |
| `color-divider` | `#eae8e6` | Decorative paper divider: rail, deskbar, panel borders, table rules, secondary button boundary. |
| `color-accent` | `#000000` | Primary button, active nav, active filter tab, Storefront Catalog pill, selected option pill. |
| `color-accent-hover` | `#1b1b1b` | Hover fill. |
| `color-accent-active` | `#333333` | Pressed fill and focus ring. |
| `color-accent-soft` | `#f1f29f` | Butter status fill. |
| `color-accent-ink` | `#ffffff` | Text on ink fills. |
| `color-success-surface` | `#f1f29f` | Active / Paid / Fulfilled tag fill. |
| `color-success-ink` | `#1b1c1b` | Text on butter. |
| `color-warning-surface` | `#f1f29f` | Warning notice fill. |
| `color-warning-ink` | `#1b1c1b` | Warning text. |
| `color-error-surface` | `#ffdad6` | Error notice and Archived / Canceled tag fill. |
| `color-error-ink` | `#93000a` | Error text and destructive action ink. |
| `color-info-surface` | `#f0edeb` | Neutral information notice, private-link notice. |
| `color-info-ink` | `#4c4546` | Information text, secondary links. |
| `color-scrim` | `rgb(27 28 27 / 0.42)` | Dialog scrim. |

**Status fill mapping (reference `Nexus Console.dc.html` 793–803):**

| State | Fill | Ink |
| --- | --- | --- |
| Product Active; Order Paid; Order Fulfilled | `color-success-surface` (butter) | `color-ink` |
| Product Draft; Order Pending | `color-surface-muted` | `color-ink` |
| Product Archived; Order Canceled | `color-error-surface` | `color-error-ink` |
| CSV preview outcome Ready / Added / Retained; Variant Enabled | `color-success-surface` | `color-ink` |
| CSV preview outcome Duplicate candidate; Variant Disabled | `color-surface-muted` | `color-ink` |
| CSV preview outcome Rejected; Will disable | `color-error-surface` | `color-error-ink` |
| Refund request pending (list row outline) | `color-surface` with `color-border` frame | `color-info-ink` |
| Refund request pending (refund panel) | `color-success-surface` | `color-ink` |

Rules:

- Ink `#000000` and on-ink `#ffffff` are the intentional action pair. No butter or orange CTA fills.
- Do not revive safety-orange. Do not mix a cool gray ramp with this warm paper ramp.
- Status is never color alone. Pair every fill with its label.
- Text on a semantic surface uses the matching ink token.
- Do not weaken `color-border` to decorative contrast on inputs; that role is `color-divider`.

### 3.3 Spacing and density

| Token | Value |
| --- | ---: |
| `space-1` | 4 px |
| `space-1-5` | 6 px |
| `space-2` | 8 px |
| `space-2-5` | 10 px |
| `space-3` | 12 px |
| `space-3-5` | 14 px |
| `space-4` | 16 px |
| `space-4-5` | 18 px |
| `space-5` | 20 px |
| `space-6` | 24 px |
| `space-7` | 28 px |
| `space-8` | 32 px |
| `space-10` | 40 px |
| `space-12` | 48 px |
| `space-16` | 64 px |
| `space-24` | 96 px |

- Label to control: 6 px. Field groups: 14 px. Panel internal gap: 14 px. Sections: 28–40 px.
- One expanded scale. Source-required increments (6, 10, 14, 18, 20, 28, 40) belong to it; do not round them to 16/24/32 and call that parity, and do not add a component-specific magic number beside the scale.
- Control min-height `target-min` / `target`: 44 px.
- Desktop Console content inset 24 px, section gap 18 px. Compact canvas inset 16 px.

### 3.4 Shape, borders, depth

| Token | Value | Use |
| --- | --- | --- |
| `radius-control` | 4 px | Buttons, inputs, tags, cards, panels, drawers, tabs. |
| `radius-surface` | 4 px | Panels, notices, dialogs. |
| `radius-pill` | 40 px | Storefront search field, Storefront Catalog/My Order navigation, avatars, rail user avatar. |
| `border-hairline` | 1 px | Paper dividers, table rules, field borders, panel borders. |
| `border-emphasis` | 2 px | Drop target, selected catalog card outline, validation. |

Depth strategy is **hairline paper**: cream canvas, white paper, `color-divider` borders. Nothing in the Console or Storefront raises a decorative shadow; the Product overlay and Variant drawer detach by `color-scrim`, not by elevation. Do not add a new shadow step, and do not reintroduce `shadow-soft` or `shadow-panel` on a paper surface.

Do not combine a 1 px border with an elevation shadow on the same card. Pills are for the Storefront search and navigation, not for Console buttons, Console filters or status chips.

### 3.5 Motion

| Token | Value | Use |
| --- | --- | --- |
| `motion-press` | 100 ms | Press, checkbox. |
| `motion-state` | 180 ms | Hover, validation color. |
| `motion-panel` | 240 ms | Drawer open/close. |
| `ease-out` | `cubic-bezier(0.25, 1, 0.5, 1)` | All state transitions. |

Animate only opacity, transform, color, box-shadow. Never `transition: all`. Reduced motion collapses durations. No bounce, entrance choreography, or confetti. No hover translate on catalog cards.

### 3.6 Focus, targets, and input

| Token | Value |
| --- | --- |
| `focus-ring-width` | 2 px |
| `focus-ring-offset` | 2 px |
| `target-min` / `target` | 44 × 44 px |
| `type-body-size` | 16 px editable-control text |

`:focus-visible` uses `color-accent-active`. Validate on blur and submit. Errors use `aria-describedby` / `aria-invalid`. Failed submit focuses the error summary. Interactive hit areas never overlap adjacent controls.

### 3.7 Layout and responsive tokens

| Token | Value | Use |
| --- | ---: | --- |
| `layout-compact-max` | 719 px | Rail collapses to topbar. |
| `layout-medium-min` | 720 px | Intermediate. |
| `layout-desktop-min` | 1024 px | Full rail. |
| `layout-compact-inset` | 16 px | Compact canvas inset, Storefront compact inline inset. |
| `layout-rail-width` | 232 px (`14.5rem`) | Desktop Console rail. |
| `layout-deskbar-height` | 56 px (`3.5rem`) | Desktop deskbar. |
| `layout-topbar-height` | 64 px (`4rem`) | Compact topbar; the Storefront header is also 64 px. |
| `layout-content-inset` | 24 px | Desktop Console canvas inset. |
| `layout-section-gap` | 18 px | Desktop Console section gap. |
| `layout-search-max` | 620 px (`38.75rem`) | Deskbar search maximum width. |
| `layout-auth-measure` | 380 px | Sign-in card measure. |
| `layout-editor-measure` | 1280 px (`80rem`) | Whole Product configuration overlay maximum width. |
| `layout-editor-track-min` | 360 px (`22.5rem`) | Editor body auto-fit track minimum. |
| `layout-split-track-min` | 340 px (`21.25rem`) | CSV workspace and Order detail track minimum. |
| `layout-drawer-width` | 480 px (`30rem`) | Focused Variant drawer. |
| `layout-products-table-min` | 900 px | Products table minimum width. |
| `layout-orders-table-min` | 1040 px | Orders table minimum width. |
| `layout-meter-width` / `layout-meter-height` | 140 / 8 px | Combination meter track. |
| `meter-display-scale` | unitless `36` | Combination count mapping to a 100 % meter fill; the business limit stays 30. |
| `layout-tag-height` | 22 px (`1.375rem`) | Status and outcome tag height. |
| `layout-media-well` | 96 px | Storefront catalog card media well. |
| Storefront `layout-storefront-measure` | 1280 px (`80rem`) | Storefront content cap including inset. |
| Storefront `layout-storefront-inset` | 32 px | Storefront desktop inline inset. |
| Storefront `layout-storefront-block` | 40 px | Storefront vertical inset. |
| Storefront `layout-hero-track-min` | 280 px | Hero auto-fit track minimum. |
| Storefront `layout-workspace-track-min` | 320 px | Catalog/ledger auto-fit track minimum. |
| Storefront `layout-card-track-min` | 240 px | Card grid auto-fit track minimum. |
| Storefront `layout-card-padding` / `layout-card-gap` | 18 / 10 px | Catalog card. |
| Storefront `layout-ledger-padding` / `layout-ledger-gap` | 20 / 14 px | Purchase ledger. |
| Storefront `layout-order-measure` | 760 px | Private Order cap including inset. |
| Storefront `layout-order-padding` / `layout-order-gap` | 28 / 24 px | Private Order article. |

At 375 px: the Console rail becomes the topbar, list tables become summary cards, the Storefront workspace becomes one column, and the editor and drawer are full-width. No horizontal page scroll anywhere.

CSS `minmax()` / `fr` / percentages express technical layout, not a second scale. Named roles carry intrinsic measures such as table column widths and meter geometry.

Long names, references, descriptions, and Refund reasons wrap within their content surfaces, including catalog cards, checkout, private Orders, and Console detail. Preserve the full text; do not hide overflow or truncate data to satisfy the mobile width check, and never suppress page overflow with `overflow-x: hidden`.

## 4. Component presentation contract

### 4.1 Console shell and navigation

- Desktop rail is **232 px, white with a right `color-divider` border and no shadow**. The identity block uses 18/16 px padding with a bottom divider and a 32 px ink `N` mark, the real Store name at 13/600 and the role at 11 px. The navigation block uses 14/10 px padding with 2 px gap and a 10 px uppercase section label. The bottom block uses 14/16 px padding with a top divider, the real user avatar/name and **Sign out**.
- Destinations are **Products** and **Orders** only. Active destination: ink fill, `color-accent-ink` text, 36 px visual rhythm adapted to a 44 px target. No rail counts.
- Deskbar is **56 px, solid white, bottom `color-divider` divider, 24 px inline inset, no blur**. Leading: the hosted screen search, rectangular, 4 px radius, maximum 620 px, 44 px target, 16 px editable text, on the cream canvas. Trailing: one quiet `{storeName} · {Owner|Staff}` text.
- There is no kicker sentence, duplicate Sign out, decorative search icon-button, brand wordmark repeat, or contract-version decoration in the deskbar.
- Compact (≤ 719 px): skip link, `Nexus · {destination}`, 16 px canvas inset, Menu returns focus to its trigger. The 64 px compact topbar is a different component from the 56 px desktop deskbar.
- Do not add Inventory, Analytics, Retailers, signup, Store switching, or custom-domain controls.

Storefront chrome: a **white 64 px header in normal document flow** with 32 px inline inset, a 20 px `Source Serif 4` **Nexus** wordmark, a 10 px/0.14em uppercase **STOREFRONT** label, and quiet right-aligned pill navigation using the real Catalog route. No announcement banner, no editorial ink band, no global page footer, no backdrop blur.

### 4.2 Page headings and actions

- Console list screens use a **compact raised tab heading**: the real `h1` styled as Inter 13/600, white, top radius 4 px with the bottom edge collapsed onto the panel, 34 px tall. There is no large serif page title, no butter rule under it, and no duplicate decorative label.
- A list screen's trailing context, filters and actions sit in the same head row as that tab.
- **Statistics live in the paper table's footer row** as inline `label value` pairs at 12 px with tabular values. There is no metric card strip, no elevated metric tile, no metric corner ornament, and no four-up metric grid above a list.
- Product list primary action: **Add Product**. Secondary: **Import CSV** and **Download CSV template**.
- Product editor primary action: **Save Product**; secondary: **Discard changes**, shown only when dirty.
- CSV workspace primary action changes by state: **Choose CSV**, then **Import Products** after a valid preview and any required confirmation.
- Order detail shows only the commands permitted by the loaded Order's `allowedActions`.
- Order detail keeps one labelled field set for every payment-record state: **Source**, **Method**, **External reference**, **Recorded actor** and **Recorded time**. With no recorded payment the values are truthful absences — **No payment recorded** and em dashes — never a collapsed single sentence, and the Console-only evidence sentence stays at the end of the card.
- A view has one visually primary action. Disabled primary actions preserve the label and expose the reason.

### 4.3 Buttons and links

Primary buttons use `color-accent` fill and `color-accent-ink` text. Secondary buttons use `color-surface` with a `color-divider` border and no shadow. Do not fill primary actions with butter or orange, and do not style Console buttons as pills.

Every button supports:

- `control-default`: stable label and icon where useful.
- `control-hover`: surface or ink shift; directional icons may nudge 4 px.
- `control-focus`: visible focus ring.
- `control-active`: pressed surface and at most 1 px visual depression without changing layout.
- `control-disabled`: no action, readable label, reason available.
- `control-loading`: label changes to the ongoing verb, width remains stable, repeated activation is prevented.

Destructive or consequential actions use warning copy and explicit confirmation only when the consequence cannot be trivially undone. Regeneration confirmation is inline with the preview, not a generic modal.

### 4.4 Form fields

- Text, textarea, select, combobox, checkbox, and file controls use persistent labels.
- Native selects use the shared `.field` label/control layout so long options do not impose an intrinsic page width or bypass the control sizing tokens. Native selects and checkboxes replace any reference display-only span.
- Field labels are `type-meta-size` weight 600. Editable control text is `type-body-size` (16 px) and control height is at least 44 px.
- Help text precedes the error slot so messages do not reorder unrelated content.
- Decimal price fields use the Product currency as a visible adjacent label. Currency is not repeated as an editable Variant field.
- Status options use the domain labels **Draft**, **Active**, and **Archived**. Variant availability uses **Enabled** and **Disabled**.
- Public description is explicitly labeled public. Delivery fields are explicitly labeled private Console content.
- Autogenerated SKU suggestions are normal editable inputs, not locked chips.
- Single-choice option groups use native radio inputs with styled pill labels, not select elements.

### 4.5 Product table and compact Product list

Desktop Products columns and source widths:

1. Slug — 130 px
2. Product (flexible)
3. Status — 110 px
4. Type — 100 px
5. Effective price — 150 px, end-aligned
6. Enabled Variants — 100 px, end-aligned. The header label reads **Variants** as in the reference; the column still reports the enabled Variant count and a simple Product still shows **Not applicable**.
7. Updated — 150 px, end-aligned

- The panel is one white paper surface with a `color-divider` border, 4 px radius and `overflow: hidden`. A head row carries the real status filter tabs and the top pager; the table follows; a footer row carries inline statistics and the bottom pager.
- Header cells use 10 px vertical / 12 px horizontal padding (16 px at the outer edges), 11/600/0.06em uppercase muted. Body cells use 14 px vertical padding and `color-divider` bottom rules.
- Tables use `table-layout: fixed` with the source minimum widths (Products 900 px, Orders 1040 px) inside a local scroll region. No page-level horizontal overflow, no clipped actions and no invisible clipping of columns.
- The Product name is the row's primary link at Inter 14/500 with a 3 px underline offset; the slug is a 12 px muted cell with `overflow-wrap: anywhere`.
- Type reads **Simple** or **Variant**. A simple Product shows **Not applicable** in Enabled Variants rather than a misleading zero.
- Loading uses row-shaped skeletons with stable column widths. Request errors replace the affected data region and retain the page head and actions. Empty and filtered-empty keep the panel and its head.
- At 375 px, each summary exposes Product name, status, type, effective price, enabled Variant count where applicable, and updated time in a deliberate reading order.
- Console Products shows 25 filtered Products per page; Storefront shows 24 filtered catalog cards per page. Keep the complete catalog response for statistics and checkout selection; pagination does not change the API.
- Keep a meaningful Previous/Next control **above and below** each list, with distinct navigation labels, the visible result range, and current/total pages. Products may additionally show a static current-page chip and the real `25 / page` indicator; it must not become numbered page buttons.
- Console Orders retains server cursor pagination at 25 Orders per page. Its range uses cursor depth; statistics come from the server summary for the active filters, never the current page length.
- A cursor page emptied by reassignment is not a zero-match filter result when the server still reports matches. Keep Previous/First page recovery available, describe the empty page rather than the whole filter, and omit a total-page denominator smaller than the retained cursor depth.
- Storefront page changes preserve the selected Product, option values, Customer fields, cart, and frozen checkout retry identity. Bottom navigation returns the catalog results to view.

### 4.6 Product configuration overlay and focused Variant drawer

The whole Product editor is a **centered overlay**, not a side drawer and not a bare page:

- Native `<dialog>` opened with `showModal()` as a full-viewport transparent layout host; `::backdrop` supplies `color-scrim`; 24 px outer padding at desktop, 0 at ≤ 719 px.
- Panel: `width: 100%`, maximum `layout-editor-measure` (1280 px), maximum height 100 %, 4 px radius, `color-surface-muted` background, internal scroll.
- Sticky white header, 56 px: **Product configuration** at 18 px serif, the real status tag, the durable dirty/Saved state, and one 44 px Close control. No Save/Discard stack here.
- A 42 px context strip naming the Console surface and the real Product context. There is no Storefront preview tab.
- Body: 20 px padding, `display: grid`, `grid-template-columns: repeat(auto-fit, minmax(360px, 1fr))`, 16 px gap, `align-items: start`. At 1440 the capped panel fits **three** tracks: Basics, Pricing/Delivery, and an empty third before the full-span sections. Do not stretch the first two to 50/50.
- Full-span sections: Option groups, then the Variant matrix. They carry no outer padding of their own: a 14 px/16 px divided header sits above a body with its own 16 px inset and 10 px gap, so the desktop matrix table reaches the panel's inside edges. Only the two top cards use the uniform 20 px padding and 14 px gap.
- Sticky white footer, minimum 60 px: a concise real state/delivery summary at left, **Discard changes** when dirty, and one primary **Save Product** at right. One footer across breakpoints.
- The real route `/console/products/new` and `/console/products/:slug` renders this overlay over the real Products list as an inert backdrop. Direct navigation and reload show the same overlay and a legitimate loading/empty backdrop, never fabricated rows.

Dirty state is text, **Unsaved changes**, not a decorative dot. Save remains reachable while scrolling. A successful save persists, keeps the overlay open, and leaves a durable **Saved** notice. Navigation away while dirty opens an accessible guard naming **Stay and continue editing** and **Discard changes**; native browser-leave protection may complement it.

The focused Variant drawer remains a **separate 480 px nested dialog** for row and delivery override. It is a child of the Product overlay, traps only its own focus, and its dirty confirmation sits above it.

### 4.7 Combination meter

The meter is an **inline row**, not a card: the count reads `N of 30 combinations` at 12 px with a tabular ink value, followed by a 140 × 8 px track with a `color-surface-muted` fill, `color-divider` frame, 2 px radius, butter fill, and two 2 px ink threshold markers at 27.8 % (10) and 83.3 % (30).

- The fill is proportional to the source display scale of 36 combinations, while the business limit stays 30.
- The consequence text stays adjacent: **Select at least one option group and value to generate combinations.** at 0, **Ready to generate.** at 1–10, **Review the matrix and confirm before generating.** at 11–30, and the blocked message at 31+.
- The generate or regeneration action sits at the end of the row.

Required boundary copy:

| Count | Visual state | Required message and action |
| ---: | --- | --- |
| 0 | Neutral empty | **Select at least one option group and value to generate combinations.** Generate is disabled. |
| 1 to 9 | Normal | **Ready to generate.** Count and selected groups remain visible. |
| 10 | Normal boundary | **10 combinations. Ready to generate.** The 10 threshold is visibly reached. |
| 11 to 29 | Warning | **Review the matrix and confirm before generating.** A confirmation checkbox is required. |
| 30 | Warning maximum | **30 combinations is the maximum. Confirm to continue.** The 30 threshold is visibly reached. |
| 31 or more | Blocked | **This schema exceeds the 30-combination limit. Remove an option value or participating group.** Generate is disabled. |

The confirmation label interpolates the actual count (`I reviewed this {count}-combination matrix`); it is never a hard-coded number. Color is supplemental: normal uses ink and surface tint; warning uses warning tokens and an icon; blocked uses error tokens, an icon, and a disabled action. Group and value limits stay at 5 groups × 10 values.

### 4.8 Variant matrix and focused row editor

Desktop matrix columns, in source order:

1. Enabled — 90 px (the cell stacks the real labelled checkbox above its visible Enabled/Disabled state so the source measure holds)
2. Combination — 20 %
3. SKU — 20 %
4. Price override — 14 %
5. Effective price — 13 %
6. Delivery — 14 %
7. Row action — remainder, holding one compact single-line control whose accessible name still names the row (`Edit delivery for <combination>`)

- The option-group section above the matrix renders a one-row group card: bordered participation tag, group-name input, value chips (real 16 px inputs with 44 px targets), a dashed **Add value** affordance, and the `N of 10 values` counter. Butter marks the value chips.
- Suggested SKU is editable before save. The SKU and price-override cells are real inputs inside a bordered control frame.
- Price source reads **Base price** or **Override**; effective price shows the resolved amount including the override subline.
- Delivery source reads **Product default** or **Variant override**. Complete delivery override editing opens the focused drawer, not the matrix.
- Structural regeneration preview marks rows as **Retained**, **New**, or **Will disable**. These labels appear in text and use the status fill mapping.
- New rows show editable SKU suggestions before regeneration is confirmed.
- Obsolete rows remain readable in preview and are not silently removed.
- Per-row errors remain attached to the affected row and also appear in the editor error summary.

### 4.9 Delivery configuration and private files

Product delivery section fields:

- Access title, required
- Access instructions, required
- Optional private file

Variant drawer modes:

- **Use Product default**: inherited summary is read-only and clearly names the source.
- **Use Variant override**: access title and instructions become required, with an optional private file. It is presented as one complete replacement, not a set of independent fallback toggles.

File states:

- No file: clear optional state and **Choose PDF or ZIP** action.
- Chosen: filename, detected category pending, and size are shown before save.
- Validating: field is busy and replacement actions are disabled.
- Valid: PDF or ZIP label, filename, size, and **Replace file** / **Remove selected file** actions.
- Invalid type or mismatched content: durable field error names accepted PDF or ZIP bytes.
- Oversize: durable field error states the 25 MB limit.
- Replacement selected: copy says the new file will be used after save. The interface never claims the old private object is immediately deleted.
- Save or upload failure: current saved-file summary remains visible; the failed new selection stays recoverable where feasible.

Never show a public URL, storage key, R2 terminology, or private delivery details outside the Console editor.

### 4.10 CSV dropzone, preview, and results

- The workspace is a page, not a modal-only flow.
- The template action always names the single file: `nexus-product-import-template.csv`.
- Dropzone instructions state **CSV, UTF-8, up to 1 MB and 500 data rows**.
- The dropzone heading and helper are non-editable text at the reference 14 px and 12 px roles; the file control keeps 16 px editable text and a 44 px target. File metadata (name, size, row count and check result) stays in one summary block, and **Import Products** spans the source panel's content track once the preview is eligible.
- Drag-active state uses a 2 px accent boundary plus copy. It does not rely on color alone.
- Browser preview groups rows by Product slug and labels each group **Simple Product** or **Variant Product**. There is no type selector or field-mapping step.
- Preview shows derived combination count for Variant groups and applies the same 10, 11, 30, and 31 meter behavior as the editor.
- Every preview row has one visible outcome: **Ready**, **Duplicate candidate**, or **Rejected**. Server results later replace these provisional labels with **Added**, **Duplicate**, or **Rejected**.
- Row errors include row number or row range, Product slug, Variant SKU when present, field or group, and a specific reason.
- The confirmation control for 11 to 30 combinations is tied to the affected Product groups and must be checked before import.
- Server processing replaces the browser-preview action area with a progress state. The original preview remains readable but is clearly labeled as browser preview.
- The durable server result becomes the primary result surface. Aggregate counts and row outcomes remain visible after completion.
- File-level failure retains the selected filename and a retry or choose-another-file path. It never presents partial results as committed.

The UI explains additive exact-match behavior before import: **Import adds new exact matches. It does not update existing Products or Variants.** No CSV upsert toggle or overwrite option exists.

CSV does not import private delivery files or Variant delivery overrides. The workspace states this near the template help, without adding unsupported columns or controls.

### 4.11 Notices, errors, and success

- `notice-info`: neutral context or scope. No confirmation required.
- `notice-warning`: consequence plus required operator decision.
- `notice-error`: affected scope, reason, and recovery action.
- `notice-success`: completed action plus durable result or next step.
- `notice-dirty`: unsaved local changes.

Use inline notices for field groups, a page-level region for request or import failures, and an error summary for invalid submit. Toasts are optional reinforcement only.

### 4.12 Loading, empty, and disabled states

- Skeletons match the eventual content shape. Do not use full-page spinners.
- Empty states preserve the page title and relevant actions. Copy directs the operator to Add Product or Import CSV.
- Filtered empty is different from catalog empty and offers **Clear filters**.
- Disabled actions retain readable labels and adjacent prerequisite text.
- Loading never erases a valid saved state when an operation is occurring in a focused section.

### 4.13 Storefront surfaces

The Storefront reproduces the reference's catalog-left / Purchase-ledger-right composition. It is not a full-width product grid with checkout below it.

- Header: normal-flow white 64 px bar, 32 px inline inset, `color-divider` bottom border. 20 px serif **Nexus** wordmark, 10 px/0.14em uppercase **STOREFRONT** label, and quiet right-aligned pill navigation on the real Catalog route with the current ink fill. The real public Store name stays quiet text where it is needed for tenant identity. No banner, no editorial band, no global footer, no sticky positioning and no backdrop blur.
- Main: capped at `layout-storefront-measure` (1280 px) including inset, centered, 40 px vertical / 32 px horizontal padding, 28 px gap.
- Hero: two equal tracks (`minmax(280px, 1fr)`, 32 px gap, `align-items: end`), 24 px bottom padding and a `color-divider` bottom border. The heading is 42/48 serif. The Storefront copy states the concrete Order contract truthfully — **“Digital products, with every purchase in one private Order.”** — and the supporting paragraph ends with the private Order link being the only way back to the Order. Do not promise immediate file delivery; the paid and fulfilled states explicitly do not deliver files.
- Hero snapshot: a white bordered panel, 16 px padding, 10 px gap, with exactly two inline label/value rows carrying live counts — **Published Products** from the loaded public catalog, and **Simple / Variant** derived from those same rows. Labels are 12 px muted; values are 22 px serif with tabular numerals, right-aligned. No heading, badge, third row or hero CTA.
- Workspace: two equal tracks (`minmax(320px, 1fr)`, 28 px gap, `align-items: start`) so the catalog never spans the page. Catalog column order is search row → filters/top pager → card grid (`minmax(240px, 1fr)`, 16 px gap) → bottom pager.
- Search is a pill with a persistent visible label, 44 px target, 16 px editable text, `color-border` boundary and 14 px inline padding, with the result count at 12 px on the right. The 24-item page size and both pagers stay inside the catalog column.
- Catalog card: an `article` with 18 px padding, 10 px gap, 4 px radius and a `color-divider` border. An empty `aria-hidden` `color-surface-muted` media well, 96 px tall. Name is a semantic heading at 19/25 serif; description at 13/19 muted; price at 15 px tabular; a divided footer with the price at left and a white bordered **Select**/**Selected** button at right that carries the Product name in its accessible name and `aria-pressed`. No decorative initials, no cover treatment, no hover lift, no whole-card button.
- Purchase ledger: one white bordered panel, 20 px padding, 14 px gap. Kicker, 22/28 serif title, description, single-choice option groups as native radios with styled pill labels (4 px corners, white unselected, ink selected, 44 px targets), a quantity stepper with real −/+ buttons around the existing numeric input, Name then Email fields, a muted totals box, a full-width ink **Place Order**, and the private-link warning. The multi-line cart stays inside this ledger below the selection controls.
- Private Order: page capped at 760 px including inset with 40/32 px padding. The private-link notice comes first — safe prose only, never a capability or complete URL — followed by a white bordered article with 28 px padding and 24 px gap containing items, payment summary, status/delivery, the conditional refund section and the created-time footer. The Order title is 32/38 serif; the status tag is a non-interactive 26 px tag. No Order switcher, no example toggle, no marketing footer.
- Responsive: at ≤ 719 px the inset is 16 px and hero and workspace are one column. Between 720 and 731 px keep the single workspace column and switch to the equal split only from 732 px, so the layout does not flip. Use responsive-safe track minima so a 320 px source minimum never forces overflow. Do not assert a fixed cards-per-row at intermediate widths.

## 5. Mobbin evidence and Nexus adaptation

The canonical flows below were re-opened for this Phase 1 handoff. The observations reflect the actual screens, not only flow titles. They inform interaction patterns; Nexus does not adopt the products' branding, commerce scope, field set, or visual styling.

### Adopted patterns

| Evidence | Refreshed screen evidence | Nexus adaptation |
| --- | --- | --- |
| [Shopify: Adding variants](https://mobbin.com/flows/fac2b590-3de3-45b0-9581-c453ed412e2a) | Options precede a dense generated matrix; row-level price and SKU remain scannable; a focused Variant editor handles deeper row work. | Nexus places option groups, participating-group selection, the combination meter, and regeneration preview before the matrix. The focused editor is specifically for complete delivery overrides and row detail. Inventory and shipping fields are removed. |
| [Shopify: Adding a product](https://mobbin.com/flows/8db969f5-0dc2-4d15-a584-3fb719d63b65) | Grouped Product content and status remain separate under a persistent dark save bar. | Nexus adopts grouped sections and persistent actions, but not Shopify's dark styling. Basics, Pricing, Public description, Delivery, and Variants sit under the frozen Nexus token system. |
| [Shopify: Editing a variant](https://mobbin.com/flows/a136c90d-2af3-42ca-b5cb-e7e8875a9bed) | Variant identity, SKU, and price stay easy to scan while deeper editing moves to a focused overlay. | Nexus exposes combination, editable SKU, effective price, price source, delivery source, and enabled state. Advanced delivery fields stay out of the dense matrix. |
| [Shopify: Importing products](https://mobbin.com/flows/e71975c4-268e-4da8-873b-098e3281df92) | Import starts from the table-first Product list and uses a distinct preview and confirmation before commit. | Nexus links to a dedicated CSV workspace, shows detected Product groups and derived combination counts, then requires threshold confirmation before import. |
| [Salesforce: Importing products](https://mobbin.com/flows/c9d0c0c8-2314-4979-8567-3a9a29fe6230) | Template and upload controls stay at left while durable summary and errors occupy the right; invalid fields are named. | Nexus uses one fixed template, a durable split desktop workspace, aggregate counts, and row-level reasons. Field mapping is intentionally absent. |
| [Squarespace: Import products](https://mobbin.com/flows/33decfd4-a722-43ff-bce0-90bab6fff9a5) | The Product list is minimal; import provides compact file replacement and exact row or row-range reasons. | Nexus keeps Add Product primary, Import CSV and Download CSV template secondary, preserves compact replace-file behavior, and gives exact errors a durable page region rather than a modal-only flow. |

### Rejected patterns

| Evidence or pattern | Rejection | Nexus decision |
| --- | --- | --- |
| Shopify inventory, barcode, vendor, shipping, fulfillment, and sales-channel controls | They describe physical commerce and expand S1 beyond digital Product delivery. | Do not render these fields, columns, filters, statuses, or empty-state prompts. |
| Shopify dark save-bar branding and full visual chrome | Persistent actions are useful, but Shopify's dark chrome is not Nexus. | Retain persistence; restyle with cream paper, ink actions, and butter status. |
| Shopify analytics and sales summaries | Nexus owns no sales analytics. | Table footer statistics show live Product/Order counts only. No invented revenue. |
| Salesforce field-mapping wizard or modal | Nexus owns one exact ordered header and one unified template. Mapping would imply unsupported flexibility. | Show template help and detected fields. Reject invalid structure with precise reasons. |
| Modal-only import workspace | Preview, confirmations, and row errors need durable space and deep scanning. | Use a dedicated Console route. Dialogs are limited to focused confirmation or compact row editing. |
| Modal-only error reporting | A transient panel loses row context and is hard to revisit. | Keep aggregate and row-level errors in the workspace after processing. |
| CSV overwrite or upsert controls | The stable contract is additive exact-match only. | Explain no-update behavior. Offer no overwrite, merge strategy, or update toggle. |
| Nested cards and orange industrial chrome | They fight the hairline paper system. | White surfaces on cream, ink primary, butter status. Console filters and tabs use 4 px corners; only the Storefront search and navigation are pills, and primary buttons never are. |
| Copying Shopify, Salesforce, Squarespace, or Faire brand chrome | External mocks are layout evidence, not Nexus branding. | Use the frozen tokens in §3. Brand remains Nexus. |

## 6. Accessibility and keyboard contract

### Global

- Provide a first-focus **Skip to main content** link.
- Use landmarks for navigation, header, main content, and complementary drawer content.
- Keep a single visible page heading. Section headings form a logical hierarchy.
- Focus order follows visual order. Sticky controls do not appear earlier in focus order than their context.
- Escape closes menus and focused overlays when closing is safe. It does not discard dirty changes without confirmation.
- Closing a drawer, dialog, or menu restores focus to the triggering control.
- All pointer actions have keyboard equivalents. Drag and drop always has a standard file-input action.

### Tables and summary lists

- Desktop data tables use captions or accessible names, header cells, and row-level link labels that include the Product or combination identity.
- Editable cells expose labels including the row identity, such as **SKU for Red / Large**.
- At 375 px, summary lists preserve the same information relationships. Do not use CSS that visually reorders content away from DOM order.

### Forms and validation

- Required fields are stated in text and programmatically indicated.
- Error summary receives focus after failed submit and links to each invalid field.
- Field errors are associated with controls and remain until corrected or the related action is abandoned.
- Currency, threshold, file-size, and row-count rules are in help text before an error occurs.
- Status and mode controls expose name, current value, and available values without relying on color.

### Dynamic state

- Use a polite live region for save completion, template download completion, row-count calculation, and nonblocking preview progress.
- Use an assertive announcement only when an attempted action is blocked, such as 31 combinations or an invalid selected file.
- Announce the combination count and consequence together, for example: **31 combinations. Generation blocked. Maximum 30.**
- Do not repeatedly announce each skeleton or each parsed CSV row.
- When browser preview completes, move focus only if the operator initiated an explicit preview action. Otherwise announce completion and leave focus in place.

## 7. Explicit exclusions

Do not introduce controls, navigation, empty states, placeholders, or fake data for:

- inventory, stock, warehouses, or quantity fulfillment;
- sales analytics, revenue dashboards, or invented wholesale terms (Net-60, MOQ, boutiques);
- signup, user/team administration, role switching, or session-management settings;
- Store switching or multi-Store administration;
- custom domains or deployment configuration;
- CSV update, overwrite, upsert, merge strategy, or field mapping;
- payments or public delivery-file URLs;
- configurable option-group, value, or combination limits;
- import history dashboard or background jobs;
- Faire, Atelier, or other third-party marketplace branding.

The Storefront catalog, checkout, provisioned Console sign-in, role-aware Products, and assigned Orders are in scope. Metric cards must not invent revenue.


## 8. Phase 2 implementation gate

The prototype is ready for design review only when:

- Product list loading, catalog empty, filtered empty, populated, and request-error states are visible.
- Create and edit Product flows show default, dirty, validation, saving, save-error, and saved states.
- Product delivery and complete Variant delivery override include all named private-file states.
- Option groups, 10 values per group, participating-group selection, and one active schema are visible.
- Combination counts 10, 11, 30, and 31 are each demonstrable with their required consequence.
- Structural regeneration shows Retained, New, and Will disable rows before confirmation.
- CSV default, limit error, parsing, simple/Variant detection, warning, blocked, uploading, file-level failure, partial row result, and complete success states are visible.
- Desktop and 375 px layouts preserve all primary actions without horizontal page scroll.
- Keyboard focus, error association, focus restoration, live announcements, and 44 px targets are demonstrable.
- No excluded scope or unapproved backend contract appears in the interface.
