---
title: Google Console login
date: 2026-09-10
summary: Added Google-only Console authentication and preserved existing Storefront and data contracts.
---

# Google Console login

Implemented Google-only Console login with Better Auth 1.7.3, exact verified-email allowlist, durable D1 sessions and sign-out. Private APIs require a session and same-origin mutations; public Storefront capabilities remain unchanged. New Order commands record the verified user while old history remains untouched.

Native D1 integration replaced the community dialect after a runtime test exposed unsupported schema introspection. Independent review caught and verified the fix for OAuth state failures redirecting to a blocked error route. Existing Windows E2E query helpers now invoke Wrangler through Node so retry assertions execute.

The primary dependency install hit locked user dev-server files. Dependencies were installed and tested in an isolated copy, then restored without stopping the user's servers; the two locked native binaries matched the verified copies by hash. Local D1 was backed up before migration 0008, and all 16 pre-existing domain table snapshots were identical afterward.

Verification: 194 unit/integration tests passed; browser and E2E checks passed, including 375px overflow and action colors. Both production builds and typecheck passed. Real Google consent still requires OAuth credentials and allowed email configuration. No deployment or commit was performed.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
