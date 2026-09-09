import type { PublicCatalogResponse } from './catalog-types';
import { BOOTSTRAP_STORE_ID } from './catalog-read';

interface PublicProductRow {
  id: string;
  slug: string;
  name: string;
  product_type: 'simple' | 'variant';
  currency: string;
  base_price_minor: number;
  public_description: string;
}
interface PublicGroupRow { id: string; product_id: string; name: string; position: number }
interface PublicValueRow { id: string; product_id: string; group_id: string; label: string; position: number }
interface PublicVariantRow { id: string; product_id: string; sku: string; price_override_minor: number | null }
interface PublicMembershipRow { variant_id: string; group_id: string; value_id: string }

export async function readPublicCatalog(db: D1Database): Promise<PublicCatalogResponse> {
  const [store, productRows, groupRows, valueRows, variantRows, membershipRows] = await Promise.all([
    db.prepare('SELECT id, slug, name FROM stores WHERE id = ?')
      .bind(BOOTSTRAP_STORE_ID).first<{ id: string; slug: string; name: string }>(),
    db.prepare(
      `SELECT id, slug, name, product_type, currency, base_price_minor, public_description
         FROM products WHERE store_id = ? AND status = 'active'
         ORDER BY updated_at DESC, id ASC`,
    ).bind(BOOTSTRAP_STORE_ID).all<PublicProductRow>(),
    db.prepare(
      `SELECT g.id, g.product_id, g.name, g.position
         FROM product_option_groups g
         JOIN products p ON p.id=g.product_id AND p.store_id=g.store_id
        WHERE g.store_id=? AND g.active=1 AND g.participating=1 AND p.status='active'
        ORDER BY g.product_id, g.position, g.id`,
    ).bind(BOOTSTRAP_STORE_ID).all<PublicGroupRow>(),
    db.prepare(
      `SELECT v.id, v.product_id, v.group_id, v.label, v.position
         FROM product_option_values v
         JOIN product_option_groups g ON g.id=v.group_id AND g.product_id=v.product_id AND g.store_id=v.store_id
         JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
        WHERE v.store_id=? AND v.active=1 AND g.active=1 AND g.participating=1 AND p.status='active'
        ORDER BY v.product_id, v.group_id, v.position, v.id`,
    ).bind(BOOTSTRAP_STORE_ID).all<PublicValueRow>(),
    db.prepare(
      `SELECT v.id, v.product_id, v.sku, v.price_override_minor
         FROM product_variants v
         JOIN products p ON p.id=v.product_id AND p.store_id=v.store_id
        WHERE v.store_id=? AND v.current_schema=1 AND v.status='enabled' AND p.status='active'
        ORDER BY v.product_id, v.id`,
    ).bind(BOOTSTRAP_STORE_ID).all<PublicVariantRow>(),
    db.prepare(
      `SELECT m.variant_id, m.group_id, m.value_id
         FROM product_variant_values m
         JOIN product_variants v ON v.id=m.variant_id AND v.product_id=m.product_id AND v.store_id=m.store_id
         JOIN products p ON p.id=m.product_id AND p.store_id=m.store_id
        WHERE m.store_id=? AND v.current_schema=1 AND v.status='enabled' AND p.status='active'`,
    ).bind(BOOTSTRAP_STORE_ID).all<PublicMembershipRow>(),
  ]);
  if (!store) throw new Error('Bootstrap Store is missing.');

  const groupsByProduct = new Map<string, PublicGroupRow[]>();
  for (const group of groupRows.results) {
    const groups = groupsByProduct.get(group.product_id) ?? [];
    groups.push(group);
    groupsByProduct.set(group.product_id, groups);
  }
  const valuesByGroup = new Map<string, PublicValueRow[]>();
  for (const value of valueRows.results) {
    const values = valuesByGroup.get(value.group_id) ?? [];
    values.push(value);
    valuesByGroup.set(value.group_id, values);
  }
  const variantsByProduct = new Map<string, PublicVariantRow[]>();
  for (const variant of variantRows.results) {
    const variants = variantsByProduct.get(variant.product_id) ?? [];
    variants.push(variant);
    variantsByProduct.set(variant.product_id, variants);
  }
  const membershipsByVariant = new Map<string, PublicMembershipRow[]>();
  for (const membership of membershipRows.results) {
    const memberships = membershipsByVariant.get(membership.variant_id) ?? [];
    memberships.push(membership);
    membershipsByVariant.set(membership.variant_id, memberships);
  }

  const products: PublicCatalogResponse['products'] = [];
  for (const product of productRows.results) {
    if (product.product_type === 'simple') {
      products.push({
        id: product.id, slug: product.slug, name: product.name, currency: product.currency,
        basePriceMinor: product.base_price_minor,
        minimumEffectivePriceMinor: product.base_price_minor,
        maximumEffectivePriceMinor: product.base_price_minor,
        publicDescription: product.public_description,
        optionGroups: [], variants: [],
      });
      continue;
    }
    const variants = variantsByProduct.get(product.id) ?? [];
    if (variants.length === 0) continue;
    const reachableValueIds = new Set(variants.flatMap((variant) =>
      (membershipsByVariant.get(variant.id) ?? []).map((membership) => membership.value_id),
    ));
    const prices = variants.map((variant) => variant.price_override_minor ?? product.base_price_minor);
    products.push({
      id: product.id, slug: product.slug, name: product.name, currency: product.currency,
      basePriceMinor: product.base_price_minor,
      minimumEffectivePriceMinor: Math.min(...prices),
      maximumEffectivePriceMinor: Math.max(...prices),
      publicDescription: product.public_description,
      optionGroups: (groupsByProduct.get(product.id) ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        position: group.position,
        values: (valuesByGroup.get(group.id) ?? [])
          .filter((value) => reachableValueIds.has(value.id))
          .map((value) => ({ id: value.id, label: value.label, position: value.position })),
      })).filter((group) => group.values.length > 0),
      variants: variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        status: 'enabled',
        selectedOptions: (membershipsByVariant.get(variant.id) ?? []).map((membership) => ({
          groupId: membership.group_id,
          valueId: membership.value_id,
        })),
        effectivePriceMinor: variant.price_override_minor ?? product.base_price_minor,
      })),
    });
  }
  return { store: { id: store.id, slug: store.slug, name: store.name }, products };
}
