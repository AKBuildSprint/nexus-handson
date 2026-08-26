# Nexus Console journey and state matrix

## Contract and notation

This is the Phase 2 presentation blueprint for the S1 Product Catalog Console. State IDs name visible, testable interface conditions. They do not approve API endpoints, DTOs, database structures, upload transport, persistence, R2 keys, caching, retries, or transaction behavior. The `/console/...` paths below are browser information architecture only.

State suffixes are literal: `DEFAULT`, `LOADING`, `EMPTY`, `DIRTY`, `WARNING`, `ERROR`, `SUCCESS`, and `DISABLED`. Every relevant control also supports `CTRL-DEFAULT`, `CTRL-HOVER`, `CTRL-FOCUS`, `CTRL-ACTIVE`, `CTRL-DISABLED`, `CTRL-LOADING`, `CTRL-ERROR`, `CTRL-SUCCESS`, and `CTRL-SELECTED` as defined in `docs/design-guidelines.md`.

## Route-level information architecture

| UI route | Screen | Purpose | Primary action |
| --- | --- | --- | --- |
| `/console/products` | `PL-01 Product list` | Search, filter, scan, and reopen Products. | **Add Product** |
| `/console/products/new` | `PE-01 Create Product` | Create one validated simple or Variant Product. | **Save Product** |
| `/console/products/:product` | `PE-02 Edit Product` | Edit one Product and its one active Variant schema. `:product` is an opaque UI location parameter. | **Save Product** |
| `/console/products/import` | `CI-01 CSV import workspace` | Download the template, preview one CSV, confirm bounded matrices, import, and inspect durable results. | **Choose CSV**, then **Import Products** |

```text
Products list
├─ Add Product -> Create Product
├─ Product name -> Edit Product
├─ Import CSV -> CSV import workspace
└─ Download CSV template -> browser download; remain on list

Create/Edit Product
├─ Save -> saved editor state
├─ Variant row -> focused Variant editor
└─ Back -> Product list, with dirty guard when needed

CSV workspace
├─ Download template -> remain in workspace
├─ Choose/replace file -> browser preview
├─ Confirm warning groups -> Import enabled
└─ Import -> durable result or recoverable failure on same route
```

No inventory, analytics, auth, Store switcher, custom-domain, import-history, or CSV-upsert destination appears anywhere.

## Screen registry

| ID | Required regions |
| --- | --- |
| `PL-01 Product list` | Console shell, header/actions, search, status filters, table or compact list, durable data-state region. |
| `PE-01 Create Product` | Sticky actions; Basics, Pricing, Public description, Delivery, Variants. |
| `PE-02 Edit Product` | Loading or loaded editor with the same sections and saved identity context. |
| `VB-01 Variant builder` | Option groups/values, participating-group selection, combination meter, regeneration preview, matrix. |
| `VR-01 Focused Variant editor` | Combination identity, SKU/price context, enabled state, delivery source, private-file state. |
| `CI-01 CSV import workspace` | Template/help and file selection, browser preview, confirmation, import action, durable authoritative result. |

## Product list state matrix

| State ID | Visible contract | Actions and accessible behavior |
| --- | --- | --- |
| `PL-LOADING` | Header/actions remain; search, filters, and row-shaped skeletons occupy final geometry. | Data region busy once; no per-skeleton announcements. |
| `PL-CATALOG-EMPTY` | **Create your first Product or import a prepared CSV.** No metrics or blank table. | Add Product primary; Import CSV and template secondary. |
| `PL-POPULATED` | Search; All/Draft/Active/Archived; Product, Status, Type, Effective price range, Enabled Variants, Updated time. | Product name is a specific link; table has accessible name. |
| `PL-FILTERED-LOADING` | Controls remain stable; only results skeletonize. | Focus stays on initiating control; one polite update. |
| `PL-FILTERED-EMPTY` | **No Products match these filters.** Query/scope remain. | Clear filters first; create/import still available. |
| `PL-REQUEST-ERROR` | Durable **Products could not be loaded** replaces data only, never a false empty state. | Retry plus independent create/import/template actions. |
| `PL-ROW-OPENING` | Activated row shows bounded progress without column shift. | Repeat activation suppressed. |
| `PL-TEMPLATE-LOADING` | **Downloading template** at stable width. | Polite start/completion. |
| `PL-TEMPLATE-SUCCESS` | Inline success names `nexus-product-import-template.csv`. | Continue or import. |
| `PL-TEMPLATE-ERROR` | Inline error beside action. | Retry or open import workspace. |

Rows show Simple or Variant, formatted effective price/range, enabled Variant count, and **Not applicable** for the simple Product Variant count. Never show integer storage language.

## Product editor state matrix

### Editor lifecycle

| State ID | Visible contract | Primary/recovery behavior |
| --- | --- | --- |
| `PE-CREATE-DEFAULT` | Empty validated form; Draft selected; no groups; delivery visible. | Save disabled with named prerequisites; initial edit focus Product name. |
| `PE-EDIT-LOADING` | Sticky action and section/field skeletons; no fake empty saved values. | Save disabled; region busy. |
| `PE-EDIT-READY` | Saved Product, status, delivery source, active schema/matrix. Bar reads **Saved**. | Save disabled until dirty. |
| `PE-LOAD-ERROR` | Durable page error; no editable invented defaults. | Retry or Back to Products. |
| `PE-DIRTY` | Bar reads **Unsaved changes**; Discard appears. | Save enabled only without blockers; first dirty transition announced once. |
| `PE-INVALID` | Error summary plus associated field/row errors. | Invalid Save focuses summary; links focus exact controls. |
| `PE-SAVING` | **Saving Product**; values remain readable. | Repeat save and destructive changes disabled. |
| `PE-SAVE-ERROR` | Durable error; all dirty values retained. | Retry, edit, or discard. |
| `PE-SAVED` | Dirty markers clear; editor remains in context. | Polite **Product saved**; no forced navigation. |
| `PE-DISCARD-WARNING` | Confirmation names Product and consequence. | **Stay and continue editing** / **Discard changes**; Escape means Stay; focus restored. |
| `PE-STATUS-DIRTY` | Draft/Active/Archived remains separate from content; whole Product dirty. | Save required. |
| `PE-SAVE-DISABLED` | Missing required field, invalid row/file, unresolved regeneration, or 31+ count. | Label stays readable; linked blockers available without hover. |

Sections are: required Product name; required decimal base price and ISO currency; Draft/Active/Archived; optional public description explicitly Customer-visible; required private access title/instructions plus optional PDF/ZIP; and Variants. Manual slug editing is not approved by this design.

### Price states

| ID | Contract |
| --- | --- |
| `PRICE-BASE-EMPTY` | Help precedes error; Save blocked. |
| `PRICE-BASE-VALID` | Editable decimal string and explicit currency. |
| `PRICE-BASE-ERROR` | Specific negative, malformed, or currency-precision error; raw input retained. |
| `PRICE-CURRENCY-DIRTY` | Inherited displays change currency and overrides require revalidation. No conversion promise. |
| `PRICE-VARIANT-INHERIT` | Blank override; effective price shows **Base price** source. |
| `PRICE-VARIANT-OVERRIDE` | Valid same-currency decimal; effective price shows **Override**. |
| `PRICE-VARIANT-ERROR` | Row/field error; Product Save blocked. |

## Delivery and private-file matrix

| State ID | Visible contract | Actions/consequence |
| --- | --- | --- |
| `DF-NO-FILE` | **No private file. PDF or ZIP, up to 25 MB.** | Choose PDF or ZIP. |
| `DF-CHOSEN` | Filename/size and pending check. | Replace/remove selection; Save waits. |
| `DF-VALIDATING` | **Checking file** progress. | Replacement and Save disabled. |
| `DF-VALID-PDF` | PDF, filename, size. | Save/Replace/Remove. |
| `DF-VALID-ZIP` | ZIP, filename, size. | Save/Replace/Remove. |
| `DF-TYPE-ERROR` | Actual content is not accepted PDF/ZIP. | Specific error; choose another; Save blocked. |
| `DF-SIZE-ERROR` | Actual size and 25 MB maximum. | Choose another; Save blocked. |
| `DF-REPLACE-DIRTY` | Current file and Replacement selected remain distinct; replacement applies after save. | Save/remove replacement; never claim old object is deleted. |
| `DF-REMOVE-DIRTY` | **File will be removed from this Product after save.** | Save or undo; no historical-object deletion claim. |
| `DF-SAVE-ERROR` | Current saved file remains visible; failed selection recoverable where feasible. | Retry or replace. |
| `VR-INHERIT-DEFAULT` | **Product default** and read-only access/file-presence summary. | Use Variant override. |
| `VR-OVERRIDE-EMPTY` | Complete replacement fields appear; title/instructions required; optional file uses `DF-*`. | Apply disabled until valid. |
| `VR-OVERRIDE-DIRTY` | **Unsaved Variant changes**. | Apply or cancel with dirty guard. |
| `VR-OVERRIDE-VALID` | **Variant override** preview. | Apply Variant changes, then Product Save. |
| `VR-OVERRIDE-ERROR` | Drawer summary and associated errors. | Apply disabled. |
| `VR-RETURN-TO-DEFAULT` | Warns Variant-specific content stops being used after save. | Keep override / Use Product default. |
| `VR-DISABLED` | Variant remains inspectable/editable while unavailable. | Re-enable; never delete implicitly. |

`VR-01` is a 480 px desktop drawer and full-width 375 px dialog. Both name the combination, contain focus, expose Close, and restore focus to the row.

## Option groups, meter, and matrix

### Group editing

| State ID | Visible contract | Action |
| --- | --- | --- |
| `VG-SIMPLE` | 0 groups; simple purchasable Product; no fake Variant row. | Add group. |
| `VG-GROUP-EMPTY` | New incomplete name/first value. | Generate disabled; remove group. |
| `VG-GROUP-READY` | Unique name and at least one unique value. | Add value/group within limits. |
| `VG-UNSELECTED` | **Not participating**; count excludes group. | Select. |
| `VG-SELECTED` | **Participating** checked state. | Deselect. |
| `VG-NONE-SELECTED` | Groups exist; meter 0 and tells operator to select. | Generate disabled. |
| `VG-GROUP-LIMIT` | **5 of 5 option groups**. | Add group disabled with reason. |
| `VG-VALUE-LIMIT` | **10 of 10 values**. | Add value disabled with reason. |
| `VG-DUPLICATE-GROUP` | Conflicting group named. | Save/generate blocked. |
| `VG-DUPLICATE-VALUE` | Duplicate in its group named. | Save/generate blocked. |
| `VG-RENAME-DIRTY` | Label-only rename updates displayed combinations without regeneration. | Save Product. |
| `VG-STRUCTURAL-DIRTY` | Add/remove or active participation change names affected groups/count. | Preview regeneration required. |
| `VG-STRUCTURAL-ERROR` | Invalid field or 31+ count. | Preview/Save disabled. |

Only one active schema appears. No schema tabs or versions.

### Combination behavior

| State ID | Count | Required message | Action |
| --- | ---: | --- | --- |
| `CM-ZERO` | 0 | **0 combinations. Select at least one option group and value.** | Disabled. |
| `CM-NORMAL` | 1-9 | **Ready to generate.** | Enabled when valid. |
| `CM-TEN` | 10 | **10 combinations. Ready to generate.** | Enabled without confirmation. |
| `CM-ELEVEN` | 11 | **11 combinations. Review the matrix and confirm before generating.** | Checkbox required. |
| `CM-WARNING` | 12-29 | Count plus same consequence. | Checkbox required. |
| `CM-THIRTY` | 30 | **30 combinations is the maximum. Confirm to continue.** | Checkbox required. |
| `CM-THIRTY-ONE` | 31 | **31 combinations exceeds the 30-combination limit. Remove an option value or participating group.** | Disabled; no bypass. |
| `CM-BLOCKED` | 32+ | Current count, maximum, correction. | Disabled. |
| `CM-RECALCULATING` | Pending | **Calculating combinations** in stable geometry. | Disabled until resolved. |

Track labels 10 and 30 persist. Text/icons accompany color. Any participating structure change resets confirmation.

### Generated rows and regeneration

| State ID | Contract |
| --- | --- |
| `VM-NOT-GENERATED` | Meter/preview shown, not an empty table. |
| `VM-LOADING` | Matrix-shaped skeleton; repeat generation and structural editing disabled. |
| `VM-DEFAULT` | Combination, SKU, Effective price, Price source, Delivery source, Status, row action. |
| `VM-ROW-DIRTY` | Row says **Unsaved**. |
| `VM-SKU-SUGGESTED` | New row SKU is suggested and editable. |
| `VM-SKU-ERROR` | Empty or conflict reason names SKU/combination; conflict differs from duplicate. |
| `VM-COMBINATION-ERROR` | Duplicate canonical combination named; Save blocked. |
| `VM-BASE-PRICE` / `VM-OVERRIDE-PRICE` | Effective price and source explicit. |
| `VM-ENABLED` / `VM-DISABLED` | Availability text explicit; Disabled row remains. |
| `VM-DELIVERY-DEFAULT` / `VM-DELIVERY-OVERRIDE` | Source explicit; focused editor available. |
| `VM-ROW-ERROR` | Error expands below affected row and links from summary. |
| `VM-SAVE-ERROR` | Matrix remains dirty and readable. |
| `SR-PREVIEW-LOADING` | Current rows stay while effects calculate. |
| `SR-RETAINED` | **Retained** with existing SKU, price, delivery, status. |
| `SR-NEW` | **New** with editable suggested SKU and base/default sources. |
| `SR-OBSOLETE` | **Will disable**; identity remains readable; never silently removed/hard-deleted in presentation. |
| `SR-NO-CHANGE` | **No combination changes**. |
| `SR-WARNING` | 11-30 summary lists Retained/New/Will disable counts; checkbox required. |
| `SR-BLOCKED` | 31+ or invalid New row; Regenerate and structural Save disabled. |
| `SR-APPLYING` | Preview stays visible with bounded progress. |
| `SR-APPLIED-DIRTY` | Proposed matrix active in editor; obsolete summarized under **Disabled by regeneration**; Product still dirty. |
| `SR-ERROR` | Current and proposed schema stay distinct; retry/revert offered. |

Rename-only uses `VG-RENAME-DIRTY`, never `SR-*`.

## CSV import matrix

### Unified template contract

Exactly one download is named `nexus-product-import-template.csv`. Help states it has one ordered header, one valid simple example, and two valid Variant rows; no type column; type detected per `product_slug`; simple rows leave Variant/options blank; Variant rows require SKU/status and one complete option pair; private files and delivery overrides are not imported; import adds exact matches and never updates existing catalog.

```csv
product_slug,product_name,base_price,currency,product_status,public_description,access_title,access_instructions,variant_sku,variant_price_override,variant_status,option_1_name,option_1_value,option_2_name,option_2_value,option_3_name,option_3_value,option_4_name,option_4_value,option_5_name,option_5_value
```

This is stable import-domain presentation, not a backend DTO.

### File and browser-preview states

| State ID | Visible contract | Import consequence |
| --- | --- | --- |
| `CI-DEFAULT` | Refreshed Salesforce-inspired split desktop workspace: template/dropzone left, explanation right. | Choose CSV; native input always available. |
| `CI-TEMPLATE-LOADING/SUCCESS/ERROR` | Stable download label, exact filename success, adjacent retry error. | Does not navigate. |
| `CI-DROP-ACTIVE` | 2 px accent boundary plus **Drop CSV to preview**. | Drag optional; keyboard Choose remains. |
| `CI-FILE-CHOSEN` | Filename/byte size; Replace available. | Parsing begins. |
| `CI-SIZE-ERROR` | Greater than 1 MB. Exactly 1 MB accepted. | Import disabled; replace. |
| `CI-PARSING` | Stable file summary and preview skeletons. | Import disabled. |
| `CI-ENCODING-ERROR` | UTF-8 requirement named. | Replace. |
| `CI-HEADER-ERROR` | First ordered-header mismatch and template link. | Replace/download. |
| `CI-MALFORMED-ERROR` | Specific file, row, or row-range reason where known. | Replace. |
| `CI-ROW-LIMIT-OK` | 0-500 data rows; exact 500 accepted. | Continue; 0 becomes empty error. |
| `CI-ROW-LIMIT-ERROR` | 501+ rows with actual count and 500 maximum. | Import disabled. |
| `CI-EMPTY` | **This CSV has no Product rows.** | Replace/download; disabled. |
| `CI-SIMPLE` | One row with Variant/options blank; **Simple Product** and row identity. | Provisional Ready if valid; no type selector. |
| `CI-VARIANT` | Required SKU/status/pairs; **Variant Product**, option summary, derived count, row range. | Provisional Ready or threshold state. |
| `CI-MIXED-ERROR` | Same slug mixes simple and Variant rows; exact rows named. | Whole Product group provisional Rejected. |
| `CI-PAIR-ERROR` | Missing name/value side, row, slug, SKU named. | Whole group Rejected. |
| `CI-PRODUCT-CONFLICT` | Product-level field and conflicting rows/range named; no winner guessed. | Whole group Rejected. |
| `CI-VARIANT-FIELD-ERROR` | Missing SKU/status named. | Whole group Rejected. |
| `CI-GROUP-LIMIT-ERROR` | Actual groups/values and allowed maximum named. | Whole group Rejected. |
| `CI-SPARSE-ERROR` | Missing derived combinations and supplied/derived counts. | Whole group Rejected. |
| `CI-EXTRA-ERROR` | Duplicate/extra combination and rows named. | Whole group Rejected. |
| `CI-DUPLICATE-CANDIDATE` | Exact in-file repetition with row references. | Provisional only. |
| `CI-IDENTITY-CONFLICT` | In-file SKU/combination conflict. | Rejected, never styled as Duplicate. |
| `CI-PREVIEW-VALID` | Aggregate detected shapes and provisional Ready/Duplicate candidate/Rejected counts. | Import depends on eligible groups/confirmations. |
| `CI-PREVIEW-ALL-REJECTED` | Grouped exact reasons. | Import disabled. |

Preview is labeled **Browser preview**. Only authoritative result states use Added, Duplicate, Rejected.

### CSV combination and confirmation

| ID | Count | Result |
| --- | ---: | --- |
| `CI-CM-NORMAL` | 1-9 | Ready, no confirmation. |
| `CI-CM-TEN` | 10 | **10 combinations. Ready to import.** |
| `CI-CM-ELEVEN` | 11 | Warning and confirmation. |
| `CI-CM-WARNING` | 12-29 | Warning per affected Product group. |
| `CI-CM-THIRTY` | 30 | Maximum warning and confirmation. |
| `CI-CM-THIRTY-ONE` | 31 | Blocked; affected group rejected before upload. |
| `CI-CM-BLOCKED` | 32+ | Blocked with maximum/correction. |
| `CI-CONFIRM-UNCHECKED` | Any eligible 11-30 group | Panel lists every slug/count; single checkbox reviews all; Import disabled. |
| `CI-CONFIRM-CHECKED` | Current preview confirmed | Import enabled if at least one group eligible. |
| `CI-CONFIRM-RESET` | File/data/count changes | Confirmation clears; reconfirm required. |

Confirmation never bypasses 31+.

### Authoritative result presentation

| State ID | Contract |
| --- | --- |
| `CI-IMPORT-DISABLED` | Label remains with linked blockers. |
| `CI-UPLOADING` | File/preview stay; **Uploading CSV**; repeat/replace disabled. |
| `CI-SERVER-CHECKING` | **Checking and importing Products**; preview labeled non-final. |
| `CI-FILE-FAILURE` | File-level error; no false committed counts; retry/replace. |
| `CI-SERVER-VALIDATION-FAILURE` | Durable whole-file error; no cleanup-mechanics claim. |
| `CI-RESULT-SUCCESS` | Durable aggregate and row outcomes; focus result heading. |
| `CI-RESULT-MIXED` | Added/Duplicate/Rejected counts and groups all distinguishable. |
| `CI-RESULT-ALL-DUPLICATE` | **No new catalog records were added. All rows matched existing records.** |
| `CI-RESULT-ALL-REJECTED` | Durable exact group/row reasons. |
| `CI-ROW-ADDED` | Added plus row, slug, SKU if present. |
| `CI-ROW-DUPLICATE` | Safe exact Duplicate and matching reason; no overwrite. |
| `CI-ROW-REJECTED` | Rejected plus row/range, slug, SKU, field/group, reason. |
| `CI-ROW-IDENTITY-CONFLICT` | **Rejected: identity conflict**, never counted Duplicate. |
| `CI-RESULT-ERROR` | Durable result-presentation error; never invent counts. |

Server result visually supersedes preview and remains without a toast. **Start another import** explicitly resets a completed result.

## Desktop and 375 px transformations

| Region | Desktop | 375 px |
| --- | --- | --- |
| Shell | 208 px rail and flexible canvas. | 56 px top bar; labeled nav trigger; rail removed from layout. |
| Header | One-line action hierarchy. | Title first; primary visible; secondary in labeled overflow or stack. |
| Product list | Six-column, 48 px rows. | Semantic summaries containing all decision fields, never a horizontal desktop table. |
| Search/filter | Search plus tabs. | Full-width search and wrapping 44 px tabs or labeled select. |
| Editor action | Sticky top Back/title/status/dirty/Discard/Save. | Compact context top; safe-area bottom Save; blockers above; no field overlay. |
| Forms | At most two columns inside 960 px. | One column, 16 px padding, 16 px input text. |
| Price/currency | Adjacent if readable. | Adjacent only if targets/labels fit; otherwise stack. |
| Groups | Compact rows. | Full-width groups; values wrap vertically, no chip rail. |
| Meter | Track/count/message/action structured together. | Count/message, track, action; 10/30 labels retained. |
| Matrix | Seven-column table. | Combination summaries and full-width focused editor, no hidden/scrolled columns. |
| Regeneration | Comparison rows. | Stacked Retained/New/Will disable groups. |
| Variant editor | 480 px drawer. | Full-height, full-width dialog. |
| File | Inline summary/actions. | Wrapping filename and stacked metadata/actions. |
| CSV | Template/upload left; preview/results right. | Template, file, counts, groups, row details in source order; no spreadsheet scroll. |
| Results | Dense table, expandable reasons. | Divider summaries, expandable detail; all identity/reason text wraps. |

The exact 375 px fixture uses long Product/option names, long filename, a 30 warning, and a long rejection reason. Body/main must have no horizontal page scroll.

## Keyboard and error contract

- First Tab reveals **Skip to main content**.
- Search updates politely without moving focus.
- Status tabs use arrows/Home/End; compact select is labeled.
- Group/value actions are named and work with Enter/Space; no drag-only or Backspace-only behavior.
- Participation controls expose group name and checked state; count and consequence announce together.
- 11-30 checkboxes precede enabled Generate/Import. At 31, announce count, block, maximum 30 once.
- Matrix controls include row identity; errors stay under row and link from summary.
- Focused Variant editor contains focus and restores it to the triggering row.
- File selection always has native keyboard input; drag is enhancement.
- Invalid Save focuses summary; save error preserves dirty data; success stays in context.
- Escape in dirty guard means Stay, never discard.
- CSV group expanders expose expanded state; explicit import completion focuses durable result heading.
- Every target is at least 44 by 44 px, every error is associated, every focus ring remains visible, and no state relies on color alone.

## Acceptance crosswalk

| Frontend criterion | Named screens/states |
| --- | --- |
| Product list loading/empty/populated/error | `PL-01`, all `PL-*`. |
| Editor fields and lifecycle | `PE-01`, `PE-02`, `PE-*`, `PRICE-*`, `DF-*`. |
| 0-5 groups, 10 values, one schema, participation | `VG-*`; no schema tabs. |
| Suggested SKU, price/delivery override | `VM-SKU-*`, `PRICE-VARIANT-*`, `VR-*`. |
| 10/11/30/31 behavior | `CM-*` and `CI-CM-*`. |
| Retained/New/obsolete-disabled | `SR-RETAINED`, `SR-NEW`, `SR-OBSOLETE`, `SR-APPLIED-DIRTY`. |
| Unified template and simple/Variant preview | `CI-TEMPLATE-*`, `CI-SIMPLE`, `CI-VARIANT`. |
| 1 MB/500 rows | `CI-SIZE-ERROR`, `CI-ROW-LIMIT-OK`, `CI-ROW-LIMIT-ERROR`. |
| Mixed/incomplete/conflict/sparse/extra reasons | Corresponding `CI-*-ERROR` states. |
| Warning before upload and 31+ block | `CI-CONFIRM-*`, `CI-CM-THIRTY-ONE`. |
| Durable authoritative Added/Duplicate/Rejected | `CI-SERVER-CHECKING`, `CI-RESULT-*`, `CI-ROW-*`. |
| Keyboard/focus/errors/44 px | Keyboard section and `CTRL-*`. |
| Desktop and 375 px, no horizontal page scroll | Responsive matrix and long-content fixture. |
| No backend assumptions or excluded scope | Contract statement and exclusions below. |

### S1 brief criteria with frontend impact

| # | Mapping | Boundary |
| ---: | --- | --- |
| 1 | List, create/edit loading/ready/saved, simple/matrix. | Journey shown; real persistence later. |
| 2 | Group/value limits and meters. | UI prevents/explains; server enforcement later. |
| 3 | 11/30 confirmation and 31 block in editor/import. | Fully visible/keyboard actionable. |
| 4 | Rename dirty; structural Retained/New/Will disable. | Identity enforcement later. |
| 5 | Suggested/editable/conflicting SKU and combination. | Result shown; lookup mechanics unspecified. |
| 6 | Decimal base/override/effective source. | Integer conversion later. |
| 7 | Default/complete override/private file. | Public API and Order snapshot later. |
| 8 | One template, exact header/examples. | Fully specified presentation/domain contract. |
| 9 | Simple/Variant detection, no type control, warning/cap. | Fully visible. |
| 10 | Sparse/extra exact-matrix rejection. | Exact reasons visible; mechanics unspecified. |
| 11 | No-update copy; Added/Duplicate/Conflict. | No upsert controls. |
| 12 | Mixed/pair/Product conflict group errors. | Exact row/range reasons. |
| 13 | All-duplicate re-import vs identity conflict. | Distinct states. |
| 14 | File/server validation failure. | No false counts; atomic cleanup later. |
| 15 | No Console screen; private content stays in editors. | Storefront API verification later. |
| 16 | PDF/ZIP valid/type/size states. | Random keys/byte enforcement later. |
| 17 | File replacement/removal copy. | Retention enforcement later. |
| 18 | No login/profile/role/auth claim. | Real authorization deferred. |
| 19 | All named fixtures plus Mobbin evidence. | Phase 2 approval; no status mutation. |
| 20 | Browser boundary/error plus server-check state. | Worker enforcement later. |
| 21 | No UI; custom domain excluded. | Deployment later. |

## Explicit exclusions and anti-assumptions

Do not add inventory, stock, warehouses, quantities, shipping, barcodes, vendors, fulfillment, sales channels, analytics, revenue/report cards, login/session/profile/roles, Store switching, custom domains/deploy controls, CSV upsert/overwrite/merge/field mapping, import history/background jobs, Storefront/Cart/checkout/Orders/Payments/grants, public delivery URLs/storage keys, or configurable limits.

Fixtures must not present endpoint methods, payloads, database structures, upload transport, preview sessions, polling/background mechanics, R2 lifecycle, state-management/caching, optimistic persistence, retry/concurrency policy, or conflict algorithms as approved. **Server result** means only the durable presentation after authoritative processing.

## Phase 2 fixture set

Phase 2 can proceed without new domain decisions using fixtures for: every `PL-*`; create/edit invalid-dirty-saving-error-saved; all `PRICE-*`, `DF-*`, and `VR-*`; 0 groups, 5 groups, 10 values, no participating group; exact counts 10/11/30/31; Retained/New/Will disable; SKU/combination/price/row errors; CSV default/drag/parsing/exact 1 MB/over 1 MB/exact 500/501/header/malformed/empty; simple/Variant/mixed/pair/Product conflict/sparse/extra/duplicate/31+; warnings at 11/30 with reset; server checking/success/mixed/all duplicate/all rejected/identity conflict/file failure; and every primary screen at desktop and exactly 375 px with long content.

Fixtures are presentation evidence only. They do not approve backend behavior or mutate design approval status.
