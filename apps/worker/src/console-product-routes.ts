import { PRODUCT_STATUSES } from '@nexus/catalog/shared/catalog-limits';
import { CatalogValidationError } from '@nexus/catalog/catalog-types';
import {
  listProducts,
  CatalogReadAccessError,
  readProductDetailById,
  readProductDetailBySlug,
  readProductRevision,
  readProductVariantPreviewRows,
} from '@nexus/catalog/catalog-read';
import {
  parseApplySchemaRequest,
  parseCreateProductRequest,
  parseNonstructuralRequest,
  parsePreviewSchemaRequest,
} from '@nexus/catalog/product-validation';
import { previewSchemaChange } from '@nexus/catalog/schema-change';
import {
  applyProductSchema,
  createProduct,
  updateProductNonstructural,
  validateSchemaForProduct,
} from '@nexus/catalog/catalog-write';
import { slugifyProductName } from '@nexus/catalog/slug';
import { jsonError, jsonResponse } from './http-response';
import type { ConsoleRequestContext } from './auth';
import { evaluatePermission } from '@nexus/identity/permissions';

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new CatalogValidationError('invalid_json', 'The request body is not valid JSON.', [], 400);
  }
}

function requiredRevision(request: Request): number {
  const value = request.headers.get('If-Match');
  const match = value === null ? null : /^"([1-9]\d*)"$/.exec(value);
  if (!match) throw new CatalogValidationError('revision_conflict', 'A current quoted Product revision is required.', [], 409);
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision)) throw new CatalogValidationError('revision_conflict', 'The Product revision is invalid.', [], 409);
  return revision;
}

function catalogError(error: unknown): Response {
  if (error instanceof CatalogReadAccessError) return jsonError(403, 'store_access_denied', 'Current Store access is required.');
  if (error instanceof CatalogValidationError) return jsonError(error.status, error.code, error.message, error.fields);
  const message = error instanceof Error ? error.message : '';
  if (message.includes('NOT NULL constraint failed: stores.name')) {
    return jsonError(403, 'forbidden', 'You do not have permission to perform this catalog operation.');
  }
  if (message.includes('products.store_id, products.slug')) return jsonError(409, 'slug_conflict', 'A Product with this slug already exists.');
  if (message.includes('product_variants.store_id, product_variants.sku')) return jsonError(409, 'sku_conflict', 'A Variant with this SKU already exists.');
  if (message.includes('product_variants.product_id, product_variants.combination_key')) return jsonError(409, 'combination_conflict', 'A Variant with this combination already exists.');
  if (message.includes('option_group_limit_exceeded')) return jsonError(422, 'option_group_limit_exceeded', 'A Product can have at most 5 option groups.');
  if (message.includes('option_value_limit_exceeded')) return jsonError(422, 'option_value_limit_exceeded', 'An option group can have at most 10 values.');
  if (message.includes('variant_limit_exceeded')) return jsonError(422, 'variant_limit_exceeded', 'A Product can have at most 30 combinations.');
  if (message.includes('matrix_incomplete')) return jsonError(422, 'matrix_incomplete', 'Variant memberships do not cover the active schema.');
  const incidentId = crypto.randomUUID();
  console.error('Catalog persistence failure', { incidentId, classification: 'unexpected' });
  return jsonError(500, 'persistence_failed', 'The catalog operation could not be completed.', [], incidentId);
}

function decodePathIdentity(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function isProductRoute(method: string, pathname: string): boolean {
  if (method === 'GET') {
    return pathname === '/api/console/products'
      || /^\/api\/console\/products\/by-slug\/[^/]+$/.test(pathname);
  }
  if (method === 'POST') {
    return pathname === '/api/console/products'
      || pathname === '/api/console/products/schema/preview';
  }
  return method === 'PUT' && (
    /^\/api\/console\/products\/[^/]+$/.test(pathname)
    || /^\/api\/console\/products\/[^/]+\/schema$/.test(pathname)
  );
}

export async function routeConsoleProductRequest(
  request: Request,
  db: D1Database,
  context: ConsoleRequestContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!isProductRoute(request.method, pathname)) return null;
  try {
    if (request.method === 'GET' && pathname === '/api/console/products') {
      if (!evaluatePermission(context.identity, 'catalog:read', { storeId: context.store.id })) {
        return jsonError(403, 'forbidden', 'You do not have permission to read Products.');
      }
      for (const key of url.searchParams.keys()) {
        if (key !== 'q' && key !== 'status') {
          throw new CatalogValidationError('validation_failed', 'The query is invalid.', [{ path: `/${key}`, code: 'unknown_field', message: 'This query parameter is not accepted.' }]);
        }
      }
      const status = url.searchParams.get('status') ?? 'all';
      if (status !== 'all' && !PRODUCT_STATUSES.includes(status as (typeof PRODUCT_STATUSES)[number])) {
        throw new CatalogValidationError('validation_failed', 'The status filter is invalid.', [{ path: '/status', code: 'status_invalid', message: 'Status must be all, draft, active, or archived.' }]);
      }
      return jsonResponse(await listProducts(db, context.identity, url.searchParams.get('q') ?? '', status as 'all' | (typeof PRODUCT_STATUSES)[number]));
    }

    const slugMatch = /^\/api\/console\/products\/by-slug\/([^/]+)$/.exec(pathname);
    if (request.method === 'GET' && slugMatch) {
      const slug = decodePathIdentity(slugMatch[1]);
      if (slug === null) return jsonError(404, 'product_not_found', 'Product not found.');
      const product = await readProductDetailBySlug(db, context.identity, slug);
      if (!product) return jsonError(404, 'product_not_found', 'Product not found.');
      if (!evaluatePermission(context.identity, 'catalog:read', { storeId: context.store.id })) {
        return jsonError(403, 'forbidden', 'You do not have permission to read Products.');
      }
      return jsonResponse(product, { headers: { ETag: `"${product.revision}"` } });
    }

    if (request.method === 'POST' && pathname === '/api/console/products/schema/preview') {
      if (!evaluatePermission(context.identity, 'catalog:write', { storeId: context.store.id })) {
        return jsonError(403, 'forbidden', 'You do not have permission to change Products.');
      }
      const parsed = parsePreviewSchemaRequest(await parseJson(request));
      if (parsed.productId === null) {
        if (parsed.productSlug !== slugifyProductName(parsed.product.name)) throw new CatalogValidationError('identity_conflict', 'The Product slug does not match the Product name.', [], 409);
        await validateSchemaForProduct(db, context.store.id, null, parsed.product, parsed.schema);
        return jsonResponse(await previewSchemaChange({ productSlug: parsed.productSlug, product: parsed.product, schema: parsed.schema }));
      }
      const currentRevision = await readProductRevision(db, context.identity, parsed.productId);
      if (currentRevision === null) return jsonError(404, 'product_not_found', 'Product not found.');
      const revision = requiredRevision(request);
      if (currentRevision !== revision) throw new CatalogValidationError('revision_conflict', 'The Product revision has changed.', [], 409);
      const detail = await readProductDetailById(db, context.identity, parsed.productId);
      if (!detail || detail.slug !== parsed.productSlug) throw new CatalogValidationError('identity_conflict', 'The Product ID and slug do not match.', [], 409);
      await validateSchemaForProduct(db, context.store.id, parsed.productId, parsed.product, parsed.schema);
      const existing = await readProductVariantPreviewRows(db, context.identity, parsed.productId);
      return jsonResponse(await previewSchemaChange({
        productSlug: parsed.productSlug,
        product: parsed.product,
        schema: parsed.schema,
        existingVariants: existing.map((variant) => ({ id: variant.id, combinationKey: variant.combinationKey, selectedValueIds: [], sku: variant.sku, currentSchema: variant.currentSchema === 1 })),
      }));
    }

    if (request.method === 'POST' && pathname === '/api/console/products') {
      if (!evaluatePermission(context.identity, 'catalog:write', { storeId: context.store.id })) {
        return jsonError(403, 'forbidden', 'You do not have permission to change Products.');
      }
      const detail = await createProduct(db, context.identity, parseCreateProductRequest(await parseJson(request)));
      return jsonResponse({ product: detail }, { status: 201, headers: { ETag: `"${detail.revision}"`, Location: `/console/products/${detail.slug}` } });
    }

    const schemaMatch = /^\/api\/console\/products\/([^/]+)\/schema$/.exec(pathname);
    if (request.method === 'PUT' && schemaMatch) {
      const productId = decodePathIdentity(schemaMatch[1]);
      if (productId === null) return jsonError(404, 'product_not_found', 'Product not found.');
      const currentRevision = await readProductRevision(db, context.identity, productId);
      if (currentRevision === null) return jsonError(404, 'product_not_found', 'Product not found.');
      if (!evaluatePermission(context.identity, 'catalog:write', { storeId: context.store.id })) {
        return jsonError(403, 'forbidden', 'You do not have permission to change Products.');
      }
      const revision = requiredRevision(request);
      if (currentRevision !== revision) throw new CatalogValidationError('revision_conflict', 'The Product revision has changed.', [], 409);
      const detail = await applyProductSchema(db, context.identity, productId, revision, parseApplySchemaRequest(await parseJson(request)));
      return jsonResponse({ product: detail }, { headers: { ETag: `"${detail.revision}"` } });
    }

    const productMatch = /^\/api\/console\/products\/([^/]+)$/.exec(pathname);
    if (request.method === 'PUT' && productMatch) {
      const productId = decodePathIdentity(productMatch[1]);
      if (productId === null) return jsonError(404, 'product_not_found', 'Product not found.');
      const currentRevision = await readProductRevision(db, context.identity, productId);
      if (currentRevision === null) return jsonError(404, 'product_not_found', 'Product not found.');
      if (!evaluatePermission(context.identity, 'catalog:write', { storeId: context.store.id })) {
        return jsonError(403, 'forbidden', 'You do not have permission to change Products.');
      }
      const revision = requiredRevision(request);
      if (currentRevision !== revision) throw new CatalogValidationError('revision_conflict', 'The Product revision has changed.', [], 409);
      const detail = await updateProductNonstructural(db, context.identity, productId, revision, parseNonstructuralRequest(await parseJson(request)));
      return jsonResponse({ product: detail }, { headers: { ETag: `"${detail.revision}"` } });
    }
    return null;
  } catch (error) {
    const constraintFailure = error instanceof Error && (
      error.message.includes('NOT NULL constraint failed: products.name')
      || error.message.includes('NOT NULL constraint failed: stores.name')
    );
    if (constraintFailure) {
      try {
        const active = await db.prepare(
          `SELECT EXISTS (
             SELECT 1 FROM store_memberships
              WHERE id=? AND store_id=? AND user_id=? AND status='active'
           ) AS active`,
        ).bind(
          context.identity.membershipId, context.identity.storeId, context.identity.userId,
        ).first<number>('active');
        if (active !== 1) return jsonError(403, 'store_access_denied', 'Current Store access is required.');
      } catch {
        return jsonError(503, 'service_unavailable', 'The service is temporarily unavailable.');
      }
    }
    if (error instanceof Error && error.message.includes('NOT NULL constraint failed: products.name')) {
      const match = /^\/api\/console\/products\/([^/]+)/.exec(pathname);
      const productId = match ? decodePathIdentity(match[1]) : null;
      if (productId) {
        const expectedHeader = request.headers.get('If-Match');
        const expected = expectedHeader ? Number(/^"(\d+)"$/.exec(expectedHeader)?.[1]) : NaN;
        let current: number | null;
        try {
          current = await readProductRevision(db, context.identity, productId);
        } catch (readError) {
          return catalogError(readError);
        }
        if (current !== expected) return jsonError(409, 'revision_conflict', 'The Product revision has changed.');
      }
    }
    return catalogError(error);
  }
}
