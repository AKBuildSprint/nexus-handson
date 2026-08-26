export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export const VARIANT_STATUSES = ['enabled', 'disabled'] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export const OPTION_GROUPS_MAX = 5;
export const OPTION_VALUES_PER_GROUP_MAX = 10;
export const COMBINATIONS_NORMAL_MAX = 10;
export const COMBINATIONS_CONFIRMATION_MIN = 11;
export const COMBINATIONS_CONFIRMATION_MAX = 30;
export const COMBINATIONS_BLOCKED_MIN = 31;

export const CSV_BYTES_MAX = 1_000_000;
export const CSV_FIRST_REJECTED_BYTE = 1_000_001;
export const CSV_DATA_ROWS_MAX = 500;
export const CSV_FIRST_REJECTED_ROW = 501;
export const DELIVERY_FILE_BYTES_MAX = 25_000_000;
export const DELIVERY_FILE_FIRST_REJECTED_BYTE = 25_000_001;
