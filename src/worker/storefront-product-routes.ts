import { readPublicCatalog } from '../catalog/public-catalog';
import { jsonError, jsonResponse } from './http-response';

export async function routeStorefrontProductRequest(request: Request, db: D1Database): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/storefront/products' || request.method !== 'GET') return null;
  try {
    return jsonResponse(await readPublicCatalog(db));
  } catch {
    return jsonError(500, 'persistence_failed', 'The public catalog could not be loaded.', [], crypto.randomUUID());
  }
}
