# Phase 8 S4 cross-layer acceptance evidence

- Date: 2026-09-12 Asia/Ho_Chi_Minh
- Runtime: Node v22.23.2
- Scope: local Workerd integration only; no remote or deployment operation
- Test file: `tests/integration/s4-acceptance.test.ts`
- Command: `npm run test:workerd -- tests/integration/s4-acceptance.test.ts` inside a pinned Node 22 `npx` environment
- Result: 1 file passed, 3 tests passed, 0 failed

## TDD record

The implemented Phase 3-6 behavior was expected to be green, so the matrix was treated as characterization rather than given a manufactured Red. Two initial failures were test prerequisites and were not counted as behavioral evidence:

1. A crossed schema-preview request used an incomplete body and returned `422`; the fixture was corrected to a valid schema-preview request, after which the foreign Product target returned `404`.
2. The first assertion assumed all private resource families shared the literal `not_found` code. Catalog uses `product_not_found` while Orders use `not_found`; the acceptance invariant was corrected to the shared concealed `404` response with no crossed identifier or reference in the body.

## Scenario evidence

| Test | Scenario IDs | Evidence |
|---|---|---|
| `S4-01/29/32/39 preserves Store A while crossed Store B catalog, import, file, Order, and Origin attempts fail closed` | S4-01, S4-29, S4-32, S4-39 | Creates independent Store A/B Owners, same-system catalogs and retained import objects; crosses Store A slug, ID, schema preview, file PUT/DELETE and Order reference through Owner B and receives concealed `404`. Missing, hostile and cross-site Console mutation origins return `403 origin_not_allowed` without Store A mutation. Store A rows and R2 associations remain exact. A Store B Console cookie does not alter the public Store A catalog. |
| `S4-02/31/35/40/41/44/45/46/49 enforces assigned Staff work and Owner-only decisions while retaining Customer-safe evidence` | S4-02, S4-31, S4-35, S4-40, S4-41, S4-44, S4-45, S4-46, S4-49 | Unassigned Staff receives an empty zero-count inbox, concealed detail/action and no ledger. Foreign-Store Staff assignment fails without a row. Owner assignment enables exact Staff summary/detail and manual-pay/Fulfill actions; Staff assignment and Refund approval remain forbidden. Owner approval preserves the exact paid Order/payment row, purchased line snapshot and R2 object. Customer capability reads the approved then fulfilled truth through a recursive privacy allowlist; a wrong capability remains `404` even with a valid Console cookie. |
| `S4-34/41/43/47 approves a legacy paid Order without fabricating payment evidence or rewriting its actor history` | S4-34, S4-41, S4-43, S4-47 | Builds a current-schema Order with a contract-1 `order_completed` event and no payment row. Customer request plus Owner approval succeeds. Owner rename and membership revocation do not rewrite the legacy event or durable decision actor. Customer still sees the safe approved status; payment count remains zero and recursive output excludes internal actor/history/capability fields. |

## Characterization intentionally reused

The new file does not duplicate fault-injection suites. Existing focused integration files remain the owning evidence for:

- S4-10/S4-18/S4-26: concurrent Refund winner, replay authorization and statement-boundary rollback in `refund-decisions.test.ts`.
- S4-12/S4-27: commit-time membership loss plus R2 import/file compensation and retention in `catalog-store-isolation.test.ts`, `import-lifecycle.test.ts`, and `delivery-replacement.test.ts`.
- S4-30: Staff Product create/schema/import/file denial, including unread request bodies, in `catalog-store-isolation.test.ts`.
- S4-33: populated migration/raw-Wrangler manifest proof remains owned by the separate Phase 8 rehearsal gate.

## Limits

This artifact establishes the cross-layer local integration matrix only. It does not establish browser presentation, raw-Wrangler migration rehearsal, provisioning repeatability, deployed state, or remote smoke authorization.
