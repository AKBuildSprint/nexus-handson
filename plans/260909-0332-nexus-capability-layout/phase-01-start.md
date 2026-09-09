---
phase: 1
title: "Capability and application cutover"
priority: P1
dependencies: []
---

# Capability and application cutover

## Goal
Move ownership while preserving executable behavior. Integration owner handles all physical moves, imports, manifests, configuration and test/script paths. Orders decomposition can follow physical moves; no concurrent edits to shared files.

## Test-first evidence
Before edits run existing Node 22 unit/integration suite and capture all seven migration SHA-256s. Existing tests characterize requested unchanged behavior. No artificial layout/source-text unit tests. After extraction, rerun same suite; add regression coverage only for a genuinely uncovered risk in moved transition behavior.

## Files and steps
1. Use LSP rename_file for TS moves when available, resolving references before modifying exported symbols; no missed imports. Move src/console to apps/console/src, storefront to apps/storefront, src/worker to apps/worker/src. Move src/catalog to packages/catalog/src and src/import,files,shared into its corresponding owned subdirectories. Remove obsolete directories only after all callers are migrated.
2. Move src/orders into packages/orders/src. Put order-read in queries; order-write and order-commands in commands. Extract existing D1 command-ledger/read/batch/recovery helpers into persistence/command-store. Extract existing pure actor and eligibility rules into transitions/order-transitions. Preserve prepare/authorize/parse/replay order, v1 ledger rejection, current SQL and bindings, failed-batch recovery and conflict replay order, private snapshot boundary and D1 atomic batches. Never split a transaction into sequential independent writes.
3. Define private npm workspace manifests. Catalog owns papaparse; orders declares catalog dependency; console declares runtime React and consumed capabilities; worker declares capabilities; storefront declares React. Root keeps tooling and dependencies needed by root scripts. Concrete TS exports support nested package paths. npm install --package-lock-only under Node 22 updates workspace links without dependency upgrades; prove clean npm ci afterward.
4. Move Console HTML/Vite config to its app; root scripts choose explicit config. Explicitly set Vite root to app, Cloudflare configPath to root wrangler, persistence to existing root state, and build output to match root Wrangler assets. Move Storefront config and adjust repo-relative access. Root wrangler main becomes apps/worker/src/index.ts; asset path matches Console build. Keep D1 migrations discovery, identities, vars, run_worker_first and deploy argv unchanged. Root Wrangler remains the sole Console/API owner; the existing independent asset-only Storefront Wrangler moves to apps/storefront/wrangler.jsonc with its schema path corrected and --name contract preserved.
   Console deployment must explicitly select `apps/console/dist/nexus_s1_468cba/wrangler.json` after build. User approved this runtime correction: bare root Wrangler can select a stale root deploy redirect; app `--cwd` alone produces a source/deploy base-path conflict. Do not copy generated config metadata or rely on clearing state as the fix.
5. Update tsconfig apps/packages/config includes, production import graph paths and graph metadata, Playwright/Vitest paths, verification scripts, tests and prototype-only design imports. Root tests already have four risk layers: do not move fixture/support helpers into test discovery. No behavior expectation changes.

## Verification
Node 22: npm ci; npm run typecheck; npm run test:unit; npm run test:integration; npm run test:browser; npm run build:console; npm run build:storefront. Compare migration checksum manifest and dependency versions against baseline. Search active source/config/scripts for old production paths, excluding historical evidence. Verify no reverse package-to-app or catalog-to-orders dependencies.

## Completion evidence
- [x] Applications and catalog relocated with TypeScript AST module-specifier rewrites after LSP folder rename failed with overlapping edits; no old source shims.
- [x] Orders queries/commands/persistence/transitions implemented; SQL and binding expression comparison matched all 23 command expressions.
- [x] Private workspace links installed with Node 22 npm ci; existing third-party versions unchanged.
- [x] Typecheck, 142 workerd tests, 48 browser tests and both builds passed; test expectations changed only in imports.
- [x] All seven migrations have byte-identical SHA-256s; 59 other source bodies/styles unchanged outside imports.
