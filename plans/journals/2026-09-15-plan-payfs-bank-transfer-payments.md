---
title: Plan PayFS bank-transfer payments
date: 2026-09-15
summary: Created and red-teamed the conditional PayFS payment plan; cron/recheck remain blocked on provider contract and remote readiness.
---

# Plan PayFS bank-transfer payments

## What happened
- Created reviewed plan `plans/260915-1512-payfs-bank-transfer-payment/` from the accepted PayFS brainstorm.
- Scouted the current Order, Worker, Console, Storefront, migration, and test seams.
- Red team found and the plan now covers credential rotation, VND/positive eligibility, resumable reconciliation, recheck authorization receipts, email idempotency/unknown states, reminder suppression, public-email budgets, and remote S4 gates.

## Decision
- Use PayFS `transaction.credit` plus scheduled reconciliation only after PayFS provides exhaustive bounded query semantics.
- Store beneficiary settings in Worker secrets; use per-recipient and privacy-preserving source budgets.
- Unknown Resend delivery after its idempotency window requires authorized operator resolution; never blind resend.

## Next steps
- Obtain PayFS query contract, rotated credentials, signed fixture, verified Resend sender, beneficiary display values, and remote S4 readiness evidence before implementation or live enablement.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
