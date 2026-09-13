# Phase 8 rollback hardening

Date: 2026-09-12
Runtime: Node v22.16.0
Remote operations: none

## Behavioral Red

The focused Node test discovered two behavioral failures after valid setup: the rehearsal returned no staged/drop/restoration fault evidence, and the invariant gate did not throw when post-reapply preservation was false.

## Green behavior

The raw Wrangler rehearsal now creates one populated schema-9 checkpoint and runs three failed 0010 variants against it:

1. failure after all five staging tables are populated;
2. failure after the child/parent tables are dropped;
3. failure after late payment restoration.

Each faulted file is a disposable copy of the checked-in migration with one invalid statement inserted at the named boundary. A failed copy is never used for retry. After all abort proofs pass, retry uses the exact untouched `migrations/0010-refund-decisions.sql` through the repository root Wrangler config.

The checkpoint digest covers SQLite tables, indexes and triggers; every protected row; migration ledger; assignment history, assignment command and current assignment; and R2 evidence. R2 object keys and object contents have distinct digest arrays. Raw keys and contents are never emitted.

After each abort, the runner requires exact schema/data/R2 digest equality, the unchanged 0001-0009 ledger, the complete assignment graph, and zero raw Wrangler foreign-key rows. It then requires exact 0001-0010 ledger state, protected pre/post preservation, pending Refund preservation, legacy paid-without-payment preservation, and unchanged complete state after no-op reapply. Any false invariant throws before result output, so the named command exits nonzero.

## Local barrier, checkpoint, and abort boundary

The local writer barrier is the unique disposable persistence directory created for the run. Only the sequential rehearsal owns it. The schema-9 digest is its checkpoint, and the three verified transactional rollbacks are its abort evidence. This is local evidence only and cannot be used as proof of deployed writer quiescence, a remote checkpoint, or remote rollback readiness.

## Validation

- Focused Red: 2 behavioral failures, 4 skipped.
- Focused Green: 2 passed, 4 skipped.
- Complete Node file: 6/6 passed in 46.98s.

Status: DONE
Summary: Three statement-boundary raw migration faults now prove complete populated schema-9 rollback, and the named rehearsal fails closed on every recorded invariant.
Concerns/Blockers: No local blocker. Remote barrier/checkpoint/mutation evidence remains intentionally absent.
