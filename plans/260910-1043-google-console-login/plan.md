---
title: Google Console login
status: completed
priority: P1
effort: medium
branch: main
tags: [auth, console]
created: 2026-09-10
---

# Google Console login

Status: implementation, automated verification, local Google configuration and live allowed-account sign-in completed. Exact verified-email allowlisting is implemented, with empty configuration denying access.

## Outcome and constraints

Add Google-only sign-in, durable sessions and sign-out to the existing single-store Console. Authenticate every private API request. Preserve existing catalog/orders/history and public Storefront capability behavior. Use Better Auth on the existing Cloudflare Worker/D1, React/Vite and existing design tokens. Preserve pre-existing uncommitted currency-formatting changes.

## Non-goals

No email/password, customer login, roles, memberships, multiple stores, assignment, refund decisions, payment automation or deployment.

## Implementation

- [x] Add the focused auth package with Better Auth 1.7.3, native D1 integration, Google provider, exact email allowlist and uncached sessions. Append migration `0008-console-google-auth.sql`; apply it to primary local D1 after a verified SQLite backup.
- [x] Protect private Worker routes and mutation origins. Use the verified user's ID for new Console Order actions and preserve historical bootstrap actors.
- [x] Add the Google sign-in screen, loading/error states, session expiry handling and account/sign-out control using existing tokens.
- [x] Adapt authenticated test fixtures and existing callers, add auth boundary and UI tests, and document Google setup and intentional private API contract changes.

## Acceptance and verification

- [x] Only Google OAuth is enabled; configuration absence fails closed.
- [x] Only verified, allowed emails can access the Console; removing an email invalidates its access even with an existing session.
- [x] All private API route families reject absent/expired/revoked sessions; client actor/store fields cannot grant access. Cross-origin mutations are rejected.
- [x] D1 sessions survive requests, sign-out revokes them, and cookies remain HttpOnly with production Secure settings.
- [x] Existing data and public Storefront read/create/private-order workflows remain intact; new Order actions record the authenticated user. All 16 original domain table snapshots/hashes matched after migration, and SQLite integrity passed.
- [x] Login/session errors are usable and the 375px UI has no horizontal overflow; primary actions use accent/ink tokens.
- [x] Automated gates pass: 194 workerd tests across 31 files in the isolated install; final 61 browser tests across five files in primary; all 27 E2E scenarios across the full run and two targeted reruns; primary typecheck and Console/Storefront builds. Final source review reported no findings after verifying the OAuth error-route fix. Live Google consent is not claimed by these checks.

All four implementation steps and seven automated acceptance items are complete. This plan intentionally has no phase files. See the [completion report](../reports/pm-260910-1043-google-console-login.md), [setup guide](../../docs/google-console-login.md) and [session journal](../journals/2026-09-10-google-console-login.md).

## Risks and rollback

Existing local dev processes may lock dependencies; do not stop user-owned processes without confirmation. Existing tests assume anonymous Console access and need genuine test sessions, not a production bypass. Keep auth additions append-only; roll back code independently, retaining auth tables and existing domain rows. Secrets and DB exports stay ignored.

Primary `npm ci` encountered `EBUSY`; isolated `npm ci` succeeded and dependencies were restored without stopping the user's servers. Locked native binaries matched the verified copies by hash. Five high-severity audit findings remain in inherited Cloudflare/sharp tooling; no forced dependency upgrades were made. Verification processes were stopped; original user servers remained. No remote mutation, deployment or commit was performed.

## Open setup

The ignored `.dev.vars` contains the Google OAuth client configuration and authorized operator email, retaining the generated Better Auth secret and local Console origin. An unauthenticated session check returns `401 authentication_required`; initiating Google OAuth returns HTTP 200, Google's authorization origin, the expected local callback, and only `email profile openid` scopes. Live Google consent and token exchange subsequently succeeded; Products and Orders loaded, and the session survived a browser reload.

A later blank-page incident was traced to stale Vite dependency version URLs: React and Better Auth requests timed out, while the current dependency hash loaded successfully. Forcing dependency optimization and then restoring the original Vite configuration repaired the served imports. All checked dependency requests returned 200. Live browser verification showed five Products, six Orders, and no captured warnings/errors. The original dev server was reused; no permanent Vite configuration change was needed.

- [x] Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `CONSOLE_ALLOWED_EMAILS` following the [setup guide](../../docs/google-console-login.md), then reload the Console server configuration.
- [x] Verify real Google consent with an allowed account and session persistence after reload.
- [ ] Verify sign-out and rejection of an unlisted account against live Google; automated coverage is already complete.

Never include secrets, session cookies or backup contents in reports or commits.
