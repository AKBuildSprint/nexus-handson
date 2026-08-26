import type { SchemaDraft } from '../shared/schema-draft-refs';
import type { ProductCoreFields, SchemaPreviewResponse } from './catalog-types';
import { canonicalCombination, suggestedSku } from './variant-matrix';

export interface ExistingSchemaVariant {
  id: string;
  combinationKey: string;
  selectedValueIds: string[];
  sku: string;
  currentSchema: boolean;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

export async function schemaPreviewHash(product: ProductCoreFields, schema: SchemaDraft): Promise<string> {
  const canonical = canonicalJson({ product, schema });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function previewSchemaChange(input: {
  productSlug: string;
  product: ProductCoreFields;
  schema: SchemaDraft;
  existingVariants?: ExistingSchemaVariant[];
}): Promise<SchemaPreviewResponse> {
  const existingVariants = input.existingVariants ?? [];
  const existingByCombination = new Map(existingVariants.map((variant) => [variant.combinationKey, variant]));
  const valueByRef = new Map<string, { id: string; label: string; groupId: string; groupPosition: number }>();
  input.schema.groups.forEach((group, groupIndex) => {
    const groupId = group.id ?? `new-group:${group.draftRef}`;
    group.values.forEach((value) => {
      valueByRef.set(value.draftRef, {
        id: value.id ?? `new-value:${value.draftRef}`,
        label: value.label,
        groupId,
        groupPosition: group.position ?? groupIndex,
      });
    });
  });

  const desiredKeys = new Set<string>();
  const rows: SchemaPreviewResponse['rows'] = input.schema.rows.map((row) => {
    const selected = row.selectedValueRefs.map((ref) => {
      const value = valueByRef.get(ref);
      if (!value) throw new Error('Validated draft reference is missing from the preview map.');
      return { groupId: value.groupId, valueId: value.id, groupPosition: value.groupPosition, label: value.label };
    });
    const key = canonicalCombination(selected);
    desiredKeys.add(key);
    const historical = existingByCombination.get(key);
    const suggestion = row.sku.trim() === '' ? suggestedSku(input.productSlug, selected.map((value) => value.label)) : row.sku;
    return {
      outcome: historical ? 'retained' : 'new',
      variantId: historical?.id ?? null,
      selectedValueRefs: [...row.selectedValueRefs],
      sku: suggestion,
      skuSuggested: row.sku.trim() === '',
    };
  });

  for (const existing of existingVariants) {
    if (existing.currentSchema && !desiredKeys.has(existing.combinationKey)) {
      rows.push({
        outcome: 'will_disable',
        variantId: existing.id,
        selectedValueRefs: [],
        sku: existing.sku,
        skuSuggested: false,
      });
    }
  }

  const combinationCount = input.schema.rows.length;
  return {
    previewHash: await schemaPreviewHash(input.product, input.schema),
    combinationCount,
    confirmationRequired: combinationCount >= 11 && combinationCount <= 30,
    blocked: combinationCount >= 31,
    rows,
  };
}

export function catalogFingerprint(input: unknown): Promise<string> {
  const canonical = canonicalJson(input);
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  );
}
