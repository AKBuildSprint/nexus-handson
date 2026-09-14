---
title: "Phase 3: Reference-Matched Storefront and Purchase Ledger"
status: done
---

# Phase 3: Reference-Matched Storefront and Purchase Ledger

## Objective and dependency

The real Storefront must reproduce R08/R09: white compact header; serif marketing hero with a two-row live snapshot; catalog LEFT and Purchase ledger RIGHT; compact bordered cards; narrow private Order paper. Matching colors while retaining a full-width catalog or a different ledger control design fails.

Read [reference-parity-contract.md](./reference-parity-contract.md). Only E01–E09 allow differences. Phase 1 publishes tokens first. This phase may then run beside Phase 2, with no shared-file mutation except through the integration owner.

## File/symbol ownership

Modify during cook:

- `apps/storefront/src/storefront-app.tsx`: `StorefrontFrame`, `StorefrontApp`, `CatalogProduct`, `CatalogPager`, `PrivateOrderPage`; their presentation and real selection controls.
- `apps/storefront/src/styles.css`: component layout/styles; consume Phase 1 token subset.

Read-only behavior contracts:

- `apps/storefront/src/api-client.ts`: existing public HTTP calls; no credentials/auth addition.
- `apps/storefront/src/storefront-view-types.ts`: public Store metadata, Product/options/variants, immutable Order item projections.
- `tests/browser/storefront-orders-contracts.test.ts`, `tests/e2e/storefront-orders.spec.ts`: behavior expectations and fixture setup. Phase 4 integration owner updates affected meaningful tests/helpers after changed controls are integrated.

Do not change API payloads, public visibility rules, private capability handling, checkout/refund retry logic, quantity bounds, cart limits, currencies, delivery promises, routes or domain state machines. Do not import app packages into this HTTP-only app. Do not modify the reference or a shared token declaration unilaterally.

Before changing exported component props, obtain language-server references and migrate all callers. Preserve useful IDs used by labels/error links, but class names, old `<select>` shape, incidental strings and first-element test queries are NOT reasons to retain a different UI. No compatibility DOM, hidden duplicate controls or test-only options surface.

## Source-to-target map

| Current surface | Required target | Source / exception |
| --- | --- | --- |
| Announcement banner, editorial band, multi-column page footer | Remove markup/styles; retain needed private-link explanation in hero/ledger | R08 has no such page furniture |
| Translucent/sticky 72 px header, large wordmark | Normal-flow opaque white 64 px header, 20 px serif Nexus mark | R08 68–75; E02 target sizes |
| Dynamic Store-name h1, butter rule, Explore Catalog CTA | 42/48 marketing headline, explanatory paragraph, no title rule/CTA | R08 79–82; E08 truthful copy |
| Snapshot kicker/store badge/three rows | Two inline rows: Published Products, Simple / Variant | R08 84–91; E05 live counts |
| Full-width featured/catalog presentation | Equal catalog-left / ledger-right workspace | R08 94–158 |
| Whole-card selection and decorative initials | Article, empty 96 px media well, serif name, divided price/Select footer | R08 102–109 |
| Select dropdowns for option values | Accessible single-choice pill groups matching demo buttons | R08 121–129; E02/E05 retain semantics |
| Standalone Quantity input | Minus / centered existing numeric input / plus row | R08 131–139; E02/E05 keep1–99 |
| Shadowed ledger with padded child rows | One bordered panel padded20/gap14, internal groups and muted total box | R08 115–157 |
| Wide/shadowed private Order | Max760 notice + bordered article padded28/gap24 | R09 163–234 |
| Uniform butter Order status | Pending muted, Paid/Fulfilled butter, Canceled error pair | HTML799–803; E03 corners4 |

## S01 — Chrome, hero and catalog

### 1. Header

1. `StorefrontFrame` renders skip link, one header, main content; remove banner and global page footer rather than hide them.
2. Header is normal document flow, white, 64 px high at desktop, horizontal inset32, bottom pale divider. Remove sticky positioning and backdrop blur: these are not present in the source and would change scrolled screenshots.
3. Nexus mark is Source Serif4 20 px/400, tracking−0.02em; adjacent STOREFRONT short label is10 px/600, tracking0.14em. Consume semantic roles from Phase1, not a local smaller type scale.
4. Retain public `catalog.store.name` as quiet text in the header identity area where it is needed to identify the Store (E01), not a large title or snapshot badge. Do not fabricate another Store name or lose tenant context just to match fixture copy.
5. Right navigation uses the existing real Catalog route, pill styling, 44 px target, current ink fill/white text and `aria-current`. Do not invent a global My Order or hard-code a Console URL; E01 covers omitted prototype links. Keep the same compact group alignment with fewer controls.

### 2. Hero and snapshot

- `.catalog-page`: max1280 including inline padding; centered; desktop padding40px 32px; display grid/gap28. At1440 its inner width is1216 and left edge112.
- `.catalog-hero`: two equal tracks at desktop, source auto-fit minimum280, gap32, align-end, bottom padding24 + pale divider. First column gap10; second is the snapshot.
- Heading role is42/48 serif400 with source tracking and balanced wrapping. **Approved truthful adaptation E08:** use “Digital products, with every purchase in one private Order.” rather than promise delivery immediately upon payment. Current `PAID_STATUS_COPY` and `FULFILLED_STATUS_COPY` explicitly say this page does not deliver files. Do not implement a new delivery feature to justify demo marketing.
- Paragraph:15/23 muted, max52ch, text “Every purchase creates one private Order link. Keep it — it is the only way back to this Order.” E08 changes only the unsupported file promise; retain source geometry/type.
- Snapshot: white bordered paper, radius4, padding16, gap10. Exactly TWO live rows: `Published Products = catalog.products.length`; `Simple / Variant = simpleCount / variantCount`. Labels12 px muted, values22 px serif400 tabular; row gap12, values right-aligned. Counts use complete public response, not filtered/current-page rows.
- Remove snapshot heading/badge/third row and hero CTA/butter underline. Loading keeps equivalent two-row skeleton geometry. True empty catalog renders real zero counts where known plus its empty notice; fetch error does not fabricate zeros as known data.

### 3. Catalog-left / ledger-right layout

- `.storefront-workspace` has equal tracks, gap28, align-start. At1440:594/594; at1024:466/466. Main catalog must not take the full page width.
- Catalog column is grid/gap16. Put `catalogResultsRef` on its meaningful results container so the bottom pager returns this region to view.
- Catalog order: search row → compact filters/top pager extension → card grid → bottom pager. No extra featured-title block.
- Search row has a real visibly labeled search input styled as a pill, 44 px target/16 px input text, strong control boundary, inline padding14; result count12 px to the right. Use a short persistent “Search Products” label above or beside the pill (E02); a placeholder does not replace it. Preserve existing query URL sync/reset semantics.
- Keep All Products / Simple / Variant filters, 24-item page size and top/bottom `CatalogPager` inside this left region, wrapping compactly. These are E05 operational additions, not extra cards. Preserve ranges, boundary disabled states, accessible nav names and selected Product/options/cart/customer/frozen retry continuity.
- Card grid uses source minimum240, gap16; at1440 two cards of289 px; at1024 one card of466 px. At375 force one343 px inner-column card under E04.

### 4. Catalog card

`CatalogProduct` becomes an article with real footer selection button; remove the whole-card button wrapper and nested-interactive risk.

- Outer paper: padding18, gap10, radius4, 1 px pale divider. Selected border changes to the existing ink role without changing its thickness/box dimensions.
- Empty `aria-hidden` muted media well: height96, radius4. Remove decorative initials and square aspect-ratio; do not invent images.
- Name: semantic h2, Source Serif4 **19/25**, weight400, full-text wrapping. Description: **13/19** muted. Price: **15 px** tabular, existing currency-aware range formatter. Do not round these to18/26 or14/21 because old tokens are convenient.
- Footer: top divider/padding10, gap10, price at left, white bordered `Select`/`Selected` button at right with44 target. Give button the Product name in its accessible name and `aria-pressed`; retain pointer/keyboard selection behavior and selected outline/text.
- Remove the extra Product-type row from the card face; type remains in live snapshot/filter and meaningful selection context. Do not remove real name/description/price.
- No hover translate/lift/shadow or all-card tint absent from source. Hover/focus feedback belongs to the actual action; selected border remains stable.

## S02 — Real Purchase ledger in the reference control design

One white bordered panel, padding20, gap14, radius4; remove shadow and per-child padding stacks. DOM and visual order agree.

1. Header: kicker `Purchase ledger`10px/600 uppercase0.14em, selected Product title22/28 serif, public description13/19 muted. No private Console description/delivery field is introduced.
2. Error summary stays attached to the actual form with alert/focus and valid links to selection, quantity, cart, name and email. Restyle its paper/error tokens; do not duplicate a hidden old form.
3. **Options as pills, not dropdowns:** for each real option group render a labeled fieldset/radiogroup of single-choice values with source gap6, compact4px corners, white unselected/ink selected styles and44px targets. Prefer native radio inputs with styled labels, preserving visible focus; alternatively a correctly implemented radiogroup must implement Arrow/Home/End and checked state. Bind existing `selectedOptions[group.id]`/`setSelectedOptions`; do not select an arbitrary default or drop incomplete-selection validation. All configured groups and values render; there is no “one select per page” invariant. Existing `matchingVariant`, price resolution, locking and error association remain authoritative.
4. **Quantity as a real stepper:** decrement button, centered existing numeric input with Quantity label, increment button. Both buttons type=button, accessible names,44px target. Keep current1–99 bounds and direct typing/blur errors; use existing quantity state/handlers. Disable decrement at1, increment at99, both while locked or invalid text needs correction; never silently coerce invalid input to a valid Order. Show helper “Quantity1–99 · at most10 Product lines per Order.” These two buttons are a presentation affordance over existing quantity behavior, not a new domain operation.
5. Keep `Add to Order` as a secondary action and real multi-line Order review immediately below selection, inside this ledger (E05). Cart rows show identity/options, quantity/edit/remove, amounts, existing10-line/duplicate/mixed-currency validation. Do not replace the cart with the prototype's one-line fixture.
6. Name then Email: one-column, persistent labels,44px targets,16px inputs, autocomplete, existing blur/submit validation; divided group with padding-top10/gap10. Keep field IDs/error links where they still mean the same thing.
7. Muted totals box: padding12/gap8/radius4; actual cart line summaries, divider, Order total. Do not place an uncommitted “pending selection” amount in the committed cart summary as if included. If the current selection price is shown, label it separately above the review as “Selected item price — not yet added.” Use existing money formatter and currency; mixed-currency failure does not present a valid payable total.
8. Price-source helper only states what public DTO data supports. Do not infer override versus base from formatted strings; use an existing reliable field if available, otherwise the honest published effective-price wording under E08. Never expose private delivery source.
9. Existing submit error/contract-outdated recovery remains adjacent to the submit action, with frozen retry identity unchanged.
10. Place Order: full ledger-width ink/white primary,44px minimum, source14px/500 label; keep actual submitting/retry labels and disabled conditions for empty cart/lock/mixed currency. Final private-link warning matches source meaning and remains visible.

Selection/card/page changes must not erase cart, customer fields or unresolved attempt identity. Preserve real HTTP payloads and handlers; only the selection widget presentation changes. Update affected tests to operate the new accessible radio/stepper controls rather than retaining dropdowns for test selectors.

## S03 — Private Order and refund

- `.order-page`: max760 including padding, centered, desktop40/32, gridgap20. Keep existing Back to catalog route action as a compact E01/E05 extension.
- Private-link notice above article: info surface,1px divider,radius4,padding12/16,gap12,wrap. Label “Private Order link” and safe explanatory prose. **Never render the capability or complete URL**, even masked tokens copied from source; current privacy tests prohibit capability text. Do not add clipboard/share controls or change fragment transport.
- Article: white border/radius4,padding28,gridgap24. Remove shadow and blanket child-border/padding styling.
- Header: kicker10px/6000.14em; real Order identity/title32/38 serif; status26px-high tag with4px corners (noninteractive, no44 target needed). Pending muted/ink; Paid/Fulfilled butter/ink; Canceled error pair; label from actual status.
- Items: heading12px uppercase0.06em, bordered item rows padding14/gap3, name14px, selection13px, quantity×unit=line total13px tabular using existing money logic. Never swap the immutable snapshot with live Product data.
- Payment: muted box,padding16,gap8; Payment reference label12/value13; Total label13/value18. Keep actual payment-next-step/status gating; no Console-only payment evidence.
- Status block: heading12 uppercase; body14/21. Preserve `PAID_STATUS_COPY`, `FULFILLED_STATUS_COPY`, canceled copy and current `paymentNextStep` conditions. No new file download or refund payout promise.
- Refund form: top divider/padding20,gap10, serif heading**20px**, body14/21, labeled textarea min-height110/padding10/12,16px editable text, current1000-character limit/counter/errors and retry state. Primary submit has fit-content width and44px target, not full-width unless mobile needs it.
- Stored refund request: same section geometry/20px heading; pending butter tag as source223; approved uses positive semantic role with explicit actual label, rejected error pair. Preserve actual “request approved, refund not issued” semantics, stored reason/newlines, timestamp and refresh-failed notices.
- Created-time footer: top divider/padding16,12px muted text. Omit synthetic fulfilled-example toggle. No separate marketing footer is added.
- Loading/missing-capability/error/contract-outdated/refresh failure preserve their existing recovery action and notice state; skeletons occupy the paper region. Do not emit private-link notice with fake data while loading.

## S04 — Explicit responsive adaptation

Desktop values above are locked. At widths below720, use the shared E04 compact inset16 and force the hero and workspace to one column. Use responsive-safe track minima (`min(100%, target-minimum)` or equivalent) so a source320px minimum never forces overflow in a smaller container. This rule overrides source auto-fit only in the compact range.

At720–1023, keep inset32. Hero may use its source auto-fit280px tracks, but keep the workspace ONE column until it has at least668px inner width (viewport732 with64px total inset); from732 onward use the source equal split. This prevents two workspace tracks at719 followed by one at720. The card grid retains240px auto-fit within its actual parent; do not assert one card per row at every intermediate width when a full-width catalog column fits more.

| Viewport | Inset / inner width | Hero | Workspace | Cards in catalog |
| --- | --- | --- | --- | --- |
| 1440 |32 /1216 (cap1280)|two592 tracks/gap32|two594 tracks/gap28|two289 cards/gap16|
| 1024 |32 /960|two464 tracks/gap32|two466 tracks/gap28|one466 card|
| 732 |32 /668|source two tracks|two320 tracks|one320 card|
| 720–731 |32 /656–667|source two tracks|one full-width track|auto-fit240 (normally two)|
| ≤719 |16 /viewport−32|one|one|one at375; auto-fit safe at wider compact widths|
| 375 |16 /343|one|one|one343 card|

Do not invent a “monotonic cards-per-row” requirement: the catalog legitimately becomes narrower when the ledger moves alongside it. The requirements are source-consistent desktop hierarchy, intentional breakpoint transitions and no clipped/overflowing content.

At375: header may wrap and grow under E02/E04, inset16; ledger/article internal padding16; long text wraps; all data/actions remain. Stack order: header → hero → live snapshot → search/filters/top pager → cards → bottom pager → ledger. Private Order: header → back → notice → article header/status → items → payment → status → refund → created footer. Match DOM order; no CSS reordering to fake the visual hierarchy.

Inspect375,719/720,731/732,1023/1024 and desktop1440; also test long option values and10 cart lines, focus scroll, keyboard/200% zoom. Do not hide overflow, clamp prose, or remove controls.

## State and evidence checklist

- [x] **S01:** loaded/default/selected catalog and two-row counts; loading; true empty; fetch-error+retry; filtered-empty+clear; >24 items and both pagers. Paired reference/production1440, production1024/375.
- [x] **S02:** simple/Variant pills; incomplete selection; price range; quantity1/99/invalid; multi-line cart, duplicate/11th-line/mixed-currency errors; Name/Email errors; submitting/lost-response retry/contract-outdated. Real HTTP checkout proof plus top/bottom ledger captures.
- [x] **S03:** real Pending/Paid/Fulfilled/Canceled Orders; multi-item immutable snapshots; eligible/not-eligible refund; reason validation/submitting/retry/conflict; pending/approved/rejected request; refresh failure. Paired R09 representative modes; missing reference states tagged E08.
- [x] **S04:** 375/1024 no page overflow; full long-content/10-line cart; responsive boundaries; keyboard options/stepper/error recovery; capability absent from rendered content/logs/network URLs; Storefront still public HTTP-only with existing isolation behavior.

Phase4 owns final capture/command execution and any test-helper migration. Preserve observable contracts and accessible labels/error references, not tests that pin incidental classes, typography, copy or native-select markup. The current tests' first-`select` query must be migrated when option pills replace dropdowns; it must never constrain the Product schema to one group.

## Numeric acceptance and removals

Non-exempt geometry must be within2CSSpx of R08/R09: header64; content1216 at1440; hero592/592 gap32; workspace594/594 gap28; card289/padding18/media96; ledger594/padding20/gap14; private Order cap760/padding28/gap24. At375 use343px content and recorded E04 adaptations. Reference typography is exact, not a nearest-old-token approximation; E02 covers editable input font/target changes only.

Remove obsolete banner/footer/editorial/featured/hero-CTA/card-initial markup; dead shadows/lifts/blur/title-rule styles; full-width four-column overrides; uniform status fill; old option-select styling once pills replace it. Preserve all operational form/cart/HTTP behavior in the new arrangement. Keep reusable existing component names where accurate, but do not keep aliases/hidden markup solely to satisfy old tests.

## Phase gate

- [x] All S01–S04 composition/state requirements implemented.
- [x] Literal tokens requested through Phase1 owner before use; no second scale.
- [x] Public Store identity retained quietly; unsupported delivery promise corrected under E08; no new backend capability.
- [x] All actual controls function; no fake preview/example navigation, placeholder control, arbitrary default selection or truncated data.
- [x] Implementation handoff lists changed accessible controls and affected meaningful tests/helpers for Phase4.
- [x] Actual runtime is the HTTP-only production Storefront, not the demo runtime.
