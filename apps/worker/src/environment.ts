export type Env = Cloudflare.Env & {
  BETTER_AUTH_SECRET: string;
  CONSOLE_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  STOREFRONT_ORIGIN: string;
};
