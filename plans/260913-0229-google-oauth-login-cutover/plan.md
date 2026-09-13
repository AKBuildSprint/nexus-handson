---
title: "Replace Console email/password login with Google OAuth"
description: "Port only the Google OAuth login surface from PR #13 while preserving the completed S4 Store membership and authorization model."
status: completed
priority: P1
effort: 1d
issue: null
branch: main
tags: [auth, oauth, console, tdd]
created: 2026-09-13
---

# Google OAuth login cutover

## Outcome

Console users authenticate only through Google. A successful Google session still resolves through the existing Nexus user, active Store membership, Owner/Staff role, and permission policy.

## Scope

- Port the Google provider, OAuth endpoints, callback handling, and sign-in UI from PR #13 into the current S4 auth boundary.
- Adapt provisioning so an operator grants an exact Google email, verified Google subject, Store, and role without creating a password credential.
- Preserve the existing Better Auth tables and all Nexus membership, Store isolation, Order assignment, Refund, and session-quarantine behavior.
- Do not import PR #13's allowlist authorization, bootstrap Store context, auth package, migration, currency changes, or older Console boundary.

## Phase

| # | Phase | Status | Depends on |
|---|---|---|---|
| 1 | [Cut over authentication to Google OAuth](./phase-01-google-oauth-login.md) | Completed | Completed S4 implementation |

## Acceptance criteria

- [x] Email/password sign-in and signup endpoints are not exposed.
- [x] Google sign-in uses state, PKCE, the exact callback URL, and preserves Better Auth redirect/cookie headers.
- [x] Only a verified Google identity whose provider subject is prebound to an active Store membership receives Console access.
- [x] The resolved `userId`, Store, role, and `allowedActions` remain supplied by the existing S4 membership boundary.
- [x] Sign-out, session expiry, revoked membership, cross-Store denial, and private-state quarantine retain their current behavior.
- [x] Focused auth/browser tests, the S4 acceptance suite, typecheck, build, migration rehearsal, and E2E pass locally.
