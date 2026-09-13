# Variant delivery replacement retention evidence

Date: 2026-09-12 21:12 Asia/Ho_Chi_Minh

## Scope

Added three integration cases around replacement of a real Variant delivery file after an Order has purchased that Variant. The fixture creates an active Variant with a complete delivery override, uploads the original PDF through the Console HTTP route, and places the Order through the Storefront HTTP route before invoking the package mutation with controlled D1/R2 failures.

## Scenarios

| Test | Injected outcome | Assertions |
|---|---|---|
| `keeps a purchased Variant snapshot when replacement commits before its response fails` | D1 batch commits and its response throws | Mutation reports `persistence_failed`; current Variant points to the new key; `order_lines.private_file_key` remains the exact original key; both original and replacement objects are readable; original bytes remain exact. |
| `keeps a purchased Variant snapshot when replacement reference lookup is unavailable` | D1 batch throws and the recovery reference query is unavailable | Mutation reports `persistence_failed`; current Variant still points to the original key; the Order snapshot remains the exact original key; both conservatively retained objects are readable; original bytes remain exact. |
| `keeps a purchased Variant snapshot when replacement compensation fails` | D1 batch rejects and R2 deletion fails on all compensation attempts | Mutation reports `storage_compensation_failed` with an incident ID; current Variant still points to the original key; the Order snapshot remains the exact original key; both objects are retained and readable; original bytes remain exact. |

The new assertions passed against the current production implementation without a production edit. This closes the missing purchased-Variant replacement coverage; it did not reveal a behavior defect.

## Verification

```text
$ npx -y -p node@22 -c 'node --version && npm run test:workerd -- tests/integration/delivery-replacement.test.ts && npm run typecheck'
v22.23.2
Test Files  1 passed (1)
Tests       9 passed (9)
Duration    4.73s
tsc --noEmit: passed
```

`git diff --check -- tests/integration/delivery-replacement.test.ts` also passed.
