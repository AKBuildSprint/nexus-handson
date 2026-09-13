---
type: brainstorm
date: 2026-09-12
title: "Nexus S4: Identity, Store isolation, assignment, and Refund decisions"
status: recommendation-ready
source: ../../session-4-brief.md
---

# Brainstorm: Nexus S4 identity and Store isolation

## Summary

Keep the existing D1 database. Add Better Auth for identity, one permission evaluator, and mandatory Store-scoped domain access. Preserve `store_nexus` as Store A without moving or reseeding its data.

This is an authorization cutover across the existing application, not a separate auth demo. S3 currently implements Refund requests only; S4 must add Approve/Reject decisions as well as protect them.

This report records repository evidence, the recommended design, and three permissions/lifecycle decisions explicitly confirmed by the user. It is not an implementation plan or proof that S4 has been implemented.

## Context and authority

- Primary brief: [Session 4 PRD](../../session-4-brief.md).
- S5 boundary: [Session 5 PRD](../../session-5-brief.md), which owns Refund execution and money-return confirmation.
- Existing package ownership: Worker handles HTTP and platform composition; domain rules, SQL, and command batches belong in packages. Catalog cannot depend on Orders; packages cannot depend on apps.
- The referenced `../session-4.md` teaching flow was unavailable during inspection. The supplied PRD and repository evidence were sufficient for this recommendation.

## Confirmed user decisions

1. **Staff sees assigned Orders only.** Apply this to inbox, search, detail, and summary counts, not merely mutation buttons.
2. **Staff has read-only Products.** Product edits, CSV imports, delivery configuration changes, and file mutations remain Owner-only.
3. **A Refund decision is final in S4.** Keep one request per Order. A rejected request does not reopen submission; an approved request waits for S5 execution. Retries return the recorded request rather than creating another.

The D1 architecture and implementation details below are recommendations, distinct from these explicitly confirmed decisions.

## Delivery contract

### Outcome

The Owner shares the actual existing Store with a signed-in Staff member, assigns real Orders, and retains protected decisions. Store A and Store B cannot cross private data boundaries. Public Customers continue creating Store A Orders and viewing their own private Order pages.

### Constraints

- Preserve existing Product, Variant, Customer, Order, Refund, payment, and history records.
- Preserve IDs, immutable purchase snapshots, Customer capabilities, and retained R2 object references.
- Bind Store A memberships to the existing `store_nexus` identity rather than reseeding or changing its identity.
- Add new migration files only. Do not rewrite applied migrations.
- Enforce identity, Store membership, assignment, and Owner-only permissions server-side.
- Keep Customer capability authorization separate from Console session identity.
- Keep domain operations and SQL in packages, with no generic shared package or compatibility layer.
- Keep root Wrangler configuration as the Console/API configuration owner and retain the separate Storefront configuration.
- Keep Products and Orders as the only Console destinations.
- Follow existing design tokens. Verify 375 px layouts and primary actions using `color-accent` fill with `color-accent-ink` text.

### Non-goals

- Moving money, confirming a Refund reversal, or setting an Order to Refunded.
- S5 payment automation, Product Access, reminders, or execution infrastructure.
- S6 MCP implementation.
- Self-service signup, invitations, team administration, or multi-Store administration UI.
- New general-purpose deletion APIs.
- Catalog redesign, new navigation destinations, or unrelated framework changes.

### Acceptance criteria

1. **Populated migration:** Store A Owner signs in and sees all existing data/history. Existing Customer links, purchase snapshots, payment evidence, and retained file references remain valid.
2. **Staff boundary:** assigned work succeeds. Unassigned Order detail, search results, and summary counts are unavailable or excluded; direct mutation and stale post-reassignment attempts are refused.
3. **Store isolation:** Store B cannot access or mutate Store A private resources through IDs, slugs, Order references, imports, or delivery-file operations.
4. **Protected actions:** Staff cannot decide Refunds or perform existing deletion/removal operations. Owner permission does not bypass existing integrity constraints.
5. **Decision concurrency:** competing Approve/Reject calls produce one durable decision and one decision audit event. Same-command retries return the recorded result; conflicting decisions fail. There is no money movement or reopened request.
6. **Customer/public continuity:** the matching capability sees the safe Refund decision. Another or guessed capability reveals nothing private. Public Product reads and Order creation continue targeting Store A.
7. **UI/session behavior:** session expiry and sign-out clear private client state. New screens/actions work at 375 px without horizontal scrolling and retain required primary-action tokens.

These extend, rather than replace, the six acceptance criteria in the S4 brief.

## Findings

### Console has no real identity boundary yet

[`apps/worker/src/console-order-routes.ts:38`](../../apps/worker/src/console-order-routes.ts#L38) creates an Order context using the bootstrap Store and an anonymous `bootstrap_owner` actor. Private reads and actions use that manufactured context.

[`packages/orders/src/transitions/order-transitions.ts:13`](../../packages/orders/src/transitions/order-transitions.ts#L13) currently accepts bootstrap Owner actions and Customer Refund submission. It does not implement real user membership or assignment permissions.

The Console shell also presents a generic Store operator rather than a signed-in person: [`apps/console/src/layout/console-shell.tsx:56`](../../apps/console/src/layout/console-shell.tsx#L56).

### Store-aware schema does not yet mean runtime isolation

The catalog identity is fixed to `store_nexus`: [`packages/catalog/src/catalog-read.ts:12`](../../packages/catalog/src/catalog-read.ts#L12). Catalog reads, writes, imports, and delivery-file operations require a coordinated Store-context cutover.

There is also hard-coded Store SQL in the Worker itself: [`apps/worker/src/console-product-routes.ts:109`](../../apps/worker/src/console-product-routes.ts#L109). A session guard alone would still route Store B users into Store A.

The existing schema already uses Store IDs and composite foreign keys extensively. The current platform binds one D1 database and one private R2 bucket, with no Durable Object namespace: [`wrangler.jsonc`](../../wrangler.jsonc).

### S3 has requests, not Refund decisions

The current Refund table permits only `pending`: [`migrations/0006-order-brief-contract.sql:160`](../../migrations/0006-order-brief-contract.sql#L160). The existing uniqueness constraint covers one pending request per Order, not the confirmed S4 rule of one request per Order across all decision states.

S4 therefore needs new decision commands, audit events, status/projection changes, and a forward migration. Expanding existing SQLite CHECK constraints requires a migration strategy that preserves populated rows and referencing records.

### Existing Customer access and command patterns are useful foundations

The Customer route validates a capability before private reads or Refund submission: [`apps/worker/src/storefront-order-routes.ts:114`](../../apps/worker/src/storefront-order-routes.ts#L114). The Customer projection is separate from the Console projection: [`packages/orders/src/queries/order-read.ts:335`](../../packages/orders/src/queries/order-read.ts#L335).

The command preparation path authorizes before idempotency-ledger replay: [`packages/orders/src/commands/order-commands.ts:73`](../../packages/orders/src/commands/order-commands.ts#L73). Preserve that ordering so a formerly authorized Staff member cannot retrieve a private replay after reassignment.

## Options considered

### Option A: Store-scoped D1 domain access — recommended

Retain existing storage and require validated Store context for all private domain reads and writes. Use one permission evaluator for Store membership, role, assignment, and action rules. Keep Store predicates and composite foreign keys as complementary protections.

- **Benefit:** preserves current data, command batching, schema investment, and deployment layout with the smallest cutover.
- **Trade-off:** isolation remains application-enforced. D1 does not provide RLS.
- **Load-bearing assumption:** every private operation goes through the Store-scoped boundary.
- **First plausible failure:** a new raw query or route bypasses that boundary and omits Store scoping.
- **Required response:** keep SQL in domain persistence, remove hard-coded private Store defaults, and exercise crossed-Store resources across every affected capability.

### Option B: Per-Store Durable Objects

Route each Store through a Durable Object boundary. A DO owning each Store's storage provides a stronger structural isolation boundary; a DO merely forwarding to the same D1 database still needs Store-scoped queries.

- **Benefit:** a storage-owning DO can make Store routing and serialization structural.
- **Trade-off:** introduces new routing, bindings, operational behavior, and populated-data migration work.
- **Load-bearing assumption:** all Store operations and data move behind the new boundary with no surviving bypass path.
- **First plausible failure:** incomplete cutover leaves old D1 routes available or splits a Store's data between paths.

**Recommendation:** choose Option A for S4. Be explicit in the tutor rehearsal that it demonstrates application-enforced isolation, not database RLS. Adding login alone is not a viable third option because it does not meet the Store-isolation contract.

## Recommended design

### Identity and session handling

Use Better Auth for provisioned email/password accounts, sessions, and sign-out. Keep Nexus Store memberships and business permissions explicit. Self-service signup and team administration are not necessary for the brief.

Better Auth documents [Cloudflare D1 through a Kysely community dialect](https://www.better-auth.com/docs/adapters/other-relational-databases). This supports the proposed direction, but does not prove the selected dependency version works in this repository's Workers runtime. Rehearse that integration before committing to the adapter configuration.

The request path is:

`Verified session → current Store membership → Store-scoped resource → central evaluator → domain operation`

- Do not accept role, actor ID, or authoritative Store identity from a request body.
- Unknown or expired identity fails closed.
- Cross-Store or unassigned resources return an unavailable/not-found result without leaking private fields.
- Console visibility is derived from server-evaluated permissions; hidden buttons are not enforcement.
- Recheck current authorization before returning idempotent results.
- Protect cookie-authenticated mutations against CSRF. Storefront CORS does not authorize Console actions.
- Avoid session or membership caching that would preserve revoked permissions unexpectedly. Better Auth's [session documentation](https://www.better-auth.com/docs/concepts/session-management) explains the revocation delay introduced by cookie caching.

### Central evaluator and domain ownership

Use one source of permission rules, not separate implementations in the browser, routes, and command layer. Console consumes server-produced allowed actions; APIs enforce the same evaluator against authoritative resource state.

Private domain entry points must require Store scope, including catalog reads, revision checks, schema previews, imports, file associations, Order queries, command ledgers, and mutations. Remove the hard-coded Store A assumption from these private paths. Keep the public Storefront deliberately mapped to Store A.

Reassignment and mutation must enforce current authority atomically, not through an earlier read followed by an unconditional write. The implementation plan must specify the database guards that close that race.

### Preserve Store A and historical attribution

Bind Owner and Staff memberships to `store_nexus`. Provision Store B separately with distinct accounts and fixture records; do not clone or reseed Store A.

Preserve earlier bootstrap history as historical bootstrap activity belonging to Store A. Do not rewrite anonymous events to pretend that the new Owner was authenticated at the time. New actions record the real user identity.

Preserve existing R2 keys and purchase-snapshot references. File ownership checks must use the Store-scoped database association rather than treating an object key or prefix as authorization.

### Assignment and Staff experience

Owner may assign or reassign an Order only to an active Staff member of the same Store. Staff may perform existing Order processing actions only while assigned, and subject to the existing Order transition rules.

Staff sees only assigned Orders. Inbox, search, detail, pagination, and server-produced summary counts must apply the same visibility filter. Do not reveal Store-wide totals or compute inbox metrics from only the current page.

Staff Products are read-only. Product edits, imports, delivery configuration changes, file mutation, assignment, and Refund decisions remain Owner-only. Existing integrity constraints remain effective even for Owner.

### Refund decision lifecycle

Add `pending → approved` and `pending → rejected`, recording the decision time and real Owner identity.

- One request per Order under the confirmed S4 policy.
- Concurrent Approve/Reject attempts produce one durable decision and one audit event.
- Same-command retries return the recorded result; conflicting decisions fail.
- A rejected request does not reopen Customer submission.
- An approved request blocks another request and waits for execution in S5.
- Approval leaves the Order Paid or Fulfilled and its payment evidence unchanged.
- Customer copy says **Approved — awaiting refund execution**, never **Refunded**.
- Customer output exposes the safe decision, not Staff identities, internal history, or internal notes.

No queue, payout, reversal adapter, or S5 execution machinery is required to persist the S4 decision.

### Public and capability-authorized actions

Keep public Product reads and Order creation explicitly available for Store A. Keep private Customer reads and Refund submissions capability-authorized. These Customer paths are neither unrestricted anonymous reads nor substitutes for Console identity.

A Console session must not broaden a Customer capability's scope. A Customer capability must never authorize a Console action.

## Documentation reconciliation

The implementation must update current documentation alongside the actual cutover:

- [`docs/design-guidelines.md:430`](../../docs/design-guidelines.md#L430) currently excludes login, sessions, and Owner/Staff controls. Reconcile those S1-era exclusions with S4 while retaining the design system and navigation constraints.
- [`README.md:33`](../../README.md#L33) and its accepted-risk section describe anonymous Console access. Change those claims only when the identity boundary actually exists.
- README currently groups Refund execution with S4. The S4 and S5 briefs establish that execution belongs to S5.
- Current agent guidance also describes Console Order actions as an anonymous bootstrap demo. Reconcile current-state guidance with the implemented S4 boundary rather than leaving contradictory claims.

Historical plans remain historical evidence; do not mass-rewrite them.

## Handoff and verification status

Recommended workflow:

1. Generate scenarios for populated Store A migration, assigned-only Staff reads/actions, Store B crossed resources, Refund decision races, and public/Customer continuity.
2. Run `/ak:plan --hard` with database and Better Auth guidance, using this report's four contract fields and confirmed user decisions.
3. Implement the complete cutover through `/ak:cook`.
4. Verify the acceptance scenarios and run code review before declaring the application safe to share.

The plan must include an authorized, rehearsed populated-data rollout. Do not infer that remote migration or deployment is authorized by this brainstorm.

Evidence in this report comes from source/schema inspection and current Better Auth documentation. No application code, migration, configuration, or existing project documentation was changed during brainstorming. No tests, runtime authentication rehearsal, remote inspection, migration, or deployment were performed. Saving this report is the only workspace mutation in this follow-up.

## Unresolved questions and prerequisites

No unanswered product question blocks drafting the implementation plan. The Staff visibility, catalog authority, and post-rejection behavior were resolved explicitly with the user.

The following remain discoverable implementation or rollout prerequisites, not verified capabilities:

- Verify the chosen Better Auth version and D1 adapter in the actual Workers runtime.
- Specify and prove atomic membership/assignment checks, decision concurrency, and populated migration behavior.
- Obtain deployment-specific account provisioning inputs through an appropriate secure path; do not store passwords in fixtures or reports.
- Confirm target environment, backup/checkpoint procedure, writer cutover, and authorization before any remote mutation.
- The optional full teaching-flow file referenced by the brief was unavailable during this review.
