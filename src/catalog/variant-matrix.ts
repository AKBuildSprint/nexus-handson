import type { SchemaDraftGroup } from '../shared/schema-draft-refs';
import { normalizeComparisonKey } from './slug';

export interface MatrixRow {
  selectedValueRefs: string[];
}

export function buildDraftMatrix(groups: SchemaDraftGroup[]): MatrixRow[] {
  const participating = groups
    .filter((group) => group.participating)
    .sort((left, right) => left.position - right.position);
  if (participating.length === 0) return [];

  let rows: MatrixRow[] = [{ selectedValueRefs: [] }];
  for (const group of participating) {
    const values = [...group.values].sort((left, right) => left.position - right.position);
    rows = rows.flatMap((row) =>
      values.map((value) => ({ selectedValueRefs: [...row.selectedValueRefs, value.draftRef] })),
    );
  }
  return rows;
}

export function canonicalCombination(
  selected: Array<{ groupId: string; valueId: string; groupPosition: number }>,
): string {
  return [...selected]
    .sort((left, right) => left.groupPosition - right.groupPosition)
    .map(({ groupId, valueId }) => `${groupId}:${valueId}`)
    .join('|');
}

function skuToken(value: string): string {
  const token = normalizeComparisonKey(value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
  return token || 'OPTION';
}

export function suggestedSku(productSlug: string, selectedLabels: string[]): string {
  return [skuToken(productSlug), ...selectedLabels.map(skuToken)].join('-').slice(0, 96);
}
