---
title: Google OAuth login cutover
date: 2026-09-13
summary: "Replaced Console email/password login with prebound Google OAuth while preserving Nexus Store memberships and Owner/Staff authorization."
---

# Google OAuth login cutover

## Context

The user limited PR #13 reuse to its Google login behavior. The completed S4 identity, Store isolation, role, assignment, Refund, and session boundaries remained authoritative.

## What happened

Configured Better Auth for Google-only sign-in, exposed only social sign-in, Google callback, and sign-out, and replaced the Console credential form with a Google action. Provisioning now binds a verified Google subject to the existing Nexus user before creating its active Store membership and creates no password.

Added append-only migration 0011 to enforce one user per Google subject and one Google subject per user. Provisioning reconciles concurrent attempts and removes a newly created user only when account linking failed and the user still has no account, session, or membership. The Playwright harness now preserves one signing secret across worker processes and synchronizes successful identity replacement across tabs.

## Decisions

Reused only PR #13's provider configuration and OAuth response behavior. Rejected its allowlist authorization and older Console boundary. Disabled signup, direct ID-token sign-in, and implicit account linking. Google authenticates the person; Nexus membership remains the authorization source.

## Validation

TDD started with a failing Google OAuth integration contract. The final local gates passed: 230 workerd tests, 62 browser tests, production build/typecheck/import graph, 6 populated rehearsal tests through migration 0011, and 30 Playwright E2E tests.

## Remaining rollout work

A real Google consent callback, duplicate-binding preflight on the target D1 database, remote migration, verified-subject provisioning, deployment, and remote smoke remain separate operations. No remote state changed and no commit was created.

> Historical work record — not durable authority. Prefer current docs, migrations, and tests for active behavior.
