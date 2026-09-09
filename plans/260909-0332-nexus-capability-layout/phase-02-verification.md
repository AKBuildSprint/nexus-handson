---
phase: 2
title: "Verification, guidance and PR delivery"
priority: P1
dependencies: [1]
---

# Verification, guidance and PR delivery

## Goal
Prove the refactor runs, document ownership, and deliver reviewed PR without merge.

## Files and steps
1. Under Node 22 run root local D1 migration command in the isolated worktree, then launch actual Console+Worker and Storefront on free loopback ports via managed processes. Prefer the default 127.0.0.1:5174 Storefront origin; if occupied, use a matching ignored local Worker STOREFRONT_ORIGIN override alongside PLAYWRIGHT_* origins and VITE_STOREFRONT_API_BASE_URL, then remove the local override after verification. Never change tracked default vars for smoke tests. Exercise API JSON 404 versus SPA fallback, public catalog and Storefront origin CORS, UI loading and an order flow through existing Playwright e2e. Keep D1 state local; never invoke remote fixture mutation or deploy production resources for verification.
2. Confirm Console/Storefront at 375px have no horizontal scroll and primary actions preserve accent fill/ink. No CSS visual changes intended. Verify built preview/Worker asset paths and run Wrangler dry-run; root deployment flags still forward identically.
3. Update current README, docs/design-guidelines paths, root AGENTS/CLAUDE and scoped AGENTS in the three apps, two packages, tests and migrations only (user-approved outline). Use one canonical rule source and linked CLAUDE, no duplicated scales. Explain ownership and tests by risk in README; scoped guidance contains actionable local invariants, not inventories. Historical plans/journals/briefs remain unchanged. List real commands with correct cwd. Migrations guidance explicitly forbids editing applied SQL. Review all new relative docs links.
4. Local pending-change review; fix Critical/Important findings, rerun affected evidence. Finalize plan files before commit; create PR through ak:ship official. Review/fix/reply with ak:review-pr; required checks must finish green. Apply ready to ship stable to source issue and PR; remove stale in-progress labels. No merge without --ship.

## Test matrix
- Domain arithmetic/validation and extracted pure rules: existing tests/unit.
- D1/R2/auth/CORS/idempotency/state/refund/payment atomicity: existing tests/integration with unchanged expectations.
- React interaction and form behavior: existing tests/browser.
- Two-origin actual deployment and order journeys: tests/e2e plus actual local HTTP smoke.
- Build/path/runtime wiring: both builds, production graph assertion, local migration command, Worker dry-run and actual pages.
- Database history: pre/post SHA-256 all seven files, including 0005/0006/0007.

## Verification commands
npm run test; npm run build:console; npm run build:storefront; npm run test:e2e (managed server mode); npx wrangler d1 migrations apply nexus-s1-468cba-db --local; npm run deploy:console -- STOREFRONT_ORIGIN:http://127.0.0.1:5174 --dry-run; npm run deploy:storefront -- nexus-storefront-dry-run --dry-run. Console selects its explicit generated config after build; Storefront's explicit name here is for local dry-run only, not a claimed deployed identity. Pin Node 22 PATH for all commands. Record exact outcomes, not assumed green. Inspect actual required checks on GitHub; if none are configured report that explicitly, not as green CI. Authentication/missing secrets/human approvals are blockers, not grounds to weaken checks.

## Observed verification
- Node 22 final `npm test`: 142 workerd tests and 48 browser tests passed. The workerd foreign-key reset diagnostic also occurred on baseline, with exit 0 and no failing tests.
- `env -u CI npm run test:e2e`: 27 tests passed against owned local servers. The inherited CI environment disables server reuse; clearing it used the existing local-server mode without modifying Playwright.
- Both complete npm deploy scripts passed with `--dry-run`, including appended origin/name arguments; Console selected current app build, Storefront remained assets-only with no bindings.
- Root local D1 command applied all seven migrations to `.wrangler/state/v3/d1`; both dev and production preview apps read that state.
- Actual dev/preview API JSON 404, SPA and public catalog/CORS checks passed. Vite dev middleware permits other loopback origins; unrelated external origins remain denied. No CORS source changes.
- Console Products/Orders and Storefront inspected at 375px: scrollWidth 375, accent fill rgb(0,0,0), accent ink rgb(255,255,255). Screenshots captured in session; no decorative screenshot files added to this structural refactor.
- Current docs: 10 files checked, no broken relative links after replacing two preexisting README links with surviving S3 evidence.
- Local review: domain reviewer found no behavioral defects; module-private helper suggestion applied. Runtime reviewer accepted the explicit generated deploy config fix; no remaining Critical/Important findings.

## Delivery checklist
- [x] Local behavior, deploy, preview and mobile evidence complete.
- [x] Current guidance and local review complete.
- [x] PR opened, reviewed/replied, checks inspected and ready labels applied without merge.

## PR outcome
[PR #12](https://github.com/AKBuildSprint/nexus-handson/pull/12) targets main; technical self-review/reply posted and issue/PR marked `ready to ship stable`. No checks are reported and no workflows are configured; CI is N/A, not green. No merge or remote deploy.
