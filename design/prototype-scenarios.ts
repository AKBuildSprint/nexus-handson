export type ProductStatus = 'Draft' | 'Active' | 'Archived';
export type ProductType = 'Simple' | 'Variant';
export type ProductListState =
  | 'loading'
  | 'filtered-loading'
  | 'empty'
  | 'populated'
  | 'error'
  | 'row-opening'
  | 'template-error';
export type EditorLifecycle = 'create' | 'loading' | 'ready' | 'dirty' | 'error' | 'save-error';
export type CsvPreviewState =
  | 'default'
  | 'simple'
  | 'variant'
  | 'warning'
  | 'blocked'
  | 'errors'
  | 'uploading'
  | 'checking'
  | 'file-failure'
  | 'server-validation-failure'
  | 'success'
  | 'result'
  | 'all-duplicate'
  | 'all-rejected'
  | 'result-error';

export interface ProductSummary {
  id: string;
  name: string;
  status: ProductStatus;
  type: ProductType;
  effectivePrice: string;
  enabledVariants: number | null;
  updated: string;
}

export interface DeliveryFixture {
  accessTitle: string;
  accessInstructions: string;
  file?: {
    name: string;
    sizeLabel: string;
    kind: 'PDF' | 'ZIP';
  };
}

export interface OptionGroupFixture {
  id: string;
  name: string;
  values: string[];
  participating: boolean;
}

export interface VariantFixture {
  id: string;
  combination: string;
  sku: string;
  priceOverride: string;
  effectivePrice: string;
  priceSource: 'Base price' | 'Override';
  deliverySource: 'Product default' | 'Variant override';
  enabled: boolean;
  outcome?: 'Retained' | 'New' | 'Will disable';
  deliveryOverride?: DeliveryFixture;
}

export interface ProductEditorFixture {
  name: string;
  status: ProductStatus;
  basePrice: string;
  currency: string;
  publicDescription: string;
  delivery: DeliveryFixture;
  groups: OptionGroupFixture[];
  variants: VariantFixture[];
}

export interface ProductEditorScenario {
  id: string;
  label: string;
  lifecycle: EditorLifecycle;
  product: ProductEditorFixture;
}

export interface CsvGroupFixture {
  id: string;
  slug: string;
  type: ProductType;
  rows: string;
  combinations: number;
  previewOutcome: 'Ready' | 'Duplicate candidate' | 'Rejected';
  reason?: string;
}

export interface CsvPreviewRowFixture {
  rowNumber: number;
  slug: string;
  sku?: string;
  outcome: 'Ready' | 'Duplicate candidate' | 'Rejected';
  reason: string;
}

export interface CsvResultRowFixture {
  row: string;
  slug: string;
  sku?: string;
  outcome: 'Added' | 'Duplicate' | 'Rejected';
  reason: string;
}

export interface CsvScenario {
  id: string;
  label: string;
  state: CsvPreviewState;
  file?: {
    name: string;
    sizeLabel: string;
    rows: number;
  };
  groups: CsvGroupFixture[];
  previewRows?: CsvPreviewRowFixture[];
  templateState?: 'loading' | 'success' | 'error';
  warningCount?: number;
  fileError?: string;
  resultRows?: CsvResultRowFixture[];
}

export const CSV_HEADER =
  'product_slug,product_name,base_price,currency,product_status,public_description,access_title,access_instructions,variant_sku,variant_price_override,variant_status,option_1_name,option_1_value,option_2_name,option_2_value,option_3_name,option_3_value,option_4_name,option_4_value,option_5_name,option_5_value';

export const CSV_TEMPLATE = `${CSV_HEADER}\nfield-notes,Field Notes,24.00,USD,active,A concise guide,Download Field Notes,Open the PDF from your order,,,,,,,,,,,,,\nfocus-pack,Focus Pack,36.00,USD,draft,Desktop focus templates,Download Focus Pack,Open the ZIP from your order,FOCUS-DARK,,enabled,Theme,Dark,License,Personal,,,,,,\nfocus-pack,Focus Pack,36.00,USD,draft,Desktop focus templates,Download Focus Pack,Open the ZIP from your order,FOCUS-LIGHT,,enabled,Theme,Light,License,Personal,,,,,,\n`;

const populatedProducts: ProductSummary[] = [
  {
    id: 'field-notes',
    name: 'Field Notes for Independent Product Teams',
    status: 'Active',
    type: 'Simple',
    effectivePrice: '$24.00',
    enabledVariants: null,
    updated: 'Aug 26, 2026 at 09:42',
  },
  {
    id: 'focus-pack',
    name: 'Focus Workspace Template Pack',
    status: 'Draft',
    type: 'Variant',
    effectivePrice: '$36.00 to $48.00',
    enabledVariants: 8,
    updated: 'Aug 25, 2026 at 17:18',
  },
  {
    id: 'launch-library',
    name: 'Launch Systems Library',
    status: 'Archived',
    type: 'Variant',
    effectivePrice: '$58.00',
    enabledVariants: 4,
    updated: 'Aug 22, 2026 at 11:06',
  },
];

export const productListScenarios: ReadonlyArray<{
  id: ProductListState;
  label: string;
  products: ProductSummary[];
}> = [
  { id: 'loading', label: 'Initial loading', products: [] },
  { id: 'filtered-loading', label: 'Filtered results loading', products: populatedProducts },
  { id: 'empty', label: 'Catalog empty', products: [] },
  { id: 'populated', label: 'Populated', products: populatedProducts },
  { id: 'row-opening', label: 'Product row opening', products: populatedProducts },
  { id: 'template-error', label: 'Template download error', products: populatedProducts },
  { id: 'error', label: 'Request error', products: [] },
];

const baseProduct: ProductEditorFixture = {
  name: 'Focus Workspace Template Pack',
  status: 'Draft',
  basePrice: '36.00',
  currency: 'USD',
  publicDescription: 'A practical set of desktop workspace templates for focused independent work.',
  delivery: {
    accessTitle: 'Download the Focus Workspace Template Pack',
    accessInstructions: 'Open the ZIP from your order and read START-HERE.pdf before importing a template.',
    file: {
      name: 'focus-workspace-template-pack-2026-08.zip',
      sizeLabel: '18.4 MB',
      kind: 'ZIP',
    },
  },
  groups: [
    { id: 'theme', name: 'Theme', values: ['Dark', 'Light'], participating: true },
    { id: 'license', name: 'License', values: ['Personal', 'Team'], participating: true },
  ],
  variants: [
    {
      id: 'dark-personal',
      combination: 'Dark / Personal',
      sku: 'FOCUS-DARK-PERSONAL',
      priceOverride: '',
      effectivePrice: '$36.00',
      priceSource: 'Base price',
      deliverySource: 'Product default',
      enabled: true,
    },
    {
      id: 'dark-team',
      combination: 'Dark / Team',
      sku: 'FOCUS-DARK-TEAM',
      priceOverride: '48.00',
      effectivePrice: '$48.00',
      priceSource: 'Override',
      deliverySource: 'Variant override',
      enabled: true,
      deliveryOverride: {
        accessTitle: 'Download the Team workspace pack',
        accessInstructions: 'Open the Team ZIP from your order and share it only with licensed team members.',
        file: { name: 'focus-team-workspace-pack.zip', sizeLabel: '9.2 MB', kind: 'ZIP' },
      },
    },
    {
      id: 'light-personal',
      combination: 'Light / Personal',
      sku: 'FOCUS-LIGHT-PERSONAL',
      priceOverride: '',
      effectivePrice: '$36.00',
      priceSource: 'Base price',
      deliverySource: 'Product default',
      enabled: false,
    },
    {
      id: 'light-team',
      combination: 'Light / Team',
      sku: 'FOCUS-LIGHT-TEAM',
      priceOverride: '48.00',
      effectivePrice: '$48.00',
      priceSource: 'Override',
      deliverySource: 'Product default',
      enabled: true,
    },
  ],
};

const emptyProduct: ProductEditorFixture = {
  name: '',
  status: 'Draft',
  basePrice: '',
  currency: 'USD',
  publicDescription: '',
  delivery: { accessTitle: '', accessInstructions: '' },
  groups: [],
  variants: [],
};

export const productEditorFixturesById: Readonly<Record<string, ProductEditorFixture>> = {
  'focus-pack': baseProduct,
  'field-notes': {
    name: 'Field Notes for Independent Product Teams',
    status: 'Active',
    basePrice: '24.00',
    currency: 'USD',
    publicDescription: 'A concise guide for product teams working with limited time and clear priorities.',
    delivery: {
      accessTitle: 'Download Field Notes',
      accessInstructions: 'Open the PDF from your order and save a private working copy.',
      file: { name: 'field-notes-independent-product-teams.pdf', sizeLabel: '3.6 MB', kind: 'PDF' },
    },
    groups: [],
    variants: [],
  },
  'launch-library': {
    name: 'Launch Systems Library',
    status: 'Archived',
    basePrice: '58.00',
    currency: 'USD',
    publicDescription: 'Reusable launch checklists and planning systems for small product teams.',
    delivery: {
      accessTitle: 'Download the Launch Systems Library',
      accessInstructions: 'Open the ZIP from your order and begin with the library index.',
      file: { name: 'launch-systems-library.zip', sizeLabel: '21.7 MB', kind: 'ZIP' },
    },
    groups: [
      { id: 'format', name: 'Format', values: ['Notion', 'PDF'], participating: true },
      { id: 'license-launch', name: 'License', values: ['Solo', 'Team'], participating: true },
    ],
    variants: [
      { id: 'launch-notion-solo', combination: 'Notion / Solo', sku: 'LAUNCH-NOTION-SOLO', priceOverride: '', effectivePrice: '$58.00', priceSource: 'Base price', deliverySource: 'Product default', enabled: true },
      { id: 'launch-notion-team', combination: 'Notion / Team', sku: 'LAUNCH-NOTION-TEAM', priceOverride: '78.00', effectivePrice: '$78.00', priceSource: 'Override', deliverySource: 'Product default', enabled: true },
      { id: 'launch-pdf-solo', combination: 'PDF / Solo', sku: 'LAUNCH-PDF-SOLO', priceOverride: '', effectivePrice: '$58.00', priceSource: 'Base price', deliverySource: 'Product default', enabled: true },
      { id: 'launch-pdf-team', combination: 'PDF / Team', sku: 'LAUNCH-PDF-TEAM', priceOverride: '78.00', effectivePrice: '$78.00', priceSource: 'Override', deliverySource: 'Product default', enabled: false },
    ],
  },
};

export const productEditorScenarios: ReadonlyArray<ProductEditorScenario> = [
  { id: 'new', label: 'Create Product', lifecycle: 'create', product: emptyProduct },
  { id: 'edit-ready', label: 'Edit ready', lifecycle: 'ready', product: baseProduct },
  {
    id: 'edit-dirty',
    label: 'Edit with unsaved changes',
    lifecycle: 'dirty',
    product: { ...baseProduct, publicDescription: `${baseProduct.publicDescription} Includes updated planning sheets.` },
  },
  { id: 'edit-loading', label: 'Edit loading', lifecycle: 'loading', product: emptyProduct },
  { id: 'edit-error', label: 'Edit load error', lifecycle: 'error', product: emptyProduct },
  {
    id: 'edit-save-error',
    label: 'Recoverable save error',
    lifecycle: 'save-error',
    product: { ...baseProduct, publicDescription: `${baseProduct.publicDescription} Unsaved copy remains in the editor.` },
  },
];

export const combinationBoundaryScenarios = [
  { id: 'live', label: 'Live Cartesian count', count: null },
  { id: 'ten', label: 'Exact boundary: 10', count: 10 },
  { id: 'eleven', label: 'Exact warning: 11', count: 11 },
  { id: 'thirty', label: 'Exact maximum: 30', count: 30 },
  { id: 'thirty-one', label: 'Exact blocked: 31', count: 31 },
] as const;


export const csvScenarios: ReadonlyArray<CsvScenario> = [
  { id: 'template-loading', label: 'Template download loading', state: 'default', groups: [], templateState: 'loading' },
  { id: 'template-success', label: 'Template download success', state: 'default', groups: [], templateState: 'success' },
  { id: 'template-error', label: 'Template download error', state: 'default', groups: [], templateState: 'error' },
  { id: 'default', label: 'Choose a file', state: 'default', groups: [] },
  {
    id: 'simple',
    label: 'Simple Product preview',
    state: 'simple',
    file: { name: 'field-notes-simple.csv', sizeLabel: '1.8 KB', rows: 1 },
    groups: [{ id: 'field-notes', slug: 'field-notes', type: 'Simple', rows: 'Row 2', combinations: 0, previewOutcome: 'Ready' }],
    previewRows: [{ rowNumber: 2, slug: 'field-notes', outcome: 'Ready', reason: 'Row passed browser checks as a Simple Product row.' }],
  },
  {
    id: 'variant',
    label: 'Variant Product preview',
    state: 'variant',
    file: { name: 'focus-pack-variants.csv', sizeLabel: '4.6 KB', rows: 4 },
    groups: [{ id: 'focus-pack', slug: 'focus-pack', type: 'Variant', rows: 'Rows 2 to 5', combinations: 4, previewOutcome: 'Ready' }],
    previewRows: [
      { rowNumber: 2, slug: 'focus-pack', sku: 'FOCUS-DARK-PERSONAL', outcome: 'Ready', reason: 'Row passed browser checks as a Variant Product row.' },
      { rowNumber: 3, slug: 'focus-pack', sku: 'FOCUS-DARK-TEAM', outcome: 'Ready', reason: 'Row passed browser checks as a Variant Product row.' },
      { rowNumber: 4, slug: 'focus-pack', sku: 'FOCUS-LIGHT-PERSONAL', outcome: 'Ready', reason: 'Row passed browser checks as a Variant Product row.' },
      { rowNumber: 5, slug: 'focus-pack', sku: 'FOCUS-LIGHT-TEAM', outcome: 'Ready', reason: 'Row passed browser checks as a Variant Product row.' },
    ],
  },
  {
    id: 'warning-eleven',
    label: '11-combination confirmation',
    state: 'warning',
    file: { name: 'focus-workspace-eleven-boundary.csv', sizeLabel: '11.4 KB', rows: 11 },
    warningCount: 11,
    groups: [{ id: 'focus-eleven', slug: 'focus-eleven', type: 'Variant', rows: 'Rows 2 to 12', combinations: 11, previewOutcome: 'Ready' }],
  },
  {
    id: 'warning-thirty',
    label: '30-combination confirmation',
    state: 'warning',
    file: { name: 'focus-workspace-complete-license-matrix.csv', sizeLabel: '28.6 KB', rows: 30 },
    warningCount: 30,
    groups: [{ id: 'focus-workspace', slug: 'focus-workspace', type: 'Variant', rows: 'Rows 2 to 31', combinations: 30, previewOutcome: 'Ready' }],
  },
  {
    id: 'blocked',
    label: '31-combination blocked',
    state: 'blocked',
    file: { name: 'focus-workspace-over-limit.csv', sizeLabel: '29.2 KB', rows: 31 },
    groups: [{ id: 'focus-workspace', slug: 'focus-workspace', type: 'Variant', rows: 'Rows 2 to 32', combinations: 31, previewOutcome: 'Rejected', reason: '31 combinations exceeds the maximum of 30. Remove a value or participating group.' }],
  },
  {
    id: 'errors',
    label: 'Grouped browser errors',
    state: 'errors',
    file: { name: 'catalog-with-conflicting-product-fields-and-incomplete-options.csv', sizeLabel: '9.7 KB', rows: 7 },
    groups: [
      { id: 'mixed', slug: 'field-notes', type: 'Variant', rows: 'Rows 2 and 3', combinations: 0, previewOutcome: 'Rejected', reason: 'Rows mix a simple Product with Variant data for the same product_slug.' },
      { id: 'pair', slug: 'focus-pack', type: 'Variant', rows: 'Row 6', combinations: 0, previewOutcome: 'Rejected', reason: 'option_2_name is present but option_2_value is missing for SKU FOCUS-LIGHT-TEAM.' },
      { id: 'sparse', slug: 'launch-library', type: 'Variant', rows: 'Rows 7 to 8', combinations: 4, previewOutcome: 'Rejected', reason: 'The supplied rows cover 2 of 4 derived combinations. Add every combination exactly once.' },
    ],
    previewRows: [
      { rowNumber: 2, slug: 'field-notes', outcome: 'Rejected', reason: 'Rows 2 and 3 mix simple and Variant rows for the same product_slug.' },
      { rowNumber: 3, slug: 'field-notes', sku: 'FIELD-NOTES-VARIANT', outcome: 'Rejected', reason: 'Rows 2 and 3 mix simple and Variant rows for the same product_slug.' },
      { rowNumber: 6, slug: 'focus-pack', sku: 'FOCUS-LIGHT-TEAM', outcome: 'Rejected', reason: 'option_2_name is present but option_2_value is missing.' },
      { rowNumber: 7, slug: 'launch-library', sku: 'LAUNCH-DARK', outcome: 'Rejected', reason: 'The supplied rows cover 2 of 4 derived combinations.' },
      { rowNumber: 8, slug: 'launch-library', sku: 'LAUNCH-LIGHT', outcome: 'Rejected', reason: 'The supplied rows cover 2 of 4 derived combinations.' },
    ],
  },
  {
    id: 'result',
    label: 'Durable server result fixture',
    state: 'result',
    file: { name: 'catalog-import-reviewed.csv', sizeLabel: '12.2 KB', rows: 4 },
    groups: [],
    resultRows: [
      { row: 'Row 2', slug: 'field-notes', outcome: 'Added', reason: 'New simple Product added.' },
      { row: 'Row 3', slug: 'focus-pack', sku: 'FOCUS-DARK-PERSONAL', outcome: 'Duplicate', reason: 'Exact Product and Variant already exist. Nothing was overwritten.' },
      { row: 'Rows 4 to 5', slug: 'launch-library', sku: 'LAUNCH-TEAM', outcome: 'Rejected', reason: 'Rejected: identity conflict. SKU LAUNCH-TEAM belongs to a different combination.' },
    ],
  },
  {
    id: 'uploading',
    label: 'Uploading progress',
    state: 'uploading',
    file: { name: 'focus-pack-variants.csv', sizeLabel: '4.6 KB', rows: 4 },
    groups: [{ id: 'focus-pack-upload', slug: 'focus-pack', type: 'Variant', rows: 'Rows 2 to 5', combinations: 4, previewOutcome: 'Ready' }],
  },
  {
    id: 'checking',
    label: 'Server checking progress',
    state: 'checking',
    file: { name: 'focus-pack-variants.csv', sizeLabel: '4.6 KB', rows: 4 },
    groups: [{ id: 'focus-pack-check', slug: 'focus-pack', type: 'Variant', rows: 'Rows 2 to 5', combinations: 4, previewOutcome: 'Ready' }],
  },
  {
    id: 'file-failure',
    label: 'File-level failure',
    state: 'file-failure',
    file: { name: 'catalog-import.csv', sizeLabel: '8.1 KB', rows: 6 },
    groups: [],
    fileError: 'The selected CSV could not be uploaded. No committed counts are available. Retry or choose another file.',
  },
  {
    id: 'server-validation-failure',
    label: 'Server validation failure',
    state: 'server-validation-failure',
    file: { name: 'catalog-import.csv', sizeLabel: '8.1 KB', rows: 6 },
    groups: [],
    fileError: 'Server validation rejected the whole file. No Products or Variants were added.',
  },
  {
    id: 'success',
    label: 'Complete success result',
    state: 'success',
    file: { name: 'new-catalog.csv', sizeLabel: '5.2 KB', rows: 3 },
    groups: [],
    resultRows: [
      { row: 'Row 2', slug: 'field-notes', outcome: 'Added', reason: 'New simple Product added.' },
      { row: 'Rows 3 to 4', slug: 'focus-pack', sku: 'FOCUS-DARK-PERSONAL', outcome: 'Added', reason: 'New Variant rows added.' },
    ],
  },
  {
    id: 'all-duplicate',
    label: 'All duplicate result',
    state: 'all-duplicate',
    file: { name: 'existing-catalog.csv', sizeLabel: '5.2 KB', rows: 3 },
    groups: [],
    resultRows: [
      { row: 'Row 2', slug: 'field-notes', outcome: 'Duplicate', reason: 'Exact Product already exists. Nothing was overwritten.' },
      { row: 'Rows 3 to 4', slug: 'focus-pack', sku: 'FOCUS-DARK-PERSONAL', outcome: 'Duplicate', reason: 'Exact Variant rows already exist. Nothing was overwritten.' },
    ],
  },
  {
    id: 'all-rejected',
    label: 'All rejected result',
    state: 'all-rejected',
    file: { name: 'rejected-catalog.csv', sizeLabel: '5.2 KB', rows: 3 },
    groups: [],
    resultRows: [
      { row: 'Row 2', slug: 'field-notes', outcome: 'Rejected', reason: 'Product-level currency conflicts with the existing exact-match Product.' },
      { row: 'Rows 3 to 4', slug: 'focus-pack', sku: 'FOCUS-DARK-PERSONAL', outcome: 'Rejected', reason: 'Rejected: identity conflict. The SKU belongs to another combination.' },
    ],
  },
  {
    id: 'result-error',
    label: 'Result presentation error',
    state: 'result-error',
    file: { name: 'catalog-import.csv', sizeLabel: '8.1 KB', rows: 6 },
    groups: [],
    fileError: 'The durable import result could not be displayed. Counts are unavailable. Start another import or retry this result.',
  },
];
