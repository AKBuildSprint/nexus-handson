# Nexus design guidelines

## 1. Purpose and scope

This document freezes the presentation contract for the Nexus Console and Storefront as shipped. Executable token values live in [`src/console/styles/design-tokens.css`](../src/console/styles/design-tokens.css). The Storefront repeats a subset in [`storefront/src/styles.css`](../storefront/src/styles.css) and must stay aligned. Do not introduce a second type pair, color ramp, or shadow scale beside those files.

It does not approve backend endpoints, DTOs, database fields, or persistence. Domain language remains:

- A **Product** is either simple or has one active **Variant** schema.
- A Product can have 0 to 5 **option groups**, with at most 10 values per group.
- Generated combinations are normal from 0 to 10, require confirmation from 11 to 30, and are blocked at 31 or more.
- Product pricing has one currency and a decimal base price. A Variant may show a decimal price override in the same currency.
- Product delivery has an access title, access instructions, and an optional private PDF or ZIP file up to 25 MB.
- CSV import uses one fixed template, is additive exact-match, and is limited to 1 MB and 500 data rows.

The product brand is **Nexus**. Do not restyle chrome as Faire, Atelier, or another marketplace identity.

## 2. Final visual thesis

**Design read:** a Store operator Console and Customer Storefront, using an editorial cream-paper language with ink actions and a butter highlight for state.

**Aesthetic thesis:** warm paper canvas, white elevated surfaces, Source Serif 4 page titles, Inter UI, ink-black primary actions, butter `#f1f29f` for status and title rules. The memorable element is the **butter rule under the page title** plus ink-filled primary controls on cream paper.

Form came from the shipped Console/Storefront chrome, not from a second industrial-orange system.

### Product design dials

| Dial | Frozen value | Consequence |
| --- | ---: | --- |
| Design variance | 4/10 | Stable left rail, split Storefront hero, metric strip from live counts only. |
| Motion intensity | 2/10 | State feedback only. No page-load choreography. |
| Visual density | 5/10 | Table-first Console with white cards; Storefront uses a 4-column Product grid. |

### Physical scene and theme choice

The operator works on a laptop in office light. The Customer browses the catalog on a cream paper field. Light theme only. Dark mode is out of scope except the Storefront editorial band, which is a single deliberate ink panel.

### Design principles

1. **Show structure before detail.** Identity, status, price, and schema remain scannable before delivery fields.
2. **Keep consequential state durable.** Validation, import results, and save failures stay on the working surface.
3. **Ink is action.** Primary buttons, active nav, and Storefront Catalog pill use `color-accent`. Butter is status and emphasis, not the primary CTA fill.
4. **Elevate paper, do not stack chrome.** White surfaces sit on cream canvas with one shadow scale. Do not mix hairline + wide shadow + extra tint on the same card.
5. **Live counts only.** Metric cards and Storefront snapshot numbers come from loaded Products and Orders. Invented revenue or wholesale terms are rejected.
6. **Name the next step.** Empty, warning, and error states say what is affected and what resolves it.

## 3. Token contract

Named tokens below are the frozen values. One-off hex, `rem`, or shadow literals beside them are out of contract.

### 3.1 Typography

Two families:

- **Display:** `Source Serif 4`, weight 400 (600 allowed for Storefront section emphasis). Page titles, Storefront hero, metric values, Product names on the Storefront grid. Not for buttons, labels, or table data.
- **Body and UI:** `Inter`, weights 400 and 600. Navigation, forms, tables, status, help, data.

Icons: `Material Symbols Outlined` at 24 / 400 / FILL 0. Do not mix a second icon family.

| Token | Size / line height | Use |
| --- | --- | --- |
| `type-display` | `clamp(2.25rem, 5vw, 3.25rem)` / ~1.15 | Storefront hero only. |
| `type-page` | 40 / 48 px (`2.5rem` / `3rem`) | Console page title. Storefront section title may use `1.875rem`. |
| `type-section` | 22 / 32 px | Console brand, metric value, Storefront Product name. |
| `type-subhead` | 18 / 26 px | Compact topbar title, grouped subsection. |
| `type-body` | 16 / 24 px | Forms, prose, primary table content. Inputs stay ≥ 16 px. |
| `type-compact` | 14 / 21 px | Secondary table content, captions, nav items. |
| `type-meta` | 12 / 16 px, tracking `0.08em` | Kickers, field hints, metric labels. Uppercase only for short labels. |

Rules:

- No more than these steps.
- `font-variant-numeric: tabular-nums` for money, counts, timestamps, SKUs.
- `text-wrap: balance` on headings; `text-wrap: pretty` on explanatory copy.
- Field labels are persistent. Placeholders never substitute for labels.
- Do not use Barlow Condensed, Source Sans 3, or Familjen Grotesk. Those faces are retired.

### 3.2 Color

Strategy is **restrained**: cream paper and white surfaces carry the field; ink fill is the primary action (≤ 10% of a view); butter marks status, title rules, and selected tags.

| Token | Frozen value | Role |
| --- | --- | --- |
| `color-canvas` | `#fbf8f6` | Page background (cream paper). |
| `color-surface` | `#ffffff` | Cards, tables, inputs, rail pills. |
| `color-surface-muted` | `#f6f3f1` | Rail, selected row, Storefront media well (`--color-band` on Storefront). |
| `color-surface-strong` | `#eae8e6` | Hover band, disabled fill (`--color-band-strong` on Storefront). |
| `color-ink` | `#1b1c1b` | Primary text. |
| `color-ink-muted` | `#6c6a6a` | Secondary text, kickers, help. |
| `color-border` | `#8a8182` | Default hairline (3:1 on cream). |
| `color-border-strong` | `#7e7576` | Strong divider. |
| `color-accent` | `#000000` | Primary button, active nav, Catalog pill. |
| `color-accent-hover` | `#1b1b1b` | Hover fill; Storefront editorial band. |
| `color-accent-active` | `#333333` | Pressed fill and focus ring. |
| `color-accent-soft` | `#f1f29f` | Butter: Active tags, title rule, metric corner, selected status. |
| `color-accent-ink` | `#ffffff` | Text on ink fills. |
| `color-success-surface` | `#f1f29f` | Durable success / Active tag. |
| `color-success-ink` | `#1b1c1b` | Text on butter. |
| `color-warning-surface` | `#f1f29f` | Warning and Draft tag. |
| `color-warning-ink` | `#1b1c1b` | Warning text. |
| `color-error-surface` | `#ffdad6` | Error notice. |
| `color-error-ink` | `#93000a` | Error text. |
| `color-info-surface` | `#f0edeb` | Neutral information. |
| `color-info-ink` | `#4c4546` | Information text, inactive nav. |
| `color-scrim` | `rgb(27 28 27 / 0.42)` | Drawer or dialog scrim. |

Rules:

- Ink `#000000` and on-ink `#ffffff` are intentional action pair, not a license for extra raw black/white decoration.
- Do not revive safety-orange. Do not mix a cool gray ramp with this warm paper ramp.
- Status is never color alone. Pair butter/error with a label.
- Text on a semantic surface uses the matching ink token.

### 3.3 Spacing and density

| Token | Value |
| --- | ---: |
| `space-1` | 4 px |
| `space-2` | 8 px |
| `space-3` | 12 px |
| `space-4` | 16 px |
| `space-6` | 24 px |
| `space-8` | 32 px |
| `space-12` | 48 px |
| `space-16` | 64 px |
| `space-24` | 96 px |

- Label to control: 4–8 px. Field groups: 12–16 px. Sections: 32–48 px.
- Control min-height `target-min` / `target`: 44 px.
- Desktop Console padding 32 px below the 64 px deskbar. Compact canvas padding 16 px.

### 3.4 Shape, borders, depth

| Token | Value | Use |
| --- | --- | --- |
| `radius-control` | 4 px | Buttons, inputs, cards, metric tiles, drawers. |
| `radius-surface` | 4 px | Same radius system. Do not use 8 px cards. |
| `radius-pill` | 40 px | Search fields, status/filter pills, avatars, role chip. |
| `border-hairline` | 1 px | Table rows, field borders. |
| `border-emphasis` | 2 px | Drop target, selected catalog card outline, validation. |
| `shadow-soft` | `0 1px 8px rgb(0 0 0 / 0.04)` | Cards, pills, secondary buttons. |
| `shadow-panel` | `0 4px 16px rgb(0 0 0 / 0.06)` | Data region, inspection panel, Storefront ledger. |

Depth strategy is **paper elevation**: cream canvas, white surface, one shadow token per layer. Do not combine a 1 px border with `shadow-panel` on the same card. Pills are for search and filters, not for primary buttons.

### 3.5 Motion

| Token | Value | Use |
| --- | --- | --- |
| `motion-press` | 100 ms | Press, checkbox. |
| `motion-state` | 180 ms | Hover, validation color. |
| `motion-panel` | 240 ms | Drawer open/close. |
| `ease-out` | `cubic-bezier(0.25, 1, 0.5, 1)` | All state transitions. |

Animate only opacity, transform, color, box-shadow. Never `transition: all`. Reduced motion collapses durations. No bounce, entrance choreography, or confetti.

### 3.6 Focus, targets, and input

| Token | Value |
| --- | --- |
| `focus-ring-width` | 2 px |
| `focus-ring-offset` | 2 px |
| `target-min` | 44 × 44 px |
| `input-min-mobile` | 16 px text |

`:focus-visible` uses `color-accent-active`. Validate on blur and submit. Errors use `aria-describedby` / `aria-invalid`. Failed submit focuses the error summary.

### 3.7 Layout and responsive tokens

| Token | Value | Use |
| --- | ---: | --- |
| `layout-compact-max` | 719 px | Rail collapses to topbar. |
| `layout-medium-min` | 720 px | Intermediate. |
| `layout-desktop-min` | 1024 px | Full rail. |
| `layout-rail-width` | 256 px (`16rem`) | Desktop Console rail. |
| `layout-topbar-height` | 64 px (`4rem`) | Desktop deskbar and compact topbar. |
| `layout-editor-measure` | 960 px | Editor form cap. |
| `layout-drawer-width` | 480 px | Focused editor. |
| Storefront `--measure` | 1280 px (`80rem`) | Catalog max width. |

At 375 px: rail becomes the topbar; tables become summary cards; Storefront grid becomes one column; no horizontal page scroll.

## 4. Component presentation contract

### 4.1 Console shell and navigation

- Desktop rail: **Nexus** / Operations Console, optional "Viewing as Store operator" chip (not a role switcher), destinations **Products** and **Orders** only.
- Active destination: ink fill, `color-accent-ink` text. Hover uses `color-surface-strong`.
- Account chip uses the bootstrap Store name **Nexus**. No Faire, North Studio, or fake tenant switcher.
- Deskbar kicker: `Nexus Operations Console · {Products\|Orders}`.
- Compact: skip link, `Nexus · {destination}`, Menu returns focus to its trigger.
- Do not add Inventory, Analytics, Retailers, login, or custom-domain controls.

Storefront chrome: **Nexus** / STOREFRONT, Catalog pill, cream canvas. Hero snapshot and metric numbers are live catalog counts.

### 4.2 Page header and actions

- Product list primary action: **Add Product**.
- Product list secondary actions: **Import CSV** and **Download CSV template**.
- Product editor primary action: **Save Product**.
- Product editor secondary navigation: **Back to Products**. **Discard changes** appears only after the form becomes dirty.
- CSV workspace primary action changes by state: **Choose CSV**, then **Import Products** after a valid preview and any required confirmation.
- A view has one visually primary action. Disabled primary actions preserve the label and expose the reason.
- Console list pages may show a four-up metric strip. Values must be computed from loaded rows.

### 4.3 Buttons and links

Primary buttons use `color-accent` fill and `color-accent-ink` text. Secondary buttons use `color-surface` plus `shadow-soft`. Do not fill primary actions with butter or orange.

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
- Help text precedes the error slot so messages do not reorder unrelated content.
- Decimal price fields use the Product currency as a visible adjacent label. Currency is not repeated as an editable Variant field.
- Status options use the domain labels **Draft**, **Active**, and **Archived**. Variant availability uses **Enabled** and **Disabled**.
- Public description is explicitly labeled public. Delivery fields are explicitly labeled private Console content.
- Autogenerated SKU suggestions are normal editable inputs, not locked chips.

### 4.5 Product table and compact Product list

Desktop columns are:

1. Product
2. Status
3. Type
4. Effective price range
5. Enabled Variants
6. Updated time

- The Product name is the row's primary link.
- Type reads **Simple** or **Variant**.
- A simple Product shows **Not applicable** in Enabled Variants rather than a misleading zero.
- Sorting indicators, if present in Phase 2, must expose the current order to assistive technology. Sorting itself is not required by this design contract.
- Loading uses row-shaped skeletons with stable column widths.
- Request errors replace the affected data region and retain the page header and actions.
- At 375 px, each summary exposes Product name, status, type, effective price, enabled Variant count where applicable, and updated time in a deliberate reading order.
- Console Products shows 25 filtered Products per page; Storefront shows 24 filtered catalog cards per page. Keep the complete catalog response for metrics and checkout selection; pagination does not change the API.
- Place Previous/Next controls above and below each list, with distinct navigation labels, the visible result range, and current/total pages. Disable controls at boundaries; reset to the first page when search or filters change and clamp after catalog shrink.
- Console Orders retains server cursor pagination at 25 Orders per page. Its range uses cursor depth; totals come from the server summary for the active filters, never the current page length.
- Storefront page changes preserve the selected Product, option values, Customer fields, cart, and frozen checkout retry identity. Bottom navigation returns the catalog results to view.

### 4.6 Sticky editor action bar

- Shows Back, Product title or **New Product**, current status, dirty indicator, Discard, and Save.
- Dirty state is text, **Unsaved changes**, not a decorative dot.
- Save remains reachable while scrolling.
- A successful save changes the durable state to **Saved** and keeps the operator in context. A transient toast may reinforce the result but cannot be the only evidence.
- Navigation away while dirty opens an accessible confirmation that names **Stay and continue editing** and **Discard changes**. Native browser-leave protection may complement it.

### 4.7 Combination meter

The meter contains:

- A prominent tabular count and the label **combinations**.
- A segmented horizontal track with visible thresholds at 10 and 30.
- Text stating the current consequence.
- The adjacent generate or regeneration action.

Required boundary copy:

| Count | Visual state | Required message and action |
| ---: | --- | --- |
| 0 | Neutral empty | **Select at least one option group and value to generate combinations.** Generate is disabled. |
| 1 to 9 | Normal | **Ready to generate.** Count and selected groups remain visible. |
| 10 | Normal boundary | **10 combinations. Ready to generate.** The 10 threshold is visibly reached. |
| 11 to 29 | Warning | **Review the matrix and confirm before generating.** A confirmation checkbox is required. |
| 30 | Warning maximum | **30 combinations is the maximum. Confirm to continue.** The 30 threshold is visibly reached. |
| 31 or more | Blocked | **This schema exceeds the 30-combination limit. Remove an option value or participating group.** Generate is disabled. |

Color is supplemental: normal uses ink and surface tint; warning uses warning tokens and an icon; blocked uses error tokens, an icon, and disabled action.

### 4.8 Variant matrix and focused row editor

Desktop matrix columns are:

1. Combination
2. SKU
3. Effective price
4. Price source
5. Delivery source
6. Status
7. Row action

- Suggested SKU is editable before save.
- Price source reads **Base price** or **Override**.
- Delivery source reads **Product default** or **Variant override**.
- Inline fields cover SKU, price override, and enabled state. Complete delivery override editing opens a focused drawer.
- Structural regeneration preview marks rows as **Retained**, **New**, or **Will disable**. These labels appear in text and have dedicated semantic surfaces.
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
| Shopify analytics and sales summaries | Nexus owns no sales analytics. | Metric strips show live Product/Order counts only. No invented revenue. |
| Salesforce field-mapping wizard or modal | Nexus owns one exact ordered header and one unified template. Mapping would imply unsupported flexibility. | Show template help and detected fields. Reject invalid structure with precise reasons. |
| Modal-only import workspace | Preview, confirmations, and row errors need durable space and deep scanning. | Use a dedicated Console route. Dialogs are limited to focused confirmation or compact row editing. |
| Modal-only error reporting | A transient panel loses row context and is hard to revisit. | Keep aggregate and row-level errors in the workspace after processing. |
| CSV overwrite or upsert controls | The stable contract is additive exact-match only. | Explain no-update behavior. Offer no overwrite, merge strategy, or update toggle. |
| Nested cards and orange industrial chrome | They fight the paper-elevation system. | White surfaces on cream, ink primary, butter status. Filter pills are allowed; primary buttons are not pills. |
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
- users, login, sessions, profile menus, Owner/Staff roles, or authorization claims;
- Store switching or multi-Store administration;
- custom domains or deployment configuration;
- CSV update, overwrite, upsert, merge strategy, or field mapping;
- payments or public delivery-file URLs;
- configurable option-group, value, or combination limits;
- import history dashboard or background jobs;
- Faire, Atelier, or other third-party marketplace branding.

The Storefront catalog, checkout, and Console Orders list are in scope. Do not imply authentication exists. Metric cards must not invent revenue.


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
