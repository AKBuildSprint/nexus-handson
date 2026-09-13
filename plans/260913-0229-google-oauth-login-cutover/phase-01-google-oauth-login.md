# Phase 1: Cut over authentication to Google OAuth

Status: Completed locally on 2026-09-13. Real Google consent, remote provisioning, migration, deployment, and smoke remain separate rollout work.

## Context

- [S4 identity implementation](../260911-1753-nexus-s4-identity-store-isolation/plan.md)
- [Source PR #13](https://github.com/AKBuildSprint/nexus-handson/pull/13)

## Files

- Modify `apps/worker/src/auth.ts`, `apps/worker/src/index.ts`, and `apps/worker/src/environment.ts`.
- Modify `apps/console/src/auth-client.ts`, `apps/console/src/sign-in-screen.tsx`, and the narrow auth call site in `apps/console/src/production-console-app.tsx`.
- Modify `scripts/provision-s4-identities.ts` to provision a Google-ready identity without a password.
- Update focused auth, provisioning, browser, and E2E tests.
- Add an append-only account-binding uniqueness migration and update the smallest setup/runbook documentation surface.

## TDD sequence

1. Red: change focused tests to require Google-only route exposure, OAuth state/PKCE/callback behavior, prebound Google-subject identity, and rejection without active membership.
2. Green: configure Google in the current Better Auth factory and pass OAuth responses through the current Worker route without replacing S4 context resolution.
3. Green: replace the email/password form with the Google action while retaining current session quarantine, role rendering, Store identity, and sign-out behavior.
4. Green: change the local provisioner from password credentials to a Google-ready user plus membership; keep remote apply blocked.
5. Refactor: remove credential-only helpers and tests after all callers are migrated; retain one authoritative auth factory and enforce canonical Google bindings in D1.

## Validation

- Focused integration tests for auth runtime, Console auth routing, provisioning, and S4 acceptance.
- Browser contract tests at 375 px for sign-in, callback failure, sign-out, expired/revoked session, and identity changes.
- `npm run typecheck`
- `npm run build`

## Risks and rollback

- Unsafe implicit account linking could attach Google to the wrong local user. Disable implicit linking and provision the verified Google subject directly against the existing user ID; callback profile email must still match the provisioned user email and active membership.
- OAuth needs exact origin/callback configuration and Worker secrets. Missing configuration must fail closed without affecting Storefront routes.
- Roll back the auth/UI changes together. Migration 0011 is append-only and must remain applied once deployed; rolling application behavior back does not require deleting its uniqueness indexes.
