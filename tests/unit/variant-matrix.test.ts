import { describe, expect, it } from 'vitest';
import { buildDraftMatrix, canonicalCombination, suggestedSku } from '../../src/catalog/variant-matrix';

describe('Variant matrix identity', () => {
  it('builds the ordered Cartesian set from participating groups only', () => {
    const rows = buildDraftMatrix([
      { draftRef: 'g1', id: null, name: 'Theme', position: 0, participating: true, values: [
        { draftRef: 'dark', id: null, label: 'Dark', position: 0 },
        { draftRef: 'light', id: null, label: 'Light', position: 1 },
      ] },
      { draftRef: 'g2', id: null, name: 'Notes', position: 1, participating: false, values: [
        { draftRef: 'n', id: null, label: 'N', position: 0 },
      ] },
    ]);
    expect(rows.map((row) => row.selectedValueRefs)).toEqual([['dark'], ['light']]);
  });

  it('canonicalizes stable IDs rather than labels and suggests deterministic SKUs', () => {
    expect(canonicalCombination([
      { groupId: 'group-b', valueId: 'value-b', groupPosition: 1 },
      { groupId: 'group-a', valueId: 'value-a', groupPosition: 0 },
    ])).toBe('group-a:value-a|group-b:value-b');
    expect(suggestedSku('focus-pack', ['Dark', 'Personal'])).toBe('FOCUS-PACK-DARK-PERSONAL');
  });
});
