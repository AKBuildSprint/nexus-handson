# Session 5 — Nexus Build Brief (PRD)

*Feature: private Order page → Nexus Sandbox Checkout → verified Payment → Product Access + separate Pending reminder + Refund reversal*

> **TUTOR-ONLY TECHNICAL PRD.** This is the heaviest rehearsal. Students see two exact recipes, not a generic event engine. Full flow: `../session-5.md`.

## This session

This session adds three connected but distinct product results:

- Nexus Sandbox Checkout lets Customer complete a practice Payment from the S2 private Order page.
- A trusted Payment result reuses S3 `markPaid`, sends confirmation and grants the S1 Product Access on that page.
- A separate due check reminds only Orders that remain Pending.
- A Refund approved in S4 follows the original Payment's return path before Nexus revokes access and pending work.

## Goal

Make one Customer Order progress automatically and exactly once while keeping Payment delivery and Pending reminder as distinct recipes over shared reliable infrastructure.

## User story

As Customer, I pay from my private Order page, see that exact Order become Paid and open what I bought. If I remain Pending, I get one reminder later. Approved Refund eventually shows Refunded and removes access.

## Build this slice

1. Token-authorized **Pay in sandbox** starts a short-lived checkout for the exact S2 Order.
2. Checkout completion emits a server-signed HMAC event. Browser cannot set Paid.
3. Payment ingress verifies the signature before it trusts the payload.
4. It claims the event once and matches Store, reference, amount and currency.
5. It reuses the S3 transition with a system actor and publishes `order.paid`.
6. `order.paid` sends confirmation and creates one Product Access entitlement per purchased Order item asynchronously.
7. Each entitlement uses the immutable Product/Variant identity and effective delivery snapshot captured by S2; it never resolves current catalog configuration.
8. The private Order page reveals each purchased item’s access title/instructions and optional short-lived private R2 file.
9. `order.payment_reminder_due` reads current status and reminds once only when the Order is still Pending.
10. `refund.approved` chooses the return path from the original Payment source.
11. Sandbox or provider Payment uses its adapter reversal.
12. Manual Payment waits for an external reversal reference recorded by Owner.
13. Nexus then revokes all Order-item entitlements, cancels reminders and marks the Refund Completed and Order Refunded.
14. S5 rollout reconciles pre-existing Orders that are missing reminders, entitlements or approved Refund work.
15. Reconciliation uses the same Order-item dedupe keys as the live path so either path can win once.

## Data

- `payments`: extend S3 manual ledger with provider event/payment IDs and status.
- `refund_reversals`: Refund Request/source/provider-or-external reference/status/confirmed actor/time.
- `entitlements`: Store/Customer/Order/OrderItem/Product/nullable Variant, immutable access snapshot/reference, granted/revoked timestamps.
- `sandbox_checkouts`: Order, exact amount/currency, short expiry, status/event ID.
- `automation_runs/effects`: event/dedupe/step status/result; entitlement effect key is stable per Order item.
- Store-scoped provider/delivery secrets outside public API.

## Rules & edge cases

- Verify Payment signature before looking up or changing an Order.
- Reject the request when signing secret is missing.
- Customer browser may start checkout but cannot forge completion or mutate Order status.
- Payment reference identifies exactly one Order in one Store.
- Amount/currency match the immutable S2 Order totals.
- Webhook and manual fallback call the same transition service.
- If both paths race, only one Order change and one entitlement per Order item may win.
- Entitlement uses copied access title/instructions and immutable private-file key from the S2 Order-item snapshot together with Product and nullable Variant identity.
- Catalog edits, disabled Variants or replacement Product files after Order creation do not change the purchased snapshot; referenced R2 objects remain available.
- Private Customer page exposes only the paid Order's access snapshots; it never exposes live Product/Variant delivery configuration.
- Payment delivery and Pending reminder are distinct recipes/event types.
- Queue or scheduled runner retries slow steps that fail.
- Repeated Payment event or reconciliation creates no second entitlement after success.
- Reminder checks current Order status immediately before sending.
- Paid, Canceled or Refunded Order receives no payment reminder.
- Refund revokes every granted Order-item entitlement and cancels pending work once.
- Nexus never claims a manual Payment was automatically returned.
- Manual Refund completes only after Owner records a unique external return reference.
- Private Customer Order page reads the same Order, Refund and Product Access records as the rest of the product; no UI-only status.
- Pre-S5 data is not abandoned: reconcile and live events race safely to one effect.

## Acceptance criteria

- [ ] Customer clicks Pay in sandbox on the actual S2 private page. Signed completion marks that Order Paid and records system history.
- [ ] The same page reveals one entitlement per purchased simple/Variant Order item using copied access content and immutable file key from S2.
- [ ] Editing Product/Variant delivery or replacing its file after Order creation does not change granted access or break the referenced object.
- [ ] Duplicate click, webhook or reconciliation creates no second entitlement for an Order item.
- [ ] Amount/currency/reference mismatch is quarantined with no state or delivery.
- [ ] Still-Pending Order receives one unattended reminder after near-time interval.
- [ ] One Pending Order and one Approved Refund created before S5 are picked up once by reconciliation.
- [ ] Paid/Canceled Order receives no later reminder.
- [ ] Owner-approved Refund becomes Completed and Order becomes Refunded only after return succeeds; all Order-item entitlements are revoked.
- [ ] Manual Payment shows Manual reversal required and completes only after Owner records return reference; sandbox Payment uses its adapter.

## Suggested AgentKit sequence

```text
/ak:plan --hard (Nexus Sandbox Checkout + HMAC ingress + immutable Order-item Product/Variant access snapshots; distinct order.paid and payment_reminder_due recipes; ak:payment-integration + ak:devops)
→ /ak:cook → /ak:test → /ak:code-review
```

## Teaching result

- Students see an outside event and elapsed time create different valuable results without a watcher.
- **They leave with:** one real action or deadline that creates one valuable result in their app, plus Gate 2 evidence.

---

## Student-facing adaptation seed

Start from the running app. Name the real action or deadline, the situation that must still be true and the one result the user is waiting for. Do not copy Payment or Product Access when the student's app needs Booking confirmation, a deadline reminder or another concrete result.
