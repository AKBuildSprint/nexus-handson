---
type: scenario
date: 2026-09-12
title: "Nexus S4 identity and Store isolation scenarios"
mode: one-shot
status: proposed-not-executed
source: ./brainstorm-260912-0038-nexus-s4-identity-store-isolation.md
---

# Scenario Report: Nexus S4 identity and Store isolation

## Summary

This one-shot report defines concrete verification targets for the [saved brainstorm](./brainstorm-260912-0038-nexus-s4-identity-store-isolation.md) and [S4 brief](../../session-4-brief.md). These are proposed scenarios and expected outcomes, not observed bugs or passing tests. Severity describes the consequence if the expected behavior is violated; it does not estimate likelihood.

All 12 dimensions apply. The report retains the confirmed rules: Staff reads only assigned Orders, Products are read-only for Staff, and one Refund Request per Order remains final after decision in S4. D1 Store-scoped access is the recommended architecture, not an implemented capability.

## Scope and contract

- **Outcome:** establish concrete failure, boundary, and happy-path targets for sharing the populated Nexus Store safely with a second person.
- **Constraints:** preserve Store A data, historical provenance, Customer capabilities, snapshots, and retained R2 references; enforce server-side permissions; retain public Store A ordering.
- **Non-goals:** implementation, test execution, deployment, money movement, S5 automation, MCP, self-service team administration, and new deletion APIs.
- **Acceptance for this report:** cover each relevant dimension with 3–5 concrete scenarios, identify severity and observable outcomes, retain the agreed product boundaries, and verify scenario IDs/counts and acceptance traceability.

## Dimensions analyzed

1. **User Types:** existing Owner, newly assigned Staff, orphaned/revoked identity, and unauthorized provisioning.
2. **Input Extremes:** malformed command input, long/unusual text, forged authority, and injection payloads.
3. **Timing:** reassignment, competing decisions, lost responses/idempotency, and membership revocation.
4. **Scale:** scoped pagination/summaries, cardinality boundaries, populated query behavior, and abusive request volume.
5. **State Transitions:** identity changes in one browser, replay after access loss, final decisions, and invalid Order/request states.
6. **Environment:** 375 px layout, assistive technology, cookie/origin configuration, and interrupted connectivity.
7. **Error Cascades:** failed identity lookup, partial command writes, R2/database failures, and interrupted migration/cutover.
8. **Authorization:** crossed-Store resources, Owner-only actions, Customer capabilities, CSRF, and same-Store unassigned Orders.
9. **Data Integrity:** populated migration, legacy actor history, invalid references, and repeat provisioning.
10. **Integration:** Better Auth in Workers, stale clients, public Store routing, and decision contracts across layers.
11. **Compliance:** privacy minimization, secret-safe diagnostics, audit provenance, and existing retention obligations. This is not a claim of GDPR or other legal certification.
12. **Business Logic:** assigned processing, approval versus execution, missing legacy payment evidence, and protected removals.

**Dimensions skipped:** none. S5 webhooks/payouts, formal erasure workflows, and new administration APIs remain outside this feature; their exclusion does not remove Integration, Compliance, or User Types from coverage. Feature-scale volume and latency targets are not specified in the brief and must be defined during planning rather than invented here.

## Fixture and observation conventions

Use an isolated populated D1/R2 rehearsal, not production customer records or a reset of Store A. Include:

- Existing Store A (`store_nexus`) with Owner A, Staff A1, and Staff A2; separate Store B with Owner B and Staff B.
- A valid account without membership and accounts whose memberships can be revoked/demoted through controlled fixture setup; this does not imply an administration UI.
- Pending, paid, fulfilled, and canceled Orders; A1-assigned, A2-assigned, and unassigned Orders; existing pending Refunds; real manual-payment evidence and legacy paid Orders without evidence.
- Distinct Customer capabilities and colliding Store-local Product slugs/SKUs. Never put raw credentials or private capability URLs in the report or evidence logs.
- At least two independent sessions for races and a reused browser for identity-switch tests. Use fresh fixtures for independent decision outcomes because the decision is final.

Observe HTTP status/body, UI-visible state, authoritative domain records, command/audit multiplicity, and relevant R2 references. A hidden button or an HTTP success alone is not proof. Follow existing API error contracts; denied requests must not expose private fields. Concurrent operations must have a coherent commit ordering, not an impossible guarantee that already-completed work can be undone.

## Scenarios

### User Types

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-01 | User Types | Existing Store A Owner signs in for the first time after S4 migration and opens an old paid Order and its history. | High | The same Store A records, IDs, snapshots, and payment evidence are accessible. Sign-in does not create a replacement Store or reseed data. |
| S4-02 | User Types | New Store A Staff has no assignments, then Owner assigns one pending Order; Staff reloads Orders and Products. | High | Initially show an empty assigned inbox, not all Store Orders. After assignment show that Order and accurate totals; Products remain read-only. |
| S4-03 | User Types | A valid authenticated account has no membership, a removed membership, or a membership pointing to an unavailable Store. | Critical | Deny private access without bootstrap fallback or selecting the first Store. Do not create membership automatically from email or successful login. |
| S4-04 | User Types | Tutor provisioning attempts to reuse an existing login identity for a different Store/role, or a guest calls account-creation endpoints directly. | Critical | Provisioning must not silently repurpose or elevate an account. Public signup is disabled; credential identity alone never grants Store membership. Explicitly configured multi-membership, if supported, requires validated Store selection. |

### Input Extremes

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-05 | Input Extremes | Assignment/decision requests contain missing IDs, nulls, malformed percent-encoding, unknown action strings, or unsupported extra fields. | High | Reject invalid commands with bounded errors and no assignment, decision, or audit mutation. Follow existing error contracts; never reinterpret missing Store identity as Store A. |
| S4-06 | Input Extremes | A person name, Product title, or existing Refund reason contains long Unicode text, bidirectional characters, or the maximum supported length. | Medium | Render safe text without breaking controls or 375 px layout. Preserve existing valid data; enforce declared limits on new input without inventing arbitrary truncation. |
| S4-07 | Input Extremes | Staff submits Owner role, another actor ID, Store A ID while signed into B, or approved status inside a normal Order-edit payload. | Critical | Authority comes exclusively from verified identity/membership and the named domain action. Reject unsupported authority/state fields; no mass-assignment bypass. |
| S4-08 | Input Extremes | Attacker supplies SQL fragments in IDs/search/cursors and HTML/script payloads in names or Refund reasons, then views them in both apps. | Critical | Treat query values as data and rendered content as text. No broadened result scope, executed script, leaked session, or state change from malformed input. |

### Timing

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-09 | Timing | Staff A1 loads an assigned Order, Owner reassigns it to A2, and A1 submits fulfillment while the reassignment is committing. | Critical | Use a coherent atomic ordering: A1 may succeed only if its authorized mutation commits before reassignment. Once reassignment wins, A1 cannot mutate; no read-check/unconditional-write gap. |
| S4-10 | Timing | Two Owner sessions submit Approve and Reject for the same pending Refund Request concurrently using different command keys. | Critical | Exactly one decision and one decision audit event persist. The conflicting request fails without overwriting the winner; Order/payment state does not change. |
| S4-11 | Timing | A decision commits but its response is lost; the Owner retries the same command repeatedly, then reuses its key with a different decision/body. | High | Authorized identical retries return the recorded outcome without duplicate effects. Reusing a key for changed intent conflicts and cannot alter the original decision. |
| S4-12 | Timing | Membership revocation or Owner-to-Staff demotion commits between session resolution and a protected write from an already-open tab. | Critical | A protected write must not rely on a stale role snapshot after revocation wins. Enforce the current membership at the mutation boundary and invalidate subsequent privileged actions. |

### Scale

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-13 | Scale | Staff paginates/searches an inbox containing many other assignments; a cursor copied from Owner or Store B is submitted as Staff. | Critical | Every page and filtered summary uses current Store and assignment visibility. A foreign/tampered cursor cannot broaden access; do not reveal other users’ counts or use stale authorization embedded in a cursor. |
| S4-14 | Scale | Assigned inbox has zero Orders, one Order, exactly a page, and one more than a page; the last item is reassigned away between requests. | High | Empty/next/previous states remain usable and current counts reflect authorized rows. No inaccessible phantom detail or permanent pagination trap after reassignment. |
| S4-15 | Scale | A large populated Store is queried with a sparse Staff assignment and payment-reference search. | High | Scope/filter before pagination, use bounded requests, and keep summaries server-derived. Planning must define a representative volume and latency target; no performance pass is claimed without measurement. |
| S4-16 | Scale | Automated clients send repeated invalid sign-ins and public Order submissions while Owner and Staff are working. | High | Use the selected auth library’s configured abuse controls and preserve existing public input/idempotency limits. Return explicit bounded failures rather than unbounded work or private fallback; public access must not require a Console session. |

### State Transitions

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-17 | State Transitions | Owner A signs out and Staff B signs in in the same browser while an old A detail request is still in flight; the user also uses Back. | Critical | Clear A private state and discard old-generation responses. B must not see A content resurrected by a response, client cache, or restored page; fresh requests enforce B scope. |
| S4-18 | State Transitions | A formerly assigned Staff member replays a previously successful command key after reassignment or session expiry. | Critical | Check present identity and resource authorization before looking up/returning a stored result. Do not leak the old result or repeat its effect; existing durable history remains intact. |
| S4-19 | State Transitions | After rejection, Customer and Console-on-behalf both try another Refund submission; repeat after approval. | High | Both paths retain the original request and final decision, with no second request or renewed pending state. Authorized submission retries return the recorded request; conflicting decisions remain refused. |
| S4-20 | State Transitions | Caller requests a Refund on pending/canceled Order or tries to decide an absent/already-decided request. | High | Enforce Order and request state independently from role. Invalid transitions have no effect; a terminal decision cannot be reopened or flipped through another endpoint. |

### Environment

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-21 | Environment | At 375 px, long person/Store names and Refund messages appear with assignment controls and sign-out navigation. | Medium | No horizontal page scroll or hidden primary action. Preserve existing tokenized accent fill/ink, readable state labels, and Products/Orders navigation only. |
| S4-22 | Environment | A keyboard-only or screen-reader user signs in, selects an assignee, confirms Reject, and encounters a server denial. | High | Controls have clear names; focus reaches and returns from dialogs; errors and final outcomes are announced. Pending states prevent accidental duplicate intent without trapping focus. |
| S4-23 | Environment | Local localhost and 127.0.0.1 configurations or deployed HTTPS origins differ; the browser blocks or does not send the session cookie. | High | Show a recoverable sign-in failure, never anonymous private access. Verify real cookie/trusted-origin settings for each supported environment without relaxing them globally. |
| S4-24 | Environment | Connectivity drops during sign-in, assignment, or approval and the browser reloads before the response is known. | High | Do not announce success from local intent or queue a new privileged mutation automatically. Restore current server state after reconnect and reconcile any authorized retry with the original command identity. |

### Error Cascades

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-25 | Error Cascades | The auth/session or membership lookup fails because D1 is unavailable while public assets remain served. | Critical | Private operations fail closed with a recoverable service error. No bootstrap Owner, cached-role bypass, or implicit Store A fallback; no private payload in the error. |
| S4-26 | Error Cascades | Fault injection fails a statement between assignment/decision persistence, audit insertion, and command-ledger recording. | Critical | Rollback the entire domain mutation. The observable result is all committed once or none committed, not a decision without attribution or a success ledger without its business effect. |
| S4-27 | Error Cascades | An Owner delivery-file upload reaches R2 but its Store-scoped database association fails, or an unauthorized Staff upload attempts to reach R2. | Critical | Authorize before consuming/uploading the private mutation. On association failure preserve old references and snapshots; compensate only the new unreferenced object, never another Store’s or a purchased object. |
| S4-28 | Error Cascades | A populated schema migration fails, or the old anonymous Worker continues writing during the identity/schema cutover. | Critical | A rehearsed writer barrier/checkpoint prevents mixed-writer corruption. Stop the cutover on failure; do not roll back to an anonymous/incompatible writer or reset data to make migration pass. Preserve public service outside the explicitly controlled cutover window. |

### Authorization

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-29 | Authorization | Owner B and Staff B submit known Store A IDs, slugs, Order references, Variant IDs, and delivery-file targets to every private read/write/preview/import path. | Critical | All paths enforce Store scope before returning private resource or validation details. Return unavailable/not-found for out-of-scope resources; no R2 side effect or cross-Store mutation. |
| S4-30 | Authorization | Assigned Staff calls Refund decision, assignment, Product edit, CSV import, delivery-file PUT/DELETE, or schema replacement directly without using the UI. | Critical | The central evaluator refuses every Owner-only action. Alternative methods and indirect removal paths cannot bypass read-only Products or Owner-only decisions; unsupported deletion APIs remain unsupported. |
| S4-31 | Authorization | A guessed capability, another Order’s valid capability, and a Customer capability sent to Console routes are tested, including alongside an unrelated valid Console cookie. | Critical | Private Customer access requires the exact matching capability. Console requires its own identity and membership; neither credential upgrades the other or broadens resource scope. No-match responses reveal no private Order data. |
| S4-32 | Authorization | A malicious origin submits cookie-bearing Console mutations and probes auth trusted-origin/CORS handling, including missing or null Origin variants. | Critical | A defined CSRF policy rejects unauthorized browser-origin mutations before effects. Do not treat CORS as authorization or add wildcard credentialed origins; preserve the explicitly supported first-party request forms. |
| S4-49 | Authorization | Staff A1 knows an unassigned Store A Order reference and another Order assigned to A2; calls detail, payment, fulfill, cancel, and Refund submission directly. | Critical | Same-Store membership is insufficient: deny private detail and every mutation on both Orders without disclosing their Customer/payment fields or writing a command ledger. Owner can still read and assign them. |

### Data Integrity

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-33 | Data Integrity | Run the forward migration against a populated S1–S3 fixture containing Variants, old Customer capabilities, pending Refunds, manual payments, and legacy paid Orders. | Critical | Compare pre/post records and relationships: preserve IDs, totals, references, hashes, snapshots, history, and retained R2 keys under store_nexus. Create no fabricated payments, fulfillment, or replacement Store A. |
| S4-34 | Data Integrity | Historical events have null actor IDs and legacy source/contract values; new user foreign keys and decision event checks are introduced. | Critical | Preserve truthful legacy provenance without assigning the new Owner to past anonymous activity. New authenticated events have real actors; old event constraints/references survive the migration. |
| S4-35 | Data Integrity | Assignment targets a nonexistent user, Owner rather than Staff, removed Staff, or Staff in Store B; a direct persistence attempt links a Refund/history record across Stores. | Critical | Application rules and appropriate relational constraints reject invalid references. Never leave a valid-looking assignment to an ineligible membership or cross-Store aggregate link. |
| S4-36 | Data Integrity | Store B provisioning is run twice and uses Product slugs/SKUs matching Store A; generated record IDs or account identifiers collide. | Critical | Provisioning is repeat-safe or fails explicitly without changing A. Store-scoped slugs/SKUs may coexist; global ID collisions cannot overwrite existing rows, credentials, or memberships. |

### Integration

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-37 | Integration | The selected Better Auth version/adapter works in Node but is exercised in the actual Workers runtime across sign-in, get-session, expiry, and sign-out. | High | The real D1-backed session lifecycle works with supported runtime APIs and migration ownership. An incompatible adapter blocks integration rather than falling back to an in-memory/demo identity. |
| S4-38 | Integration | A cached pre-S4 Console sends old headers/payloads or invokes former bootstrap paths after cutover. | Critical | Old clients cannot retain anonymous private access. Authentication precedes private disclosure/replay; incompatible requests receive a recoverable contract error or login requirement without side effects. |
| S4-39 | Integration | A browser signed into Store B opens the public Storefront, reads Products, and submits an Order with a forged Store field. | Critical | The public Storefront remains explicitly Store A. Ignore/reject unsupported routing fields rather than deriving Store from the Console cookie; create only the intended A Order and expose no private B data. |
| S4-40 | Integration | Approve and Reject results travel through domain, API client types, Console detail, and existing private Customer page; an old pending request is opened after deployment. | High | Every layer reads the same persisted state and renders supported statuses. No pending-only type/parser drops decisions; existing pending requests remain usable and Customer output stays separate from Console output. |

### Compliance

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-41 | Compliance | Compare Customer and public responses before/after assignment and decision when Console holds person names, history, notes, and payment evidence. | Critical | An explicit Customer-safe projection includes the relevant decision but excludes Staff/Owner identity, internal notes/history, delivery configuration, and Console-only payment evidence. Public catalog reveals none of the private Order. |
| S4-42 | Compliance | An auth or capability lookup fails and diagnostic logs, error bodies, analytics hooks, or copied URLs could capture credentials. | Critical | Do not log session cookies, passwords, raw capabilities, private Order URLs, or unnecessary Customer PII. Keep the capability in its existing fragment/header channel and errors safe to share. |
| S4-43 | Compliance | The deciding Owner later changes display name or loses membership; an auditor opens the old decision. | High | The durable decision retains its real actor identity and timestamp without rewriting history or confusing it with the requester. No account-deletion UI is required; provenance must survive supported identity changes. |
| S4-44 | Compliance | Owner replaces/removes catalog delivery content after an earlier purchase while a Refund remains approved but unexecuted. | Critical | Preserve the purchased immutable snapshot and referenced private object under existing retention rules. S4 approval must not trigger file destruction, access revocation, or a claim of completed reversal. |

### Business Logic

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|---|---|---|---|
| S4-45 | Business Logic | Owner assigns a pending Order to Staff; Staff records its manual payment, then fulfills it, and attempts cancellation after payment. | High | Valid assigned processing succeeds with the real Staff actor and existing ledger/transition rules. Invalid cancellation fails even though Staff remains assigned; the Customer sees the corresponding safe Order state. |
| S4-46 | Business Logic | Owner approves a Refund for a paid Order and separately for a fulfilled Order, then both apps reload. | Critical | Refund is approved and awaiting execution; each Order retains its prior paid/fulfilled status. No payment reversal, refunded status, S5 job execution, or implied money movement occurs. |
| S4-47 | Business Logic | A legacy paid Order has no original payment ledger evidence, and Owner decides its Refund Request. | High | The S4 decision can be recorded without inventing a payment source/reference. Preserve the legacy evidence gap for S5; neither UI promises automatic repayment nor migration manufactures evidence. |
| S4-48 | Business Logic | An Owner uses a permitted removal operation against protected referenced data, or Staff tries an equivalent removal through another mutation. | Critical | Owner authority does not bypass existing snapshot/FK retention guards. Staff read-only/Owner-only rules cover indirect mutation paths; do not add new destructive APIs solely to demonstrate denial. |

## Severity summary

- **Critical:** 30
- **High:** 17
- **Medium:** 2
- **Low:** 0
- **Total:** 49 scenarios across 12 dimensions. Authorization has five scenarios; each other dimension has four.

This is one-shot coverage, not an iterative saturation result or a quantitative assurance score.

## Acceptance traceability

Each group maps to the seven expanded acceptance criteria in the source brainstorm. These references identify the principal evidence paths, not separate proof of success.

1. **Populated migration:** S4-01, S4-28, S4-33, S4-34, S4-36, S4-47.
2. **Staff boundary:** S4-02, S4-09, S4-12, S4-13, S4-14, S4-18, S4-30, S4-35, S4-45, S4-49.
3. **Store isolation:** S4-03, S4-07, S4-13, S4-17, S4-27, S4-29, S4-35, S4-36, S4-39.
4. **Protected actions:** S4-12, S4-30, S4-32, S4-35, S4-48.
5. **Decision concurrency/finality:** S4-10, S4-11, S4-18, S4-19, S4-20, S4-26, S4-46.
6. **Customer/public continuity:** S4-16, S4-19, S4-28, S4-31, S4-33, S4-39, S4-40, S4-41, S4-44, S4-46, S4-47.
7. **UI/session behavior:** S4-05, S4-06, S4-17, S4-21, S4-22, S4-23, S4-24, S4-25, S4-37, S4-38, S4-42.

## Highest-priority planning risks

- **Authorization races and replay:** S4-09, S4-12, S4-18. An evaluator used only before an awaited operation is insufficient. Specify current membership/assignment enforcement at the commit boundary and authorization before replay disclosure.
- **Complete private-path cutover:** S4-29, S4-30, S4-38, S4-49. Include schema previews, revision/error paths, imports, and delivery-file mutations; protect more than the Order buttons.
- **Truthful populated migration:** S4-28, S4-33, S4-34. Preserve legacy actors and all referenced records; no new identity may be retrospectively presented as an authenticated historical actor.
- **One durable decision:** S4-10, S4-11, S4-19, S4-26. Terminal request uniqueness, atomic audit/ledger writes, and conflicting retries must agree across Customer and Console paths.
- **No money-return claim:** S4-44, S4-46, S4-47. S4 approval records permission to execute later, not execution or fabricated original-payment evidence.
- **Privacy beyond detail pages:** S4-13, S4-17, S4-31, S4-41, S4-42. Counts, cursors, cached responses, mixed credentials, and logs are part of the boundary.

## Verification handoff

Pass this report and the source brainstorm to `/ak:plan --hard`. Incorporate Critical and High scenarios into the plan's risks, migration rehearsal, and acceptance checks. Resolve implementation details against the existing contracts rather than treating suggested error wording as a new API specification.

Select verification at the real boundary:

- Use a populated migration rehearsal for S4-28 and S4-33 through S4-36, with before/after record and reference checks.
- Use real Worker/D1 integration paths for scoping, forbidden direct calls, membership/assignment races, atomicity, and idempotency. A frontend mock cannot establish these guarantees.
- Use real browser sessions for sign-in/sign-out, stale response handling, assigned workflows, Customer continuity, CSRF behavior, and accessibility/mobile checks.
- Exercise the selected auth adapter in Workers before claiming its session lifecycle is compatible.
- Retain permanent regression tests where a plausible bug violates a durable contract; this report does not require one permanent test per row. Do not write source-text assertions or treat hidden controls as an authorization test.

## Report validation

The report-generation check verifies unique scenario IDs, nonempty scenario/outcome fields, allowed severity labels, 12 covered dimensions with 3–5 rows each, severity totals, and valid scenario references in the handoff/acceptance sections. Local Markdown link targets are checked for existence.

This checks report structure and accounting only. No scenario was executed, no vulnerability was demonstrated, and no application, schema, or deployment change was made. Source facts are inherited from the linked brainstorm's inspected evidence; this report does not claim a fresh code or production audit.

## Unresolved questions and implementation prerequisites

No new product decision is requested. Staff scope, catalog permissions, and Refund finality remain as accepted.

- Planning must specify assignment/membership race guards and exact retry/error behavior consistent with existing API contracts.
- Define supported local/deployed origins, CSRF policy, and secure account provisioning without embedding credentials in fixtures.
- Select and rehearse Better Auth/D1 versions in Workers.
- Choose a representative large-Store dataset and measured latency target for S4-15; the brief supplies neither a benchmark nor a scale SLA.
- Verify backup/checkpoint, writer barrier, public continuity, and remote authorization before any deployment or populated remote migration.
