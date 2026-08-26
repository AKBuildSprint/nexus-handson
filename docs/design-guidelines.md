# Nexus Operations Console design guidelines

## 1. Purpose and scope

This document freezes the presentation contract for the Nexus S1 Product Catalog Console. It is the design input for the Phase 2 browser prototype.

It defines the interface language, interaction conventions, responsive transformations, accessibility behavior, and the use of the reviewed Mobbin references. It does not approve or imply backend endpoints, request or response DTOs, database fields, transaction boundaries, storage keys, or persistence behavior. UI route names in this document are Console information architecture only.

The stable domain language comes from the validated Nexus brainstorm and `session-1-brief.md`:

- A **Product** is either simple or has one active **Variant** schema.
- A Product can have 0 to 5 **option groups**, with at most 10 values per group.
- Generated combinations are normal from 0 to 10, require confirmation from 11 to 30, and are blocked at 31 or more.
- Product pricing has one currency and a decimal base price. A Variant may show a decimal price override in the same currency.
- Product delivery has an access title, access instructions, and an optional private PDF or ZIP file up to 25 MB. A Variant either inherits that complete configuration or replaces it with a complete override.
- CSV import uses one fixed template, detects simple and Variant Products from data, is additive exact-match rather than upsert, and is limited to 1 MB and 500 data rows.

## 2. Final visual thesis

**Design read:** a product operations dashboard for a Store operator, using an industrial-utilitarian, restrained, data-first language.

**Aesthetic thesis:** cool concrete neutrals, one safety-orange operational accent, condensed headings, exposed data structure, and a combination meter that makes catalog complexity visible before generation.

The memorable element is the **combination meter**. It is not decoration. Its segmented track, count, threshold labels, and adjacent action make the 10, 11, 30, and 31 boundaries understandable without technical documentation.

### Product design dials

| Dial | Frozen value | Consequence |
| --- | ---: | --- |
| Design variance | 3/10 | Stable shell, left-aligned hierarchy, predictable grouped forms, no ornamental asymmetry. |
| Motion intensity | 2/10 | Immediate state feedback only. No page entrance choreography, parallax, bounce, or perpetual animation. |
| Visual density | 6/10 | Compact table-first desktop canvas with strong grouping and 44 px interaction targets. Mobile composes into summaries rather than shrinking the desktop table. |

### Physical scene and theme choice

The operator uses the Console for focused catalog maintenance, often for several Products in one session on a laptop under normal office lighting. A light, cool-tinted theme keeps dense forms and row comparisons legible. Dark mode is not part of S1 design scope.

### Design principles

1. **Show structure before detail.** Product identity, status, price, option schema, and row outcomes are scannable before advanced delivery fields.
2. **Keep consequential state durable.** Validation, import results, regeneration effects, and save failures remain in the working surface. They are never toast-only.
3. **Use accent for action and state.** Safety orange marks the primary action, current selection, focus, or an active threshold. It is not general decoration.
4. **Flatten hierarchy.** Use spacing, hairlines, section titles, and tinted bands. Do not nest cards or combine borders with wide shadows.
5. **Disclose complexity on demand.** Desktop exposes the Variant matrix. Advanced per-row delivery editing opens a focused side drawer. At 375 px, summaries lead to focused full-width editing.
6. **Name the operator's next step.** Empty, warning, and error states explain what is affected and what action resolves it.

## 3. Token contract

Phase 2 must implement these as named design tokens before styling components. Values may be translated into the chosen CSS architecture, but one-off values must not be introduced beside them.

### 3.1 Typography

Use at most two families:

- **Display:** `Barlow Condensed`, weight 600. Use only for page and section headings. Do not use it for controls, labels, or data.
- **Body and UI:** `Source Sans 3`, weights 400, 600, and 700. Use for navigation, forms, tables, status labels, help text, and data.

Both families must load Latin Extended glyphs. If a font is unavailable during local development, use a metrics-compatible sans fallback without changing layout decisions. The fallback is not the approved display face.

| Token | Size / line height | Use |
| --- | --- | --- |
| `type-page` | 28 / 32 px, Barlow Condensed 600 | Page title only. |
| `type-section` | 23 / 28 px, Barlow Condensed 600 | Major editor and workspace sections. |
| `type-subhead` | 19 / 24 px, Source Sans 3 600 | Subsections, drawer title, grouped result title. |
| `type-body` | 16 / 24 px, Source Sans 3 400 | Form controls, prose, primary table content. |
| `type-compact` | 14 / 20 px, Source Sans 3 400 or 600 | Dense metadata and secondary table content on desktop. |
| `type-meta` | 12 / 16 px, Source Sans 3 600 | Field hints, status labels, counts. Uppercase only for short operational labels, with `0.08em` tracking. |

Rules:

- Use no more than the six type steps above.
- All text inputs remain at least 16 px at 375 px to prevent browser zoom.
- Use `font-variant-numeric: tabular-nums` for prices, counts, row numbers, file sizes, and timestamps.
- Use `text-wrap: balance` on headings and `text-wrap: pretty` on explanatory copy.
- Field labels are persistent. Placeholders never substitute for labels.
- SKU text uses the body family with tabular numerals. Monospace is not used as a technical costume.

### 3.2 Color

Color strategy is **restrained**: tinted neutrals carry at least 90 percent of the surface; the accent is reserved for primary action, selection, focus, and meaningful active state. Semantic colors appear only when a warning, error, or success exists.

| Token | Frozen value | Role |
| --- | --- | --- |
| `color-canvas` | `oklch(0.965 0.008 245)` | Console background. |
| `color-surface` | `oklch(0.985 0.004 245)` | Form and table working surface. Not pure white. |
| `color-surface-muted` | `oklch(0.925 0.012 245)` | Group bands, selected row support, skeleton base. |
| `color-surface-strong` | `oklch(0.865 0.016 245)` | Disabled or emphasized structural band. |
| `color-ink` | `oklch(0.220 0.024 245)` | Primary text. Not pure black. |
| `color-ink-muted` | `oklch(0.410 0.022 245)` | Secondary text and help copy. |
| `color-border` | `oklch(0.790 0.016 245)` | Default hairline divider. |
| `color-border-strong` | `oklch(0.540 0.025 245)` | Active divider and grouped boundary. |
| `color-accent` | `oklch(0.675 0.180 45)` | Primary action, current selection, threshold marker. |
| `color-accent-hover` | `oklch(0.615 0.180 45)` | Hover. |
| `color-accent-active` | `oklch(0.555 0.170 45)` | Pressed state. |
| `color-accent-soft` | `oklch(0.915 0.045 45)` | Selected or active background. |
| `color-accent-ink` | `oklch(0.205 0.035 45)` | Text and icon on accent surfaces. |
| `color-success-surface` | `oklch(0.925 0.045 150)` | Durable success summary. |
| `color-success-ink` | `oklch(0.300 0.090 150)` | Success text and icon. |
| `color-warning-surface` | `oklch(0.930 0.070 85)` | Warning and confirmation surface. |
| `color-warning-ink` | `oklch(0.300 0.085 75)` | Warning text and icon. |
| `color-error-surface` | `oklch(0.930 0.045 25)` | Validation and request error surface. |
| `color-error-ink` | `oklch(0.330 0.130 25)` | Error text and icon. |
| `color-info-surface` | `oklch(0.925 0.035 245)` | Neutral information surface. |
| `color-info-ink` | `oklch(0.300 0.095 245)` | Information text and icon. |
| `color-scrim` | `oklch(0.220 0.024 245 / 0.42)` | Drawer or dialog scrim only. |

Rules:

- No raw black, raw white, gradients, glow, glass, or decorative transparency.
- Do not mix warm and cool gray families.
- Do not communicate status by color alone. Pair every semantic color with a label, icon, count, or message.
- Body, help, placeholder, and disabled text must remain legible against their actual surface. Phase 2 must verify at least 4.5:1 for text and 3:1 for meaningful graphics, focus indicators, and large text.
- Text on a semantic surface uses the matching semantic ink token, not neutral gray or opacity.
- Accent coverage stays below 10 percent of a view.

### 3.3 Spacing and density

Use only this spacing scale:

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

Density rules:

- Related label, control, and help text use 4 to 8 px gaps.
- Related controls in a field group use 12 to 16 px gaps.
- Visual field groups use 24 px gaps and contain at most four fields before a new heading or divider.
- Major editor sections use 32 to 48 px separation.
- Desktop table rows are 48 px minimum. Multi-line or error rows grow vertically instead of clipping.
- Default control height is 44 px. Compact icon visuals may be smaller only when their interactive hit area remains at least 44 by 44 px.
- Desktop canvas padding is 32 px. Compact and 375 px canvas padding is 16 px.

### 3.4 Shape, borders, and depth

| Token | Value | Use |
| --- | --- | --- |
| `radius-control` | 4 px | Inputs, buttons, status selector, dropzone. |
| `radius-surface` | 8 px | Drawer, durable notice, empty-state boundary. |
| `border-hairline` | 1 px | Tables, section dividers, grouped rows. |
| `border-emphasis` | 2 px | Drop target active boundary and validation emphasis only. |

The depth strategy is fixed to **hairline dividers plus surface tints**.

- Working sections are not floating cards.
- Tables use exposed rows and dividers, not individual row cards.
- Drawers use a scrim and one edge divider. They do not need a wide shadow.
- Do not combine a border, wide shadow, and tinted surface on the same element.
- Pill shapes are reserved for compact status text only. Buttons, inputs, cards, and notices are not pills.

### 3.5 Motion

| Token | Value | Use |
| --- | --- | --- |
| `motion-press` | 100 ms | Button press, checkbox, switch. |
| `motion-state` | 180 ms | Hover, focus support, validation color. |
| `motion-panel` | 240 ms | Drawer or disclosure open and close. |
| `ease-out` | `cubic-bezier(0.25, 1, 0.5, 1)` | All state transitions. |

Rules:

- Animate only opacity, transform, color, and bounded panel disclosure. Never use `transition: all`.
- Product UI content is visible by default. No entrance animation gates content.
- Skeletons use a static surface contrast by default. If a subtle pulse is used, it stops under `prefers-reduced-motion`.
- Reduced motion sets transitions to immediate while preserving state change, focus placement, and announcements.
- No bounce, elastic easing, parallax, row reordering flourish, or success confetti.

### 3.6 Focus, targets, and input behavior

| Token | Value |
| --- | --- |
| `focus-ring-width` | 2 px |
| `focus-ring-offset` | 2 px |
| `target-min` | 44 by 44 px |
| `input-min-mobile` | 16 px text |

- `:focus-visible` uses `color-accent-active`, a 2 px ring, and a 2 px surface-colored offset. It must not be clipped by sticky bars, table overflow containers, or drawers.
- Hover, active, focus-visible, disabled, and loading states are distinct. Hover is not the only indication of interactivity.
- Validate fields on blur and again on submit. Do not validate on every keystroke.
- Put an error immediately after its field and connect it with `aria-describedby` and `aria-invalid`.
- When submit finds errors, move focus to the error summary. The summary links to each invalid field. Do not move focus while the operator is typing.
- Disabled controls keep readable labels and explain the prerequisite in adjacent help text or the disabled action's description.

### 3.7 Layout and responsive tokens

| Token | Value | Use |
| --- | ---: | --- |
| `layout-compact-max` | 719 px | Composed compact layout. |
| `layout-medium-min` | 720 px | Intermediate layout. |
| `layout-desktop-min` | 1024 px | Full rail and matrix table. |
| `layout-rail-width` | 208 px | Desktop Console rail. |
| `layout-topbar-height` | 56 px | Compact top app bar. |
| `layout-editor-measure` | 960 px | Maximum width for form sections. |
| `layout-drawer-width` | 480 px | Desktop focused editor. |

Desktop uses the 208 px rail and a flexible working canvas. The Product table can use the full canvas; the editor form is capped at 960 px for reading and field grouping.

At 375 px:

- The rail becomes a 56 px top app bar with the current destination and navigation trigger. Products remains directly identifiable.
- Page padding becomes 16 px.
- Header actions do not wrap into an unreadable toolbar. One primary action stays visible; secondary actions move to a labeled overflow menu or an action sheet.
- Data tables become semantic summary lists. Each item exposes the fields needed to choose it, then opens focused detail. The page itself never scrolls horizontally.
- Sticky top editor actions become a safe-area-aware bottom action bar with **Save Product** as the primary action and **Discard changes** in the overflow or preceding link position.
- Multi-column form groups become a single column. Currency remains adjacent to price only when both controls fit without shrinking below their usable width; otherwise they stack with preserved labels.
- The Variant matrix becomes combination summary rows. Selecting a row opens a full-width focused editor. Advanced fields are never compressed into hidden columns.
- The CSV preview becomes stacked Product groups and collapsible row details. Counts precede details. There is no horizontally scrolling CSV sheet.
- Drawers become full-height, full-width dialogs with a visible close control, an accessible title, and focus containment.

Intermediate widths may collapse columns earlier when content would otherwise overflow. Breakpoints are structural, not device labels.

## 4. Component presentation contract

### 4.1 Console shell and navigation

- Desktop rail has the Nexus identity at top, a single primary destination **Products**, and no fake analytics destinations.
- The active destination uses accent-soft background, accent-ink text, and a visible left-aligned label. It does not rely on an unlabeled icon.
- Compact navigation preserves a skip link and clear page title. The menu returns focus to its trigger when closed.
- Do not present login, profile, tenant switcher, Store selector, inventory, analytics, or custom-domain controls in S1.

### 4.2 Page header and actions

- Product list primary action: **Add Product**.
- Product list secondary actions: **Import CSV** and **Download CSV template**.
- Product editor primary action: **Save Product**.
- Product editor secondary navigation: **Back to Products**. **Discard changes** appears only after the form becomes dirty.
- CSV workspace primary action changes by state: **Choose CSV**, then **Import Products** after a valid preview and any required confirmation.
- A view has one visually primary action. Disabled primary actions preserve the label and expose the reason.

### 4.3 Buttons and links

Every button supports:

- `control-default`: stable label and icon where useful.
- `control-hover`: accent or surface change plus a one-step icon translation where an icon denotes direction.
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
| Shopify dark save-bar branding and full visual chrome | Persistent actions are useful, but the visual treatment conflicts with Nexus's light, cool, industrial token system. | Retain persistence and hierarchy; restyle entirely with Nexus surface, divider, type, and focus tokens. |
| Shopify analytics and sales summaries | Nexus S1 owns no analytics acceptance criterion or trustworthy aggregate data. | Product list is table-first with no metric cards. |
| Salesforce field-mapping wizard or modal | Nexus owns one exact ordered header and one unified template. Mapping would imply unsupported flexibility. | Show template help and detected fields. Reject invalid structure with precise reasons. |
| Modal-only import workspace | Preview, confirmations, and row errors need durable space and deep scanning. | Use a dedicated Console route. Dialogs are limited to focused confirmation or compact row editing. |
| Modal-only error reporting | A transient panel loses row context and is hard to revisit. | Keep aggregate and row-level errors in the workspace after processing. |
| CSV overwrite or upsert controls | The stable S1 contract is additive exact-match only. | Explain no-update behavior. Offer no overwrite, merge strategy, or update toggle. |
| Pill-heavy status dashboards and nested cards | They reduce density and create generic admin styling. | Use exposed rows, hairlines, compact status labels, and surface tints. |
| Copying Shopify, Salesforce, or Squarespace brand color, typography, icons, or layout chrome | Mobbin is interaction evidence, not Nexus branding. | Use the frozen industrial-utilitarian tokens in this document. |

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

The Phase 2 prototype must not introduce controls, navigation, empty states, placeholders, or fake data for:

- inventory, stock, warehouses, or quantity fulfillment;
- sales analytics, revenue metrics, dashboards, or reports;
- users, login, sessions, profile menus, Owner/Staff roles, or authorization claims;
- Store switching or multi-Store administration;
- custom domains or deployment configuration;
- CSV update, overwrite, upsert, merge strategy, or field mapping;
- Customer Storefront, Cart, checkout, Orders, Payments, or access grants;
- public or permanent delivery-file URLs;
- configurable option-group, value, or combination limits;
- import history dashboard or background jobs.

S1 Console and write interactions are public by explicit product decision. The design must not imply that authentication or Owner authorization exists. It also must not add warning furniture that suggests public access is a user-configurable Console feature.

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
