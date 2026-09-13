import type {
  FileKind,
  PrivateFileSummary,
  ProductDetailResponse,
  ProductListResponse,
  ProductStatus,
  ProductType,
  VariantStatus,
} from './catalog-types';
import { normalizeComparisonKey } from './slug';
import type { ConsoleIdentityContext } from '@nexus/identity/identity-types';

export class CatalogReadAccessError extends Error {
  constructor() {
    super('Current Store membership is required.');
    this.name = 'CatalogReadAccessError';
  }
}

async function assertCurrentMembership(db: D1Database, identity: ConsoleIdentityContext): Promise<void> {
  const active = await db.prepare(
    `SELECT EXISTS (
       SELECT 1 FROM store_memberships
        WHERE id=? AND store_id=? AND user_id=? AND status='active'
     ) AS active`,
  ).bind(identity.membershipId, identity.storeId, identity.userId).first<number>('active');
  if (active !== 1) throw new CatalogReadAccessError();
}

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  product_type: ProductType;
  currency: string;
  base_price_minor: number;
  public_description: string;
  delivery_access_title: string;
  delivery_access_instructions: string;
  delivery_file_filename: string | null;
  delivery_file_size: number | null;
  delivery_file_kind: FileKind | null;
  updated_at: string;
  revision: number;
}

interface GroupRow {
  id: string;
  name: string;
  position: number;
  participating: number;
}

interface ValueRow {
  id: string;
  group_id: string;
  label: string;
  position: number;
}

interface VariantRow {
  id: string;
  combination_key: string;
  sku: string;
  status: VariantStatus;
  price_override_minor: number | null;
  delivery_source: 'product_default' | 'variant_override';
  delivery_access_title: string | null;
  delivery_access_instructions: string | null;
  delivery_file_filename: string | null;
  delivery_file_size: number | null;
  delivery_file_kind: FileKind | null;
}

interface MembershipRow {
  variant_id: string;
  group_id: string;
  value_id: string;
}

function fileSummary(filename: string | null, size: number | null, kind: FileKind | null): PrivateFileSummary {
  return filename !== null && size !== null && kind !== null
    ? { present: true, filename, sizeBytes: size, kind }
    : { present: false };
}

async function productRowBy(
  db: D1Database,
  identity: ConsoleIdentityContext,
  column: 'id' | 'slug',
  target: string,
): Promise<ProductRow | null> {
  return db.prepare(
    `SELECT id, slug, name, status, product_type, currency, base_price_minor,
            public_description, delivery_access_title, delivery_access_instructions,
            delivery_file_filename, delivery_file_size, delivery_file_kind, updated_at, revision
       FROM products
      WHERE store_id = ? AND ${column} = ?
        AND EXISTS (SELECT 1 FROM store_memberships
          WHERE id=? AND store_id=? AND user_id=? AND status='active')`,
  ).bind(identity.storeId, target, identity.membershipId, identity.storeId, identity.userId).first<ProductRow>();
}

export async function readProductRevision(db: D1Database, identity: ConsoleIdentityContext, productId: string): Promise<number | null> {
  const row = await db.prepare(
    `SELECT revision FROM products WHERE store_id = ? AND id = ?
       AND EXISTS (SELECT 1 FROM store_memberships
         WHERE id=? AND store_id=? AND user_id=? AND status='active')`,
  ).bind(identity.storeId, productId, identity.membershipId, identity.storeId, identity.userId).first<{ revision: number }>();
  await assertCurrentMembership(db, identity);
  return row?.revision ?? null;
}

export async function readProductDetailBySlug(
  db: D1Database,
  identity: ConsoleIdentityContext,
  slug: string,
): Promise<ProductDetailResponse | null> {
  const row = await productRowBy(db, identity, 'slug', slug);
  await assertCurrentMembership(db, identity);
  return row ? readDetailFromRow(db, identity, row) : null;
}

export async function readProductDetailById(
  db: D1Database,
  identity: ConsoleIdentityContext,
  productId: string,
): Promise<ProductDetailResponse | null> {
  const row = await productRowBy(db, identity, 'id', productId);
  await assertCurrentMembership(db, identity);
  return row ? readDetailFromRow(db, identity, row) : null;
}

async function readDetailFromRow(db: D1Database, identity: ConsoleIdentityContext, product: ProductRow): Promise<ProductDetailResponse> {
  const [groupsResult, valuesResult, variantsResult, membershipsResult] = await Promise.all([
    db.prepare(
      `SELECT id, name, position, participating
         FROM product_option_groups
        WHERE store_id = ? AND product_id = ? AND active = 1
          AND EXISTS (SELECT 1 FROM store_memberships WHERE id=? AND store_id=? AND user_id=? AND status='active')
        ORDER BY position, id`,
    ).bind(identity.storeId, product.id, identity.membershipId, identity.storeId, identity.userId).all<GroupRow>(),
    db.prepare(
      `SELECT id, group_id, label, position
         FROM product_option_values
        WHERE store_id = ? AND product_id = ? AND active = 1
          AND EXISTS (SELECT 1 FROM store_memberships WHERE id=? AND store_id=? AND user_id=? AND status='active')
        ORDER BY group_id, position, id`,
    ).bind(identity.storeId, product.id, identity.membershipId, identity.storeId, identity.userId).all<ValueRow>(),
    db.prepare(
      `SELECT id, combination_key, sku, status, price_override_minor, delivery_source,
              delivery_access_title, delivery_access_instructions,
              delivery_file_filename, delivery_file_size, delivery_file_kind
         FROM product_variants
        WHERE store_id = ? AND product_id = ? AND current_schema = 1
          AND EXISTS (SELECT 1 FROM store_memberships WHERE id=? AND store_id=? AND user_id=? AND status='active')
        ORDER BY id`,
    ).bind(identity.storeId, product.id, identity.membershipId, identity.storeId, identity.userId).all<VariantRow>(),
    db.prepare(
      `SELECT pvv.variant_id, pvv.group_id, pvv.value_id
         FROM product_variant_values pvv
         JOIN product_variants pv ON pv.id = pvv.variant_id
        WHERE pvv.store_id = ? AND pvv.product_id = ? AND pv.current_schema = 1
          AND EXISTS (SELECT 1 FROM store_memberships WHERE id=? AND store_id=? AND user_id=? AND status='active')`,
    ).bind(identity.storeId, product.id, identity.membershipId, identity.storeId, identity.userId).all<MembershipRow>(),
  ]);
  await assertCurrentMembership(db, identity);
  const values = valuesResult.results;
  const valuesById = new Map(values.map((value) => [value.id, value]));
  const groupsById = new Map(groupsResult.results.map((group) => [group.id, group]));
  const membershipsByVariant = new Map<string, MembershipRow[]>();
  for (const membership of membershipsResult.results) {
    const list = membershipsByVariant.get(membership.variant_id) ?? [];
    list.push(membership);
    membershipsByVariant.set(membership.variant_id, list);
  }
  const productFile = fileSummary(product.delivery_file_filename, product.delivery_file_size, product.delivery_file_kind);
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    status: product.status,
    type: product.product_type,
    currency: product.currency,
    basePriceMinor: product.base_price_minor,
    publicDescription: product.public_description,
    delivery: {
      accessTitle: product.delivery_access_title,
      accessInstructions: product.delivery_access_instructions,
      file: productFile,
    },
    optionGroups: groupsResult.results.map((group) => ({
      id: group.id,
      name: group.name,
      position: group.position,
      participating: group.participating === 1,
      values: values.filter((value) => value.group_id === group.id).map((value) => ({
        id: value.id,
        label: value.label,
        position: value.position,
      })),
    })),
    variants: variantsResult.results.map((variant) => {
      const inherited = variant.delivery_source === 'product_default';
      const selectedOptions = (membershipsByVariant.get(variant.id) ?? []).map((membership) => {
        const group = groupsById.get(membership.group_id);
        const value = valuesById.get(membership.value_id);
        if (!group || !value) throw new Error('Catalog membership points to an inactive or missing option.');
        return {
          groupId: group.id,
          groupName: group.name,
          valueId: value.id,
          valueLabel: value.label,
          position: group.position,
        };
      }).sort((left, right) => left.position - right.position);
      return {
        id: variant.id,
        combinationKey: variant.combination_key,
        selectedOptions: selectedOptions.map((option) => ({
          groupId: option.groupId,
          groupName: option.groupName,
          valueId: option.valueId,
          valueLabel: option.valueLabel,
        })),
        sku: variant.sku,
        status: variant.status,
        priceOverrideMinor: variant.price_override_minor,
        effectivePriceMinor: variant.price_override_minor ?? product.base_price_minor,
        priceSource: variant.price_override_minor === null ? 'base_price' as const : 'override' as const,
        delivery: {
          source: variant.delivery_source,
          accessTitle: inherited ? product.delivery_access_title : variant.delivery_access_title ?? '',
          accessInstructions: inherited ? product.delivery_access_instructions : variant.delivery_access_instructions ?? '',
          file: inherited
            ? productFile
            : fileSummary(variant.delivery_file_filename, variant.delivery_file_size, variant.delivery_file_kind),
        },
      };
    }),
    updatedAt: product.updated_at,
    revision: product.revision,
  };
}

export async function listProducts(
  db: D1Database,
  identity: ConsoleIdentityContext,
  query: string,
  status: 'all' | ProductStatus,
): Promise<ProductListResponse> {
  const normalizedText = normalizeComparisonKey(query);
  const normalizedQuery = `%${normalizedText.replace(/[!%_]/g, '!$&')}%`;
  const result = await db.prepare(
    `SELECT p.id, p.slug, p.name, p.status, p.product_type AS type, p.currency,
            CASE WHEN p.product_type = 'simple' THEN p.base_price_minor
                 ELSE MIN(COALESCE(v.price_override_minor, p.base_price_minor)) END AS minimumEffectivePriceMinor,
            CASE WHEN p.product_type = 'simple' THEN p.base_price_minor
                 ELSE MAX(COALESCE(v.price_override_minor, p.base_price_minor)) END AS maximumEffectivePriceMinor,
            CASE WHEN p.product_type = 'simple' THEN NULL
                 ELSE SUM(CASE WHEN v.status = 'enabled' THEN 1 ELSE 0 END) END AS enabledVariantCount,
            p.updated_at AS updatedAt, p.revision
       FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id AND v.store_id = p.store_id AND v.current_schema = 1
      WHERE p.store_id = ?
        AND EXISTS (SELECT 1 FROM store_memberships WHERE id=? AND store_id=? AND user_id=? AND status='active')
        AND (? = 'all' OR p.status = ?)
        AND (? = '' OR p.name_search_key LIKE ? ESCAPE '!' OR p.slug_search_key LIKE ? ESCAPE '!')
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.id ASC`,
  ).bind(identity.storeId, identity.membershipId, identity.storeId, identity.userId,
    status, status, normalizedText, normalizedQuery, normalizedQuery)
    .all<ProductListResponse['products'][number]>();
  await assertCurrentMembership(db, identity);
  return { products: result.results };
}

export interface ProductVariantPreviewRow {
  id: string;
  combinationKey: string;
  sku: string;
  currentSchema: number;
}

export async function readProductVariantPreviewRows(
  db: D1Database,
  identity: ConsoleIdentityContext,
  productId: string,
): Promise<ProductVariantPreviewRow[]> {
  const result = await db.prepare(
    `SELECT id, combination_key AS combinationKey, sku, current_schema AS currentSchema
       FROM product_variants WHERE store_id=? AND product_id=?
        AND EXISTS (SELECT 1 FROM store_memberships WHERE id=? AND store_id=? AND user_id=? AND status='active')`,
  ).bind(identity.storeId, productId, identity.membershipId, identity.storeId, identity.userId).all<ProductVariantPreviewRow>();
  await assertCurrentMembership(db, identity);
  return result.results;
}
