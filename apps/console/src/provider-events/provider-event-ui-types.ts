export type ProviderEventType = 'payment' | 'logistics';
export type ProviderEventOrderStatus = 'pending' | 'paid' | 'fulfilled' | 'canceled';

export interface ConsoleProviderEventView {
  id: string;
  type: ProviderEventType;
  provider: string;
  providerEventId: string;
  payloadJson: string;
  receivedAt: string;
  order: { reference: string; status: ProviderEventOrderStatus } | null;
}

export interface ConsoleProviderEventListQuery {
  limit: number;
  cursor: string | null;
}

export interface ConsoleProviderEventListResponse {
  events: ConsoleProviderEventView[];
  nextCursor: string | null;
  hasEvents: boolean;
}

export type ProviderEventsState = 'loading' | 'ready' | 'empty' | 'no-results' | 'error';
