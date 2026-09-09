# Phase 6 cook evidence

Mode: code (existing phase path). No remote mutation, no plan index/stage/commit, no later phase.

## Brainstorm contract (reused)

- Outcome: prove S3 on the current contract, including local restart same-key replay; document canonical Order scope; fill this matrix honestly.
- Constraints: no remote deploy without separate authorization; preserve deleted session-1..6-brief.md, tsconfig `storefront/src`, untracked `ORDER_OPERATIONS_PLAN.md`; Playwright loopback-only; anonymous bootstrap demo is not real auth.
- Non-goals: S4 identity, S5 automation/money-return, S6 receipts/MCP, plan checkbox sync, git commit.

## Scout

Vite/React Console + Storefront, Worker D1/R2, `X-Nexus-Order-Contract: 2`. Phases 1–5 already on `HEAD`. Playwright rejects non-loopback origins. `remote-contract-smoke.ts` remains S1 catalog. `docs/design-guidelines.md` is S1 catalog freeze (Orders excluded) — not edited.

## Owned files

- `README.md` — canonical lifecycle, two references, pending-only refunds, `legacy_unrecorded`, anonymous demo, 0006/0007 quiescence, S1 ledger is not S3 proof, private capability 404 before contract-2 409.
- `tests/integration/order-commands.test.ts` — Cancel D1-failure case now sends contract 2 + Idempotency-Key so lookup throw still yields sanitized 500 (unmarked POST correctly 409s first).

Not owned / preserved: session brief deletions, `tsconfig.json`, `ORDER_OPERATIONS_PLAN.md`, untracked `tests/browser/__screenshots__/`.

## Checks (local)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run test:workerd` | 142/142 after test migration. Miniflare uncaught FK log still appears; tests pass. First run 141/142 on unmarked Cancel 409. |
| `npm run test:browser` | 44/44 |
| `npm run build:console` | exit 0, production import graph clean (25 modules) |
| `VITE_STOREFRONT_API_BASE_URL=http://127.0.0.1:5173 npm run build:storefront` | exit 0 |
| `env -u CI npm run test:e2e -- --trace=off` | 27/27, 43.7s. Reused console pid 87289 `:5173`, storefront pid 87290 `:5174`. Not killed. |

No lint script. No changelog in repo.

## Local D1 inventory (aggregates only)

Already at 0001–0007. No pre-0006 snapshot this session (applied in earlier phases). After synthetic Order + e2e, later counts moved; first inventory before synthetic create:

- orders 299: pending 108, paid 160, fulfilled 6, canceled 25
- payments 90, refunds 69, history 565, commands 266, lines 305

Later aggregates (post-restart, pre-e2e extras): paid_or_fulfilled 167, succeeded payments 91, `legacy_unrecorded` 76, multi-line Orders 6. History contract_version 1/2 both present (257 / 314 at that query). All orders had `payment_reference`.

## Restart / same-key replay (local)

Supervised hub stop/start. `.wrangler` not deleted.

Synthetic fulfilled Order `NX-E8C7C631A743479A` (no capability/PII in this file):

- before: history 4, payments 1, refunds 1, commands 3; paid_at / fulfilled_at / refund_at `2026-09-08T22:32:49.433Z` / `.439Z` / `.448Z`
- after restart: private GET 200 fulfilled + refund present; same-key create/pay/fulfill/refund returned original times and payment id
- graph counts unchanged
- unused Cancel/refund keys without contract 2: 409 `client_contract_outdated`
- `/complete` 404 `route_not_found`
- contract-2 Cancel on fulfilled: 409 `order_state_conflict`

## Live inbox (local)

`GET /api/console/orders?limit=25` with contract 2: summary.totalOrders 300, 12 pages, 300 unique references, summary equals paged set. status=paid zeros other status counts. q=exact synthetic reference: 1 hit.

Limitation: live multi-line Orders were 6, not 26+. S3-01 26+/tie remains `tests/integration/order-operations-routes.test.ts`.

## Screenshot side effect

Phase 6 e2e rewrote 11 tracked `reports/evidence-phase-05/ui-02*` and `ui-03*` files. Restored with `git checkout --` that directory.

Untracked preexisting files overwritten, unrestorable:

- `plans/reports/evidence-session-3/ui-01-console-list-1280.png` — `tests/e2e/console-orders.spec.ts`
- `plans/reports/evidence-session-3/ui-01-console-list-375.png` — `tests/e2e/console-orders.spec.ts`
- `plans/reports/evidence-session-3/ui-01-storefront-refund-375.png` — `tests/e2e/storefront-orders.spec.ts`

Provenance: untracked (not in git index). Not gitignored. Historical session-3 evidence, not a Phase 6 output directory.

Recovery inspected only: `test-results/` (no png), `playwright-report/` (no png), `.vitest-attachments/` (hashed Vitest browser attachments, not these three names). No restore source.

Follow-up: e2e screenshot writes now skip when the destination file already exists (`existsSync` freeze) so later suites cannot clobber ui-01/ui-02/ui-03.

## Acceptance rows

| ID | Local | Deployed | Notes |
|---|---|---|---|
| S3-01 | partial | blocked | Live 300-page agreement; not 26+ multi-line matches (live 6; integration 30 Orders / 2 multi-line) |
| S3-02 | pass (integration + Console e2e search) | blocked | |
| S3-03 | pass* | blocked | Two-product e2e + 6 live multi-line; no deployed pre-existing S2 Order |
| S3-04 | pass | blocked | Synthetic + e2e Mark Paid |
| S3-05 | pass | blocked | Paid→Fulfill, Cancel, invalid direct 409 |
| S3-06 | pass (integration) | blocked | |
| S3-07 | pass local restart | blocked redeploy | Same v2 keys after hub restart |
| S3-08 | pass (e2e Customer refund) | blocked | |
| S3-09 | pass (phase 5/integration) | blocked | |
| S3-10 | pass | blocked | |
| S3-11 | pass (integration) | blocked | |
| S3-12 | pass (new writes bootstrap/storefront) | blocked | |
| S3-13 | pass (copy/request pending) | blocked | S5 handoff in README |
| C-S2 | pass local | blocked | Two-product e2e |
| C-S1 | pass (catalog e2e in 27) | blocked | |
| C-OLD | pass aggregates | blocked | 76 legacy_unrecorded; no fake payments |
| C-S4 | pass docs | n/a | Anonymous exception documented |
| C-S5 | pass docs/ledger | n/a | No auto-return for legacy_unrecorded |
| C-S6 | pass two builds | blocked independent deploy | |
| C-WIRE | pass local | blocked | contract2 + /complete 404 |

## Review

code-reviewer **7/10**. Owned README/test: GO, no code defect. Phase 6 acceptance: **NO-GO** without deployed/S2 evidence or named exception. HARD-GATE-NO-SIDE-EFFECTS: **FAIL** on unrestorable untracked `ui-01-*.png` overwrite. S4/release: **NO-GO**.

Critical (gates, not code): (1) untracked session-3 ui-01 screenshots overwritten; (2) Worker/D1 absent on this Cloudflare account.

Warnings: S3-01 strict multi-line fixture partial; README now links C8/acceptance; workerd Miniflare FK uncaught log; no lint script.

## Remaining

- Coordinator: do not close Phase 6 or claim deployed acceptance. Remote/S2 evidence not waived. Plan tasks left unclosed. No S4.
- Journal not written (worker dispatch: no worker-owned finalize).
