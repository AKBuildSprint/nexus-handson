import { describe, expect, it } from 'vitest';
import {
  DraftReferenceValidationError,
  validateAndMapSchemaDraft,
  type SchemaDraft,
} from '../../src/shared/schema-draft-refs';

function validDraft(): SchemaDraft {
  return {
    confirmCombinations: false,
    groups: [
      {
        draftRef: 'client-group-theme',
        id: null,
        name: 'Theme',
        position: 0,
        participating: true,
        values: [
          { draftRef: 'client-value-dark', id: null, label: 'Dark', position: 0 },
          { draftRef: 'client-value-light', id: null, label: 'Light', position: 1 },
        ],
      },
      {
        draftRef: 'client-group-notes',
        id: 'group-existing-notes',
        name: 'Notes',
        position: 1,
        participating: false,
        values: [{ draftRef: 'client-value-notes', id: 'value-existing-notes', label: 'Included', position: 0 }],
      },
    ],
    rows: [
      {
        id: null,
        selectedValueRefs: ['client-value-dark'],
        sku: 'FOCUS-DARK',
        status: 'enabled',
        priceOverride: null,
        delivery: { source: 'product_default' },
      },
    ],
  };
}

describe('SchemaDraft request-local references', () => {
  it('rejects repeated group and globally repeated value references', () => {
    const draft = validDraft();
    draft.groups[1].draftRef = draft.groups[0].draftRef;
    draft.groups[1].values[0].draftRef = draft.groups[0].values[0].draftRef;

    expect(() => validateAndMapSchemaDraft(draft)).toThrow(DraftReferenceValidationError);
    try {
      validateAndMapSchemaDraft(draft);
    } catch (error) {
      expect(error).toBeInstanceOf(DraftReferenceValidationError);
      expect((error as DraftReferenceValidationError).fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: '/schema/groups/1/draftRef', code: 'invalid_draft_reference' }),
          expect.objectContaining({ path: '/schema/groups/1/values/0/draftRef', code: 'invalid_draft_reference' }),
        ]),
      );
    }
  });

  it('rejects unknown, duplicate, and cross-group selections', () => {
    const draft = validDraft();
    draft.rows[0].selectedValueRefs = [
      'client-value-dark',
      'client-value-dark',
      'client-value-notes',
      'client-value-unknown',
    ];

    expect(() => validateAndMapSchemaDraft(draft)).toThrow(DraftReferenceValidationError);
    try {
      validateAndMapSchemaDraft(draft);
    } catch (error) {
      const messages = (error as DraftReferenceValidationError).fields.map((field) => field.message);
      expect(messages).toEqual(
        expect.arrayContaining([
          'A row may select a value draft reference only once.',
          'Rows cannot select values from a nonparticipating group.',
          'The selected value draft reference does not exist in this schema.',
        ]),
      );
    }
  });

  it('requires one selected value from every participating group', () => {
    const draft = validDraft();
    draft.groups[1].participating = true;

    expect(() => validateAndMapSchemaDraft(draft)).toThrowError(/references are invalid/i);
  });

  it('maps refs deterministically without using a client ref as persisted identity', () => {
    const first = validateAndMapSchemaDraft(validDraft());
    const second = validateAndMapSchemaDraft(validDraft());

    expect(first).toEqual(second);
    expect(first.groupIdByDraftRef).toEqual(
      new Map([
        ['client-group-theme', 'prospective-group-0001'],
        ['client-group-notes', 'group-existing-notes'],
      ]),
    );
    expect(first.valueIdByDraftRef).toEqual(
      new Map([
        ['client-value-dark', 'prospective-value-0001'],
        ['client-value-light', 'prospective-value-0002'],
        ['client-value-notes', 'value-existing-notes'],
      ]),
    );
    expect(first.rows[0].selectedValueIds).toEqual(['prospective-value-0001']);

    const clientRefs = new Set([
      ...validDraft().groups.map((group) => group.draftRef),
      ...validDraft().groups.flatMap((group) => group.values.map((value) => value.draftRef)),
    ]);
    const mappedIds = [
      ...first.groups.map((group) => group.id),
      ...first.groups.flatMap((group) => group.values.map((value) => value.id)),
      ...first.rows.flatMap((row) => row.selectedValueIds),
    ];
    expect(mappedIds.some((id) => clientRefs.has(id))).toBe(false);
  });

  it('maps object-prototype property names as ordinary request-local refs', () => {
    const draft = validDraft();
    draft.groups[0].draftRef = 'constructor';
    draft.groups[0].values[0].draftRef = '__proto__';
    draft.groups[0].values[1].draftRef = 'toString';
    draft.rows[0].selectedValueRefs = ['__proto__'];

    const mapping = validateAndMapSchemaDraft(draft);

    expect(mapping.groupIdByDraftRef.get('constructor')).toBe('prospective-group-0001');
    expect(mapping.valueIdByDraftRef.get('__proto__')).toBe('prospective-value-0001');
    expect(mapping.valueIdByDraftRef.get('toString')).toBe('prospective-value-0002');
    expect(mapping.rows[0].selectedValueIds).toEqual(['prospective-value-0001']);
  });

  it('skips every supplied group/value ID that collides with a prospective candidate', () => {
    const draft = validDraft();
    draft.groups[1].id = 'prospective-group-0001';
    draft.groups[1].values[0].id = 'prospective-value-0001';

    const mapping = validateAndMapSchemaDraft(draft);

    expect(mapping.groupIdByDraftRef.get('client-group-theme')).toBe('prospective-group-0002');
    expect(mapping.groupIdByDraftRef.get('client-group-notes')).toBe('prospective-group-0001');
    expect(mapping.valueIdByDraftRef.get('client-value-dark')).toBe('prospective-value-0002');
    expect(mapping.valueIdByDraftRef.get('client-value-light')).toBe('prospective-value-0003');
    expect(mapping.valueIdByDraftRef.get('client-value-notes')).toBe('prospective-value-0001');
    expect(new Set(mapping.groups.map((group) => group.id)).size).toBe(2);
    expect(new Set(mapping.groups.flatMap((group) => group.values.map((value) => value.id))).size).toBe(3);
  });
});
