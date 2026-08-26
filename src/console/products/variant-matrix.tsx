import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { decimalToMinor, MoneyError } from '../../catalog/money';
import type { DeliveryFixture, VariantFixture } from './product-ui-types';
import { DeliveryEditor } from './delivery-editor';

interface VariantMatrixProps {
  variants: ReadonlyArray<VariantFixture>;
  basePrice: string;
  currency: string;
  productDelivery: DeliveryFixture;
  onRowsChange: (rows: VariantFixture[]) => void;
  onDirty: () => void;
  onBlockersChange: (blockers: string[]) => void;
  onTransientDirtyChange: (dirty: boolean) => void;
  serverFieldErrors?: Array<{ path: string; message: string }>;
  onPendingVariantFileChange?: (variantId: string, change: File | 'remove' | null) => void;
}

type GuardMode = 'cancel' | 'default' | null;
interface FocusedRowDraft {
  sku: string;
  priceOverride: string;
  enabled: boolean;
}

function currencySymbol(currency: string) {
  return currency === 'USD' ? '$' : `${currency} `;
}
function priceError(value: string, currency: string): string {
  if (!value) return '';
  try {
    decimalToMinor(value, currency);
    return '';
  } catch (error) {
    return error instanceof MoneyError ? error.message : 'Price override is invalid.';
  }
}


export function VariantMatrix({
  variants,
  basePrice,
  currency,
  productDelivery,
  onRowsChange,
  onDirty,
  onBlockersChange,
  onTransientDirtyChange,
  onPendingVariantFileChange,
  serverFieldErrors = [],
}: VariantMatrixProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<'default' | 'override'>('default');
  const [overrideDelivery, setOverrideDelivery] = useState<DeliveryFixture>({ accessTitle: '', accessInstructions: '' });
  const [rowDraft, setRowDraft] = useState<FocusedRowDraft>({ sku: '', priceOverride: '', enabled: true });
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [guardMode, setGuardMode] = useState<GuardMode>(null);
  const [dirtyBeforeModeGuard, setDirtyBeforeModeGuard] = useState(false);
  const [overrideBlockers, setOverrideBlockers] = useState<string[]>([]);
  const [drawerResetKey, setDrawerResetKey] = useState(0);
  const [overrideTouched, setOverrideTouched] = useState({ accessTitle: false, accessInstructions: false });
  const [overrideApplyAttempted, setOverrideApplyAttempted] = useState(false);
  const [rowTouched, setRowTouched] = useState({ sku: false, priceOverride: false });
  const [rowApplyAttempted, setRowApplyAttempted] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (focusedId && !dialog.open) dialog.showModal();
    if (!focusedId && dialog.open) dialog.close();
  }, [focusedId]);

  const focusedVariant = useMemo(
    () => variants.find((row) => row.id === focusedId) ?? null,
    [focusedId, variants],
  );
  const overrideTitleId = focusedVariant ? `variant-${focusedVariant.id}-delivery-access-title` : 'variant-delivery-access-title';
  const overrideInstructionsId = focusedVariant ? `variant-${focusedVariant.id}-delivery-access-instructions` : 'variant-delivery-access-instructions';
  const overrideErrors = deliveryMode === 'override'
    ? {
        accessTitle: (overrideTouched.accessTitle || overrideApplyAttempted) && !overrideDelivery.accessTitle.trim()
          ? 'Variant override access title is required.'
          : undefined,
        accessInstructions: (overrideTouched.accessInstructions || overrideApplyAttempted) && !overrideDelivery.accessInstructions.trim()
          ? 'Variant override access instructions are required.'
          : undefined,
      }
    : {};

  const duplicateSkus = useMemo(() => {
    const counts = new Map<string, number>();
    variants.forEach((row) => counts.set(row.sku.trim(), (counts.get(row.sku.trim()) ?? 0) + 1));
    return counts;
  }, [variants]);
  const rawDraftSkuError = !rowDraft.sku.trim()
    ? 'SKU is required.'
    : variants.some((row) => row.id !== focusedId && row.sku.trim().toLocaleUpperCase() === rowDraft.sku.trim().toLocaleUpperCase())
      ? `SKU ${rowDraft.sku} conflicts with another Variant.`
      : '';
  const rawDraftPriceError = priceError(rowDraft.priceOverride, currency);
  const draftSkuError = rowTouched.sku || rowApplyAttempted ? rawDraftSkuError : '';
  const draftPriceError = rowTouched.priceOverride || rowApplyAttempted ? rawDraftPriceError : '';
  const overrideRequiredMissing = deliveryMode === 'override'
    && (!overrideDelivery.accessTitle.trim() || !overrideDelivery.accessInstructions.trim());

  const serverRowError = (row: VariantFixture, field: string) => {
    const index = variants.findIndex((candidate) => candidate.id === row.id);
    return serverFieldErrors.find((error) =>
      error.path === `/variantEdits/${index}/${field}` || error.path === `/schema/rows/${index}/${field}`,
    )?.message ?? '';
  };
  const renderRowError = (row: VariantFixture) => {
    if (!row.sku.trim()) return `SKU is required for ${row.combination}.`;
    const serverError = serverRowError(row, 'sku') || serverRowError(row, 'priceOverride') || serverRowError(row, 'delivery');
    if (serverError) return serverError;
    if ((duplicateSkus.get(row.sku.trim()) ?? 0) > 1) return `SKU ${row.sku} is repeated in this matrix.`;
    const overrideError = priceError(row.priceOverride, currency);
    if (overrideError) return `Price override for ${row.combination}: ${overrideError}`;
    return '';
  };

  const matrixBlockers = useMemo(
    () => variants.map(renderRowError).filter(Boolean),
    [duplicateSkus, variants],
  );

  useEffect(() => {
    onBlockersChange(matrixBlockers);
  }, [matrixBlockers, onBlockersChange]);

  useEffect(() => {
    onTransientDirtyChange(drawerDirty);
  }, [drawerDirty, onTransientDirtyChange]);

  useEffect(() => () => {
    onTransientDirtyChange(false);
  }, [onTransientDirtyChange]);

  const updateRow = (id: string, patch: Partial<VariantFixture>) => {
    onRowsChange(variants.map((row) => (row.id === id ? { ...row, ...patch } : { ...row })));
    onDirty();
  };

  const closeDrawer = () => {
    setFocusedId(null);
    setDrawerDirty(false);
    setGuardMode(null);
    setDirtyBeforeModeGuard(false);
    setOverrideBlockers([]);
    setOverrideTouched({ accessTitle: false, accessInstructions: false });
    setOverrideApplyAttempted(false);
    setRowTouched({ sku: false, priceOverride: false });
    setRowApplyAttempted(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const requestClose = () => {
    if (drawerDirty) setGuardMode('cancel');
    else closeDrawer();
  };

  const openDelivery = (id: string, event: MouseEvent<HTMLButtonElement>) => {
    const row = variants.find((candidate) => candidate.id === id);
    if (!row) return;
    triggerRef.current = event.currentTarget;
    setDeliveryMode(row.deliverySource === 'Variant override' ? 'override' : 'default');
    setOverrideDelivery(row.deliveryOverride
      ? { ...row.deliveryOverride, file: row.deliveryOverride.file ? { ...row.deliveryOverride.file } : undefined }
      : { accessTitle: '', accessInstructions: '' });
    setRowDraft({ sku: row.sku, priceOverride: row.priceOverride, enabled: row.enabled });
    setDrawerDirty(false);
    setGuardMode(null);
    setDirtyBeforeModeGuard(false);
    setOverrideBlockers([]);
    setDrawerResetKey((current) => current + 1);
    setFocusedId(id);
    setOverrideTouched({ accessTitle: false, accessInstructions: false });
    setOverrideApplyAttempted(false);
    setRowTouched({ sku: false, priceOverride: false });
    setRowApplyAttempted(false);
  };

  const applyVariantChanges = () => {
    if (!focusedVariant) return;
    setRowApplyAttempted(true);
    if (deliveryMode === 'override' && overrideRequiredMissing) {
      setOverrideApplyAttempted(true);
      return;
    }
    if (rawDraftSkuError || rawDraftPriceError || overrideBlockers.length > 0) return;
    updateRow(focusedVariant.id, {
      sku: rowDraft.sku,
      priceOverride: rowDraft.priceOverride,
      enabled: rowDraft.enabled,
      deliverySource: deliveryMode === 'override' ? 'Variant override' : 'Product default',
      deliveryOverride: deliveryMode === 'override'
        ? { ...overrideDelivery, file: overrideDelivery.file ? { ...overrideDelivery.file } : undefined }
        : undefined,
    });
    closeDrawer();
  };

  const renderDesktopRow = (row: VariantFixture) => {
    const error = renderRowError(row);
    const effectivePrice = row.priceOverride || basePrice || '0.00';
    const priceSource = row.priceOverride ? 'Override' : 'Base price';
    return (
      <tr key={row.id}>
        <td><strong>{row.combination}</strong>{error ? <span className="field-error" id={`variant-error-${row.id}`}>{error}</span> : null}</td>
        <td>
          <label className="sr-only" htmlFor={`sku-${row.id}`}>SKU for {row.combination}</label>
          <input
            id={`sku-${row.id}`}
            value={row.sku}
            aria-invalid={Boolean(serverRowError(row, 'sku') || (error && error.startsWith('SKU')))}
            aria-describedby={serverRowError(row, 'sku') || (error && error.startsWith('SKU')) ? `variant-error-${row.id}` : undefined}
            onChange={(event) => updateRow(row.id, { sku: event.target.value })}
          />
        </td>
        <td className="numeric">{currencySymbol(currency)}{effectivePrice}</td>
        <td>
          <label className="sr-only" htmlFor={`price-${row.id}`}>Price override for {row.combination}</label>
          <input
            id={`price-${row.id}`}
            value={row.priceOverride}
            inputMode="decimal"
            placeholder="Use base"
            aria-invalid={Boolean(serverRowError(row, 'priceOverride') || (error && error.startsWith('Price')))}
            aria-describedby={serverRowError(row, 'priceOverride') || (error && error.startsWith('Price')) ? `variant-error-${row.id}` : undefined}
            onChange={(event) => updateRow(row.id, { priceOverride: event.target.value })}
          />
          <span className="meta-text">{priceSource}</span>
        </td>
        <td>{row.deliverySource}</td>
        <td>
          <label className="switch-row">
            <input type="checkbox" checked={row.enabled} onChange={(event) => updateRow(row.id, { enabled: event.target.checked })} />
            {row.enabled ? 'Enabled' : 'Disabled'}
          </label>
        </td>
        <td>
          <button className="button" type="button" onClick={(event) => openDelivery(row.id, event)}>
            Edit delivery for {row.combination}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="section-stack">
      <div className="section-heading">
        <h3>Generated Variant matrix</h3>
        <p>Suggested SKUs are editable. Blank price overrides use the Product base price. Each row keeps delivery source and availability explicit.</p>
      </div>

      {variants.length === 0 ? (
        <div className="notice notice-info">
          <strong>No combinations generated yet.</strong>
          <span>Configure participating groups and use Generate matrix.</span>
        </div>
      ) : (
        <>
          <table className="console-table variant-table" aria-label="Generated Variant combinations">
            <thead>
              <tr>
                <th scope="col">Combination</th>
                <th scope="col">SKU</th>
                <th scope="col">Effective price</th>
                <th scope="col">Price source</th>
                <th scope="col">Delivery source</th>
                <th scope="col">Status</th>
                <th scope="col">Row action</th>
              </tr>
            </thead>
            <tbody>{variants.map(renderDesktopRow)}</tbody>
          </table>

          <div className="variant-list-mobile" aria-label="Generated Variant combinations">
            {variants.map((row) => {
              const error = renderRowError(row);
              const effectivePrice = row.priceOverride || basePrice || '0.00';
              return (
                <article className="variant-summary-card" key={row.id}>
                  <h3>{row.combination}</h3>
                  {error ? <div className="field-error" role="alert">{error}</div> : null}
                  <dl>
                    <div><dt>SKU</dt><dd>{row.sku || 'Missing'}</dd></div>
                    <div><dt>Effective price</dt><dd className="numeric">{currencySymbol(currency)}{effectivePrice}</dd></div>
                    <div><dt>Price source</dt><dd>{row.priceOverride ? 'Override' : 'Base price'}</dd></div>
                    <div><dt>Delivery source</dt><dd>{row.deliverySource}</dd></div>
                    <div><dt>Status</dt><dd>{row.enabled ? 'Enabled' : 'Disabled'}</dd></div>
                  </dl>
                  <button className="button" type="button" onClick={(event) => openDelivery(row.id, event)}>Edit {row.combination}</button>
                </article>
              );
            })}
          </div>
        </>
      )}

      <dialog
        ref={dialogRef}
        className="drawer-dialog"
        aria-labelledby="variant-drawer-title"
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onClose={() => {
          if (focusedId) setFocusedId(null);
        }}
      >
        {focusedVariant ? (
          <div className="drawer-panel">
            <header className="drawer-header">
              <div>
                <h2 id="variant-drawer-title">{focusedVariant.combination}</h2>
                <p className="meta-text">Focused Variant editor</p>
              </div>
              <button className="button" type="button" onClick={requestClose}>Close</button>
            </header>

            <div className="drawer-body">
              <div className="notice notice-info">
                <strong>SKU {rowDraft.sku || 'Missing'}</strong>
                <span>Effective price {currencySymbol(currency)}{rowDraft.priceOverride || basePrice}. Status {rowDraft.enabled ? 'Enabled' : 'Disabled'}.</span>
              </div>

              {draftSkuError || draftPriceError ? (
                <div className="notice notice-error" role="alert">
                  <strong>Fix focused Variant fields</strong>
                  <ul>
                    {draftSkuError ? <li><a href={`#focused-variant-sku-${focusedVariant.id}`}>{draftSkuError}</a></li> : null}
                    {draftPriceError ? <li><a href={`#focused-variant-price-${focusedVariant.id}`}>{draftPriceError}</a></li> : null}
                  </ul>
                </div>
              ) : null}

              <div className="field-grid">
                <div className="field span-2">
                  <label htmlFor={`focused-variant-sku-${focusedVariant.id}`}>SKU</label>
                  <input
                    id={`focused-variant-sku-${focusedVariant.id}`}
                    value={rowDraft.sku}
                    aria-invalid={Boolean(draftSkuError)}
                    aria-describedby={draftSkuError ? `focused-variant-sku-error-${focusedVariant.id}` : undefined}
                    onChange={(event) => {
                      setRowDraft((current) => ({ ...current, sku: event.target.value }));
                      setDrawerDirty(true);
                    }}
                    onBlur={() => setRowTouched((current) => ({ ...current, sku: true }))}
                  />
                  <span className="field-help">Required. SKU must be unique in this Variant matrix.</span>
                  {draftSkuError ? <span id={`focused-variant-sku-error-${focusedVariant.id}`} className="field-error">{draftSkuError}</span> : null}
                </div>
                <div className="field">
                  <label htmlFor={`focused-variant-price-${focusedVariant.id}`}>Price override</label>
                  <input
                    id={`focused-variant-price-${focusedVariant.id}`}
                    inputMode="decimal"
                    value={rowDraft.priceOverride}
                    placeholder="Use base price"
                    aria-invalid={Boolean(draftPriceError)}
                    aria-describedby={draftPriceError ? `focused-variant-price-error-${focusedVariant.id}` : undefined}
                    onChange={(event) => {
                      setRowDraft((current) => ({ ...current, priceOverride: event.target.value }));
                      setDrawerDirty(true);
                    }}
                    onBlur={() => setRowTouched((current) => ({ ...current, priceOverride: true }))}
                  />
                  <span className="field-help">Optional. Leave blank to use Base price in {currency}.</span>
                  {draftPriceError ? <span id={`focused-variant-price-error-${focusedVariant.id}`} className="field-error">{draftPriceError}</span> : null}
                </div>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={rowDraft.enabled}
                    onChange={(event) => {
                      setRowDraft((current) => ({ ...current, enabled: event.target.checked }));
                      setDrawerDirty(true);
                    }}
                  />
                  {rowDraft.enabled ? 'Enabled' : 'Disabled'}
                </label>
              </div>

              {guardMode === 'cancel' ? (
                <div className="notice notice-warning" role="alert">
                  <strong>Discard unsaved Variant changes?</strong>
                  <span>The delivery mode, access content, and selected file in this focused editor will revert.</span>
                  <div className="inline-actions">
                    <button className="button" type="button" onClick={() => setGuardMode(null)}>Stay and continue editing</button>
                    <button className="button button-danger" type="button" onClick={closeDrawer}>Discard Variant changes</button>
                  </div>
                </div>
              ) : null}

              {guardMode === 'default' ? (
                <div className="notice notice-warning" role="alert">
                  <strong>Use Product default instead?</strong>
                  <span>Variant-specific access content and file stop being used after Product save.</span>
                  <div className="inline-actions">
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        setDrawerDirty(dirtyBeforeModeGuard);
                        setGuardMode(null);
                      }}
                    >
                      Keep Variant override
                    </button>
                    <button
                      className="button button-danger"
                      type="button"
                      onClick={() => {
                        setDeliveryMode('default');
                        setDrawerDirty(true);
                        setGuardMode(null);
                      }}
                    >
                      Use Product default
                    </button>
                  </div>
                </div>
              ) : null}

              <fieldset>
                <legend>Delivery source</legend>
                <label className="checkbox-row">
                  <input
                    type="radio"
                    name="delivery-mode"
                    checked={deliveryMode === 'default'}
                    onChange={() => {
                      if (deliveryMode === 'override') {
                        setDirtyBeforeModeGuard(drawerDirty);
                        setDrawerDirty(true);
                        setGuardMode('default');
                      }
                    }}
                  />
                  Use Product default
                </label>
                <label className="checkbox-row">
                  <input
                    type="radio"
                    name="delivery-mode"
                    checked={deliveryMode === 'override'}
                    onChange={() => {
                      setDeliveryMode('override');
                      setDrawerDirty(true);
                      setOverrideTouched({ accessTitle: false, accessInstructions: false });
                      setOverrideApplyAttempted(false);
                      setGuardMode(null);
                    }}
                  />
                  Use Variant override
                </label>
              </fieldset>

              {deliveryMode === 'default' ? (
                <div className="notice notice-info">
                  <strong>Product default</strong>
                  <span><strong>Access title:</strong> {productDelivery.accessTitle}</span>
                  <span><strong>Access instructions:</strong> {productDelivery.accessInstructions}</span>
                  <span>
                    <strong>Private file:</strong>{' '}
                    {productDelivery.file ? `${productDelivery.file.kind} · ${productDelivery.file.name} · ${productDelivery.file.sizeLabel}` : 'No private file selected'}
                  </span>
                </div>
              ) : (
                <>
                  <p className="field-help">Enter both required access fields before Apply Variant changes becomes available. Errors appear after a field is left.</p>
                  {overrideErrors.accessTitle || overrideErrors.accessInstructions || overrideBlockers.length ? (
                    <div className="notice notice-error" role="alert">
                      <strong>Complete the Variant override</strong>
                      <ul>
                        {overrideErrors.accessTitle ? <li><a href={`#${overrideTitleId}`}>{overrideErrors.accessTitle}</a></li> : null}
                        {overrideErrors.accessInstructions ? <li><a href={`#${overrideInstructionsId}`}>{overrideErrors.accessInstructions}</a></li> : null}
                        {overrideBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                      </ul>
                    </div>
                  ) : null}
                <DeliveryEditor
                  delivery={overrideDelivery}
                  idPrefix={`variant-${focusedVariant.id}-delivery`}
                  errors={overrideErrors}
                  resetKey={drawerResetKey}
                  onChange={(field, value) => {
                    setOverrideDelivery((current) => ({ ...current, [field]: value }));
                    setDrawerDirty(true);
                  }}
                  onBlur={(field) => {
                    setOverrideTouched((current) => ({ ...current, [field]: true }));
                  }}
                  onFileChange={() => setDrawerDirty(true)}
                  onBlockersChange={setOverrideBlockers}
                  onFileMetadataChange={(file) => {
                    setOverrideDelivery((current) => ({ ...current, file }));
                    setDrawerDirty(true);
                  }}
                  onPendingFileChange={(change) => onPendingVariantFileChange?.(focusedVariant.id, change)}
                />
                </>
              )}
            </div>

            <footer className="drawer-footer">
              <span className="editor-state">{drawerDirty ? 'Unsaved Variant changes' : focusedVariant.deliverySource}</span>
              <div className="inline-actions">
                <button className="button" type="button" onClick={requestClose}>Cancel</button>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={Boolean(
                    guardMode
                    || overrideBlockers.length
                    || overrideRequiredMissing
                    || draftSkuError
                    || draftPriceError
                  )}
                  onClick={applyVariantChanges}
                >
                  Apply Variant changes
                </button>
              </div>
            </footer>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
