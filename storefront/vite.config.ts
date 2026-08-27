import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const storefrontRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(storefrontRoot, '..');
const metadataDirectory = resolve(projectRoot, 'node_modules/.vite-storefront');
const metadataPath = resolve(metadataDirectory, 'production-import-graph.json');

function storefrontProductionImportGraph(): Plugin {
  const modules = new Set<string>();

  return {
    name: 'nexus-storefront-production-import-graph',
    apply: 'build',
    async buildStart() {
      modules.clear();
      await rm(metadataPath, { force: true });
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
  root: storefrontRoot,
  cacheDir: resolve(projectRoot, 'node_modules/.vite-storefront'),
  plugins: [react(), storefrontProductionImportGraph()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    strictPort: true,
  },
  preview: {
    strictPort: true,
  },
});
