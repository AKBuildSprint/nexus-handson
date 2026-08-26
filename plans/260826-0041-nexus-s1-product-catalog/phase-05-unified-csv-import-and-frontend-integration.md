---
phase: 5
title: "Unified CSV Import and Frontend Integration"
status: pending
priority: P1
effort: "1.5d"
dependencies: [4]
---

# Phase 5: Unified CSV Import and Frontend Integration

## Context Links

- [Locked machine reconciliation](../../design/contract-reconciliation.md)
- [Acceptance authority `nexus-s1-reconciled-1`](../../design/reconciled-acceptance-manifest.md)
- [Approved frontend prototype](./phase-02-frontend-prototype-and-approval.md)
- [Phase 3 Papa Parse/bulk proof](./phase-03-design-reconciliation-and-cloudflare-foundation.md)
- [Catalog domain implementation](./phase-04-catalog-domain-api-and-private-files.md)
- [D1 platform limits](https://developers.cloudflare.com/d1/platform/limits/)

## Overview

Implement Phase 5 ownership: `API-008..010`, `DATA-008`, `CSV-*`, and CSV `UI-*` with Papa Parse 5.7.0, partial eligible commits, guarded exact-45 import, and authoritative results. Produce locally available evidence; required remote artifacts, including CSV-015 actual remote 500-row import, belong to Phase 6.

## Requirements

- Functional:
  - Exact filename `nexus-product-import-template.csv`, exact 21-column ordered header, exact approved `field-notes` row and two `focus-pack` rows.
  - Canonical CSV Product statuses `draft|active|archived` and Variant statuses `enabled|disabled`; Console labels remain title-cased.
  - Strict UTF-8 with optional BOM, LF/CRLF, RFC 4180 quoting via `papaparse@5.7.0` in browser and workerd.
  - Exact actual maximum 1,000,000 bytes and 500 data rows in browser and Worker.
  - Auto-detect grouped simple/Variant shape; derive exact Cartesian coverage and source-order provisional reasons.
  - Derived 1-10 normal, 11-30 confirmed, 31+ rejected without bypass.
  - A blocked/rejected Product group MUST coexist with and not block other eligible groups; all-Rejected disables browser upload.
  - Worker returns one source-ordered Added/Duplicate/Rejected outcome per row and aggregate counts; identity conflict is Rejected.
  - Matching existing Product may add only new SKU+combination under exact Product/schema; never update.
- Non-functional:
  - `src/shared/csv-contract.ts` is the only filename/header/example/status/limit/result contract for template, browser, and Worker.
  - Browser preview is advisory; Worker stores unchanged original in R2 then repeats every decode/parse/validation/classification rule.
  - Structurally valid file treats invalid Product groups as expected results; accepted groups + import metadata commit atomically and original is retained.
  - Fatal file/request/missing-confirmation or D1 batch failure writes no D1 state and deletes original.
  - Reuse Phase 3 exact chunks: four reads + 41 writes = 45 statements. Counted final metadata insert revalidates every preflight-matched Product revision/import fingerprint and fails atomically on drift.
  - No preview session, polling, history route/dashboard, background cleanup/job, upsert, mapping, private file, or Variant delivery import.

## Architecture

### One shared CSV contract and parser

`src/shared/csv-contract.ts` owns exact filename, 21 headers, exact three rows, lowercase statuses, decimal byte/row limits, normalized row/result types, and Papa Parse `5.7.0` options. Remove the prototype hand parser from production. Strict `TextDecoder(...,{fatal:true})` handles UTF-8/BOM before Papa Parse; parser accepts RFC 4180 quotes and LF/CRLF. Browser/workerd must emit identical normalized rows/errors for every fixture.

Exact template:

```csv
product_slug,product_name,base_price,currency,product_status,public_description,access_title,access_instructions,variant_sku,variant_price_override,variant_status,option_1_name,option_1_value,option_2_name,option_2_value,option_3_name,option_3_value,option_4_name,option_4_value,option_5_name,option_5_value
field-notes,Field Notes,24.00,USD,active,A concise guide,Download Field Notes,Open the PDF from your order,,,,,,,,,,,,,
focus-pack,Focus Pack,36.00,USD,draft,Desktop focus templates,Download Focus Pack,Open the ZIP from your order,FOCUS-DARK,,enabled,Theme,Dark,License,Personal,,,,,,
focus-pack,Focus Pack,36.00,USD,draft,Desktop focus templates,Download Focus Pack,Open the ZIP from your order,FOCUS-LIGHT,,enabled,Theme,Light,License,Personal,,,,,,
```

### Exact routes and result

- `GET /api/console/imports/template`
  - returns `text/csv; charset=utf-8`;
  - `Content-Disposition: attachment; filename=\"nexus-product-import-template.csv\"`;
  - body is generated only from shared contract.
- `POST /api/console/imports`
  - raw unchanged CSV, `text/csv; charset=utf-8`, percent-encoded `X-Nexus-Filename`; optional network `Content-Length` is an early bound only and counted actual bytes are authoritative;
  - `X-Nexus-Confirm-Variants:true` iff one or more otherwise-eligible Product groups derive 11-30;
  - immediate `ImportResultResponse` is the ordered durable authority; no poll/history endpoint.

The result shape is exactly `{importId,filename,counts:{added,duplicate,rejected},groups:[{productSlug,detectedType,derivedCombinationCount,outcome,rows:[{row,productSlug,variantSku,outcome,field,code,reason}]}]}`. Groups/rows preserve source order. Browser provisional `Ready|Duplicate candidate|Rejected` becomes only server `Added|Duplicate|Rejected`.

### Detection, partial eligibility, and exact match

1. Group by normalized `product_slug`; require Product fields to match under reconciled normalization.
2. Simple is exactly one row with all Variant/options blank.
3. Variant rows require SKU, lowercase status, and contiguous complete name/value pairs from option 1.
4. Derive distinct values and full Cartesian set; require every combination exactly once.
5. Mixed shape, incomplete/gapped pairs, Product/schema mismatch, sparse/extra/duplicate matrix, or identity conflict rejects the whole Product group.
6. `31+` is an expected rejected group, not whole-file fatal. If another group is eligible, browser uploads the original unchanged file and Worker returns/commits independently by group. Browser sends no narrowed copy.
7. Existing exact SKU+combination is Duplicate. New SKU+new combination adds only when Product fields/schema match. Same SKU/different combination or new SKU/existing combination is Rejected identity conflict. No update.

### Persistence and failure classes

1. Enforce declared then actual 1,000,000-byte limit.
2. Put unchanged original at random `imports/<uuid>.csv`.
3. Strictly decode/parse, enforce 500 rows, classify and independently require warning confirmation.
4. Fatal encoding/header/malformed/empty/size/rows/missing confirmation: stable 4xx, zero D1, delete original.
5. Expected rejected Product group: retain original, write no catalog rows for group, keep source-order outcomes; eligible groups continue.
6. Four reads classify and record matched Product prestate `{id,revision,importFingerprint}` plus computed post-import state.
7. Product chunks conditionally transition exact prestate to poststate; Duplicate-only state is unchanged. Statements 5-44 write accepted entities.
8. Statement 45 inserts metadata only if every computed poststate is present; drift makes required ID NULL, fails NOT NULL, rolls back 1-44, deletes original. No 46th statement.
9. Success, including mixed/all-Duplicate/server-accepted all-Rejected: 200 authoritative result and retained original/import metadata.

Manifest `CSV-015..019` is literal: all-new 500-row success produces 8,501 records at exact chunks 100/250/250/100/250 and exactly 45 statements. Same-file rollback/race test pre-seeds one exact Product, mutates it after preflight, still executes exactly 45 statements, fails guarded statement 45, and leaves no batch-created rows.

## Related Code Files

- Create: `/Users/itsddvn/projects/nexus-handson/migrations/0003-imports.sql`
- Create: `/Users/itsddvn/projects/nexus-handson/src/shared/csv-contract.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/import/csv-parser.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/import/csv-validator.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/import/exact-match.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/import/import-command.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/import/import-write.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/src/worker/console-import-routes.ts`
- Modify: `/Users/itsddvn/projects/nexus-handson/src/worker/index.ts`
- Modify: `/Users/itsddvn/projects/nexus-handson/src/console/imports/csv-import-screen.tsx`
- Modify: `/Users/itsddvn/projects/nexus-handson/src/console/imports/csv-preview-table.tsx`
- Modify: `/Users/itsddvn/projects/nexus-handson/src/console/api-client.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/fixtures/import/unified-template.csv`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/fixtures/import/mixed-shapes.csv`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/fixtures/import/identity-conflicts.csv`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/unit/csv-parser.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/unit/csv-validator.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/unit/exact-match.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/integration/import-lifecycle.test.ts`
- Create: `/Users/itsddvn/projects/nexus-handson/tests/e2e/console-import.spec.ts`

## Implementation Steps

1. Add `imports` migration with Store ID, random private key, original filename/size/detected type, exact counts, timestamp; no row-history table/route.
2. Define exact shared header/examples/statuses/limits/result types once and generate template from it.
3. Replace production hand parsing with `papaparse@5.7.0`; add browser/workerd RFC 4180 parity fixtures.
4. Implement actual-byte/strict UTF-8/BOM/header/row parsing with original one-based data row numbers.
5. Implement grouped shape, contiguous pairs, Product consistency, lowercase statuses, and no private-delivery columns.
6. Derive Cartesian set and enforce exact coverage plus 10/11/30/31 from derived count.
7. Implement browser preview with source-order provisional row identities/reasons and reset confirmation on any file/data/count change.
8. Preserve approved partial eligibility: show rejected 31+ groups, enable import for peers, upload original unchanged, disable only when no eligible group.
9. Implement exact match and carry Product prestate plus computed poststate.
10. Implement exact template/raw POST/result/error.
11. Implement conditional Product transitions and statements 5-44 entity writes.
12. Implement guarded statement-45 poststate re-read/NOT NULL failure.
13. Prove all-new 8,501 success and same-45 concurrent drift no-op/rollback/compensation.
14. Connect durable UI and browser-drive template/bounds/partial groups/conflicts.

## Todo

- [x] Exact unified template generated from one contract
- [x] Phase 3 Papa Parse/45-statement bulk proof remains passing
- [x] 1,000,000-byte/500-row and Cartesian 10/11/30/31 boundaries enforced twice
- [x] Exact matrix coverage and additive exact-match classification implemented
- [x] Fatal/group-rejection/D1-failure semantics implemented
- [x] R2-first/D1 atomic import and compensation implemented
- [x] Approved import UI connected to immediate POST result DTO

## Success Criteria

- [x] Phase 5-owned `API-008..010`, `DATA-008`, `CSV-*`, and CSV `UI-*` have all locally available evidence; required `R` evidence is deferred to Phase 6.
- [x] Papa Parse `5.7.0` yields identical RFC 4180 rows/errors in browser and workerd; no production hand parser remains.
- [x] Downloaded exact lowercase-status template has 21 ordered headers/three approved rows and imports unchanged.
- [x] 1,000,000 bytes and 500 rows pass; 1,000,001 bytes and row 501 reject in browser and Worker.
- [x] Simple/Variant detection, exact Product consistency, contiguous pairs, full Cartesian coverage, and derived 10/11/30/31 behavior pass.
- [x] A rejected 31+ or otherwise invalid Product group remains in authoritative result while eligible peer groups commit.
- [x] Exact match adds only new valid identity; re-import adds zero; identity conflict never updates.
- [x] Product chunks conditionally transition prestate to computed poststate; deterministic drift no-ops and guarded statement 45 rolls back 1-44.
- [x] Fatal/missing-confirmation/batch/drift failure leaves no D1 state/original; expected group rejection retains original/import metadata.
- [x] All-new 8,501-record success and drift rollback each use exactly 45 statements; no 46th statement exists.
- [x] Approved source-order/durable result, desktop/375 px, focus/retry behavior is unchanged.
- [x] CSV-015 exact local 500-row/8,501 feasibility passes here; its actual remote workers.dev import is not claimed until Phase 6.

## Risk Assessment

- Risk: Papa Parse differs between browser and workerd or a hand parser remains.
  - Signal: any shared fixture row/error mismatch or production import of old parser.
  - Response: stop Phase 5, fix one shared Papa Parse adapter/graph, and retain RFC 4180/limits.
- Risk: whole-file rejection drops approved partial eligible groups.
  - Signal: one rejected group prevents a valid peer from being Added.
  - Response: restore per-Product expected classification and one accepted-group atomic commit; never narrow uploaded original.
- Risk: browser confirmation is bypassed.
  - Signal: eligible 11-30 group reaches Worker without exact header.
  - Response: fatal request rejection before D1, delete original, return `variant_confirmation_required`.
- Risk: real import exceeds budget or accepts stale preflight.
  - Signal: count differs from 45, any query binds >100, Product drift does not fail statement 45, or rollback leaves rows.
  - Response: stop; fix guarded final insert/chunks and race test without reducing scope.
- Risk: R2 compensation fails.
  - Signal: original remains after fatal/batch failure retries.
  - Response: emit private incident evidence/opaque response incident ID and fail acceptance.

