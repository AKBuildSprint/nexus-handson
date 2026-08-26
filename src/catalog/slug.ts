const COMBINING_MARKS = /\p{M}+/gu;
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

export function normalizeComparisonKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export function slugifyProductName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, '-')
    .replace(EDGE_DASHES, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'product';
}

export function stableId(prefix: 'prod' | 'grp' | 'val' | 'var'): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
