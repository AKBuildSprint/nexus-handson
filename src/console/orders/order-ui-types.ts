export interface ConsoleOrderView {
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
  customer: { name: string; email: string };
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: string;
}

export interface ConsoleOrderListResponse {
  orders: ConsoleOrderView[];
}

export type ConsoleOrdersState = 'loading' | 'ready' | 'empty' | 'error';
