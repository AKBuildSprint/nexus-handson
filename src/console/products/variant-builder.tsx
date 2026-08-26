import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeliveryFixture, OptionGroupFixture, VariantFixture } from './product-ui-types';
import { SchemaChangePreview } from './schema-change-preview';
import { VariantMatrix } from './variant-matrix';

interface VariantBuilderProps {
  initialGroups: ReadonlyArray<OptionGroupFixture>;
  initialVariants: ReadonlyArray<VariantFixture>;
  basePrice: string;
  currency: string;
  productDelivery: DeliveryFixture;
  resetKey: number;
  onDirty: () => void;
  onBlockersChange: (blockers: string[]) => void;
  onTransientDirtyChange: (dirty: boolean) => void;
  onSchemaChange?: (groups: OptionGroupFixture[], variants: VariantFixture[]) => void;
  onPendingVariantFileChange?: (variantId: string, change: File | 'remove' | null) => void;
  onRegenerate?: (groups: OptionGroupFixture[], variants: VariantFixture[]) => Promise<VariantFixture[] | void>;
  serverFieldErrors?: Array<{ path: string; message: string }>;
}

interface GroupError {
  nameError: string;
  groupValueError: string;
  valueErrors: string[];
}

function liveCombinationCount(groups: ReadonlyArray<OptionGroupFixture>) {
  const participating = groups.filter((group) => group.participating);
  if (participating.length === 0 || participating.some((group) => group.values.filter((value) => value.trim()).length === 0)) return 0;
  return participating.reduce((count, group) => count * group.values.filter((value) => value.trim()).length, 1);
}

function createSuggestedRows(groups: ReadonlyArray<OptionGroupFixture>, basePrice: string, maximumRows = 30) {
  const participating = groups.filter((group) => group.participating);
  if (participating.length === 0 || participating.some((group) => group.values.filter((value) => value.trim()).length === 0)) return [];

  let combinations: Array<Array<{ label: string; ref: string }>> = [[]];
  for (const group of participating) {
    const next: Array<Array<{ label: string; ref: string }>> = [];
    const values = group.values.flatMap((value, valueIndex) => value.trim() ? [{
      label: value.trim(),
      ref: group.valueRefs?.[valueIndex] ?? `group:${group.id}:value:${valueIndex}`,
    }] : []);
    for (const prefix of combinations) {
      for (const value of values) {
        next.push([...prefix, value]);
        if (next.length >= maximumRows) break;
      }
      if (next.length >= maximumRows) break;
    }
    combinations = next;
  }

  return combinations.map<VariantFixture>((values, index) => {
    const suggestion = values.map((value) => value.label).join('-').toLocaleUpperCase().replace(/[^A-Z0-9]+/g, '-');
    return {
      id: `suggested-${index}-${suggestion}`,
      combination: values.map((value) => value.label).join(' / '),
      selectedValueRefs: values.map((value) => value.ref),
      sku: `PRODUCT-${suggestion}`,
      priceOverride: '',
      effectivePrice: `$${basePrice || '0.00'}`,
      priceSource: 'Base price',
      deliverySource: 'Product default',
      enabled: true,
    };
  });
}

function variantSelectionKey(row: VariantFixture): string {
  return row.selectedValueRefs ? row.selectedValueRefs.join('\u0000') : `display:${row.combination}`;
}

function deriveRegenerationRows(
  groups: ReadonlyArray<OptionGroupFixture>,
  currentRows: ReadonlyArray<VariantFixture>,
  basePrice: string,
) {
  const nextRows = createSuggestedRows(groups, basePrice);
  const currentBySelection = new Map(currentRows.map((row) => [variantSelectionKey(row), row]));
  const nextSelections = new Set(nextRows.map(variantSelectionKey));
  const retainedAndNew = nextRows.map((row) => {
    const current = currentBySelection.get(variantSelectionKey(row));
    return current ? { ...current, combination: row.combination, selectedValueRefs: row.selectedValueRefs, outcome: 'Retained' as const } : { ...row, outcome: 'New' as const };
  });
  const obsolete = currentRows
    .filter((row) => !nextSelections.has(variantSelectionKey(row)))
    .map((row) => ({ ...row, outcome: 'Will disable' as const }));
  return [...retainedAndNew, ...obsolete];
}

export function VariantBuilder({
  initialGroups,
  initialVariants,
  basePrice,
  currency,
  productDelivery,
  resetKey,
  onDirty,
  onBlockersChange,
  onTransientDirtyChange,
  onSchemaChange,
  onPendingVariantFileChange,
  onRegenerate,
  serverFieldErrors = [],
}: VariantBuilderProps) {
  const [groups, setGroups] = useState(() => initialGroups.map((group) => ({
    ...group,
    values: [...group.values],
    valueIds: group.valueIds ? [...group.valueIds] : undefined,
    valueRefs: group.valueRefs ? [...group.valueRefs] : undefined,
  })));
  const [matrixRows, setMatrixRows] = useState(() => initialVariants.map((variant) => ({ ...variant })));
  const [confirmed, setConfirmed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<VariantFixture[]>([]);
  const [structuralDirty, setStructuralDirty] = useState(false);
  const [matrixBlockers, setMatrixBlockers] = useState<string[]>([]);
  const skipSchemaPublishRef = useRef(true);

  useEffect(() => {
    skipSchemaPublishRef.current = true;
    setGroups(initialGroups.map((group) => ({
      ...group,
      values: [...group.values],
      valueIds: group.valueIds ? [...group.valueIds] : undefined,
      valueRefs: group.valueRefs ? [...group.valueRefs] : undefined,
    })));
    setMatrixRows(initialVariants.map((variant) => ({ ...variant })));
    setConfirmed(false);
    setPreviewOpen(false);
    setStructuralDirty(false);
    setMatrixBlockers([]);
    setPreviewRows([]);
  }, [resetKey]);

  const combinationCount = useMemo(() => liveCombinationCount(groups), [groups]);
  const warning = combinationCount >= 11 && combinationCount <= 30;
  const blocked = combinationCount >= 31;

  const groupErrors = useMemo<GroupError[]>(() => {
    const seenNames = new Set<string>();
    return groups.map((group) => {
      const normalizedName = group.name.trim().toLocaleLowerCase();
      let nameError = '';
      if (!normalizedName) nameError = 'Option group name is required.';
      else if (seenNames.has(normalizedName)) nameError = `Option group ${group.name.trim()} is repeated.`;
      seenNames.add(normalizedName);

      const groupValueError = group.values.length === 0 ? `Add at least one value to ${group.name || 'this option group'}.` : '';
      const seenValues = new Set<string>();
      const valueErrors = group.values.map((value) => {
        const normalizedValue = value.trim().toLocaleLowerCase();
        if (!normalizedValue) return 'Option value is required.';
        if (seenValues.has(normalizedValue)) return `Value ${value.trim()} is repeated in ${group.name || 'this group'}.`;
        seenValues.add(normalizedValue);
        return '';
      });
      return { nameError, groupValueError, valueErrors };
    });
  }, [groups]);
  const serverMessage = (...paths: string[]) => serverFieldErrors.find((field) => paths.includes(field.path))?.message ?? '';

  const invalid = groupErrors.some((group) => group.nameError || group.groupValueError || group.valueErrors.some(Boolean));
  const regenerationRows = useMemo(
    () => deriveRegenerationRows(groups, matrixRows, basePrice),
    [basePrice, groups, matrixRows],
  );

  const blockers = useMemo(() => {
    const next: string[] = [];
    groupErrors.forEach((group) => {
      if (group.nameError) next.push(group.nameError);
      if (group.groupValueError) next.push(group.groupValueError);
      next.push(...group.valueErrors.filter(Boolean));
    });
    if (groups.length > 0 && combinationCount === 0 && !invalid) next.push('Select at least one complete option group to generate Variants.');
    if (blocked) next.push(`${combinationCount} combinations exceeds the maximum of 30.`);
    if (structuralDirty && matrixRows.length > 0) next.push('Preview and apply the structural Variant regeneration before saving Product.');
    next.push(...matrixBlockers);
    return next;
  }, [blocked, combinationCount, groupErrors, groups.length, invalid, matrixBlockers, matrixRows.length, structuralDirty]);

  useEffect(() => {
    onBlockersChange(blockers);
  }, [blockers, onBlockersChange]);
  useEffect(() => {
    if (skipSchemaPublishRef.current) {
      skipSchemaPublishRef.current = false;
      return;
    }
    onSchemaChange?.(groups, matrixRows);
  }, [groups, matrixRows, onSchemaChange]);


  const markStructuralDirty = () => {
    setStructuralDirty(true);
    setConfirmed(false);
    setPreviewOpen(false);
    onDirty();
  };

  const updateGroup = (groupId: string, patch: Partial<OptionGroupFixture>, structural = true) => {
    setGroups((current) => current.map((group) => (group.id === groupId ? { ...group, ...patch } : group)));
    if (structural) markStructuralDirty();
    else onDirty();
  };

  const updateValue = (groupId: string, valueIndex: number, value: string) => {
    const existingIdentity = groups.find((group) => group.id === groupId)?.valueIds?.[valueIndex] ?? null;
    setGroups((current) => current.map((group) => {
      if (group.id !== groupId) return group;
      const values = [...group.values];
      values[valueIndex] = value;
      return { ...group, values };
    }));
    if (existingIdentity !== null) onDirty();
    else markStructuralDirty();
  };

  const removeValue = (groupId: string, valueIndex: number) => {
    setGroups((current) => current.map((group) => group.id === groupId ? {
      ...group,
      values: group.values.filter((_, index) => index !== valueIndex),
      valueIds: group.valueIds?.filter((_, index) => index !== valueIndex),
      valueRefs: group.valueRefs?.filter((_, index) => index !== valueIndex),
    } : group));
    markStructuralDirty();
  };

  const addValue = (groupId: string) => {
    setGroups((current) => current.map((group) => {
      if (group.id !== groupId) return group;
      const nextIndex = group.values.length;
      return {
        ...group,
        values: [...group.values, `Value ${nextIndex + 1}`],
        valueIds: [...(group.valueIds ?? group.values.map(() => null)), null],
        valueRefs: [
          ...(group.valueRefs ?? group.values.map(() => `draft-value-${crypto.randomUUID()}`)),
          `draft-value-${crypto.randomUUID()}`,
        ],
      };
    }));
    markStructuralDirty();
  };

  const addGroup = () => {
    if (groups.length >= 5) return;
    const id = `draft-group-${crypto.randomUUID()}`;
    setGroups((current) => [...current, {
      id,
      name: '',
      values: [''],
      valueIds: [null],
      valueRefs: [`draft-value-${crypto.randomUUID()}`],
      participating: true,
    }]);
    markStructuralDirty();
  };

  const meterMessage = blocked
    ? `${combinationCount} combinations exceeds the 30-combination limit. Remove an option value or participating group.`
    : combinationCount === 30
      ? '30 combinations is the maximum. Confirm to continue.'
      : warning
        ? `${combinationCount} combinations. Review the matrix and confirm before generating.`
        : combinationCount === 10
          ? '10 combinations. Ready to generate.'
          : combinationCount === 0
            ? (groups.length === 0 && matrixRows.length > 0
              ? 'Generate a preview to remove the current Variant schema.'
              : 'Select at least one option group and value to generate combinations.')
            : 'Ready to generate.';
  const generateDisabled = (combinationCount === 0 && groups.length > 0) || blocked || invalid || (warning && !confirmed);

  const generateMatrix = async () => {
    const proposed = createSuggestedRows(groups, basePrice);
    let generated = proposed;
    try {
      generated = await onRegenerate?.(groups, proposed) ?? proposed;
    } catch (error) {
      setMatrixBlockers([error instanceof Error ? error.message : 'The Variant schema preview could not be generated.']);
      return;
    }
    setMatrixBlockers([]);
    if (matrixRows.length > 0 && structuralDirty) {
      setPreviewOpen(true);
      setPreviewRows(generated);
      return;
    }
    setMatrixRows(generated);
    setStructuralDirty(false);
    onSchemaChange?.(groups, generated);
    onDirty();
  };

  return (
    <div className="section-stack">
      <div className="notice notice-info">
        <strong>One active Variant schema</strong>
        <span>Add up to 5 option groups with up to 10 values in each group. Only participating groups contribute to the Cartesian count.</span>
      </div>


      {groups.length === 0 ? (
        <div className="notice notice-info">
          <strong>This is currently a simple Product.</strong>
          <span>Add an option group to build purchasable Variant combinations.</span>
        </div>
      ) : (
        <div className="option-group-list">
          {groups.map((group, groupIndex) => (
            <section className="option-group" key={group.id} aria-labelledby={`group-title-${group.id}`}>
              <div className="option-group-header">
                <div className="field">
                  <label id={`group-title-${group.id}`} htmlFor={`group-name-${group.id}`}>Option group {groupIndex + 1}</label>
                  <input
                    id={`group-name-${group.id}`}
                    value={group.name}
                    aria-invalid={Boolean(groupErrors[groupIndex]?.nameError || serverMessage(`/optionLabels/groups/${groupIndex}/name`, `/schema/groups/${groupIndex}/name`))}
                    aria-describedby={groupErrors[groupIndex]?.nameError || serverMessage(`/optionLabels/groups/${groupIndex}/name`, `/schema/groups/${groupIndex}/name`) ? `group-name-error-${group.id}` : undefined}
                    onChange={(event) => updateGroup(group.id, { name: event.target.value }, false)}
                  />
                  {groupErrors[groupIndex]?.nameError || serverMessage(`/optionLabels/groups/${groupIndex}/name`, `/schema/groups/${groupIndex}/name`) ? <span className="field-error" id={`group-name-error-${group.id}`}>{groupErrors[groupIndex]?.nameError || serverMessage(`/optionLabels/groups/${groupIndex}/name`, `/schema/groups/${groupIndex}/name`)}</span> : null}
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={group.participating} onChange={(event) => updateGroup(group.id, { participating: event.target.checked })} />
                  {group.participating ? 'Participating' : 'Not participating'}
                </label>
                <button
                  className="button button-danger"
                  type="button"
                  aria-label={`Remove option group ${group.name || groupIndex + 1}`}
                  onClick={() => {
                    setGroups((current) => current.filter((candidate) => candidate.id !== group.id));
                    markStructuralDirty();
                  }}
                >
                  Remove group
                </button>
              </div>

              {groupErrors[groupIndex]?.groupValueError ? <p className="field-error" role="alert">{groupErrors[groupIndex].groupValueError}</p> : null}
              <div className="option-values">
                {group.values.map((value, valueIndex) => (
                  <div className="value-control" key={`${group.id}-${valueIndex}`}>
                    <div className="field">
                      <label htmlFor={`value-${group.id}-${valueIndex}`}>Value {valueIndex + 1}</label>
                      <input
                        id={`value-${group.id}-${valueIndex}`}
                        value={value}
                        aria-invalid={Boolean(groupErrors[groupIndex]?.valueErrors[valueIndex] || serverMessage(`/optionLabels/groups/${groupIndex}/values/${valueIndex}/label`, `/schema/groups/${groupIndex}/values/${valueIndex}/label`))}
                        aria-describedby={groupErrors[groupIndex]?.valueErrors[valueIndex] || serverMessage(`/optionLabels/groups/${groupIndex}/values/${valueIndex}/label`, `/schema/groups/${groupIndex}/values/${valueIndex}/label`) ? `value-error-${group.id}-${valueIndex}` : undefined}
                        onChange={(event) => updateValue(group.id, valueIndex, event.target.value)}
                      />
                      {groupErrors[groupIndex]?.valueErrors[valueIndex] || serverMessage(`/optionLabels/groups/${groupIndex}/values/${valueIndex}/label`, `/schema/groups/${groupIndex}/values/${valueIndex}/label`) ? <span className="field-error" id={`value-error-${group.id}-${valueIndex}`}>{groupErrors[groupIndex]?.valueErrors[valueIndex] || serverMessage(`/optionLabels/groups/${groupIndex}/values/${valueIndex}/label`, `/schema/groups/${groupIndex}/values/${valueIndex}/label`)}</span> : null}
                    </div>
                    <button className="icon-button" type="button" aria-label={`Remove value ${value || valueIndex + 1} from ${group.name || 'option group'}`} onClick={() => removeValue(group.id, valueIndex)}>×</button>
                  </div>
                ))}
              </div>

              <div className="inline-actions">
                <button className="button" type="button" disabled={group.values.length >= 10} onClick={() => addValue(group.id)}>Add value</button>
                <span className="meta-text numeric">{group.values.length} of 10 values</span>
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="inline-actions">
        <button className="button" type="button" disabled={groups.length >= 5} onClick={addGroup}>Add option group</button>
        <span className="meta-text numeric">{groups.length} of 5 option groups</span>
      </div>

      <section className={`combination-meter${warning ? ' warning' : ''}${blocked ? ' blocked' : ''}`} aria-live="polite" aria-label={`${combinationCount} combinations. ${meterMessage}`}>
        <div className="meter-count"><strong>{combinationCount}</strong><span>combinations</span></div>
        <div className="meter-copy">
          <strong>{blocked ? 'Blocked' : warning ? 'Confirmation required' : 'Generation status'}</strong>
          <span>{meterMessage}</span>
          {warning ? (
            <label className="checkbox-row">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              I reviewed this {combinationCount}-combination matrix.
            </label>
          ) : null}
        </div>
        <div className="meter-track-wrap" aria-hidden="true">
          <div className="meter-track">
            <div className="meter-fill" style={{ transform: `scaleX(${Math.min(combinationCount, 31) / 31})` }} />
            <span className="meter-marker meter-marker-ten" />
            <span className="meter-marker meter-marker-thirty" />
          </div>
          <div className="meter-labels"><span className="meter-label-ten">10</span><span className="meter-label-thirty">30</span></div>
        </div>
        <button className="button button-primary" type="button" disabled={generateDisabled} onClick={generateMatrix}>
          {matrixRows.length > 0 && structuralDirty ? 'Preview regeneration' : 'Generate matrix'}
        </button>
      </section>

      {previewOpen ? (
        <SchemaChangePreview
          rows={previewRows.length > 0 ? previewRows : regenerationRows}
          combinationCount={combinationCount}
          onApply={(proposedRows) => {
            const applied = proposedRows
              .filter((row) => row.outcome !== 'Will disable')
              .map((row) => ({ ...row, outcome: undefined }));
            setMatrixRows(applied);
            setPreviewOpen(false);
            setStructuralDirty(false);
            onSchemaChange?.(groups, applied);
            onDirty();
          }}
          onCancel={() => setPreviewOpen(false)}
        />
      ) : null}

      <VariantMatrix
        variants={matrixRows}
        basePrice={basePrice}
        onPendingVariantFileChange={onPendingVariantFileChange}
        currency={currency}
        productDelivery={productDelivery}
        onRowsChange={(rows) => {
          setMatrixRows(rows);
          onSchemaChange?.(groups, rows);
        }}
        onDirty={onDirty}
        onBlockersChange={setMatrixBlockers}
        onTransientDirtyChange={onTransientDirtyChange}
        serverFieldErrors={serverFieldErrors}
      />
    </div>
  );
}
