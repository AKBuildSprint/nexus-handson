import {
  CSV_PREVIEW_LABELS,
  CSV_RESULT_LABELS,
  type CsvImportOutcome,
  type CsvPreviewOutcome,
  type ImportResultResponse,
} from '@nexus/catalog/shared/csv-contract';
import type { CsvValidationResult, ValidatedCsvGroup } from '@nexus/catalog/import/csv-validator';

export type CsvDisplayFailure =
  | { kind: 'request'; message: string }
  | { kind: 'result'; code: 'CI-RESULT-ERROR'; message: string; rawBody: string; retainedBody: unknown };

interface CsvPreviewTableProps {
  validation: CsvValidationResult | null;
  result: ImportResultResponse | null;
  phase: 'idle' | 'uploading' | 'checking';
  failure: CsvDisplayFailure | null;
}

function OutcomeTag({ outcome }: { outcome: CsvPreviewOutcome | CsvImportOutcome }) {
  const label = outcome === 'ready' || outcome === 'duplicate_candidate' || outcome === 'rejected'
    ? CSV_PREVIEW_LABELS[outcome]
    : CSV_RESULT_LABELS[outcome];
  const className = outcome === 'added' || outcome === 'ready'
    ? 'outcome-added'
    : outcome === 'duplicate' || outcome === 'duplicate_candidate'
      ? 'outcome-duplicate'
      : 'outcome-rejected';
  return <span className={`outcome-tag ${className}`}>{label}</span>;
}

function groupOutcome(group: ValidatedCsvGroup): CsvPreviewOutcome {
  return group.rows[0]?.outcome ?? 'rejected';
}

export function CsvPreviewTable({ validation, result, phase, failure }: CsvPreviewTableProps) {
  if (result) {
    const allRejected = result.counts.rejected > 0 && result.counts.added === 0 && result.counts.duplicate === 0;
    const allDuplicate = result.counts.duplicate > 0 && result.counts.added === 0 && result.counts.rejected === 0;
    return (
      <section className={`csv-preview notice ${allRejected ? 'notice-error' : 'notice-success'}`} aria-labelledby="import-result-title">
        <div className="csv-preview-head">
          <h2 id="import-result-title" tabIndex={-1}>Import result</h2>
        </div>
        <div className="csv-preview-body">
          <p>{allRejected
            ? 'Every Product group was rejected. The durable server reasons are listed below.'
            : allDuplicate
              ? 'No new catalog records were added. Every row exactly matched an existing record.'
              : 'This authoritative result supersedes the browser preview and remains available until another import starts.'}</p>
          <div className="summary-row" aria-label="Authoritative import result counts">
            <span className="summary-stat"><strong className="numeric">{result.counts.added}</strong><span>Added</span></span>
            <span className="summary-stat"><strong className="numeric">{result.counts.duplicate}</strong><span>Duplicate</span></span>
            <span className="summary-stat"><strong className="numeric">{result.counts.rejected}</strong><span>Rejected</span></span>
          </div>
          <div>
            {result.groups.flatMap((group) => group.rows).sort((left, right) => left.row - right.row).map((row) => (
              <article className="result-row" key={`${row.row}-${row.productSlug}-${row.variantSku ?? 'product'}`}>
                <div>
                  <strong>Row {row.row} · {row.productSlug}{row.variantSku ? ` · ${row.variantSku}` : ''}</strong>
                  <p>{row.reason ?? 'The server completed this row without an additional reason.'}</p>
                </div>
                <OutcomeTag outcome={row.outcome} />
              </article>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (failure) {
    const resultError = failure.kind === 'result';
    const titleId = resultError ? 'import-result-error-title' : 'import-failure-title';
    return (
      <section className="csv-preview notice notice-error" aria-labelledby={titleId} data-state={failure.kind === 'result' ? failure.code : undefined}>
        <div className="csv-preview-head">
          <h2 id={titleId} tabIndex={-1}>{resultError ? 'Import result could not be displayed' : 'CSV import failed'}</h2>
        </div>
        <div className="csv-preview-body">
          <p>{failure.message}</p>
          <p>{resultError
            ? 'No authoritative counts are shown. The received response is retained locally; starting another import will not re-submit this committed CSV.'
            : 'No authoritative counts are shown for this request failure. The selected file and browser preview remain available to retry.'}</p>
        </div>
      </section>
    );
  }

  if (!validation) {
    return (
      <section className="csv-preview" aria-labelledby="browser-preview-title">
        <div className="csv-preview-head">
          <h2 id="browser-preview-title">Browser preview</h2>
        </div>
        <div className="csv-preview-body">
          <p>Choose a CSV to inspect detected Product groups before any import action.</p>
        </div>
      </section>
    );
  }

  const ready = validation.groups.filter((group) => groupOutcome(group) === 'ready').length;
  const duplicate = validation.groups.filter((group) => groupOutcome(group) === 'duplicate_candidate').length;
  const rejected = validation.groups.filter((group) => groupOutcome(group) === 'rejected').length;
  const progressLabel = phase === 'uploading' ? 'Uploading CSV' : phase === 'checking' ? 'Checking and importing Products' : null;
  const sourceRows = validation.groups.flatMap((group) => group.rows.map((row) => ({ group, row })))
    .sort((left, right) => left.row.source.sourceRow - right.row.source.sourceRow);
  const rowCount = validation.groups.reduce((count, group) => count + group.rows.length, 0);

  return (
    <section className="csv-preview" aria-labelledby="browser-preview-title" aria-busy={phase !== 'idle'}>
      <div className="csv-preview-head">
        <h2 id="browser-preview-title">Browser preview</h2>
        <span className="meta-text">Provisional. Server results replace these labels.</span>
        <div className="editor-spacer" />
        <span className="meta-text numeric">{validation.groups.length} Product groups · {rowCount} rows</span>
      </div>

      <div className="csv-preview-body">
        {progressLabel ? (
          <div className="notice notice-info" role="status">
            <strong>{progressLabel}</strong>
            <span>The browser preview remains readable and is not yet an authoritative result.</span>
          </div>
        ) : null}

        <div className="csv-group-list">
          {validation.groups.map((group) => {
            const outcome = groupOutcome(group);
            return (
              <details className="csv-group" key={`${group.productSlug}-${group.rows[0]?.source.sourceRow}`} open>
                <summary>
                  <span className="csv-group-identity">
                    <strong>{group.productSlug}</strong>
                    <span aria-hidden="true"> · </span>
                    <span className="csv-type-tag">{group.detectedType === 'variant' ? 'Variant' : 'Simple'} Product</span>
                  </span>
                  <div className="editor-spacer" />
                  <OutcomeTag outcome={outcome} />
                </summary>
                <div className="csv-group-body">
                  <span className="meta-text numeric">{group.rows.length === 1 ? `Row ${group.rows[0].source.sourceRow}` : `Rows ${group.rows[0].source.sourceRow} to ${group.rows.at(-1)?.source.sourceRow}`}</span>
                  {group.detectedType === 'variant'
                    ? <strong className="numeric">{group.derivedCombinationCount} derived combinations</strong>
                    : <strong>No Variant columns detected</strong>}
                  {group.issue ? <p className="field-error">{group.issue.reason}</p> : null}
                </div>
              </details>
            );
          })}
        </div>

        <div className="csv-preview-subhead">
          <h3>Source rows</h3>
          <p>Rows remain in source order with identity, provisional outcome, and the reason used by the browser preview.</p>
        </div>

        <div className="csv-group-list" aria-label="CSV source row preview">
          {sourceRows.map(({ group, row }) => (
            <details className="csv-group" key={`${row.source.sourceRow}-${group.productSlug}-${row.variant?.sku ?? 'product'}`} open>
              <summary>
                <span className="csv-row-identity">Row {row.source.sourceRow} · {group.productSlug}{row.variant?.sku ? ` · ${row.variant.sku}` : ''}</span>
                <div className="editor-spacer" />
                <OutcomeTag outcome={row.outcome} />
              </summary>
              <div className="csv-group-body">
                <strong>{row.issue?.reason ?? (row.outcome === 'duplicate_candidate'
                  ? 'This slug is already present in the loaded catalog. The server will decide exact Duplicate or Rejected status.'
                  : `Row passed browser checks as a ${group.detectedType === 'variant' ? 'Variant' : 'simple'} Product row.`)}</strong>
              </div>
            </details>
          ))}
        </div>
      </div>

      <div className="csv-preview-foot">
        <div className="summary-row" aria-label="Provisional browser preview counts">
          <span className="summary-stat"><strong className="numeric">{ready}</strong><span>Ready</span></span>
          <span className="summary-stat"><strong className="numeric">{duplicate}</strong><span>Duplicate candidate</span></span>
          <span className="summary-stat"><strong className="numeric">{rejected}</strong><span>Rejected</span></span>
        </div>
      </div>
    </section>
  );
}
