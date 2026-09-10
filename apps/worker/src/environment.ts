import type { AuthConfiguration } from '@nexus/auth/auth';

export type Env = Cloudflare.Env & AuthConfiguration & {
  STOREFRONT_ORIGIN: string;
};
