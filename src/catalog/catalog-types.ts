import type { ProductStatus, VariantStatus } from '../shared/catalog-status';
import type { DraftRef, SchemaDraft } from '../shared/schema-draft-refs';

export type { DraftRef, ProductStatus, SchemaDraft, VariantStatus };
export type FileKind = 'pdf' | 'zip';
export type ProductType = 'simple' | 'variant';

export type PrivateFileSummary =
  | { present: false }
  | { present: true; filename: string; sizeBytes: number; kind: FileKind };

export interface ProductCoreFields {
  name: string;
  basePrice: string;
  currency: string;
  status: ProductStatus;
  publicDescription: string;
  delivery: { accessTitle: string; accessInstructions: string };
}

export interface LabelOnlySchemaEdits {
  groups: Array<{
    id: string;
    name: string;
    values: Array<{ id: string; label: string }>;
  }>;
}

export interface VariantEdit {
  id: string;
  sku: string;
  status: VariantStatus;
  priceOverride: string | null;
  delivery:
    | { source: 'product_default' }
    | { source: 'variant_override'; accessTitle: string; accessInstructions: string };
}

export interface ProductListItem {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  type: ProductType;
  currency: string;
  minimumEffectivePriceMinor: number;
  maximumEffectivePriceMinor: number;
  enabledVariantCount: number | null;
  updatedAt: string;
  revision: number;
}

export interface ProductListResponse {
  products: ProductListItem[];
}

export interface ProductDetailResponse {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  type: ProductType;
  currency: string;
  basePriceMinor: number;
  publicDescription: string;
  delivery: {
    accessTitle: string;
    accessInstructions: string;
    file: PrivateFileSummary;
  };
  optionGroups: Array<{
    id: string;
    name: string;
    position: number;
    participating: boolean;
    values: Array<{ id: string; label: string; position: number }>;
  }>;
  variants: Array<{
    id: string;
    combinationKey: string;
    selectedOptions: Array<{
      groupId: string;
      groupName: string;
      valueId: string;
      valueLabel: string;
    }>;
    sku: string;
    status: VariantStatus;
    priceOverrideMinor: number | null;
    effectivePriceMinor: number;
    priceSource: 'base_price' | 'override';
    delivery: {
      source: 'product_default' | 'variant_override';
      accessTitle: string;
      accessInstructions: string;
      file: PrivateFileSummary;
    };
  }>;
  updatedAt: string;
  revision: number;
}

export interface ProductMutationResponse {
  product: ProductDetailResponse;
}

export interface SchemaPreviewResponse {
  previewHash: string;
  combinationCount: number;
  confirmationRequired: boolean;
  blocked: boolean;
  rows: Array<{
    outcome: 'retained' | 'new' | 'will_disable';
    variantId: string | null;
    selectedValueRefs: DraftRef[];
    sku: string;
    skuSuggested: boolean;
  }>;
}

export interface CreateProductRequest {
  product: ProductCoreFields;
  schema: SchemaDraft | null;
  previewHash: string | null;
}

export interface PreviewSchemaRequest {
  productId: string | null;
  productSlug: string;
  product: ProductCoreFields;
  schema: SchemaDraft;
}

export interface ApplySchemaRequest {
  product: ProductCoreFields;
  schema: SchemaDraft;
  previewHash: string;
}

export interface NonstructuralProductUpdateRequest {
  product: ProductCoreFields;
  optionLabels: LabelOnlySchemaEdits;
  variantEdits: VariantEdit[];
}

export interface PublicCatalogResponse {
  store: { id: string; slug: string; name: string };
  products: Array<{
    id: string;
    slug: string;
    name: string;
    currency: string;
    basePriceMinor: number;
    minimumEffectivePriceMinor: number;
    maximumEffectivePriceMinor: number;
    publicDescription: string;
    optionGroups: Array<{
      id: string;
      name: string;
      position: number;
      values: Array<{ id: string; label: string; position: number }>;
    }>;
    variants: Array<{
      id: string;
      sku: string;
      status: 'enabled';
      selectedOptions: Array<{ groupId: string; valueId: string }>;
      effectivePriceMinor: number;
    }>;
  }>;
}

export interface OrderItemCatalogSnapshot {
  productId: string;
  productName: string;
  variantId: string | null;
  variantSku: string | null;
  selectedOptions: Array<{
    groupId: string;
    groupName: string;
    valueId: string;
    valueLabel: string;
  }>;
  unitPriceMinor: number;
  currency: string;
  accessTitle: string;
  accessInstructions: string;
  privateFileKey: string | null;
}

export interface OrderItemCatalogResolution {
  productRevision: number;
  snapshot: OrderItemCatalogSnapshot;
}

export interface CatalogFieldError {
  path: string;
  code: string;
  message: string;
}

export class CatalogValidationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: CatalogFieldError[];

  constructor(code: string, message: string, fields: CatalogFieldError[] = [], status = 422) {
    super(message);
    this.name = 'CatalogValidationError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}
