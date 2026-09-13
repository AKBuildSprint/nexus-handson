# Phase 8 local validation

Date: 2026-09-12
Runtime: Node v22.16.0
Remote status: **not inspected, mutated, provisioned, migrated, deployed, or smoke-tested**

## Populated rehearsal

`npm run verification:s4-rehearsal -- --baseline-ref a3a67f6` completed against disposable local state and reported:

- three injected migration failures observed after staging, after parent/child drops, and during late restoration;
- retry succeeded and reapply was a no-op;
- exact migration ledger `0001` through `0010`;
- protected pre/post graph digest matched;
- proxy-to-raw and raw-to-proxy sentinels matched;
- Store A/B Product, Variant, import/R2, Customer, Order, snapshot, capability/idempotency, history/command, payment and Refund records preserved; R2 key digests and R2 content digests are separate fields;
- schema-9 assignment preserved through schema 10;
- pending Refund and legacy paid-without-payment gap preserved;
- raw Wrangler `PRAGMA foreign_key_check` returned zero rows;
- disposable rehearsal directory removed after evidence capture.

The standalone Node suite passed 6/6. It also proved fail-closed invariant handling, provisioning exact rerun, conflict refusal, partial credential/membership recovery, mode-0600 redacted manifests, local apply with runtime-only credentials, and executable zero-write dry-run CLIs.

## Cross-layer and browser acceptance

- Unit: 12 files, 40/40.
- Integration: 28 files, 188/188, including `tests/integration/s4-acceptance.test.ts` 3/3 and three purchased-Variant retention cases.
- Browser: 6 files, 62/62, including Unicode identity/Store text and 375px overflow/action styling.
- Playwright: 30/30 with real persisted auth, both origins, held stale Owner response, Staff replacement, Back navigation, and sibling-tab invalidation without reload.
- TypeScript: `npm run typecheck` passed.
- Console production build and import-graph guard passed.
- Storefront production build passed with the explicit loopback API build origin.
- `git diff --check` passed.
- Ports 5173 and 5174 and disposable `s4-rehearsal-*` state were clean after runs.

## Operator boundary

Root `wrangler.jsonc` keeps ordinary bindings local and adds only the named `s4-provisioning` environment with the exact existing D1/R2 identities and `remote: true`. Its checked-in origins use `.invalid` deliberately; operator tools require explicit confirmed HTTPS origins. `wrangler types --env s4-provisioning` validated the environment locally without warnings.

Cloudflare documents `getPlatformProxy` as Node-only, with `--persist-to` data shared at the explicit `v3` subdirectory, and documents per-binding `remote: true` for remote binding environments:

- https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy
- https://developers.cloudflare.com/workers/local-development/#remote-bindings

The remote runbook is a future procedure with explicit stop conditions. Remote cutover remains blocked because remote identity provisioning and authenticated S4 smoke apply are not implemented or reviewed. Separate authorization is required only after those tools exist and the exact account/resources/origins, writer barrier, abort deadline, and checkpoint are concrete.

## Local rollback safety evidence

The local writer barrier is the newly created, isolated disposable persistence root. No application server or reusable development state points to it. This proves isolation for the rehearsal only; it does not prove that any deployed writer is quiescent.

The schema-9 checkpoint is a digest over the complete SQLite schema, all protected rows including assignment history, assignment command, and current assignment, plus separate R2 key/content digest pairs. Three raw Wrangler migration attempts inject faults after staging, after the parent/child drops, and during late restoration. Each abort must reproduce that checkpoint exactly, retain the nine-entry ledger, and return zero raw `PRAGMA foreign_key_check` rows before the next fault runs. Any mismatch throws, causing the named rehearsal command to exit nonzero. The successful retry then uses the untouched checked-in 0010 migration, and a final reapply rechecks the complete schema/data/R2 digest and ledger.

These checkpoint and abort results are local rehearsal evidence. No remote writer barrier, checkpoint, mutation, or rollback is claimed.
