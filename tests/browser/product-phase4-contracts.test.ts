import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleApiError } from '../../src/console/api-client';
import { ProductEditorScreen } from '../../src/console/products/product-editor-screen';
import { ProductListScreen } from '../../src/console/products/product-list-screen';
import type { ProductEditorScenario } from '../../src/console/products/product-ui-types';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });


let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const validScenario: ProductEditorScenario = {
  id: 'new',
  label: 'New Product',
  lifecycle: 'dirty',
  product: {
    name: 'Field Notes', status: 'Draft', basePrice: '24.00', currency: 'USD', publicDescription: '',
    delivery: { accessTitle: 'Download', accessInstructions: 'Open it' }, groups: [], variants: [],
  },
};

function editorProps() {
  return {
    scenario: validScenario,
    onBack: () => undefined,
    onDiscardRequest: () => undefined,
    onDirtyChange: () => undefined,
    onRetry: () => undefined,
  };
}

describe('Phase 4 Console contracts', () => {
  it('stabilizes schema synchronization without a render loop', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      root.render(createElement(ProductEditorScreen, editorProps()));
      await Promise.resolve();
    });
    expect(container.querySelector('input[name="name"]') ?? container.querySelector('#product-name')).not.toBeNull();
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Maximum update depth');
    consoleError.mockRestore();
  });

  it('starts a new option group incomplete and blocks generation', async () => {
    await act(async () => root.render(createElement(ProductEditorScreen, editorProps())));
    const addGroup = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Add option group');
    await act(async () => addGroup?.click());
    const optionGroup = container.querySelector('.option-group');
    const inputs = Array.from(optionGroup?.querySelectorAll<HTMLInputElement>('input:not([type])') ?? []);
    expect(inputs.map((input) => input.value)).toEqual(['', '']);
    const generate = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Generate matrix');
    expect(generate?.disabled).toBe(true);
    expect(container.querySelector('[aria-label^="0 combinations."]')).not.toBeNull();
  });

  it('maps server fields to controls while retaining dirty input', async () => {
    const onSave = vi.fn(() => Promise.reject(new ConsoleApiError(422, 'validation_failed', 'Invalid Product.', [
      { path: '/product/basePrice', code: 'money_out_of_range', message: 'Price is too large.' },
    ], null)));
    await act(async () => root.render(createElement(ProductEditorScreen, { ...editorProps(), onSave })));
    const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Save Product'));
    await act(async () => { save?.click(); await Promise.resolve(); });
    const price = container.querySelector<HTMLInputElement>('#base-price');
    expect(price?.value).toBe('24.00');
    expect(price?.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('Price is too large.');
  });

  it('uses slug links and reports rejected template downloads', async () => {
    await act(async () => root.render(createElement(ProductListScreen, {
      state: 'populated',
      products: [{ id: 'prod-id', slug: 'field-notes', name: 'Field Notes', status: 'Active', type: 'Simple', effectivePrice: 'USD 24.00', enabledVariants: null, updated: 'now' }],
      onAddProduct: () => undefined,
      onEditProduct: () => undefined,
      onImportCsv: () => undefined,
      onDownloadTemplate: () => Promise.reject(new Error('offline')),
      onRetry: () => undefined,
    })));
    expect(container.querySelector<HTMLAnchorElement>('a.product-link')?.getAttribute('href')).toBe('/console/products/field-notes');
    const download = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Download CSV template'));
    await act(async () => { download?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain('CSV template could not be downloaded');
  });

  it('keeps existing value renames nonstructural', async () => {
    const variantScenario: ProductEditorScenario = {
      ...validScenario,
      lifecycle: 'ready',
      product: {
        ...validScenario.product,
        groups: [{
          id: 'group-theme', name: 'Theme', values: ['Dark'], valueIds: ['value-dark'],
          valueRefs: ['group:group-theme:value:value-dark'], participating: true,
        }],
        variants: [{
          id: 'variant-dark', combination: 'Dark', selectedValueRefs: ['group:group-theme:value:value-dark'],
          sku: 'DARK', priceOverride: '', effectivePrice: 'USD 24.00', priceSource: 'Base price',
          deliverySource: 'Product default', enabled: true,
        }],
      },
    };
    await act(async () => root.render(createElement(ProductEditorScreen, { ...editorProps(), scenario: variantScenario })));
    const value = container.querySelector<HTMLInputElement>('#value-group-theme-0');
    await act(async () => {
      if (value) {
        value.value = 'Midnight';
        value.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain('Preview and apply the structural Variant regeneration');
  });
});
