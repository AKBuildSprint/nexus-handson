import type {
  ApplySchemaRequest,
  CreateProductRequest,
  NonstructuralProductUpdateRequest,
  ProductDetailResponse,
  ProductListResponse,
  ProductMutationResponse,
  ProductStatus,
  SchemaPreviewResponse,
} from '../catalog/catalog-types';
import {
  CSV_CONFIRMATION_HEADER,
  CSV_CONTENT_TYPE,
  CSV_FILENAME,
  CSV_FILENAME_HEADER,
  isImportResultResponse,
  type ImportResultResponse,
} from '../shared/csv-contract';

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

async function decode<T>(response: Response): Promise<T> {
  const body = await response.json() as T | ErrorEnvelope;
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

export async function fetchProductBySlug(slug: string): Promise<{ product: ProductDetailResponse; revision: number }> {
  const response = await fetch(`/api/console/products/by-slug/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
  const product = await decode<ProductDetailResponse>(response);
  return { product, revision: product.revision };
}

export async function createProduct(request: CreateProductRequest): Promise<{ product: ProductDetailResponse; revision: number }> {
  const response = await fetch('/api/console/products', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(request) });
  const result = await decode<ProductMutationResponse>(response);
  return { product: result.product, revision: result.product.revision };
}

export async function updateProduct(
  productId: string,
  revision: number,
  request: NonstructuralProductUpdateRequest,
): Promise<{ product: ProductDetailResponse; revision: number }> {
  const response = await fetch(`/api/console/products/${encodeURIComponent(productId)}`, {
    method: 'PUT', headers: jsonHeaders(revision), body: JSON.stringify(request),
  });
  const result = await decode<ProductMutationResponse>(response);
  return { product: result.product, revision: result.product.revision };
}

export async function previewProductSchema(
  revision: number | null,
  request: { productId: string | null; productSlug: string; product: CreateProductRequest['product']; schema: NonNullable<CreateProductRequest['schema']> },
): Promise<SchemaPreviewResponse> {
  const response = await fetch('/api/console/products/schema/preview', {
    method: 'POST', headers: jsonHeaders(revision ?? undefined), body: JSON.stringify(request),
  });
  return decode(response);
}

export async function applyProductSchema(
  productId: string,
  revision: number,
  request: ApplySchemaRequest,
): Promise<{ product: ProductDetailResponse; revision: number }> {
  const response = await fetch(`/api/console/products/${encodeURIComponent(productId)}/schema`, {
    method: 'PUT', headers: jsonHeaders(revision), body: JSON.stringify(request),
  });
  const result = await decode<ProductMutationResponse>(response);
  return { product: result.product, revision: result.product.revision };
}

export async function replaceDeliveryFile(input: {
  productId: string;
  variantId: string | null;
  revision: number;
  file: File;
}): Promise<number> {
  const suffix = input.variantId === null ? '' : `/variants/${encodeURIComponent(input.variantId)}`;
  const response = await fetch(`/api/console/products/${encodeURIComponent(input.productId)}${suffix}/delivery-file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'If-Match': `"${input.revision}"`,
      'X-Nexus-Filename': encodeURIComponent(input.file.name),
    },
    body: input.file,
  });
  const result = await decode<{ revision: number }>(response);
  return result.revision;
}

export async function removeDeliveryFile(input: {
  productId: string;
  variantId: string | null;
  revision: number;
}): Promise<number> {
  const suffix = input.variantId === null ? '' : `/variants/${encodeURIComponent(input.variantId)}`;
  const response = await fetch(`/api/console/products/${encodeURIComponent(input.productId)}${suffix}/delivery-file`, {
    method: 'DELETE', headers: { 'If-Match': `"${input.revision}"` },
  });
  const result = await decode<{ revision: number }>(response);
  return result.revision;
}

export async function downloadCsvTemplate(): Promise<void> {
  const response = await fetch('/api/console/imports/template', { headers: { Accept: CSV_CONTENT_TYPE } });
  if (!response.ok) await decode<never>(response);
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
