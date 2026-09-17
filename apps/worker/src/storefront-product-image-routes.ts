import { readPublicProductImage } from '@nexus/catalog/files/product-image';
import { jsonError } from './http-response';
import { withStorefrontCors } from './storefront-cors';

export async function routeStorefrontProductImageRequest(
  request: Request,
  db: D1Database,
  files: R2Bucket,
  storefrontOrigin: string | undefined,
): Promise<Response | null> {
  const match = /^\/api\/storefront\/products\/([^/]+)\/image$/.exec(new URL(request.url).pathname);
  if (!match || request.method !== 'GET') return null;
  let productId: string;
  try {
    productId = decodeURIComponent(match[1]);
  } catch {
    return withStorefrontCors(request, storefrontOrigin, jsonError(404, 'product_image_not_found', 'Product image not found.'));
  }
  try {
    const reference = await readPublicProductImage(db, productId);
    if (reference === null) return withStorefrontCors(request, storefrontOrigin, jsonError(404, 'product_image_not_found', 'Product image not found.'));
    const object = await files.get(reference.key);
    if (object === null || !('body' in object)) {
      return withStorefrontCors(request, storefrontOrigin, jsonError(404, 'product_image_not_found', 'Product image not found.'));
    }
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'ETag': object.httpEtag,
      'X-Content-Type-Options': 'nosniff',
    });
    object.writeHttpMetadata(headers);
    return withStorefrontCors(request, storefrontOrigin, new Response(object.body, { headers }));
  } catch {
    return withStorefrontCors(request, storefrontOrigin, jsonError(500, 'persistence_failed', 'The product image could not be loaded.', [], crypto.randomUUID()));
  }
}
