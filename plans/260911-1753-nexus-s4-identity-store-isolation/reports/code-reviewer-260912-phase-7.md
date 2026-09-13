## Code Review Summary

### Scope
- Phase: Phase 7 role-aware experience
- Plan: `plans/260911-1753-nexus-s4-identity-store-isolation/phase-07-role-aware-experience.md`
- Reviewed surfaces: Console auth/session shell, Product list/editor routing through `ProductionConsoleApp`, Order detail role controls, Order assignment projection, Storefront refund-state rendering, and the Phase 7 browser contract tests named in the review request.
- Focus: functional correctness, auth/privacy boundaries, stale identity handling, accessibility/375px/token usage, and test gaps. Server-side enforcement from Phases 3-6 was treated as authoritative; UI `allowedActions` were reviewed as advisory only.

### Verdict
- Score: 8.4/10
- critical_count: 1
- GO/NO-GO: NO-GO for Phase 8 until the stale Product save/file-mutation commit path is fixed or explicitly deferred out of Phase 7 with replacement coverage.
- Auto-mode verdict: reject due to critical stale identity blocker.

### Critical Issues

1. `apps/console/src/production-console-app.tsx:523` - Product save/file mutations can commit stale private state after sign-out or identity switch.

   `saveProduct` captures `identityGeneration` at line 524 and checks it once at line 597, before delivery-file mutations and the final product refresh. After that point, it awaits `replaceDeliveryFile`, `removeDeliveryFile`, per-variant file mutations, and `fetchProductBySlug` at lines 601-643, then clears refs and commits `revision`, `detail`, `detailLifecycle`, and route state at lines 645-655 without checking that `identityGenerationRef.current` still matches the captured identity.

   The Phase 7 plan requires session expiry/sign-out to abort outstanding private reads/writes and clear Product detail, dirty draft, pending files, preview hash, unknown-outcome/cached state, and prevent late responses from resurrecting old identity data. `clearPrivateState` does increment the generation and clears refs, but this async save path can continue after that cleanup and write old Product detail or a new route back into the signed-out/new-identity app state. This is especially reachable on slow R2/D1 file writes or the post-file `fetchProductBySlug` refresh.

   Required fix: add a local guard used after every awaited private Product write/read in `saveProduct`, before mutating refs/history/state. The guard should return or throw a controlled cancellation when the generation changed. The file operations should also accept and use an abort signal where the API helper supports it; if helper support is missing, generation checks after each await are still required before every state/ref commit. Add a browser test that starts a Product save with a deferred file mutation or post-file GET, signs out before it resolves, then asserts the sign-in screen remains and old Product detail, slug, pending file state, and save-success UI do not reappear.

### High Priority

- No additional high-priority blockers found in the current Order role-action implementation. The current `OrderDetailScreen` catches 401/store-access denial for staff loading, assignment, and refund decisions and routes those through `onSessionExpired` (`apps/console/src/orders/order-detail-screen.tsx:388`, `apps/console/src/orders/order-detail-screen.tsx:644`, `apps/console/src/orders/order-detail-screen.tsx:682`). This closes the stale identity concern that would otherwise apply to role actions.

### Medium Priority

1. `tests/browser/console-role-actions-contracts.test.ts:42` - The Owner role-action browser test proves the controls render and staff is fetched, but it does not actually change the assignee or click approve/reject. The fetch stub includes `/assignment` and `/approve` responses, but the assertions stop at visible controls and `/api/console/staff` (`tests/browser/console-role-actions-contracts.test.ts:56-63`). Add interaction coverage for assignment POST, refund decision POST, idempotency retry copy, 401/session-expiry handling, and the post-write refresh. This would have caught regressions in the role-action handlers.

2. `apps/console/src/production-console-app.tsx:532` - The create/edit branch calls `previewProductSchema`, `createProduct`, `applyProductSchema`, and `updateProduct` before the first identity-generation check. A sign-out during those awaits cannot commit the final detail because of line 597, but it can still mutate refs/history immediately after the awaited create returns at lines 546-548. Apply the same generation guard before `createdDetailRef.current`, `routeRef.current`, and `window.history.replaceState`.

### Low Priority

- `packages/orders/src/order-types.ts:212` - `ConsoleOrderDetailProjection.allowedActions` does not include `assign`; assignment is exposed through the session-level `order:assign`/`staff:list` actions and a separate `canAssign` prop. This matches the current UI split, but it is a contract shape worth documenting because all other visible Order mutation buttons are detail-level actions.

### Edge Cases Checked

- Signed-out Console performs only `/api/console/session` before sign-in; no Product/Order private fetch is issued first (`tests/browser/console-auth-contracts.test.ts:127-148`).
- Staff direct Product edit/import routes are redirected to read-only Products without fetching private Product detail/import content (`tests/browser/console-auth-contracts.test.ts:228-255`).
- Console sign-out clears delayed old Order detail responses and keeps the sign-in form (`tests/browser/console-auth-contracts.test.ts:193-226`). The analogous delayed Product save/write path is missing and is the critical finding above.
- Order detail refresh/drop behavior covers stale actions, contract-outdated GETs, and hidden-tab refresh (`tests/browser/console-orders-contracts.test.ts:577-709`).
- Storefront renders pending/approved/rejected refund states without decider identity, internal history, payment sentinel, file sentinel, or money-return claims (`apps/storefront/src/storefront-app.tsx:374-486`, `tests/browser/storefront-orders-contracts.test.ts:372-424`).
- 375px checks exist for Console auth/shell and approved-refund Storefront paths (`tests/browser/console-auth-contracts.test.ts:111-190`, `tests/browser/storefront-orders-contracts.test.ts:391-424`).
- The token file keeps primary accent tokens in `--color-accent` and `--color-accent-ink` (`apps/console/src/styles/design-tokens.css:35-39`).

### Validation

I did not rerun the full controller gate. Controller evidence says focused integration 36/36, full integration 182/182, full browser 56/56, typecheck, both builds, and diff-check pass on current Node 24, with earlier phase evidence on Node 22. My review was source- and test-inspection based and found a stale identity case not covered by those passing tests.

### Recommended Actions

1. Fix `saveProduct` so every awaited Product private read/write is guarded by the captured identity generation before any ref, history, route, or React state mutation.
2. Add a browser regression for delayed Product save/file mutation resolving after sign-out/session reset.
3. Strengthen the Owner role-action test to click assignment and refund decision controls and assert request/error/session-expiry behavior, even though the current implementation now handles those paths.

## Final Re-review After Blocker Fix

### Verdict
- Score: 9.4/10
- critical_count: 0
- GO/NO-GO: GO for the Phase 7 application slice. Do not include the concurrently owned E2E helper in this verdict.
- Auto-mode verdict: approve with warnings.

### Blocking Findings

None remaining in the reviewed Phase 7 application slice.

### Fix Verification

The prior stale Product save blocker is fixed in source. `saveProduct` now captures the identity generation and checks `identityChanged()` after each awaited private Product operation before mutating refs, history, route, or React state: preview/create at `apps/console/src/production-console-app.tsx:535-553`, schema/update at `apps/console/src/production-console-app.tsx:557-600`, product-level file replacement/removal at `apps/console/src/production-console-app.tsx:609-622`, variant file replacement/removal at `apps/console/src/production-console-app.tsx:641-648`, and post-file detail refresh at `apps/console/src/production-console-app.tsx:651-655`. The earlier pre-guard route/ref writes after create are now guarded before `createdDetailRef`, `routeRef`, and `window.history.replaceState`.

The schema preview path also checks the captured generation before it commits `previewHashRef` or returns preview rows (`apps/console/src/production-console-app.tsx:495-505`).

The new regression test covers delayed Product create resolving after sign-out and asserts the app remains on `/console/products` with the signed-out UI and no old Product title committed (`tests/browser/console-auth-contracts.test.ts:229-266`). Local verification passed:

```text
npm run test:browser -- tests/browser/console-auth-contracts.test.ts
Test Files 1 passed (1)
Tests 6 passed (6)
```

Order role-action handling is acceptable in the current source. Staff candidate loading routes 401/store-access denial through `onSessionExpired` (`apps/console/src/orders/order-detail-screen.tsx:382-395`). Assignment and refund decision writes preserve frozen retry keys, abort stale in-flight role actions, handle auth/session expiry, keep unknown outcomes retryable, and gate final busy-state commits by route generation/reference (`apps/console/src/orders/order-detail-screen.tsx:624-697`). The action controls remain advisory UI; server enforcement remains the owning boundary.

### Remaining Non-blocking Concerns

1. `tests/browser/console-auth-contracts.test.ts:229` covers delayed create, but not a deferred delivery-file mutation or post-file `fetchProductBySlug`. Source now has guards at those awaits, so this is not a blocker. A small future test with a delayed file replacement would strengthen coverage for the highest-latency path.
2. `tests/browser/console-role-actions-contracts.test.ts:42` still mostly checks role-control rendering and staff loading rather than actually clicking assignment/approve/reject and asserting POST/error/retry/session-expiry behavior. Source inspection finds the handlers acceptable, but the browser test remains weaker than the implementation risk.
