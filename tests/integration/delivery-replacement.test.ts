import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { putDeliveryFile } from '../../src/files/delivery-file';
import { resetCatalog, SIMPLE_CORE, workerRequest } from '../support/catalog-test-env';

beforeEach(async () => {
  await resetCatalog();
  const objects = await env.FILES.list();
  if (objects.objects.length > 0) await env.FILES.delete(objects.objects.map((object) => object.key));
});

async function createSimple(): Promise<string> {
  const response = await workerRequest('/api/console/products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: SIMPLE_CORE, schema: null, previewHash: null }),
  });
  return (await response.json() as { product: { id: string } }).product.id;
}

function pdfBytes(label: string): ArrayBuffer {
  return new TextEncoder().encode(`%PDF-${label}`).buffer as ArrayBuffer;
}
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}


describe('delivery replacement and compensation', () => {
  it('uses a new key, retains committed history, and DELETE only clears association', async () => {
    const productId = await createSimple();
    const first = await workerRequest(`/api/console/products/${productId}/delivery-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '"1"', 'X-Nexus-Filename': 'first.pdf' }, body: pdfBytes('first'),
    });
    expect(first.status).toBe(200);
    const firstKey = await env.DB.prepare('SELECT delivery_file_key FROM products WHERE id=?').bind(productId).first<string>('delivery_file_key');
    const firstChecksum = await env.DB.prepare('SELECT delivery_file_checksum FROM products WHERE id=?')
      .bind(productId).first<string>('delivery_file_checksum');
    expect(firstChecksum).toBe(await sha256Hex(pdfBytes('first')));

    const second = await workerRequest(`/api/console/products/${productId}/delivery-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '"2"', 'X-Nexus-Filename': 'second.pdf' }, body: pdfBytes('second'),
    });
    const secondKey = await env.DB.prepare('SELECT delivery_file_key FROM products WHERE id=?').bind(productId).first<string>('delivery_file_key');
    expect(second.status).toBe(200);
    expect(secondKey).not.toBe(firstKey);
    await expect(env.FILES.get(firstKey ?? '')).resolves.not.toBeNull();

    const removed = await workerRequest(`/api/console/products/${productId}/delivery-file`, {
      method: 'DELETE', headers: { 'If-Match': '"3"' },
    });
    expect(await removed.json()).toMatchObject({ file: { present: false }, revision: 4 });
    expect(await env.DB.prepare('SELECT delivery_file_key FROM products WHERE id=?').bind(productId).first<string | null>('delivery_file_key')).toBeNull();
    await expect(env.FILES.get(secondKey ?? '')).resolves.not.toBeNull();
  });

  it('deletes only the new object when D1 association fails', async () => {
    const productId = await createSimple();
    const failingDb = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: () => Promise.reject(new Error('forced late D1 failure')),
    } as unknown as D1Database;
    await expect(putDeliveryFile({
      db: failingDb,
      files: env.FILES,
      productId,
      variantId: null,
      expectedRevision: 1,
      filename: 'failed.pdf',
      body: new Blob([pdfBytes('failed')]).stream(),
      declaredLength: null,
    })).rejects.toMatchObject({ code: 'persistence_failed' });
    expect((await env.FILES.list()).objects).toHaveLength(0);
  });
});
