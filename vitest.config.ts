import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-08-22',
        d1Databases: ['DB'],
        r2Buckets: ['FILES'],
      },
    }),
  ],
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
