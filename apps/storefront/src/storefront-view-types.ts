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

export type CustomerOrderStatus = 'pending' | 'paid' | 'fulfilled' | 'canceled';

export interface CustomerOrderItemView {
  id: string;
  position: number;
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
  lineTotalMinor: number;
  currency: string;
}

export interface CustomerOrderView {
  reference: string;
  paymentReference: string;
  status: CustomerOrderStatus;
  items: CustomerOrderItemView[];
  totalMinor: number;
  currency: string;
  createdAt: string;
  paymentNextStep: string | null;
  refundRequest: {
    id: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: string;
    createdAt: string;
    decidedAt: string | null;
  } | null;
}

export interface OrderCommandResultView {
  reference: string;
  action: 'request_refund';
  status: CustomerOrderStatus;
  occurredAt: string;
  refundRequest: CustomerOrderView['refundRequest'];
}

export interface CreateStorefrontOrderItemInput {
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface CreateStorefrontOrderInput {
  customer: { name: string; email: string };
  items: CreateStorefrontOrderItemInput[];
}

export interface OrderAttemptIdentity {
  capability: string;
  idempotencyKey: string;
}

export interface FrozenCreateAttempt {
  identity: OrderAttemptIdentity;
  input: CreateStorefrontOrderInput;
}
