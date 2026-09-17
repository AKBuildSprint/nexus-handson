export type Env = Cloudflare.Env & {
  BETTER_AUTH_SECRET: string;
  CONSOLE_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  STOREFRONT_ORIGIN: string;
  INITIAL_OWNER_EMAIL: string;
  PAYFS_WEBHOOK_API_KEY?: string;
  PAYFS_MERCHANT_BANK?: string;
  PAYFS_MERCHANT_ACCOUNT?: string;
  PAYFS_FEFAULT_ACCOUNT?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
};
