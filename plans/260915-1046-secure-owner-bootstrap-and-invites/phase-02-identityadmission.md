---
phase: 2
title: "Identity admission persistence and OAuth bridge"
status: in-progress
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: Identity admission persistence and OAuth bridge

## Overview

Add package-owned, guarded D1 commands that admit an eligible Google identity before Better Auth’s disabled-signup lookup, then invoke them only from the authenticated Google profile seam.

## Requirements

- Preserve Better Auth Google `disableSignUp`, disabled account linking, token encryption, and existing `validateUserInfo` as a second admission gate.
- Bootstrap only when `INITIAL_OWNER_EMAIL` matches a verified normalized provider email and the bootstrap claim is unclaimed.
- Persist a dedicated per-Store bootstrap claim so concurrent first callbacks cannot create two initial owners, while later owner invitations remain allowed.
- Persist invitations with digest-only opaque tokens, Store/issuer/target email/role/expiry/revocation/consumption fields and guarded indexes.
- D1 guarded batches must either create the account, membership, and transition together or leave no authority; every recoverable failure gets a deterministic post-error read.

## Related Code Files

- Create: append-only migration under `migrations/`
- Create: focused identity admission/invitation command modules under `packages/identity/src/`
- Modify: `packages/identity/src/identity-types.ts` and package exports only when required by concrete consumers
- Modify: `apps/worker/src/auth.ts`
- Modify: `apps/worker/src/environment.ts`
- Modify: `apps/worker/src/index.ts` only to compose the new package inputs
- Modify: `scripts/provision-s4-identities.ts` if Google-account persistence moves behind the new package-owned primitive
- Modify/create: focused unit and integration tests under `tests/`

## Implementation Steps

1. Append schema for a one-time Store bootstrap claim and owner invitation records. Add constraints/indexes for digest uniqueness, valid state, issuer/store foreign keys, and guarded pending lookup. Do not alter applied migrations.
2. Extract or introduce a package-owned Google account + membership admission primitive using native D1 guarded batches, preserving subject/email uniqueness and idempotent existing identity behavior.
3. Implement bootstrap eligibility: verified Google email equals `INITIAL_OWNER_EMAIL`, Store is `store_nexus`, and inserting the Store bootstrap claim succeeds. Bind the provider `sub`, create the active owner membership, and reject all other first-login attempts.
4. Implement invitation eligibility/consumption: hash the supplied token, atomically require pending/nonexpired/nonrevoked/exact-email state, bind its provider `sub`, create the active owner membership, and mark the invitation consumed.
5. Wrap the built Google provider’s profile acquisition so the package admission command receives only provider-derived email verification, name, and `sub` before Better Auth looks up the account. Do not trust client-supplied role/email/bootstrap data.
6. Keep the existing callback validation query intact as a second gate. Map expected ineligible states to the existing denied login behavior without leaking invitation existence.

## Success Criteria

- [ ] Bootstrap succeeds only once for the configured verified Google email and is idempotent on a retried completed callback.
- [ ] Concurrent bootstrap attempts cannot establish two bootstrap owners.
- [ ] A subject/email conflict, unavailable Store, invalid secret configuration, expired/revoked/replayed invite, or nonmatching Google email creates no active authority.
- [ ] Existing provisioned Google identities continue through the unchanged callback/session path.

## Risk Assessment

Better Auth’s D1 adapter does not provide a true interactive transaction; hook order also rejects unknown users before normal signup hooks. The observable signal is an unbound identity, partial write, or callback denial after a purported admission; response is native D1 guarded batch plus durable post-error result reconciliation, never enabling signup or account linking.
