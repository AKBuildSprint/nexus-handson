export type ProductStatus = 'Draft' | 'Active' | 'Archived';
export type ProductType = 'Simple' | 'Variant';
export type ProductListState = 'loading' | 'filtered-loading' | 'empty' | 'populated' | 'error' | 'row-opening' | 'template-error';
export type EditorLifecycle = 'create' | 'loading' | 'ready' | 'saved' | 'dirty' | 'error' | 'save-error';

export interface ProductSummary {
  id: string;
  slug?: string;
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
  file?: { name: string; sizeLabel: string; kind: 'PDF' | 'ZIP' };
}

export interface OptionGroupFixture {
  id: string;
  name: string;
  values: string[];
  valueIds?: Array<string | null>;
  valueRefs?: string[];
  participating: boolean;
}

export interface VariantFixture {
  id: string;
  combination: string;
  selectedValueRefs?: string[];
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
