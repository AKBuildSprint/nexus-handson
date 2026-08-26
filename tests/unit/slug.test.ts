import { describe, expect, it } from 'vitest';
import { normalizeComparisonKey, slugifyProductName } from '../../src/catalog/slug';

describe('catalog normalization', () => {
  it('normalizes comparison keys with NFKC, trim, and locale-independent lowercase', () => {
    expect(normalizeComparisonKey('  ＴHÈME  ')).toBe('thème');
  });

  it('creates stable URL-safe Product slugs', () => {
    expect(slugifyProductName('  Focus Päck — 2026 ')).toBe('focus-pack-2026');
    expect(slugifyProductName('---')).toBe('product');
  });
});
