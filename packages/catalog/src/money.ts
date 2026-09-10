const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;
const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

const supportedCurrencies = new Set(
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : [],
);
const fractionDigitsCache = new Map<string, number>();

export class MoneyError extends Error {
  constructor(
    readonly code: 'currency_invalid' | 'money_invalid' | 'money_over_precision' | 'money_out_of_range',
    message: string,
  ) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function currencyFractionDigits(currency: string): number {
  if (!CURRENCY_PATTERN.test(currency) || (supportedCurrencies.size > 0 && !supportedCurrencies.has(currency))) {
    throw new MoneyError('currency_invalid', 'Currency must be an uppercase ISO 4217 code.');
  }

  const cached = fractionDigitsCache.get(currency);
  if (cached !== undefined) return cached;

  try {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits;
    if (typeof digits !== 'number' || !Number.isInteger(digits) || digits < 0) {
      throw new MoneyError('currency_invalid', 'Currency fraction metadata is unavailable.');
    }
    fractionDigitsCache.set(currency, digits);
    return digits;
  } catch {
    throw new MoneyError('currency_invalid', 'Currency must be an uppercase ISO 4217 code.');
  }
}

export function decimalToMinor(decimal: string, currency: string): number {
  const fractionDigits = currencyFractionDigits(currency);
  const match = DECIMAL_PATTERN.exec(decimal);
  if (!match) {
    throw new MoneyError('money_invalid', 'Price must be a non-negative decimal string.');
  }

  const fraction = match[1] ?? '';
  if (fraction.length > fractionDigits) {
    throw new MoneyError(
      'money_over_precision',
      `Price has more than ${fractionDigits} fractional digits for ${currency}.`,
    );
  }

  const scale = 10n ** BigInt(fractionDigits);
  const whole = BigInt(decimal.split('.', 1)[0]);
  const paddedFraction = fraction.padEnd(fractionDigits, '0');
  const minor = whole * scale + BigInt(paddedFraction || '0');
  if (minor > MAX_SAFE_MINOR) {
    throw new MoneyError('money_out_of_range', 'Price exceeds the supported safe integer range.');
  }
  return Number(minor);
}

export function minorToDecimal(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new MoneyError('money_out_of_range', 'Minor price must be a non-negative safe integer.');
  }
  const fractionDigits = currencyFractionDigits(currency);
  if (fractionDigits === 0) return String(minor);
  const scale = 10 ** fractionDigits;
  const whole = Math.floor(minor / scale);
  return `${whole}.${String(minor % scale).padStart(fractionDigits, '0')}`;
}
