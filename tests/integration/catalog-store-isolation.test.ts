import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConsoleSession, TEST_CONSOLE_ORIGIN } from '../support/identity-test-env';
import { applyProductSchema, createProduct, updateProductNonstructural } from '@nexus/catalog/catalog-write';
import { CatalogReadAccessError, listProducts } from '@nexus/catalog/catalog-read';
import { schemaPreviewHash } from '@nexus/catalog/schema-change';
import { deleteDeliveryFile, putDeliveryFile } from '@nexus/catalog/files/delivery-file';
import { executeCsvImport } from '@nexus/catalog/import/import-command';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';
import type { ProductDetailResponse } from '@nexus/catalog/catalog-types';
import worker from '../../apps/worker/src';
import {
  getConsoleIdentity, oneVariantSchema, resetCatalog, SIMPLE_CORE, TEST_STOREFRONT_ORIGIN, workerRequest,
} from '../support/catalog-test-env';
import { TEST_BETTER_AUTH_SECRET } from '../support/identity-test-env';
import { CSV_CONTENT_TYPE, CSV_FILENAME, CSV_FILENAME_HEADER, CSV_TEMPLATE } from '@nexus/catalog/shared/csv-contract';

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

function losingOwnerDatabase(identity: ConsoleIdentityContext, change: 'revocation' | 'demotion'): D1Database {
  return {
    prepare: env.DB.prepare.bind(env.DB),
    batch: async (statements: D1PreparedStatement[]) => {
      await env.DB.prepare(
        change === 'demotion'
          ? "UPDATE store_memberships SET role='staff' WHERE id=?"
          : "UPDATE store_memberships SET status='revoked', revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?",
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
    const staffTemplate = await requestAs(staffA, '/api/console/imports/template');
    expect(staffTemplate.status).toBe(403);
    expect(await staffTemplate.json()).toMatchObject({ error: { code: 'forbidden' } });
    const ownerTemplate = await requestAs(ownerA, '/api/console/imports/template');
    expect(ownerTemplate.status).toBe(200);
    expect(ownerTemplate.headers.get('Content-Type')).toBe(CSV_CONTENT_TYPE);
    expect(ownerTemplate.headers.get('Content-Disposition')).toBe(`attachment; filename="${CSV_FILENAME}"`);
    expect(await ownerTemplate.text()).toBe(CSV_TEMPLATE);
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

  it('isolates known foreign Variant IDs while equal Store-local slugs and SKUs coexist', async () => {
    const ownerA = await createConsoleSession({ email: 'variant-owner-a@example.test' });
    const ownerB = await createConsoleSession({ email: 'variant-owner-b@example.test', storeId: 'store_b' });
    const staffB = await createConsoleSession({ email: 'variant-staff-b@example.test', storeId: 'store_b', role: 'staff' });
    const schema = oneVariantSchema();
    const products: ProductDetailResponse[] = [];
    for (const [session, privateText] of [[ownerA, 'Private Store A Variant evidence'], [ownerB, 'Private Store B Variant evidence']] as const) {
      const product = { ...SIMPLE_CORE, delivery: { accessTitle: 'Package', accessInstructions: privateText } };
      const created = await requestAs(session, '/api/console/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product, schema, previewHash: await schemaPreviewHash(product, schema) }) });
      expect(created.status).toBe(201);
      products.push((await created.json() as { product: ProductDetailResponse }).product);
    }
    const [productA, productB] = products;
    expect(productA.slug).toBe(productB.slug);
    expect(productA.variants[0].sku).toBe(productB.variants[0].sku);
    const foreignId = productA.variants[0].id;
    const coreB = { ...SIMPLE_CORE, delivery: { accessTitle: productB.delivery.accessTitle, accessInstructions: productB.delivery.accessInstructions } };
    const schemaB = {
      ...schema,
      groups: productB.optionGroups.map(group => ({ ...group, draftRef: group.id, values: group.values.map(value => ({ ...value, draftRef: value.id })) })),
      rows: schema.rows.map(row => ({ ...row, id: foreignId, selectedValueRefs: productB.optionGroups.flatMap(group => group.values.map(value => value.id)) })),
    };
    const labels = { groups: productB.optionGroups.map(group => ({ id: group.id, name: group.name, values: group.values.map(value => ({ id: value.id, label: value.label })) })) };
    const headers = { 'Content-Type': 'application/json', 'If-Match': '"1"' };
    const crossedCsv = CSV_TEMPLATE.trimEnd().split('\n').map((line, index) => `${line},${index === 0 ? 'variant_id' : foreignId}`).join('\n');
    const cases: Array<{ path: string; init: RequestInit; ownerStatus: number; staffStatus: number }> = [
      { path: `/api/console/products/${productA.id}/schema`, init: { method: 'PUT', headers, body: JSON.stringify({ product: coreB, schema: schemaB, previewHash: await schemaPreviewHash(coreB, schemaB) }) }, ownerStatus: 404, staffStatus: 404 },
      { path: '/api/console/products/schema/preview', init: { method: 'POST', headers, body: JSON.stringify({ productId: productA.id, productSlug: productA.slug, product: coreB, schema: schemaB }) }, ownerStatus: 404, staffStatus: 403 },
      { path: '/api/console/products/schema/preview', init: { method: 'POST', headers, body: JSON.stringify({ productId: productB.id, productSlug: productB.slug, product: coreB, schema: schemaB }) }, ownerStatus: 409, staffStatus: 403 },
      { path: `/api/console/products/${productB.id}/schema`, init: { method: 'PUT', headers, body: JSON.stringify({ product: coreB, schema: schemaB, previewHash: await schemaPreviewHash(coreB, schemaB) }) }, ownerStatus: 409, staffStatus: 403 },
      { path: `/api/console/products/${productB.id}`, init: { method: 'PUT', headers, body: JSON.stringify({ product: coreB, optionLabels: labels, variantEdits: [{ id: foreignId, sku: schema.rows[0].sku, status: 'enabled', priceOverride: null, delivery: { source: 'product_default' } }] }) }, ownerStatus: 422, staffStatus: 403 },
      { path: '/api/console/products', init: { method: 'POST', headers, body: JSON.stringify({ product: coreB, schema: schemaB, previewHash: await schemaPreviewHash(coreB, schemaB) }) }, ownerStatus: 422, staffStatus: 403 },
      { path: '/api/console/imports', init: { method: 'POST', headers: { 'Content-Type': CSV_CONTENT_TYPE, [CSV_FILENAME_HEADER]: 'foreign-variant.csv' }, body: crossedCsv }, ownerStatus: 400, staffStatus: 403 },
    ];
    for (const product of [productA, productB]) {
      for (const method of ['PUT', 'DELETE']) cases.push({
        path: `/api/console/products/${product.id}/variants/${foreignId}/delivery-file`,
        init: { method, headers: { 'Content-Type': 'application/octet-stream', 'If-Match': '"1"', 'X-Nexus-Filename': 'foreign.pdf' }, ...(method === 'PUT' ? { body: new TextEncoder().encode('%PDF-foreign') } : {}) },
        ownerStatus: 404, staffStatus: product.id === productA.id ? 404 : 403,
      });
    }
    for (const entry of cases) {
      for (const [session, expected] of [[ownerB, entry.ownerStatus], [staffB, entry.staffStatus]] as const) {
        const response = await requestAs(session, entry.path, entry.init);
        expect(response.status, `${entry.init.method} ${entry.path}`).toBe(expected);
        expect(await response.text()).not.toContain('Private Store A Variant evidence');
      }
    }
    const ownSlug = await requestAs(ownerB, `/api/console/products/by-slug/${productA.slug}`);
    expect(await ownSlug.json()).toEqual(productB);
    expect(await (await requestAs(ownerA, `/api/console/products/by-slug/${productA.slug}`)).json()).toEqual(productA);
    expect((await env.FILES.list()).objects).toHaveLength(0);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM imports').first<number>('count')).toBe(0);
    await expect(env.DB.prepare(
      "INSERT INTO product_variants (id,store_id,product_id,combination_key,sku,status,current_schema,delivery_source) VALUES (?,'store_b',?,'collision','COLLISION','disabled',0,'product_default')",
    ).bind(foreignId, productB.id).run()).rejects.toThrow(/UNIQUE constraint failed: product_variants.id/);
    expect(await env.DB.prepare('SELECT store_id FROM product_variants WHERE id=?').bind(foreignId).first<string>('store_id')).toBe('store_nexus');
    expect(await env.DB.prepare('SELECT count(*) AS count FROM product_variants').first<number>('count')).toBe(2);
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

  it.each(['revocation', 'demotion'] as const)('rolls back a create after Owner %s at the batch boundary', async (change) => {
    const identity = await getConsoleIdentity();
    await expect(createProduct(losingOwnerDatabase(identity, change), identity, {
      product: SIMPLE_CORE, schema: null, previewHash: null,
    })).rejects.toThrow();
    expect(await env.DB.prepare('SELECT count(*) AS count FROM products').first<number>('count')).toBe(0);
  });

  it.each(['revocation', 'demotion'] as const)('rolls back update, import, upload, and removal after commit-time %s', async (change) => {
    const identity = await getConsoleIdentity();
    const product = await createProduct(env.DB, identity, {
      product: SIMPLE_CORE, schema: null, previewHash: null,
    });

    await expect(updateProductNonstructural(losingOwnerDatabase(identity, change), identity, product.id, 1, {
      product: { ...SIMPLE_CORE, name: 'Revoked Update' },
      optionLabels: { groups: [] },
      variantEdits: [],
    })).rejects.toThrow();
    expect(await env.DB.prepare('SELECT name FROM products WHERE id=?').bind(product.id).first<string>('name')).toBe('Field Notes');
    expect(await env.DB.prepare('SELECT revision FROM products WHERE id=?').bind(product.id).first<number>('revision')).toBe(1);

    await env.DB.prepare(
      "UPDATE store_memberships SET role='owner', status='active', revoked_at=NULL WHERE id=?",
    ).bind(identity.membershipId).run();
    const schema = oneVariantSchema();
    await expect(applyProductSchema(losingOwnerDatabase(identity, change), identity, product.id, 1, {
      product: SIMPLE_CORE, schema, previewHash: await schemaPreviewHash(SIMPLE_CORE, schema),
    })).rejects.toThrow();
    expect(await env.DB.prepare('SELECT count(*) AS count FROM product_variants WHERE product_id=?')
      .bind(product.id).first<number>('count')).toBe(0);
    expect(await env.DB.prepare('SELECT revision FROM products WHERE id=?').bind(product.id).first<number>('revision')).toBe(1);

    await env.DB.prepare(
      "UPDATE store_memberships SET role='owner', status='active', revoked_at=NULL WHERE id=?",
    ).bind(identity.membershipId).run();
    await expect(putDeliveryFile({
      db: losingOwnerDatabase(identity, change), files: env.FILES, identity,
      productId: product.id, variantId: null, expectedRevision: 1,
      filename: 'revoked.pdf', body: new Blob(['%PDF-revoked']).stream(), declaredLength: null,
    })).rejects.toBeInstanceOf(CatalogReadAccessError);
    expect((await env.FILES.list()).objects).toHaveLength(0);
    expect(await env.DB.prepare('SELECT revision FROM products WHERE id=?').bind(product.id).first<number>('revision')).toBe(1);

    await env.DB.prepare(
      "UPDATE store_memberships SET role='owner', status='active', revoked_at=NULL WHERE id=?",
    ).bind(identity.membershipId).run();
    await putDeliveryFile({
      db: env.DB, files: env.FILES, identity,
      productId: product.id, variantId: null, expectedRevision: 1,
      filename: 'retained.pdf', body: new Blob(['%PDF-retained']).stream(), declaredLength: null,
    });
    const retainedKey = await env.DB.prepare('SELECT delivery_file_key FROM products WHERE id=?')
      .bind(product.id).first<string>('delivery_file_key');
    await expect(deleteDeliveryFile({
      db: losingOwnerDatabase(identity, change), identity, productId: product.id, variantId: null, expectedRevision: 2,
    })).rejects.toBeInstanceOf(CatalogReadAccessError);
    expect(await env.DB.prepare('SELECT delivery_file_key FROM products WHERE id=?')
      .bind(product.id).first<string>('delivery_file_key')).toBe(retainedKey);
    await expect(env.FILES.get(retainedKey ?? '')).resolves.not.toBeNull();

    await env.DB.prepare(
      "UPDATE store_memberships SET role='owner', status='active', revoked_at=NULL WHERE id=?",
    ).bind(identity.membershipId).run();
    const rejectedOnly = CSV_TEMPLATE.replaceAll(',active,', ',Active,').replaceAll(',draft,', ',Draft,');
    await expect(executeCsvImport({
      database: losingOwnerDatabase(identity, change), files: env.FILES, identity,
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
