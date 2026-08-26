import {
  COMBINATIONS_CONFIRMATION_MAX,
  COMBINATIONS_CONFIRMATION_MIN,
  OPTION_GROUPS_MAX,
  OPTION_VALUES_PER_GROUP_MAX,
  PRODUCT_STATUSES,
  VARIANT_STATUSES,
} from '../shared/catalog-limits';
import {
  DraftReferenceValidationError,
  validateAndMapSchemaDraft,
  type SchemaDraft,
} from '../shared/schema-draft-refs';
import type {
  ApplySchemaRequest,
  CreateProductRequest,
  LabelOnlySchemaEdits,
  NonstructuralProductUpdateRequest,
  PreviewSchemaRequest,
  ProductCoreFields,
  VariantEdit,
} from './catalog-types';
import { CatalogValidationError } from './catalog-types';
import { decimalToMinor, MoneyError } from './money';
import { buildDraftMatrix } from './variant-matrix';

import { normalizeComparisonKey } from './slug';
function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CatalogValidationError('validation_failed', 'The request is invalid.', [
      { path, code: 'type_invalid', message: 'Expected an object.' },
    ]);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  ambiguousKeys: readonly string[] = [],
): void {
  const allowed = new Set(expected);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length === 0) return;
  const ambiguous = unknown.some((key) => ambiguousKeys.includes(key));
  throw new CatalogValidationError('validation_failed', 'The request is invalid.',
    unknown.map((key) => ({
      path: `${path}/${key}`,
      code: ambiguous ? 'variant_payload_ambiguous' : 'unknown_field',
      message: ambiguous
        ? 'Variant data has more than one owner in this request.'
        : 'This field is not accepted.',
    })),
  );
}

function stringAt(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new CatalogValidationError('validation_failed', 'The request is invalid.', [
      { path, code: 'value_required', message: 'A nonempty string is required.' },
    ]);
  }
  return value;
}

function nullableStringAt(value: unknown, path: string): string | null {
  return value === null ? null : stringAt(value, path, true);
}

function integerAt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new CatalogValidationError('validation_failed', 'The request is invalid.', [
      { path, code: 'integer_invalid', message: 'A non-negative safe integer is required.' },
    ]);
  }
  return value;
}

function parseDelivery(value: unknown, path: string): VariantEdit['delivery'] {
  const delivery = objectAt(value, path);
  if (delivery.source === 'product_default') {
    exactKeys(delivery, ['source'], path);
    return { source: 'product_default' };
  }
  if (delivery.source === 'variant_override') {
    exactKeys(delivery, ['source', 'accessTitle', 'accessInstructions'], path);
    return {
      source: 'variant_override',
      accessTitle: stringAt(delivery.accessTitle, `${path}/accessTitle`),
      accessInstructions: stringAt(delivery.accessInstructions, `${path}/accessInstructions`),
    };
  }
  throw new CatalogValidationError('validation_failed', 'The request is invalid.', [
    { path: `${path}/source`, code: 'delivery_source_invalid', message: 'Select Product default or a complete Variant override.' },
  ]);
}

export function parseProductCore(value: unknown, path = '/product'): ProductCoreFields {
  const product = objectAt(value, path);
  exactKeys(product, ['name', 'basePrice', 'currency', 'status', 'publicDescription', 'delivery'], path, ['variants']);
  const delivery = objectAt(product.delivery, `${path}/delivery`);
  exactKeys(delivery, ['accessTitle', 'accessInstructions'], `${path}/delivery`);
  const currency = stringAt(product.currency, `${path}/currency`);
  const basePrice = stringAt(product.basePrice, `${path}/basePrice`);
  try {
    decimalToMinor(basePrice, currency);
  } catch (error) {
    const money = error as MoneyError;
    throw new CatalogValidationError('validation_failed', 'The request is invalid.', [{
      path: money.code === 'currency_invalid' ? `${path}/currency` : `${path}/basePrice`,
      code: money.code,
      message: money.message,
    }]);
  }
  if (!PRODUCT_STATUSES.includes(product.status as (typeof PRODUCT_STATUSES)[number])) {
    throw new CatalogValidationError('validation_failed', 'The request is invalid.', [
      { path: `${path}/status`, code: 'status_invalid', message: 'Status must be draft, active, or archived.' },
    ]);
  }
  return {
    name: stringAt(product.name, `${path}/name`),
    basePrice,
    currency,
    status: product.status as ProductCoreFields['status'],
    publicDescription: stringAt(product.publicDescription, `${path}/publicDescription`, true),
    delivery: {
      accessTitle: stringAt(delivery.accessTitle, `${path}/delivery/accessTitle`),
      accessInstructions: stringAt(delivery.accessInstructions, `${path}/delivery/accessInstructions`),
    },
  };
}

export function parseSchemaDraft(value: unknown, path = '/schema'): SchemaDraft {
  const schema = objectAt(value, path);
  exactKeys(schema, ['groups', 'rows', 'confirmCombinations'], path, ['variantEdits']);
  if (!Array.isArray(schema.groups) || !Array.isArray(schema.rows) || typeof schema.confirmCombinations !== 'boolean') {
    throw new CatalogValidationError('validation_failed', 'The schema is invalid.', [
      { path, code: 'schema_invalid', message: 'Groups, rows, and confirmation are required.' },
    ]);
  }
  const groups = schema.groups.map((groupValue, groupIndex) => {
    const groupPath = `${path}/groups/${groupIndex}`;
    const group = objectAt(groupValue, groupPath);
    exactKeys(group, ['draftRef', 'id', 'name', 'position', 'participating', 'values'], groupPath);
    if (!Array.isArray(group.values) || typeof group.participating !== 'boolean') {
      throw new CatalogValidationError('validation_failed', 'The schema is invalid.', [
        { path: groupPath, code: 'schema_invalid', message: 'Group values and participation are required.' },
      ]);
    }
    return {
      draftRef: stringAt(group.draftRef, `${groupPath}/draftRef`),
      id: group.id === null ? null : stringAt(group.id, `${groupPath}/id`),
      name: stringAt(group.name, `${groupPath}/name`),
      position: integerAt(group.position, `${groupPath}/position`),
      participating: group.participating,
      values: group.values.map((valueItem, valueIndex) => {
        const valuePath = `${groupPath}/values/${valueIndex}`;
        const option = objectAt(valueItem, valuePath);
        exactKeys(option, ['draftRef', 'id', 'label', 'position'], valuePath);
        return {
          draftRef: stringAt(option.draftRef, `${valuePath}/draftRef`),
          id: option.id === null ? null : stringAt(option.id, `${valuePath}/id`),
          label: stringAt(option.label, `${valuePath}/label`),
          position: integerAt(option.position, `${valuePath}/position`),
        };
      }),
    };
  });
  const rows = schema.rows.map((rowValue, rowIndex) => {
    const rowPath = `${path}/rows/${rowIndex}`;
    const row = objectAt(rowValue, rowPath);
    exactKeys(row, ['id', 'selectedValueRefs', 'sku', 'status', 'priceOverride', 'delivery'], rowPath);
    if (!Array.isArray(row.selectedValueRefs) || !VARIANT_STATUSES.includes(row.status as (typeof VARIANT_STATUSES)[number])) {
      throw new CatalogValidationError('validation_failed', 'The schema is invalid.', [
        { path: rowPath, code: 'variant_invalid', message: 'Variant selections and a lowercase status are required.' },
      ]);
    }
    return {
      id: row.id === null ? null : stringAt(row.id, `${rowPath}/id`),
      selectedValueRefs: row.selectedValueRefs.map((ref, index) => stringAt(ref, `${rowPath}/selectedValueRefs/${index}`)),
      sku: stringAt(row.sku, `${rowPath}/sku`, true),
      status: row.status as (typeof VARIANT_STATUSES)[number],
      priceOverride: nullableStringAt(row.priceOverride, `${rowPath}/priceOverride`),
      delivery: parseDelivery(row.delivery, `${rowPath}/delivery`),
    };
  });
  const draft: SchemaDraft = { groups, rows, confirmCombinations: schema.confirmCombinations };
  validateSchemaSemantics(draft, path);
  return draft;
}

export function validateSchemaSemantics(schema: SchemaDraft, path = '/schema'): void {
  if (schema.groups.length > OPTION_GROUPS_MAX) {
    throw new CatalogValidationError('option_group_limit_exceeded', 'A Product can have at most 5 option groups.', [{
      path: `${path}/groups`, code: 'option_group_limit_exceeded', message: `${schema.groups.length} groups exceeds the maximum of 5.`,
    }]);
  }
  const positionSet = new Set<number>();
  const groupNames = new Set<string>();
  for (let index = 0; index < schema.groups.length; index += 1) {
    const group = schema.groups[index];
    const normalizedGroupName = normalizeComparisonKey(group.name);
    if (groupNames.has(normalizedGroupName)) {
      throw new CatalogValidationError('validation_failed', 'Option names must be unique.', [{
        path: `${path}/groups/${index}/name`, code: 'option_name_duplicate', message: 'Option group names must be unique after normalization.',
      }]);
    }
    groupNames.add(normalizedGroupName);
    if (group.values.length < 1 || group.values.length > OPTION_VALUES_PER_GROUP_MAX) {
      throw new CatalogValidationError('option_value_limit_exceeded', 'Each option group must have 1 to 10 values.', [{
        path: `${path}/groups/${index}/values`, code: 'option_value_limit_exceeded', message: 'Each saved group requires 1 to 10 values.',
      }]);
    }
    if (positionSet.has(group.position)) {
      throw new CatalogValidationError('validation_failed', 'The schema is invalid.', [{
        path: `${path}/groups/${index}/position`, code: 'position_duplicate', message: 'Group positions must be unique.',
      }]);
    }
    positionSet.add(group.position);
    const valuePositions = new Set<number>();
    const valueNames = new Set<string>();
    for (let valueIndex = 0; valueIndex < group.values.length; valueIndex += 1) {
      const position = group.values[valueIndex].position;
      const normalizedValue = normalizeComparisonKey(group.values[valueIndex].label);
      if (valueNames.has(normalizedValue)) {
        throw new CatalogValidationError('validation_failed', 'Option values must be unique.', [{
          path: `${path}/groups/${index}/values/${valueIndex}/label`, code: 'option_value_duplicate', message: 'Option values must be unique after normalization.',
        }]);
      }
      valueNames.add(normalizedValue);
      if (valuePositions.has(position)) {
        throw new CatalogValidationError('validation_failed', 'The schema is invalid.', [{
          path: `${path}/groups/${index}/values/${valueIndex}/position`, code: 'position_duplicate', message: 'Value positions must be unique in a group.',
        }]);
      }
      valuePositions.add(position);
    }
  }
  if (schema.groups.length === 0 && schema.rows.length === 0) return;
  if (schema.groups.filter((group) => group.participating).length === 0) {
    throw new CatalogValidationError('matrix_incomplete', 'A Variant schema requires a participating option group.', [{
      path: `${path}/groups`, code: 'matrix_incomplete', message: 'At least one group must participate in combinations.',
    }]);
  }
  try {
    validateAndMapSchemaDraft(schema);
  } catch (error) {
    if (error instanceof DraftReferenceValidationError) {
      throw new CatalogValidationError('validation_failed', 'Schema draft references are invalid.', error.fields);
    }
    throw error;
  }
  const expected = buildDraftMatrix(schema.groups).map((row) => row.selectedValueRefs.join('\u0000'));
  const actual = schema.rows.map((row) => row.selectedValueRefs.join('\u0000'));
  if (expected.length !== actual.length || new Set(actual).size !== actual.length || expected.some((key) => !actual.includes(key))) {
    throw new CatalogValidationError('matrix_incomplete', 'Variant rows must exactly cover the derived matrix.', [{
      path: `${path}/rows`, code: 'matrix_incomplete', message: 'Rows must cover every combination exactly once.',
    }]);
  }
  if (actual.length > COMBINATIONS_CONFIRMATION_MAX) {
    throw new CatalogValidationError('variant_limit_exceeded', 'A Product can have at most 30 combinations.', [{
      path: `${path}/groups`, code: 'variant_limit_exceeded', message: `${actual.length} combinations exceeds the maximum of 30.`,
    }]);
  }
  if (actual.length >= COMBINATIONS_CONFIRMATION_MIN && !schema.confirmCombinations) {
    throw new CatalogValidationError('variant_confirmation_required', 'Confirm Products with 11 to 30 combinations.', [{
      path: `${path}/confirmCombinations`, code: 'variant_confirmation_required', message: 'Confirmation is required for 11 to 30 combinations.',
    }]);
  }
}

function parseVariantEdit(value: unknown, index: number): VariantEdit {
  const path = `/variantEdits/${index}`;
  const edit = objectAt(value, path);
  exactKeys(edit, ['id', 'sku', 'status', 'priceOverride', 'delivery'], path, ['selectedValueRefs', 'selectedOptions']);
  if (!VARIANT_STATUSES.includes(edit.status as (typeof VARIANT_STATUSES)[number])) {
    throw new CatalogValidationError('validation_failed', 'The request is invalid.', [{
      path: `${path}/status`, code: 'status_invalid', message: 'Variant status must be enabled or disabled.',
    }]);
  }
  return {
    id: stringAt(edit.id, `${path}/id`),
    sku: stringAt(edit.sku, `${path}/sku`),
    status: edit.status as VariantEdit['status'],
    priceOverride: nullableStringAt(edit.priceOverride, `${path}/priceOverride`),
    delivery: parseDelivery(edit.delivery, `${path}/delivery`),
  };
}

function rejectStructuralLabelFields(record: Record<string, unknown>, path: string): void {
  const structuralKeys = ['position', 'participating', 'draftRef', 'selectedValueRefs'];
  const field = structuralKeys.find((key) => key in record);
  if (field) {
    throw new CatalogValidationError('schema_preview_required', 'Structural option changes require schema preview.', [{
      path: `${path}/${field}`, code: 'schema_preview_required', message: 'This structural option change requires schema preview.',
    }]);
  }
}

function parseLabels(value: unknown): LabelOnlySchemaEdits {
  const labels = objectAt(value, '/optionLabels');
  exactKeys(labels, ['groups'], '/optionLabels');
  if (!Array.isArray(labels.groups)) {
    throw new CatalogValidationError('validation_failed', 'The request is invalid.', [{
      path: '/optionLabels/groups', code: 'type_invalid', message: 'Expected an array.' },
    ]);
  }
  return { groups: labels.groups.map((groupValue, groupIndex) => {
    const path = `/optionLabels/groups/${groupIndex}`;
    const group = objectAt(groupValue, path);
    rejectStructuralLabelFields(group, path);
    exactKeys(group, ['id', 'name', 'values'], path, ['position', 'participating']);
    if (!Array.isArray(group.values)) throw new CatalogValidationError('validation_failed', 'The request is invalid.');
    return {
      id: stringAt(group.id, `${path}/id`),
      name: stringAt(group.name, `${path}/name`),
      values: group.values.map((item, valueIndex) => {
        const valuePath = `${path}/values/${valueIndex}`;
        const option = objectAt(item, valuePath);
        rejectStructuralLabelFields(option, valuePath);
        exactKeys(option, ['id', 'label'], valuePath, ['position']);
        return { id: stringAt(option.id, `${valuePath}/id`), label: stringAt(option.label, `${valuePath}/label`) };
      }),
    };
  }) };
}

export function parseCreateProductRequest(value: unknown): CreateProductRequest {
  const request = objectAt(value, '');
  exactKeys(request, ['product', 'schema', 'previewHash'], '', ['variantEdits', 'variants']);
  const product = parseProductCore(request.product);
  if (request.schema === null) {
    if (request.previewHash !== null) throw new CatalogValidationError('validation_failed', 'Simple Products require a null preview hash.');
    return { product, schema: null, previewHash: null };
  }
  const schema = parseSchemaDraft(request.schema);
  if (schema.groups.length === 0) {
    throw new CatalogValidationError('validation_failed', 'Simple Products require a null schema.', [{
      path: '/schema', code: 'schema_invalid', message: 'Use null for a simple Product schema.' },
    ]);
  }
  return { product, schema, previewHash: stringAt(request.previewHash, '/previewHash') };
}

export function parsePreviewSchemaRequest(value: unknown): PreviewSchemaRequest {
  const request = objectAt(value, '');
  exactKeys(request, ['productId', 'productSlug', 'product', 'schema'], '', ['variantEdits', 'variants']);
  return {
    productId: request.productId === null ? null : stringAt(request.productId, '/productId'),
    productSlug: stringAt(request.productSlug, '/productSlug'),
    product: parseProductCore(request.product),
    schema: parseSchemaDraft(request.schema),
  };
}

export function parseApplySchemaRequest(value: unknown): ApplySchemaRequest {
  const request = objectAt(value, '');
  exactKeys(request, ['product', 'schema', 'previewHash'], '', ['variantEdits', 'variants']);
  return {
    product: parseProductCore(request.product),
    schema: parseSchemaDraft(request.schema),
    previewHash: stringAt(request.previewHash, '/previewHash'),
  };
}

export function parseNonstructuralRequest(value: unknown): NonstructuralProductUpdateRequest {
  const request = objectAt(value, '');
  exactKeys(request, ['product', 'optionLabels', 'variantEdits'], '', ['schema', 'variants']);
  if (!Array.isArray(request.variantEdits)) throw new CatalogValidationError('validation_failed', 'Variant edits must be an array.');
  return {
    product: parseProductCore(request.product),
    optionLabels: parseLabels(request.optionLabels),
    variantEdits: request.variantEdits.map(parseVariantEdit),
  };
}
