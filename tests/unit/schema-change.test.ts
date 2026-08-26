import { describe, expect, it } from 'vitest';
import { previewSchemaChange, schemaPreviewHash } from '../../src/catalog/schema-change';
import { SIMPLE_CORE, oneVariantSchema } from '../support/catalog-test-env';

describe('stateless schema preview', () => {
  it('hashes only canonical ProductCore and SchemaDraft content deterministically', async () => {
    const schema = oneVariantSchema();
    await expect(schemaPreviewHash(SIMPLE_CORE, schema)).resolves.toBe(await schemaPreviewHash({ ...SIMPLE_CORE }, { ...schema }));
  });

  it('classifies new and obsolete rows without assigning stable IDs', async () => {
    const response = await previewSchemaChange({
      productSlug: 'field-notes',
      product: SIMPLE_CORE,
      schema: oneVariantSchema(),
      existingVariants: [{ id: 'var-old', combinationKey: 'old:key', selectedValueIds: [], sku: 'OLD', currentSchema: true }],
    });
    expect(response.combinationCount).toBe(1);
    expect(response.rows.map((row) => [row.outcome, row.variantId])).toEqual([
      ['new', null],
      ['will_disable', 'var-old'],
    ]);
  });
});
