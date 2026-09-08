import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FINAL = true;

const MIGRATIONS: Record<string, string> = {
  '0001-store-products.sql': '0ba36debcaf9e6201950ed360abe0d0734a98276a3fea6bb380bbe0b647e3486',
  '0002-product-variants.sql': '4df83518437dad222cc031b301f16632e260acf043c9ad84b76789dcb702057b',
  '0003-imports.sql': 'a677ff0e930ddd06bb1840840b2f8641aef2e04e946d094b8deffb8190830137',
  '0004-orders.sql': 'ffa47c76895199fd7f979b59acb5f7e2e5490583584ae1c90ea1250f3a79272f',
  '0005-order-operations.sql': '085db2de51a3eff6542efdbe6158a2e38fb14b57073e354f56054c6d8bca3515',
};

const errors: string[] = [];

function fail(message: string): void {
  errors.push(message);
}

function readJson(relativePath: string): Record<string, unknown> {
  const absolute = join(ROOT, relativePath);
  if (!existsSync(absolute)) {
    fail(`missing ${relativePath}`);
    return {};
  }
  return JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
}

function sha256File(relativePath: string): string {
  return createHash('sha256').update(readFileSync(join(ROOT, relativePath))).digest('hex');
}

function isDir(relativePath: string): boolean {
  const absolute = join(ROOT, relativePath);
  return existsSync(absolute) && statSync(absolute).isDirectory();
}

const rootPackage = readJson('package.json');
const workspaces = rootPackage.workspaces;
if (!Array.isArray(workspaces) || workspaces.join(',') !== 'apps/*,packages/*') {
  fail(`root workspaces must be ["apps/*","packages/*"], got ${JSON.stringify(workspaces)}`);
}

const expectedPackages: Array<[string, string]> = [
  ['packages/catalog/package.json', '@nexus/catalog'],
  ['packages/orders/package.json', '@nexus/orders'],
  ['apps/console/package.json', '@nexus/console'],
  ['apps/storefront/package.json', '@nexus/storefront'],
  ['apps/worker/package.json', '@nexus/worker'],
];

for (const [path, name] of expectedPackages) {
  const manifest = readJson(path);
  if (manifest.name !== name) fail(`${path} name must be ${name}, got ${JSON.stringify(manifest.name)}`);
}

for (const [filename, digest] of Object.entries(MIGRATIONS)) {
  const relativePath = `migrations/${filename}`;
  if (!existsSync(join(ROOT, relativePath))) {
    fail(`missing ${relativePath}`);
    continue;
  }
  const actual = sha256File(relativePath);
  if (actual !== digest) fail(`${relativePath} hash ${actual} != ${digest}`);
}

const wranglerRaw = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
const wrangler = JSON.parse(wranglerRaw) as {
  name?: string;
  main?: string;
  assets?: { binding?: string; run_worker_first?: string[] };
  r2_buckets?: Array<{ binding?: string; bucket_name?: string; remote?: boolean }>;
  d1_databases?: Array<{ binding?: string; database_name?: string; database_id?: string; remote?: boolean }>;
};
if (wrangler.name !== 'nexus-s1-468cba') fail(`wrangler name ${wrangler.name}`);
if (wrangler.assets?.binding !== 'ASSETS') fail(`assets.binding ${wrangler.assets?.binding}`);
const runFirst = wrangler.assets?.run_worker_first ?? [];
if (runFirst[0] !== '/api' || runFirst[1] !== '/api/*') fail(`run_worker_first ${JSON.stringify(runFirst)}`);
const r2 = wrangler.r2_buckets?.[0];
if (r2?.binding !== 'FILES' || r2.bucket_name !== 'nexus-s1-468cba-private' || r2.remote === true) {
  fail(`r2 identity ${JSON.stringify(r2)}`);
}
const d1 = wrangler.d1_databases?.[0];
if (
  d1?.binding !== 'DB' ||
  d1.database_name !== 'nexus-s1-468cba-db' ||
  d1.database_id !== '7424d853-fa0b-4e6c-b341-eca85b82e4bd' ||
  d1.remote === true
) {
  fail(`d1 identity ${JSON.stringify(d1)}`);
}

if (FINAL) {
  if (isDir('src')) fail('src/ must not exist after cutover');
  if (isDir('storefront')) fail('storefront/ must not exist after cutover');
  for (const path of [
    'apps/worker/src/index.ts',
    'apps/console/src/main.tsx',
    'apps/storefront/src/main.tsx',
    'packages/catalog/src/catalog-read.ts',
    'packages/orders/src/order-write.ts',
  ]) {
    if (!existsSync(join(ROOT, path))) fail(`missing ${path}`);
  }
  if (wrangler.main !== 'apps/worker/src/index.ts') fail(`wrangler.main ${wrangler.main}`);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  if (!html.includes('id="root"')) fail('index.html missing id="root"');
  if (!html.includes('apps/console/src/main.tsx')) fail('index.html script must point at apps/console/src/main.tsx');
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(FINAL ? 'Workspace layout (final) OK.' : 'Workspace layout OK.');
