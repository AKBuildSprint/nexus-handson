import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SchemaDraft } from '../../src/shared/schema-draft-refs';
import { resetCatalog, VARIANT_CORE, oneVariantSchema, workerRequest } from '../support/catalog-test-env';

beforeEach(resetCatalog);

describe('Product create schema contract', () => {
  it('previews without writes, rejects a stale hash with zero writes, then maps refs to stable IDs', async () => {
    const schema = oneVariantSchema();
    const preview = await workerRequest('/api/console/products/schema/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: null, productSlug: 'focus-pack', product: VARIANT_CORE, schema }),
    });
    expect(preview.status).toBe(200);
    const previewBody = await preview.json() as { previewHash: string; rows: Array<{ variantId: null }> };
    expect(previewBody.rows[0].variantId).toBeNull();
    expect(await env.DB.prepare('SELECT count(*) AS count FROM products').first<number>('count')).toBe(0);

    const stale = await workerRequest('/api/console/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: VARIANT_CORE, schema, previewHash: 'stale' }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: 'schema_preview_stale' } });
    expect(await env.DB.prepare('SELECT count(*) AS count FROM products').first<number>('count')).toBe(0);

    const created = await workerRequest('/api/console/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: VARIANT_CORE, schema, previewHash: previewBody.previewHash }),
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { product: { optionGroups: Array<{ id: string; values: Array<{ id: string }> }>; variants: Array<{ id: string }> } };
    expect(body.product.optionGroups[0].id).toMatch(/^grp_/);
    expect(body.product.optionGroups[0].values[0].id).toMatch(/^val_/);
    expect(body.product.variants[0].id).toMatch(/^var_/);
    const persisted = JSON.stringify((await env.DB.prepare(
      `SELECT g.id AS group_id, v.id AS value_id, pv.id AS variant_id
         FROM product_option_groups g JOIN product_option_values v ON v.group_id=g.id
         JOIN product_variant_values m ON m.value_id=v.id JOIN product_variants pv ON pv.id=m.variant_id`,
    ).all()).results);
    expect(persisted).not.toContain('group-theme');
    expect(persisted).not.toContain('value-dark');
  });

  it('rejects ambiguous Variant ownership before writes', async () => {
    const response = await workerRequest('/api/console/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: { ...VARIANT_CORE, variants: [] }, schema: oneVariantSchema(), previewHash: 'x' }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { fields: [{ code: 'variant_payload_ambiguous' }] } });
  });

  it.each([
    {
      mutate: (schema: SchemaDraft) => {
        schema.groups.push({ ...schema.groups[0], draftRef: 'group-duplicate', id: null, name: ' ＴＨＥＭＥ ', position: 1 });
      },
      path: '/schema/groups/1/name',
      code: 'option_name_duplicate',
    },
    {
      mutate: (schema: SchemaDraft) => {
        schema.groups[0].values.push({ draftRef: 'value-duplicate', id: null, label: ' ＤＡＲＫ ', position: 1 });
      },
      path: '/schema/groups/0/values/1/label',
      code: 'option_value_duplicate',
    },
  ])('rejects normalized duplicate option input with stable fields', async ({ mutate, path, code }) => {
    const schema = oneVariantSchema();
    mutate(schema);
    const response = await workerRequest('/api/console/products/schema/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: null, productSlug: 'focus-pack', product: VARIANT_CORE, schema }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'validation_failed', fields: [{ path, code }] } });
  });
});
