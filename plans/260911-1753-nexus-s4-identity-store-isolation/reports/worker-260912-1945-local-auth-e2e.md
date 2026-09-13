# Local auth E2E infrastructure report

## Outcome

- Added a Node-only local binding helper that validates an absolute isolated persistence root, maps the Wrangler/Vite root to the proxy `v3` directory, disables remote bindings, and disposes the proxy in `finally`.
- Added real local Owner and Staff provisioning through `provisionCredentialAccount`, persisted memberships, and a public catalog sentinel that proves the fixture proxy and browser-served Worker share the same local D1 state.
- Added real sign-in/sign-out browser coverage and a 375 px horizontal-overflow assertion.
- Updated Playwright to check deterministic ports before startup, refuse reuse of existing servers, keep runtime credentials out of source, and disable/purge test artifacts for credential-bearing runs.
- Added a test-only Console Vite persistence override while retaining `.wrangler/state` for ordinary local development.

## TDD evidence

- RED: the valid resolver fixture returned the CLI root for `proxyPersistPath`; the behavioral assertion expected `<root>/v3` and failed with an actual/expected path mismatch.
- GREEN: the focused Console auth E2E suite passes all three tests against the real local Worker, D1 state, and browser session flow.

## Validation

- `npx playwright test tests/e2e/console-auth.spec.ts --project=console` — 3 passed.
- `npm run typecheck` — passed.
- `git diff --check -- scripts/verification/local-binding-context.ts tests/support/console-auth-fixtures.ts tests/e2e/console-auth.spec.ts playwright.config.ts apps/console/vite.config.ts` — passed.
- Ports 5173 and 5174 had no listener after Playwright teardown.

Status: DONE
Summary: Local authenticated browser infrastructure now provisions real Owner and Staff identities into the exact persisted state served by Console, verifies real session entry and exit, and fails safely on occupied ports.
Concerns/Blockers: None.
