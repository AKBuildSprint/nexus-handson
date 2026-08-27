---
phase: 5
title: "Cross-Surface Verification"
status: in-progress
priority: P1
effort: ""
dependencies: [4]
---

# Phase 5: Cross-Surface Verification

## Overview

Prove the complete S2 contract across D1, Worker routes, independent Storefront, Console, and remote deployment. This phase does not add product scope; it closes evidence gaps that unit/UI-only tests cannot cover.

## Requirements

- Run focused Workerd, browser, two-origin Playwright, typecheck, build, and direct deployment smoke gates appropriate to the modified surface.
- Verify S1 regressions: public catalog privacy, Product/Variant purchasability, API/SPA routing, and delivery-file retention remain intact.
- Demonstrate Simple and Variant Orders separately, Customer reuse/history immutability, captured-revision conflict rollback, private-read boundaries, fragment/header capability transport, CORS allow/deny, idempotency, and aggregate rollback.
- Verify production only after controlled resource inspection, append-only migration application, and confirmed Storefront origin/API CORS configuration.
- Keep test fixtures/demo data isolated and remove only data proven safe under the existing cleanup rules.

## Architecture

Use layered evidence. Workerd integration owns transaction, query, CORS, capability, and retention proof. Browser contracts own rendering/accessibility states. Playwright owns real cross-origin Customer/Console journeys and responsive deep-link behavior. Remote smoke proves the final two-Worker deployment topology; it does not substitute for deterministic local rollback tests.

## Related Code Files

- Modify: `tests/support/catalog-test-env.ts`, `tests/integration/migration-constraints.test.ts`, `tests/integration/private-order-snapshot.test.ts`, `tests/integration/public-catalog.test.ts`, `tests/integration/delivery-replacement.test.ts`, `tests/integration/spa-api-routing.test.ts`
- Create/modify: Order persistence/route/CORS/Console integration test files under `tests/integration/`
- Create/modify: Storefront and Console Orders browser contract tests under `tests/browser/`
- Create: `tests/e2e/storefront-orders.spec.ts`, `tests/e2e/console-orders.spec.ts`
- Modify: `playwright.config.ts`, `package.json`, Worker/Storefront deployment configurations as required by the final topology
- Update only if deployment workflow needs it: `README.md` — separate Storefront local/remote commands and explicit S1–S3 anonymous-demo risk

## Implementation Steps

1. Run focused migration and Workerd integration coverage first: schema invariants, S1 resolver regression, captured-revision interleaving conflict, server price authority, normalized Customer reuse/history, atomic rollback, idempotency including lost-response retry, private capability denial, projection redaction, CORS, and retention.
2. Run browser contracts for Storefront and Console Orders state/accessibility boundaries.
3. Run Playwright with real distinct Storefront/API origins: Console edit then Storefront refetch; Simple and Variant Order journeys; retry without duplication; private URL reload; rejected capability/origin; Console Orders deep link/navigation and mobile rendering. Assert raw capability is absent from static/API request URLs and telemetry-visible error text.
4. Run broader typecheck, full test suites, and both independent production builds. Fix regressions; do not weaken existing S1 privacy/retention tests.
5. Before remote mutation, inspect account/resources and preserve S1 identities. Apply only the append-only Orders migration, provision/reuse the persisted Storefront static Worker, deploy Storefront to obtain its exact origin, configure/deploy the Nexus API Worker CORS allowlist, then smoke both origins.
6. Record only sanitized verification evidence. Never commit customer email, private URL, raw capability, private object key, or deployment credentials. Generate cleanup only from a validated private fixture manifest and retain every key referenced by an Order snapshot.

## Todo

- [x] Prove persistence, atomicity, CORS, privacy, and S1 regressions locally.
- [x] Prove both Customer journeys and Console visibility under two origins.
- [ ] Build/typecheck all changed surfaces and deploy in dependency order.
- [x] Capture sanitized evidence and safe cleanup boundaries.

## Success Criteria

- [x] Every approved S2 outcome has focused local evidence and a corresponding cross-surface journey.
- [ ] No test or remote smoke finds partial Order state, duplicate Order, stale snapshot after captured-revision conflict, monetary authority leak, private-field/capability leak, broad CORS, or catalog-history mutation.
- [ ] Storefront and API deployments are independent, share only the API/catalog contract, and work at their configured origins.
- [x] Existing S1 catalog/import/file/privacy behavior remains green.

## Risk Assessment

- One-origin E2E cannot prove CORS. Treat a real two-origin test as mandatory evidence.
- Remote tests can leave Customer/Order references that make R2 cleanup ambiguous. Generate fixtures with exact identities and never delete a snapshot-referenced object.

## Security Considerations

- Use demo fixtures only. Redact email, capability, Order private URL, private-file key, and credentials from logs, screenshots, reports, and cleanup artifacts.
- Do not report anonymous Console as protected; S4 remains the owner of identity/permissions.
