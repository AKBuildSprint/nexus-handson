import type { SchemaDraft } from '../shared/schema-draft-refs';
import type {
  ApplySchemaRequest,
  CreateProductRequest,
  NonstructuralProductUpdateRequest,
  ProductDetailResponse,
  ProductCoreFields,
  VariantEdit,
} from './catalog-types';
import { CatalogValidationError } from './catalog-types';
import { BOOTSTRAP_STORE_ID, readProductDetailById } from './catalog-read';
import { decimalToMinor, MoneyError } from './money';
import { catalogFingerprint, schemaPreviewHash } from './schema-change';
import { normalizeComparisonKey, slugifyProductName, stableId } from './slug';
import { canonicalCombination } from './variant-matrix';

interface ExistingIdentityRow {
  kind: 'group' | 'value';
  id: string;
  group_id: string | null;
}

interface ExistingVariantRow {
  id: string;
  combination_key: string;
}

interface MappedSchema {
  groups: Array<{
    id: string;
    name: string;
    comparisonKey: string;
    position: number;
    participating: boolean;
  }>;
  values: Array<{
    id: string;
    groupId: string;
    label: string;
    comparisonKey: string;
    position: number;
  }>;
  variants: Array<{
    id: string;
    combinationKey: string;
    sku: string;
    status: 'enabled' | 'disabled';
    priceOverrideMinor: number | null;
    delivery: VariantEdit['delivery'];
    memberships: Array<{ groupId: string; valueId: string }>;
  }>;
}

function productValues(product: ProductCoreFields) {
  return {
    name: product.name,
    status: product.status,
    currency: product.currency,
    basePriceMinor: decimalToMinor(product.basePrice, product.currency),
    publicDescription: product.publicDescription,
    accessTitle: product.delivery.accessTitle,
    accessInstructions: product.delivery.accessInstructions,
  };
}

function assertUniqueIds(ids: string[], path: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new CatalogValidationError('validation_failed', 'The request is invalid.', [{
      path,
      code: 'variant_payload_ambiguous',
      message: 'Stable IDs may appear only once.',
    }]);
  }
}

async function mapSchema(
  db: D1Database,
  productId: string | null,
  product: ProductCoreFields,
  schema: SchemaDraft,
  allowBlankSku = false,
): Promise<MappedSchema> {
  const existingIdentity = productId === null
    ? []
    : (await db.prepare(
      `SELECT 'group' AS kind, id, NULL AS group_id
         FROM product_option_groups WHERE store_id = ? AND product_id = ?
       UNION ALL
       SELECT 'value' AS kind, id, group_id
         FROM product_option_values WHERE store_id = ? AND product_id = ?`,
    ).bind(BOOTSTRAP_STORE_ID, productId, BOOTSTRAP_STORE_ID, productId).all<ExistingIdentityRow>()).results;
  const existingGroups = new Map(existingIdentity.filter((row) => row.kind === 'group').map((row) => [row.id, row]));
  const existingValues = new Map(existingIdentity.filter((row) => row.kind === 'value').map((row) => [row.id, row]));
  const requestedExistingGroupIds = schema.groups.flatMap((group) => group.id === null ? [] : [group.id]);
  const requestedExistingValueIds = schema.groups.flatMap((group) => group.values.flatMap((value) => value.id === null ? [] : [value.id]));
  assertUniqueIds(requestedExistingGroupIds, '/schema/groups');
  assertUniqueIds(requestedExistingValueIds, '/schema/groups');
  if (productId === null && (requestedExistingGroupIds.length > 0 || requestedExistingValueIds.length > 0 || schema.rows.some((row) => row.id !== null))) {
    throw new CatalogValidationError('validation_failed', 'New Products cannot claim existing identities.', [{
      path: '/schema', code: 'invalid_draft_reference', message: 'Create schema identities must be new.' },
    ]);
  }

  const groupIdByRef = new Map<string, string>();
  const valueByRef = new Map<string, { id: string; groupId: string; groupPosition: number }>();
  const groups = schema.groups.map((group) => {
    if (group.id !== null && !existingGroups.has(group.id)) {
      throw new CatalogValidationError('validation_failed', 'Schema draft references are invalid.', [{
        path: '/schema/groups', code: 'invalid_draft_reference', message: 'An existing group ID does not belong to this Product.' },
      ]);
    }
    const id = group.id ?? stableId('grp');
    groupIdByRef.set(group.draftRef, id);
    return {
      id,
      name: group.name,
      comparisonKey: normalizeComparisonKey(group.name),
      position: group.position,
      participating: group.participating,
    };
  });
  const values = schema.groups.flatMap((group) => {
    const groupId = groupIdByRef.get(group.draftRef);
    if (!groupId) throw new Error('Validated group draft reference is missing.');
    return group.values.map((value) => {
      const existing = value.id === null ? null : existingValues.get(value.id);
      if (value.id !== null && (!existing || existing.group_id !== group.id)) {
        throw new CatalogValidationError('validation_failed', 'Schema draft references are invalid.', [{
          path: '/schema/groups', code: 'invalid_draft_reference', message: 'An existing value ID does not belong to its Product group.' },
        ]);
      }
      const id = value.id ?? stableId('val');
      valueByRef.set(value.draftRef, { id, groupId, groupPosition: group.position });
      return {
        id,
        groupId,
        label: value.label,
        comparisonKey: normalizeComparisonKey(value.label),
        position: value.position,
      };
    });
  });
  const existingVariants = productId === null
    ? []
    : (await db.prepare(
      'SELECT id, combination_key FROM product_variants WHERE store_id = ? AND product_id = ?',
    ).bind(BOOTSTRAP_STORE_ID, productId).all<ExistingVariantRow>()).results;
  const existingById = new Map(existingVariants.map((variant) => [variant.id, variant]));
  const existingByCombination = new Map(existingVariants.map((variant) => [variant.combination_key, variant]));
  assertUniqueIds(schema.rows.flatMap((row) => row.id === null ? [] : [row.id]), '/schema/rows');
  const skuSet = new Set<string>();
  const variants = schema.rows.map((row, rowIndex) => {
    if (!allowBlankSku && row.sku.trim() === '') {
      throw new CatalogValidationError('validation_failed', 'The request is invalid.', [{
        path: `/schema/rows/${rowIndex}/sku`, code: 'value_required', message: 'A Variant SKU is required.' },
      ]);
    }
    if (row.sku.trim() !== '' && skuSet.has(row.sku)) {
      throw new CatalogValidationError('sku_conflict', 'Variant SKUs must be unique within the Store.', [{
        path: `/schema/rows/${rowIndex}/sku`, code: 'sku_conflict', message: 'This SKU is repeated.' },
      ], 409);
    }
    if (row.sku.trim() !== '') skuSet.add(row.sku);
    const selected = row.selectedValueRefs.map((ref) => {
      const value = valueByRef.get(ref);
      if (!value) throw new Error('Validated value draft reference is missing.');
      return value;
    });
    const combinationKey = canonicalCombination(selected.map((value) => ({
      groupId: value.groupId,
      valueId: value.id,
      groupPosition: value.groupPosition,
    })));
    const historical = existingByCombination.get(combinationKey);
    if (row.id !== null) {
      const claimed = existingById.get(row.id);
      if (!claimed || claimed.combination_key !== combinationKey) {
        throw new CatalogValidationError('identity_conflict', 'Variant identity does not match its combination.', [{
          path: `/schema/rows/${rowIndex}/id`, code: 'identity_conflict', message: 'The Variant ID and selected options do not match.' },
        ], 409);
      }
    }
    let priceOverrideMinor: number | null = null;
    if (row.priceOverride !== null) {
      try {
        priceOverrideMinor = decimalToMinor(row.priceOverride, product.currency);
      } catch (error) {
        const money = error as MoneyError;
        throw new CatalogValidationError('validation_failed', 'The request is invalid.', [{
          path: `/schema/rows/${rowIndex}/priceOverride`, code: money.code, message: money.message,
        }]);
      }
    }
    return {
      id: row.id ?? historical?.id ?? stableId('var'),
      combinationKey,
      sku: row.sku,
      status: row.status,
      priceOverrideMinor,
      delivery: row.delivery,
      memberships: selected.map((value) => ({ groupId: value.groupId, valueId: value.id })),
    };
  });
  return { groups, values, variants };
}
function normalizedProductFingerprintFields(product: ProductCoreFields) {
  return {
    name: product.name.normalize('NFKC').trim(),
    status: product.status,
    currency: product.currency,
    basePriceMinor: decimalToMinor(product.basePrice, product.currency),
    publicDescription: product.publicDescription.normalize('NFKC').trim(),
    accessTitle: product.delivery.accessTitle.normalize('NFKC').trim(),
    accessInstructions: product.delivery.accessInstructions.normalize('NFKC').trim(),
  };
}

function normalizedDelivery(delivery: VariantEdit['delivery']) {
  return delivery.source === 'product_default'
    ? { source: 'product_default' }
    : {
      source: 'variant_override',
      accessTitle: delivery.accessTitle.normalize('NFKC').trim(),
      accessInstructions: delivery.accessInstructions.normalize('NFKC').trim(),
    };
}

async function fingerprintMappedAggregate(
  product: ProductCoreFields,
  mapped: MappedSchema | null,
): Promise<string> {
  if (mapped === null) return catalogFingerprint({ product: normalizedProductFingerprintFields(product), groups: [], variants: [] });
  const groupById = new Map(mapped.groups.map((group) => [group.id, group]));
  const valueById = new Map(mapped.values.map((value) => [value.id, value]));
  const groups = [...mapped.groups].sort((left, right) => left.position - right.position).map((group) => ({
    name: group.comparisonKey,
    position: group.position,
    participating: group.participating,
    values: mapped.values.filter((value) => value.groupId === group.id)
      .sort((left, right) => left.position - right.position)
      .map((value) => ({ label: value.comparisonKey, position: value.position })),
  }));
  const variants = mapped.variants.map((variant) => ({
    selection: variant.memberships.map((membership) => {
      const group = groupById.get(membership.groupId);
      const value = valueById.get(membership.valueId);
      if (!group || !value) throw new Error('Mapped fingerprint membership is incomplete.');
      return `${group.position}:${value.position}`;
    }).sort(),
    sku: variant.sku.normalize('NFKC').trim(),
    status: variant.status,
    priceOverrideMinor: variant.priceOverrideMinor,
    delivery: normalizedDelivery(variant.delivery),
  })).sort((left, right) => left.selection.join('|').localeCompare(right.selection.join('|')));
  return catalogFingerprint({ product: normalizedProductFingerprintFields(product), groups, variants });
}

async function fingerprintUpdatedAggregate(
  product: ProductCoreFields,
  current: ProductDetailResponse,
  request: NonstructuralProductUpdateRequest,
): Promise<string> {
  const groupPositionById = new Map(current.optionGroups.map((group) => [group.id, group.position]));
  const valuePositionById = new Map(current.optionGroups.flatMap((group) => group.values.map((value) => [value.id, value.position] as const)));
  const groups = request.optionLabels.groups.map((group) => {
    const currentGroup = current.optionGroups.find((candidate) => candidate.id === group.id);
    if (!currentGroup) throw new Error('Validated option group is missing.');
    return {
      name: normalizeComparisonKey(group.name),
      position: currentGroup.position,
      participating: currentGroup.participating,
      values: group.values.map((value) => ({
        label: normalizeComparisonKey(value.label),
        position: valuePositionById.get(value.id),
      })).sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
    };
  }).sort((left, right) => left.position - right.position);
  const editById = new Map(request.variantEdits.map((edit) => [edit.id, edit]));
  const variants = current.variants.map((variant) => {
    const edit = editById.get(variant.id);
    if (!edit) throw new Error('Validated Variant edit is missing.');
    return {
      selection: variant.selectedOptions.map((option) => `${groupPositionById.get(option.groupId)}:${valuePositionById.get(option.valueId)}`).sort(),
      sku: edit.sku.normalize('NFKC').trim(),
      status: edit.status,
      priceOverrideMinor: edit.priceOverride === null ? null : decimalToMinor(edit.priceOverride, product.currency),
      delivery: normalizedDelivery(edit.delivery),
    };
  }).sort((left, right) => left.selection.join('|').localeCompare(right.selection.join('|')));
  return catalogFingerprint({ product: normalizedProductFingerprintFields(product), groups, variants });
}


function schemaStatements(db: D1Database, productId: string, mapped: MappedSchema): D1PreparedStatement[] {
  const groupJson = JSON.stringify(mapped.groups.map((group) => ({ ...group, participating: group.participating ? 1 : 0 })));
  const valueJson = JSON.stringify(mapped.values);
  const variantJson = JSON.stringify(mapped.variants.map((variant) => ({
    id: variant.id,
    combinationKey: variant.combinationKey,
    sku: variant.sku,
    status: variant.status,
    priceOverrideMinor: variant.priceOverrideMinor,
    deliverySource: variant.delivery.source,
    accessTitle: variant.delivery.source === 'variant_override' ? variant.delivery.accessTitle : null,
    accessInstructions: variant.delivery.source === 'variant_override' ? variant.delivery.accessInstructions : null,
  })));
  const membershipJson = JSON.stringify(mapped.variants.flatMap((variant) =>
    variant.memberships.map((membership) => ({ variantId: variant.id, ...membership })),
  ));
  return [
    db.prepare("UPDATE product_variants SET current_schema = 0, status = 'disabled' WHERE store_id = ? AND product_id = ? AND current_schema = 1")
      .bind(BOOTSTRAP_STORE_ID, productId),
    db.prepare('UPDATE product_option_groups SET active = 0 WHERE store_id = ? AND product_id = ?').bind(BOOTSTRAP_STORE_ID, productId),
    db.prepare('UPDATE product_option_values SET active = 0 WHERE store_id = ? AND product_id = ?').bind(BOOTSTRAP_STORE_ID, productId),
    db.prepare(
      `INSERT INTO product_option_groups (id, store_id, product_id, name, comparison_key, position, participating, active)
       SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.name'), json_extract(value, '$.comparisonKey'),
              json_extract(value, '$.position'), json_extract(value, '$.participating'), 0 FROM json_each(?) WHERE 1
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, comparison_key=excluded.comparison_key,
         position=excluded.position, participating=excluded.participating, active=0`,
    ).bind(BOOTSTRAP_STORE_ID, productId, groupJson),
    db.prepare(
      `INSERT INTO product_option_values (id, store_id, product_id, group_id, label, comparison_key, position, active)
       SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.groupId'), json_extract(value, '$.label'),
              json_extract(value, '$.comparisonKey'), json_extract(value, '$.position'), 1 FROM json_each(?) WHERE 1
       ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id, label=excluded.label,
         comparison_key=excluded.comparison_key, position=excluded.position, active=1`,
    ).bind(BOOTSTRAP_STORE_ID, productId, valueJson),
    db.prepare(
      `UPDATE product_option_groups SET active=1
        WHERE store_id=? AND product_id=?
          AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`,
    ).bind(BOOTSTRAP_STORE_ID, productId, groupJson),
    db.prepare(
      `INSERT INTO product_variants
         (id, store_id, product_id, combination_key, sku, status, current_schema, price_override_minor,
          delivery_source, delivery_access_title, delivery_access_instructions)
       SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.combinationKey'), json_extract(value, '$.sku'),
              'disabled', 0, json_extract(value, '$.priceOverrideMinor'), json_extract(value, '$.deliverySource'),
              json_extract(value, '$.accessTitle'), json_extract(value, '$.accessInstructions') FROM json_each(?) WHERE 1
       ON CONFLICT(id) DO UPDATE SET sku=excluded.sku, price_override_minor=excluded.price_override_minor,
         delivery_source=excluded.delivery_source, delivery_access_title=excluded.delivery_access_title,
         delivery_access_instructions=excluded.delivery_access_instructions,
         delivery_file_key=CASE WHEN excluded.delivery_source='product_default' THEN NULL ELSE product_variants.delivery_file_key END,
         delivery_file_filename=CASE WHEN excluded.delivery_source='product_default' THEN NULL ELSE product_variants.delivery_file_filename END,
         delivery_file_size=CASE WHEN excluded.delivery_source='product_default' THEN NULL ELSE product_variants.delivery_file_size END,
         delivery_file_kind=CASE WHEN excluded.delivery_source='product_default' THEN NULL ELSE product_variants.delivery_file_kind END,
         delivery_file_checksum=CASE WHEN excluded.delivery_source='product_default' THEN NULL ELSE product_variants.delivery_file_checksum END`,
    ).bind(BOOTSTRAP_STORE_ID, productId, variantJson),
    db.prepare(
      `DELETE FROM product_variant_values
        WHERE store_id = ? AND product_id = ?
          AND variant_id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`,
    ).bind(BOOTSTRAP_STORE_ID, productId, variantJson),
    db.prepare(
      `INSERT INTO product_variant_values (variant_id, value_id, group_id, product_id, store_id)
       SELECT json_extract(value, '$.variantId'), json_extract(value, '$.valueId'), json_extract(value, '$.groupId'), ?, ?
         FROM json_each(?)`,
    ).bind(productId, BOOTSTRAP_STORE_ID, membershipJson),
    db.prepare(
      `UPDATE product_variants
          SET current_schema = 1,
              status = (SELECT json_extract(value, '$.status') FROM json_each(?) WHERE json_extract(value, '$.id') = product_variants.id),
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE store_id = ? AND product_id = ?
          AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`,
    ).bind(variantJson, BOOTSTRAP_STORE_ID, productId, variantJson),
  ];
}

export async function createProduct(db: D1Database, request: CreateProductRequest): Promise<ProductDetailResponse> {
  const id = stableId('prod');
  const slug = slugifyProductName(request.product.name);
  const values = productValues(request.product);
  if (request.schema !== null) {
    const expectedHash = await schemaPreviewHash(request.product, request.schema);
    if (request.previewHash !== expectedHash) {
      throw new CatalogValidationError('schema_preview_stale', 'The schema preview is stale.', [], 409);
    }
  }
  const mapped = request.schema === null ? null : await mapSchema(db, null, request.product, request.schema);
  const fingerprint = await fingerprintMappedAggregate(request.product, mapped);
  const productInsert = db.prepare(
    `INSERT INTO products
       (id, store_id, slug, name, name_search_key, slug_search_key, status, product_type, currency,
        base_price_minor, public_description, delivery_access_title, delivery_access_instructions, revision, import_fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).bind(id, BOOTSTRAP_STORE_ID, slug, values.name, normalizeComparisonKey(values.name), normalizeComparisonKey(slug),
    values.status, mapped ? 'variant' : 'simple', values.currency, values.basePriceMinor, values.publicDescription,
    values.accessTitle, values.accessInstructions, fingerprint);
  await db.batch(mapped ? [productInsert, ...schemaStatements(db, id, mapped)] : [productInsert]);
  const detail = await readProductDetailById(db, id);
  if (!detail) throw new Error('Created Product could not be read.');
  return detail;
}

export async function validateSchemaForProduct(
  db: D1Database,
  productId: string | null,
  product: ProductCoreFields,
  schema: SchemaDraft,
): Promise<void> {
  await mapSchema(db, productId, product, schema, true);
}
export async function applyProductSchema(
  db: D1Database,
  productId: string,
  expectedRevision: number,
  request: ApplySchemaRequest,
): Promise<ProductDetailResponse> {
  const expectedHash = await schemaPreviewHash(request.product, request.schema);
  if (request.previewHash !== expectedHash) {
    throw new CatalogValidationError('schema_preview_stale', 'The schema preview is stale.', [], 409);

  }
  const mapped = await mapSchema(db, productId, request.product, request.schema);
  const values = productValues(request.product);
  const fingerprint = await fingerprintMappedAggregate(request.product, mapped);
  const statements = schemaStatements(db, productId, mapped);
  statements.push(db.prepare(
    `UPDATE products SET
       name = CASE WHEN revision = ? THEN ? ELSE NULL END,
       name_search_key = ?, status = ?, product_type = ?, currency = ?, base_price_minor = ?, public_description = ?,
       delivery_access_title = ?, delivery_access_instructions = ?, revision = revision + 1,
       import_fingerprint = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE store_id = ? AND id = ?`,
  ).bind(expectedRevision, values.name, normalizeComparisonKey(values.name), values.status,
    mapped.groups.length === 0 ? 'simple' : 'variant', values.currency, values.basePriceMinor,
    values.publicDescription, values.accessTitle, values.accessInstructions, fingerprint, BOOTSTRAP_STORE_ID, productId));
  await db.batch(statements);
  const detail = await readProductDetailById(db, productId);
  if (!detail) throw new CatalogValidationError('product_not_found', 'Product not found.', [], 404);
  return detail;
}

export async function updateProductNonstructural(
  db: D1Database,
  productId: string,
  expectedRevision: number,
  request: NonstructuralProductUpdateRequest,
): Promise<ProductDetailResponse> {
  const current = await readProductDetailById(db, productId);
  if (!current) throw new CatalogValidationError('product_not_found', 'Product not found.', [], 404);
  const requestedGroups = request.optionLabels.groups;
  const currentGroupIds = current.optionGroups.map((group) => group.id).sort();
  const requestedGroupIds = requestedGroups.map((group) => group.id);
  assertUniqueIds(requestedGroupIds, '/optionLabels/groups');
  const currentValueIds = current.optionGroups.flatMap((group) => group.values.map((value) => value.id)).sort();
  const requestedValueIds = requestedGroups.flatMap((group) => group.values.map((value) => value.id));
  assertUniqueIds(requestedValueIds, '/optionLabels/groups');
  if (currentGroupIds.join('\u0000') !== [...requestedGroupIds].sort().join('\u0000') ||
      currentValueIds.join('\u0000') !== [...requestedValueIds].sort().join('\u0000')) {
    throw new CatalogValidationError('schema_preview_required', 'Structural option changes require schema preview.', [{
      path: '/optionLabels', code: 'schema_preview_required', message: 'Option label edits must contain the exact existing IDs.' },
    ]);
  }
  for (const group of requestedGroups) {
    const currentGroup = current.optionGroups.find((candidate) => candidate.id === group.id);
    const expectedIds = currentGroup?.values.map((value) => value.id).sort().join('\u0000');
    if (!currentGroup || expectedIds !== group.values.map((value) => value.id).sort().join('\u0000')) {
      throw new CatalogValidationError('schema_preview_required', 'Moving option values requires schema preview.', [{
        path: '/optionLabels', code: 'schema_preview_required', message: 'Option values cannot move between groups.' },
      ]);
    }
  }
  const currentVariantIds = current.variants.map((variant) => variant.id).sort();
  const requestedVariantIds = request.variantEdits.map((variant) => variant.id);
  assertUniqueIds(requestedVariantIds, '/variantEdits');
  if (currentVariantIds.join('\u0000') !== [...requestedVariantIds].sort().join('\u0000')) {
    throw new CatalogValidationError('validation_failed', 'Variant data has more than one owner.', [{
      path: '/variantEdits', code: 'variant_payload_ambiguous', message: 'Variant edits must contain the exact current Variant IDs.' },
    ]);
  }
  const skuSet = new Set(request.variantEdits.map((variant) => variant.sku));
  if (skuSet.size !== request.variantEdits.length) {
    throw new CatalogValidationError('sku_conflict', 'Variant SKUs must be unique within the Store.', [], 409);
  }
  const values = productValues(request.product);
  const groupsJson = JSON.stringify(requestedGroups.map((group) => ({
    id: group.id, name: group.name, comparisonKey: normalizeComparisonKey(group.name),
  })));
  const optionValuesJson = JSON.stringify(requestedGroups.flatMap((group) => group.values.map((value) => ({
    id: value.id, label: value.label, comparisonKey: normalizeComparisonKey(value.label),
  }))));
  const variantsJson = JSON.stringify(request.variantEdits.map((variant, index) => {
    let priceOverrideMinor: number | null = null;
    if (variant.priceOverride !== null) {
      try {
        priceOverrideMinor = decimalToMinor(variant.priceOverride, request.product.currency);
      } catch (error) {
        const money = error as MoneyError;
        throw new CatalogValidationError('validation_failed', 'The request is invalid.', [{
          path: `/variantEdits/${index}/priceOverride`, code: money.code, message: money.message,
        }]);
      }
    }
    return {
      id: variant.id,
      sku: variant.sku,
      status: variant.status,
      priceOverrideMinor,
      source: variant.delivery.source,
      accessTitle: variant.delivery.source === 'variant_override' ? variant.delivery.accessTitle : null,
      accessInstructions: variant.delivery.source === 'variant_override' ? variant.delivery.accessInstructions : null,
    };
  }));
  const fingerprint = await fingerprintUpdatedAggregate(request.product, current, request);
  await db.batch([
    db.prepare(
      `UPDATE product_option_groups SET
         name=(SELECT json_extract(value, '$.name') FROM json_each(?) WHERE json_extract(value, '$.id')=product_option_groups.id),
         comparison_key=(SELECT json_extract(value, '$.comparisonKey') FROM json_each(?) WHERE json_extract(value, '$.id')=product_option_groups.id)
       WHERE store_id=? AND product_id=? AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`,
    ).bind(groupsJson, groupsJson, BOOTSTRAP_STORE_ID, productId, groupsJson),
    db.prepare(
      `UPDATE product_option_values SET
         label=(SELECT json_extract(value, '$.label') FROM json_each(?) WHERE json_extract(value, '$.id')=product_option_values.id),
         comparison_key=(SELECT json_extract(value, '$.comparisonKey') FROM json_each(?) WHERE json_extract(value, '$.id')=product_option_values.id)
       WHERE store_id=? AND product_id=? AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`,
    ).bind(optionValuesJson, optionValuesJson, BOOTSTRAP_STORE_ID, productId, optionValuesJson),
    db.prepare(
      `UPDATE product_variants SET
         sku=(SELECT json_extract(value, '$.sku') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id),
         status=(SELECT json_extract(value, '$.status') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id),
         price_override_minor=(SELECT json_extract(value, '$.priceOverrideMinor') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id),
         delivery_source=(SELECT json_extract(value, '$.source') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id),
         delivery_access_title=(SELECT json_extract(value, '$.accessTitle') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id),
         delivery_access_instructions=(SELECT json_extract(value, '$.accessInstructions') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id),
         delivery_file_key=CASE WHEN (SELECT json_extract(value, '$.source') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id)='product_default' THEN NULL ELSE delivery_file_key END,
         delivery_file_filename=CASE WHEN (SELECT json_extract(value, '$.source') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id)='product_default' THEN NULL ELSE delivery_file_filename END,
         delivery_file_size=CASE WHEN (SELECT json_extract(value, '$.source') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id)='product_default' THEN NULL ELSE delivery_file_size END,
         delivery_file_kind=CASE WHEN (SELECT json_extract(value, '$.source') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id)='product_default' THEN NULL ELSE delivery_file_kind END,
         delivery_file_checksum=CASE WHEN (SELECT json_extract(value, '$.source') FROM json_each(?) WHERE json_extract(value, '$.id')=product_variants.id)='product_default' THEN NULL ELSE delivery_file_checksum END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE store_id=? AND product_id=? AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`,
    ).bind(variantsJson, variantsJson, variantsJson, variantsJson, variantsJson, variantsJson,
      variantsJson, variantsJson, variantsJson, variantsJson, variantsJson,
      BOOTSTRAP_STORE_ID, productId, variantsJson),
    db.prepare(
      `UPDATE products SET
         name=CASE WHEN revision=? THEN ? ELSE NULL END, name_search_key=?, status=?, currency=?,
         base_price_minor=?, public_description=?, delivery_access_title=?, delivery_access_instructions=?,
         revision=revision+1, import_fingerprint=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE store_id=? AND id=?`,
    ).bind(expectedRevision, values.name, normalizeComparisonKey(values.name), values.status, values.currency,
      values.basePriceMinor, values.publicDescription, values.accessTitle, values.accessInstructions,
      fingerprint, BOOTSTRAP_STORE_ID, productId),
  ]);
  const detail = await readProductDetailById(db, productId);
  if (!detail) throw new Error('Updated Product could not be read.');
  return detail;
}
