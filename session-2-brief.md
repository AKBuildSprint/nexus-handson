# Session 2 — Nexus Build Brief (PRD)

*Feature: independent Public Storefront → Customer + Pending Order → private Customer Order page → Console receipt*

> **TUTOR-ONLY TECHNICAL PRD.** Prepare and rehearse the two deployments. Students learn by crossing the visible Customer journey, not by designing API, CORS or database internals. Full flow: `../session-2.md`.

## This session

S1 produced a Product API and Operations Console. Deploy a separate Public Storefront that reads active Products, creates a Customer Order, opens its private Customer Order page and proves the Order arrives in existing Console.

## Goal

Ship one end-to-end API-backed journey:

> Console Product change → Storefront reflects it → Customer places Order → private status/payment page → same Pending Order appears in Console

## User story

As a Customer, I browse active digital Products on Storefront, choose an enabled Variant when the Product has options, choose quantities, enter name/email, review the amount and place an Order. I can reopen a private page showing the exact Product/Variant selection, status and payment instructions without an account. Store Owner sees the same Customer/Order in Console.

## Build this slice

1. Deploy Storefront at a separate URL with a Customer-facing Product list and Order form.
2. Let `GET /api/storefront/products` return active Products, their one active option schema, enabled Variants and effective prices using S1's safe projection.
3. Require a Variant selection for a Product with options; simple Products use no Variant ID.
4. Let `POST /api/storefront/orders` resolve the Customer and validate selected Products, nullable Variant IDs and quantities.
5. Calculate totals from current effective prices on the server.
6. Snapshot Product/Variant identity, display selections, unit price/currency, copied effective access title/instructions and immutable private-file key on each Order line.
7. Create Customer, Order, lines, snapshots and initial history together so a partial Order cannot remain.
8. Redirect the Customer to a private token URL after creation.
9. On that page, show Customer-safe Order-line snapshots, reference, expected amount, currency, Pending status and payment instructions.
10. Require the private token to read the page. An Order reference or email alone must not open it.
11. Show the incoming Order and exact Variant selections in existing Console. S3 will build the full workspace.

## Data

- Reuse S1 `stores`, `products`, option schema and `product_variants`.
- `customers`: ID, Store, normalized email, name, timestamps.
- `orders`: ID, Store, Customer, `pending`, order/payment references, expected total/currency, source=`storefront`, assigned_to nullable, timestamps.
- `order_items`: Order/Product IDs, nullable Variant ID, Product-name snapshot, nullable Variant-SKU snapshot, option-label/value snapshot, qty, effective unit-price/currency snapshot, copied access-title/instructions snapshot and immutable private-file key.
- `order_history`: `order.created` actor=`storefront`.
- `idempotency_keys`: Store/request key/result.
- `customer_order_tokens`: hashed high-entropy token, Order ID, created/last-used/revoked timestamps.

## Rules & edge cases

- Storefront reads the catalog through `GET /api/storefront/products`; it never maintains a second Product/Variant store.
- Public catalog excludes Product/Variant delivery configuration and admin secrets.
- Server validates Store, Product active status, active schema, Variant enabled status, Variant membership, quantity and currency.
- Product with active options requires a Variant ID. Simple Product rejects an unrelated Variant ID.
- Server resolves effective price from Variant override or Product base price. Browser-sent price is display-only and never trusted.
- Order creation snapshots exact Product/Variant identity, option labels/values, price/currency, copied effective access title/instructions and immutable private-file key.
- Catalog edits after Order creation cannot alter existing Order-line snapshots. Replacing a delivery file writes a new object and preserves keys already referenced by Order items.
- Customer, Order, lines, snapshots and history commit together.
- Unique payment reference and stable public Order reference.
- Double final submit returns one Order/confirmation.
- Private Order page is revisitable, shows only Customer-safe snapshots and never logs/stores the raw token.
- Delivery snapshots remain private until S5 grants access after Payment.
- S2 shows the next payment step. S5 connects Nexus Sandbox Checkout.
- CORS allows only the origins and methods Storefront needs. Public endpoints never expose Console writes.

## Acceptance criteria

- [ ] Product/Variant created or edited in Console appears correctly on separately deployed Storefront through `GET /api/storefront/products`.
- [ ] Customer places one Order containing a simple Product and an enabled Variant Product. Confirmation shows exact option selections, references, amount and currency.
- [ ] Missing/disabled/cross-Product Variant is refused. Simple Product rejects an unrelated Variant ID.
- [ ] Browser-tampered price is ignored or rejected; total uses server-resolved effective prices.
- [ ] Order item snapshots Product/Variant identity, SKU, option labels/values, effective price, copied access content and immutable private-file key.
- [ ] Editing Product/Variant or replacing its file after Order creation does not change stored snapshots or delete the referenced R2 object.
- [ ] Confirmation opens through the private token. Refresh/fresh browser returns the same Order; guessed or cross-Store reference reveals nothing.
- [ ] Same Customer/Order/lines and Variant selections appear in Console.
- [ ] Double submit produces one Order.
- [ ] Public catalog and Customer-safe Order response contain no private delivery configuration.

## Suggested AgentKit sequence

```text
/ak:vibe --ship "Separate Nexus Public Storefront consuming S1 Product/Variant API; require valid Variant selection, create Customer/Pending Order with server-owned effective totals and immutable Product/Variant/delivery snapshots; private Customer Order page; same Order visible in Console"
# backstage: ak:backend-development + ak:databases → /ak:test across both deployments
```

## Teaching result

- Students see one backend serve two independent UIs.
- A real person sends input into the operations system the student already built.
- **They leave with:** a connected user-facing page, a way for that person to return and Gate 1 evidence.

---

## Student-facing adaptation seed

Start from the student's S1 feature and ask who needs to send information next. Name that person, the page they need and where the same input should appear for the person handling it. Do not force a Storefront when nobody outside the operations team needs a separate page.
