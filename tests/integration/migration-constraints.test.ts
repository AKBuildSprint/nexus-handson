import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyCatalogMigrations, resetCatalog } from '../support/catalog-test-env';

beforeEach(resetCatalog);

async function seedProduct(id: string, storeId = 'store_nexus') {
  await env.DB.prepare('INSERT INTO products (id, store_id, slug, name) VALUES (?, ?, ?, ?)')
    .bind(id, storeId, id, id).run();
}

describe('catalog migration boundaries', () => {
  it('is idempotent and keeps exactly seven domain tables', async () => {
    await applyCatalogMigrations();
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations', '_cf_METADATA') ORDER BY name",
    ).all<{ name: string }>();
    expect(tables.results.map((row) => row.name)).toEqual([
      'imports', 'product_option_groups', 'product_option_values', 'product_variant_values',
      'product_variants', 'products', 'stores',
    ]);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM stores WHERE id='store_nexus' AND slug='nexus'").first<number>('count')).toBe(1);
  });

  it('enforces exact 5 group, 10 value, and 30 current-combination caps', async () => {
    await seedProduct('caps');
    for (let index = 0; index < 5; index += 1) {
      await env.DB.prepare("INSERT INTO product_option_groups (id,store_id,product_id,name,comparison_key,position,active) VALUES (?,'store_nexus','caps',?,?,?,0)")
        .bind(`g${index}`, `G${index}`, `g${index}`, index).run();
      await env.DB.prepare("INSERT INTO product_option_values (id,store_id,product_id,group_id,label,comparison_key,position) VALUES (?,'store_nexus','caps',?,?,?,0)")
        .bind(`seed-v${index}`, `g${index}`, `Seed ${index}`, `seed-${index}`).run();
      await env.DB.prepare('UPDATE product_option_groups SET active=1 WHERE id=?').bind(`g${index}`).run();
    }
    await env.DB.prepare("INSERT INTO product_option_groups (id,store_id,product_id,name,comparison_key,position,active) VALUES ('g5','store_nexus','caps','G5','g5',5,0)").run();
    await env.DB.prepare("INSERT INTO product_option_values (id,store_id,product_id,group_id,label,comparison_key,position) VALUES ('seed-v5','store_nexus','caps','g5','Seed 5','seed-5',0)").run();
    await expect(env.DB.prepare("UPDATE product_option_groups SET active=1 WHERE id='g5'").run()).rejects.toThrow(/option_group_limit_exceeded/);
    for (let index = 1; index < 10; index += 1) {
      await env.DB.prepare("INSERT INTO product_option_values (id,store_id,product_id,group_id,label,comparison_key,position) VALUES (?,'store_nexus','caps','g0',?,?,?)")
        .bind(`v${index}`, `V${index}`, `v${index}`, index).run();
    }
    await expect(env.DB.prepare("INSERT INTO product_option_values (id,store_id,product_id,group_id,label,comparison_key,position) VALUES ('v10','store_nexus','caps','g0','V10','v10',10)").run()).rejects.toThrow(/option_value_limit_exceeded/);
    for (let index = 0; index < 30; index += 1) {
      await env.DB.prepare("INSERT INTO product_variants (id,store_id,product_id,combination_key,sku,status,current_schema) VALUES (?,'store_nexus','caps',?,?,'disabled',1)")
        .bind(`variant${index}`, `key${index}`, `SKU${index}`).run();
    }
    await expect(env.DB.prepare("INSERT INTO product_variants (id,store_id,product_id,combination_key,sku,status,current_schema) VALUES ('variant30','store_nexus','caps','key30','SKU30','disabled',1)").run()).rejects.toThrow(/variant_limit_exceeded/);
  });

  it('rejects cross-Store and cross-Product memberships', async () => {
    await env.DB.prepare("INSERT INTO stores (id,slug,name) VALUES ('other','other','Other')").run();
    await seedProduct('a');
    await seedProduct('b', 'other');
    await env.DB.prepare("INSERT INTO product_option_groups (id,store_id,product_id,name,comparison_key,position,active) VALUES ('ga','store_nexus','a','A','a',0,0)").run();
    await env.DB.prepare("INSERT INTO product_option_values (id,store_id,product_id,group_id,label,comparison_key,position) VALUES ('va','store_nexus','a','ga','A','a',0)").run();
    await env.DB.prepare("INSERT INTO product_variants (id,store_id,product_id,combination_key,sku) VALUES ('vb','other','b','key','SKU-B')").run();
    await expect(env.DB.prepare("INSERT INTO product_variant_values (variant_id,value_id,group_id,product_id,store_id) VALUES ('vb','va','ga','b','other')").run()).rejects.toThrow(/FOREIGN KEY/);
  });

  it('rejects inserting a new participating group beside enabled current Variants', async () => {
    await seedProduct('shape');
    await env.DB.prepare("INSERT INTO product_option_groups (id,store_id,product_id,name,comparison_key,position,active) VALUES ('shape-g','store_nexus','shape','Shape','shape',0,0)").run();
    await env.DB.prepare("INSERT INTO product_option_values (id,store_id,product_id,group_id,label,comparison_key,position) VALUES ('shape-v','store_nexus','shape','shape-g','One','one',0)").run();
    await env.DB.prepare("UPDATE product_option_groups SET active=1 WHERE id='shape-g'").run();
    await env.DB.prepare("INSERT INTO product_variants (id,store_id,product_id,combination_key,sku) VALUES ('shape-var','store_nexus','shape','shape-g:shape-v','SHAPE-ONE')").run();
    await env.DB.prepare("INSERT INTO product_variant_values (variant_id,value_id,group_id,product_id,store_id) VALUES ('shape-var','shape-v','shape-g','shape','store_nexus')").run();
    await env.DB.prepare("UPDATE product_variants SET current_schema=1,status='enabled' WHERE id='shape-var'").run();
    await env.DB.prepare(
      "INSERT INTO product_option_groups (id,store_id,product_id,name,comparison_key,position,active) VALUES ('shape-g2','store_nexus','shape','Second','second',1,0)",
    ).run();
    await env.DB.prepare("INSERT INTO product_option_values (id,store_id,product_id,group_id,label,comparison_key,position) VALUES ('shape-v2','store_nexus','shape','shape-g2','Two','two',0)").run();
    await expect(env.DB.prepare("UPDATE product_option_groups SET active=1 WHERE id='shape-g2'").run()).rejects.toThrow(/matrix_incomplete/);
  });

  it('requires 1..10 values before group activation and protects the last active value', async () => {
    await seedProduct('value-shape');
    await env.DB.prepare(
      "INSERT INTO product_option_groups (id,store_id,product_id,name,comparison_key,position,active) VALUES ('value-g','store_nexus','value-shape','Value','value',0,0)",
    ).run();
    await expect(env.DB.prepare("UPDATE product_option_groups SET active=1 WHERE id='value-g'").run())
      .rejects.toThrow(/option_value_limit_exceeded/);
    await env.DB.prepare(
      "INSERT INTO product_option_values (id,store_id,product_id,group_id,label,comparison_key,position) VALUES ('value-only','store_nexus','value-shape','value-g','Only','only',0)",
    ).run();
    await env.DB.prepare("UPDATE product_option_groups SET active=1 WHERE id='value-g'").run();
    await expect(env.DB.prepare("UPDATE product_option_values SET active=0 WHERE id='value-only'").run())
      .rejects.toThrow(/matrix_incomplete/);
    await expect(env.DB.prepare("DELETE FROM product_option_values WHERE id='value-only'").run())
      .rejects.toThrow(/matrix_incomplete/);
  });

  it('defaults omitted group activity to inactive and rejects explicit active inserts', async () => {
    await seedProduct('group-stage');
    await env.DB.prepare(
      "INSERT INTO product_option_groups (id,store_id,product_id,name,comparison_key,position) VALUES ('staged-default','store_nexus','group-stage','Default','default',0)",
    ).run();
    expect(await env.DB.prepare("SELECT active FROM product_option_groups WHERE id='staged-default'").first<number>('active')).toBe(0);
    await expect(env.DB.prepare(
      "INSERT INTO product_option_groups (id,store_id,product_id,name,comparison_key,position,active) VALUES ('staged-active','store_nexus','group-stage','Active','active',1,1)",
    ).run()).rejects.toThrow(/matrix_incomplete/);
  });
});
