import { mkdir, rm, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function productionImportGraph(): Plugin {
  const projectRoot = process.cwd();
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
  plugins: [cloudflare(), react(), productionImportGraph()],
});
