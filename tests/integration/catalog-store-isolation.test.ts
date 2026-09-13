import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConsoleSession, TEST_CONSOLE_ORIGIN } from '../support/identity-test-env';
import { applyProductSchema, createProduct, updateProductNonstructural } from '@nexus/catalog/catalog-write';
import { CatalogReadAccessError, listProducts } from '@nexus/catalog/catalog-read';
import { schemaPreviewHash } from '@nexus/catalog/schema-change';
import { deleteDeliveryFile, putDeliveryFile } from '@nexus/catalog/files/delivery-file';
import { executeCsvImport } from '@nexus/catalog/import/import-command';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';
import worker from '../../apps/worker/src';
import {
  getConsoleIdentity, oneVariantSchema, resetCatalog, SIMPLE_CORE, TEST_STOREFRONT_ORIGIN, workerRequest,
} from '../support/catalog-test-env';
import { TEST_BETTER_AUTH_SECRET } from '../support/identity-test-env';
import { CSV_CONTENT_TYPE, CSV_FILENAME_HEADER, CSV_TEMPLATE } from '@nexus/catalog/shared/csv-contract';

beforeEach(async () => {
  await resetCatalog();
  const objects = await env.FILES.list();
  if (objects.objects.length > 0) await env.FILES.delete(objects.objects.map((object) => object.key));
  await env.DB.prepare(
    "INSERT INTO stores (id, slug, name) VALUES ('store_b', 'store-b', 'Store B')",
  ).run();
});

async function requestAs(
  session: { cookie: string },
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Cookie', session.cookie);
  headers.set('Origin', TEST_CONSOLE_ORIGIN);
  headers.set('Sec-Fetch-Site', 'same-origin');
  return workerRequest(path, { ...init, headers });
}

function createBody(name = SIMPLE_CORE.name): string {
  return JSON.stringify({ product: { ...SIMPLE_CORE, name }, schema: null, previewHash: null });
}

function revokingDatabase(identity: ConsoleIdentityContext): D1Database {
  return {
    prepare: env.DB.prepare.bind(env.DB),
    batch: async (statements: D1PreparedStatement[]) => {
      await env.DB.prepare(
        "UPDATE store_memberships SET status='revoked', revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?",
      ).bind(identity.membershipId).run();
      return env.DB.batch(statements);
    },
  } as unknown as D1Database;
}

describe('private catalog Store isolation and roles', () => {
  it('scopes reads and writes to the authenticated Store while Staff remains read-only', async () => {
    const ownerA = await createConsoleSession({ email: 'owner-a@example.test', name: 'Owner A' });
    const staffA = await createConsoleSession({ email: 'staff-a@example.test', name: 'Staff A', role: 'staff' });
    const ownerB = await createConsoleSession({
      email: 'owner-b@example.test',
      name: 'Owner B',
      storeId: 'store_b',
    });

    const createdA = await requestAs(ownerA, '/api/console/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: createBody(),
    });
    expect(createdA.status).toBe(201);
    const productA = (await createdA.json() as { product: { id: string } }).product;

    const staffList = await requestAs(staffA, '/api/console/products');
    expect(staffList.status).toBe(200);
    expect((await staffList.json() as { products: unknown[] }).products).toHaveLength(1);

    const storeBList = await requestAs(ownerB, '/api/console/products');
    expect(storeBList.status).toBe(200);
    expect(await storeBList.json()).toEqual({ products: [] });

    const crossedDetail = await requestAs(ownerB, '/api/console/products/by-slug/field-notes');
    expect(crossedDetail.status).toBe(404);
    const crossedUpdate = await requestAs(ownerB, `/api/console/products/${productA.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' },
      body: JSON.stringify({ product: SIMPLE_CORE, optionLabels: { groups: [] }, variantEdits: [] }),
    });
    expect(crossedUpdate.status).toBe(404);
    const crossedInvalidRevision = await requestAs(ownerB, `/api/console/products/${productA.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': 'invalid' }, body: '{}',
    });
    expect(crossedInvalidRevision.status).toBe(404);
    const crossedPreview = await requestAs(ownerB, '/api/console/products/schema/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' },
      body: JSON.stringify({
        productId: productA.id, productSlug: 'field-notes', product: SIMPLE_CORE, schema: oneVariantSchema(),
      }),
    });
    expect(crossedPreview.status).toBe(404);
    const crossedFile = await requestAs(ownerB, `/api/console/products/${productA.id}/delivery-file`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream', 'If-Match': 'invalid', 'X-Nexus-Filename': 'crossed.pdf',
      },
      body: new TextEncoder().encode('%PDF-crossed'),
    });
    expect(crossedFile.status).toBe(404);
    expect((await env.FILES.list()).objects).toHaveLength(0);

    const staffCreate = await requestAs(staffA, '/api/console/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: createBody('Staff Product'),
    });
    expect(staffCreate.status).toBe(403);
    expect(await staffCreate.json()).toMatchObject({ error: { code: 'forbidden' } });
    const staffPreview = await requestAs(staffA, '/api/console/products/schema/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(staffPreview.status).toBe(403);
    const staffImport = await requestAs(staffA, '/api/console/imports', {
      method: 'POST',
      headers: { 'Content-Type': CSV_CONTENT_TYPE, [CSV_FILENAME_HEADER]: encodeURIComponent('staff.csv') },
      body: CSV_TEMPLATE,
    });
    expect(staffImport.status).toBe(403);
    const staffFile = await requestAs(staffA, `/api/console/products/${productA.id}/delivery-file`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream', 'If-Match': '"1"', 'X-Nexus-Filename': 'staff.pdf',
      },
      body: new TextEncoder().encode('%PDF-staff'),
    });
    expect(staffFile.status).toBe(403);
    expect((await env.FILES.list()).objects).toHaveLength(0);

    const createdB = await requestAs(ownerB, '/api/console/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: createBody(),
    });
    expect(createdB.status).toBe(201);

    const rows = await env.DB.prepare(
      'SELECT store_id AS storeId, slug FROM products ORDER BY store_id',
    ).all<{ storeId: string; slug: string }>();
    expect(rows.results).toEqual([
      { storeId: 'store_b', slug: 'field-notes' },
      { storeId: 'store_nexus', slug: 'field-notes' },
    ]);

    const importedB = await requestAs(ownerB, '/api/console/imports', {
      method: 'POST',
      headers: {
        'Content-Type': CSV_CONTENT_TYPE,
        [CSV_FILENAME_HEADER]: encodeURIComponent('store-b.csv'),
      },
      body: CSV_TEMPLATE,
    });
    expect(importedB.status).toBe(200);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM imports WHERE store_id='store_b'",
    ).first<number>('count')).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM imports WHERE store_id='store_nexus'",
    ).first<number>('count')).toBe(0);
  });

  it('does not consume a Staff mutation body', async () => {
    const staff = await createConsoleSession({ email: 'staff-body@example.test', name: 'Staff Body', role: 'staff' });
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(createBody('Unread Staff Product')));
        controller.close();
      },
    });
    const request = new Request(`${TEST_CONSOLE_ORIGIN}/api/console/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Cookie: staff.cookie, Origin: TEST_CONSOLE_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      },
      body,
    });
    expect(request.bodyUsed).toBe(false);
    const response = await worker.fetch(request, {
      DB: env.DB, FILES: env.FILES, STOREFRONT_ORIGIN: TEST_STOREFRONT_ORIGIN,
      CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, BETTER_AUTH_SECRET: TEST_BETTER_AUTH_SECRET,
      ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } as unknown as Fetcher,
    });
    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM products').first<number>('count')).toBe(0);
  });

  it('rolls back a create when Owner membership is revoked at the batch boundary', async () => {
    const identity = await getConsoleIdentity();
    await expect(createProduct(revokingDatabase(identity), identity, {
      product: SIMPLE_CORE, schema: null, previewHash: null,
    })).rejects.toThrow();
    expect(await env.DB.prepare('SELECT count(*) AS count FROM products').first<number>('count')).toBe(0);
  });

  it('rolls back update, import, upload, and removal after commit-time revocation', async () => {
    const identity = await getConsoleIdentity();
    const product = await createProduct(env.DB, identity, {
      product: SIMPLE_CORE, schema: null, previewHash: null,
    });

    await expect(updateProductNonstructural(revokingDatabase(identity), identity, product.id, 1, {
      product: { ...SIMPLE_CORE, name: 'Revoked Update' },
      optionLabels: { groups: [] },
      variantEdits: [],
    })).rejects.toThrow();
    expect(await env.DB.prepare('SELECT name FROM products WHERE id=?').bind(product.id).first<string>('name')).toBe('Field Notes');
    expect(await env.DB.prepare('SELECT revision FROM products WHERE id=?').bind(product.id).first<number>('revision')).toBe(1);

    await env.DB.prepare(
      "UPDATE store_memberships SET status='active', revoked_at=NULL WHERE id=?",
    ).bind(identity.membershipId).run();
    const schema = oneVariantSchema();
    await expect(applyProductSchema(revokingDatabase(identity), identity, product.id, 1, {
      product: SIMPLE_CORE, schema, previewHash: await schemaPreviewHash(SIMPLE_CORE, schema),
    })).rejects.toThrow();
    expect(await env.DB.prepare('SELECT count(*) AS count FROM product_variants WHERE product_id=?')
      .bind(product.id).first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT revision FROM products WHERE id=?').bind(product.id).first<number>('revision')).toBe(1);

    await env.DB.prepare(
      "UPDATE store_memberships SET status='active', revoked_at=NULL WHERE id=?",
    ).bind(identity.membershipId).run();
    await expect(putDeliveryFile({
      db: revokingDatabase(identity), files: env.FILES, identity,
      productId: product.id, variantId: null, expectedRevision: 1,
      filename: 'revoked.pdf', body: new Blob(['%PDF-revoked']).stream(), declaredLength: null,
    })).rejects.toBeInstanceOf(CatalogReadAccessError);
    expect((await env.FILES.list()).objects).toHaveLength(0);
    expect(await env.DB.prepare('SELECT revision FROM products WHERE id=?').bind(product.id).first<number>('revision')).toBe(1);

    await env.DB.prepare(
      "UPDATE store_memberships SET status='active', revoked_at=NULL WHERE id=?",
    ).bind(identity.membershipId).run();
    await putDeliveryFile({
      db: env.DB, files: env.FILES, identity,
      productId: product.id, variantId: null, expectedRevision: 1,
      filename: 'retained.pdf', body: new Blob(['%PDF-retained']).stream(), declaredLength: null,
    });
    const retainedKey = await env.DB.prepare('SELECT delivery_file_key FROM products WHERE id=?')
      .bind(product.id).first<string>('delivery_file_key');
    await expect(deleteDeliveryFile({
      db: revokingDatabase(identity), identity, productId: product.id, variantId: null, expectedRevision: 2,
    })).rejects.toBeInstanceOf(CatalogReadAccessError);
    expect(await env.DB.prepare('SELECT delivery_file_key FROM products WHERE id=?')
      .bind(product.id).first<string>('delivery_file_key')).toBe(retainedKey);
    await expect(env.FILES.get(retainedKey ?? '')).resolves.not.toBeNull();

    await env.DB.prepare(
      "UPDATE store_memberships SET status='active', revoked_at=NULL WHERE id=?",
    ).bind(identity.membershipId).run();
    const rejectedOnly = CSV_TEMPLATE.replaceAll(',active,', ',Active,').replaceAll(',draft,', ',Draft,');
    await expect(executeCsvImport({
      database: revokingDatabase(identity), files: env.FILES, identity,
      filename: 'rejected-only.csv', bytes: new TextEncoder().encode(rejectedOnly), confirmedVariants: false,
    })).rejects.toMatchObject({ code: 'store_access_denied' });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM imports').first<number>('count')).toBe(0);
    expect((await env.FILES.list({ prefix: 'imports/' })).objects).toHaveLength(0);
  });

  it('denies a read revoked at query time and withholds a committed write result after revocation', async () => {
    const identity = await getConsoleIdentity();
    await createProduct(env.DB, identity, { product: SIMPLE_CORE, schema: null, previewHash: null });
    let revoked = false;
    const revoke = async () => {
      if (revoked) return;
      revoked = true;
      await env.DB.prepare(
        "UPDATE store_memberships SET status='revoked', revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?",
      ).bind(identity.membershipId).run();
    };
    const revokeOnCatalogRead = {
      prepare: (query: string) => {
        const statement = env.DB.prepare(query);
        if (!query.includes('FROM products p')) return statement;
        return {
          bind: (...values: unknown[]) => ({
            all: async <T>() => {
              await revoke();
              return statement.bind(...values).all<T>();
            },
          }),
        } as unknown as D1PreparedStatement;
      },
    } as unknown as D1Database;
    await expect(listProducts(revokeOnCatalogRead, identity, '', 'all')).rejects.toBeInstanceOf(CatalogReadAccessError);

    await env.DB.prepare(
      "UPDATE store_memberships SET status='active', revoked_at=NULL WHERE id=?",
    ).bind(identity.membershipId).run();
    const revokeAfterCommit = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: async (statements: D1PreparedStatement[]) => {
        const result = await env.DB.batch(statements);
        await env.DB.prepare(
          "UPDATE store_memberships SET status='revoked', revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?",
        ).bind(identity.membershipId).run();
        return result;
      },
    } as unknown as D1Database;
    await expect(createProduct(revokeAfterCommit, identity, {
      product: { ...SIMPLE_CORE, name: 'Committed Hidden Result' }, schema: null, previewHash: null,
    })).rejects.toBeInstanceOf(CatalogReadAccessError);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM products WHERE name='Committed Hidden Result'")
      .first<number>('count')).toBe(1);
  });
});
