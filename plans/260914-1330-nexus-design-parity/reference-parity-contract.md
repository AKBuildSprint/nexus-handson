# Reference parity contract

## Outcome and authority

The user clarified on 2026-09-14: after cooking this plan, the real application must look like `design/UI-UX/Nexus Console.dc.html`, not merely share its colors and fonts. This is a presentation cutover, not a token-cleanup project. All four phases must read this contract before editing.

1. Repository security, domain, architecture, and accessibility requirements remain binding.
2. The HTML demo owns the new desktop visual target: geometry, hierarchy, typography roles, surface treatment, spacing, and component arrangement.
3. The old visual prescriptions in `docs/design-guidelines.md` must be reconciled with this target during Phase 1 before surface work. Do not silently keep its large titles, butter title rules, elevated metric tiles, 256 px rail, four-column full-width Storefront, or editorial band when they contradict the demo. Update the one canonical system; never install a second theme/token ramp.
4. Preserve real routes, HTTP contracts, permissions, live data, retry identity, durable outcomes, and complete controls. Prototype handlers and static data are NOT implementations.
5. Only exceptions E01–E09 below may differ without another explicit user decision. An executor may not add a blanket “production semantics” exception to keep an easier existing layout.

The numerical values in this planning document are extraction evidence and implementation targets, not permission to scatter CSS literals. Phase 1 maps each target to existing or new semantic tokens within the single canonical system.

## Source map and capture anchors

Source lines refer to the checked-in HTML at planning time. Locate the named section if lines move. Keep the HTML and `support.js` unchanged as the reference, record their hashes before implementation, and do not improve the reference to make a failing comparison pass.

- R01 — Sign in: HTML 24–64. Initial screen; cycle-preview link demonstrates expired/canceled/connecting states. Use the actual Google button to reach Products in the prototype only.
- R02 — Console shell: 240–285. Rail/account/nav, deskbar/search, content canvas.
- R03 — Products: 287–360. Products tab, actions, status tabs, seven-column table, footer statistics/pager. Product links open the editor.
- R04 — Product editor: 618–744. Centered scrimmed Product configuration overlay; sticky header, context strip, basics/pricing+delivery panels, full-width option groups/matrix, sticky footer.
- R05 — CSV: 362–428. Back/title, additive notice, template/upload panel at left, grouped browser preview at right.
- R06 — Orders: 430–517. Orders tab, pending-refund filter, status filters, eight-column table, footer summary/pager.
- R07 — Order detail: 519–611. Back/reference/status/actions; snapshots/payment/history left; refund/manual payment right.
- R08 — Storefront catalog and checkout: 66–160. Header; marketing hero + two-row live snapshot; catalog left and Purchase ledger right.
- R09 — Private Order: 162–236. Private-link notice, narrow ledger, items/payment/status/refund, created-time footer.
- R10 — Prototype fixtures/state: 748–1203. Useful only to establish representative visual states. Do not import these arrays or DCLogic into production.

Serve the reference over loopback HTTP using `python3 -m http.server 8766 --bind 127.0.0.1 --directory design/UI-UX` from the repository root. Open `/Nexus%20Console.dc.html`, wait for fonts and real populated rows before capturing. A transient blank row immediately after a view change is not the baseline.

## Locked desktop composition

### Shared scene

- Cream canvas `#fbf8f6`; white paper panels; muted `#f6f3f1`; separators `#eae8e6`; primary text `#1b1c1b`; secondary `#6c6a6a`; information text `#4c4546`; butter `#f1f29f`; error pair `#ffdad6` / `#93000a`.
- Borders, not floating card shadows, establish ordinary paper surfaces. Use the existing strong border role `#8a8182` for input boundaries and focus-relevant controls. Add/reuse a decorative-divider role for `#eae8e6`; do not weaken all control boundaries to decorative contrast.
- Source Serif 4 display and Inter UI only. Reference body 14/20; table content 12–14; table headings/help 11–12; compact section titles 18; CSV/title or ledger title 22; sign-in title 28/34; private Order title 32/38; Storefront hero 42/48. The old global 40/48 Console page title is not the list-screen target.
- Panel/control radius 4 px; reference status/value tags 3 px; pills/avatars 40 px. Resolve the 3 px tags through E03 rather than introducing an unrelated radius scale.
- Primary actions stay `color-accent` / `color-accent-ink`; no butter CTA. State tint does not replace a status label.
- No illustration, generated product photo, gradient, giant hero numeral, butter underline, metric-corner ornament, decorative icon badge, or new animation is added to the reference composition.

Status fill/text mapping from HTML 793–803 is also part of the target: Active/Paid/Fulfilled use butter/ink; Draft/Pending use muted/ink; Archived/Canceled use error-surface/error-ink. These are visual labels, not permission to change lifecycle rules. Additional production statuses (refund decisions, selected/disabled rows) use the closest existing semantic role with explicit text.

### Console shell and lists

- Rail 232 px, white with right divider; top Store identity block includes compact N mark, real Store identity and role; bottom contains supported Storefront link and real user/sign-out controls. Only Products and Orders destinations (E01).
- Deskbar 56 px, white, bottom divider, horizontal inset 24 px. Search is leading, max width 620 px, compact and rectangular; trailing identity/context is quiet. Do not retain the existing oversized branded deskbar as another stacked row.
- Content inset 24 px and section gap 18 px at desktop. Products/Orders headings visually behave like the demo's small raised tab, with a real accessible h1. No large serif list title and no four-up metric tiles above the list.
- Products table source widths: slug 130, status 110, type 100, price 150, variants 100, updated 150 px; name receives remaining width; source minimum table width 900 px. Headers use 10 px vertical / 12 px horizontal padding (16 px at outer edge); body approximately 14 px vertical. See E02/E04 for increased hit areas and intermediate reflow.
- Orders source minimum 1040 px: Order 96, Customer 150, Email 170, Total 100, Payment ref 110, Status 130, Created 120 px; Items flexible. Source body padding 12 px. No invisible clipping; a local horizontal table region is allowed at intermediate desktop widths (E04).
- Metrics move to compact inline text at the bottom of the paper table. Preserve complete catalog/server-filtered summary semantics; do not reuse prototype page-only totals. Top and bottom real pagination remain (E05), integrated with the top filter row and bottom statistics row rather than separate elevated cards.

### Product editor

- Entire Product editor becomes the demo-style centered overlay on a real Console/list backdrop, not a 480 px side drawer or a bare full-page form. Desktop scrim inset/padding 24 px; panel max width 1280 px; internal scrolling; muted panel background; sticky white header 56 px and footer minimum 60 px.
- Maintain existing `/console/products/new` and `/console/products/:slug` routes. Direct navigation/reload must render the same editor shell and a safe real backdrop; list not yet loaded means its legitimate loading/empty surface, never fabricated rows. Browser Back/Forward retain the route and dirty-navigation guarantees.
- Reference body uses `repeat(auto-fit,minmax(360px,1fr))`, padding 20 px, gap 16 px. At 1440 the capped panel can fit THREE tracks: basics and pricing/delivery occupy the first two, and the remaining track is empty before the full-span groups/matrix. Do not silently stretch the first two cards to 50/50; capture and match the actual reference geometry, not a guessed “two-column editor.” At 1024 it resolves to two tracks; mobile explicitly stacks.
- Basics order: slug/status pair, name, public description. Pricing/delivery order: base price/currency pair, currency helper, divider, private delivery title/instructions/file summary. Option groups and Variant matrix span all tracks.
- Keep the 480 px focused Variant editor as a distinct child dialog for row/delivery override. It does not replace the Product configuration overlay. Nested-dialog focus and dirty guards must work in stack order (E06).
- The prototype's Storefront preview strip is not a working feature. Use the narrow Console context strip; omit the dead preview pseudo-tab under E07. Do not build a preview feature or display an inert control.

### Storefront

- White 64 px header, inset 32 px; small Nexus serif wordmark and uppercase Storefront label; compact supported navigation at right. No announcement banner or editorial ink band.
- Main max width 1280 px including inset, padding 40 px vertically / 32 px horizontally, gap 28 px. Hero has equal auto-fit tracks (minimum 280 px), 32 px gap, bottom divider and 24 px bottom padding.
- Source marketing heading is “Digital products, delivered the moment you pay.”; retain its 42/48 serif treatment and position, but use the truthful E08 copy “Digital products, with every purchase in one private Order.” The existing paid/fulfilled page explicitly does not deliver files. Supporting paragraph ends “the only way back to this Order”, not “your files”. Do not retain an oversized dynamic Store-name hero/Explore Catalog CTA; real Store identity stays quiet in chrome.
- Hero snapshot is a bordered white panel with TWO inline label/value rows: Published Products and Simple / Variant. Derive from the public catalog, never literal `3` or `1 / 2`.
- Below hero: two equal tracks, minimum 320 px, 28 px gap. Left: pill search + result count, then cards; right: Purchase ledger. Card grid minimum 240 px / gap 16 px gives two cards across within the left half at 1440. It is NOT a full-width four-column grid followed by checkout below.
- Cards: 18 px padding, 10 px gap, empty muted 96 px media well, 19/25 serif name, 13/19 description, divided price/action footer. Remove decorative initials/cover treatments not present in the demo; do not remove real catalog information. Selected card border is visibly stronger; selection text remains accessible.
- Ledger: 20 px padding, 14 px gap, compact kicker/title/description, options, quantity, customer fields, muted totals box, full-width Place Order, private-link warning. Multi-line cart stays within this same ledger below selection controls (E05), not another page-wide dashboard block.
- Private Order max width 760 px including page inset; padding 40/32; private-link notice first, then white bordered article padded 28 px with 24 px section gap. Items, payment summary, status/delivery, conditional refund section and created-time footer preserve the demo order. No demo Order switcher (E07).

## Closed exception register

Every screenshot difference must reference one of these IDs and its affected region. These are narrowly scoped, not permission to redesign the page.

- **E01 — Supported identity/navigation.** Only Products and Orders Console destinations. Import stays a Products action; pending refunds stay an Orders filter. Use real provisioned identity and existing role restrictions. Omit global My Order/Back to Console links if the real public/private route contract cannot safely provide them; no fabricated current Order or user. Keep the reference rail/header geometry despite fewer controls.
- **E02 — Accessible controls.** Every interactive target remains at least 44×44 px and editable inputs at least 16 px text. Source buttons at 28–38 px cannot all be literal copies. Keep compact label/padding/hierarchy but allocate nonoverlapping 44 px targets; allow only the resulting local height differences. Visible labels, keyboard focus, disabled reasons and error association replace prototype spans/noops. Native radio inputs with styled pill labels and real minus/plus buttons around the existing numeric field are required where the demo uses option pills/steppers; accessibility does not justify preserving unrelated dropdown presentation. Never reduce target safety for a screenshot score.
- **E03 — Existing semantic safeguards.** Keep `color-accent` black and `color-accent-ink` white rather than introducing another action pair. Keep 4 px status-tag corners within the canonical radius system instead of the source 3 px. Keep strong required control boundaries and full-text wrapping; status fills follow the explicit reference mapping above, not arbitrary legacy colors. Decorative dividers may use source pale gray. Material Symbols remain the sole icon family where an icon is needed; do not add icons merely because the old UI used them.
- **E04 — Responsive safety.** Desktop visual master is 1440×900. At 1024×900 preserve the 232/56 shell; local table scroll is allowed but page scroll/clipped actions are not. At 375×812 use the existing compact shell/menu, 16 px canvas inset, summary cards, one-column Storefront, and full-width editor/drawer. Also inspect 719/720 and 1023/1024 boundaries. Adapt literal min-width grids instead of reproducing the source overflow (Products reference measured 623 px page width at 375). This exception does not justify changing desktop layout.
- **E05 — Real data and retained operations.** Preserve live metrics, complete catalog, Product page size 25, Storefront page size 24, server cursor Orders page size 25, top/bottom pagers, real search/filter behavior, multi-line cart, currency precision, totals, frozen retries and private capabilities. Surface these as compact extensions at their specified region. No mock metrics, USD-only formatting, missing status filters, hidden cart or broken pagination to imitate a fixture.
- **E06 — Real editor/state lifecycle.** Save persists and leaves a durable Saved state in the open editor; it does not just close like the demo. Dirty dismissal asks Stay/Discard, canceled dismissal preserves edits, focus returns correctly. Variant delivery drawer, file validation and regeneration confirmation remain complete. No new backend or workflow feature is implied by the presentation overlay.
- **E07 — Prototype-only controls/copy.** Remove cycle-preview links, fixture identity/data, fake shortcut hint, dead Storefront preview tab, synthetic fulfilled-example toggle, and static Contract v2 decoration unless already meaningful real context. Do not implement a new preview/shortcut/provisioning feature. Preserve the surrounding spacing/grouping without empty interactive placeholders. Brand remains Nexus.
- **E08 — Missing states and truthful behavior copy.** Existing loading, empty, error, validation, forbidden, saving, saved, retry, conflict, refund/assignment states use the nearest matching paper/table/notice composition; real labels/statuses win over demo wording (including Fulfill versus the current completion command). Current Storefront paid/fulfilled copy explicitly denies file delivery: replace the demo's immediate-file-delivery marketing claim with the concrete Order wording above, retaining its font/geometry. This is not permission to rewrite unrelated copy or hide a state.
- **E09 — Fixture comparison safety.** Reference fixture data may include Draft/Archived catalog cards, synthetic payment evidence and arbitrary names. Production fixtures must use legitimate API/domain setup; public catalog shows only actually published eligible data. Never render a complete private capability URL or token in the notice/body; safe prose replaces source link decoration. Document changed text/status/count regions, compare structural bounding boxes, and never change visibility/security rules to make full-page screenshots identical.

## Fidelity pass/fail

“Same design language” alone is a failure. The following all have to pass:

- All R01–R09 screens have paired reference/production evidence at 1440; all production screens have 1024 and 375 evidence; representative responsive reference captures explain E04.
- Shared major anchors (rail, deskbar, main inset, panel width, column split, card/media well, editor/header/footer) match the locked dimensions within 2 CSS px when not covered by a specific exception. Text antialiasing differences are not layout errors.
- Font family/weight, surface/divider tokens, heading hierarchy, card ordering, top versus bottom metric placement, and editor overlay composition match. One missing section or old major layout is blocking regardless of a low aggregate pixel difference.
- Region overlays or side-by-side captures are inspected at 100% scale. Record measured geometry and every allowed difference; a screenshot file alone is not a pass.
- All applicable state and regression checks in Phase 4 pass. No stale baseline is overwritten until the observed change is attributed to this contract.
- No screenshot/report claims production deployment. This plan is local implementation and verification only.
