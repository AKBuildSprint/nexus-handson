# Session 3 — Nexus Build Brief (PRD)

*Feature: Console Orders inbox + detail + actions/history + Customer Refund Request from S2 private Order page*

> **TUTOR-ONLY TECHNICAL PRD.** The visible lesson starts from an actual S2 Order. Keep query/state/idempotency design backstage. Full flow: `../session-3.md`.

## This session

Turn incoming Storefront Orders into work the Owner can handle. Give the Owner a useful summary, search, status filters, an Order list, details, sensible next steps and durable history. Let an eligible Customer submit one Refund Request from the S2 private Order page. It appears in Console and waits for S4 authorization.

## Goal

Store Owner can find the actual S2 Order, understand Customer/Products/payment context, record Payment manually as fallback, Fulfill/Cancel, record Refund Request and trust repeat/refresh behavior.

## User story

As Store Owner, I open Orders inbox, find a Customer's Order using information I know, take only valid actions and see who/source changed what over time. As Customer, I can request a Refund from my private Order page and see that it is waiting for a decision.

## Build this slice

1. Show a summary and a 25-per-page list using the same active search and status filter.
2. Let the Owner search with information a Customer is likely to know, including Customer, Order or Payment reference.
3. Show Customer details, Product line snapshots, total, currency, references and history on the Order page.
4. Give Pending Orders a manual Paid fallback that records method and reference.
5. Allow a Pending Order to be Canceled and a Paid Order to be Fulfilled.
6. Route every Order change through the same transition service and protect repeated actions from creating duplicate history.
7. Let an eligible Customer submit a Refund Request from the private Order page.
8. Let an authorized Console user create the same kind of request on the Customer's behalf.
9. Store the Refund Request separately from the Order. Approve and Reject do not appear until S4.

## Data added

- Basic `payments`: Order/Store, `source=manual`, method, external reference, amount/currency, recorded actor/time. S5 extends the same ledger for sandbox/provider events.

## Rules & edge cases

- Summary/list/pager share Store/search/status predicates.
- Search name/email/order reference/payment reference server-side.
- Detail never crosses Store.
- Refuse an Order change that is no longer valid for its current status.
- A repeated action creates one result and one history entry.
- Manual Payment is a fallback calling the same transition service S5 webhook will reuse.
- Manual Payment stores `source=manual`, its method and its reference. A later Refund must wait for confirmation that the money was returned outside Nexus.
- A Refund Request does not change the Order status, return money or remove Product Access in S3.
- One Order has at most one open Refund Request across the Customer and Console submission paths.
- Actor source is recorded: bootstrap Owner/user/system/storefront.

## Acceptance criteria

- [ ] Actual S2 Order is searchable and opens with exact snapshots/references.
- [ ] Filtered summary/list/pager agree.
- [ ] Only valid actions appear and server refuses invalid direct action.
- [ ] Manual Payment then Fulfill changes actions/history correctly.
- [ ] Double action counts once and survives refresh/redeploy.
- [ ] Customer submits a Refund Request from the actual S2 private page. It appears once in Console and waits without being approved, rejected or executed.

## Suggested AgentKit sequence

```text
/ak:scenario "S2 incoming Order/private page → find/detail → manual Paid fallback → Customer Refund Request appears in Console once → duplicate action"
/ak:plan --hard → /ak:cook → /ak:test
```

## Teaching result

- Students see external submission become real operations work.
- They catch misleading inboxes, impossible actions and duplicate history by use.
- **They leave with:** the exact screen where the person doing the work receives and processes the S2 input.

---

## Student-facing adaptation seed

Start from the exact submission created in S2. Name who receives it, how they find it and what they must be able to do next. Do not ask for transition tables or generic records.
