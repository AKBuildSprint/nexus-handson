---
phase: 4
title: "Verification and deployment readiness"
status: pending
priority: P1
effort: ""
dependencies: [1, 2, 3]
---

# Phase 4: Verification and deployment readiness

## Overview

Prove the new admission state machine and origin cutover without deploying. Deployment remains blocked until the external Google OAuth configuration and required Worker secret are set.

## Requirements

- Test bootstrap, invitation, OAuth, authorization, schema, Console, and responsive behavior at their existing test layers.
- Run the repository’s affected test suites, typechecks/builds, and production import graph from the root.
- Inspect every changed public contract and affected caller for unintended session, role, origin, or Storefront effects.
- Before deployment, set `INITIAL_OWNER_EMAIL` to the authorized initial address and configure Google OAuth with the new Console origin and callback; do not claim this as deployed without remote proof.

## Related Code Files

- Modify: `docs/google-console-login.md`
- Modify: `README.md` if the Phase 1 documentation update needs a cross-link
- Modify/create: focused tests under `tests/unit/`, `tests/integration/`, `tests/browser/`, and `tests/e2e/`
- Inspect: `.github/workflows/deploy-console.yml`, root `package.json`, `wrangler.jsonc`

## Implementation Steps

1. Add migration/schema tests for bootstrap claim and invitation state constraints; add domain tests for idempotency, concurrency, replay, expiry, revocation, mismatch, and failed-write recovery.
2. Extend Google OAuth integration/runtime tests to prove pre-lookup admission and unchanged behavior for already provisioned/unauthorized identities.
3. Add Worker/Console/browser coverage for owner-only issuance, fragment handoff, session quarantine, 375 px no-horizontal-scroll, and primary-action token colors.
4. Run focused tests, then root workerd/browser suites, Console and production Storefront builds, and the production import-graph assertion. Address all new failures before reporting readiness.
5. Review changed contracts and documentation. Check active source for legacy production hosts; only then present the external pre-deploy checklist without performing a deployment.

## Success Criteria

- [ ] All affected automated suites pass and every state transition has regression proof.
- [ ] Build output uses the new Console origin; no deploy command is run.
- [ ] Documentation accurately describes bootstrap/invitation security and the Google OAuth + Worker-secret prerequisites.
- [ ] A review finds no new public-contract break, role escalation path, Store isolation bypass, or token disclosure.

## Risk Assessment

The highest residual risk is environment mismatch: Cloudflare hostname, Google OAuth redirect registration, and Worker secrets must agree exactly. The observable signal is `redirect_uri_mismatch`, bootstrap denial, or cross-origin refusal; response is to stop deployment, compare exact values, and retest the production-shaped build before attempting a remote release.
