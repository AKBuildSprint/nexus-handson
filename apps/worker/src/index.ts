import type { Env } from './environment';
import { authenticateConsole, routeConsoleAuth } from './console-auth';
import { routeConsoleOrderRequest } from './console-order-routes';
import { routeConsoleFileRequest } from './console-file-routes';
import { routeConsoleImportRequest } from './console-import-routes';
import { routeConsoleProductRequest } from './console-product-routes';
import { routeStorefrontPreflight } from './storefront-cors';
import { routeStorefrontOrderRequest } from './storefront-order-routes';
import { jsonResponse, routeNotFound } from './http-response';
import { routeStorefrontProductRequest } from './storefront-product-routes';

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export default {
  async fetch(request: Request, env: Env | Pick<Env, 'ASSETS'>): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (isApiPath(pathname)) {
      if (!('DB' in env) || !('FILES' in env)) return routeNotFound();
      if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
        return routeConsoleAuth(request, env);
      }
      if (pathname === '/api/console' || pathname.startsWith('/api/console/')) {
        const user = await authenticateConsole(request, env);
        if (user instanceof Response) return user;
        if (pathname === '/api/console/session' && request.method === 'GET') return jsonResponse({ user });
        return await routeConsoleImportRequest(request, env)
          ?? await routeConsoleFileRequest(request, env)
          ?? await routeConsoleProductRequest(request, env.DB)
          ?? await routeConsoleOrderRequest(request, env.DB, user.id)
          ?? routeNotFound();
      }
      const storefrontOrigin = 'STOREFRONT_ORIGIN' in env ? env.STOREFRONT_ORIGIN : undefined;
      const response =
        routeStorefrontPreflight(request, storefrontOrigin) ??
        await routeStorefrontProductRequest(request, env.DB, storefrontOrigin) ??
        await routeStorefrontOrderRequest(request, env.DB, storefrontOrigin);
      return response ?? routeNotFound();
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
