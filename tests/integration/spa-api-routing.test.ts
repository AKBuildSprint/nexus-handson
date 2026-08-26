import { describe, expect, it, vi } from 'vitest';
import worker from '../../src/worker';
import type { Env } from '../../src/worker/environment';

function testEnvironment(assetFetch: (request: Request) => Promise<Response>): Pick<Env, 'ASSETS'> {
  return {
    ASSETS: { fetch: assetFetch } as unknown as Fetcher,
  };
}

describe('local SPA/API dispatch', () => {
  it.each(['/api', '/api/console/missing', '/api/storefront/products/missing'])(
    'returns the stable JSON route_not_found envelope for %s',
    async (pathname) => {
      const assetFetch = vi.fn();
      const response = await worker.fetch(
        new Request(`https://local.invalid${pathname}`, { method: 'POST' }),
        testEnvironment(assetFetch),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await response.json()).toEqual({
        error: {
          code: 'route_not_found',
          message: 'The requested API route was not found.',
          fields: [],
          incidentId: null,
        },
      });
      expect(assetFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['/console/products', '/console/products/new', '/console/products/focus-pack', '/console/products/import'])(
    'defers the Console deep link %s to the SPA assets binding',
    async (pathname) => {
      const assetFetch = vi.fn(async () =>
        new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      );
      const request = new Request(`https://local.invalid${pathname}`);
      const response = await worker.fetch(request, testEnvironment(assetFetch));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('id="root"');
      expect(assetFetch).toHaveBeenCalledOnce();
      expect(assetFetch).toHaveBeenCalledWith(request);
    },
  );

  it('does not treat a non-API lookalike as the API prefix', async () => {
    const assetFetch = vi.fn(async () => new Response('asset response'));
    const request = new Request('https://local.invalid/apiary');

    const response = await worker.fetch(request, testEnvironment(assetFetch));

    expect(await response.text()).toBe('asset response');
    expect(assetFetch).toHaveBeenCalledOnce();
  });
});
