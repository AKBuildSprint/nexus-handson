# PR9 merged UI — final local integration

Date: 2026-09-09. Worktree: `HEAD 57e2582` merging `MERGE_HEAD af556b2`. Index `UU` files remain coordinator-owned. No stage, commit, reset, deploy, or local D1 wipe.

Mode: cook **code** against `plans/260908-1845-s3-brief-reconciliation` with the dispatch’s four named items. Phase 6 **REMOTE stays blocked**.

## Brainstorm contract (this dispatch)

- **Outcome:** Finish reachable local proof for the merged cream-paper Orders UI: per-run Playwright screenshots, typecheck/tests/builds/E2E, live 26+ multi-line matching inbox, redacted screenshots, written verdict.
- **Constraints:** Cream-paper tokens (`--color-accent` `#000000`, `--color-accent-ink` `#ffffff`). Do not overwrite historical `evidence-phase-05` / `evidence-session-3`. Do not mutate user Orders. Synthetic prefix only. Preserve deleted session briefs, `tsconfig` storefront include, untracked `ORDER_OPERATIONS_PLAN.md`, `tests/browser/__screenshots__/`.
- **Non-goals:** Deploy, remote Worker/D1, S2 deployed continuity, S4 auth, S5 money-return, plan checkbox close, git index.
- **Acceptance:** (1) E2E always writes via `testInfo.outputPath`, no `existsSync` skip. (2) Named commands green; 375/1280 Console inbox+detail show both lines; Storefront two-item cart/private; Mark Paid / Fulfill / Customer+Console refund; primary accent contrast. (3) Local S3-01 26+ matching multi-line; cursor/tie; summary equals complete set; observed counts. (4) This report. Phase 6 remote remains blocked.

## Scout (current)

Vite/React Console + Storefront, Worker + local D1 `nexus-s1-468cba-db`, `X-Nexus-Order-Contract: 2`. Servers reused: console pid 87289 `:5173`, storefront pid 87290 `:5174`. Live D1 already at migrations 0001–0007. Pre-seed multi-line Orders: **7 / 328**. After synthetic seed: **37 / 385** lines-grouped Orders.

## Changed paths (this dispatch)

| Path | Change |
|---|---|
| `tests/e2e/console-orders.spec.ts` | Screenshots always `testInfo.outputPath`; removed `existsSync` freeze and `plans/reports/evidence-session-3` writes. |
| `tests/e2e/storefront-orders.spec.ts` | `capturePage(..., testInfo, filename)` always writes to `testInfo.outputPath`; removed `PHASE5_EVIDENCE` / `existsSync`. |
| `src/console/layout/console-shell.tsx` | Deskbar `aria-label` `Focus search` → `Jump to query field` (Playwright `getByRole('button', { name: 'Search' })` matched both deskbar and Orders Search). |
| `plans/260908-1845-s3-brief-reconciliation/reports/pr-09-integration.md` | This report. |
| `plans/260908-1845-s3-brief-reconciliation/reports/evidence-pr-09/` | Fresh redacted copies of this run. |

Untouched by this dispatch: session brief deletions, `tsconfig.json`, `ORDER_OPERATIONS_PLAN.md`, `tests/browser/__screenshots__/`, `plans/.../evidence-phase-05` (13 PNGs remain), `plans/reports/evidence-session-3` (`ui-01-*.png` remain). Index still `UU` on `orders-screen.tsx`, `storefront-app.tsx`, `storefront/src/styles.css`.

## Commands

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run test:workerd` | 142/142 (29 files). Miniflare uncaught DO FK `SQLITE_CONSTRAINT` log still appears; tests pass. |
| `npm run test:browser` | 44/44 (4 files) |
| `npm run build:console` | exit 0; production import graph 25 modules |
| `VITE_STOREFRONT_API_BASE_URL=http://127.0.0.1:5173 npm run build:storefront` | exit 0 |
| `env -u CI npm run test:e2e -- --trace=off` | first 23 passed / 4 failed (`Search` strict-mode collision); after aria-label **27/27**, 49.7s. `--trace=off`. Reused existing loopback servers. |

No lint script in `package.json`.

## Screenshot capture

E2E no longer writes into plan archives. Playwright output for the passing run (also copied into `evidence-pr-09/`):

- `test-results/console-orders-keeps-Conso-a045e-y-keyboard-without-overflow-console/ui-01-console-list-1280.png`
- `test-results/console-orders-keeps-Conso-a045e-y-keyboard-without-overflow-console/ui-01-console-list-375.png`
- `test-results/storefront-orders-reaches--5979a-d-on-375px-without-overflow-storefront/ui-01-storefront-refund-375.png`
- `test-results/storefront-orders-places-o-ca380-nicalizes-a-Customer-refund-storefront/ui-02-storefront-cart-1280.png`
- `…/ui-02-storefront-cart-375.png`
- `…/ui-02-storefront-private-1280.png`
- `…/ui-02-storefront-private-375.png`
- `…/ui-02-console-inbox-1280.png`
- `…/ui-02-console-inbox-375.png`
- `…/ui-03-console-detail-1280.png`
- `…/ui-03-console-detail-375.png`
- `…/ui-02-console-fulfilled-1280.png`
- `…/ui-02-storefront-refund-1280.png`
- `…/ui-02-console-existing-refund-1280.png`

Locator `.page-stack` / `.purchase-ledger` captures are element-sized (not full 1280 viewport). `ui-01-console-list-375.png` is a tall page-stack (343×11137). Historical archives were not overwritten.

## UI inspection (actual 375 / 1280)

Live Console after `q=PR09S301` (emails redacted in-page before capture):

| Surface | Overflow | Items | Primary contrast |
|---|---|---|---|
| Inbox 1280 | 0 | 25 table rows, each `Field Notes + 1 more` | Active nav `rgb(0,0,0)` / `rgb(255,255,255)`. Search is secondary (`button`, white fill). |
| Inbox 375 | 0 | 25 `.order-summary-card` | Same nav pair. |
| Detail 1280 `NX-8F9D9C8EDB9C480D` | 0 | **2** `.order-items-table` rows (Field Notes, Eligible Simple) | `Record manual payment` `button-primary` `rgb(0,0,0)` / `rgb(255,255,255)`, enabled. |
| Detail 375 same Order | 0 | **2** `.order-items-mobile .order-summary-card` | Same primary pair. |

E2E two-product journey (redacted):

- Cart: both lines + **Place Order** ink fill / white text (`ui-02-storefront-cart-1280.png`, 375 sibling).
- Private: both lines, payment reference, total `$59.45` (`ui-02-storefront-private-1280.png` / 375).
- Mark Paid → Fulfill: both item rows, manual Bank transfer ledger, history Created/Paid/Fulfilled, **Request refund for Customer** (`ui-02-console-fulfilled-1280.png`).
- Customer refund: reason visible; form gone (`ui-02-storefront-refund-1280.png`).
- Console after Customer refund: pending refund, no Console refund form (`ui-02-console-existing-refund-1280.png`).

Live redacted shots:

- `plans/260908-1845-s3-brief-reconciliation/reports/evidence-pr-09/live-console-inbox-1280.png` — matching **28**, pending **28**, paid **0**, fulfilled **0**, open refunds **0**, Next enabled.
- `…/live-console-inbox-375.png`
- `…/live-console-detail-1280.png`
- `…/live-console-detail-375.png`

Deleted unredacted `live-console-inbox-1280-raw.png` (contained synthetic emails).

## S3-01 LOCAL live matching set

Prefix `PR09S301` (customer name `PR09S301 Seed NN`). 28 POSTs to `/api/storefront/orders` with Field Notes + Eligible Simple. No user-row updates except two synthetic `created_at` values for a page-boundary tie.

| Observation | Count |
|---|---|
| Created two-line Orders | **28** (all HTTP 201, 2 items) |
| `GET /api/console/orders?q=PR09S301&limit=25` `summary.totalOrders` | **28** |
| Unique references across pages | **28** (page1=25, page2=3, duplicates=0) |
| `summary` identical on page 1 and page 2 | yes (`pending:28`, other statuses 0, `openRefundRequests:0`) |
| All listed rows `items.length >= 2` | yes |
| `q=PR09S301&status=paid` summary | all zeros |
| `q=PR09S301&status=pending` summary | total **28**, pending **28** |
| Unfiltered live `summary.totalOrders` | **385** |
| D1 Orders with ≥2 lines (all stores/data) | **37** |

Timestamp tie (synthetic ids only): both `created_at=2026-09-08T23:06:00.451Z`. Page 1 last `NX-121D8361A016413C` (Seed 03); page 2 first `NX-413D9B5B1AA14187` (Seed 04). `id DESC` splits the tie; neither duplicated.

## Phase 6 REMOTE

**Blocked.** This Cloudflare account still lacks the exact existing `nexus-s1-468cba` Worker and `nexus-s1-468cba-db`. No deploy. No deployed/S2 Order evidence. Local restart/redeploy proof from earlier phase-6 cook is not re-claimed here.

## Review

code-reviewer **9/10**, owned deltas **PASS**. HARD-GATE-NO-SIDE-EFFECTS **PASS** for screenshot path + aria-label. Informational: no lint script; workerd FK log. Broader merge rail/deskbar in `console-shell.tsx` is coordinator-owned and excluded from this score.

## Verdict

**LOCAL GO** for the four named items. Coordinator may commit the merge with this report as proof.

**NOT GO** for S3 Phase 6 / release: remote Worker/D1 and deployed S2 continuity remain absent.

S3-01 strict live 26+ multi-line matching set is now **pass (local)**. Do not treat that as deployed acceptance.

## Remaining (coordinator)

- Stage/commit/index, including `UU` resolutions — not done here.
- Phase 6 remote protocol when exact Worker/D1 exist.
- Optional: give Orders Search an exact accessible name if deskbar labels must keep the word “search”.
- Journal not written (worker dispatch; no worker-owned finalize beyond this report).
