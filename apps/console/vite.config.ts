import { mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const consoleRoot = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(consoleRoot, '../..');

function localPersistStatePath(): string {
  const configured = process['env'].NEXUS_TEST_PERSIST_ROOT;
  if (configured === undefined) return resolve(projectRoot, '.wrangler/state');
  if (!isAbsolute(configured)) throw new TypeError('NEXUS_TEST_PERSIST_ROOT must be an absolute path.');
  const wranglerRoot = resolve(projectRoot, '.wrangler');
  const relativePath = relative(wranglerRoot, resolve(configured));
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new TypeError('NEXUS_TEST_PERSIST_ROOT must be an isolated directory under the repository .wrangler directory.');
  }
  return resolve(configured);
}

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
  plugins: [
    cloudflare({
      configPath: resolve(projectRoot, 'wrangler.jsonc'),
      persistState: { path: localPersistStatePath() },
    }),
    react(),
    productionImportGraph(),
  ],
});
