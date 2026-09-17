import { mkdir, rm, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import {
  resolveConsoleWorkerIsolation,
  resolveIsolatedPersistRoot,
} from '../../scripts/verification/e2e-worker-environment';

const consoleRoot = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(consoleRoot, '../..');

function localPersistStatePath(): string {
  const configured = process['env'].NEXUS_TEST_PERSIST_ROOT;
  if (configured === undefined) return resolve(projectRoot, '.wrangler/state');
  return resolveIsolatedPersistRoot({
    projectRoot,
    persistRoot: configured,
    label: 'NEXUS_TEST_PERSIST_ROOT',
  });
}

const workerIsolation = resolveConsoleWorkerIsolation(process['env'], projectRoot);

function productionImportGraph(): Plugin {
  const metadataDirectory = resolve(projectRoot, '.nexus-build');
  const metadataPath = resolve(metadataDirectory, 'production-import-graph.json');
  const modules = new Set<string>();
  let initialized = false;

  return {
    name: 'nexus-production-import-graph',
    apply: 'build',
    async buildStart() {
      if (!initialized) {
        initialized = true;
        await rm(metadataDirectory, { recursive: true, force: true });
      }
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const moduleId of Object.keys(output.modules)) {
          const cleanId = moduleId.replace(/^\0/, '').split('?')[0];
          const projectPath = relative(projectRoot, cleanId).split(sep).join('/');
          if (
            projectPath !== '..' &&
            !projectPath.startsWith('../') &&
            !projectPath.startsWith('node_modules/')
          ) {
            modules.add(projectPath);
          }
        }
      }
    },
    async closeBundle() {
      await mkdir(metadataDirectory, { recursive: true });
      await writeFile(metadataPath, `${JSON.stringify({ modules: [...modules].sort() }, null, 2)}\n`, 'utf8');
    },
  };
}

export default defineConfig({
  root: consoleRoot,
  cacheDir: resolve(projectRoot, 'node_modules/.vite-console'),
  server: {
    strictPort: true,
    allowedHosts: ['nexus-console.cppsw.com'],
  },
  plugins: [
    cloudflare({
      configPath: resolve(projectRoot, 'wrangler.jsonc'),
      persistState: { path: localPersistStatePath() },
      // The root Wrangler config stays canonical. Under local E2E isolation the Worker only
      // takes its origins and auth secret from the harness, and `userConfigPath` moves the
      // `.dev.vars` / `.env` lookup into the isolated persistence root so a developer's own
      // repository-root secrets are neither read nor modified.
      config: workerIsolation && {
        userConfigPath: workerIsolation.workerConfigPath,
        vars: workerIsolation.vars,
      },
    }),
    react(),
    productionImportGraph(),
  ],
});
