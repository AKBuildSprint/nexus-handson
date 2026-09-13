# Phase 5 assigned Order performance determination

Date: 2026-09-12
Runtime: workerd under Node 22
Fixture: 10,000 Store Orders, 200 Orders assigned to the measured Staff member, 20 warmed samples

## Production-path measurement

`listConsoleOrders` was measured without replacing its membership checks, list query, summary query, `hasOrders` query, Staff post-query revalidation, or result assembly.

| Principal | p95 |
|---|---:|
| Staff | 5 ms |
| Owner | 4 ms |

The latest ratio is 1.25x and the Staff production path is well below the 1,000 ms budget.

Repeated local runs observed Staff p95 between 3 and 10 ms and Owner p95 between 4 and 7 ms. One run was 10/7 ms (1.43x), while the others were at or below 1.25x. At this single-digit duration, one scheduler tick changes the ratio materially. The ratio is therefore diagnostic rather than a stable permanent pass/fail assertion. The durable regression gate is the production-path `<1s` budget plus deterministic scope, row-count, and query-plan assertions.

## Query-plan and rows-read evidence

`EXPLAIN QUERY PLAN` selected `order_assignments_assignee_order_idx` for the Staff visibility subquery.

| Probe | Staff p95 / rows read | Owner p95 / rows read |
|---|---:|---:|
| List | 1 ms / 1,500 | 1 ms / 26 |
| Search | 1 ms / 1,500 | 1 ms / 26 |
| Summary | 1 ms / 799 | 1 ms / 10,000 |

The Staff path scans more index entries for ordered list/search assembly but does not broaden to all 10,000 Orders. Its summary reads fewer rows than the Owner summary. The permanent test also asserts that Staff receives exactly 200 authorized rows in the summary.

## Decision

The Phase 5 sparse-assignment implementation meets the local production-path latency budget and uses the required assignment index. Keep the absolute budget and deterministic planner/scope assertions as the regression criteria. Record the Staff/Owner ratio on measured runs, but diagnose single-digit timing variance instead of encoding a flaky timing assertion in the test suite.
