import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { consoleRequest, resetCatalog, SIMPLE_CORE, workerRequest } from '../support/catalog-test-env';

beforeEach(async () => {
  await resetCatalog();
  const objects = await env.FILES.list();
  if (objects.objects.length > 0) await env.FILES.delete(objects.objects.map((object) => object.key));
});

function webpBytes(label: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(`RIFF\u0010\u0000\u0000\u0000WEBP${label}`);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function createProduct(): Promise<{ id: string; slug: string; revision: number }> {
  const response = await consoleRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { product: { id: string; slug: string; revision: number } }).product;
}

describe('product images', () => {
  it('stores verified image bytes and serves only the active public Product image', async () => {
    const product = await createProduct();
    const bytes = webpBytes('catalog-image');
    const uploaded = await consoleRequest(`/api/console/products/${product.id}/image`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'If-Match': `"${product.revision}"`,
        'X-Nexus-Filename': 'field-notes.webp',
      },
      body: bytes,
    });
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toMatchObject({
      revision: product.revision + 1,
      image: { present: true, filename: 'field-notes.webp', contentType: 'image/webp', sizeBytes: bytes.byteLength },
    });

    const detail = await consoleRequest(`/api/console/products/by-slug/${product.slug}`);
    expect(detail.status).toBe(200);
    expect((await detail.json() as { image: unknown }).image).toMatchObject({
      present: true,
      filename: 'field-notes.webp',
      contentType: 'image/webp',
      sizeBytes: bytes.byteLength,
    });

    const catalog = await workerRequest('/api/storefront/products');
    const imagePath = (await catalog.json() as { products: Array<{ id: string; imagePath: string | null }> }).products
      .find((candidate) => candidate.id === product.id)?.imagePath;
    expect(imagePath).toBe(`/api/storefront/products/${product.id}/image?v=${product.revision + 1}`);

    const publicImage = await workerRequest(imagePath!);
    expect(publicImage.status).toBe(200);
    expect(publicImage.headers.get('Content-Type')).toBe('image/webp');
    expect(publicImage.headers.get('Cache-Control')).toBe('no-store');
    expect(new Uint8Array(await publicImage.arrayBuffer())).toEqual(new Uint8Array(bytes));

    const consoleImage = await consoleRequest(`/api/console/products/${product.id}/image`);
    expect(consoleImage.status).toBe(200);
    expect(consoleImage.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects non-image bytes and removes the R2 object after a confirmed deletion', async () => {
    const product = await createProduct();
    const invalid = await consoleRequest(`/api/console/products/${product.id}/image`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'If-Match': `"${product.revision}"`,
        'X-Nexus-Filename': 'not-an-image.webp',
      },
      body: new TextEncoder().encode('not an image'),
    });
    expect(invalid.status).toBe(415);
    expect((await env.FILES.list()).objects).toHaveLength(0);

    const uploaded = await consoleRequest(`/api/console/products/${product.id}/image`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'If-Match': `"${product.revision}"`,
        'X-Nexus-Filename': 'field-notes.webp',
      },
      body: webpBytes('remove-me'),
    });
    const revision = (await uploaded.json() as { revision: number }).revision;
    expect((await env.FILES.list()).objects).toHaveLength(1);

    const removed = await consoleRequest(`/api/console/products/${product.id}/image`, {
      method: 'DELETE',
      headers: { 'If-Match': `"${revision}"` },
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ image: { present: false }, revision: revision + 1 });
    expect((await env.FILES.list()).objects).toHaveLength(0);
    expect((await workerRequest(`/api/storefront/products/${product.id}/image`)).status).toBe(404);
  });
});
