---
phase: 7
title: "Deliver the role-aware Console and Customer experience"
status: pending
priority: P1
effort: 2d
dependencies: [4, 5, 6]
---

# Phase 7: Deliver the role-aware Console and Customer experience

## Goal

Add accessible signed-in Console state, sign-out, assigned Staff views, read-only Staff Products, Owner assignment/refund-decision controls, stale-session clearing, and Customer-safe terminal Refund copy. Keep Console destinations to Products and Orders.

## Current Evidence

- `contracts.md` is the canonical proposed S4 contract, including `GET /api/console/session`, `GET /api/console/staff`, `POST /api/console/orders/:reference/assignment`, and refund `approve|reject` endpoints. These endpoints are proposed, not present.
- Existing Console has no auth boundary. `ProductionConsoleApp` owns private Products/Orders state in one component: routes at `apps/console/src/production-console-app.tsx:45`, private state at `apps/console/src/production-console-app.tsx:234`, Product fetch at `apps/console/src/production-console-app.tsx:312`, Order list fetch at `apps/console/src/production-console-app.tsx:326`, detail render at `apps/console/src/production-console-app.tsx:616`, shell render at `apps/console/src/production-console-app.tsx:655`.
- Existing shell hard-codes anonymous identity copy: `apps/console/src/layout/console-shell.tsx:56` and `apps/console/src/layout/console-shell.tsx:86`.
- Existing API client is same-origin and cookie-ready but has no auth/session handling. It decodes errors at `apps/console/src/api-client.ts:84`, reads Products at `apps/console/src/api-client.ts:101`, reads/mutates Orders at `apps/console/src/api-client.ts:131`, and mutates Product/import/file paths at `apps/console/src/api-client.ts:214`.
- Existing Order UI trusts server `allowedActions` but only for S3 actions: type at `apps/console/src/orders/order-ui-types.ts:83`, panel pruning at `apps/console/src/orders/order-detail-screen.tsx:299`, button visibility at `apps/console/src/orders/order-detail-screen.tsx:571`, anonymous refund-request copy at `apps/console/src/orders/order-detail-screen.tsx:778`.
- Existing Order list metrics already use server summary, not the current page: `apps/console/src/orders/orders-screen.tsx:127`.
- Existing Customer page has capability generation/retry protection but only pending Refund requests: capability route parse at `apps/storefront/src/storefront-app.tsx:34`, private read at `apps/storefront/src/storefront-app.tsx:201`, refund eligibility at `apps/storefront/src/storefront-app.tsx:275`, pending-only display at `apps/storefront/src/storefront-app.tsx:461`, pending-only type at `apps/storefront/src/storefront-view-types.ts:64`.
- Existing worker routes still route Console before Storefront and without auth: `apps/worker/src/index.ts:22`. Phase 7 consumes protected server contracts from Phases 3-6; it does not prove enforcement.

## Existing Test Inventory

Lexical count on 2026-09-12: 38 test/spec files, 212 `it`/`test` calls total.

| Layer | Files | `describe` calls | `it/test` calls |
|---|---:|---:|---:|
| `tests/unit` | 10 | 10 | 31 |
| `tests/integration` | 19 | 20 | 106 |
| `tests/browser` | 4 | 4 | 48 |
| `tests/e2e` | 5 | 0 | 27 |

Current UI/auth-adjacent consumers to update, not treat as proof:

- `tests/browser/console-orders-contracts.test.ts`: 21 tests; stale-detail/retry tests at lines 352, 376, 418, 559, 580, 621, 643, 664.
- `tests/browser/storefront-orders-contracts.test.ts`: 19 tests; capability/retry/private-denial tests at lines 121, 210, 263, 414, 506, 563, 574.
- `tests/e2e/console-orders.spec.ts`: 6 tests; current anonymous/stale/order-flow journeys at lines 142, 208, 356, 458, 510.
- `tests/e2e/storefront-orders.spec.ts`: 10 tests; capability/private/refund/mobile journeys at lines 306, 352, 402, 446, 479, 524, 540.

## Requirements

### Functional

- Signed-out Console calls `GET /api/console/session`, shows email/password sign-in through Better Auth routes when unauthenticated, and performs zero private Product/Order requests before session success.
- Signed-in shell shows server session identity, active Store, role, and sign-out. No role switcher, Store picker, login destination or self-service signup. User confirmed separate accounts per Store on 2026-09-12; cross-Store identity tests sign out and sign into a different account, never switch Store within one login.
- Owner sees Product mutations, CSV import, delivery-file mutation, active same-Store Staff assignment options from `GET /api/console/staff`, assignment, and Refund Approve/Reject when server contracts permit.
- Staff sees Products read-only and only assigned Orders across list/search/detail/pagination/summary counts. Staff direct visits to Product edit/import or unassigned Order detail recover without private disclosure.
- Session expiry/sign-out aborts outstanding private reads/writes, clears Products, Orders, detail, summaries, cursors, preview hash, pending files, dirty draft, unknown-outcome attempts, and cached response state, increments an identity generation, and returns to sign-in.
- Late responses, `popstate`, Back/forward cache, visibility refresh, and BroadcastChannel refresh never resurrect prior identity data.
- Customer page renders `pending`, `approved`, and `rejected` terminal Refund states from Phase 6 as "approved-awaiting-execution" or "rejected" copy without decider identity, internal history, Staff names, payment evidence, file metadata, or money-return claims.

### Non-functional

- 375 px has no horizontal page scroll and no hidden primary action.
- Console primary actions keep `var(--color-accent)` fill and `var(--color-accent-ink)` text.
- Keyboard focus, dialog restoration, live regions, labels, and field errors remain accessible.
- UI is advisory only. Authorization remains server-side from Phases 3-6.

## Architecture and Data Flow

1. Browser opens `/console/*`.
2. Proposed `auth-client` calls `GET /api/console/session` with same-origin cookies.
3. Worker validates Better Auth session, resolves the current Nexus membership per `contracts.md`, and returns `{user, store, role, allowedActions}` without tokens/account fields.
4. Console stores `sessionView` and `identityGeneration`.
5. Private API calls capture `identityGeneration` and an `AbortSignal`.
6. Worker revalidates session, membership, resource, assignment, origin/CSRF, and transition state at each private endpoint.
7. Console commits a response only if generation/session still match; otherwise discards it.
8. Sign-out/expiry clears local private state synchronously before navigation or new identity rendering.
9. Customer Storefront continues using capability header only; Console session never broadens Customer capability scope.

## Interface and Dependency Checklist

- [x] Phase 3 exposes `GET /api/console/session`, auth failure/error handling, sign-out, and exact-Origin mutation policy; Phase 7 must follow `contracts.md`.
- [x] Phase 4 exposes Product list/detail/import/file routes with Staff read-only and Owner-only mutation errors.
- [x] Phase 5 exposes `GET /api/console/staff`, assignment endpoint, assigned-only Order list/detail/summary, and assigned Staff action affordances.
- [x] Consume Phase 5's already compiling command types/parser for canonical `action:'assign'` result with immutable status/time and `{assigneeUserId,eventId}`; render/refetch current assignment separately. Preserve existing action result shapes and Customer privacy. Audit correction (2026-09-12): result decoding is not deferred until this phase.
- [x] Phase 6 extends Order UI types and Customer projections for terminal Refund decisions and Owner Approve/Reject endpoint responses.
- [x] `ConsoleApiError` recognizes `401 unauthenticated`, `403 store_access_denied|origin_not_allowed|forbidden`, `503 service_unavailable`, `client_contract_outdated`, and generic failures distinctly enough for reset/copy.
- [x] Every existing private caller in `apps/console/src/api-client.ts` is routed through auth-aware decode/reset handling.
- [x] Storefront types support terminal Refund status without requiring a Console session.
- [x] Browser/E2E tests assert behavior against UI text/roles and request effects; integration phases remain the enforcement proof.

## File Inventory

| File | Existing / proposed | Action | Ownership |
|---|---|---|---|
| `apps/console/src/auth-client.ts` | Proposed | Create session/sign-in/sign-out wrapper over `GET /api/console/session` and Better Auth routes | Phase 7 only |
| `apps/console/src/sign-in-screen.tsx` | Proposed | Create accessible sign-in and expired-session state | Phase 7 only |
| `apps/console/src/production-console-app.tsx:234` | Existing | Add signed-out/resolving/signed-in state, identity generation, private reset, route guards | Phase 7 only |
| `apps/console/src/api-client.ts:84` | Existing | Add auth-aware decode hook/session-expired classification and assignment/decision/staff calls; reuse Phase 5 result decoding | Phase 7 UI wiring after Phase 5 contract seam |
| `apps/console/src/layout/console-shell.tsx:56` | Existing | Replace anonymous operator copy with real identity/store/role/sign-out | Phase 7 only |
| `apps/console/src/products/product-list-screen.tsx:4` | Existing | Add read-only Staff props/copy and hide mutation affordances | Phase 7 only |
| `apps/console/src/products/product-editor-screen.tsx:8` | Existing | Add inaccessible/read-only recovery if Staff direct-visits edit/new | Phase 7 only |
| `apps/console/src/imports/csv-import-screen.tsx` | Existing | Gate route from Staff and abort import on identity reset | Phase 7 only |
| `apps/console/src/orders/order-ui-types.ts:1` | Existing | Extend view types for controls; reuse Phase 5 assignment result/history contracts and Phase 6 terminal projections | Phase 7 after Phases 5-6 |
| `apps/console/src/orders/orders-screen.tsx:11` | Existing | Add assigned-work copy and Staff-safe empty/summary states | Phase 7 only |
| `apps/console/src/orders/order-detail-screen.tsx:27` | Existing | Add assignment + Approve/Reject panels and auth-reset handling | Phase 7 only |
| `apps/console/src/styles/console-layout.css` | Existing | Token-only responsive/auth/action styles | Phase 7 only |
| `apps/storefront/src/storefront-view-types.ts:64` | Existing | Extend Refund request status union for terminal decisions | Phase 7 only |
| `apps/storefront/src/storefront-app.tsx:461` | Existing | Render terminal decision copy and remove re-request form | Phase 7 only |
| `tests/browser/console-auth-contracts.test.ts` | Proposed | New auth-state/stale-reset/read-only contracts | Phase 7 only |
| `tests/browser/console-orders-contracts.test.ts:226` | Existing | Update/add role-aware Order UI tests while retaining Phase 5 result decoding assertions | Phase 7 after Phase 5 contract tests |
| `tests/browser/storefront-orders-contracts.test.ts:100` | Existing | Update terminal Customer copy tests | Phase 7 only |
| `tests/browser/product-phase4-contracts.test.ts` | Existing | Preserve Product/editor characterization under authenticated Owner fixture; Staff read-only props | Phase 7 only |
| `tests/e2e/console-auth.spec.ts` | Proposed | Real-browser sign-in/sign-out/stale-session coverage | Phase 7 only |
| `tests/e2e/console-orders.spec.ts:142` | Existing | Update Owner/Staff journeys | Phase 7 only |
| `tests/e2e/storefront-orders.spec.ts` | Existing | Migrate hidden Console Product setup/edit and Order action helpers to real Owner login/exact Origin; preserve anonymous public and capability-only Customer journeys plus terminal/mobile cases | Phase 7 only |
| `tests/e2e/console-products.spec.ts`, `tests/e2e/console-variants.spec.ts`, `tests/e2e/console-import.spec.ts` | Existing | Add real Owner login and Origin-aware API setup; retain catalog behavior assertions | Phase 7 only |
| `playwright.config.ts` | Existing | Isolated local auth provisioning/setup; opt out of secret-bearing traces/video/HAR for auth/capability contexts | Phase 7 only |
| `apps/console/vite.config.ts` | Existing | Explicit test-only persistence subdirectory under root `.wrangler`; ordinary local default unchanged | Phase 7 only |
| `tests/support/console-auth-fixtures.ts` | Proposed | Reusable real-login E2E fixtures with runtime-only credentials and sanitized failures; provision through Phase 1 helper and local binding proxy, independent of Phase 8 scripts | Phase 7 only |
| `scripts/verification/local-binding-context.ts` | Proposed | One Node-only local proxy/path lifecycle helper shared by E2E setup and later rehearsal; remote bindings always disabled here | Phase 7 creates; Phase 8 reuses |

## Test Scenario Matrix

| Severity | Scenario IDs | Boundary and expected observation |
|---|---|---|
| Critical | S4-17, S4-38 | Real session replacement/Back/delayed response: previous identity never reappears |
| Critical | S4-41, S4-42 | Customer view and artifacts: no actor/internal evidence/credentials |
| High | S4-02, S4-22, S4-24, S4-45 | Owner assign -> Staff processing; keyboard focus/errors; unknown outcome refetch |
| Critical | S4-46 | Approval copy and observed Order/payment state never claim money returned |
| High | S4-40, S4-47 | Both apps render actual terminal state and truthful legacy evidence gaps |
| Medium | S4-06, S4-21 | Unicode names at 375px: no horizontal page scroll, primary-action token contrast |

## Tests Before

Characterize existing Product/Order/Customer UI with the same payload contracts under an authenticated Owner fixture. Add minimal compiling view types before new behavioral assertions; type/import/setup failures are prerequisites, not TDD Red. New auth/role/stale-response cases below must fail for the named behavior. E2E setup reuses the proven Phase 1 provisioning function through Node `getPlatformProxy` with `remoteBindings:false`, then adds controlled local memberships; no public provisioning route or dependency on Phase 8 scripts. Use an isolated persistence subdirectory under repository-root `.wrangler` for proxy, raw migrations and API/Console Vite server; pass one explicit test-run path through Playwright configuration and account for the proxy/CLI `v3` difference. Storefront stays HTTP-only. Call `dispose()` and stop only owned servers at completion. Check deterministic ports before startup, fail rather than silently attach to an unrelated user's server.

Phase 7 owns `local-binding-context.ts`: `withLocalBindings({configPath,persistRoot},callback)` validates an absolute isolated root, maps Wrangler/Vite root to proxy `<persistRoot>/v3`, disables remote bindings and disposes in `finally`. Playwright chooses one `NEXUS_TEST_PERSIST_ROOT` and passes it to the helper and Vite config; no independent defaults in fixtures. Before auth E2E, create a non-secret randomized Store/Product sentinel through the proxy and read it through the browser-served Worker's existing public Store A catalog endpoint. A mismatch stops setup; no test-only public endpoint is added. Keep schema-specific seed/auth logic in fixtures, not this transport helper. Phase 8 imports this helper instead of creating a parallel local proxy; its separately authorized remote path remains explicit and distinct.

`storefront-orders.spec.ts` is also a Console consumer: Product creation/edit, setup `page.request` mutations and embedded Order actions require the Owner fixture and exact Console Origin. Give the helper explicit authenticated versus anonymous/capability clients; never automatically attach Owner credentials to public/Customer requests. Reuse the fixture for Console page login and direct setup mutations, retaining negative auth/Origin tests and secret-safe diagnostics.

## Red -> Green -> Refactor Gates

1. **RED auth shell:** add `tests/browser/console-auth-contracts.test.ts` rendering `ProductionConsoleApp` with mocked `GET /api/console/session` returning 401 then 200.
   - Expected first failure: assertion such as `expected screen to contain textbox named /email/i` or `expected "Store operator" not to be present`, not module import failure.
2. **GREEN auth shell:** add `auth-client`, `SignInScreen`, and top-level Console auth states. Product/Order fetches must not fire while signed out.
3. **REFACTOR:** centralize `resetPrivateConsoleState(reason)` so Products, Orders, detail, refs, dirty state, pending files, preview hash, and request generations reset through one path.
4. **RED stale identity:** add delayed-response browser and E2E tests: Owner A detail in flight -> sign out -> Staff/Owner B sign in -> release A response -> Back. Assert A reference/customer/payment is absent and B session remains.
   - Expected first failure: stale A text appears or late response commits, not missing route import.
5. **GREEN stale identity:** capture generation/session on every private request and discard mismatches; abort reads/writes on reset; block automatic privileged replay after auth restoration.
6. **RED role UI:** update Product/Order tests for Staff read-only Products and assigned-only Orders. Assert Staff has no Import/Add/Edit/file mutation affordances and cannot see unassigned detail.
   - Expected first failure: Staff sees `Add Product`/`Import CSV` or unassigned Order private text.
7. **GREEN role UI:** render server-produced permissions and allowed actions only; add Staff list, Owner assignment controls, and Approve/Reject controls from Phase 5/6 contracts.
8. **RED Customer terminal states:** update Storefront browser tests with `approved` and `rejected` Refund projections.
   - Expected first failure after types compile: terminal status still renders pending copy or retains the request form. A union-type compile failure alone is not behavioral Red.
9. **GREEN Customer terminal states:** extend Storefront types/copy, remove re-request form after any request, never say `refunded`.
10. **Refactor:** update obsolete anonymous wording assertions to protect authenticated behavior, preserving their other checks. Keep existing state-library choices; centralize reset logic only where it removes duplication.

## Tests After

Audit correction (2026-09-12, session lifecycle): add a real-browser due-refresh case with a real persisted test session arranged past updateAge through private fixtures, not by waiting a day. Verify a Console bootstrap/private response extends the browser cookie expiry while retaining the same identity, and expired-session library deletion cookies remove the cookie before the signed-out UI settles. Phase 3 owns forwarding and denial-path assertions; no JavaScript access to HttpOnly cookie values or credential-bearing artifact capture.

Rerun the same Reds after Green and Refactor, plus the existing Product/editor/import E2E consumers now using real Owner login. Disable trace/video/HAR/network dumps during credential/capability handling (current Playwright defaults retain failure traces); store only sanitized diagnostics. An expired session clears private drafts and retry caches. An unknown mutation outcome triggers authorized refetch; retain an in-memory frozen intent/key only within the same user/Store context, never transfer it to another account. A reload restores server state rather than auto-submitting an unrecorded intent.

## Narrow Regression Commands

Use exact files; avoid `npm run test:integration -- <file>` because the repo contract says it expands to all integration tests.

```sh
npx vitest run --config vitest.browser.config.ts tests/browser/console-auth-contracts.test.ts
npx vitest run --config vitest.browser.config.ts tests/browser/console-orders-contracts.test.ts tests/browser/storefront-orders-contracts.test.ts
npx playwright test tests/e2e/console-auth.spec.ts tests/e2e/console-orders.spec.ts tests/e2e/storefront-orders.spec.ts
npx playwright test tests/e2e/console-products.spec.ts tests/e2e/console-variants.spec.ts tests/e2e/console-import.spec.ts
npm run typecheck
```

Manual browser evidence after automated gates: start the two local surfaces from the repo root, sign in as Owner A/Staff A/Owner B, verify assignment, stale response, sign-out, Customer terminal Refund state, 375 px no horizontal scroll, and primary action token colors.

## Rollback

- Revert Phase 7 UI/test changes without touching Phases 1-6 schema/domain changes.
- If UI auth fails but server phases pass, keep API protected and show a signed-out maintenance/error state rather than re-enabling anonymous Console access.
- If Customer terminal copy fails, block release of Phase 6 decision visibility until Storefront projection and copy agree.

## Risk Assessment

- **High x High: stale private data leak after identity switch.** Mitigation: one reset path, generation checks on every private response, abort on sign-out/expiry, E2E delayed-response proof.
- **High x Medium: client/server permission drift.** Mitigation: render only server `permissions`/`allowedActions`; integration phases remain enforcement proof.
- **Medium x Medium: read-only Staff Product direct route confusion.** Mitigation: direct edit/import recover to Product list with Staff read-only notice; API denial remains final.
- **Medium x Medium: unknown-outcome retries after session expiry.** Mitigation: do not auto-retry privileged mutations after auth reset; retain retry only for same identity/session and same frozen intent.

## Success Criteria

- Signed-out users trigger zero private Console data requests.
- Owner and Staff complete the S4 browser flow with role-appropriate UI.
- Staff Products are readable but not mutable; Staff Orders are assigned-only in UI and summary copy.
- Sign-out/expiry/session replacement cannot resurrect prior private state.
- Customer terminal Refund copy is privacy-minimized and never claims money returned.
- Targeted browser/E2E/typecheck gates pass and manual 375 px/token checks are recorded.
- Proxy-written sentinel is visible through the browser-served Worker before any auth E2E; Console consumers inside Storefront specs work without an auth bypass or duplicated persistence/provisioning implementation.
