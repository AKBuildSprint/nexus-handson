export interface StorefrontCatalog {
  store: { id: string; slug: string; name: string };
  products: StorefrontProduct[];
}

export interface StorefrontProduct {
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
}

export interface CustomerOrderView {
  reference: string;
  status: 'pending_payment';
  product: {
    id: string;
    name: string;
    variant: null | {
      id: string;
      sku: string;
      selectedOptions: Array<{
        groupId: string;
        groupName: string;
        valueId: string;
        valueLabel: string;
      }>;
    };
  };
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: string;
  paymentNextStep: string;
}

export interface CreateStorefrontOrderInput {
  customer: { name: string; email: string };
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface OrderAttemptIdentity {
  capability: string;
  idempotencyKey: string;
}
