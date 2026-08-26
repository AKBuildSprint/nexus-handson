import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import type {
  CreateProductRequest,
  NonstructuralProductUpdateRequest,
  PreviewSchemaRequest,
  ProductCoreFields,
  ProductDetailResponse,
  ProductListResponse,
  SchemaDraft,
  SchemaPreviewResponse,
} from '../../src/catalog/catalog-types';
import {
  CSV_CONFIRMATION_HEADER,
  CSV_CONTENT_TYPE,
  CSV_FILENAME,
  CSV_FILENAME_HEADER,
  CSV_HEADER,
  CSV_HEADER_LINE,
  serializeCsvRow,
  type CsvRow,
  type ImportResultResponse,
} from '../../src/shared/csv-contract';
import { parseCliArguments, requireArgument } from '../../scripts/verification/cli';
import { parseAcceptanceManifest } from '../../scripts/verification/manifest';
import { appendFixture, loadFixtureManifest } from '../../scripts/verification/verification-fixtures';
import type { VerificationFixture } from '../../scripts/verification/types';

const ACCEPTANCE_PATH = 'design/reconciled-acceptance-manifest.md';
const DEFAULT_EVIDENCE_ROOT = 'plans/260826-0041-nexus-s1-product-catalog/reports/evidence/remote';
const DEFAULT_WORST_CASE = 'tests/fixtures/import/worst-case-500-rows.csv';
const PRIVATE_KEY_PATTERN = /(?:delivery\/[0-9a-f-]{16,}|imports\/[0-9a-f-]{16,}\.csv)/;
const RESPONSE_DENY_KEYS = /(?:privateobjectkey|storagekey|filekey|authorization|cookie)/i;

interface SmokeContext {
  baseUrl: string;
  prefix: string;
  fixturePath: string;
  evidenceRoot: string;
  acceptancePath: string;
  requestSequence: number;
}

interface CapturedResponse<T> {
  status: number;
  headers: Record<string, string>;
  body: T;
  rawBody: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = RESPONSE_DENY_KEYS.test(key) ? '[REDACTED]' : sanitize(child);
  }
  return output;
}

function publicHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of ['content-type', 'content-disposition', 'etag', 'location', 'cache-control']) {
    const value = headers.get(name);
    if (value !== null) output[name] = value;
  }
  return output;
}

async function request<T>(context: SmokeContext, input: {
  method?: string;
  route: string;
  manifestIds: string[];
  expectedStatus: number | number[];
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  requestJson?: unknown;
  label: string;
}): Promise<CapturedResponse<T>> {
  const method = input.method ?? 'GET';
  const body = input.requestJson === undefined ? input.body : JSON.stringify(input.requestJson);
  let fetchBody: BodyInit | undefined;
  if (typeof body === 'string') {
    fetchBody = body;
  } else if (body) {
    const copy = new ArrayBuffer(body.byteLength);
    new Uint8Array(copy).set(body);
    fetchBody = copy;
  }
  const response = await fetch(new URL(input.route, context.baseUrl), {
    method,
    headers: {
      Accept: 'application/json',
      ...(input.requestJson === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      ...input.headers,
    },
    ...(fetchBody !== undefined && method !== 'GET' && method !== 'HEAD' && method !== 'DELETE' ? { body: fetchBody } : {}),
    redirect: 'manual',
  });
  const rawBody = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  let parsed: unknown = rawBody;
  if (contentType.includes('json')) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error(`${input.label} returned invalid JSON.`);
    }
  }
  const expected = Array.isArray(input.expectedStatus) ? input.expectedStatus : [input.expectedStatus];
  assert(expected.includes(response.status), `${input.label} returned ${response.status}; expected ${expected.join(' or ')}. Body: ${rawBody.slice(0, 400)}`);
  const requestBytes = typeof body === 'string' ? Buffer.from(body) : body ?? new Uint8Array();
  const capture = {
    captured_at: new Date().toISOString(),
    label: input.label,
    request: {
      method,
      route: input.route,
      headers: Object.fromEntries(Object.entries(input.headers ?? {}).filter(([name]) => !/authorization|cookie/i.test(name))),
      body_bytes: requestBytes.byteLength,
      body_sha256: sha256(requestBytes),
      json: input.requestJson === undefined ? undefined : sanitize(input.requestJson),
    },
    response: {
      status: response.status,
      headers: publicHeaders(response.headers),
      body_bytes: Buffer.byteLength(rawBody),
      body_sha256: sha256(rawBody),
      body: sanitize(parsed),
    },
  };
  const serialized = JSON.stringify(capture, null, 2);
  assert(!PRIVATE_KEY_PATTERN.test(serialized), `${input.label} attempted to write a private object key into public evidence.`);
  context.requestSequence += 1;
  const filename = `${String(context.requestSequence).padStart(3, '0')}-${input.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
  for (const manifestId of [...new Set(input.manifestIds)]) {
    const directory = path.join(context.evidenceRoot, manifestId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, filename), `${serialized}\n`, { flag: 'wx' });
  }
  return { status: response.status, headers: publicHeaders(response.headers), body: parsed as T, rawBody };
}

function core(name: string, status: ProductCoreFields['status'] = 'active'): ProductCoreFields {
  return {
    name,
    basePrice: '19.95',
    currency: 'USD',
    status,
    publicDescription: `Public description for ${name}`,
    delivery: { accessTitle: `Download ${name}`, accessInstructions: 'Open the private file from the paid order.' },
  };
}

function schemaForCounts(prefix: string, counts: number[]): SchemaDraft {
  const groups = counts.map((count, groupIndex) => ({
    draftRef: `${prefix}-group-${groupIndex + 1}`,
    id: null,
    name: `Option ${groupIndex + 1}`,
    position: groupIndex,
    participating: true,
    values: Array.from({ length: count }, (_, valueIndex) => ({
      draftRef: `${prefix}-value-${groupIndex + 1}-${valueIndex + 1}`,
      id: null,
      label: `Value ${groupIndex + 1}.${valueIndex + 1}`,
      position: valueIndex,
    })),
  }));
  let selections: string[][] = [[]];
  for (const group of groups) selections = selections.flatMap((selection) => group.values.map((value) => [...selection, value.draftRef]));
  const skuPrefix = prefix.toUpperCase().replace(/[^A-Z0-9]+/g, '-');
  return {
    groups,
    rows: selections.map((selectedValueRefs, index) => ({
      id: null,
      selectedValueRefs,
      sku: `${skuPrefix}-${String(index + 1).padStart(2, '0')}`,
      status: 'enabled',
      priceOverride: index === 0 ? '24.50' : null,
      delivery: index === 0
        ? { source: 'variant_override', accessTitle: 'Variant download', accessInstructions: 'Open the Variant package.' }
        : { source: 'product_default' },
    })),
    confirmCombinations: selections.length >= 11 && selections.length <= 30,
  };
}

function schemaFromDetailForReplacement(detail: ProductDetailResponse, prefix: string): SchemaDraft {
  const removedValueId = detail.optionGroups[0]?.values[0]?.id;
  assert(removedValueId, 'Variant detail is missing the first value needed for structural replacement.');
  const groups = detail.optionGroups.map((group, groupIndex) => {
    const kept = group.values.filter((value) => value.id !== removedValueId || groupIndex !== 0).map((value) => ({
      draftRef: `existing-value-${value.id}`,
      id: value.id,
      label: value.label,
      position: value.position,
    }));
    const values = groupIndex === 0
      ? [...kept, { draftRef: `${prefix}-replacement-value`, id: null, label: 'Replacement', position: kept.length }]
      : kept;
    return {
      draftRef: `existing-group-${group.id}`,
      id: group.id,
      name: group.name,
      position: group.position,
      participating: group.participating,
      values: values.map((value, valueIndex) => ({ ...value, position: valueIndex })),
    };
  });
  let selections: string[][] = [[]];
  for (const group of groups.filter((candidate) => candidate.participating)) selections = selections.flatMap((selection) => group.values.map((value) => [...selection, value.draftRef]));
  const existingBySelection = new Map(detail.variants.map((variant) => [variant.selectedOptions.map((option) => `existing-value-${option.valueId}`).join('\0'), variant]));
  const skuPrefix = prefix.toUpperCase().replace(/[^A-Z0-9]+/g, '-');
  return {
    groups,
    rows: selections.map((selectedValueRefs, index) => {
      const existing = existingBySelection.get(selectedValueRefs.join('\0'));
      return {
        id: existing?.id ?? null,
        selectedValueRefs,
        sku: existing?.sku ?? `${skuPrefix}-REPLACEMENT-${index + 1}`,
        status: existing?.status ?? 'enabled',
        priceOverride: existing?.priceOverrideMinor === null || existing?.priceOverrideMinor === undefined ? null : '24.50',
        delivery: existing?.delivery.source === 'variant_override'
          ? { source: 'variant_override' as const, accessTitle: existing.delivery.accessTitle, accessInstructions: existing.delivery.accessInstructions }
          : { source: 'product_default' as const },
      };
    }),
    confirmCombinations: false,
  };
}

type UnrecordedFixture<T> = T extends VerificationFixture
  ? Omit<T, 'fixtureLabel' | 'recordedAt'> & { fixtureLabelSuffix: string }
  : never;

function fixture(context: SmokeContext, value: UnrecordedFixture<VerificationFixture>) {
  const { fixtureLabelSuffix, ...record } = value;
  appendFixture(context.fixturePath, context.acceptancePath, { ...record, fixtureLabel: `${context.prefix}-${fixtureLabelSuffix}`, recordedAt: new Date().toISOString() } as VerificationFixture);
}

function simpleCsvRow(slug: string): CsvRow {
  const row = Object.fromEntries(CSV_HEADER.map((column) => [column, ''])) as CsvRow;
  Object.assign(row, { product_slug: slug, product_name: slug, base_price: '7.00', currency: 'USD', product_status: 'active', access_title: 'Download', access_instructions: 'Open' });
  return row;
}

function partialGroupCsv(prefix: string): string {
  const rows = [simpleCsvRow(`${prefix}-eligible`)];
  for (let index = 0; index < 31; index += 1) {
    const row = simpleCsvRow(`${prefix}-blocked-31`);
    Object.assign(row, { variant_sku: `${prefix.toUpperCase()}-BLOCKED-${index + 1}`, variant_status: 'enabled', option_1_name: 'Edition', option_1_value: `Edition ${index + 1}` });
    rows.push(row);
  }
  return `${CSV_HEADER_LINE}\n${rows.map(serializeCsvRow).join('\n')}\n`;
}

function warningCsv(prefix: string, countA: number, countB: number): string {
  const rows: CsvRow[] = [];
  for (let first = 0; first < countA; first += 1) {
    for (let second = 0; second < countB; second += 1) {
      const row = simpleCsvRow(`${prefix}-warning`);
      Object.assign(row, {
        variant_sku: `${prefix.toUpperCase()}-WARNING-${first + 1}-${second + 1}`,
        variant_status: 'enabled', option_1_name: 'Theme', option_1_value: `Theme ${first + 1}`, option_2_name: 'License', option_2_value: `License ${second + 1}`,
      });
      rows.push(row);
    }
  }
  return `${CSV_HEADER_LINE}\n${rows.map(serializeCsvRow).join('\n')}\n`;
}

async function recordImportedProducts(context: SmokeContext, result: ImportResultResponse, label: string) {
  const addedSlugs = [...new Set(result.groups.flatMap((group) => group.rows.filter((row) => row.outcome === 'added').map((row) => row.productSlug)))];
  for (const slug of addedSlugs) {
    const detailResponse = await request<ProductDetailResponse>(context, { route: `/api/console/products/by-slug/${encodeURIComponent(slug)}`, manifestIds: ['API-002', 'TEST-006'], expectedStatus: 200, label: `${label}-added-${slug}` });
    fixture(context, { kind: 'product', manifestId: 'DEPLOY-004', fixtureLabelSuffix: `${label}-product-${slug}`, id: detailResponse.body.id, slug });
    for (const variant of detailResponse.body.variants) fixture(context, { kind: 'variant', manifestId: 'DEPLOY-004', fixtureLabelSuffix: `${label}-variant-${variant.id}`, id: variant.id, productId: detailResponse.body.id });
  }
}

async function postImport(context: SmokeContext, csv: string | Uint8Array, filename: string, label: string, expectedStatus: number, confirm = false) {
  const scenarioManifestIds = label === 'remote-500-row-import'
    ? ['CSV-015', 'DATA-008']
    : label.startsWith('template-')
      ? ['CSV-002', 'CSV-003']
      : [];
  const response = await request<ImportResultResponse | { error: { code: string } }>(context, {
    method: 'POST', route: '/api/console/imports', manifestIds: ['API-009', 'API-010', 'CSV-005', 'CSV-006', 'CSV-010', 'CSV-011', 'CSV-013', 'CSV-014', 'TEST-006', ...scenarioManifestIds], expectedStatus,
    headers: { 'Content-Type': CSV_CONTENT_TYPE, [CSV_FILENAME_HEADER]: encodeURIComponent(filename), ...(confirm ? { [CSV_CONFIRMATION_HEADER]: 'true' } : {}) },
    body: csv, label,
  });
  if (expectedStatus === 200) {
    const result = response.body as ImportResultResponse;
    assert(typeof result.importId === 'string' && result.importId !== '', `${label} returned no importId.`);
    fixture(context, { kind: 'import', manifestId: 'DEPLOY-004', fixtureLabelSuffix: `${label}-import`, id: result.importId, filename });
    fixture(context, { kind: 'object', manifestId: 'DEPLOY-004', fixtureLabelSuffix: `${label}-object`, alias: `${context.prefix}-${label}-import-object`, privateObjectKey: null, ownerKind: 'import', ownerId: result.importId, disposition: 'unresolved' });
    await recordImportedProducts(context, result, label);
  }
  return response;
}

async function runSmoke(context: SmokeContext, worstCasePath: string) {
  assert(loadFixtureManifest(context.fixturePath, context.acceptancePath).fixtures.length === 0, 'Remote smoke requires an empty private fixture manifest; recover or clean an interrupted run first.');
  for (const route of ['/console/products', '/console/products/new', '/console/products/direct-slug', '/console/products/import', '/console/unknown']) {
    const response = await request<string>(context, { route, manifestIds: ['ROUTE-003', 'UI-003'], expectedStatus: 200, label: `route-${route.replaceAll('/', '-')}` });
    assert(response.headers['content-type']?.includes('text/html'), `${route} did not return SPA HTML.`);
  }
  for (const route of ['/api', '/api/verification-route-not-found']) {
    const response = await request<{ error: { code: string; fields: unknown[] } }>(context, { route, manifestIds: ['API-012', 'API-013', 'ROUTE-004'], expectedStatus: 404, label: `route-${route.replaceAll('/', '-')}` });
    assert(response.body.error?.code === 'route_not_found' && Array.isArray(response.body.error.fields), `${route} did not return the exact JSON error envelope.`);
  }

  const boundaryCases = [
    { label: '10', counts: [10], expectedStatus: 200, expectedCount: 10, confirmationRequired: false },
    { label: '12', counts: [3, 4], expectedStatus: 200, expectedCount: 12, confirmationRequired: true },
    { label: '30', counts: [5, 6], expectedStatus: 200, expectedCount: 30, confirmationRequired: true },
    { label: '31', counts: [5, 7], expectedStatus: 422, expectedCount: null, confirmationRequired: null },
  ] as const;
  for (const boundary of boundaryCases) {
    const boundaryProduct = core(`${context.prefix} boundary ${boundary.label}`);
    const boundarySchema = schemaForCounts(`${context.prefix}-boundary-${boundary.label}`, [...boundary.counts]);
    const boundaryResponse = await request<SchemaPreviewResponse | { error: { code: string } }>(context, {
      method: 'POST',
      route: '/api/console/products/schema/preview',
      manifestIds: ['API-005', 'VAR-002', 'TEST-006'],
      expectedStatus: boundary.expectedStatus,
      requestJson: {
        productId: null,
        productSlug: `${context.prefix}-boundary-${boundary.label}`,
        product: boundaryProduct,
        schema: boundarySchema,
      },
      label: `schema-boundary-${boundary.label}`,
    });
    if (boundary.expectedCount !== null) {
      const preview = boundaryResponse.body as SchemaPreviewResponse;
      assert(preview.combinationCount === boundary.expectedCount, `Boundary ${boundary.label} returned the wrong combination count.`);
      assert(preview.confirmationRequired === boundary.confirmationRequired, `Boundary ${boundary.label} returned the wrong confirmation state.`);
    } else {
      assert((boundaryResponse.body as { error: { code: string } }).error.code === 'variant_limit_exceeded', 'Boundary 31 was not rejected.');
    }
  }

  const simpleName = `${context.prefix} simple`;
  const simpleCreate = await request<{ product: ProductDetailResponse }>(context, {
    method: 'POST', route: '/api/console/products', manifestIds: ['API-003', 'DATA-007', 'MONEY-001', 'VAR-001', 'TEST-006'], expectedStatus: 201,
    requestJson: { product: core(simpleName), schema: null, previewHash: null } satisfies CreateProductRequest, label: 'simple-create',
  });
  const simple = simpleCreate.body.product;
  fixture(context, { kind: 'product', manifestId: 'DEPLOY-004', fixtureLabelSuffix: 'simple-product', id: simple.id, slug: simple.slug });
  assert(simple.type === 'simple' && simple.variants.length === 0, 'Simple create returned a Variant aggregate.');
  const simpleList = await request<ProductListResponse>(context, { route: `/api/console/products?q=${encodeURIComponent(context.prefix)}`, manifestIds: ['API-001', 'TEST-006'], expectedStatus: 200, label: 'simple-list' });
  assert(simpleList.body.products.some((product) => product.id === simple.id), 'Created simple Product is absent from list.');
  await request<ProductDetailResponse>(context, { route: `/api/console/products/by-slug/${simple.slug}`, manifestIds: ['API-002', 'FILE-007', 'TEST-006'], expectedStatus: 200, label: 'simple-reopen' });
  const simpleUpdateBody: NonstructuralProductUpdateRequest = { product: { ...core(`${simpleName} edited`), publicDescription: 'Edited public description' }, optionLabels: { groups: [] }, variantEdits: [] };
  const simpleUpdated = await request<{ product: ProductDetailResponse }>(context, {
    method: 'PUT', route: `/api/console/products/${simple.id}`, manifestIds: ['API-004', 'API-014', 'TEST-006'], expectedStatus: 200,
    headers: { 'If-Match': `"${simple.revision}"` }, requestJson: simpleUpdateBody, label: 'simple-update',
  });
  assert(simpleUpdated.body.product.slug === simple.slug, 'Nonstructural edit changed the stable Product slug.');

  const variantProduct = core(`${context.prefix} variant`);
  const initialSchema = schemaForCounts(`${context.prefix}-variant`, [2, 2]);
  const previewRequest: PreviewSchemaRequest = { productId: null, productSlug: `${context.prefix}-variant`, product: variantProduct, schema: initialSchema };
  const createPreview = await request<SchemaPreviewResponse>(context, { method: 'POST', route: '/api/console/products/schema/preview', manifestIds: ['API-005', 'VAR-006', 'TEST-006'], expectedStatus: 200, requestJson: previewRequest, label: 'variant-create-preview' });
  const staleCreate = await request<{ error: { code: string } }>(context, {
    method: 'POST', route: '/api/console/products', manifestIds: ['API-003', 'API-016', 'TEST-006'], expectedStatus: 409,
    requestJson: { product: variantProduct, schema: initialSchema, previewHash: `${createPreview.body.previewHash}-stale` } satisfies CreateProductRequest, label: 'variant-create-stale-hash',
  });
  assert(staleCreate.body.error?.code === 'schema_preview_stale', 'Variant stale create did not return schema_preview_stale.');
  const staleAbsence = await request<ProductListResponse>(context, { route: `/api/console/products?q=${encodeURIComponent(`${context.prefix}-variant`)}`, manifestIds: ['API-003'], expectedStatus: 200, label: 'variant-create-stale-zero-write' });
  assert(staleAbsence.body.products.length === 0, 'Stale Variant create wrote a Product.');
  const variantCreate = await request<{ product: ProductDetailResponse }>(context, {
    method: 'POST', route: '/api/console/products', manifestIds: ['API-003', 'API-016', 'VAR-003', 'VAR-008', 'VAR-009', 'VAR-010', 'TEST-006'], expectedStatus: 201,
    requestJson: { product: variantProduct, schema: initialSchema, previewHash: createPreview.body.previewHash } satisfies CreateProductRequest, label: 'variant-create-success',
  });
  let variant = variantCreate.body.product;
  fixture(context, { kind: 'product', manifestId: 'DEPLOY-004', fixtureLabelSuffix: 'variant-product', id: variant.id, slug: variant.slug });
  for (const row of variant.variants) fixture(context, { kind: 'variant', manifestId: 'DEPLOY-004', fixtureLabelSuffix: `variant-${row.id}`, id: row.id, productId: variant.id });
  assert(variant.optionGroups.every((group) => !group.id.startsWith(context.prefix)), 'Client draft refs escaped as stable group IDs.');
  assert(!JSON.stringify(variant).includes(`${context.prefix}-value-`), 'Client value refs escaped into Product detail.');

  const renamedUpdate: NonstructuralProductUpdateRequest = {
    product: variantProduct,
    optionLabels: { groups: variant.optionGroups.map((group, groupIndex) => ({ id: group.id, name: groupIndex === 0 ? `${group.name} renamed` : group.name, values: group.values.map((value, valueIndex) => ({ id: value.id, label: groupIndex === 0 && valueIndex === 0 ? `${value.label} renamed` : value.label })) })) },
    variantEdits: variant.variants.map((row, index) => ({ id: row.id, sku: index === 0 ? `${context.prefix.toUpperCase()}-EDITED` : row.sku, status: index === 1 ? 'disabled' : row.status, priceOverride: index === 0 ? '29.00' : null, delivery: index === 0 ? { source: 'variant_override', accessTitle: 'Edited Variant access', accessInstructions: 'Edited Variant instructions' } : { source: 'product_default' } })),
  };
  const renamed = await request<{ product: ProductDetailResponse }>(context, {
    method: 'PUT', route: `/api/console/products/${variant.id}`, manifestIds: ['API-004', 'VAR-005', 'MONEY-004', 'VAR-009', 'TEST-006'], expectedStatus: 200,
    headers: { 'If-Match': `"${variant.revision}"` }, requestJson: renamedUpdate, label: 'variant-rename-edit',
  });
  variant = renamed.body.product;
  assert(variant.optionGroups[0]?.name.endsWith('renamed'), 'Label-only group rename was not persisted.');

  const replacementSchema = schemaFromDetailForReplacement(variant, context.prefix);
  const beforePreview = JSON.stringify(variant);
  const replacementPreview = await request<SchemaPreviewResponse>(context, {
    method: 'POST', route: '/api/console/products/schema/preview', manifestIds: ['API-005', 'VAR-006', 'TEST-006'], expectedStatus: 200,
    headers: { 'If-Match': `"${variant.revision}"` }, requestJson: { productId: variant.id, productSlug: variant.slug, product: variantProduct, schema: replacementSchema }, label: 'schema-replacement-preview',
  });
  assert(new Set(replacementPreview.body.rows.map((row) => row.outcome)).size === 3, 'Schema preview did not classify retained/new/will_disable.');
  const afterPreview = await request<ProductDetailResponse>(context, { route: `/api/console/products/by-slug/${variant.slug}`, manifestIds: ['API-005', 'VAR-006'], expectedStatus: 200, label: 'schema-preview-zero-write' });
  assert(JSON.stringify(afterPreview.body) === beforePreview, 'Schema preview changed persisted Product detail.');
  const staleApply = await request<{ error: { code: string } }>(context, {
    method: 'PUT', route: `/api/console/products/${variant.id}/schema`, manifestIds: ['API-006', 'TEST-006'], expectedStatus: 409,
    headers: { 'If-Match': `"${variant.revision}"` }, requestJson: { product: variantProduct, schema: replacementSchema, previewHash: `${replacementPreview.body.previewHash}-stale` }, label: 'schema-stale-apply',
  });
  assert(staleApply.body.error?.code === 'schema_preview_stale', 'Stale schema apply did not return schema_preview_stale.');
  const applied = await request<{ product: ProductDetailResponse }>(context, {
    method: 'PUT', route: `/api/console/products/${variant.id}/schema`, manifestIds: ['API-006', 'VAR-007', 'VAR-010', 'TEST-006'], expectedStatus: 200,
    headers: { 'If-Match': `"${variant.revision}"` }, requestJson: { product: variantProduct, schema: replacementSchema, previewHash: replacementPreview.body.previewHash }, label: 'schema-apply-success',
  });
  const knownVariantIds = new Set(variant.variants.map((row) => row.id));
  variant = applied.body.product;
  for (const row of variant.variants) if (!knownVariantIds.has(row.id)) fixture(context, { kind: 'variant', manifestId: 'DEPLOY-004', fixtureLabelSuffix: `applied-variant-${row.id}`, id: row.id, productId: variant.id });

  const pdfA = Buffer.from('%PDF-1.7\nNexus verification A\n%%EOF\n');
  const fileA = await request<{ revision: number }>(context, {
    method: 'PUT', route: `/api/console/products/${simple.id}/delivery-file`, manifestIds: ['API-007', 'FILE-001', 'FILE-003', 'FILE-004', 'FILE-005', 'TEST-006'], expectedStatus: 200,
    headers: { 'Content-Type': 'application/octet-stream', 'If-Match': `"${simpleUpdated.body.product.revision}"`, 'X-Nexus-Filename': encodeURIComponent(`${context.prefix}-a.pdf`) }, body: pdfA, label: 'product-file-upload',
  });
  fixture(context, { kind: 'object', manifestId: 'DEPLOY-004', fixtureLabelSuffix: 'product-file-a', alias: `${context.prefix}-product-file-a`, privateObjectKey: null, ownerKind: 'product', ownerId: simple.id, disposition: 'unresolved' });
  const pdfB = Buffer.from('%PDF-1.7\nNexus verification B replacement\n%%EOF\n');
  const fileB = await request<{ revision: number }>(context, {
    method: 'PUT', route: `/api/console/products/${simple.id}/delivery-file`, manifestIds: ['API-007', 'FILE-005', 'FILE-006', 'TEST-006'], expectedStatus: 200,
    headers: { 'Content-Type': 'application/octet-stream', 'If-Match': `"${fileA.body.revision}"`, 'X-Nexus-Filename': encodeURIComponent(`${context.prefix}-b.pdf`) }, body: pdfB, label: 'product-file-replace',
  });
  fixture(context, { kind: 'object', manifestId: 'DEPLOY-004', fixtureLabelSuffix: 'product-file-b', alias: `${context.prefix}-product-file-b`, privateObjectKey: null, ownerKind: 'product', ownerId: simple.id, disposition: 'unresolved' });
  const removedFile = await request<{ revision: number }>(context, { method: 'DELETE', route: `/api/console/products/${simple.id}/delivery-file`, manifestIds: ['API-007', 'FILE-006', 'TEST-006'], expectedStatus: 200, headers: { 'If-Match': `"${fileB.body.revision}"` }, label: 'product-file-remove' });
  const invalidFile = await request<{ error: { code: string } }>(context, {
    method: 'PUT', route: `/api/console/products/${simple.id}/delivery-file`, manifestIds: ['FILE-001', 'API-013', 'TEST-006'], expectedStatus: 415,
    headers: { 'Content-Type': 'application/octet-stream', 'If-Match': `"${removedFile.body.revision}"`, 'X-Nexus-Filename': encodeURIComponent(`${context.prefix}-invalid.pdf`) }, body: Buffer.from('not a PDF or ZIP'), label: 'product-file-invalid-type',
  });
  assert(invalidFile.body.error?.code === 'delivery_file_type_invalid', 'Invalid delivery bytes were not rejected by actual type.');
  const template = await request<string>(context, { route: '/api/console/imports/template', manifestIds: ['API-008', 'CSV-002', 'CSV-003', 'TEST-006'], expectedStatus: 200, label: 'template-download' });
  assert(template.headers['content-disposition'] === `attachment; filename="${CSV_FILENAME}"`, 'Template filename header differs from the locked contract.');
  assert(template.rawBody.startsWith(`${CSV_HEADER_LINE}\n`), 'Template does not have the exact ordered 21-column header.');
  const templateImport = await postImport(context, template.rawBody, CSV_FILENAME, 'template-import', 200);
  await postImport(context, template.rawBody, CSV_FILENAME, 'template-reimport', 200);
  assert((templateImport.body as ImportResultResponse).groups.length > 0, 'Exact template import returned no Product groups.');
  const partial = await postImport(context, partialGroupCsv(context.prefix), `${context.prefix}-partial.csv`, 'partial-groups', 200);
  const partialResult = partial.body as ImportResultResponse;
  assert(partialResult.counts.added >= 1 && partialResult.counts.rejected >= 31, 'Partial-group import did not retain the blocked group beside an eligible commit.');
  const warning = warningCsv(context.prefix, 3, 4);
  const missingConfirmation = await postImport(context, warning, `${context.prefix}-warning.csv`, 'warning-missing-confirmation', 422);
  assert((missingConfirmation.body as { error: { code: string } }).error.code === 'variant_confirmation_required', '12-combination import did not require confirmation.');
  await postImport(context, warning, `${context.prefix}-warning.csv`, 'warning-confirmed', 200, true);

  const worstSource = readFileSync(worstCasePath, 'utf8');
  const parsedWorst = Papa.parse<CsvRow>(worstSource, { header: true, skipEmptyLines: true });
  assert(parsedWorst.errors.length === 0 && parsedWorst.data.length === 500, 'Worst-case fixture must contain exactly 500 valid rows.');
  const prefixedWorstRows = parsedWorst.data.map((row, index) => ({ ...row, product_slug: `${context.prefix}-bulk-${String(index + 1).padStart(4, '0')}`, product_name: `${context.prefix} Bulk ${String(index + 1).padStart(4, '0')}`, access_title: `Download ${context.prefix} Bulk ${String(index + 1).padStart(4, '0')}`, variant_sku: `${context.prefix.toUpperCase()}-BULK-${String(index + 1).padStart(4, '0')}` }));
  const prefixedWorst = `${CSV_HEADER_LINE}\n${prefixedWorstRows.map(serializeCsvRow).join('\n')}\n`;
  assert(Buffer.byteLength(prefixedWorst) <= 1_000_000, 'Prefixed 500-row fixture exceeds the locked byte maximum.');
  const worstImport = await postImport(context, prefixedWorst, `${context.prefix}-500.csv`, 'remote-500-row-import', 200);
  assert((worstImport.body as ImportResultResponse).counts.added === 500, 'Remote 500-row fixture did not add exactly 500 rows.');
  const row501 = `${CSV_HEADER_LINE}\n${Array.from({ length: 501 }, (_, index) => serializeCsvRow(simpleCsvRow(`${context.prefix}-row-${index + 1}`))).join('\n')}\n`;
  const rowFailure = await postImport(context, row501, `${context.prefix}-501.csv`, 'remote-501-row-rejection', 413);
  assert((rowFailure.body as { error: { code: string } }).error.code === 'csv_row_limit_exceeded', 'Row 501 did not fail with csv_row_limit_exceeded.');
  const byteFailure = await postImport(context, new Uint8Array(1_000_001), `${context.prefix}-oversize.csv`, 'remote-byte-overflow-rejection', 413);
  assert((byteFailure.body as { error: { code: string } }).error.code === 'csv_size_exceeded', 'Byte 1,000,001 did not fail with csv_size_exceeded.');

  const publicCatalog = await request<Record<string, unknown>>(context, { route: '/api/storefront/products', manifestIds: ['API-011', 'PRIV-002', 'PRIV-003', 'PRIV-004', 'TEST-006'], expectedStatus: 200, label: 'public-catalog-privacy' });
  const publicText = JSON.stringify(publicCatalog.body);
  assert(!/(?:accessTitle|accessInstructions|delivery|filename|fileKey|storage|bucket|privateObject|importId)/i.test(publicText), 'Public catalog recursively exposed private delivery/storage/import vocabulary.');
  assert(publicText.includes(simple.id) && publicText.includes(variant.id), 'Public catalog omitted active verification Products.');
}

function main() {
  const arguments_ = parseCliArguments(process.argv.slice(2));
  if (arguments_.command !== 'run') throw new Error('Usage: remote-contract-smoke.ts run --fixture-manifest path --prefix value [--base-url URL] [--evidence-root path] [--worst-case-csv path] [--dry-run]');
  const root = process.cwd();
  const acceptancePath = path.resolve(root, arguments_.values.manifest ?? ACCEPTANCE_PATH);
  parseAcceptanceManifest(acceptancePath);
  const fixturePath = path.resolve(root, requireArgument(arguments_, 'fixture-manifest'));
  const prefix = requireArgument(arguments_, 'prefix');
  const baseUrl = (arguments_.values['base-url'] ?? process.env.BASE_URL ?? '').replace(/\/$/, '');
  assert(baseUrl !== '', 'BASE_URL or --base-url is required.');
  const fixtureManifest = loadFixtureManifest(fixturePath, acceptancePath);
  assert(fixtureManifest.verificationPrefix === prefix, 'CLI prefix does not match the private fixture manifest.');
  assert(fixtureManifest.baseUrl === baseUrl, 'CLI BASE_URL does not match the private fixture manifest.');
  const worstCasePath = path.resolve(root, arguments_.values['worst-case-csv'] ?? DEFAULT_WORST_CASE);
  const worstCase = readFileSync(worstCasePath);
  assert(worstCase.byteLength <= 1_000_000 && worstCase.toString('utf8').split(/\r?\n/).filter(Boolean).length === 501, 'Worst-case CSV input must be at most 1,000,000 bytes with exactly 500 data rows.');
  if (arguments_.flags.has('dry-run')) {
    process.stdout.write('Remote smoke inputs are valid; no requests, fixtures, or evidence were created.\n');
    return;
  }
  const evidenceRoot = path.resolve(root, arguments_.values['evidence-root'] ?? DEFAULT_EVIDENCE_ROOT);
  const context: SmokeContext = { baseUrl, prefix, fixturePath, evidenceRoot, acceptancePath, requestSequence: 0 };
  void runSmoke(context, worstCasePath).then(() => process.stdout.write(`Remote contract smoke completed with ${context.requestSequence} captured requests.\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
