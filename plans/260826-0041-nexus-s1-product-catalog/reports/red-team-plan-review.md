# Red-team plan review

## Initial verdict

`FAIL` before corrections.

## Findings and applied corrections

| Severity | Finding | Correction applied |
|---|---|---|
| High | Approved design and raw brainstorm competed as acceptance authorities. | Phase 3 now creates `design/reconciled-acceptance-manifest.md`; Phase 6 verifies against it. Fixed S1 decisions remain sticky; browser-visible reconciliation changes require renewed approval. |
| High | 500-row JSON bulk strategy was unproven until after most implementation. | Phase 3 now pins parser, proves exact 500-row payload/statement/rollback behavior locally and probes remote D1 JSON support before Phase 4. |
| High | Variant membership schema could not reject cross-Product/group relationships at DB boundary. | Phase 4 now specifies composite parent keys/FKs and migration-level bypass tests; triggers own 5/10/30 caps. |
| High | Fatal file validation, expected Product-group rejection and D1 batch failure had conflicting R2/D1 semantics. | Phase 5 now defines three explicit failure classes and 400/413, 200 and 500 outcomes. |
| High | CSV row count could bypass Cartesian 30-combination cap or create sparse active schema. | Phase 5 derives distinct option values, requires exact full Cartesian row coverage and applies 11/30/31 to derived count. |
| High | Phase 5 required remote 500-row proof before Phase 6 deployment. | Phase 5 now owns local/workerd worst-case proof; Phase 6 solely owns remote representative acceptance. |
| Medium | Worker name persisted but D1/R2 creation was not crash-repeatable. | Phase 3 derives/persists Worker, DB and bucket names before mutation and defines list/create/recovery commands. |
| Medium | Preview-fixture removal ownership was split between Phases 3 and 4. | Phase 3 now owns production-entry isolation plus import-graph assertion; Phase 4 only preserves/checks it. |
| Medium | Remote verification fixture cleanup had no executable route. | Phase 6 now writes a fixture manifest and uses direct Wrangler D1/R2 cleanup commands; no public delete API added. |
| Medium | Repeat-deploy criterion had one deploy only. | Phase 6 now runs a second no-change direct deploy and compares URL/D1/R2 identities. |
| Medium | Import result was called durable without row-outcome persistence/GET route. | Phase 5 narrows row outcomes to immediate POST response; `imports` persists metadata/counts only. |

## Whole-plan stale terms removed

- Raw brainstorm as final acceptance authority.
- Raw Variant-row count as the matrix limit.
- “On any server validation failure” without classifying expected group rejection.
- Phase 4 ownership of preview-provider deletion.
- Remote 500-row success in Phase 5.
- Cleanup “through public Console” without a delete route.

## Final status

**Status:** DONE
**Summary:** All blocker/high and actionable medium findings were incorporated into plan/phase files. Ready for whole-plan consistency sweep and AgentKit CLI validation.
**Concerns/Blockers:** CSV 500-row remote performance remains an explicit Phase 6 gate. workers.dev and public Console risks remain accepted, not solved.
