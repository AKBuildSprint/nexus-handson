# Mobbin UI reference research

## Purpose

Frontend-first reference set for Nexus S1 Operations Console. Evidence informs design; it is not a request to copy Shopify, Salesforce, or Squarespace branding.

## Reviewed flows

1. [Shopify: Adding variants](https://mobbin.com/flows/fac2b590-3de3-45b0-9581-c453ed412e2a)
   - Option groups edited before generated combinations.
   - Variant matrix shown inline in Product editor.
   - Price, SKU and enabled state remain visible at row level.
   - Row-specific editing uses a focused overlay instead of expanding every advanced field.

2. [Shopify: Adding a product](https://mobbin.com/flows/8db969f5-0dc2-4d15-a584-3fb719d63b65)
   - Long Product form split into clear sections.
   - Save/discard controls remain visible in a sticky top bar.
   - Status is separated from core Product content.

3. [Shopify: Editing a variant](https://mobbin.com/flows/a136c90d-2af3-42ca-b5cb-e7e8875a9bed)
   - Matrix supports inline bulk fields and focused per-Variant detail editing.
   - Variant identity and pricing remain easy to scan across combinations.

4. [Shopify: Importing products](https://mobbin.com/flows/e71975c4-268e-4da8-873b-098e3281df92)
   - Import starts from Product list.
   - Preview summarizes Product and SKU counts before confirmation.
   - Confirmation is separate from file selection.

5. [Salesforce: Importing products](https://mobbin.com/flows/c9d0c0c8-2314-4979-8567-3a9a29fe6230)
   - Dedicated import workspace keeps template download and file upload visible.
   - Result summary and row errors share the same surface.
   - Error copy names the invalid field instead of returning one generic failure.

6. [Squarespace: Import products](https://mobbin.com/flows/33decfd4-a722-43ff-bce0-90bab6fff9a5)
   - Minimal Product table with Import and Add Product as primary actions.
   - Import failure identifies exact rows and reasons in a focused panel.

## Nexus design direction

**Design read:** dashboard/product UI for a Store operator, with an industrial-utilitarian language and a restrained data-first interface.

- Dials: variance 3, motion 2, density 6.
- Layout: compact left navigation, full-width working canvas, exposed tables, sticky action bar.
- Depth: hairline dividers and surface tint only; no card-plus-shadow stacking.
- Shape: restrained 4-8px radii; no pill-heavy dashboard.
- Accent: one confident operational accent used only for primary action, selection and state.
- Memorable element: Variant combination meter. It shows normal state at 0-10, confirmation warning at 11-30 and blocked state above 30.

## Screen contract

### Product list

- Search, status tabs and a data table.
- Columns: Product, status, type, effective price range, enabled Variants, updated time.
- Primary action: Add Product.
- Secondary actions: Import CSV and Download CSV template.
- Empty state points to Add Product and Import CSV; no fabricated analytics.

### Product create/edit

- Sticky top actions: Back, Save, status.
- Sections: Basics, Pricing, Public description, Delivery, Variants.
- Variant builder starts with option groups/values, then combination preview.
- Combination meter appears before materialization.
- Generated rows expose combination, suggested editable SKU, effective price and enabled state.
- Delivery override opens a focused drawer/dialog per Variant.

### CSV import

- Dedicated workspace, not a modal-only flow.
- Template download and dropzone remain visible.
- Browser preview shows detected simple/Variant Product groups, added/duplicate/rejected counts and row reasons.
- 11-30 combinations requires explicit confirmation; more than 30 blocks upload.
- Server result replaces preview state after upload and remains readable without a transient toast.

## Patterns deliberately excluded

- Salesforce field-mapping wizard: Nexus owns one fixed template, so mapping adds no value.
- Inventory, barcode, shipping, vendor and sales-channel controls from Shopify: outside S1.
- Product analytics/stat cards: no owning data or acceptance criterion.
- CSV upsert controls: import is additive exact-match only.
- Modal-only error reporting: row-level validation needs durable working space.

## Design approval gate

Before backend phases are finalized:

- Product list, simple Product editor, Variant editor and CSV import states are browser-visible.
- Desktop and 375px responsive behavior reviewed.
- Default, hover, focus, active, disabled, loading, empty, warning, error and success states present.
- Combination meter and 30-combination boundary understood without documentation.
- User approves information architecture, density, visual direction and interaction flow.
- Approved component fields and transitions are reconciled into API, schema and test phases.

## Open questions

None. Visual details remain subject to the explicit design approval gate.
