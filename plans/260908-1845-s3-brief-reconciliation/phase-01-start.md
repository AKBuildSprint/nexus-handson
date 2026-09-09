---
phase: 1
title: "Phase 1: Populated schema and audit migration"
status: pending
priority: P1
effort: ""
dependencies: []
---

# Phase 1: Populated schema and audit migration

## Goal and authority

Build append-only 0006/0007 migrations that preserve existing S1–S3 data while enabling [contracts C1–C4/C7](./contracts.md). This phase does not deploy a partially migrated application.

## Evidence / insights

- `migrations/0005-order-operations.sql:27,83-88,187-216,234,246`: current state CHECKs, monetary FK, one-line/one-ever constraints and terminal history index all conflict with the new brief.
- `tests/support/catalog-test-env.ts:9-108`: migration splitter strips PRAGMA; reset defaults to version 5.
- Existing schema rebuild pattern is reusable. Existing 0004->0005 tests are not populated 0005->0007 proof.

## Files / ownership

Create `migrations/0006-order-brief-contract.sql`, `migrations/0007-manual-payments.sql`, `tests/integration/order-brief-migration.test.ts`.
Modify `tests/support/catalog-test-env.ts`, `tests/integration/migration-constraints.test.ts`, `tests/integration/order-operations-migration.test.ts`.
No product/variant/import/R2 schema changes. Do not edit 0001–0005.

## Implementation steps

1. Add migration-aware fixture setup through versions 4,5,6,7; latest reset=7. Full latest drop topology: order_commands -> payments -> order_history -> order_refund_requests -> order_idempotency -> order_access -> order_lines -> orders -> current Customer/Catalog sequence; use DROP IF EXISTS across old versions. Preserve hook signatures. Historical migration fixtures become SQL/schema-version-only: remove live createOrder/completeOrder imports/calls from order-operations-migration.test.ts. Phase2 owns replacement live post-migration Create proof in orders-persistence.test.ts; phase3 owns migrated zero-total Paid/Fulfill proof in order-commands.test.ts. Seed old status/history with explicit legacy SQL; no backwards dependency on new runtime code.
2. In 0006 stage seven Order graph tables, drop existing line triggers and dependent tables child-first, rebuild Orders/lines/access/Create-idempotency/refunds/history/commands, copy with explicit column lists, recreate essential constraints and drop staging. Keep customers/catalog untouched.
3. Orders: canonical status CHECK/default, stable NP internal payment_reference with global uniqueness, unique money tuple for future payment FK, unique currency tuple for line FK. Backfill mapping exactly C7; new random internal refs are not bank refs.
4. Lines: keep complete private/public snapshot columns; add position=0 to old lines. Remove exactly-one UNIQUE and per-line=Order-total FK; use deferred `(order_id,store_id,currency)` parent FK, unique position. Add parent INSERT aggregate check (1–10, exact total, same currency), child INSERT refusal when parent already exists, child UPDATE/DELETE freeze and parent monetary UPDATE freeze. Triggers install only after restoration. Do not assume SQLite has deferred aggregate triggers; use existing line-before-parent transaction ordering.
5. History: preserve old id/action/source/time, mapped status/from_status and version=1. Add actor_id (legacy null), contract_version, nullable refund_request_id with Store/Order FK. New version=2 event tuples are NULL-safe and enforce legal from/to/source per C1. Legacy tuples are read-only acceptance for restored rows, not new runtime commands. Replace terminal uniqueness with paid-or-canceled decision slot, separate fulfilled event, unique refund event per non-null request ID. Backfill existing refund history by Store/Order to its sole stored request.
6. Refunds: preserve id/reason/time and pending status; use one-open partial UNIQUE instead of one-ever UNIQUE; add actor_source/actor_id for new submissions and mark historical provenance accurately (Storefront source inferred from existing history, no user identity). Add unique `(id,order_id,store_id)` for history/command result FKs. S4 will widen status/index, no decisions now.
7. Commands: preserve version-1 fields/hashes/keys/history links. Add contract_version default 2 and nullable result_refund_request_id (backfilled on old refund commands); action CHECK distinguishes legacy complete from live mark_paid/fulfill/cancel/request_refund. No version-1 data deletion, no legacy HTTP replay bridge.
8. In 0007 create empty payments with full C2 ledger, foreign keys, unique successful Order settlement and external-reference constraints; create remaining list/status/customer/history/refund/payment lookup indexes omitted from 0006 to honor batch limits. Payment history_id is unique and scoped to the exact Order. No synthetic payment rows for old completed Orders.
9. Count parsed statements including migration bookkeeping before execution; each file <=50 for existing test tier. Preserve essential constraints within 0006; use 0007 for payment/index additions. Do not split one graph rebuild across commits. If actual parse exceeds budget, combine compatible indexes/constraints or redesign within two files and rerun failure rehearsal; never silently omit integrity checks.

## Verification / success

Run `npm run test:workerd -- tests/integration/order-brief-migration.test.ts tests/integration/order-operations-migration.test.ts tests/integration/migration-constraints.test.ts` after phase ownership is quiescent.

Permanent regression cases:
- Populated 0005->0007 retains all original IDs/references/totals/timestamps/private snapshots/capability digests/Create keys/command hashes and pending request; completed->paid, zero inserted payments/fulfilled events.
- Order's generated paymentReference remains identical on reread/restart/reapplying migration framework; global uniqueness enforced.
- Runtime constraint failure after destructive/rebuild midpoint aborts 0006 atomically; schema5 and data still valid, marker absent; same retry succeeds.
- Failure in 0007 preserves fully applied 0006; retry 0007 succeeds without data reset. This is NOT all-files atomic rollback.
- Populated schema7 with linked refund history/commands/Payment can reset and migrate again; no referenced-parent DROP failure. Schema-only phase1 gate stays independent of phase2/3 runtime.
- Two valid lines commit; zero/11 lines, wrong sum/currency, cross-Store parent, post-commit line insert/update/delete/reparent and amount edits fail.
- New paid and fulfillment history can coexist; same decision/event duplicate fails; migrated completion does not block future fulfill.
- Foreign-key check empty, staging absent, latest migration marker present. Preserve historical migration tests at their intended schema version; remove only assertions that incorrectly demand latest schema reject `paid`/two lines.

## Tasks

- [x] Implement preserving append-only Order graph migrations
- [x] Prove populated migration and failure recovery

## Risks / handoff

Do not apply to working local or remote database here; integration fixtures only. Phase 2 consumes schema7; phase 3 consumes ledger/actor constraints. Phase 6 owns actual inventory/backup/rollout. Application is not deployable between phases 1–5.
