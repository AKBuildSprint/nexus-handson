import type {
  ApplySchemaRequest,
  CreateProductRequest,
  NonstructuralProductUpdateRequest,
  ProductDetailResponse,
  ProductListResponse,
  ProductMutationResponse,
  ProductStatus,
  SchemaPreviewResponse,
} from '@nexus/catalog/catalog-types';
import {
  CSV_CONFIRMATION_HEADER,
  CSV_CONTENT_TYPE,
  CSV_FILENAME,
  CSV_FILENAME_HEADER,
  isImportResultResponse,
  type ImportResultResponse,
} from '@nexus/catalog/shared/csv-contract';
import type {
  ConsoleOrderDetailView,
  ConsoleOrderListQuery,
  ConsoleOrderListResponse,
  OrderCommandResultView,
  OrderAssignmentCommandResultView,
  StaffCandidateView,
} from './orders/order-ui-types';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields: Array<{ path: string; code: string; message: string }>;
    incidentId: string | null;
  };
}

export class ConsoleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: ErrorEnvelope['error']['fields'],
    readonly incidentId: string | null,
  ) {
    super(message);
    this.name = 'ConsoleApiError';
  }
}

export class ConsoleImportResultError extends Error {
  constructor(
    readonly rawBody: string,
    readonly retainedBody: unknown,
  ) {
    super('The authoritative import response could not be displayed.');
    this.name = 'ConsoleImportResultError';
  }
}

function abortError(signal?: AbortSignal): DOMException {
  return signal?.reason instanceof DOMException
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

async function readJson<T>(response: Response, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw abortError(signal);
  if (!signal) return response.json() as Promise<T>;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void response.json().then(
      (body) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(abortError(signal));
        else resolve(body as T);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function decode<T>(response: Response, signal?: AbortSignal): Promise<T> {
  const body = await readJson<T | ErrorEnvelope>(response, signal);
  if (signal?.aborted) throw abortError(signal);
  if (!response.ok) {
    const envelope = body as ErrorEnvelope;
    throw new ConsoleApiError(response.status, envelope.error.code, envelope.error.message, envelope.error.fields, envelope.error.incidentId);
  }
  return body as T;
}

function jsonHeaders(revision?: number): HeadersInit {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    ...(revision === undefined ? {} : { 'If-Match': `"${revision}"` }),
  };
}

export async function fetchProducts(
  query = '',
  status: 'all' | ProductStatus = 'all',
  signal?: AbortSignal,
): Promise<ProductListResponse> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (status !== 'all') params.set('status', status);
  const suffix = params.size > 0 ? `?${params}` : '';
  return decode(await fetch(`/api/console/products${suffix}`, { headers: { Accept: 'application/json' }, signal }));
}

const ORDER_CONTRACT_HEADER = { 'X-Nexus-Order-Contract': '2' };

function orderReadHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    ...ORDER_CONTRACT_HEADER,
  };
}

function orderJsonHeaders(idempotencyKey?: string): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    ...ORDER_CONTRACT_HEADER,
    ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseAssignmentResult(value: unknown): OrderAssignmentCommandResultView {
  const result = record(value);
  const assignment = record(result?.assignment);
  if (
    result?.action !== 'assign'
    || typeof result.reference !== 'string'
    || !['pending', 'paid', 'fulfilled', 'canceled'].includes(String(result.status))
    || typeof result.occurredAt !== 'string'
    || result.paymentId !== null
    || result.refundRequest !== null
    || typeof assignment?.assigneeUserId !== 'string'
    || typeof assignment.eventId !== 'string'
  ) throw new Error('The assignment response is invalid.');
  return result as unknown as OrderAssignmentCommandResultView;
}

export async function fetchOrders(query: ConsoleOrderListQuery, signal?: AbortSignal): Promise<ConsoleOrderListResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.refund) params.set('refund', query.refund);
  params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const response = await fetch(`/api/console/orders?${params}`, { headers: orderReadHeaders(), signal });
  return decode(response, signal);
}

export async function fetchOrder(reference: string, signal?: AbortSignal): Promise<{ order: ConsoleOrderDetailView }> {
  const response = await fetch(`/api/console/orders/${encodeURIComponent(reference)}`, {
    headers: orderReadHeaders(),
    signal,
  });
  return decode(response, signal);
}

export async function markPaid(
  reference: string,
  payment: { method: string; reference: string },
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OrderCommandResultView> {
  const response = await fetch(`/api/console/orders/${encodeURIComponent(reference)}/payments/manual`, {
    method: 'POST',
    headers: orderJsonHeaders(idempotencyKey),
    body: JSON.stringify({ method: payment.method, reference: payment.reference }),
    signal,
  });
  return decode(response, signal);
}

export async function fulfill(
  reference: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OrderCommandResultView> {
  const response = await fetch(`/api/console/orders/${encodeURIComponent(reference)}/fulfill`, {
    method: 'POST',
    headers: orderJsonHeaders(idempotencyKey),
    body: JSON.stringify({}),
    signal,
  });
  return decode(response, signal);
}

export async function cancelConsoleOrder(
  reference: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OrderCommandResultView> {
  const response = await fetch(`/api/console/orders/${encodeURIComponent(reference)}/cancel`, {
    method: 'POST',
    headers: orderJsonHeaders(idempotencyKey),
    body: JSON.stringify({}),
    signal,
  });
  return decode(response, signal);
}

export async function createConsoleRefundRequest(
  reference: string,
  reason: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OrderCommandResultView> {
  const response = await fetch(`/api/console/orders/${encodeURIComponent(reference)}/refund-requests`, {
    method: 'POST',
    headers: orderJsonHeaders(idempotencyKey),
    body: JSON.stringify({ reason }),
    signal,
  });
  return decode(response, signal);
}

export async function decideConsoleRefundRequest(
  reference: string,
  requestId: string,
  decision: 'approve' | 'reject',
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OrderCommandResultView> {
  const response = await fetch(
    `/api/console/orders/${encodeURIComponent(reference)}/refund-requests/${encodeURIComponent(requestId)}/${decision}`,
    {
      method: 'POST',
      headers: orderJsonHeaders(idempotencyKey),
      body: JSON.stringify({}),
      signal,
    },
  );
  return decode(response, signal);
}

export async function fetchStaffCandidates(signal?: AbortSignal): Promise<{ staff: StaffCandidateView[] }> {
  const response = await fetch('/api/console/staff', { headers: orderReadHeaders(), signal });
  return decode(response, signal);
}

export async function assignConsoleOrder(
  reference: string,
  assigneeUserId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OrderAssignmentCommandResultView> {
  const response = await fetch(`/api/console/orders/${encodeURIComponent(reference)}/assignment`, {
    method: 'POST',
    headers: orderJsonHeaders(idempotencyKey),
    body: JSON.stringify({ assigneeUserId }),
    signal,
  });
  return parseAssignmentResult(await decode<unknown>(response, signal));
}

export async function fetchProductBySlug(slug: string, signal?: AbortSignal): Promise<{ product: ProductDetailResponse; revision: number }> {
  const response = await fetch(`/api/console/products/by-slug/${encodeURIComponent(slug)}`, {
    headers: { Accept: 'application/json' }, signal,
  });
  const product = await decode<ProductDetailResponse>(response, signal);
  return { product, revision: product.revision };
}

export async function createProduct(request: CreateProductRequest, signal?: AbortSignal): Promise<{ product: ProductDetailResponse; revision: number }> {
  const response = await fetch('/api/console/products', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(request), signal });
  const result = await decode<ProductMutationResponse>(response, signal);
  return { product: result.product, revision: result.product.revision };
}

export async function updateProduct(
  productId: string,
  revision: number,
  request: NonstructuralProductUpdateRequest,
  signal?: AbortSignal,
): Promise<{ product: ProductDetailResponse; revision: number }> {
  const response = await fetch(`/api/console/products/${encodeURIComponent(productId)}`, {
    method: 'PUT', headers: jsonHeaders(revision), body: JSON.stringify(request), signal,
  });
  const result = await decode<ProductMutationResponse>(response, signal);
  return { product: result.product, revision: result.product.revision };
}

export async function previewProductSchema(
  revision: number | null,
  request: { productId: string | null; productSlug: string; product: CreateProductRequest['product']; schema: NonNullable<CreateProductRequest['schema']> },
  signal?: AbortSignal,
): Promise<SchemaPreviewResponse> {
  const response = await fetch('/api/console/products/schema/preview', {
    method: 'POST', headers: jsonHeaders(revision ?? undefined), body: JSON.stringify(request), signal,
  });
  return decode(response, signal);
}

export async function applyProductSchema(
  productId: string,
  revision: number,
  request: ApplySchemaRequest,
  signal?: AbortSignal,
): Promise<{ product: ProductDetailResponse; revision: number }> {
  const response = await fetch(`/api/console/products/${encodeURIComponent(productId)}/schema`, {
    method: 'PUT', headers: jsonHeaders(revision), body: JSON.stringify(request), signal,
  });
  const result = await decode<ProductMutationResponse>(response, signal);
  return { product: result.product, revision: result.product.revision };
}

export async function replaceDeliveryFile(input: {
  productId: string;
  variantId: string | null;
  revision: number;
  file: File;
}, signal?: AbortSignal): Promise<number> {
  const suffix = input.variantId === null ? '' : `/variants/${encodeURIComponent(input.variantId)}`;
  const response = await fetch(`/api/console/products/${encodeURIComponent(input.productId)}${suffix}/delivery-file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'If-Match': `"${input.revision}"`,
      'X-Nexus-Filename': encodeURIComponent(input.file.name),
    },
    body: input.file,
    signal,
  });
  const result = await decode<{ revision: number }>(response, signal);
  return result.revision;
}

export async function removeDeliveryFile(input: {
  productId: string;
  variantId: string | null;
  revision: number;
}, signal?: AbortSignal): Promise<number> {
  const suffix = input.variantId === null ? '' : `/variants/${encodeURIComponent(input.variantId)}`;
  const response = await fetch(`/api/console/products/${encodeURIComponent(input.productId)}${suffix}/delivery-file`, {
    method: 'DELETE', headers: { 'If-Match': `"${input.revision}"` }, signal,
  });
  const result = await decode<{ revision: number }>(response, signal);
  return result.revision;
}

export async function downloadCsvTemplate(signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/console/imports/template', { headers: { Accept: CSV_CONTENT_TYPE }, signal });
  if (!response.ok) await decode<never>(response, signal);
  if (signal?.aborted) throw abortError(signal);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = CSV_FILENAME;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importCsvProducts(file: File, confirmVariants: boolean, signal?: AbortSignal): Promise<ImportResultResponse> {
  const response = await fetch('/api/console/imports', {
    method: 'POST',
    headers: {
      'Content-Type': CSV_CONTENT_TYPE,
      [CSV_FILENAME_HEADER]: encodeURIComponent(file.name),
      ...(confirmVariants ? { [CSV_CONFIRMATION_HEADER]: 'true' } : {}),
    },
    body: file,
    signal,
  });
  if (!response.ok) return decode(response);
  const rawBody = await response.text();
  let retainedBody: unknown;
  try {
    retainedBody = JSON.parse(rawBody);
  } catch {
    throw new ConsoleImportResultError(rawBody, null);
  }
  if (!isImportResultResponse(retainedBody)) {
    throw new ConsoleImportResultError(rawBody, retainedBody);
  }
  return retainedBody;
}
