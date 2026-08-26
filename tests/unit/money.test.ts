import { describe, expect, it } from 'vitest';
import { decimalToMinor, MoneyError } from '../../src/catalog/money';

describe('decimal money', () => {
  it('uses currency fraction metadata and string arithmetic', () => {
    expect(decimalToMinor('24.00', 'USD')).toBe(2400);
    expect(decimalToMinor('24', 'JPY')).toBe(24);
    expect(decimalToMinor('1.234', 'KWD')).toBe(1234);
  });

  it.each(['-1.00', '1e2', ' 1.00', '1.001'])('rejects malformed or over-precision USD input %s', (value) => {
    expect(() => decimalToMinor(value, 'USD')).toThrow(MoneyError);
  });

  it('rejects lowercase currency and unsafe minor values', () => {
    expect(() => decimalToMinor('1.00', 'usd')).toThrowError(/uppercase ISO 4217/);
    expect(() => decimalToMinor('9007199254740992.00', 'USD')).toThrowError(/safe integer/);
  });
});
