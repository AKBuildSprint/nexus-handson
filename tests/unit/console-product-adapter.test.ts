import { describe, expect, it } from 'vitest';
import { buildSchema } from '../../src/console/production-console-app';
import type { ProductEditorFixture } from '../../src/console/products/product-ui-types';

const product: ProductEditorFixture = {
  name: 'Color Pack',
  status: 'Draft',
  basePrice: '10.00',
  currency: 'USD',
  publicDescription: '',
  delivery: { accessTitle: 'Open', accessInstructions: 'Open it' },
  groups: [{
    id: 'local-group',
    name: 'Color',
    participating: true,
    values: ['Red / Blue'],
    valueIds: [null],
    valueRefs: ['color-red-blue'],
  }],
  variants: [{
    id: 'local-variant',
    combination: 'Red / Blue',
    selectedValueRefs: ['color-red-blue'],
    sku: 'COLOR-RED-BLUE',
    priceOverride: '',
    effectivePrice: 'USD 10.00',
    priceSource: 'Base price',
    deliverySource: 'Product default',
    enabled: true,
  }],
};

describe('production Product schema adapter', () => {
  it('carries stable selection refs without parsing display labels', () => {
    const schema = buildSchema(product, null);
    expect(schema.groups[0].values[0]).toMatchObject({ draftRef: 'color-red-blue', label: 'Red / Blue' });
    expect(schema.rows[0].selectedValueRefs).toEqual(['color-red-blue']);
  });
});
