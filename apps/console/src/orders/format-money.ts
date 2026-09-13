export function formatMoney(
  minor: number,
  currency: string,
  locales?: Intl.LocalesArgument,
): string {
  const formatter = new Intl.NumberFormat(locales, { style: 'currency', currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  return formatter.format(minor / (10 ** fractionDigits));
}
