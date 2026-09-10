import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleApiError } from '../../apps/console/src/api-client';
import { ProductEditorScreen } from '../../apps/console/src/products/product-editor-screen';
import { ProductListScreen } from '../../apps/console/src/products/product-list-screen';
import type { ProductEditorScenario } from '../../apps/console/src/products/product-ui-types';
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

  it('pages filtered Products, resets on search and status, and clamps after shrink', async () => {
    window.history.replaceState({}, '', '/console/products');
    const listProps = {
      state: 'populated' as const,
      onAddProduct: () => undefined,
      onEditProduct: () => undefined,
      onImportCsv: () => undefined,
      onDownloadTemplate: () => undefined,
      onRetry: () => undefined,
    };
    const catalog = Array.from({ length: 26 }, (_, index) => ({
      id: `prod-${index + 1}`,
      slug: `catalog-item-${index + 1}`,
      name: `Catalog item ${index + 1}`,
      status: index === 25 ? 'Draft' as const : 'Active' as const,
      type: 'Simple' as const,
      effectivePrice: 'USD 1.00',
      enabledVariants: null,
      updated: 'now',
    }));
    await act(async () => root.render(createElement(ProductListScreen, { ...listProps, products: catalog })));
    const top = () => container.querySelector('[aria-label="Product pages top"]');
    const bottom = () => container.querySelector('[aria-label="Product pages bottom"]');
    const pagerButton = (label: string, name: string) => (
      Array.from(container.querySelector(`[aria-label="${label}"]`)?.querySelectorAll('button') ?? [])
        .find((button) => button.textContent?.trim() === name)
    );
    expect(container.querySelectorAll('.console-table tbody tr')).toHaveLength(25);
    expect(container.querySelectorAll('.product-summary-card')).toHaveLength(25);
    expect(top()?.textContent).toContain('Showing 1–25 of 26');
    expect(top()?.textContent).toContain('Page 1 of 2');
    expect(bottom()?.textContent).toContain('Showing 1–25 of 26');
    expect(pagerButton('Product pages top', 'Previous')?.disabled).toBe(true);
    expect(pagerButton('Product pages top', 'Next')?.disabled).toBe(false);
    const productsMetric = Array.from(container.querySelectorAll('.metric-card')).find((card) => card.querySelector('.metric-label')?.textContent === 'Products');
    expect(productsMetric?.querySelector('.metric-value')?.textContent).toBe('26');
    expect(Array.from(container.querySelectorAll('button')).filter((button) => /^\d+$/.test(button.textContent?.trim() ?? ''))).toHaveLength(0);
    await act(async () => { pagerButton('Product pages bottom', 'Next')?.click(); });
    expect(container.querySelectorAll('.console-table tbody tr')).toHaveLength(1);
    expect(top()?.textContent).toContain('Showing 26–26 of 26');
    expect(top()?.textContent).toContain('Page 2 of 2');
    expect(pagerButton('Product pages bottom', 'Previous')?.disabled).toBe(false);
    expect(pagerButton('Product pages bottom', 'Next')?.disabled).toBe(true);
    expect(productsMetric?.querySelector('.metric-value')?.textContent).toBe('26');
    const search = container.querySelector<HTMLInputElement>('#product-search');
    if (!search) throw new Error('missing product search');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'Catalog item 26');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelectorAll('.console-table tbody tr')).toHaveLength(1);
    expect(top()?.textContent).toContain('Showing 1–1 of 1');
    expect(top()?.textContent).toContain('Page 1 of 1');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { pagerButton('Product pages top', 'Next')?.click(); });
    expect(top()?.textContent).toContain('Page 2 of 2');
    const draftTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.trim() === 'Draft');
    await act(async () => { draftTab?.click(); });
    expect(container.querySelectorAll('.console-table tbody tr')).toHaveLength(1);
    expect(top()?.textContent).toContain('Showing 1–1 of 1');
    expect(pagerButton('Product pages top', 'Previous')?.disabled).toBe(true);
    expect(productsMetric?.querySelector('.metric-value')?.textContent).toBe('26');
    const allTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.trim() === 'All');
    await act(async () => { allTab?.click(); });
    await act(async () => { pagerButton('Product pages top', 'Next')?.click(); });
    await act(async () => root.render(createElement(ProductListScreen, { ...listProps, products: catalog.slice(0, 10) })));
    expect(container.querySelectorAll('.console-table tbody tr')).toHaveLength(10);
    expect(top()?.textContent).toContain('Showing 1–10 of 10');
    expect(top()?.textContent).toContain('Page 1 of 1');
    expect(pagerButton('Product pages top', 'Previous')?.disabled).toBe(true);
    expect(pagerButton('Product pages top', 'Next')?.disabled).toBe(true);
    const productsMetricAfterShrink = Array.from(container.querySelectorAll('.metric-card')).find((card) => card.querySelector('.metric-label')?.textContent === 'Products');
    expect(productsMetricAfterShrink?.querySelector('.metric-value')?.textContent).toBe('10');
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
