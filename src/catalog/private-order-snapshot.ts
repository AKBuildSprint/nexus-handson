import type { OrderItemCatalogResolution, OrderItemCatalogSnapshot } from './catalog-types';
import { CatalogValidationError } from './catalog-types';

interface SnapshotProductRow {
  id: string;
  name: string;
  product_type: 'simple' | 'variant';
  currency: string;
  base_price_minor: number;
  delivery_access_title: string;
  delivery_access_instructions: string;
  delivery_file_key: string | null;
  revision: number;
}

interface SnapshotVariantRow {
  id: string;
  product_id: string;
  sku: string;
  price_override_minor: number | null;
  delivery_source: 'product_default' | 'variant_override';
  delivery_access_title: string | null;
  delivery_access_instructions: string | null;
  delivery_file_key: string | null;
}

interface SelectedOptionRow {
  productId: string;
  variantId: string;
  groupId: string;
  groupName: string;
  valueId: string;
  valueLabel: string;
}

interface RequiredGroupCountRow {
  productId: string;
  count: number;
}

export interface OrderItemCatalogSelection {
  productId: string;
  variantId: string | null;
}

function simpleSnapshot(product: SnapshotProductRow): OrderItemCatalogResolution {
  return {
    productRevision: product.revision,
    snapshot: {
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
    },
  };
}

function variantSnapshot(
  product: SnapshotProductRow,
  variant: SnapshotVariantRow,
  selectedOptions: OrderItemCatalogSnapshot['selectedOptions'],
): OrderItemCatalogResolution {
  const inherited = variant.delivery_source === 'product_default';
  return {
    productRevision: product.revision,
    snapshot: {
      productId: product.id,
      productName: product.name,
      variantId: variant.id,
      variantSku: variant.sku,
      selectedOptions: selectedOptions.map((option) => ({ ...option })),
      unitPriceMinor: variant.price_override_minor ?? product.base_price_minor,
      currency: product.currency,
      accessTitle: inherited ? product.delivery_access_title : variant.delivery_access_title ?? '',
      accessInstructions: inherited ? product.delivery_access_instructions : variant.delivery_access_instructions ?? '',
      privateFileKey: inherited ? product.delivery_file_key : variant.delivery_file_key,
    },
  };
}

export async function resolveOrderItemCatalogSnapshots(input: {
  database: D1Database;
  storeId: string;
  items: OrderItemCatalogSelection[];
}): Promise<OrderItemCatalogResolution[]> {
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const variantIds = [...new Set(input.items.flatMap((item) => item.variantId === null ? [] : [item.variantId]))];
  const payload = JSON.stringify({
    storeId: input.storeId,
    productIds,
    variantIds,
  });

  const [productResult, variantResult, selectedResult, groupCountResult] = await input.database.batch([
    input.database.prepare(
      `WITH input(payload) AS (VALUES (?))
       SELECT products.id, products.name, products.product_type, products.currency, products.base_price_minor,
              products.delivery_access_title, products.delivery_access_instructions, products.delivery_file_key,
              products.revision
         FROM products, input
        WHERE products.store_id = json_extract(input.payload, '$.storeId')
          AND products.status = 'active'
          AND products.id IN (SELECT value FROM json_each(input.payload, '$.productIds'))`,
    ).bind(payload),
    input.database.prepare(
      `WITH input(payload) AS (VALUES (?))
       SELECT product_variants.id, product_variants.product_id, product_variants.sku,
              product_variants.price_override_minor, product_variants.delivery_source,
              product_variants.delivery_access_title, product_variants.delivery_access_instructions,
              product_variants.delivery_file_key
         FROM product_variants, input
        WHERE product_variants.store_id = json_extract(input.payload, '$.storeId')
          AND product_variants.current_schema = 1
          AND product_variants.status = 'enabled'
          AND product_variants.id IN (SELECT value FROM json_each(input.payload, '$.variantIds'))`,
    ).bind(payload),
    input.database.prepare(
      `WITH input(payload) AS (VALUES (?))
       SELECT m.product_id AS productId, m.variant_id AS variantId,
              g.id AS groupId, g.name AS groupName, v.id AS valueId, v.label AS valueLabel
         FROM product_variant_values m
         JOIN product_option_groups g
           ON g.id = m.group_id AND g.product_id = m.product_id AND g.store_id = m.store_id
         JOIN product_option_values v
           ON v.id = m.value_id AND v.group_id = m.group_id AND v.product_id = m.product_id AND v.store_id = m.store_id
         JOIN input
        WHERE m.store_id = json_extract(input.payload, '$.storeId')
          AND m.variant_id IN (SELECT value FROM json_each(input.payload, '$.variantIds'))
          AND g.active = 1 AND g.participating = 1 AND v.active = 1
        ORDER BY g.position, g.id`,
    ).bind(payload),
    input.database.prepare(
      `WITH input(payload) AS (VALUES (?))
       SELECT product_option_groups.product_id AS productId, count(*) AS count
         FROM product_option_groups, input
        WHERE product_option_groups.store_id = json_extract(input.payload, '$.storeId')
          AND product_option_groups.active = 1
          AND product_option_groups.participating = 1
          AND product_option_groups.product_id IN (SELECT value FROM json_each(input.payload, '$.productIds'))
        GROUP BY product_option_groups.product_id`,
    ).bind(payload),
  ]);

  const products = new Map((productResult.results as SnapshotProductRow[]).map((row) => [row.id, row]));
  const variants = new Map((variantResult.results as SnapshotVariantRow[]).map((row) => [row.id, row]));
  const selectedByVariant = new Map<string, OrderItemCatalogSnapshot['selectedOptions']>();
  for (const row of selectedResult.results as SelectedOptionRow[]) {
    const options = selectedByVariant.get(row.variantId) ?? [];
    options.push({
      groupId: row.groupId,
      groupName: row.groupName,
      valueId: row.valueId,
      valueLabel: row.valueLabel,
    });
    selectedByVariant.set(row.variantId, options);
  }
  const requiredGroups = new Map(
    (groupCountResult.results as RequiredGroupCountRow[]).map((row) => [row.productId, row.count]),
  );

  const revisions = new Map<string, number>();
  return input.items.map((item) => {
    const product = products.get(item.productId);
    if (!product) {
      throw new CatalogValidationError('product_not_found', 'Product not found.', [], 404);
    }
    const captured = revisions.get(product.id);
    if (captured !== undefined && captured !== product.revision) {
      throw new CatalogValidationError(
        'catalog_revision_conflict',
        'The Product changed while the Order was being created.',
        [],
        409,
      );
    }
    revisions.set(product.id, product.revision);

    if (product.product_type === 'simple') {
      if (item.variantId !== null) {
        throw new CatalogValidationError('variant_not_found', 'A simple Product does not accept a Variant selection.', [], 404);
      }
      return {
        productRevision: product.revision,
        snapshot: { ...simpleSnapshot(product).snapshot, selectedOptions: [] },
      };
    }
    if (item.variantId === null) {
      throw new CatalogValidationError('variant_not_found', 'A Variant selection is required.', [], 404);
    }
    const variant = variants.get(item.variantId);
    if (!variant || variant.product_id !== product.id) {
      throw new CatalogValidationError('variant_not_found', 'Variant not found.', [], 404);
    }
    const selected = selectedByVariant.get(variant.id) ?? [];
    const required = requiredGroups.get(product.id) ?? 0;
    if (selected.length === 0 || selected.length !== required) {
      throw new CatalogValidationError('variant_not_found', 'Variant selection is incomplete.', [], 404);
    }
    return variantSnapshot(product, variant, selected);
  });
}
