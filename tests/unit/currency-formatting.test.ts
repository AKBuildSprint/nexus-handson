import { describe, expect, it } from 'vitest';
import { formatMoney as formatConsoleMoney } from '../../apps/console/src/orders/format-money';
import { formatMoney as formatStorefrontMoney } from '../../apps/storefront/src/format-money';

const formatters = [
  ['Console', formatConsoleMoney],
  ['Storefront', formatStorefrontMoney],
] as const;

describe.each(formatters)('%s currency formatting', (_surface, formatMoney) => {
  it('does not scale zero-decimal VND amounts', () => {
    const expected = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(249_000);
    expect(formatMoney(249_000, 'VND', 'vi-VN')).toBe(expected);
  });

  it('scales two-decimal USD minor amounts', () => {
    const expected = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(24.9);
    expect(formatMoney(2_490, 'USD', 'en-US')).toBe(expected);
  });
});
