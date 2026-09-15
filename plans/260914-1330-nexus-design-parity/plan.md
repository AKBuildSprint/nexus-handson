---
title: "Nexus HTML demo visual parity"
description: "Reproduce the HTML demo's desktop composition in the real Console and Storefront, with explicit accessibility, mobile and production-behavior exceptions."
status: in_progress
priority: P1
effort: "not-estimated"
issue: null
branch: "fix/currency-minor-unit-precision"
tags: [frontend, feature]
blockedBy: []
blocks: []
created: 2026-09-14
---

# Nexus HTML demo visual parity

## Approved outcome

User clarification, 2026-09-14: **“mục đích cook xong plan là giống với file html demo.”** The finished real Console and Storefront must reproduce `design/UI-UX/Nexus Console.dc.html` in composition and visual detail, not merely use matching fonts and colors.

This supersedes the original token-cleanup/same-design-language interpretation of this plan. It is a presentation cutover in the existing React applications. Update canonical presentation documentation and tokens during cook; do not keep the old production appearance as an alternative authority for visual layout.

## Mandatory reading order

1. [Reference parity contract](./reference-parity-contract.md): source anchors R01–R10, exact desktop geometry, closed exceptions E01–E09, pass/fail rules.
2. [Phase 1 — Reference baseline and canonical token cutover](./phase-01-start.md).
3. [Phase 2 — Console surfaces](./phase-02-console-surfaces.md).
4. [Phase 3 — Storefront surfaces](./phase-03-storefront-surfaces.md).
5. [Phase 4 — Visual and behavioral verification](./phase-04-visual-verification.md).
6. Original [HTML demo](../../design/UI-UX/Nexus%20Console.dc.html), current [design guidelines](../../docs/design-guidelines.md), and the affected implementation files listed by each phase.

Do not cook from this index alone. The contract and phase details are part of the acceptance criteria.

## Delivery contract

**Must look like the demo:** compact white 232 px Console rail, 56 px deskbar, tab-like list titles, bordered tables with footer statistics, centered Product configuration overlay, split CSV workspace, compact Orders/detail sections, white Storefront header, marketing hero with a two-row snapshot, catalog-left/ledger-right layout, and narrow private Order paper.

**Must replace conflicting old presentation:** large serif Products/Orders titles, butter title rules, elevated metric tiles above lists, 256 px rail/64 px desktop deskbar, full-width four-column Storefront, decorative initials/hero CTA, announcement banner, editorial ink band and unrelated decorative chrome. Do not just hide them with CSS; remove obsolete markup/styles once real behavior/data has been relocated.

**Must preserve:** only Products/Orders destinations, legitimate role-aware identity, real routes/deep links, live catalog/server-filtered Order metrics, pagination, complete editor/file/CSV/Order/cart/refund behaviors, all production retry/state/privacy contracts, keyboard access, 44 px targets, 16 px inputs, and usable 375 px layout.

**Must not port:** `DCLogic`, mock arrays, prototype noop handlers, fake identity/metrics, dead preview controls, fixture-only Order switchers, or malformed mobile layout. Do not edit the demo to make production appear correct.

**Non-goals:** backend/API/DTO/schema/migration changes; new permissions, auth flows or role switching; public payment/delivery URL changes; a new Product preview feature; a new search service; rebuilding the design runtime; deployment. Existing supported behavior may be recomposed, not replaced.

**Meaning of parity:** the desktop reference is authoritative except for the closed E01–E09 register. At 375 px, faithfully adapt its visual hierarchy rather than copy its overflow. A broad “production semantics” disclaimer is not an acceptance waiver.

## Phase sequence and ownership

| Phase | Output | Dependency | Cook owner |
| --- | --- | --- | --- |
| 1 | Reference evidence, reconciled guideline, shared token/primitives contract | None | Integration owner |
| 2 | All Console screens and production route-backed editor overlay | Phase 1 | Console owner |
| 3 | Storefront catalog/ledger/private Order composition | Phase 1 | Storefront owner |
| 4 | Paired screenshots, measured parity, state/behavior evidence, final cleanup | Phases 2 and 3 | Integration owner |

Phase 2 and Phase 3 may run concurrently only after Phase 1 hands off tokens. Console owner edits `apps/console/src/**`; Storefront owner edits `apps/storefront/src/**`. Shared token or guideline changes after handoff are serialized through the integration owner. Development harness callers and affected tests must migrate with changed presentation interfaces; no stale compatibility props or copied state machines.

## Completion checklist

- [x] P01–P04 Phase 1 tasks pass and there is only one active token/guideline system.
- [ ] C01–C08 Console evidence covers sign-in, lists, editor, Variant drawer, CSV, Orders, detail and role/mobile lifecycle.
- [ ] S01–S04 Storefront evidence covers chrome/catalog, cart/checkout, private Order/refund and responsive/privacy states.
- [ ] R01–R09 paired desktop captures visibly match the demo and critical geometry is within 2 CSS px outside registered exceptions.
- [ ] 1024 and 375 production captures preserve all essential sections/actions with no page-level horizontal overflow; boundary checks pass.
- [ ] Every remaining visual difference has an exact region, E-ID, reason and evidence. No unsupported difference remains.
- [ ] Actual production entrypoints and authenticated/local API flows are reverified after A01–A04; development scenarios alone do not count.
- [ ] Post-repair builds and existing relevant browser/E2E contracts pass; visual evidence is retained and disposable tools removed after proof. Prior green runs remain historical evidence.

No percentage score substitutes for these checks. Missing editor overlay, wrong metric placement, wrong Storefront split, or dropped state is a blocking failure even if tokens and builds pass.

## Validation log — planning evidence, not implementation evidence

### User decision and audit correction

- User explicitly confirmed HTML-demo resemblance as the cook outcome. This revision chooses reference-first composition rather than preserving the current production visual hierarchy.
- Previous “24/24 verified” wording was not backed by a claim/evidence list and is removed. It must not be interpreted as visual acceptance.
- The preceding audit opened the original demo over local HTTP and visually inspected Products, Product editor and Storefront. Measured Products rail 232 px and Add Product height 34 px; source confirms 56 px deskbar. At 375 px the Products document measured 623 px wide. E02/E04 intentionally retain production accessibility/responsiveness rather than these defects.
- Source reads cover original sign-in/Console/CSV/Orders/editor/Storefront/private Order markup and state, current canonical guideline/tokens, production route and component inventory, root package scripts, Vitest browser config and Playwright fixture configuration.
- At the original planning revision, build/test commands were execution gates, not results. Current implementation progress is recorded in the dated repair sections below; do not interpret this historical log as the current task status.

### Key risk decisions already resolved

- **Conflicting visual authority:** Phase 1 rewrites old visual prescriptions in the canonical guideline and migrates the existing token system; no second system is introduced.
- **Editor route versus overlay:** keep URLs/data/state semantics but render the full route-backed Product configuration overlay; separately retain the focused Variant drawer.
- **Reference auto-fit trap:** at 1440 the Product editor body can have three tracks with only the first two occupied before full-span sections. Do not substitute a guessed 50/50 form layout.
- **Mobile reference defect:** source desktop is the visual master; compact/mobile follows E04 and is independently verified.
- **Mock behavior versus real behavior:** keep APIs/permissions/retries; integrate additional functional controls into specified compact regions, not legacy page-wide sections.
- **Evidence retention:** screenshots/measurements are final review artifacts, not throwaway implementation tooling; Phase 4 does not delete proof.

### Final consistency check

- Ran an in-memory structural validation across all six plan files: 10 local Markdown links resolve; all six cited root npm script names exist; 22 matched source-path references resolve; 49 R/E/C/S/V coverage-ID presence checks pass; Markdown fences balance and implementation checkboxes remain uncompleted. No structural issues remained.
- The explicitly planned disposable `tests/e2e/console-design-parity-capture.spec.ts` is not an existing file and was excluded from existing-source checks. Cook creates/removes it only if that capture path is used.
- Independent scoped reviews covered the shared contract/Phase1 source fidelity and Phase4 runtime/verification configuration. The capture-isolation finding was resolved by preferring the existing Playwright-owned environment and specifying the complete isolation environment for any manual alternative.
- Main integrated the Console/Storefront drafts against the source and cross-phase contract: full editor backdrop and one Save footer; responsive real-search hosting; observable dirty guards instead of native-confirm test pins; server-enforced Staff assignment visibility; radio-pill option groups/quantity stepper; exact Storefront grid math; truthful no-file-delivery copy; retained screenshot evidence.
- This validates the PLAN, not the future application. No app code was changed and no build/browser/E2E suite was run for this documentation revision. Runtime visual and behavior gates remain pending for cook.

## Cook handoff

Resume the existing plan at Phase 2 A01–A04, then complete Phase 4, including unresolved whole-plan coverage. Do not restart completed Phase 1 work or redesign Phase 3 surfaces without an observed defect.

```text
/ak:cook plans/260914-1330-nexus-design-parity/plan.md
```

Planning does not authorize deployment. Stop only when the complete UI and evidence meet this plan, or when a specifically identified external prerequisite cannot be obtained. Do not finish at a token-only or “same visual language” milestone.


## Repair round — 2026-09-15

Direct original-scale inspection reopened the plan after the prior 50%-scale comparisons concealed action alignment,
editor-density, CSV-layout and Storefront toolbar/selection differences. Repairs and native-scale before/after
artifacts are recorded in `evidence/verification.md` under “2026-09-15 — original-scale Sol parity repair” and in
`evidence/repair-20260915/`.

Sol's repair and Astra's independent review are complete and integrated into the current worktree; Astra also
fixed the mobile CSV notice and restored the currency-conversion warning. Console/Storefront builds, 79 browser
tests and 37 E2E tests pass. See the dated Astra review in `evidence/verification.md` and
`evidence/repair-20260915/astra-review/` for fresh runtime proof.

The subsequent fresh Astra self-audit found four remaining implementation defects. The plan is
open for **repairs and whole-plan visual acceptance**, not merely screenshot completion.
The preceding green results apply to the already-integrated repair, not the next changes.

## Current next work — audit corrections

User requested this plan update after the fresh 2026-09-15 audit. The original outcome,
reference authority, closed E01–E09 exceptions and backend/deployment non-goals are unchanged.
Full implementation and pass criteria live in
[Phase 2 audit repair backlog](./phase-02-console-surfaces.md#audit-repair-backlog--2026-09-15):

- [x] **A01 / P1:** restore Option groups/Variant matrix header/body composition, remove
  redundant notices and matrix side inset, and restore primary Add option group.
- [x] **A02 / P2:** stop a clean, never-saved new Product from claiming Saved; preserve
  real dirty/saving/error/persisted lifecycle and dismissal behavior.
- [x] **A03 / P2:** restore CSV 14/12 px dropzone typography, one file metadata summary
  and a full-width Import Products action without losing validation/retry feedback.
- [x] **A04 / P2:** restore the five-field Payment layout for no recorded payment,
  using honest absent values and retaining recorded/legacy evidence semantics.

Proof source: [fresh audit report](./evidence/verification.md#2026-09-15--fresh-astra-self-audit-requested-by-the-user)
and [30-capture measurements](./evidence/audit-20260915-astra/measurements.json).
Run [Phase 4 audit repair gate](./phase-04-visual-verification.md#audit-repair-gate--a01a04)
after implementation. Each A-ID needs its own post-fix evidence before checking it off
here and in Phase 2. V02–V06 remain open; no inherited green checkbox substitutes for
post-change proof or the missing private Order/refund/fulfilled and responsive coverage.

This revision changes planning documents only. No application fixes, new test results,
commit, push or deployment are claimed.

<!-- slug: nexus-design-parity -->
