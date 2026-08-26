import type { OrderItemCatalogSnapshot } from './catalog-types';
import { CatalogValidationError } from './catalog-types';
import { BOOTSTRAP_STORE_ID } from './catalog-read';

interface SnapshotProductRow {
  id: string;
  name: string;
  product_type: 'simple' | 'variant';
  currency: string;
  base_price_minor: number;
  delivery_access_title: string;
  delivery_access_instructions: string;
  delivery_file_key: string | null;
}

interface SnapshotVariantRow {
  id: string;
  sku: string;
  price_override_minor: number | null;
  delivery_source: 'product_default' | 'variant_override';
  delivery_access_title: string | null;
  delivery_access_instructions: string | null;
  delivery_file_key: string | null;
}

export type ResolveOrderItemCatalogSnapshot = (
  input: { productId: string; variantId: string | null },
) => Promise<OrderItemCatalogSnapshot>;

export function createOrderItemCatalogSnapshotResolver(db: D1Database): ResolveOrderItemCatalogSnapshot {
  return function resolveOrderItemCatalogSnapshot(input) {
    return resolveSnapshot(input, db);
  };
}

async function resolveSnapshot(
  input: { productId: string; variantId: string | null },
  db: D1Database,
): Promise<OrderItemCatalogSnapshot> {
  const product = await db.prepare(
    `SELECT id, name, product_type, currency, base_price_minor,
            delivery_access_title, delivery_access_instructions, delivery_file_key
       FROM products
      WHERE store_id = ? AND id = ? AND status = 'active'`,
  ).bind(BOOTSTRAP_STORE_ID, input.productId).first<SnapshotProductRow>();
  if (!product) {
    throw new CatalogValidationError('product_not_found', 'Product not found.', [], 404);
  }
  if (product.product_type === 'simple') {
    if (input.variantId !== null) {
      throw new CatalogValidationError('variant_not_found', 'A simple Product does not accept a Variant selection.', [], 404);
    }
    return {
      productId: product.id,
      productName: product.name,
      variantId: null,
      variantSku: null,
      selectedOptions: [],
      unitPriceMinor: product.base_price_minor,
      currency: product.currency,
      accessTitle: product.delivery_access_title,
      accessInstructions: product.delivery_access_instructions,
      privateFileKey: product.delivery_file_key,
    };
  }
  if (input.variantId === null) {
    throw new CatalogValidationError('variant_not_found', 'A Variant selection is required.', [], 404);
  }
  const variant = await db.prepare(
    `SELECT id, sku, price_override_minor, delivery_source, delivery_access_title,
            delivery_access_instructions, delivery_file_key
       FROM product_variants
      WHERE store_id = ? AND product_id = ? AND id = ? AND current_schema = 1 AND status = 'enabled'`,
  ).bind(BOOTSTRAP_STORE_ID, product.id, input.variantId).first<SnapshotVariantRow>();
  if (!variant) {
    throw new CatalogValidationError('variant_not_found', 'Variant not found.', [], 404);
  }
  const selected = await db.prepare(
    `SELECT g.id AS groupId, g.name AS groupName, v.id AS valueId, v.label AS valueLabel
       FROM product_variant_values m
       JOIN product_option_groups g
         ON g.id = m.group_id AND g.product_id = m.product_id AND g.store_id = m.store_id
       JOIN product_option_values v
         ON v.id = m.value_id AND v.group_id = m.group_id AND v.product_id = m.product_id AND v.store_id = m.store_id
      WHERE m.store_id = ? AND m.product_id = ? AND m.variant_id = ?
        AND g.active = 1 AND g.participating = 1 AND v.active = 1
      ORDER BY g.position, g.id`,
  ).bind(BOOTSTRAP_STORE_ID, product.id, variant.id).all<OrderItemCatalogSnapshot['selectedOptions'][number]>();
  const requiredGroupCount = await db.prepare(
    'SELECT count(*) AS count FROM product_option_groups WHERE store_id = ? AND product_id = ? AND active = 1 AND participating = 1',
  ).bind(BOOTSTRAP_STORE_ID, product.id).first<{ count: number }>();
  if (selected.results.length === 0 || selected.results.length !== requiredGroupCount?.count) {
    throw new CatalogValidationError('variant_not_found', 'Variant selection is incomplete.', [], 404);
  }
  const inherited = variant.delivery_source === 'product_default';
  return {
    productId: product.id,
    productName: product.name,
    variantId: variant.id,
    variantSku: variant.sku,
    selectedOptions: selected.results.map((option) => ({ ...option })),
    unitPriceMinor: variant.price_override_minor ?? product.base_price_minor,
    currency: product.currency,
    accessTitle: inherited ? product.delivery_access_title : variant.delivery_access_title ?? '',
    accessInstructions: inherited ? product.delivery_access_instructions : variant.delivery_access_instructions ?? '',
    privateFileKey: inherited ? product.delivery_file_key : variant.delivery_file_key,
  };
}
