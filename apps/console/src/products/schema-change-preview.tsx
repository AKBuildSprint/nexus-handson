import { useEffect, useState } from 'react';
import type { VariantFixture } from './product-ui-types';

interface SchemaChangePreviewProps {
  rows: ReadonlyArray<VariantFixture>;
  combinationCount: number;
  onApply: (rows: VariantFixture[]) => void;
  onCancel: () => void;
}

const outcomeClass: Record<NonNullable<VariantFixture['outcome']>, string> = {
  Retained: 'outcome-retained',
  New: 'outcome-new',
  'Will disable': 'outcome-disable',
};

export function SchemaChangePreview({ rows, combinationCount, onApply, onCancel }: SchemaChangePreviewProps) {
  const [previewRows, setPreviewRows] = useState(() => rows.map((row) => ({ ...row })));
  const [confirmed, setConfirmed] = useState(false);
  const requiresConfirmation = combinationCount >= 11 && combinationCount <= 30;
  const blocked = combinationCount >= 31;

  useEffect(() => {
    setPreviewRows(rows.map((row) => ({ ...row })));
    setConfirmed(false);
  }, [rows]);

  const counts = previewRows.reduce(
    (current, row) => {
      if (row.outcome === 'Retained') current.retained += 1;
      if (row.outcome === 'New') current.added += 1;
      if (row.outcome === 'Will disable') current.disabled += 1;
      return current;
    },
    { retained: 0, added: 0, disabled: 0 },
  );
  const skuErrors = previewRows.reduce<Record<string, string>>((current, row) => {
    if (row.outcome !== 'New') return current;
    const normalizedSku = row.sku.trim().toLocaleUpperCase();
    if (!normalizedSku) {
      current[row.id] = 'SKU is required for this New Variant.';
      return current;
    }
    const matchingRows = previewRows.filter((candidate) => (
      candidate.id !== row.id && candidate.sku.trim().toLocaleUpperCase() === normalizedSku
    ));
    const existingConflict = matchingRows.find((candidate) => candidate.outcome !== 'New');
    if (existingConflict) {
      current[row.id] = `SKU ${row.sku} conflicts with existing combination ${existingConflict.combination}.`;
    } else if (matchingRows.length > 0) {
      current[row.id] = `SKU ${row.sku} is duplicated in the proposed New rows.`;
    }
    return current;
  }, {});
  const skuBlockers = Object.values(skuErrors);

  return (
    <section className="notice notice-info" aria-labelledby="schema-preview-title">
      <div className="section-heading">
        <h3 id="schema-preview-title">Preview regeneration</h3>
        <p>These effects are derived from the edited option groups and current matrix. Review every New and Will disable row before applying.</p>
      </div>

      <div className="result-counts" aria-label="Regeneration effect counts">
        <div className="result-count"><strong>{counts.retained}</strong><span>Retained</span></div>
        <div className="result-count"><strong>{counts.added}</strong><span>New</span></div>
        <div className="result-count"><strong>{counts.disabled}</strong><span>Will disable</span></div>
      </div>

      {skuBlockers.length > 0 ? (
        <div className="notice notice-error" role="alert">
          <strong>Fix New Variant SKUs before regenerating</strong>
          <ul>
            {Object.entries(skuErrors).map(([rowId, message]) => (
              <li key={rowId}><a href={`#regeneration-sku-${rowId}`}>{message}</a></li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="regeneration-preview">
        {previewRows.map((row) => (
          <div className="regeneration-row" key={row.id}>
            <div>
              <strong>{row.combination}</strong>
              <p className="meta-text">SKU {row.sku || 'Missing'}. Price source {row.priceSource}. Delivery source {row.deliverySource}. Status {row.enabled ? 'Enabled' : 'Disabled'}.</p>
              {row.outcome === 'New' ? (
                <div className="field">
                  <label htmlFor={`regeneration-sku-${row.id}`}>Suggested SKU for {row.combination}</label>
                  <input
                    id={`regeneration-sku-${row.id}`}
                    value={row.sku}
                    aria-invalid={Boolean(skuErrors[row.id])}
                    aria-describedby={skuErrors[row.id] ? `regeneration-sku-error-${row.id}` : undefined}
                    onChange={(event) => {
                      setPreviewRows((current) => current.map((candidate) => (
                        candidate.id === row.id ? { ...candidate, sku: event.target.value } : candidate
                      )));
                    }}
                  />
                  <span className="field-help">Suggested by the prototype and editable before applying.</span>
                  {skuErrors[row.id] ? <span className="field-error" id={`regeneration-sku-error-${row.id}`}>{skuErrors[row.id]}</span> : null}
                </div>
              ) : null}
            </div>
            {row.outcome ? <span className={`outcome-tag ${outcomeClass[row.outcome]}`}>{row.outcome}</span> : null}
          </div>
        ))}
      </div>

      {requiresConfirmation ? (
        <label className="checkbox-row">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I reviewed the {combinationCount} proposed combinations and want to regenerate this matrix.
        </label>
      ) : null}

      {blocked ? (
        <div className="notice notice-error" role="alert">
          <strong>Regeneration is blocked.</strong>
          <span>{combinationCount} combinations exceeds the maximum of 30. Remove an option value or participating group.</span>
        </div>
      ) : null}

      <div className="inline-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={blocked || skuBlockers.length > 0 || (requiresConfirmation && !confirmed)}
          onClick={() => onApply(previewRows.map((row) => ({ ...row })))}
        >
          Regenerate matrix
        </button>
        <button className="button" type="button" onClick={onCancel}>Keep current schema</button>
      </div>
    </section>
  );
}
