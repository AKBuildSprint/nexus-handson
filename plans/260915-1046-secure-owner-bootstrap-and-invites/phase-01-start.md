---
phase: 1
title: "Production origin cutover"
status: pending
priority: P1
effort: ""
dependencies: []
---

# Phase 1: Production origin cutover

## Overview

Replace only live production hostname inputs with the user-supplied `cppai.workers.dev` origins. This phase does not deploy; it makes the next deployment target the correct Console/API and Storefront topology.

## Requirements

- Console/API origin is `https://nexus-handson-console.cppai.workers.dev`.
- Storefront origin is `https://nexus-handson-akbuild.cppai.workers.dev`.
- Storefront production builds call the new Console/API origin.
- Historical evidence, plans, and generated assets are not rewritten to falsify recorded observations.
- The deploy runbook calls out the exact Google authorized origin and callback update as a prerequisite.

## Related Code Files

- Modify: `wrangler.jsonc`
- Modify: `package.json`
- Modify: `README.md`
- Inspect only: `.github/workflows/deploy-console.yml`, `apps/console/dist/`, `apps/storefront/dist/`, historical plans/evidence and legacy verification scripts

## Implementation Steps

1. Change production `CONSOLE_ORIGIN` and `STOREFRONT_ORIGIN` in root Wrangler configuration.
2. Change the Storefront production API build variable in `package.json`.
3. Update active deployment documentation with both new canonical URLs and Google OAuth’s exact new origin/callback prerequisite.
4. Search active configuration, source, and workflow inputs for the legacy host; leave historical evidence and generated build outputs intact.
5. Build both applications to regenerate deployment artifacts from the new inputs; do not deploy.

## Success Criteria

- [x] Root production bindings and Storefront build input name the new hostnames exactly.
- [x] No live source/configuration input retains a legacy production hostname.
- [x] Documentation identifies the Google OAuth browser origin and callback change required before deployment.

## Risk Assessment

An incomplete origin cutover breaks OAuth, same-origin Console requests, or Storefront CORS. The observable signal is any active legacy hostname in source/build inputs or an OAuth `redirect_uri_mismatch`; response is to stop before deployment and correct the specific origin/configuration mismatch.
