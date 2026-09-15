---
phase: 3
title: "Owner invitation interaction"
status: pending
priority: P1
effort: ""
dependencies: [2]
---

# Phase 3: Owner invitation interaction

## Overview

Expose a narrow owner-only Console interaction that issues a manually shareable invitation link for another owner, without adding an administration destination or an email-delivery dependency.

## Requirements

- Only an authenticated active owner may issue an invitation for `store_nexus`.
- Invitation input is one target email; the granted role is fixed to existing `owner`.
- The raw token is returned only in the create response, appears in a fragment link, and is never shown in lists, logs, or persisted client state after the owner dismisses the result.
- The recipient’s existing Google sign-in client forwards the fragment token in its same-origin POST initiation body and removes the fragment from the visible URL.
- Owner/staff session behavior, existing route union, and Products/Orders navigation remain intact.

## Related Code Files

- Modify: `apps/worker/src/console-route-match.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/console-session-routes.ts` only if a minimal owner capability projection is genuinely needed
- Modify: `apps/console/src/auth-client.ts`
- Modify: `apps/console/src/production-console-app.tsx`
- Modify: `apps/console/src/layout/console-shell.tsx` or the existing account/session control component
- Modify: Console styles through existing tokenized files only
- Modify/create: Worker route, Console contract, browser, and E2E tests

## Implementation Steps

1. Define the owner-only invitation issue request/response contract and add an exact Worker route that resolves the existing session context, rejects non-owners, and delegates creation to `@nexus/identity`.
2. Add a compact owner account-panel interaction rather than a route/nav item: normalized email input, issue action, one-time copyable fragment link, explicit expiry, error state, and clear-on-dismiss behavior.
3. Extend the Google sign-in client to extract an invitation token only from the login fragment, remove it from the address bar, and pass it as opaque additional data during social sign-in initiation.
4. Preserve mobile behavior at 375 px, tokenized primary action colors, keyboard access, and the existing private-state/session quarantine semantics.
5. Cover unauthorized route calls, malformed inputs, copied-link output/redaction, fragment forwarding/clearing, and recipient OAuth state handoff.

## Success Criteria

- [ ] An active owner can issue and copy a one-time link; staff and anonymous callers cannot.
- [ ] The token never appears in API list data, persisted UI state, normal URL query parameters, or application logs.
- [ ] Login with a valid fragment invitation completes the guarded admission path; all other Google sign-ins remain denied unless already provisioned.
- [ ] No Console destination besides Products and Orders is introduced.

## Risk Assessment

Invitation links are bearer capabilities. The observable signal is a token in a query, log, persisted storage, referrer, or repeated response; response is to fail the path, use fragment-only transport plus digest storage, and make the raw value available exactly once.
