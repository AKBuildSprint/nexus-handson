---
title: Fix S4 review findings
date: 2026-09-13
summary: "Resolved five authorization, provisioning, D1 pagination, and Console role-action defects with regressions."
---

# Fix S4 review findings

## What happened

Reviewed five S4 defects: provisioning linked Google accounts before membership conflict checks; Staff could download the import template; Staff Order pages could exceed D1's 100-bind limit; failed role commands could be mislabeled as successful after a failed refresh; and navigation could leave role controls disabled.

## Decision

Preflight existing memberships before Google provisioning while retaining the post-provision race guard and zero-membership recovery. Apply catalog:import authorization to the template route. Bind Staff page IDs through json_each(?) as one JSON parameter. Separate acknowledged writes from failed-command refreshes, reset role action state on route changes, and preserve both failed-command text and outdated-client reload guidance when both conditions occur.

## Verification

Targeted provisioning, integration, and browser regressions passed. Full workerd and browser suites passed, production Console/Worker and Storefront builds passed, S4 rehearsal passed, and 30 Playwright E2E scenarios passed in an isolated local environment. Independent review found one notice-precedence regression; it was fixed and the full browser suite plus production build passed again.

## Residual risk

Provisioning preflight is not transactional with Google account binding. A concurrent membership change between preflight and binding can still leave an account side effect before the retained post-check rejects the request. Existing infrastructure has no transaction spanning those operations.

## Next steps

Commit and push when requested. AgentWiki publish skipped; this local journal is the source of truth.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
