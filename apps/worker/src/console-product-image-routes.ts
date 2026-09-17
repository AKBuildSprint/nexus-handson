import {
  decodeProductImageFilename,
  deleteProductImage,
  ProductImageError,
  putProductImage,
  readConsoleProductImage,
} from '@nexus/catalog/files/product-image';
import { CatalogReadAccessError } from '@nexus/catalog/catalog-read';
import { jsonError, jsonResponse } from './http-response';
import type { ConsoleRequestContext } from './auth';
import { evaluatePermission } from '@nexus/identity/permissions';

function revisionFromHeader(request: Request): number {
  const match = /^"([1-9]\d*)"$/.exec(request.headers.get('If-Match') ?? '');
  if (!match) throw new ProductImageError(409, 'revision_conflict', 'A current quoted Product revision is required.');
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision)) throw new ProductImageError(409, 'revision_conflict', 'The Product revision is invalid.');
  return revision;
}

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function imageResponse(object: R2ObjectBody, cacheControl: string): Response {
  const headers = new Headers({
    'Cache-Control': cacheControl,
    'ETag': object.httpEtag,
    'X-Content-Type-Options': 'nosniff',
  });
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
}

export async function routeConsoleProductImageRequest(
  request: Request,
  env: Pick<Cloudflare.Env, 'DB' | 'FILES'>,
  context: ConsoleRequestContext,
): Promise<Response | null> {
  const match = /^\/api\/console\/products\/([^/]+)\/image$/.exec(new URL(request.url).pathname);
  if (!match) return null;
  const productId = decoded(match[1]);
  if (productId === null) return jsonError(404, 'product_not_found', 'Product not found.');
  try {
    if (request.method === 'GET') {
      if (!evaluatePermission(context.identity, 'catalog:file:read', { storeId: context.store.id })) {
        return jsonError(403, 'forbidden', 'You do not have permission to read product images.');
      }
      const reference = await readConsoleProductImage(env.DB, context.identity, productId);
      if (reference === null) return jsonError(404, 'product_image_not_found', 'Product image not found.');
      const object = await env.FILES.get(reference.key);
      if (object === null || !('body' in object)) return jsonError(404, 'product_image_not_found', 'Product image not found.');
      return imageResponse(object, 'private, no-store');
    }
    const action = request.method === 'DELETE' ? 'catalog:remove' : 'catalog:file:write';
    if (!evaluatePermission(context.identity, action, { storeId: context.store.id })) {
      return jsonError(403, 'forbidden', 'You do not have permission to change product images.');
    }
    const expectedRevision = revisionFromHeader(request);
    if (request.method === 'PUT') {
      if (request.headers.get('Content-Type')?.toLowerCase() !== 'application/octet-stream') {
        throw new ProductImageError(415, 'product_image_type_invalid', 'Product image upload content type must be application/octet-stream.');
      }
      const result = await putProductImage({
        db: env.DB,
        files: env.FILES,
        identity: context.identity,
        productId,
        expectedRevision,
        filename: decodeProductImageFilename(request.headers.get('X-Nexus-Filename')),
        body: request.body,
        declaredLength: request.headers.get('Content-Length'),
      });
      return jsonResponse(result, { headers: { ETag: `"${result.revision}"` } });
    }
    if (request.method === 'DELETE') {
      const contentLength = request.headers.get('Content-Length');
      if (contentLength !== null && contentLength !== '0') {
        throw new ProductImageError(422, 'validation_failed', 'Product image DELETE requests must not include a body.');
      }
      const result = await deleteProductImage({ db: env.DB, files: env.FILES, identity: context.identity, productId, expectedRevision });
      return jsonResponse(result, { headers: { ETag: `"${result.revision}"` } });
    }
    return null;
  } catch (error) {
    if (error instanceof CatalogReadAccessError) return jsonError(403, 'store_access_denied', 'Current Store access is required.');
    if (error instanceof ProductImageError) return jsonError(error.status, error.code, error.message, [], error.incidentId);
    return jsonError(500, 'persistence_failed', 'The product image operation could not be completed.', [], crypto.randomUUID());
  }
}
