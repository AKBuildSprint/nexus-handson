---
title: "Phase 4: Measured Demo Parity and Production Verification"
status: todo
---

# Phase 4: Measured Demo Parity and Production Verification

## Objective

Prove that cooking produced the HTML demo's composition in the actual application and did not break its operational behavior. A green build, a token audit or a single screenshot is insufficient. Read [reference-parity-contract.md](./reference-parity-contract.md) and all three implementation phases first.

Dependencies: Phases 1–3 complete. One integration owner runs final commands and resolves cross-surface failures. This phase does not authorize deployment.

## Files and artifacts

- Correct application/token/guideline files only for observed parity or behavioral defects.
- Update existing `tests/browser/` and `tests/e2e/` cases/helpers only where changed markup/semantics affects meaningful behavior coverage. Keep observable behavior assertions; remove/rewrite implementation-only selectors or wording pins instead of restoring old DOM solely for tests.
- Use `tests/support/console-auth-fixtures.ts` and existing E2E setup for real local authenticated flows. Never add production fixture imports or bypass authentication in production code.
- Retain review evidence under this plan's `evidence/` directory during cook: `reference/`, `production/`, `comparisons/`, plus `verification.md` and `geometry.json`. These are requested plan acceptance artifacts, not production source. Do not commit credentials, customer data or reusable private capabilities in them.
- Do not retain temporary capture scripts or new generic screenshot infrastructure unless they defend an actual continuing regression contract. The screenshot/output artifacts themselves remain available for review.

## V01 — Environment and evidence discipline

1. Run all commands from the repository root on Node 22. Install with `npm ci` only if dependencies require installation.
2. Reference server: `python3 -m http.server 8766 --bind 127.0.0.1 --directory design/UI-UX`; open `/Nexus%20Console.dc.html`. Use the recorded P01 hashes; if files changed, investigate and refresh the source map before accepting any comparison.
3. Production surfaces must be `ProductionConsoleApp` and the real Storefront entrypoint, not only `ConsoleApp` development scenarios. Use loopback Console/API and Storefront origins on distinct ports.
4. For existing E2E commands, allow `playwright.config.ts` to own local migrations, isolated auth secrets, test Store/Owner/Staff setup and dev servers. Its `reuseExistingServer: false` means ordinary dev servers occupying 5173/5174 must be stopped or different loopback ports explicitly configured. Do not point these tests at a user's live dev database/server.
5. Preferred capture path: use a disposable `tests/e2e/console-design-parity-capture.spec.ts` importing the existing `test`/`expect` from `tests/support/console-auth-fixtures.ts`, run with `npm run test:e2e -- tests/e2e/console-design-parity-capture.spec.ts --project=console`, and open Storefront in a separate unauthenticated browser context. The existing Playwright lifecycle then owns isolated servers/fixtures. Save screenshots explicitly into this plan's evidence directory, not disposable test output. Remove the capture spec after retaining proof; it is not a new permanent test suite.
   - Manual-server alternative is allowed ONLY with the full `playwright.config.ts` isolation environment reproduced: `NEXUS_TEST_WORKER_ISOLATION=true`, `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`, `CLOUDFLARE_INCLUDE_PROCESS_ENV=false`, distinct loopback `PLAYWRIGHT_API_CONSOLE_BASE_URL`/`PLAYWRIGHT_STOREFRONT_BASE_URL`, one isolated `NEXUS_TEST_PERSIST_ROOT`, matching generated `NEXUS_TEST_AUTH_SECRET`/`BETTER_AUTH_SECRET`, local Google client placeholders, and fixture-required `NEXUS_TEST_OWNER_EMAIL`/`NEXUS_TEST_STAFF_EMAIL`. Storefront gets `VITE_STOREFRONT_API_BASE_URL` set to that API origin. Keep generated secrets ephemeral and out of artifacts.
   - Only after that setup, use root scripts `npm run dev:console -- --host 127.0.0.1 --port 5173` / `npm run dev:storefront -- --host 127.0.0.1 --port 5174` under supervised readiness checks. Ordinary dev commands plus a persistence root are NOT sufficient isolation: without the flag, `.dev.vars` remains authoritative and fixture cookies may be invalid.
6. Use existing fixture-backed browser/scenario harnesses for otherwise unreachable error/threshold states, clearly tagged `scenario`. Use real API-backed flows for ordinary navigation, save, CSV import, order creation, payment/completion, refund and assignment. Scenario evidence cannot stand in for authenticated runtime proof.
7. Wait for `document.fonts.ready`, loaded rows/cards, stable selected state and network completion. Keep the same browser engine, device scale factor, zoom, viewport, font-loading conditions and scroll position for a pair. Record all of these; capture before hover/focus unless that is the named state.

Default captures: 1440×900 desktop; 1024×900 intermediate; 375×812 mobile. Also inspect responsive transition boundaries 719/720 and 1023/1024, long-content wrapping and 200% zoom. At 375, check the actual visual viewport and sticky footer while focused inputs are scrolled into view; desktop viewport emulation alone does not prove native keyboard behavior, so name that limitation if no mobile device is available.

## V02 — Required screenshot matrix

Each ID has baseline and state evidence. At least one populated production capture for every C/S ID is required at 1440, 1024 and 375, except C01 uses signed-out instead of populated. Capture paired desktop R01–R09 reference screens for every available corresponding view. Unavailable reference states are explicitly recorded as E08, never fabricated.

| ID | Reference | Required view / landmarks | Additional state captures |
| --- | --- | --- | --- |
| C01 | R01 | Sign-in card/mark/title/button/access help | Expired, canceled/error, connecting; real network failure recovery |
| C02 | R02/R03 | Rail/deskbar, Products tab, actions/filters, table and footer metrics/pagers | Loaded, search/status filtered, catalog-empty, filtered-empty, load-error, loading |
| C03 | R04 | Product overlay at top and bottom, basics/pricing tracks, full-span groups/matrix, sticky controls | New, simple, Variant, dirty, invalid submit, saving, saved, save-error, dirty close confirmation |
| C04 | R04 + E06/E08 | Variant matrix, meter, regeneration preview, focused child drawer | Default/override, retained/new/will-disable, errors, file states, warning/blocked thresholds |
| C05 | R05 | CSV back/title/notice; template/source left, grouped preview/results right | Default, parsing, ready, warning confirmation, rejected/file error, importing, partial result, completed, uncertain result/retry |
| C06 | R06 | Orders tab/filter/status row, table and footer summary/pagers | Each status filter, pending-refund filter, loading/error/empty, later cursor page and emptied-page recovery |
| C07 | R07 | Detail header, snapshot/items/payment/history, refund/manual payment/assignment region | Pending, Paid, Fulfilled, Canceled; refund pending/approved/rejected; pending/failure/retry/stale commands |
| C08 | R01/R02 + E01/E04/E08 | Staff read-only Products, assigned Orders, compact menu, recovery notices | Owner→Staff identity change, session expiration, forbidden/missing detail, long identity/content |
| S01 | R08 | Header, exact marketing hero, two-row live snapshot, left search/cards, right ledger | Loading, populated, filtered, no results, empty catalog, catalog-error, >24 rows |
| S02 | R08 + E05 | Selected card, option controls, quantity, customer form, cart lines, totals, Place Order | Simple/Variant, base/override price, multiple lines, invalid fields, mixed-currency rejection, submitting, failed/frozen retry |
| S03 | R09 | Private-link notice + narrow paper article, items/payment/status/refund/created footer | Pending/Paid/Fulfilled/Canceled; refund form/submitting/pending/approved/rejected/failure; multi-item Order |
| S04 | R08/R09 + E04/E08 | One-column catalog/ledger and narrow private Order with all actions reachable | Long names/reasons/capability display, missing/invalid link, load/reload error, lost-response retry, pagination continuity |

Naming: `<id>-<state>-<width>x<height>-<reference|production>.png`; multi-scroll views append `-top`, `-matrix`, `-bottom`. In `verification.md`, record the exact URL/route pattern (redact capabilities), fixture/scenario identity, steps, screenshot paths, result and exception IDs. Do not mark a screen passed while any required state is unexamined.

## V03 — Geometric comparison, not subjective similarity

Record `getBoundingClientRect()` and computed styles for the following landmarks. Values are CSS px and reference-token colors; all values must be interpreted with the E02 target/height and E04 mobile exceptions.

- Shell: 232 rail width, 56 desktop deskbar height, 24 content inset, 18 section gap; white rail/header and pale dividers. Large serif list titles and top metric tiles must be absent.
- Lists: tab heading placement, top action alignment, source column ordering, table white paper frame, footer inline statistics, top/bottom pagination regions. Metrics must not become extra cards. At 1024 only the table's own region may scroll horizontally.
- Sign-in: 380 maximum card width, 28 inner padding, 18 gap, Source Serif 28/34 title; no extra login methods, fake preview link or dashed G placeholder in the real UI.
- Editor: centered 1280 cap with 24 outer inset; sticky white header/footer; internal scroll; 20 body inset and 16 gaps; source auto-fit 360 minimum yielding three tracks at 1440 with two top cards before full-span groups/matrix. Real functional fields may grow vertically under E02; that does not permit a full-page editor or 480-wide parent.
- CSV/Order detail: 16 gap between reference split tracks, 20 section padding, compact section titles and durable result placement.
- Storefront: header 64; main cap1280; inset40/32; hero42/48 and equal hero tracks/gap32; two-row snapshot; body equal split/gap28; left card grid gap16, padding18, media96; ledger padding20. No editorial band, banner, full-width four-up grid or checkout below a full-width catalog.
- Private Order: cap760, page40/32, article28, sectiongap24; notice before article; conditional refund before created footer.

For non-exempt anchors, error must be ≤2 CSS px. Match fonts, weights, line heights, surface colors and structural ordering exactly to the reference-derived tokens; document only deliberate E03 differences. Content-dependent heights and line wraps require equivalent fixture text or a recorded E05/E09 explanation, not an arbitrary tolerance.

Inspect paired images at 100% scale and use a 50% opacity overlay or equivalent side-by-side crop for critical regions. A whole-image pixel-difference threshold is NOT the acceptance gate: text/data may differ legitimately while a wrong layout can have a misleadingly small aggregate difference. Do not mask structural regions to improve a score.

Every discrepancy gets: ID, reference region, measured actual/target, severity, correction or E-ID, and post-correction evidence. Major mismatch (wrong parent layout, missing column/panel, old hero/title/metrics, clipped primary action) blocks completion regardless of test results. Unregistered differences must be fixed, not added to E01–E09 by the executor.

## V04 — Interaction and state acceptance

### Console editor and Variant boundaries

- Opening from list, new route, direct edit URL, reload and Browser Back/Forward all display the same real editor overlay. Backdrop cannot take focus; closing returns to the trigger or appropriate Products heading for direct-entry cases.
- Dirty Close/Escape/Back requests Stay/Discard. Stay retains all values; Discard exits/restores persisted state as appropriate. Save calls the existing persistence path; success stays open with durable Saved evidence. Save failure retains edits and file selection as supported.
- Nested Variant drawer traps only its own focus, returns focus into the Product editor, and its dirty confirmation is above that drawer. Escape must not close both layers; ensure dialogs are not rendered under an inert ancestor.
- Real generated schema checks: 0, 10, 12 (3×4), 30 (5×6) and 35 (5×7), matching existing `console-variants.spec.ts`. At 12/30 confirmation is required; at 35 generation is blocked. Do NOT change max10 values/group just to create prime counts11/31 through the UI. Exact11/31 boundary copy can be checked through existing component/scenario fixtures and must be labeled scenario-only.
- Full regeneration proof: edit saved schema, inspect Retained/New/Will disable before commit; validate editable SKU/price and complete inherited/override delivery semantics. Default/override files cover no file, selected, validating, valid, invalid bytes/type, oversize, replacement and failed save/upload.

### CSV

- Fixed UTF-8/header/1 MB/500-row rules survive; filename/size and additive notice visible before submit.
- Browser groups derive Simple/Variant shape and provisional Ready/Duplicate candidate/Rejected labels; 11–30 confirmation is tied to affected groups. Real processing shows progress without erasing preview.
- Server Added/Duplicate/Rejected outcomes replace provisional authority, not the other way round. Partial row result and complete success remain readable; row numbers/reasons stay associated.
- Network uncertainty/committed malformed result must preserve existing recovery behavior; no new dangerous re-POST button introduced by styling. File-level failure retains choose/retry paths appropriate to the actual command state.

### Lists, Orders and role-aware operations

- Product metrics derive from all loaded rows; search/filter/pagination does not turn them into current-page counts. Orders summaries come from the server for active filters; no page-only revenue or fabricated tab counts.
- Products25 and Storefront24 top/bottom pagers expose correct range and boundaries. Orders cursor25 remains recoverable if a page is emptied while server matches remain. Preserve previous/first recovery and current filter/selection state.
- At719↔720 resize, entered Product/Order search remains visible, focused when appropriate, and preserves draft/committed criteria without accidental submission or reset. Confirm it is not still portaled into a hidden deskbar.
- Pending/Paid/Fulfilled/Canceled statuses expose only existing permitted actions. A refund request is not a refund completion; approval/rejection/history/assignment and manual-payment evidence follow existing command semantics. No customer exposure of private payment evidence.
- Owner/Staff role guards remain effective through navigation, identity swap, stale responses and reload. CSS hidden controls do not replace authorization; no private fetch begins before authentication permits it.

### Storefront and private Order

- Selecting another Product/option updates real selection and price but does not silently erase existing cart or customer input. Add/remove/update cart lines, total, line limits and mixed-currency prevention remain visible inside the ledger.
- Exercise multiple real option groups through the styled radio pills (keyboard arrows/Space and pointer), then quantity minus/plus and manual input at1/99, invalid and intermediate values. All groups remain independently selectable; old first-`select` tests must not restrict the UI to one group or keep dropdown presentation.
- Pagination preserves selected Product/options/customer fields/cart/frozen retry identity; bottom pager brings catalog results into view.
- Checkout uses existing HTTP payload and server authority. Failure retains recoverable context; retry uses the frozen identity. Successful creation retains the private-link contract through reload; no new query/cookie/global My Order mechanism.
- Private Order loading, invalid/missing capability, request error/retry, status-specific payment/delivery and refund states retain correct visibility. Refund reason/limits/errors/durable result remain accessible, and a lost-response retry does not create another request.

### Global keyboard, width and visual states

- Verify default/hover/focus/pressed/disabled/loading/selected for representative buttons, fields, filter controls, card actions, pagination, file inputs and dialog actions.
- Check skip link, heading/landmark hierarchy, tab order, Enter/Space activation, Escape, error-summary focus and linked field errors, focus restoration, live announcements, reduced motion and visible disabled reasons.
- Measure ≥44×44 targets and 16 px input text. Interactive hit areas do not overlap adjacent controls. At 375, primary action rectangles are within the visual viewport after normal scroll and never obscured by sticky elements.
- Measure `document.documentElement.scrollWidth <= clientWidth` and `document.body.scrollWidth <= clientWidth`; inspect descendant/control geometry too. No `overflow-x:hidden`, clipping, ellipsis or removed data may be used to hide a failure.
- Check long Unicode names, slugs, currency strings, option labels, payment references, refund reasons and file names across all surfaces. Keep complete text.
- Computed primary fill/text must resolve to `color-accent`/`color-accent-ink` across Console and Storefront, including loading and disabled variants as specified by canonical primitives.

## V05 — Existing regression commands

Run these from the repository root after both surface phases settle. Do not run separate duplicate full suites on each worker. The Console build already invokes typecheck and the production import graph assertion.

```sh
npm run build:console
npm run build:storefront
npm run test:browser
npm run test:e2e
```

`package.json` confirms these script names. `test:e2e` owns both Console and Storefront projects under `playwright.config.ts`; it uses isolated local Worker/auth setup and distinct origins. No deploy or remote smoke command belongs in this plan.

Relevant existing suites to preserve:

- Browser: `product-phase4-contracts.test.ts`, `csv-parser-browser.test.ts`, `console-orders-contracts.test.ts`, `console-auth-contracts.test.ts`, `console-role-actions-contracts.test.ts`, `storefront-orders-contracts.test.ts`.
- E2E: `console-products.spec.ts`, `console-variants.spec.ts`, `console-import.spec.ts`, `console-orders.spec.ts`, `console-auth.spec.ts`, `console-reload-recovery.spec.ts`, `storefront-orders.spec.ts`.

Presentation changes affect `.metric-value`, `.mobile-save-bar`, `button.desktop-save`, `.catalog-row`, first-`form`/first-`select` queries, native-confirm mocks and structural table queries. Migrate affected meaningful tests/helpers to the real accessible surface, including the one sticky Save footer, Stay/Discard guard and option radio groups. Delete incidental exact-wording/API/DOM assertions rather than re-pin them. Do not preserve duplicate invisible controls/classes solely for tests or delete tests defending real state/privacy contracts. Retain new regression cases only for genuinely risky behavior (nested Escape/focus, responsive search host, direct-entry restoration); use disposable code for simple visual measurements.

On failure: record command/output, identify source versus fixture/selector issue, fix the actual defect, rerun the failed suite and impacted surface capture. Do not rewrite an expected screenshot to bless an unreviewed difference. Final verification reports exactly which commands/scenarios ran and any limitation; an unrun required gate remains pending.

## V06 — Final proof and cleanup

Only after runtime parity and behavior pass:

1. Retain paired captures, geometry, source hashes, exception ledger and command results in the evidence bundle. `playwright.config.ts` currently disables automatic screenshots and uses `preserveOutput: never`; explicit final evidence cannot depend on its disposable `test-results` directory.
2. Remove throwaway capture scripts, fixture experiments and obsolete presentation code. Do not delete the original reference or the final proof artifacts.
3. Reconcile canonical guidelines/token comments with the implemented result. Remove retired alternate styles and unused helpers; no compatibility theme or mock surface remains.
4. Inspect the final runtime at1440 and375 after cleanup, including primary colors and overflow, to ensure cleanup did not remove required controls/assets.
5. Update each phase checklist only for verified work, and add the evidence paths/results to `plan.md`. Keep local test data/capabilities out of shared screenshots; redact those text regions and declare the redaction without obscuring layout.

## Completion gate

- [ ] V01 isolated real runtime and stable reference established.
- [ ] V02 all R/C/S screenshot/state coverage complete.
- [ ] V03 measured anchor parity and regional visual review pass.
- [ ] V04 applicable production interaction/accessibility/privacy checks pass.
- [ ] V05 actual build/browser/E2E results are recorded and green.
- [ ] V06 clean implementation and retained evidence handed off.

Required final statement names: implemented screens, remaining E-ID deviations, evidence location, commands actually run, and any runtime limitation. Never conclude only “looks consistent” or “same Nexus visual language.” The acceptance question is: **does the real app now reproduce the demo's composition, except for the explicitly necessary and measured adaptations?**
