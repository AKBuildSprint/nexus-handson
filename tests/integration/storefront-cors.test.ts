import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetCatalog,
  TEST_STOREFRONT_ORIGIN,
  workerRequest,
} from '../support/catalog-test-env';

beforeEach(resetCatalog);

function corsHeaderNames(response: Response): string[] {
  return [...response.headers.keys()].filter((name) => name.startsWith('access-control-')).sort();
}

describe('Storefront CORS boundary', () => {
  it('adds only the configured origin to Storefront success and error responses', async () => {
    const catalog = await workerRequest('/api/storefront/products', {
      headers: { Origin: TEST_STOREFRONT_ORIGIN },
    });
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get('Access-Control-Allow-Origin')).toBe(TEST_STOREFRONT_ORIGIN);
    expect(corsHeaderNames(catalog)).toEqual(['access-control-allow-origin']);
    expect(catalog.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(catalog.headers.get('Vary')).toContain('Origin');

    const invalidCreate = await workerRequest('/api/storefront/orders', {
      method: 'POST',
      headers: {
        Origin: TEST_STOREFRONT_ORIGIN,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'cors-invalid-json-0001',
        'X-Nexus-Order-Capability': 'A'.repeat(43),
      },
      body: '{',
    });
    expect(invalidCreate.status).toBe(400);
    expect(invalidCreate.headers.get('Access-Control-Allow-Origin')).toBe(TEST_STOREFRONT_ORIGIN);
    expect(corsHeaderNames(invalidCreate)).toEqual(['access-control-allow-origin']);
    expect(await invalidCreate.json()).toEqual({
      error: {
        code: 'invalid_json',
        message: 'The request body is not valid JSON.',
        fields: [],
        incidentId: null,
      },
    });

    const privateDenial = await workerRequest(`/api/storefront/orders/NX-${'F'.repeat(16)}`, {
      headers: {
        Origin: TEST_STOREFRONT_ORIGIN,
        'X-Nexus-Order-Capability': 'A'.repeat(43),
      },
    });
    expect(privateDenial.status).toBe(404);
    expect(privateDenial.headers.get('Access-Control-Allow-Origin')).toBe(TEST_STOREFRONT_ORIGIN);
  });

  it('leaves unrelated and absent origins usable without any permissive response headers', async () => {
    const unrelated = await workerRequest('/api/storefront/products', {
      headers: { Origin: 'https://unrelated.test' },
    });
    expect(unrelated.status).toBe(200);
    expect(corsHeaderNames(unrelated)).toEqual([]);
    expect(unrelated.headers.get('Vary')).toBeNull();

    const serverRequest = await workerRequest('/api/storefront/products');
    expect(serverRequest.status).toBe(200);
    expect(corsHeaderNames(serverRequest)).toEqual([]);
  });

  it('answers only valid route-specific preflights with the fixed method and header allow-list', async () => {
    const valid = await workerRequest('/api/storefront/orders', {
      method: 'OPTIONS',
      headers: {
        Origin: TEST_STOREFRONT_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, idempotency-key, x-nexus-order-capability',
      },
    });
    expect(valid.status).toBe(204);
    expect(valid.headers.get('Access-Control-Allow-Origin')).toBe(TEST_STOREFRONT_ORIGIN);
    expect(valid.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(valid.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, Idempotency-Key, X-Nexus-Order-Capability',
    );
    expect(valid.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(corsHeaderNames(valid)).toEqual([
      'access-control-allow-headers',
      'access-control-allow-methods',
      'access-control-allow-origin',
    ]);
    expect(valid.headers.get('Vary')).toContain('Origin');
    expect(valid.headers.get('Vary')).toContain('Access-Control-Request-Method');
    expect(valid.headers.get('Vary')).toContain('Access-Control-Request-Headers');

    const invalidRequests = [
      workerRequest('/api/storefront/orders', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://unrelated.test',
          'Access-Control-Request-Method': 'POST',
        },
      }),
      workerRequest('/api/storefront/orders', {
        method: 'OPTIONS',
        headers: {
          Origin: TEST_STOREFRONT_ORIGIN,
          'Access-Control-Request-Method': 'DELETE',
        },
      }),
      workerRequest('/api/storefront/orders', {
        method: 'OPTIONS',
        headers: {
          Origin: TEST_STOREFRONT_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization',
        },
      }),
      workerRequest('/api/console/orders', {
        method: 'OPTIONS',
        headers: {
          Origin: TEST_STOREFRONT_ORIGIN,
          'Access-Control-Request-Method': 'GET',
        },
      }),
    ];

    for (const invalid of await Promise.all(invalidRequests)) {
      expect(invalid.status).toBe(404);
      expect(corsHeaderNames(invalid)).toEqual([]);
    }
  });
});
