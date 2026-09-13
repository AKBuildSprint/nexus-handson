import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import { putDeliveryFile } from '@nexus/catalog/files/delivery-file';
import {
  consoleRequest,
  getConsoleIdentity,
  oneVariantSchema,
  resetCatalog,
  SIMPLE_CORE,
  VARIANT_CORE,
  workerRequest,
} from '../support/catalog-test-env';

beforeEach(async () => {
  await resetCatalog();
  const objects = await env.FILES.list();
  if (objects.objects.length > 0) await env.FILES.delete(objects.objects.map((object) => object.key));
});

async function createSimple(): Promise<string> {
  const response = await consoleRequest('/api/console/products', {
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

async function createPurchasedVariantFixture(): Promise<{
  orderId: string;
  productId: string;
  snapshotBytes: ArrayBuffer;
  snapshotKey: string;
  variantId: string;
}> {
  const product = { ...VARIANT_CORE, status: 'active' as const };
  const baseSchema = oneVariantSchema();
  const schema = {
    ...baseSchema,
    rows: baseSchema.rows.map((row) => ({
      ...row,
      delivery: {
        source: 'variant_override' as const,
        accessTitle: 'Purchased variant file',
        accessInstructions: 'Open the retained variant file',
      },
    })),
  };
  const preview = await consoleRequest('/api/console/products/schema/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: null, productSlug: 'focus-pack', product, schema }),
  });
  expect(preview.status).toBe(200);
  const previewHash = (await preview.json() as { previewHash: string }).previewHash;
  const created = await consoleRequest('/api/console/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product, schema, previewHash }),
  });
  expect(created.status).toBe(201);
  const detail = (await created.json() as { product: ProductDetailResponse }).product;
  const variant = detail.variants[0];
  expect(variant).toBeTruthy();

  const snapshotBytes = pdfBytes('purchased-variant');
  const uploaded = await consoleRequest(
    `/api/console/products/${detail.id}/variants/${variant.id}/delivery-file`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'If-Match': `"${detail.revision}"`,
        'X-Nexus-Filename': 'purchased-variant.pdf',
      },
      body: snapshotBytes,
    },
  );
  expect(uploaded.status).toBe(200);
  const snapshotKey = await env.DB.prepare(
    'SELECT delivery_file_key FROM product_variants WHERE product_id=? AND id=?',
  ).bind(detail.id, variant.id).first<string>('delivery_file_key');
  expect(snapshotKey).toBeTruthy();

  const ordered = await workerRequest('/api/storefront/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'purchased-variant-file-0001',
      'X-Nexus-Order-Capability': 'V'.repeat(43),
    },
    body: JSON.stringify({
      customer: { name: 'Variant Customer', email: 'variant-customer@example.test' },
      items: [{ productId: detail.id, variantId: variant.id, quantity: 1 }],
    }),
  });
  expect(ordered.status).toBe(201);
  const reference = (await ordered.json() as { reference: string }).reference;
  const orderId = await env.DB.prepare('SELECT id FROM orders WHERE reference=?')
    .bind(reference).first<string>('id');
  expect(orderId).toBeTruthy();
  return {
    orderId: orderId!,
    productId: detail.id,
    snapshotBytes,
    snapshotKey: snapshotKey!,
    variantId: variant.id,
  };
}

async function expectPurchasedSnapshotRetained(input: {
  orderId: string;
  snapshotBytes: ArrayBuffer;
  snapshotKey: string;
}): Promise<void> {
  expect(await env.DB.prepare('SELECT private_file_key FROM order_lines WHERE order_id=?')
    .bind(input.orderId).first<string>('private_file_key')).toBe(input.snapshotKey);
  const retained = await env.FILES.get(input.snapshotKey);
  expect(retained).not.toBeNull();
  expect(new Uint8Array(await retained!.arrayBuffer())).toEqual(new Uint8Array(input.snapshotBytes));
}

async function expectEveryDeliveryObjectReadable(): Promise<string[]> {
  const keys = (await env.FILES.list()).objects.map((object) => object.key).sort();
  for (const key of keys) {
    const object = await env.FILES.get(key);
    expect(object).not.toBeNull();
    expect((await object!.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }
  return keys;
}


describe('delivery replacement and compensation', () => {
  it('uses a new key, retains committed history, and DELETE only clears association', async () => {
    const productId = await createSimple();
    const first = await consoleRequest(`/api/console/products/${productId}/delivery-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '"1"', 'X-Nexus-Filename': 'first.pdf' }, body: pdfBytes('first'),
    });
    expect(first.status).toBe(200);
    const firstKey = await env.DB.prepare('SELECT delivery_file_key FROM products WHERE id=?').bind(productId).first<string>('delivery_file_key');
    const firstChecksum = await env.DB.prepare('SELECT delivery_file_checksum FROM products WHERE id=?')
      .bind(productId).first<string>('delivery_file_checksum');
    expect(firstChecksum).toBe(await sha256Hex(pdfBytes('first')));

    const second = await consoleRequest(`/api/console/products/${productId}/delivery-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '"2"', 'X-Nexus-Filename': 'second.pdf' }, body: pdfBytes('second'),
    });
    const secondKey = await env.DB.prepare('SELECT delivery_file_key FROM products WHERE id=?').bind(productId).first<string>('delivery_file_key');
    expect(second.status).toBe(200);
    expect(secondKey).not.toBe(firstKey);
    await expect(env.FILES.get(firstKey ?? '')).resolves.not.toBeNull();

    const removed = await consoleRequest(`/api/console/products/${productId}/delivery-file`, {
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
      identity: await getConsoleIdentity(),
      productId,
      variantId: null,
      expectedRevision: 1,
      filename: 'failed.pdf',
      body: new Blob([pdfBytes('failed')]).stream(),
      declaredLength: null,
    })).rejects.toMatchObject({ code: 'persistence_failed' });
    expect((await env.FILES.list()).objects).toHaveLength(0);
  });

  it('retains the uploaded object when D1 commits before its response fails', async () => {
    const productId = await createSimple();
    const committedThenFailed = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.batch(statements);
        throw new Error('response channel failed after commit');
      },
    } as unknown as D1Database;

    await expect(putDeliveryFile({
      db: committedThenFailed,
      files: env.FILES,
      identity: await getConsoleIdentity(),
      productId,
      variantId: null,
      expectedRevision: 1,
      filename: 'committed.pdf',
      body: new Blob([pdfBytes('committed')]).stream(),
      declaredLength: null,
    })).rejects.toMatchObject({ code: 'persistence_failed' });

    const key = await env.DB.prepare(
      'SELECT delivery_file_key FROM products WHERE id=? AND revision=2',
    ).bind(productId).first<string>('delivery_file_key');
    expect(key).toBeTruthy();
    await expect(env.FILES.get(key ?? '')).resolves.not.toBeNull();
  });

  it('keeps a purchased Variant snapshot when replacement commits before its response fails', async () => {
    const fixture = await createPurchasedVariantFixture();
    const committedThenFailed = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.batch(statements);
        throw new Error('response channel failed after commit');
      },
    } as unknown as D1Database;

    await expect(putDeliveryFile({
      db: committedThenFailed,
      files: env.FILES,
      identity: await getConsoleIdentity(),
      productId: fixture.productId,
      variantId: fixture.variantId,
      expectedRevision: 2,
      filename: 'replacement-committed.pdf',
      body: new Blob([pdfBytes('replacement-committed')]).stream(),
      declaredLength: null,
    })).rejects.toMatchObject({ code: 'persistence_failed' });

    const currentKey = await env.DB.prepare(
      'SELECT delivery_file_key FROM product_variants WHERE product_id=? AND id=?',
    ).bind(fixture.productId, fixture.variantId).first<string>('delivery_file_key');
    expect(currentKey).toBeTruthy();
    expect(currentKey).not.toBe(fixture.snapshotKey);
    expect(await expectEveryDeliveryObjectReadable()).toEqual([currentKey!, fixture.snapshotKey].sort());
    await expectPurchasedSnapshotRetained(fixture);
  });

  it('retains the upload when the post-failure reference check is unavailable', async () => {
    const productId = await createSimple();
    let batchFailed = false;
    const unavailableAfterBatch = {
      prepare: (...args: Parameters<D1Database['prepare']>) => {
        if (batchFailed) throw new Error('reference lookup unavailable');
        return env.DB.prepare(...args);
      },
      batch: async () => {
        batchFailed = true;
        throw new Error('unknown batch outcome');
      },
    } as unknown as D1Database;

    await expect(putDeliveryFile({
      db: unavailableAfterBatch, files: env.FILES, identity: await getConsoleIdentity(),
      productId, variantId: null, expectedRevision: 1, filename: 'unknown.pdf',
      body: new Blob([pdfBytes('unknown')]).stream(), declaredLength: null,
    })).rejects.toMatchObject({ code: 'persistence_failed' });
    expect((await env.FILES.list()).objects).toHaveLength(1);
    expect(await env.DB.prepare('SELECT revision FROM products WHERE id=?').bind(productId).first<number>('revision')).toBe(1);
  });

  it('keeps a purchased Variant snapshot when replacement reference lookup is unavailable', async () => {
    const fixture = await createPurchasedVariantFixture();
    let batchFailed = false;
    const unavailableAfterBatch = {
      prepare: (...args: Parameters<D1Database['prepare']>) => {
        if (batchFailed) throw new Error('reference lookup unavailable');
        return env.DB.prepare(...args);
      },
      batch: async () => {
        batchFailed = true;
        throw new Error('unknown batch outcome');
      },
    } as unknown as D1Database;

    await expect(putDeliveryFile({
      db: unavailableAfterBatch,
      files: env.FILES,
      identity: await getConsoleIdentity(),
      productId: fixture.productId,
      variantId: fixture.variantId,
      expectedRevision: 2,
      filename: 'replacement-unknown.pdf',
      body: new Blob([pdfBytes('replacement-unknown')]).stream(),
      declaredLength: null,
    })).rejects.toMatchObject({ code: 'persistence_failed' });

    expect(await env.DB.prepare(
      'SELECT delivery_file_key FROM product_variants WHERE product_id=? AND id=?',
    ).bind(fixture.productId, fixture.variantId).first<string>('delivery_file_key')).toBe(fixture.snapshotKey);
    const retainedKeys = await expectEveryDeliveryObjectReadable();
    expect(retainedKeys).toHaveLength(2);
    expect(retainedKeys).toContain(fixture.snapshotKey);
    await expectPurchasedSnapshotRetained(fixture);
  });

  it('returns a sanitized error and retains the upload when compensation fails', async () => {
    const productId = await createSimple();
    const failingDelete = new Proxy(env.FILES, {
      get(target, property) {
        if (property === 'delete') return () => Promise.reject(new Error('forced delete failure'));
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as R2Bucket;
    const failedBatch = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: () => Promise.reject(new Error('confirmed failed batch')),
    } as unknown as D1Database;

    await expect(putDeliveryFile({
      db: failedBatch, files: failingDelete, identity: await getConsoleIdentity(),
      productId, variantId: null, expectedRevision: 1, filename: 'compensation.pdf',
      body: new Blob([pdfBytes('compensation')]).stream(), declaredLength: null,
    })).rejects.toMatchObject({ code: 'storage_compensation_failed', incidentId: expect.any(String) });
    expect((await env.FILES.list()).objects).toHaveLength(1);
  });

  it('keeps a purchased Variant snapshot when replacement compensation fails', async () => {
    const fixture = await createPurchasedVariantFixture();
    const failingDelete = new Proxy(env.FILES, {
      get(target, property) {
        if (property === 'delete') return () => Promise.reject(new Error('forced delete failure'));
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as R2Bucket;
    const failedBatch = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: () => Promise.reject(new Error('confirmed failed batch')),
    } as unknown as D1Database;

    await expect(putDeliveryFile({
      db: failedBatch,
      files: failingDelete,
      identity: await getConsoleIdentity(),
      productId: fixture.productId,
      variantId: fixture.variantId,
      expectedRevision: 2,
      filename: 'replacement-compensation.pdf',
      body: new Blob([pdfBytes('replacement-compensation')]).stream(),
      declaredLength: null,
    })).rejects.toMatchObject({
      code: 'storage_compensation_failed',
      incidentId: expect.any(String),
    });

    expect(await env.DB.prepare(
      'SELECT delivery_file_key FROM product_variants WHERE product_id=? AND id=?',
    ).bind(fixture.productId, fixture.variantId).first<string>('delivery_file_key')).toBe(fixture.snapshotKey);
    const retainedKeys = await expectEveryDeliveryObjectReadable();
    expect(retainedKeys).toHaveLength(2);
    expect(retainedKeys).toContain(fixture.snapshotKey);
    await expectPurchasedSnapshotRetained(fixture);
  });

  it('does not write provider exception details to delivery diagnostics or responses', async () => {
    const productId = await createSimple();
    const sentinel = 'PRIVATE_DELIVERY_PROVIDER_SENTINEL';
    const failedStorage = new Proxy(env.FILES, {
      get(target, property) {
        if (property === 'createMultipartUpload') return () => Promise.reject(new Error(sentinel));
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as R2Bucket;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let failure: unknown;
      try {
        await putDeliveryFile({
          db: env.DB, files: failedStorage, identity: await getConsoleIdentity(),
          productId, variantId: null, expectedRevision: 1, filename: 'diagnostic.pdf',
          body: new Blob([pdfBytes('diagnostic')]).stream(), declaredLength: null,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: 'storage_write_failed' });
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(sentinel);
      for (const [message, details] of log.mock.calls) {
        expect(message).toBe('Delivery storage write failure');
        expect(Object.keys(details as object).sort()).toEqual(['classification', 'incidentId']);
        expect(Object.values(details as object).some((value) => value instanceof Error)).toBe(false);
      }
    } finally {
      log.mockRestore();
    }
  });
});
