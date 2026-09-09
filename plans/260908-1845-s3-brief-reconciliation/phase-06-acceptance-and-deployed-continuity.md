---
phase: 6
title: "Phase 6: Acceptance and deployed continuity"
status: pending
priority: P1
effort: ""
dependencies: [5]
---

# Phase 6: Acceptance and deployed continuity

## Goal

Prove every S3 criterion on the new contract, including actual pre-existing Order continuity and repeat behavior after restart/redeploy. Local fixtures cannot substitute for deployed evidence. No current gate is marked implemented by this planning artifact.

## Files / ownership

Modify `README.md` (current Order scope/auth caveat/commands), `docs/design-guidelines.md` only where canonical Order labels/components changed; update existing test helpers/config as required by the changed contract.
Create execution evidence in this plan's `reports/` (safe summary only). Extend `tests/e2e/console-orders.spec.ts` and `tests/e2e/storefront-orders.spec.ts` already owned by completed phase5 only if connected acceptance remains uncovered. Keep remote-contract-smoke.ts's existing S1 responsibility; no misleading claim it tests S3.
No source implementation in this plan-authoring session. No automatic remote migration/deploy during planning.

## Final verification sequence

1. With all code ownership complete, run `npm run typecheck`, `npm run test:workerd`, `npm run test:browser`, `npm run build:console`, and `VITE_STOREFRONT_API_BASE_URL=http://127.0.0.1:5173 npm run build:storefront` for local contract proof. Run existing `npm run test:e2e -- --trace=off` against confirmed local servers. Project-wide commands run at this final gate, not concurrently with sibling edits.
2. Tests that pin obsolete Complete/one-line/Console-refund-404 latest-schema behavior must be migrated or removed if they assert implementation rather than behavior. Retain historical version-specific migration tests and meaningful error/race/privacy tests. Add no tautological “has tests” cases.
3. Execute the [acceptance matrix](./acceptance.md): multi-product incoming Order, filtered summary/search/page agreement, manual Paid->Fulfill, Cancel/invalid direct action, Customer and Console refund, duplicate/races and private projection.
4. Stop and restart LOCAL runtime without deleting `.wrangler` state, reopen same synthetic private link, resend exactly the successful version2 keys, compare persisted Payment/request/history counts and original timestamps. Use supervised processes; no unverified PID kills. New request keys are not a substitute for the same-key proof.
5. For existing data, inventory schema version and only aggregates/known fixture identities before 0006. Verify original Orders/references/capabilities/snapshots before and after. Do not paste customer data, capabilities, bank refs or export files into reports. Migration database tests remain distinct from an actual S2 Order used in this journey.

## Remote release protocol — mandatory execution gate

- Verify authenticated Cloudflare account, exact existing `nexus-s1-468cba` Worker, `nexus-s1-468cba-db`, private R2 and independently deployed Storefront origin from CLI output/config. Inspect pending migration names. No new resources/reseed; never construct a workers.dev origin.
- Remote mutations require the user's execution/deploy authorization and verified resources. Missing credentials/origins are a deployment blocker, not a reason to omit local implementation or claim complete S3. Planning does not require remote secrets.
- Build both final artifacts first with actual API origin. Rehearse migration/restore on a disposable copy and record original deployed versions. A rehearsal export taken while traffic is live is NOT the authoritative rollback checkpoint.
- Establish maintenance on the API origin with a temporary Worker returning 503/Retry-After and performing no DB writes. Prepare outside product source with verified Worker identity/config and restore command. Probe both clients' endpoints, but do not confuse 503 responses with retirement of previously accepted requests. Cloudflare HTTP Workers have no general wall-time limit; a fixed sleep/CPU limit/runtime-update grace is not a deployment-drain guarantee.
- Before migrations, require an observable documented prior-version retirement/drain condition OR a separately rehearsed DB write barrier covering every possible in-flight writer. Record how the operator proves it. If that condition cannot be established with the actual platform, restore ordinary serving and report rollout blocked BEFORE schema mutation. Do not add an unverified fence to production or infer drain from two probes. This external deployment prerequisite does not block local implementation.
- AFTER proven quiescence, capture the authoritative database checkpoint/export and verify it includes final pre-maintenance commits. Set the operational abort deadline BEFORE entering maintenance, with enough time for the rehearsed restore; use that deadline here. Only then apply 0006/0007. Keep API paused. Failure/deadline before reopen => restore that checkpoint and matching prior deployments; 0007 failure does not roll back already applied 0006 automatically.
- Deploy new Storefront while API paused, then final API/Console with proper origin/CORS. Recheck both versions. Required X-Nexus-Order-Contract:2 refuses old retained Cancel/private-refund requests even with never-used keys; test alongside removed /complete/single-item creation. No writes on refusal. Private token URLs still open on a refreshed new client.
- Reopen the actual pre-existing S2 Order in Console and private page, verify snapshots and reference identity. Use a separate documented synthetic acceptance Order for mutations; do not alter an unrelated real Customer Order merely for a test. For a pre-existing pending test Order authorized for processing, demonstrate manual payment/fulfill on that same Order as well.
- Run connected browser journey on DEPLOYED surfaces (actual browser helpers; local-only Playwright config rejects remote origins and is not a remote runner). Create two-Product Order, find by payment ref, Mark Paid with clearly labeled synthetic manual reference, Fulfill, Customer request, Console duplicate, reload both.
- Deploy the SAME application version again without D1 reset, replay captured version2 command key/payload from safe transient memory, and prove one Payment/event/request. If deploy/replay cannot run, report exact unverified acceptance instead of claiming redeploy durability.
- Rollback before reopening uses ONLY the authoritative post-quiescence checkpoint with no later application writes. Restore database and exact prior API/Storefront versions together. After traffic/new writes, NEVER restore an old snapshot and lose Orders; pause again and forward-fix/repair with evidence. No blind old Worker rollback onto incompatible schema.
- Remove temporary maintenance artifacts after final proof; retain no secrets/export/private token in repo. User-owned fixture data stays unless explicit cleanup approved; delete only attributable disposable artifacts.

## Acceptance mapping

All six official S3 criteria plus slice/rules map to `acceptance.md`. Report each: source evidence, fresh command/browser observation, local vs deployed, and limitation. PRD “authorized Console” is satisfied only under the explicit user-approved anonymous bootstrap demo exception, never described as real auth. S4 owns actual authorization.

## Documentation / handoff after proof

- Update README's obsolete read-only Orders description and Complete-only model to canonical lifecycle, manual ledger, two refund paths, internal vs external references, legacy-unrecorded limitation and anonymous risk.
- Historical accepted brainstorm/plan/report remain unchanged as history; add a concise superseded link only if these are navigated as active authority. New plan becomes active, not two concurrent scopes.
- Record S4 evaluator seam/Store migration and S5 payment/reconciliation prerequisites from contracts C8. In particular S5 must not auto-return money for legacy paid Orders lacking original payment evidence.
- No new generic changelog file: update an existing one only if repository has one at execution. Remove any throwaway validation/maintenance scripts after proof; keep only regression tests protecting plausible failures.

## Tasks

- [x] Verify S3 acceptance against local real journeys; deployed evidence deferred by user
- [x] Prove local migration/restart continuity; Cloudflare replay deferred by user
- [x] Update current documentation and session handoff evidence

## Stop conditions

Ready for S4 only after local gates and required deployed/actual-S2 evidence pass, or user explicitly accepts a named deployment-evidence exception. Actual end-user sign-in, automated payment/access and receipts remain correctly absent. Phase completion is not permission to implement S4.

## Accepted deployment-evidence exception

The user explicitly stated “Không cần Cloudflare tại thời điểm này” after the local PR9 merge checkpoint `9d20e5b`. Current acceptance is local-only: Cloudflare resource verification, remote migration/deployment, actual deployed S2 Order continuity and same-version redeploy replay are deferred, not passed. Local proof is recorded in `reports/phase-06-cook.md` and `reports/pr-09-integration.md`, including the final 28 multi-line matching Orders and passing combined-tree checks.

The three overwritten historical `ui-01` screenshots remain unrecovered as documented in the phase-6 report; this exception does not erase that incident. Future E2E runs use per-run output paths. No remote action or S4 implementation is authorized by this closure.
