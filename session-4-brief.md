# Session 4 — Nexus Build Brief (PRD)

*Feature: Store Owner/Staff sign-in + Store isolation + Order assignment + Owner Refund decision · Builds on: S1–S3 data/workflow*

> **TUTOR-ONLY TECHNICAL PRD.** Preserve existing Store A data and public Storefront. Students test people/boundaries through product use. Full flow: `../session-4.md`.

## This session

Bind existing Nexus to signed-in Store A Owner and Staff accounts without losing their data. Add Store B so the tutor can test isolation. Let Owner assign Orders to Staff and keep the S3 Refund decision for Owner only. Public Storefront remains available, while the private Customer Order page shows the Customer-safe decision result.

## Goal

Share Console safely without reseeding or breaking Customer Order creation.

## User story

As Owner, I keep all existing Products/Customers/Orders, assign an Order to Staff and Approve/Reject Refund Requests. Staff processes assigned Orders but cannot decide Refunds/Delete/cross Store. Customers still order publicly.

## Build this slice

1. Add users, sessions and Store memberships without losing the existing bootstrap data.
2. Bind that data and its earlier Owner history to Store A.
3. Use one central evaluator for private Console and API actions.
4. Keep the few Storefront actions that Customer needs explicitly public.
5. Let Owner assign or reassign an Order.
6. Let Staff change only Orders assigned to them.
7. Let only Owner Approve or Reject the S3 Refund Request.
8. An approved request waits for execution. The Order remains Paid or Fulfilled until S5 completes the return.
9. Show the Customer-safe Refund decision on the existing private Order page.
10. Create Store B accounts and data for the isolation test.

## Rules & edge cases

- Existing S1–S3 data survives under Store A.
- Unknown Store/user fails closed for private data.
- Public Product read/Order create remain available but cannot call private actions.
- Assignment enforced server-side, not by label/button.
- Owner-only Refund decision and Delete enforced directly.
- One evaluator reused by Console/API and optional S6 MCP.
- A Customer token never becomes a substitute for Console identity. It returns no internal notes or Staff information.
- D1 does not provide RLS. The tutor must rehearse either a central Store-scoped wrapper or a Durable Object boundary per Store and be honest about the choice.

## Acceptance criteria

- [ ] Store A Owner signs in and sees all existing data/history.
- [ ] Store A Staff processes one assigned Order. A direct action on another or unassigned Order is refused.
- [ ] Store B cannot read/action Store A URL/ID.
- [ ] Staff cannot decide a Refund or Delete the protected data. Owner's Approve or Reject succeeds once, records the real person and does not falsely claim that money already moved.
- [ ] The matching private Customer page shows Approved or Rejected. Another or guessed token and public Storefront reveal nothing private.
- [ ] Public Storefront still reads Products and creates Store A Order.

## Suggested AgentKit sequence

```text
/ak:scenario "existing Store A migration + Owner/Staff assignment + Refund decision + Store B crossed URL + public Storefront remains"
/ak:plan --hard (ak:databases + ak:better-auth) → /ak:cook → /ak:code-review
```

## Teaching result

- Students share the actual connected system, not a fresh auth demo.
- Product rules become visible through real accounts, assigned work and protected decisions.
- **They leave with:** a second person safely completing real work.

---

## Student-facing adaptation seed

Name the second real person who needs the app, the work assigned to them, the data they must not cross and the decision their manager keeps. Keep the S2 submission page working.
