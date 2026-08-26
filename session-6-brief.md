# Session 6 — Nexus Build Brief (PRD)

*Feature: real Customer Storefront → private Order page → sandbox Payment → Product Access → Staff Console + private Order Receipt*

> **TUTOR-ONLY TECHNICAL PRD.** Core is connected two-surface evidence and one exact export. AI/MCP is optional after core. Full flow: `../session-6.md`.

## This session

This session hands the connected product to real people:

- A real Customer places an Order on deployed Storefront.
- Customer reopens the private page, completes Nexus Sandbox Checkout and opens Product Access.
- Real Staff finds and processes that same Order in deployed Console.
- When either person enters bad input, the product explains how to recover.
- Authorized Staff or Owner generates a private Order Receipt whose link expires and works once.

## Goal

Prove Nexus is one handed-over product across two independent clients of one API.

## User story

- As Customer, I place and pay for an Order and open what I bought without builder help.
- As assigned Staff, I find and process the same Order without builder help.
- As authorized Staff or Owner, I generate its private Receipt.
- Errors explain how to recover without leaking private data or secrets.

## Build this slice

1. Use a shared domain and API error schema.
2. Give Storefront and Console messages appropriate to their users.
3. Keep diagnostic logs from blocking the journey.
4. Run one deployed smoke journey from Storefront Order creation to private Order page and Nexus Sandbox Checkout.
5. Continue the same journey through Paid, Product Access, Console search, authorized Fulfillment and history.
6. Generate an Order Receipt containing Customer-safe fields only.
7. Store the Receipt in private R2.
8. Check authorization before creating the Receipt link.
9. Give the link a short lifetime and consume it atomically on first successful use.
10. Optional `/mcp` search and actions reuse the same API and S4 evaluator.

## Receipt fields

Store public identity, Order reference/date, Customer-safe name/email, Product snapshots/qty/unit prices, total/currency, Payment/status. Exclude secrets, private delivery config, internal policy/debug fields.

## Rules & edge cases

- One real Customer and one real Staff complete their tasks without coaching.
- Customer journey reaches the purchased Product Access. “Order created” alone does not pass.
- Both deployed versions share compatible API contract.
- Bad input keeps valid work and explains exact recovery.
- Staff assignment/Store policy holds during processing and Receipt mint.
- Receipt bucket remains private.
- Store only the hash of the Receipt token and give it a short lifetime.
- Consume the token atomically so two simultaneous requests cannot both open the Receipt.
- Secrets absent from public API, UI, bundle and Receipt.
- Optional MCP has no second database/looser authorization path.

## Acceptance criteria

- [ ] Real Customer places Order from deployed Storefront unaided after one recoverable bad-input attempt, reopens the private page, pays through Nexus Sandbox Checkout and opens Product Access.
- [ ] Real assigned Staff finds the Paid Order and completes authorized Fulfillment in deployed Console unaided.
- [ ] The connected smoke test starts with a Customer Order, continues through the private page, Payment and Product Access, and ends with the same Order in Console.
- [ ] Authorized Staff or Owner gets an expiring Order Receipt that works once. Replay, expiry and cross-Store attempts are refused.
- [ ] Receipt/public surfaces contain no secret/private delivery config.
- [ ] Optional MCP cannot exceed the connecting user.

## Suggested AgentKit sequence

```text
# Core
/ak:security-scan → /ak:web-testing (connected deployed smoke) → /ak:deploy cloudflare → /ak:ship
# Optional only after core
/ak:mcp-builder → /ak:deploy cloudflare
```

## Teaching result

- Real behavior exposes broken copy, API mismatch, missing context and permission gaps.
- **They leave with:** evidence that a real Customer reached the promised result and a real Staff member handled the same Order, plus a private Receipt and a 30-day plan.

---

## Student-facing adaptation seed

Name the real person who begins the journey, the person who handles the same work, what each person must do and the result each one needs. Optional AI never replaces evidence from those people.
