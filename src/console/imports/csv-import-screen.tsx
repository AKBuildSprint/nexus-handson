import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { normalizeComparisonKey } from '../../catalog/slug';
import { CsvContractError, parseCsvBytes } from '../../import/csv-parser';
import { validateCsvRows, type CsvValidationResult } from '../../import/csv-validator';
import { CSV_FILENAME, CSV_MAX_BYTES, CSV_MAX_DATA_ROWS, type ImportResultResponse } from '../../shared/csv-contract';
import { ConsoleApiError, ConsoleImportResultError, downloadCsvTemplate, fetchProducts, importCsvProducts } from '../api-client';
import { CsvPreviewTable, type CsvDisplayFailure } from './csv-preview-table';

interface CsvImportScreenProps {
  onBack: () => void;
  onReset?: () => void;
  onShowResult?: () => void;
  scenario?: unknown;
}

interface FileCheck {
  status: 'idle' | 'checking' | 'valid' | 'error';
  name?: string;
  sizeLabel?: string;
  rows?: number;
  message?: string;
}

function sizeLabel(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${(bytes / 1_000).toFixed(1)} KB`;
}

const UPLOADING_STATE_MINIMUM_MS = 100;

function waitForUploadingMinimum(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => window.setTimeout(resolve, UPLOADING_STATE_MINIMUM_MS));
  });
}

export function CsvImportScreen({ onBack, onReset, onShowResult }: CsvImportScreenProps) {
  const [dragActive, setDragActive] = useState(false);
  const [fileCheck, setFileCheck] = useState<FileCheck>({ status: 'idle' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<CsvValidationResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'checking'>('idle');
  const [templateState, setTemplateState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<ImportResultResponse | null>(null);
  const [failure, setFailure] = useState<CsvDisplayFailure | null>(null);
  const [catalogIdentities, setCatalogIdentities] = useState<
    { status: 'loading'; slugs: string[] } | { status: 'ready'; slugs: string[] } | { status: 'error'; slugs: string[] }
  >({ status: 'loading', slugs: [] });
  const operationSequenceRef = useRef(0);
  const importInFlightRef = useRef(false);
  const importAbortRef = useRef<AbortController | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);
  const catalogSequenceRef = useRef(0);

  const loadCatalogIdentities = useCallback(() => {
    const sequence = catalogSequenceRef.current + 1;
    catalogSequenceRef.current = sequence;
    catalogAbortRef.current?.abort();
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    setCatalogIdentities({ status: 'loading', slugs: [] });
    void fetchProducts('', 'all', controller.signal).then((response) => {
      if (!controller.signal.aborted && sequence === catalogSequenceRef.current) {
        setCatalogIdentities({ status: 'ready', slugs: response.products.map((product) => product.slug) });
      }
    }).catch(() => {
      if (!controller.signal.aborted && sequence === catalogSequenceRef.current) {
        setCatalogIdentities({ status: 'error', slugs: [] });
      }
    });
  }, []);

  useEffect(() => {
    loadCatalogIdentities();
    return () => {
      operationSequenceRef.current += 1;
      catalogSequenceRef.current += 1;
      importAbortRef.current?.abort();
      catalogAbortRef.current?.abort();
      importInFlightRef.current = false;
    };
  }, [loadCatalogIdentities]);

  const duplicateCandidates = useMemo(
    () => new Set(catalogIdentities.slugs.map((slug) => normalizeComparisonKey(slug))),
    [catalogIdentities.slugs],
  );
  const durableOutcomeLocked = result !== null || failure?.kind === 'result';

  const inspectFile = async (file: File) => {
    if (importInFlightRef.current || phase !== 'idle' || catalogIdentities.status !== 'ready' || durableOutcomeLocked) return;
    const sequence = operationSequenceRef.current + 1;
    operationSequenceRef.current = sequence;
    setSelectedFile(file);
    setValidation(null);
    setResult(null);
    setFailure(null);
    setConfirmed(false);
    setFileCheck({ status: 'checking', name: file.name, sizeLabel: sizeLabel(file.size), message: 'Checking file' });
    if (file.size > CSV_MAX_BYTES) {
      if (sequence === operationSequenceRef.current) {
        setFileCheck({ status: 'error', name: file.name, sizeLabel: sizeLabel(file.size), message: `${file.name} exceeds the 1 MB CSV limit. Choose a smaller file.` });
      }
      return;
    }
    try {
      const parsed = parseCsvBytes(await file.arrayBuffer());
      if (sequence !== operationSequenceRef.current) return;
      const nextValidation = validateCsvRows(parsed.rows, duplicateCandidates);
      setValidation(nextValidation);
      setFileCheck({
        status: 'valid',
        name: file.name,
        sizeLabel: sizeLabel(parsed.byteLength),
        rows: parsed.rows.length,
        message: `Browser checks completed for strict UTF-8, the ordered header, ${parsed.rows.length} of ${CSV_MAX_DATA_ROWS} data rows, and grouped Product shape. The server will repeat every check.`,
      });
    } catch (error) {
      if (sequence !== operationSequenceRef.current) return;
      const message = error instanceof CsvContractError ? error.message : 'The browser could not parse this CSV.';
      setFileCheck({ status: 'error', name: file.name, sizeLabel: sizeLabel(file.size), message });
    }
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && !importInFlightRef.current && phase === 'idle' && !durableOutcomeLocked) void inspectFile(file);
    event.target.value = '';
  };

  const dropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (importInFlightRef.current || phase !== 'idle' || catalogIdentities.status !== 'ready' || durableOutcomeLocked) return;
    const file = event.dataTransfer.files[0];
    if (file) void inspectFile(file);
  };

  const downloadTemplate = async () => {
    setTemplateState('loading');
    try {
      await downloadCsvTemplate();
      setTemplateState('success');
    } catch {
      setTemplateState('error');
    }
  };

  const importProducts = async () => {
    if (!selectedFile || !validation || importInFlightRef.current || phase !== 'idle') return;
    const sequence = operationSequenceRef.current + 1;
    operationSequenceRef.current = sequence;
    const controller = new AbortController();
    importAbortRef.current?.abort();
    importAbortRef.current = controller;
    importInFlightRef.current = true;
    setFailure(null);
    setResult(null);
    setPhase('uploading');
    try {
      await waitForUploadingMinimum();
      if (sequence !== operationSequenceRef.current || controller.signal.aborted) return;
      setPhase('checking');
      const authoritative = await importCsvProducts(selectedFile, confirmed, controller.signal);
      if (sequence !== operationSequenceRef.current || controller.signal.aborted) return;
      setResult(authoritative);
      onShowResult?.();
      requestAnimationFrame(() => document.getElementById('import-result-title')?.focus());
    } catch (error) {
      if (sequence !== operationSequenceRef.current || controller.signal.aborted) return;
      if (error instanceof ConsoleImportResultError) {
        setFailure({
          kind: 'result',
          code: 'CI-RESULT-ERROR',
          message: error.message,
          rawBody: error.rawBody,
          retainedBody: error.retainedBody,
        });
        requestAnimationFrame(() => document.getElementById('import-result-error-title')?.focus());
      } else {
        const message = error instanceof ConsoleApiError
          ? `${error.message}${error.incidentId ? ` Incident ${error.incidentId}.` : ''}`
          : 'The CSV import request failed. Check the connection and retry the unchanged file.';
        setFailure({ kind: 'request', message });
        requestAnimationFrame(() => document.getElementById('import-failure-title')?.focus());
      }
    } finally {
      if (sequence === operationSequenceRef.current) setPhase('idle');
      if (importAbortRef.current === controller) {
        importAbortRef.current = null;
        importInFlightRef.current = false;
      }
    }
  };

  const startAnother = () => {
    operationSequenceRef.current += 1;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    importInFlightRef.current = false;
    setSelectedFile(null);
    setValidation(null);
    setFileCheck({ status: 'idle' });
    setConfirmed(false);
    setPhase('idle');
    setResult(null);
    setFailure(null);
    loadCatalogIdentities();
    onReset?.();
  };

  const eligibleGroups = validation?.groups.filter((group) => group.eligible) ?? [];
  const warningGroups = eligibleGroups.filter((group) => group.confirmationRequired);
  const warning = warningGroups.length > 0;
  const blocked = validation?.groups.some((group) => group.issue?.code === 'variant_limit_exceeded') ?? false;
  const progress = phase !== 'idle';
  const importDisabled = catalogIdentities.status !== 'ready' || !selectedFile || fileCheck.status !== 'valid' || eligibleGroups.length === 0 || (warning && !confirmed) || progress;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div className="page-header-copy">
          <button className="text-button" type="button" onClick={onBack}>Back to Products</button>
          <h1>Import Products from CSV</h1>
          <p>Use one fixed template to add simple and Variant Products. Product type is detected from the data for each product_slug.</p>
        </div>
        {result || failure ? <button className="button button-primary" type="button" onClick={startAnother}>Start another import</button> : null}
      </header>

      <div className="notice notice-info">
        <strong>Additive exact-match import</strong>
        <span>Import adds new exact matches. It does not update existing Products or Variants. Private delivery files and Variant delivery overrides are not imported.</span>
      </div>

      <div className="csv-workspace">
        <section className="csv-source" aria-labelledby="csv-source-title">
          <div className="section-heading">
            <h2 id="csv-source-title">Template and file</h2>
            <p>The template has one ordered header, one valid simple example, and two valid Variant rows. There is no type column.</p>
          </div>
          <button className="button" type="button" onClick={() => void downloadTemplate()} disabled={templateState === 'loading'}>
            {templateState === 'loading' ? 'Downloading template' : templateState === 'error' ? `Retry ${CSV_FILENAME}` : `Download ${CSV_FILENAME}`}
          </button>
          {templateState === 'success' ? (
            <div className="notice notice-success" role="status"><strong>Template downloaded</strong><span>{CSV_FILENAME} is ready.</span></div>
          ) : null}
          {templateState === 'error' ? (
            <div className="notice notice-error" role="alert"><strong>CSV template could not be downloaded</strong><span>Retry the same fixed template download. File selection remains available.</span></div>
          ) : null}
          {catalogIdentities.status === 'loading' ? (
            <div className="notice notice-info" role="status">
              <strong>Loading catalog identities</strong>
              <span>The complete unfiltered Product slug set is loading before advisory duplicate checks.</span>
            </div>
          ) : null}
          {catalogIdentities.status === 'error' ? (
            <div className="notice notice-error" role="alert">
              <strong>Catalog identities could not be loaded</strong>
              <span>Retry before choosing a CSV so duplicate candidates use the complete catalog.</span>
              <button className="button" type="button" onClick={loadCatalogIdentities}>Retry catalog identities</button>
            </div>
          ) : null}

          <div
            className={`dropzone${dragActive ? ' active' : ''}`}
            aria-disabled={progress || catalogIdentities.status !== 'ready' || durableOutcomeLocked}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!progress && catalogIdentities.status === 'ready' && !durableOutcomeLocked) setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={dropFile}
          >
            <h3>{catalogIdentities.status !== 'ready' ? 'Load catalog identities to choose a CSV' : dragActive ? 'Drop CSV to preview' : 'Choose a CSV to check'}</h3>
            <p id="csv-file-help">CSV, UTF-8, up to 1 MB and 500 data rows.</p>
            <label className="button button-primary file-input-label">
              {selectedFile ? 'Replace CSV' : 'Choose CSV'}
              <input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                disabled={progress || catalogIdentities.status !== 'ready' || durableOutcomeLocked}
                aria-invalid={fileCheck.status === 'error'}
                aria-describedby={`csv-file-help${fileCheck.status !== 'idle' ? ' csv-file-check' : ''}`}
                onChange={chooseFile}
              />
            </label>
          </div>

          {fileCheck.status !== 'idle' ? (
            <div id="csv-file-check" className={`notice ${fileCheck.status === 'error' ? 'notice-error' : fileCheck.status === 'valid' ? 'notice-success' : 'notice-info'}`} role={fileCheck.status === 'error' ? 'alert' : 'status'}>
              <strong>{fileCheck.status === 'checking' ? 'Checking file' : fileCheck.name}</strong>
              {fileCheck.sizeLabel ? <span className="numeric">{fileCheck.sizeLabel}{fileCheck.rows !== undefined ? ` · ${fileCheck.rows} data rows` : ''}</span> : null}
              {fileCheck.message ? <span>{fileCheck.message}</span> : null}
            </div>
          ) : null}
          {selectedFile && fileCheck.status === 'valid' ? (
            <div className="file-summary"><strong>Selected file preview</strong><span>{selectedFile.name}</span><span className="meta-text numeric">{sizeLabel(selectedFile.size)} · {fileCheck.rows} data rows</span></div>
          ) : null}

          {warning ? (
            <div className="notice notice-warning">
              <strong>{warningGroups.length} Product {warningGroups.length === 1 ? 'group requires' : 'groups require'} confirmation.</strong>
              <span>Confirmation begins at 11 combinations and 30 combinations is the maximum. Review every listed Product group before importing.</span>
              <ul className="section-stack" aria-label="Product groups requiring Variant confirmation">
                {warningGroups.map((group) => (
                  <li key={group.productSlug}>
                    <span>{group.productSlug}</span>
                    <strong className="numeric">{group.derivedCombinationCount} combinations</strong>
                  </li>
                ))}
              </ul>
              <label className="checkbox-row">
                <input type="checkbox" checked={confirmed} disabled={progress} onChange={(event) => setConfirmed(event.target.checked)} />
                I reviewed every Product group with 11 to 30 combinations.
              </label>
            </div>
          ) : null}
          {blocked ? (
            <div className="notice notice-error" role="alert">
              <strong>31-or-more combination Product groups are rejected.</strong>
              <span>Confirmation cannot bypass the maximum of 30. {eligibleGroups.length > 0 ? 'Other eligible Product groups remain available to import.' : 'Correct the affected Product group before importing.'}</span>
            </div>
          ) : null}

          {!result && failure?.kind !== 'result' ? (
            <div className="section-stack">
              <button className="button button-primary" type="button" disabled={importDisabled} onClick={() => void importProducts()}>
                {phase === 'uploading' ? 'Uploading CSV' : phase === 'checking' ? 'Checking and importing Products' : failure?.kind === 'request' ? 'Retry Import' : 'Import Products'}
              </button>
              {importDisabled && !progress ? (
                <span className="field-help">{fileCheck.status === 'error'
                  ? 'Replace the selected file and pass every browser check.'
                  : !validation
                    ? 'Choose a CSV to preview.'
                    : eligibleGroups.length === 0
                      ? 'Every Product group is rejected. Correct the named rows before import.'
                      : warning && !confirmed
                        ? 'Confirm every listed warning Product group before import.'
                        : 'At least one eligible Product group is required.'}</span>
              ) : null}
            </div>
          ) : null}
          {failure?.kind === 'request' ? <button className="button" type="button" onClick={startAnother}>Choose another file</button> : null}
        </section>
        <CsvPreviewTable validation={validation} result={result} phase={phase} failure={failure} />
      </div>
    </div>
  );
}
