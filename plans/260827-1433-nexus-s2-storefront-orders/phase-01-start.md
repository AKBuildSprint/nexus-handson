---
phase: 1
title: "Independent Storefront Boundary"
status: completed
priority: P1
effort: ""
dependencies: []
---

# Phase 1: Independent Storefront Boundary

## Overview

Create the independently deployable Storefront boundary and two-origin local test topology while keeping the existing Console Worker deployment and its asset bundle intact. This phase does not create Order APIs or grant the Storefront direct D1/R2 access.

## Requirements

- Storefront has a separate HTML entry, React bootstrap, Vite build configuration, static Worker manifest/name, and deployment scripts.
- Storefront uses one explicit API-base configuration; it never imports Console UI or reaches D1/R2 directly.
- Console remains the current root `index.html` → `src/console/main.tsx` app and its default `dev`/`build` behavior remains intact.
- Local/E2E tooling can launch Storefront and the API/Console Worker at distinct origins, including different ports.
- Production provisioning records a separate Storefront Worker identity/origin before the API Worker is configured to allow that exact origin.

## Architecture

Use a small static-assets Worker for Storefront. It has its own asset directory and SPA fallback, but no `DB`/`FILES` bindings: all business calls go to the existing Nexus Worker. Keep Storefront source under one dedicated root so its build artifacts and production-import graph cannot overwrite `.nexus-build` metadata of the Console build.

```text
storefront static Worker ──fetch(configured API origin)──> Nexus API Worker
         no DB/R2 bindings                              └── DB + private FILES
```

## Related Code Files

- Create: `storefront/index.html`, `storefront/src/main.tsx`, `storefront/src/storefront-app.tsx`, `storefront/src/api-client.ts`, `storefront/src/styles.css`
- Create: `storefront/vite.config.ts`, `storefront/wrangler.jsonc`
- Modify: `package.json` — explicit Storefront dev/build/deploy commands; preserve Console defaults
- Modify: `playwright.config.ts` — two-origin web-server/test configuration
- Modify late in deployment: `resource-identities.json` — persist only the confirmed Storefront Worker identity

## Implementation Steps

1. Add a dedicated Storefront root with its own React entry and source-owned style sheet. Keep it initially limited to an app shell and configured API-base seam; do not copy `src/console/**`.
2. Add separate Vite and Wrangler configuration that builds Storefront assets independently and serves SPA deep links through a static-assets Worker. Do not attach `DB` or `FILES` to this static Worker.
3. Add unambiguous npm commands for Console versus Storefront development, build, preview, and deployment. Ensure Storefront build metadata has a distinct output path from the existing Console production-import graph.
4. Extend the local Playwright topology to start API/Console and Storefront on distinct origins. Make actual cross-origin requests possible; route interception alone is not CORS evidence.
5. At remote setup time, inspect the existing S1 identity first; provision the separate static Worker only once, persist its confirmed identity, then feed its exact deployed origin into the API Worker configuration in Phase 3.

## Todo

- [x] Create the isolated Storefront client/build/deploy boundary.
- [x] Preserve the Console asset/build contract.
- [x] Establish the two-origin local test harness.
- [x] Record no guessed production origin or resource identity.

## Success Criteria

- [x] Storefront and Console produce separate asset outputs and can be launched at different local origins.
- [x] Storefront contains no direct D1/R2 binding or Console production import.
- [x] Existing Console deep links and API Worker-first routing remain the compatibility baseline.

## Risk Assessment

- A second Vite config can overwrite shared generated metadata or unintentionally replace the Console default build. Keep root/output/metadata paths explicit and test both builds.
- A guessed `workers.dev` origin would make CORS configuration brittle. Persist only the Worker name/origin returned by controlled provisioning.

## Security Considerations

- API base and CORS origin are public configuration, not credentials. Do not put tokens, D1 IDs, R2 keys, or raw Order capabilities in Storefront build-time configuration.
- A static Storefront Worker must not receive catalog write or storage bindings merely for convenience.
