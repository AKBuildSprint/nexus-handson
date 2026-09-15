---
title: "Secure Console owner bootstrap and invitations"
description: "Move first-owner admission and later owner invitations into the Nexus Google identity boundary, while updating all live production origins to the cppai workers.dev host."
status: pending
priority: P1
effort: "4 phases"
tags: [auth, identity, database, console, deployment]
blockedBy: []
blocks: []
created: 2026-09-15
---

# Secure Console owner bootstrap and invitations

## Outcome

Nexus starts safely after an empty production migration: the configured initial owner can complete Google OAuth once, and later active owners can create manually shared, one-time, expiring links that admit another `owner`. Google remains the identity authority; Nexus owns Store-scoped authorization.

The production Console and Storefront hostnames move from the legacy `cpp-software-solutions.workers.dev` subdomain to `cppai.workers.dev` before any deployment.

## Approved contract

- `INITIAL_OWNER_EMAIL` is a Worker secret. Only its verified Google identity can bootstrap `store_nexus`, and only before the bootstrap claim has succeeded.
- “Admin” is the existing `owner` role. No role, password login, Store picker, multi-Store membership, email provider, or public signup is added.
- An active owner creates a copyable invite link for one normalized email. The raw token is returned once, stored only as a digest, expires, is single-use, and must match the email returned by Google OAuth.
- The invite carries its token in a URL fragment; the client sends it in the OAuth initiation body, not as a server-visible query string or Google referrer.
- The Console keeps only Products and Orders as destinations. Owner management is a narrow non-routed interaction.
- `disableSignUp`, disabled account linking, disabled ID-token sign-in, current session DTO, Storefront API, and fresh membership resolution remain unchanged.

## Architecture

```text
Console owner panel ── POST invite ──> Worker adapter
                                  └──> @nexus/identity invitation command
                                           └── D1: hashed invitation

Google OAuth profile ──> Worker auth adapter ──> @nexus/identity admission command
                                                     ├── bootstrap claim + owner binding
                                                     └── invite consume + owner binding
                                                           │
Better Auth disabled-signup lookup <── bound account + active membership
                                                           │
Existing validateUserInfo ───── second fail-closed verification
```

## Public-contract changes

- New Worker secret: `INITIAL_OWNER_EMAIL`.
- New owner-only Console API for issuing invitation links. It returns the raw link only on creation; no token is persisted or logged.
- A fragment invitation link augments the existing Google social sign-in POST. Its opaque token is not a role, email, or bootstrap flag.
- A new append-only migration creates bootstrap and invitation persistence. Existing membership and Better Auth tables are not rewritten.
- Production origins become:
  - Console/API: `https://nexus-handson-console.cppai.workers.dev`
  - Storefront: `https://nexus-handson-akbuild.cppai.workers.dev`

## Compatibility and blast radius

- Existing provisioned Google users follow the unchanged callback path. Unknown users remain denied unless they satisfy the one-time bootstrap or an unconsumed invitation.
- Role permissions, Storefront CORS behavior, and the session response retain their current contracts.
- Historical plans, evidence, generated distribution assets, and legacy smoke scripts retain their recorded legacy URLs; only live source configuration, production build input, and deployment documentation are updated. Builds regenerate generated artifacts.
- Before deployment, Google OAuth must register the new exact Console origin and callback URL:
  `https://nexus-handson-console.cppai.workers.dev/api/auth/callback/google`.

## Phases

| # | Phase | Status | Depends on |
|---|---|---|---|
| 1 | [Production origin cutover](./phase-01-start.md) | Pending | — |
| 2 | [Identity admission persistence and OAuth bridge](./phase-02-identityadmission.md) | Pending | 1 |
| 3 | [Owner invitation interaction](./phase-03-ownerinvitations.md) | Pending | 2 |
| 4 | [Verification and deployment readiness](./phase-04-verification.md) | Pending | 1–3 |

## Success criteria

- [ ] All active production origin inputs use the `cppai.workers.dev` URLs; Google OAuth configuration is updated before deployment.
- [ ] Only the configured, verified Google email can create the initial `store_nexus` owner, exactly once under concurrent callbacks.
- [ ] Active owners can issue an expiring, single-use owner invitation without exposing its raw token after issuance.
- [ ] Invitation redemption requires the exact verified Google email, creates one bound Google account and active owner membership, and rejects expiry, replay, revocation, and email mismatch.
- [ ] Existing OAuth admission, session isolation, owner/staff permissions, Console navigation, and Storefront behavior have focused regression proof.

<!-- slug: secure-owner-bootstrap-and-invites -->