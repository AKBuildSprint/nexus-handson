import { readPublicCatalog } from '../catalog/public-catalog';
import { jsonError, jsonResponse } from './http-response';
import { withStorefrontCors } from './storefront-cors';

export async function routeStorefrontProductRequest(
  request: Request,
  db: D1Database,
  storefrontOrigin: string | undefined,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/storefront/products' || request.method !== 'GET') return null;
  let response: Response;
  try {
    response = jsonResponse(await readPublicCatalog(db));
  } catch {
    response = jsonError(500, 'persistence_failed', 'The public catalog could not be loaded.', [], crypto.randomUUID());
  }
  return withStorefrontCors(request, storefrontOrigin, response);
}
