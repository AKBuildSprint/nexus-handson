import { readFile, rm } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

interface ImportGraph {
  modules: string[];
}

const ROOT = process.cwd();
const METADATA_DIRECTORY = resolve(ROOT, '.nexus-build');
const METADATA_PATH = resolve(METADATA_DIRECTORY, 'production-import-graph.json');
const PUBLIC_METADATA_PATH = resolve(ROOT, 'dist/client/production-import-graph.json');
const FORBIDDEN_PROJECT_MODULE =
  /(^|\/)design\/|prototype-scenarios|(^|\/)[^/]*prototype[^/]*\.(?:[cm]?[jt]sx?)$|(^|\/)[^/]*scenario[^/]*\.(?:[cm]?[jt]sx?)$|(^|\/)fixtures?\//i;

try {
  const graph = JSON.parse(await readFile(METADATA_PATH, 'utf8')) as ImportGraph;
  const reachableProjectModules = new Set(graph.modules);
  const unsafeMetadataPaths = [...reachableProjectModules].filter(
    (moduleId) => isAbsolute(moduleId) || moduleId === '..' || moduleId.startsWith('../') || moduleId.includes('\\'),
  );
  if (unsafeMetadataPaths.length > 0) {
    throw new Error(`Production import graph contains unsanitized module paths:\n${unsafeMetadataPaths.sort().join('\n')}`);
  }

  const forbidden = [...reachableProjectModules].filter((moduleId) => FORBIDDEN_PROJECT_MODULE.test(moduleId));
  if (forbidden.length > 0) {
    throw new Error(`Production import graph reaches forbidden design/prototype modules:\n${forbidden.sort().join('\n')}`);
  }

  if (![...reachableProjectModules].some((moduleId) => moduleId.endsWith('src/console/main.tsx'))) {
    throw new Error('Production import graph metadata does not contain the Console entrypoint.');
  }

  console.log(`Production import graph clean: ${reachableProjectModules.size} project modules checked.`);
} finally {
  await Promise.all([
    rm(METADATA_DIRECTORY, { recursive: true, force: true }),
    rm(PUBLIC_METADATA_PATH, { force: true }),
  ]);
}
