import type { VariantStatus } from './catalog-limits';

export type DraftRef = string;

export interface SchemaDraftValue {
  draftRef: DraftRef;
  id: string | null;
  label: string;
  position: number;
}

export interface SchemaDraftGroup {
  draftRef: DraftRef;
  id: string | null;
  name: string;
  position: number;
  participating: boolean;
  values: SchemaDraftValue[];
}

export interface SchemaDraftRow {
  id: string | null;
  selectedValueRefs: DraftRef[];
  sku: string;
  status: VariantStatus;
  priceOverride: string | null;
  delivery:
    | { source: 'product_default' }
    | { source: 'variant_override'; accessTitle: string; accessInstructions: string };
}

export interface SchemaDraft {
  groups: SchemaDraftGroup[];
  rows: SchemaDraftRow[];
  confirmCombinations: boolean;
}

export interface DraftReferenceFieldError {
  path: string;
  code: 'invalid_draft_reference';
  message: string;
}

export class DraftReferenceValidationError extends Error {
  readonly fields: DraftReferenceFieldError[];

  constructor(fields: DraftReferenceFieldError[]) {
    super('Schema draft references are invalid.');
    this.name = 'DraftReferenceValidationError';
    this.fields = fields;
  }
}

export interface ProspectiveSchemaMapping {
  groups: Array<{
    id: string;
    name: string;
    position: number;
    participating: boolean;
    values: Array<{ id: string; label: string; position: number }>;
  }>;
  rows: Array<{ id: string | null; selectedValueIds: string[] }>;
  groupIdByDraftRef: Map<DraftRef, string>;
  valueIdByDraftRef: Map<DraftRef, string>;
}

interface ValueReferenceOwner {
  groupIndex: number;
  participating: boolean;
}

function invalid(path: string, message: string): DraftReferenceFieldError {
  return { path, code: 'invalid_draft_reference', message };
}

export function validateAndMapSchemaDraft(draft: SchemaDraft): ProspectiveSchemaMapping {
  const errors: DraftReferenceFieldError[] = [];
  const groupRefs = new Set<string>();
  const valueOwners = new Map<string, ValueReferenceOwner>();
  const groupIds = new Set<string>();
  const valueIds = new Set<string>();

  draft.groups.forEach((group, groupIndex) => {
    const groupPath = `/schema/groups/${groupIndex}`;
    if (group.draftRef.trim() === '' || groupRefs.has(group.draftRef)) {
      errors.push(invalid(`${groupPath}/draftRef`, 'Group draft references must be nonempty and unique.'));
    } else {
      groupRefs.add(group.draftRef);
    }

    if (group.id !== null && groupIds.has(group.id)) {
      errors.push(invalid(`${groupPath}/id`, 'An existing group ID may map to only one draft reference.'));
    } else if (group.id !== null) {
      groupIds.add(group.id);
    }

    group.values.forEach((value, valueIndex) => {
      const valuePath = `${groupPath}/values/${valueIndex}`;
      if (value.draftRef.trim() === '' || valueOwners.has(value.draftRef)) {
        errors.push(invalid(`${valuePath}/draftRef`, 'Value draft references must be nonempty and globally unique.'));
      } else {
        valueOwners.set(value.draftRef, { groupIndex, participating: group.participating });
      }

      if (value.id !== null && valueIds.has(value.id)) {
        errors.push(invalid(`${valuePath}/id`, 'An existing value ID may map to only one draft reference.'));
      } else if (value.id !== null) {
        valueIds.add(value.id);
      }
    });
  });

  draft.rows.forEach((row, rowIndex) => {
    const selectedRefs = new Set<string>();
    const selectedByGroup = new Map<number, number>();

    row.selectedValueRefs.forEach((draftRef, selectedIndex) => {
      const path = `/schema/rows/${rowIndex}/selectedValueRefs/${selectedIndex}`;
      if (selectedRefs.has(draftRef)) {
        errors.push(invalid(path, 'A row may select a value draft reference only once.'));
        return;
      }
      selectedRefs.add(draftRef);

      const owner = valueOwners.get(draftRef);
      if (!owner) {
        errors.push(invalid(path, 'The selected value draft reference does not exist in this schema.'));
        return;
      }
      if (!owner.participating) {
        errors.push(invalid(path, 'Rows cannot select values from a nonparticipating group.'));
        return;
      }
      selectedByGroup.set(owner.groupIndex, (selectedByGroup.get(owner.groupIndex) ?? 0) + 1);
    });

    draft.groups.forEach((group, groupIndex) => {
      if (group.participating && selectedByGroup.get(groupIndex) !== 1) {
        errors.push(
          invalid(
            `/schema/rows/${rowIndex}/selectedValueRefs`,
            `A row must select exactly one value from participating group ${groupIndex + 1}.`,
          ),
        );
      }
    });
  });

  if (errors.length > 0) {
    throw new DraftReferenceValidationError(errors);
  }

  const groupIdByDraftRef = new Map<string, string>();
  const valueIdByDraftRef = new Map<string, string>();
  let prospectiveGroupSequence = 0;
  let prospectiveValueSequence = 0;
  const groups = draft.groups.map((group) => {
    let groupId = group.id;
    if (groupId === null) {
      do {
        prospectiveGroupSequence += 1;
        groupId = `prospective-group-${String(prospectiveGroupSequence).padStart(4, '0')}`;
      } while (groupIds.has(groupId));
      groupIds.add(groupId);
    }
    groupIdByDraftRef.set(group.draftRef, groupId);

    return {
      id: groupId,
      name: group.name,
      position: group.position,
      participating: group.participating,
      values: group.values.map((value) => {
        let valueId = value.id;
        if (valueId === null) {
          do {
            prospectiveValueSequence += 1;
            valueId = `prospective-value-${String(prospectiveValueSequence).padStart(4, '0')}`;
          } while (valueIds.has(valueId));
          valueIds.add(valueId);
        }
        valueIdByDraftRef.set(value.draftRef, valueId);
        return { id: valueId, label: value.label, position: value.position };
      }),
    };
  });

  return {
    groups,
    rows: draft.rows.map((row) => ({
      id: row.id,
      selectedValueIds: row.selectedValueRefs.map((draftRef) => {
        const valueId = valueIdByDraftRef.get(draftRef);
        if (valueId === undefined) {
          throw new Error('Validated value draft reference did not receive a prospective ID.');
        }
        return valueId;
      }),
    })),
    groupIdByDraftRef,
    valueIdByDraftRef,
  };
}
