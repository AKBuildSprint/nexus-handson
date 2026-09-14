# Storefront surface brief — Nexus design parity, Phase 3 (S01–S04)

You own **`apps/storefront/src/**`** end to end (`storefront-app.tsx`, `styles.css`).
Do NOT edit: `apps/console/**`, `packages/**`, `migrations/**`, `tests/**`, `design/UI-UX/**`,
`docs/design-guidelines.md`, or any token declaration outside `apps/storefront/src/styles.css`.
A Console agent works concurrently under `apps/console/**`. Never touch it.

## Authority

1. `plans/260914-1330-nexus-design-parity/reference-parity-contract.md` — read in full first.
2. `plans/260914-1330-nexus-design-parity/phase-03-storefront-surfaces.md` — your phase spec. Read in full second.
3. `design/UI-UX/Nexus Console.dc.html` — the desktop visual target. Storefront regions: R08 catalog/ledger `HTML 66–160`,
   R09 private Order `162–236`. Do not edit it.
4. `plans/260914-1330-nexus-design-parity/evidence/geometry.json` — measured reference geometry. Match within 2 CSS px
   outside the E01–E09 exception register.
5. `docs/design-guidelines.md` §2, §3, §4.1, §4.13 — the reconciled token system and the Storefront presentation contract.

E01–E09 are the only permitted differences. Accessibility (E02: 44 px targets, 16 px editable text), responsive safety
(E04), live data (E05), truthful copy (E08) and privacy (E09 — never render a capability or complete private URL) always
win over literal copying.

## Landed token contract (already in `apps/storefront/src/styles.css` `:root`; consume it, do not re-add names)

Names now match the Console vocabulary. Removed: `--type-display`, `--type-page`, `--type-section`, `--type-body`,
`--type-compact`, `--type-meta`, `--color-band`, `--color-band-strong`, `--radius`, `--border`, `--target`, `--measure`,
`--shadow-soft`, `--shadow-panel`. Any leftover reference to those is a defect you must fix.

- Type: `--type-hero-size/-line` 42/48, `--type-order-title-size/-line` 32/38, `--type-ledger-size/-line` 22/28,
  `--type-heading-size/-line` 20, `--type-section-size/-line` 22/28, `--type-card-title-size/-line` 19/25,
  `--type-price-size` 15, `--type-body-size/-line` 16/24 (**editable controls only — never shrink**),
  `--type-ui-size/-line` 14/20, `--type-prose-size/-line` 14/21, `--type-data-size/-line` 13/19,
  `--type-compact-size/-line` 14/21, `--type-meta-size/-line` 12/16, `--type-table-head-size/-line` 11/16,
  `--type-kicker-size/-line` 10 px + `--tracking-kicker` 0.14em, `--tracking-meta` 0.08em, `--tracking-table-head` 0.06em.
- Colors: `--color-canvas`, `--color-surface`, `--color-surface-muted`, `--color-surface-strong`, `--color-ink`,
  `--color-ink-muted`, `--color-border` (#8a8182 strong control boundary), `--color-border-strong`, `--color-divider`
  (#eae8e6 decorative paper divider), `--color-accent`, `--color-accent-hover`, `--color-accent-active`,
  `--color-accent-soft` (butter), `--color-accent-ink`, `--color-success-surface/-ink`, `--color-warning-surface/-ink`,
  `--color-error-surface/-ink`, `--color-info-surface`, `--color-info-ink`, `--color-scrim`.
- Space: `--space-1` 4, `--space-1-5` 6, `--space-2` 8, `--space-2-5` 10, `--space-3` 12, `--space-3-5` 14, `--space-4` 16,
  `--space-4-5` 18, `--space-5` 20, `--space-6` 24, `--space-7` 28, `--space-8` 32, `--space-10` 40, `--space-12` 48.
- Shape/target: `--radius-control` 4, `--radius-surface` 4, `--radius-pill` 40, `--border-hairline` 1,
  `--border-emphasis` 2, `--target-min` 44, `--focus-ring-width/-offset` 2.
- Layout: `--layout-compact-inset` 16, `--layout-storefront-measure` 1280, `--layout-storefront-inset` 32,
  `--layout-storefront-block` 40, `--layout-hero-track-min` 280, `--layout-workspace-track-min` 320,
  `--layout-card-track-min` 240, `--layout-card-padding` 18, `--layout-card-gap` 10, `--layout-media-well` 96,
  `--layout-ledger-padding` 20, `--layout-ledger-gap` 14, `--layout-order-measure` 760, `--layout-order-padding` 28,
  `--layout-order-gap` 24.
- There are NO shadow tokens. Nothing in the Storefront may use a box-shadow.

## Measured reference geometry to match (1440×900)

| Anchor | Target |
|---|---|
| Header | 64 px tall, `padding: 0 32px`, white, `color-divider` bottom border, normal flow (not sticky), no blur |
| Main | `padding: 40px 32px`, gap 28, `max-width: 1280px` centered ⇒ inner width 1216, left edge 112 |
| Hero | `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`, gap 32, `align-items: end`, `padding-bottom: 24px` + divider; two 592 px tracks |
| Snapshot | white bordered panel, `padding: 16px`, gap 10, two rows only |
| Workspace | `grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))`, gap 28, `align-items: start`; two 594 px tracks |
| Card grid | `repeat(auto-fit, minmax(240px, 1fr))`, gap 16 ⇒ two 289 px cards at 1440, one 466 px card at 1024 |
| Card | `padding: 18px`, gap 10, 4 px radius, 1 px divider border; media well 96 px tall |
| Ledger | `padding: 20px`, gap 14, 4 px divider border, no shadow |
| Private Order page | `max-width: 760px`, `padding: 40px 32px`, gap 20; article `padding: 28px`, gap 24 |

Responsive: at ≤719 px inset 16 px and one column everywhere. At 720–731 px keep the workspace in ONE column; switch to the
equal split only from 732 px (viewport with 64 px total inset giving ≥668 px inner width). At 375 px the inner column is
343 px wide with one card. Reference Overlay evidence: `evidence/geometry.json` → `referenceMobileDefectE04`.

## Required outcomes per surface

- **S01 chrome, hero, catalog.** `StorefrontFrame`: skip link, ONE header, main; **remove** the announcement banner, the
  editorial ink band and the global page footer markup entirely (do not hide them with CSS). Header per the table above with
  a 20 px serif **Nexus** wordmark (`-0.02em`) + 10 px/0.14em uppercase **STOREFRONT** label; the real public
  `catalog.store.name` stays quiet text for tenant identity (E01) — never a large title. Right navigation uses the existing
  real Catalog route with pill styling, 44 px target, ink fill/white text and `aria-current`; do not invent My Order,
  Back to Console, or a hard-coded Console URL.
  Hero: two equal tracks, gap 32, `align-items: end`, 24 px bottom padding + divider. Heading 42/48 serif 400 with balance;
  **E08 truthful copy: “Digital products, with every purchase in one private Order.”** (the existing `PAID_STATUS_COPY` /
  `FULFILLED_STATUS_COPY` explicitly say this page does not deliver files — do not implement a delivery feature to justify
  the demo's promise). Paragraph 15/23 muted, max 52ch, ending on the private Order link being the only way back to the Order.
  Snapshot: white bordered panel, 16 px padding, gap 10, exactly TWO rows — `Published Products` = `catalog.products.length`
  and `Simple / Variant` = `simpleCount / variantCount` — labels 12 px muted, values 22 px serif 400 tabular right-aligned,
  row gap 12. Derive from the complete public response, never the current page and never literals `3` / `1 / 2`. Delete the
  snapshot heading, badge, third row, hero CTA and butter underline. Loading keeps equivalent two-row skeleton geometry;
  a true empty catalog shows real zero counts plus its empty notice; a fetch error must not fabricate zeros as known data.
  Workspace per the table: catalog LEFT, Purchase ledger RIGHT — the catalog must not span the full page. Catalog column:
  search row → compact filters/top pager → card grid → bottom pager, gap 16, with `catalogResultsRef` on the meaningful
  results container so the bottom pager returns this region to view. Search: real visibly labelled input styled as a pill,
  44 px, 16 px text, `--color-border` boundary, 14 px inline padding, result count 12 px to the right; keep the existing query
  URL sync/reset semantics. Keep All Products / Simple / Variant filters, the 24-item page size and both `CatalogPager`s
  inside this left region with their ranges, boundary disabled states, accessible nav names and continuity of the selected
  Product/options/cart/customer/frozen retry.
  Card: replace the whole-card button with an `article` + real footer selection button (remove the nested-interactive risk).
  18 px padding, gap 10, 4 px radius, 1 px `color-divider` border; selected border switches to the ink role without changing
  box size. Empty `aria-hidden` muted media well 96 px, 4 px radius — remove decorative initials and any square aspect-ratio;
  add no images. Name is a semantic `h2` at 19/25 serif 400 with full wrapping; description 13/19 muted; price 15 px tabular
  via the existing currency-aware range formatter; footer separated by a divider with the price at left and a white bordered
  `Select`/`Selected` button at right carrying the Product name in its accessible name and `aria-pressed`, retaining pointer
  and keyboard selection. Remove the extra type row from the card face (type stays in the live snapshot and filters). No hover
  translate/lift/shadow or all-card tint.
- **S02 Purchase ledger.** ONE white bordered panel, 20 px padding, gap 14, radius 4, no shadow, no per-child padding stack;
  DOM order equals visual order. Header: 10 px/0.14em uppercase kicker `Purchase ledger`, 22/28 serif selected Product title,
  13/19 muted public description. Keep the error summary attached to the real form with alert/focus and valid links to
  selection, quantity, cart, name and email. **Options become native radio pills**: one labelled fieldset/radiogroup per real
  option group, source gap 6, 4 px corners, white unselected / ink selected, 44 px targets, visible focus, bound to the
  existing `selectedOptions` / `setSelectedOptions`; do not select an arbitrary default and do not drop incomplete-selection
  validation. All configured groups and values render — there is no one-select-per-page invariant. Keep `matchingVariant`,
  price resolution, locking and error association authoritative. Replace every `<select>`; the tests' first-`select` query
  must not constrain the Product schema to one group. **Quantity becomes a real stepper**: `type="button"` decrement,
  centered existing numeric input with its Quantity label, increment — 44 px targets, accessible names, existing 1–99 bounds
  and direct-typing/blur errors, disabled at 1 and at 99 and while locked or invalid, never silently coercing invalid input
  into a valid Order, with the helper stating the real bound and the 10-lines-per-Order limit. Keep `Add to Order` as a
  secondary action and keep the real multi-line cart immediately below selection inside this ledger (E05): identity/options,
  quantity/edit/remove, amounts, and the existing 10-line / duplicate / mixed-currency validation — do not replace it with the
  prototype's one-line fixture. Name then Email as one-column persistent-labelled 44 px / 16 px fields with autocomplete and
  existing blur/submit validation, in a divided group with 10 px top padding. Muted totals box: 12 px padding, gap 8, radius 4,
  real cart line summaries, divider, Order total — never place an uncommitted "pending selection" amount in the committed cart
  summary; if the current selection price is shown, label it separately above the review as “Selected item price — not yet
  added.” Price-source helper may only state what public DTO data supports; use the honest published effective-price wording
  under E08 and never expose private delivery source. Keep submit error / contract-outdated recovery adjacent to the submit
  action with the frozen retry identity. `Place Order`: full ledger-width ink/white primary, 44 px minimum, 14 px/500 label,
  real submitting/retry labels and disabled conditions for empty cart/lock/mixed currency, with the private-link warning
  visible. Selection/card/page changes must not erase cart, customer fields or unresolved attempt identity.
- **S03 Private Order and refund.** `.order-page`: max 760 px including padding, centered, 40/32 px padding, grid gap 20.
  Keep the existing Back to catalog route action as a compact extension. Private-link notice above the article: info surface,
  1 px divider, radius 4, `padding: 12px 16px`, gap 12, wrapping, label `Private Order link` and safe explanatory prose —
  **never render the capability or the complete URL, not even a masked token copied from the source** (existing privacy tests
  prohibit capability text); no clipboard/share controls and no fragment transport change. Article: white, 1 px divider,
  radius 4, `padding: 28px`, grid gap 24, no shadow, no blanket child border/padding styling. Header: 10 px/0.14em kicker,
  real Order title 32/38 serif, non-interactive status tag 26 px tall with 4 px corners (no 44 px target needed) using
  Pending muted / Paid & Fulfilled butter / Canceled error pair and the real label. Items: 12 px/0.06em uppercase heading,
  bordered rows `padding: 14px` gap 3, name 14 px, selection 13 px, `quantity × unit = line total` at 13 px tabular via the
  existing money logic — never swap the immutable snapshot for live Product data. Payment: muted box, 16 px padding, gap 8,
  reference label 12/value 13, Total label 13/value 18, keeping real payment-next-step/status gating and exposing no
  Console-only payment evidence. Status block: 12 px uppercase heading, body 14/21, preserving `PAID_STATUS_COPY`,
  `FULFILLED_STATUS_COPY`, canceled copy and the current `paymentNextStep` conditions — no new download or payout promise.
  Refund form: top divider, 20 px padding, gap 10, **20 px serif** heading, body 14/21, labelled textarea
  `min-height: 110px`, `padding: 10px 12px`, 16 px text, the current 1000-char limit/counter/errors and retry state; the
  primary submit is `width: fit-content` with a 44 px target (full-width only if mobile needs it). Stored refund request:
  same section geometry/20 px heading, pending = butter tag, approved = positive semantic role with the real label,
  rejected = error pair, preserving the real “request approved, refund not issued” semantics, stored reason/newlines,
  timestamp and refresh-failed notices. Created-time footer: top divider, 16 px padding, 12 px muted text. Omit the
  synthetic fulfilled-example toggle and add no marketing footer. Loading / missing-capability / error / contract-outdated /
  refresh-failure keep their existing recovery action and notice state with skeletons occupying the paper region; never emit
  the private-link notice with fake data while loading.
- **S04 responsive.** Desktop values above are locked. Below 720 px use the 16 px compact inset and force hero and workspace
  to one column, with responsive-safe track minima (`min(100%, <target>)` or equivalent) so a source 320 px minimum never
  forces overflow. At 720–1023 px keep the 32 px inset; the hero may use its source 280 px auto-fit tracks, but the workspace
  stays ONE column until its inner width reaches 668 px (viewport 732) and uses the equal split from there — no two tracks at
  719 flipping to one at 720. The card grid keeps 240 px auto-fit inside its actual parent; do not assert a fixed
  cards-per-row at intermediate widths. At 375 px: header may wrap and grow under E02/E04, inset 16 px, ledger/article internal
  padding 16 px, all text wraps, all data and actions remain. DOM order must match the visual stack — header → hero → live
  snapshot → search/filters/top pager → cards → bottom pager → ledger; Private Order: header → back → notice → article
  header/status → items → payment → status → refund → created footer. No CSS reordering. Never hide overflow, clamp prose,
  or remove a control. Measure `document.documentElement.scrollWidth <= clientWidth` and `document.body.scrollWidth <=
  clientWidth` at 375/720/732/1024/1440.

## Hard rules

- No API payload, public visibility, private capability, checkout/refund retry, quantity bound, cart limit, currency,
  delivery promise, route or domain-state change. No credentials or auth addition. Do not import app packages into this
  HTTP-only app. Do not modify the reference.
- Run language-server references before changing exported component props and migrate every caller. Keep useful ids used by
  labels/error links; class names, the old `<select>` shape, incidental strings and first-element test queries are NOT
  reasons to keep a different UI. No compatibility DOM, hidden duplicate controls or test-only options.
- Every interactive target ≥ 44×44 px with no overlapping hit areas; editable text ≥ 16 px; primary actions keep
  `color-accent` fill + `color-accent-ink` text. No new token, no per-value literal beside the token scale, no box-shadow.
- Reinstate no banner/footer/editorial/featured/hero-CTA/card-initial markup; delete their dead CSS rather than orphaning it.
- Do NOT edit tests. Instead produce an exact list of test files/lines/cases your change invalidates (the existing
  first-`select` option queries and any class/copy pins) plus the new accessible surface, for the Phase 4 owner.

## Definition of done

1. `npm run typecheck` clean.
2. `npm run build:storefront` clean.
3. Zero references to any removed token name; zero `box-shadow`; banner/editorial-band/page-footer markup gone.
4. A written handoff listing: files changed, every reference anchor matched with measured/expected value, any E-ID applied
   and why, every invalidated test/helper (file + line + new surface), and anything you did not achieve. State explicitly
   what you did NOT verify in a browser.
