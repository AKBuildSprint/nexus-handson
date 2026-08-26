import {
  CSV_PREVIEW_LABELS,
  CSV_RESULT_LABELS,
  type CsvImportOutcome,
  type CsvPreviewOutcome,
  type ImportResultResponse,
} from '../../shared/csv-contract';
import type { CsvValidationResult, ValidatedCsvGroup } from '../../import/csv-validator';

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
        <div className="section-heading">
          <h2 id="import-result-title" tabIndex={-1}>Import result</h2>
          <p>{allRejected
            ? 'Every Product group was rejected. The durable server reasons are listed below.'
            : allDuplicate
              ? 'No new catalog records were added. Every row exactly matched an existing record.'
              : 'This authoritative result supersedes the browser preview and remains available until another import starts.'}</p>
        </div>
        <div className="result-counts" aria-label="Authoritative import result counts">
          <div className="result-count"><strong>{result.counts.added}</strong><span>Added</span></div>
          <div className="result-count"><strong>{result.counts.duplicate}</strong><span>Duplicate</span></div>
          <div className="result-count"><strong>{result.counts.rejected}</strong><span>Rejected</span></div>
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
      </section>
    );
  }

  if (failure) {
    const resultError = failure.kind === 'result';
    const titleId = resultError ? 'import-result-error-title' : 'import-failure-title';
    return (
      <section className="csv-preview notice notice-error" aria-labelledby={titleId} data-state={failure.kind === 'result' ? failure.code : undefined}>
        <div className="section-heading">
          <h2 id={titleId} tabIndex={-1}>{resultError ? 'Import result could not be displayed' : 'CSV import failed'}</h2>
          <p>{failure.message}</p>
        </div>
        <p>{resultError
          ? 'No authoritative counts are shown. The received response is retained locally; starting another import will not re-submit this committed CSV.'
          : 'No authoritative counts are shown for this request failure. The selected file and browser preview remain available to retry.'}</p>
      </section>
    );
  }

  if (!validation) {
    return (
      <section className="csv-preview notice notice-info" aria-labelledby="browser-preview-title">
        <div className="section-heading">
          <h2 id="browser-preview-title">Browser preview</h2>
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

  return (
    <section className="csv-preview" aria-labelledby="browser-preview-title" aria-busy={phase !== 'idle'}>
      {progressLabel ? (
        <div className="notice notice-info" role="status">
          <strong>{progressLabel}</strong>
          <span>The browser preview remains readable and is not yet an authoritative result.</span>
        </div>
      ) : null}
      <div className="section-heading">
        <h2 id="browser-preview-title">Browser preview</h2>
        <p>Detected Product type comes from the fixed columns per product_slug. These labels are provisional and not server results.</p>
      </div>
      <div className="result-counts" aria-label="Provisional browser preview counts">
        <div className="result-count"><strong>{ready}</strong><span>Ready</span></div>
        <div className="result-count"><strong>{duplicate}</strong><span>Duplicate candidate</span></div>
        <div className="result-count"><strong>{rejected}</strong><span>Rejected</span></div>
      </div>
      <div className="csv-group-list">
        {validation.groups.map((group) => {
          const outcome = groupOutcome(group);
          return (
            <details className="csv-group" key={`${group.productSlug}-${group.rows[0]?.source.sourceRow}`} open>
              <summary>
                <span>{group.productSlug} · {group.detectedType === 'variant' ? 'Variant' : 'Simple'} Product</span>
                <OutcomeTag outcome={outcome} />
              </summary>
              <div className="csv-group-body">
                <span className="meta-text">{group.rows.length === 1 ? `Row ${group.rows[0].source.sourceRow}` : `Rows ${group.rows[0].source.sourceRow} to ${group.rows.at(-1)?.source.sourceRow}`}</span>
                {group.detectedType === 'variant'
                  ? <strong className="numeric">{group.derivedCombinationCount} derived combinations</strong>
                  : <strong>No Variant columns detected</strong>}
                {group.issue ? <p className="field-error">{group.issue.reason}</p> : null}
              </div>
            </details>
          );
        })}
      </div>
      <div className="section-heading">
        <h3>Source rows</h3>
        <p>Rows remain in source order with identity, provisional outcome, and the reason used by the browser preview.</p>
      </div>
      <div className="csv-group-list" aria-label="CSV source row preview">
        {sourceRows.map(({ group, row }) => (
          <details className="csv-group" key={`${row.source.sourceRow}-${group.productSlug}-${row.variant?.sku ?? 'product'}`} open>
            <summary>
              <span>Row {row.source.sourceRow} · {group.productSlug}{row.variant?.sku ? ` · ${row.variant.sku}` : ''}</span>
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
    </section>
  );
}
