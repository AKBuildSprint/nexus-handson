import { beforeEach, describe, expect, it } from 'vitest';
import { resetCatalog, SIMPLE_CORE, workerRequest } from '../support/catalog-test-env';

beforeEach(resetCatalog);

describe('catalog CRUD and stable errors', () => {
  it('creates, lists, opens, updates, and rejects stale revisions', async () => {
    const created = await workerRequest('/api/console/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
    });
    expect(created.status).toBe(201);
    expect(created.headers.get('location')).toBe('/console/products/field-notes');
    expect(created.headers.get('etag')).toBe('"1"');
    const mutation = await created.json() as { product: { id: string; slug: string } };

    const list = await workerRequest('/api/console/products?q=field&status=active');
    expect(await list.json()).toMatchObject({ products: [{ id: mutation.product.id, slug: 'field-notes', enabledVariantCount: null }] });

    const detail = await workerRequest('/api/console/products/by-slug/field-notes');
    expect(detail.headers.get('etag')).toBe('"1"');
    expect(await detail.json()).toMatchObject({ type: 'simple', basePriceMinor: 2400, revision: 1 });

    const updateBody = { product: { ...SIMPLE_CORE, name: 'Field Notes Revised' }, optionLabels: { groups: [] }, variantEdits: [] };
    const updated = await workerRequest(`/api/console/products/${mutation.product.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify(updateBody),
    });
    expect(updated.status).toBe(200);
    expect(updated.headers.get('etag')).toBe('"2"');

    const stale = await workerRequest(`/api/console/products/${mutation.product.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify(updateBody),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: 'revision_conflict', fields: [], incidentId: null } });
  });

  it('uses the stable JSON envelope for unknown API routes', async () => {
    const response = await workerRequest('/api/console/products/missing/extra');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'route_not_found', message: 'The requested API route was not found.', fields: [], incidentId: null } });
  });

  it('matches slug text and treats LIKE wildcards as literal search text', async () => {
    for (const product of [SIMPLE_CORE, { ...SIMPLE_CORE, name: '100% Guide' }, { ...SIMPLE_CORE, name: 'Ｆｏｃｕｓ Guide' }]) {
      await workerRequest('/api/console/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product, schema: null, previewHash: null }),
      });
    }
    const slugMatch = await workerRequest('/api/console/products?q=field-notes');
    expect((await slugMatch.json() as { products: Array<{ slug: string }> }).products.map((product) => product.slug)).toEqual(['field-notes']);
    const percentMatch = await workerRequest('/api/console/products?q=%25');
    expect((await percentMatch.json() as { products: Array<{ name: string }> }).products.map((product) => product.name)).toEqual(['100% Guide']);
    const unicodeMatch = await workerRequest('/api/console/products?q=FOCUS');
    expect((await unicodeMatch.json() as { products: Array<{ name: string }> }).products.map((product) => product.name)).toEqual(['Ｆｏｃｕｓ Guide']);
  });
});
