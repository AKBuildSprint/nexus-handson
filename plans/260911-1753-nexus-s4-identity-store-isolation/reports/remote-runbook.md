# S4 remote cutover runbook

Status: **FUTURE PROCEDURE — REMOTE CUTOVER BLOCKED**.

> **STOP BEFORE REMOTE MIGRATION.** This checkout can validate remote inputs without writes, but it does not yet implement remote identity provisioning or an authenticated remote S4 smoke apply. The mutation sequence below is a future implementation target, not an executable cutover awaiting authorization. It must be implemented, tested, reviewed, and then separately authorized against one concrete target before any remote schema mutation begins.

## Required operator record

Record these values in a private operator note before any remote proxy or write is created:

- authenticated Cloudflare account ID;
- exact Worker name, D1 database name and ID, and R2 bucket name, matched against `resource-identities.json`;
- exact deployed API/Console and Storefront HTTPS origins captured from live deployment output;
- the prior-writer drain owner, start time, abort deadline, and proof that anonymous S3 writers cannot restart;
- the authorized D1 checkpoint/export identifier created after the drain;
- the reviewed S4 artifact/commit and rollback-compatible artifact;
- references to Owner A, Staff A, Owner B, and Customer smoke credentials. Never paste their values into this report.

Stop if any identity or origin is missing, inferred, duplicated, or different from the recorded resource manifest.

## Read-only inspection

Run from the repository root under Node 22:

```sh
npx wrangler whoami
npx wrangler d1 list
npx wrangler r2 bucket list
```

This inspection does not authorize migrations, provisioning, binding-proxy creation, deployment, or smoke writes.

## Local and dry-run prerequisites

All local Phase 8 gates must be green against an isolated persistence root. The named `s4-provisioning` environment must resolve the exact existing `DB` and `FILES` identities and keep both bindings `remote: true`; its checked-in `.invalid` origins are deliberate fail-closed placeholders. Operator tools must receive the confirmed origins explicitly and must not treat those placeholders as usable targets.

Run the fixture and smoke commands in dry-run mode first. Dry-run must create no binding proxy, network request, credential, membership, fixture, or evidence write:

```sh
npm run verification:s4-fixtures -- init \
  --fixture-manifest "$PRIVATE_S4_FIXTURES" \
  --prefix "$PREFIX" \
  --base-url "$EXACT_API_ORIGIN" \
  --dry-run

npm run verification:s4-remote:smoke -- run \
  --fixture-manifest "$PRIVATE_S4_FIXTURES" \
  --prefix "$PREFIX" \
  --api-origin "$EXACT_API_ORIGIN" \
  --storefront-origin "$EXACT_STOREFRONT_ORIGIN" \
  --dry-run
```

Reject output containing passwords, session cookies, raw Customer capabilities, private Order URLs, delivery object keys, or Better Auth secrets.

## Future mutation sequence

Do not execute this sequence from the current checkout. Before seeking mutation authorization, implement and review a remote-capable server-only provisioner and an authenticated remote S4 smoke apply that use the exact named bindings without exposing credentials. Then obtain separate authorization for the concrete reviewed target, checkpoint, artifact, origin pair, credential references, and abort deadline.

1. Quiesce and drain every old anonymous writer. Verify the barrier immediately before the checkpoint and keep it active through migration, provisioning, deployment, and smoke.
2. Create the authorized D1 checkpoint/export. An export taken while writes are active is invalid.
3. Before migration 0011, query `account` for duplicate `(providerId, accountId)` and `(userId, providerId)` groups. Both queries must return zero rows; never delete or merge identity bindings automatically. Apply append-only migrations 0008 through 0011 to the recorded existing D1 database. Do not edit applied SQL.
4. Provision distinct Store A Owner/Staff and Store B accounts through the server-only operator command. Supply secret values through stdin or runtime environment input; do not put them in argv, shell history, reports, or source. Review dry-run immediately before apply.
5. Build and deploy the reviewed S4 artifact with the exact API/Console and Storefront origins. Never deploy the `s4-provisioning` environment.
6. Run the authenticated S4 smoke with the private fixture manifest. Confirm Owner, assigned Staff, Store B isolation, Customer terminal Refund continuity, and public Store A behavior.
7. Inspect sanitized evidence and keep the writer barrier until all critical checks pass.

## Abort and recovery

- Before migration: remove the barrier and restore ordinary serving if the target, checkpoint, origins, artifact, or authorization is incomplete.
- After any schema mutation: never restart the incompatible anonymous writer. Choose an explicit forward fix or restore the authorized checkpoint with a compatible artifact.
- On provisioning partial failure: preserve the Google binding result, rerun the exact identity intent, and rely on no-op/conflict rules. Never replace a Google subject or repurpose an account silently.
- On credential, capability, cookie, or object-key exposure: stop; rotate or revoke affected secrets; remove unsafe private artifacts; begin again from a fresh authorized checkpoint.
- On Store isolation, foreign-key, migration-ledger, or manifest mismatch: stop all new writes and choose forward fix or checkpoint restore before serving traffic.

## Evidence required before completion

- exact remote resource/origin comparison;
- writer barrier and checkpoint record;
- zero duplicate Google-binding groups, migration ledger through 0011, and empty `PRAGMA foreign_key_check`;
- redacted provisioning no-op/conflict outcome;
- redacted Owner/Staff/Store B/Customer/public smoke observations;
- final decision naming whether the barrier was released or recovery was invoked.

This runbook records a future procedure and stop conditions only. It is not an executable cutover sequence. No remote state, deployment, checkpoint, secret, or smoke result is claimed.
