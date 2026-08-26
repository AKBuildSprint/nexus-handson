import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ConsoleApiError } from '../api-client';
import { currencyFractionDigits, decimalToMinor, MoneyError } from '../../catalog/money';
import type { ProductEditorFixture, ProductEditorScenario, ProductStatus } from './product-ui-types';
import { DeliveryEditor } from './delivery-editor';
import { VariantBuilder } from './variant-builder';

interface ProductEditorScreenProps {
  scenario: ProductEditorScenario;
  onBack: (trigger: HTMLElement) => void;
  onDiscardRequest: (trigger: HTMLElement) => void;
  onDirtyChange: (dirty: boolean) => void;
  onRetry: () => void;
  onSave?: (product: ProductEditorFixture) => Promise<void>;
  onPendingProductFileChange?: (change: File | 'remove' | null) => void;
  onPendingVariantFileChange?: (variantId: string, change: File | 'remove' | null) => void;
  onSchemaPreview?: (
    product: ProductEditorFixture,
    groups: ProductEditorFixture['groups'],
    variants: ProductEditorFixture['variants'],
  ) => Promise<ProductEditorFixture['variants'] | void>;
}

type FieldName = 'name' | 'basePrice' | 'currency' | 'accessTitle' | 'accessInstructions';
type FieldErrors = Partial<Record<FieldName, string>>;
interface ServerFieldError { path: string; message: string }

function serverFieldHref(path: string): string {
  if (path.startsWith('/optionLabels/groups/') || path.startsWith('/schema/groups/')) return '#variants-title';
  if (path.startsWith('/variantEdits/') || path.startsWith('/schema/rows/')) return '#variants-title';
  return '#console-content';
}


function cloneProduct(product: ProductEditorFixture): ProductEditorFixture {
  return {
    ...product,
    delivery: { ...product.delivery, file: product.delivery.file ? { ...product.delivery.file } : undefined },
    groups: product.groups.map((group) => ({
      ...group,
      values: [...group.values],
      valueIds: group.valueIds ? [...group.valueIds] : undefined,
      valueRefs: group.valueRefs ? [...group.valueRefs] : undefined,
    })),
    variants: product.variants.map((variant) => ({
      ...variant,
      selectedValueRefs: variant.selectedValueRefs ? [...variant.selectedValueRefs] : undefined,
      deliveryOverride: variant.deliveryOverride
        ? { ...variant.deliveryOverride, file: variant.deliveryOverride.file ? { ...variant.deliveryOverride.file } : undefined }
        : undefined,
    })),
  };
}

function validateField(field: FieldName, product: ProductEditorFixture) {
  if (field === 'name' && !product.name.trim()) return 'Product name is required.';
  if (field === 'currency') {
    try {
      currencyFractionDigits(product.currency);
    } catch (error) {
      return error instanceof MoneyError ? error.message : 'Currency must be an uppercase ISO 4217 code.';
    }
  }
  if (field === 'basePrice') {
    if (!product.basePrice.trim()) return 'Base price is required.';
    try {
      decimalToMinor(product.basePrice, product.currency);
    } catch (error) {
      return error instanceof MoneyError ? error.message : 'Base price is invalid.';
    }
  }
  if (field === 'accessTitle' && !product.delivery.accessTitle.trim()) return 'Private access title is required.';
  if (field === 'accessInstructions' && !product.delivery.accessInstructions.trim()) return 'Private access instructions are required.';
  return '';
}

export function ProductEditorScreen({
  scenario,
  onBack,
  onDiscardRequest,
  onDirtyChange,
  onRetry,
  onSave,
  onPendingProductFileChange,
  onPendingVariantFileChange,
  onSchemaPreview,
}: ProductEditorScreenProps) {
  const [product, setProduct] = useState(() => cloneProduct(scenario.product));
  const productRef = useRef(product);
  productRef.current = product;
  const schemaStateRef = useRef({ groups: scenario.product.groups, variants: scenario.product.variants });
  const [dirty, setDirty] = useState(scenario.lifecycle === 'dirty' || scenario.lifecycle === 'save-error');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverFieldErrors, setServerFieldErrors] = useState<ServerFieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(scenario.lifecycle === 'saved');
  const [saveError, setSaveError] = useState(
    scenario.lifecycle === 'save-error' ? 'Product could not be saved. Your unsaved values are still in the editor.' : '',
  );
  const [deliveryBlockers, setDeliveryBlockers] = useState<string[]>([]);
  const [variantBlockers, setVariantBlockers] = useState<string[]>([]);
  const [transientVariantDirty, setTransientVariantDirty] = useState(false);
  const [fileResetKey, setFileResetKey] = useState(0);
  const [variantResetKey, setVariantResetKey] = useState(0);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const next = cloneProduct(scenario.product);
    setProduct(next);
    productRef.current = next;
    schemaStateRef.current = { groups: next.groups, variants: next.variants };
    setDirty(scenario.lifecycle === 'dirty' || scenario.lifecycle === 'save-error');
    setErrors({});
    setServerFieldErrors([]);
    setSaving(false);
    setSaved(scenario.lifecycle === 'saved');
    setSaveError(scenario.lifecycle === 'save-error' ? 'Product could not be saved. Your unsaved values are still in the editor.' : '');
    setDeliveryBlockers([]);
    setVariantBlockers([]);
    setTransientVariantDirty(false);
    setFileResetKey((current) => current + 1);
    setVariantResetKey((current) => current + 1);
  }, [scenario]);

  useEffect(() => {
    onDirtyChange(dirty || transientVariantDirty);
  }, [dirty, onDirtyChange, transientVariantDirty]);

  const markDirty = () => {
    setDirty(true);
    setSaved(false);
  };

  const updateProduct = <K extends keyof ProductEditorFixture>(field: K, value: ProductEditorFixture[K]) => {
    setProduct((current) => ({ ...current, [field]: value }));
    markDirty();
  };

  const updateDelivery = (field: 'accessTitle' | 'accessInstructions', value: string) => {
    setProduct((current) => ({ ...current, delivery: { ...current.delivery, [field]: value } }));
    markDirty();
  };
  const synchronizeSchema = useCallback((
    groups: ProductEditorFixture['groups'],
    variants: ProductEditorFixture['variants'],
  ) => {
    setProduct((current) => {
      const next = { ...current, groups, variants };
      productRef.current = next;
      schemaStateRef.current = { groups, variants };
      return next;
    });
  }, []);

  const regenerateSchema = useCallback((
    groups: ProductEditorFixture['groups'],
    variants: ProductEditorFixture['variants'],
  ) => onSchemaPreview?.({ ...product, groups, variants }, groups, variants) ?? Promise.resolve(), [onSchemaPreview, product]);


  const validateOne = (field: FieldName) => {
    const error = validateField(field, product);
    setErrors((current) => ({ ...current, [field]: error || undefined }));
  };

  const validateAll = () => {
    const next: FieldErrors = {};
    (['name', 'basePrice', 'currency', 'accessTitle', 'accessInstructions'] as const).forEach((field) => {
      const error = validateField(field, product);
      if (error) next[field] = error;
    });
    setErrors(next);
    return next;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validateAll();
    const childBlockers = [...deliveryBlockers, ...variantBlockers];
    if (Object.keys(nextErrors).length > 0 || childBlockers.length > 0) {
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return;
    }

    setSaveError('');
    setSaving(true);
    try {
      await onSave?.(cloneProduct({
        ...productRef.current,
        groups: schemaStateRef.current.groups,
        variants: schemaStateRef.current.variants,
      }));
      setDirty(false);
      setSaved(true);
      setFileResetKey((current) => current + 1);
    } catch (error) {
      if (error instanceof ConsoleApiError) {
        setServerFieldErrors(error.fields.map((field) => ({ path: field.path, message: field.message })));
        const serverErrors: FieldErrors = {};
        for (const field of error.fields) {
          if (field.path === '/product/name') serverErrors.name = field.message;
          else if (field.path === '/product/basePrice') serverErrors.basePrice = field.message;
          else if (field.path === '/product/delivery/accessTitle') serverErrors.accessTitle = field.message;
          else if (field.path === '/product/currency') serverErrors.currency = field.message;
          else if (field.path === '/product/delivery/accessInstructions') serverErrors.accessInstructions = field.message;
        }
        setErrors((current) => ({ ...current, ...serverErrors }));
        setSaveError(error.fields[0]?.message ?? error.message);
        window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      } else {
        setSaveError(error instanceof Error ? error.message : 'Product could not be saved. Your unsaved values are still in the editor.');
      }
    } finally {
      setSaving(false);
    }
  };


  if (scenario.lifecycle === 'loading') {
    return (
      <div className="page-stack" aria-busy="true" aria-label="Loading Product editor">
        <div className="editor-action-bar"><span className="skeleton-line" /><button className="button button-primary" disabled>Save Product</button></div>
        {[0, 1, 2, 3, 4].map((section) => (
          <section className="editor-section" key={section} aria-hidden="true">
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
          </section>
        ))}
      </div>
    );
  }

  if (scenario.lifecycle === 'error') {
    return (
      <div className="page-stack">
        <button className="text-button" type="button" onClick={(event) => onBack(event.currentTarget)}>Back to Products</button>
        <div className="notice notice-error" role="alert">
          <h1>Product could not be loaded</h1>
          <p>No editable values were invented for this failed request. Retry or return to the Product list.</p>
          <div className="inline-actions">
            <button className="button" type="button" onClick={onRetry}>Retry loading Product</button>
            <button className="button" type="button" onClick={(event) => onBack(event.currentTarget)}>Back to Products</button>
          </div>
        </div>
      </div>
    );
  }

  const requiredReady = product.name.trim() && product.basePrice.trim() && product.currency.trim() && product.delivery.accessTitle.trim() && product.delivery.accessInstructions.trim();
  const childBlockers = [...deliveryBlockers, ...variantBlockers];
  const saveReason = !dirty
    ? 'Make a change before saving.'
    : !requiredReady
      ? 'Complete Product name, base price, private access title, and private access instructions.'
      : childBlockers[0] ?? '';
  const saveDisabled = !dirty || !requiredReady || childBlockers.length > 0 || saving;
  const title = scenario.lifecycle === 'create' ? 'New Product' : product.name || 'Product';

  return (
    <form className="page-stack" onSubmit={submit} noValidate>
      <div className="editor-action-bar">
        <div className="editor-context">
          <button
            className="text-button"
            type="button"
            onClick={(event) => onBack(event.currentTarget)}
          >
            Back to Products
          </button>
          <strong>{title}</strong>
          <span className="status-tag">{product.status}</span>
          <span className="editor-state" role="status">{saving ? 'Saving Product' : dirty ? 'Unsaved changes' : saved ? 'Product saved' : 'Saved'}</span>
        </div>
        <div className="editor-actions">
          {dirty ? (
            <button className="text-button" type="button" onClick={(event) => onDiscardRequest(event.currentTarget)}>
              Discard changes
            </button>
          ) : null}
          <button className="button button-primary desktop-save" type="submit" disabled={saveDisabled} aria-describedby="save-product-reason">
            {saving ? 'Saving Product' : saveError ? 'Retry save' : 'Save Product'}
          </button>
        </div>
      </div>

      {saved ? (
        <div className="notice notice-success" role="status">
          <strong>Product saved</strong>
          <span>The editor remains open so you can review the saved Product.</span>
        </div>
      ) : null}

      {saveError ? (
        <div className="notice notice-error" role="alert">
          <strong>Product could not be saved</strong>
          <span>{saveError}</span>
          <div className="inline-actions">
            <button className="button" type="submit" disabled={saveDisabled}>Retry save</button>
            <button className="button" type="button" onClick={(event) => onDiscardRequest(event.currentTarget)}>Discard changes</button>
          </div>
        </div>
      ) : null}

      {Object.values(errors).some(Boolean) || childBlockers.length > 0 || serverFieldErrors.length > 0 ? (
        <div className="notice notice-error" role="alert" tabIndex={-1} ref={errorSummaryRef}>
          <h3>Fix these blockers before saving</h3>
          <ul>
            {errors.name ? <li><a href="#product-name">{errors.name}</a></li> : null}
            {errors.basePrice ? <li><a href="#base-price">{errors.basePrice}</a></li> : null}
            {errors.currency ? <li><a href="#currency">{errors.currency}</a></li> : null}
            {errors.accessTitle ? <li><a href="#delivery-access-title">{errors.accessTitle}</a></li> : null}
            {errors.accessInstructions ? <li><a href="#delivery-access-instructions">{errors.accessInstructions}</a></li> : null}
            {deliveryBlockers.map((blocker) => <li key={blocker}><a href="#delivery-private-file">{blocker}</a></li>)}
            {serverFieldErrors.map((field) => (
              <li key={`${field.path}:${field.message}`}><a href={serverFieldHref(field.path)}>{field.message}</a></li>
            ))}
            {variantBlockers.map((blocker) => <li key={blocker}><a href="#variants-title">{blocker}</a></li>)}
          </ul>
        </div>
      ) : null}

      <div className="editor-form">
        <section className="editor-section" aria-labelledby="basics-title">
          <div className="section-heading">
            <h2 id="basics-title">Basics</h2>
            <p>Name the Product and choose its catalog status.</p>
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="product-name">Product name</label>
              <input
                id="product-name"
                autoFocus={scenario.lifecycle === 'create'}
                value={product.name}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={`product-name-help${errors.name ? ' product-name-error' : ''}`}
                onChange={(event) => updateProduct('name', event.target.value)}
                onBlur={() => validateOne('name')}
              />
              <span id="product-name-help" className="field-help">Required. This is the Customer-visible Product name.</span>
              {errors.name ? <span id="product-name-error" className="field-error">{errors.name}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="product-status">Product status</label>
              <select id="product-status" value={product.status} onChange={(event) => updateProduct('status', event.target.value as ProductStatus)}>
                <option>Draft</option>
                <option>Active</option>
                <option>Archived</option>
              </select>
              <span className="field-help">Status changes are saved with the whole Product.</span>
            </div>
          </div>
        </section>

        <section className="editor-section" aria-labelledby="pricing-title">
          <div className="section-heading">
            <h2 id="pricing-title">Pricing</h2>
            <p>Set one decimal base price and currency. Variant overrides use the same currency.</p>
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="base-price">Base price</label>
              <input
                id="base-price"
                inputMode="decimal"
                value={product.basePrice}
                aria-invalid={Boolean(errors.basePrice)}
                aria-describedby={`base-price-help${errors.basePrice ? ' base-price-error' : ''}`}
                onChange={(event) => updateProduct('basePrice', event.target.value)}
                onBlur={() => validateOne('basePrice')}
              />
              <span id="base-price-help" className="field-help">Use a non-negative decimal valid for the selected currency.</span>
              {errors.basePrice ? <span id="base-price-error" className="field-error">{errors.basePrice}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="currency">Currency</label>
              <input
                id="currency"
                value={product.currency}
                maxLength={3}
                aria-invalid={Boolean(errors.currency)}
                aria-describedby={`currency-help${errors.currency ? ' currency-error' : ''}`}
                onChange={(event) => updateProduct('currency', event.target.value.toUpperCase())}
                onBlur={() => validateOne('currency')}
              />
              <span id="currency-help" className="field-help">Use an uppercase ISO 4217 code. Changing currency does not convert prices.</span>
              {errors.currency ? <span id="currency-error" className="field-error">{errors.currency}</span> : null}
            </div>
          </div>
        </section>

        <section className="editor-section" aria-labelledby="description-title">
          <div className="section-heading">
            <h2 id="description-title">Public description</h2>
            <p>This optional text is Customer-visible. Private delivery details do not belong here.</p>
          </div>
          <div className="field">
            <label htmlFor="public-description">Customer-visible description</label>
            <textarea id="public-description" value={product.publicDescription} onChange={(event) => updateProduct('publicDescription', event.target.value)} />
            <span className="field-help">Optional public catalog copy.</span>
          </div>
        </section>

        <section className="editor-section" aria-labelledby="delivery-title">
          <div className="section-heading">
            <h2 id="delivery-title">Delivery</h2>
            <p>Private Console content that describes what a paying Customer receives.</p>
          </div>
          <DeliveryEditor
            delivery={product.delivery}
            resetKey={fileResetKey}
            errors={{ accessTitle: errors.accessTitle, accessInstructions: errors.accessInstructions }}
            disabled={saving}
            onChange={updateDelivery}
            onBlur={validateOne}
            onFileChange={markDirty}
            onBlockersChange={setDeliveryBlockers}
            onFileMetadataChange={(file) => {
              setProduct((current) => ({ ...current, delivery: { ...current.delivery, file } }));
            }}
            onPendingFileChange={onPendingProductFileChange}
          />
        </section>

        <section className="editor-section" aria-labelledby="variants-title">
          <div className="section-heading">
            <h2 id="variants-title">Variants</h2>
            <p>Build one active option schema, review Cartesian limits, and edit each generated purchasable combination.</p>
          </div>
          <VariantBuilder
            initialGroups={product.groups}
            initialVariants={product.variants}
            basePrice={product.basePrice}
            currency={product.currency}
            productDelivery={product.delivery}
            resetKey={variantResetKey}
            onDirty={markDirty}
            onBlockersChange={setVariantBlockers}
            onTransientDirtyChange={setTransientVariantDirty}
            serverFieldErrors={serverFieldErrors}
            onSchemaChange={synchronizeSchema}
            onPendingVariantFileChange={onPendingVariantFileChange}
            onRegenerate={regenerateSchema}
          />
        </section>
      </div>

      <div className="mobile-save-bar">
        {saveReason ? <span className="field-help">{saveReason}</span> : <span className="editor-state">Ready to save.</span>}
        <button className="button button-primary" type="submit" disabled={saveDisabled}>
          {saving ? 'Saving Product' : saveError ? 'Retry save' : 'Save Product'}
        </button>
      </div>

      <span id="save-product-reason" className="sr-only">{saveReason}</span>

    </form>
  );
}
