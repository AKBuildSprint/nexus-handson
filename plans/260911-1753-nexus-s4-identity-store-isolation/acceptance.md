# S4 scenario-to-evidence map

Source: [49 scenarios](../reports/scenario-260912-0041-nexus-s4-identity-store-isolation.md). This table assigns verification ownership. Local execution evidence captured on 2026-09-12 is summarized below the table; remote execution remains unperformed. Source severity is retained: 30 Critical, 17 High, 2 Medium.

| Scenario | Severity | Phase | Primary evidence target and observable invariant |
|---|---|---|---|
| S4-01 | High | 8 | `integration/s4-acceptance.test.ts`: Owner sees unchanged Store A manifest |
| S4-02 | High | 5,7 | `integration/order-assignment.test.ts`, `e2e/console-auth.spec.ts`: empty -> assigned inbox, Products read-only |
| S4-03 | Critical | 2,3 | `integration/identity-schema.test.ts`, `integration/console-auth-routes.test.ts`: absent/revoked membership denies |
| S4-04 | Critical | 1,2,8 | auth runtime + provisioning tests: signup disabled, conflicting identity never repurposed |
| S4-05 | High | 5,6 | assignment/decision integration: bounded malformed/null/unknown-field failures, no writes |
| S4-06 | Medium | 7 | browser contracts + 375px visual observation: Unicode text safe/readable |
| S4-07 | Critical | 4,5,6 | catalog/assignment/decision integration: forged actor/Store/role rejected |
| S4-08 | Critical | 4,5,7 | real D1 query plus browser tests: SQL data stays data; HTML payload renders text |
| S4-09 | Critical | 5 | assignment integration: barrier-controlled reassignment vs processing has coherent winner |
| S4-10 | Critical | 6 | `integration/refund-decisions.test.ts`: approve/reject race one status/event/ledger |
| S4-11 | High | 6 | refund decisions: lost-response identical retry; changed body/key intent conflicts |
| S4-12 | Critical | 3,4,5,6 | auth/catalog/command integration: demotion/revocation before commit yields no privileged effect |
| S4-13 | Critical | 5 | `integration/console-orders.test.ts`: scoped pages/search/counts/copied cursors |
| S4-14 | High | 5,7 | assignment + browser tests: 0/1/25/26 results, reassigned-away edge remains navigable |
| S4-15 | High | 5,8 | isolated benchmark report: 10k/200 fixture, separate p95/rows-read/query-plan facts |
| S4-16 | High | 1,8 | auth handler limiter + existing public create bounds/idempotency under repeated requests |
| S4-17 | Critical | 7 | `e2e/console-auth.spec.ts`: delayed A response/sign-out/B sign-in/Back never restores A |
| S4-18 | Critical | 5,6 | command integration: current auth before normal, post-commit and error-recovery replay |
| S4-19 | High | 6 | decision + Customer route integration: terminal request returned unchanged on submission retry |
| S4-20 | High | 6 | decision integration: invalid Order/request state no effect or reopened request |
| S4-21 | Medium | 7 | 375px real-browser observation: no horizontal page scroll; action fill/ink tokens |
| S4-22 | High | 7 | keyboard/browser tests + manual assistive check: focus, dialogs, error announcements |
| S4-23 | High | 1,3,7 | handler + real browser: exact local/test origins, cookie attributes/refresh forwarding, recoverable mismatch |
| S4-24 | High | 7 | browser: interrupted mutation reload/refetch; no false success or automatic retry |
| S4-25 | Critical | 1,3 | D1 fault through auth routes: safe 503, no bootstrap fallback/private error fields |
| S4-26 | Critical | 5,6 | real D1 batch fault injection: effect/event/ledger all once or all absent |
| S4-27 | Critical | 4 | `integration/delivery-replacement.test.ts`, `integration/import-lifecycle.test.ts`: auth before R2, guarded association, committed/unknown CSV outcome retains original; only proven rollback/absence permits compensation |
| S4-28 | Critical | 8 | `node/s4-populated-rehearsal.test.ts` under standalone Node config + populated raw-Wrangler CLI gate: isolated local writer barrier, complete schema-9 checkpoint and three abort proofs |
| S4-29 | Critical | 4,5 | catalog/private Order route matrix: foreign IDs/slugs/references/previews/import/files concealed |
| S4-30 | Critical | 4,5,6 | direct Staff route matrix including import preview/template/apply and PUT/DELETE file paths |
| S4-31 | Critical | 3,6,8 | mixed credentials integration: capability matches exactly; no Console upgrade |
| S4-32 | Critical | 1,3 | hostile/missing/null Origin + Fetch Metadata tests: no cookie-authenticated effect |
| S4-33 | Critical | 2,6,8 | populated raw migration manifests: IDs, snapshots, evidence, R2 object-key digests and object-content digests preserved |
| S4-34 | Critical | 2,6 | migration assertions: historical null actors/source/contracts unchanged |
| S4-35 | Critical | 2,5 | FK and domain guards: invalid same/foreign Store assignee or references rejected |
| S4-36 | Critical | 8 | Node-runner provisioning repeat/conflict tests: Store-local collisions allowed, global overwrite forbidden |
| S4-37 | High | 1,3,7 | real D1 handler/Worker + browser lifecycle: sign-in, due-refresh cookie extension, expired-session deletion, sign-out; denial paths preserve cookies, outage does not synthesize logout |
| S4-38 | Critical | 3,7 | anonymous old client routes and browser contract mismatch: no private fallback |
| S4-39 | Critical | 3,4,8 | Store B cookie + forged public Store: public create/read remain Store A |
| S4-40 | High | 6,7 | domain -> API -> both client types/views: pending/approved/rejected survive reload |
| S4-41 | Critical | 6,8 | recursive JSON privacy assertions before/after: no decider/Staff/internal/payment fields |
| S4-42 | Critical | 1,3,8 | sanitized error/log and artifact inspection: no cookies/passwords/capabilities/private URLs |
| S4-43 | High | 2,6 | rename/revoke Owner: durable original actor ID and event time, no history rewrite |
| S4-44 | Critical | 4,6 | file/snapshot integration: approved-but-unexecuted Refund never destroys retained purchase |
| S4-45 | High | 5,7 | real Owner assign -> Staff manual pay/fulfill; cancel-after-pay still denied |
| S4-46 | Critical | 6,7 | paid and fulfilled fixtures: approval waits for execution, Order/payment unchanged |
| S4-47 | High | 6,8 | legacy paid without payment: decision allowed, no fabricated repayment evidence |
| S4-48 | Critical | 4,8 | Owner removal retention/FK guard still applies, Staff indirect removal denied |
| S4-49 | Critical | 5 | same-Store unassigned/other-assigned direct detail/process/refund calls: concealed, no ledger |

## Local execution evidence

All commands in this section ran from the repository root under Node 22. Phase reports retain the detailed Red/Green/review record; this section links each scenario group to its permanent evidence rather than duplicating assertion output.

| Scenario coverage | Permanent evidence | Result |
|---|---|---|
| S4-03/04/12/16/23/25/31/32/37/38/42 | `tests/integration/auth-runtime.test.ts`, `console-auth-routes.test.ts`; Phase 1 and 3 reviewer reports | Included in full integration pass |
| S4-33/34/35 | `tests/integration/identity-schema.test.ts`, `refund-decision-migration.test.ts`; Phase 2 and 6 reports | Populated migration, retry, history and FK checks pass |
| S4-07/08/12/27/29/30/39/44/48 | `tests/integration/catalog-store-isolation.test.ts`, `delivery-replacement.test.ts`, `import-lifecycle.test.ts`, `private-order-snapshot.test.ts` | Store scope, revocation, uncertain outcome and retained-file boundaries pass |
| S4-02/05/07/09/12/13/14/15/18/26/29/30/35/45/49 | `tests/integration/order-assignment.test.ts`, `order-assignment-performance.test.ts`, `console-orders.test.ts`, `order-operations-routes.test.ts`; Phase 5 final review and performance report | Assigned-only scope, races, counts, commands and 10k/200 query evidence pass |
| S4-05/07/10/11/12/18/19/20/26/31/33/34/40/41/43/44/46/47 | `tests/integration/refund-decisions.test.ts`, `refund-decision-migration.test.ts`, `s4-acceptance.test.ts`; Phase 6 review | One final decision, replay, revocation, privacy, retention and legacy gaps pass |
| S4-02/06/08/14/17/21/22/23/24/37/38/40/45/46 | Browser suites and `tests/e2e/console-auth.spec.ts`, `console-orders.spec.ts`, `storefront-orders.spec.ts`; Phase 7 final blocker review | Real session lifecycle, delayed identity replacement, keyboard flow, Unicode and 375px observations pass |
| S4-01/28/33/36/42/47 | `tests/node/s4-populated-rehearsal.test.ts`, `scripts/verification/s4-populated-rehearsal.ts`; Phase 8 Node/operator and rollback-hardening reports | Baseline `a3a67f6` through schema7; three schema10 faults with exact schema-9 rollback, unchanged ledger and raw FK=0; exact checked-in retry/reapply; separate R2 key/content digests; secret-safe provisioning pass |
| S4-01/02/29/31/32/34/35/39/40/41/43/44/45/46/47/49 | `tests/integration/s4-acceptance.test.ts`; Phase 8 acceptance report | Three cross-layer acceptance cases pass |

Full local regression on 2026-09-12: unit 40/40, Node operator 6/6, integration 188/188, browser 62/62, and Playwright 30/30. Console and Storefront production builds passed. The named raw rehearsal separately reported migrations 0001–0010, three complete rollback checkpoints, preservation match, retry success, reapply no-op with post-reapply data equality, assignment/refund/legacy-gap preservation, and zero foreign-key violations. No remote resource was read or mutated by these gates.

## TDD evidence record

For each permanent test group retain: source scenario IDs, exact test path/name, baseline setup result, failing behavioral assertion (Red), passing implementation result (Green), refactor rerun, runtime version, sanitized DB/R2 observation when relevant. A fault-injection seam may interleave a real D1 revocation or force an actual batch statement failure; it must not replace persistence with fake success.

One test may cover several rows. All Critical/High rows require actual boundary evidence before local acceptance; Medium rows require the specified visual evidence as well. Structural table validation checks only IDs/severity/ownership, not application correctness.

## Unresolved questions

None for coverage allocation or membership cardinality; separate accounts per Store were confirmed on 2026-09-12. Runtime prerequisites remain tracked in [contracts](./contracts.md).
