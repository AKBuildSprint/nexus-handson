import {
  decodeDeliveryFilename,
  deleteDeliveryFile,
  DeliveryFileError,
  putDeliveryFile,
} from '../files/delivery-file';
import { jsonError, jsonResponse } from './http-response';

function revisionFromHeader(request: Request): number {
  const match = /^"([1-9]\d*)"$/.exec(request.headers.get('If-Match') ?? '');
  if (!match) throw new DeliveryFileError(409, 'revision_conflict', 'A current quoted Product revision is required.');
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision)) throw new DeliveryFileError(409, 'revision_conflict', 'The Product revision is invalid.');
  return revision;
}

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export async function routeConsoleFileRequest(
  request: Request,
  env: Pick<Cloudflare.Env, 'DB' | 'FILES'>,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const variantMatch = /^\/api\/console\/products\/([^/]+)\/variants\/([^/]+)\/delivery-file$/.exec(path);
  const productMatch = /^\/api\/console\/products\/([^/]+)\/delivery-file$/.exec(path);
  if (!variantMatch && !productMatch) return null;
  const productId = decoded((variantMatch ?? productMatch)?.[1] ?? '');
  const variantId = variantMatch ? decoded(variantMatch[2]) : null;
  if (productId === null) return jsonError(404, 'product_not_found', 'Product not found.');
  if (variantMatch && variantId === null) return jsonError(404, 'variant_not_found', 'Variant not found.');
  try {
    const expectedRevision = revisionFromHeader(request);
    if (request.method === 'PUT') {
      if (request.headers.get('Content-Type')?.toLowerCase() !== 'application/octet-stream') {
        throw new DeliveryFileError(415, 'delivery_file_type_invalid', 'Delivery upload content type must be application/octet-stream.');
      }
      const result = await putDeliveryFile({
        db: env.DB,
        files: env.FILES,
        productId,
        variantId,
        expectedRevision,
        filename: decodeDeliveryFilename(request.headers.get('X-Nexus-Filename')),
        body: request.body,
        declaredLength: request.headers.get('Content-Length'),
      });
      return jsonResponse(result, { headers: { ETag: `"${result.revision}"` } });
    }
    if (request.method === 'DELETE') {
      const contentLength = request.headers.get('Content-Length');
      if (contentLength !== null && contentLength !== '0') {
        throw new DeliveryFileError(422, 'validation_failed', 'Delivery file DELETE requests must not include a body.');
      }
      const result = await deleteDeliveryFile({ db: env.DB, productId, variantId, expectedRevision });
      return jsonResponse(result, { headers: { ETag: `"${result.revision}"` } });
    }
    return null;
  } catch (error) {
    if (error instanceof DeliveryFileError) return jsonError(error.status, error.code, error.message, [], error.incidentId);
    return jsonError(500, 'persistence_failed', 'The delivery file operation could not be completed.', [], crypto.randomUUID());
  }
}
