import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProductCoreFields,
  ProductDetailResponse,
  ProductListItem,
  ProductStatus,
  SchemaDraft,
} from '../catalog/catalog-types';
import { minorToDecimal } from '../catalog/money';
import { slugifyProductName } from '../catalog/slug';
import { CsvImportScreen } from './imports/csv-import-screen';
import {
  applyProductSchema,
  createProduct,
  downloadCsvTemplate,
  fetchProductBySlug,
  fetchProducts,
  previewProductSchema,
  removeDeliveryFile,
  replaceDeliveryFile,
  updateProduct,
} from './api-client';
import { ConsoleShell } from './layout/console-shell';
import { ProductEditorScreen } from './products/product-editor-screen';
import { ProductListScreen } from './products/product-list-screen';
import type {
  ProductEditorFixture,
  ProductEditorScenario,
  ProductListState,
  ProductSummary,
  VariantFixture,
} from './products/product-ui-types';

type ConsoleRoute = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; slug: string } | { kind: 'import' };
type PendingFile = File | 'remove' | null;

const EMPTY_PRODUCT: ProductEditorFixture = {
  name: '',
  status: 'Draft',
  basePrice: '',
  currency: 'USD',
  publicDescription: '',
  delivery: { accessTitle: '', accessInstructions: '' },
  groups: [],
  variants: [],
};

function parseRoute(pathname: string): ConsoleRoute {
  if (pathname === '/console/products/new') return { kind: 'new' };
  if (pathname === '/console/products/import') return { kind: 'import' };
  const match = /^\/console\/products\/([^/]+)$/.exec(pathname);
  if (match) {
    try {
      return { kind: 'edit', slug: decodeURIComponent(match[1]) };
    } catch {
      return { kind: 'list' };
    }
  }
  return { kind: 'list' };
}

function routePath(route: ConsoleRoute): string {
  if (route.kind === 'new') return '/console/products/new';
  if (route.kind === 'import') return '/console/products/import';
  if (route.kind === 'edit') return `/console/products/${encodeURIComponent(route.slug)}`;
  return '/console/products';
}

function titledStatus(status: ProductStatus): ProductEditorFixture['status'] {
  return `${status[0].toUpperCase()}${status.slice(1)}` as ProductEditorFixture['status'];
}

function statusValue(status: ProductEditorFixture['status']): ProductStatus {
  return status.toLowerCase() as ProductStatus;
}

function fileFixture(file: ProductDetailResponse['delivery']['file']) {
  return file.present ? {
    name: file.filename,
    sizeLabel: `${(file.sizeBytes / 1_000_000).toFixed(2)} MB`,
    kind: file.kind.toUpperCase() as 'PDF' | 'ZIP',
  } : undefined;
}

function detailFixture(detail: ProductDetailResponse): ProductEditorFixture {
  return {
    name: detail.name,
    status: titledStatus(detail.status),
    basePrice: minorToDecimal(detail.basePriceMinor, detail.currency),
    currency: detail.currency,
    publicDescription: detail.publicDescription,
    delivery: {
      accessTitle: detail.delivery.accessTitle,
      accessInstructions: detail.delivery.accessInstructions,
      file: fileFixture(detail.delivery.file),
    },
    groups: detail.optionGroups.map((group) => ({
      id: group.id,
      name: group.name,
      participating: group.participating,
      values: group.values.map((value) => value.label),
      valueIds: group.values.map((value) => value.id),
      valueRefs: group.values.map((value) => `group:${group.id}:value:${value.id}`),
    })),
    variants: detail.variants.map((variant) => ({
      id: variant.id,
      combination: variant.selectedOptions.map((option) => option.valueLabel).join(' / '),
      selectedValueRefs: variant.selectedOptions.map((option) => `group:${option.groupId}:value:${option.valueId}`),
      sku: variant.sku,
      priceOverride: variant.priceOverrideMinor === null ? '' : minorToDecimal(variant.priceOverrideMinor, detail.currency),
      effectivePrice: `${detail.currency} ${minorToDecimal(variant.effectivePriceMinor, detail.currency)}`,
      priceSource: variant.priceSource === 'base_price' ? 'Base price' : 'Override',
      deliverySource: variant.delivery.source === 'product_default' ? 'Product default' : 'Variant override',
      enabled: variant.status === 'enabled',
      ...(variant.delivery.source === 'variant_override' ? {
        deliveryOverride: {
          accessTitle: variant.delivery.accessTitle,
          accessInstructions: variant.delivery.accessInstructions,
          file: fileFixture(variant.delivery.file),
        },
      } : {}),
    })),
  };
}

function coreFields(product: ProductEditorFixture): ProductCoreFields {
  return {
    name: product.name,
    basePrice: product.basePrice,
    currency: product.currency,
    status: statusValue(product.status),
    publicDescription: product.publicDescription,
    delivery: {
      accessTitle: product.delivery.accessTitle,
      accessInstructions: product.delivery.accessInstructions,
    },
  };
}

export function buildSchema(product: ProductEditorFixture, existing: ProductDetailResponse | null): SchemaDraft {
  const groups = product.groups.map((group, groupIndex) => ({
    draftRef: `group:${group.id}`,
    id: existing?.optionGroups.some((candidate) => candidate.id === group.id) ? group.id : null,
    name: group.name,
    position: groupIndex,
    participating: group.participating,
    values: group.values.map((label, valueIndex) => ({
      draftRef: group.valueRefs?.[valueIndex] ?? `group:${group.id}:value:${valueIndex}`,
      id: group.valueIds?.[valueIndex] ?? null,
      label,
      position: valueIndex,
    })),
  }));
  const participatingCount = groups.filter((group) => group.participating).length;
  const currentVariantIds = new Set(existing?.variants.map((variant) => variant.id) ?? []);
  const rows = product.variants.filter((variant) => variant.outcome !== 'Will disable').map((variant) => {
    if (!variant.selectedValueRefs || variant.selectedValueRefs.length !== participatingCount) {
      throw new Error('A Variant row is missing stable option selections. Regenerate the matrix.');
    }
    return {
      id: currentVariantIds.has(variant.id) ? variant.id : null,
      selectedValueRefs: [...variant.selectedValueRefs],
      sku: variant.sku,
      status: variant.enabled ? 'enabled' as const : 'disabled' as const,
      priceOverride: variant.priceOverride.trim() === '' ? null : variant.priceOverride,
      delivery: variant.deliverySource === 'Product default'
        ? { source: 'product_default' as const }
        : {
          source: 'variant_override' as const,
          accessTitle: variant.deliveryOverride?.accessTitle ?? '',
          accessInstructions: variant.deliveryOverride?.accessInstructions ?? '',
        },
    };
  });
  return { groups, rows, confirmCombinations: rows.length >= 11 && rows.length <= 30 };
}

function isStructural(product: ProductEditorFixture, existing: ProductDetailResponse): boolean {
  if (product.groups.length !== existing.optionGroups.length || product.variants.length !== existing.variants.length) return true;
  for (let index = 0; index < product.groups.length; index += 1) {
    const group = product.groups[index];
    const saved = existing.optionGroups[index];
    if (!saved || group.id !== saved.id || group.participating !== saved.participating || group.values.length !== saved.values.length) return true;
  }
  const currentIds = new Set(existing.variants.map((variant) => variant.id));
  return product.variants.some((variant) => !currentIds.has(variant.id));
}

function listSummary(item: ProductListItem): ProductSummary {
  const minimum = minorToDecimal(item.minimumEffectivePriceMinor, item.currency);
  const maximum = minorToDecimal(item.maximumEffectivePriceMinor, item.currency);
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    status: titledStatus(item.status),
    type: item.type === 'simple' ? 'Simple' : 'Variant',
    effectivePrice: minimum === maximum ? `${item.currency} ${minimum}` : `${item.currency} ${minimum}–${maximum}`,
    enabledVariants: item.enabledVariantCount,
    updated: new Date(item.updatedAt).toLocaleString(),
  };
}

export function ProductionConsoleApp() {
  const [route, setRoute] = useState<ConsoleRoute>(() => parseRoute(window.location.pathname));
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const routeRef = useRef(route);
  const [listItems, setListItems] = useState<ProductListItem[]>([]);
  const [listState, setListState] = useState<ProductListState>('loading');
  const [criteria, setCriteria] = useState<{ query: string; status: 'all' | ProductStatus }>({ query: '', status: 'all' });
  const [detail, setDetail] = useState<ProductDetailResponse | null>(null);
  const [detailLifecycle, setDetailLifecycle] = useState<ProductEditorScenario['lifecycle']>('loading');
  const [revision, setRevision] = useState<number | null>(null);
  const previewHashRef = useRef<string | null>(null);
  const pendingProductFileRef = useRef<PendingFile>(null);
  const pendingVariantFilesRef = useRef(new Map<string, PendingFile>());

  const skipNextDetailLoadRef = useRef(false);
  const detailRequestRef = useRef(0);
  const createdDetailRef = useRef<ProductDetailResponse | null>(null);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  const confirmDiscard = useCallback(() => !dirtyRef.current || window.confirm('Discard unsaved Product changes?'), []);
  const navigate = useCallback((target: ConsoleRoute, replace = false) => {
    if (!confirmDiscard()) return false;
    setDirty(false);
    previewHashRef.current = null;
    pendingProductFileRef.current = null;
    pendingVariantFilesRef.current.clear();
    createdDetailRef.current = null;
    detailRequestRef.current += 1;
    const path = routePath(target);
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setRoute(target);
    return true;
  }, [confirmDiscard]);

  useEffect(() => {
    const onPopState = () => {
      const next = parseRoute(window.location.pathname);
      if (!confirmDiscard()) {
        window.history.pushState({}, '', routePath(routeRef.current));
        return;
      }
      setDirty(false);
      previewHashRef.current = null;
      pendingProductFileRef.current = null;
      pendingVariantFilesRef.current.clear();
      createdDetailRef.current = null;
      detailRequestRef.current += 1;
      setRoute(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [confirmDiscard]);

  useEffect(() => {
    if (route.kind !== 'list') return;
    let active = true;
    setListState(listItems.length > 0 ? 'filtered-loading' : 'loading');
    void fetchProducts(criteria.query, criteria.status).then((response) => {
      if (!active) return;
      setListItems(response.products);
      setListState(response.products.length === 0 && criteria.query === '' && criteria.status === 'all' ? 'empty' : 'populated');
    }).catch(() => {
      if (active) setListState('error');
    });
    return () => { active = false; };
  }, [criteria, route.kind]);

  const loadDetail = useCallback((slug: string) => {
    const requestSequence = detailRequestRef.current + 1;
    detailRequestRef.current = requestSequence;
    setDetailLifecycle('loading');
    void fetchProductBySlug(slug).then((result) => {
      if (detailRequestRef.current !== requestSequence) return;
      setDetail(result.product);
      setRevision(result.revision);
      setDetailLifecycle('ready');
    }).catch(() => {
      if (detailRequestRef.current !== requestSequence) return;
      setDetail(null);
      setDetailLifecycle('error');
    });
  }, []);

  useEffect(() => {
    if (route.kind === 'edit') {
      if (skipNextDetailLoadRef.current) skipNextDetailLoadRef.current = false;
      else loadDetail(route.slug);
    }
    if (route.kind === 'new') {
      detailRequestRef.current += 1;
      setDetail(null);
      setRevision(null);
      setDetailLifecycle('create');
    }
  }, [loadDetail, route]);

  const summaries = useMemo(() => listItems.map(listSummary), [listItems]);
  const editorScenario = useMemo<ProductEditorScenario>(() => ({
    id: route.kind === 'edit' ? route.slug : 'new',
    label: route.kind === 'edit' ? route.slug : 'New Product',
    lifecycle: detailLifecycle,
    product: detail ? detailFixture(detail) : EMPTY_PRODUCT,
  }), [detail, detailLifecycle, route]);

  const updateCriteria = useCallback((query: string, status: 'all' | 'draft' | 'active' | 'archived') => {
    setCriteria((current) => current.query === query && current.status === status ? current : { query, status });
  }, []);

  const previewSchema = useCallback(async (product: ProductEditorFixture, _groups: ProductEditorFixture['groups'], variants: VariantFixture[]) => {
    const schema = buildSchema(product, detail);
    const productSlug = detail?.slug ?? (product.name.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product');
    const preview = await previewProductSchema(revision, {
      productId: detail?.id ?? null,
      productSlug,
      product: coreFields(product),
      schema,
    });
    previewHashRef.current = preview.previewHash;
    const existingFixtures = detail ? detailFixture(detail).variants : [];
    return preview.rows.map((row, index) => {
      const source = index < variants.length
        ? variants[index]
        : existingFixtures.find((variant) => variant.id === row.variantId);
      if (!source) throw new Error('The schema preview returned an unknown historical Variant.');
      return {
        ...source,
        id: row.variantId ?? source.id,
        sku: row.sku,
        outcome: row.outcome === 'retained' ? 'Retained' as const : row.outcome === 'new' ? 'New' as const : 'Will disable' as const,
      };
    });
  }, [detail, revision]);

  function detailVariantSelectionKey(variant: ProductDetailResponse['variants'][number]): string {
    return variant.selectedOptions.map((option) => `group:${option.groupId}:value:${option.valueId}`).join('\u0000');
  }

  const saveProduct = useCallback(async (product: ProductEditorFixture) => {
    const currentDetail = detail ?? createdDetailRef.current;
    const core = coreFields(product);
    const schema = product.groups.length === 0 && currentDetail?.type !== 'variant' ? null : buildSchema(product, currentDetail);
    let saved: ProductDetailResponse;
    let nextRevision: number;
    const creating = currentDetail === null;

    if (creating) {
      const previewHash = schema === null
        ? null
        : (await previewProductSchema(null, {
          productId: null,
          productSlug: slugifyProductName(core.name),
          product: core,
          schema,
        })).previewHash;
      previewHashRef.current = previewHash;
      if (schema !== null && previewHash === null) throw new Error('Generate the Variant matrix preview before saving this Product.');
      const result = await createProduct({ product: core, schema, previewHash });
      saved = result.product;
      nextRevision = result.revision;
      createdDetailRef.current = saved;
      routeRef.current = { kind: 'edit', slug: saved.slug };
      window.history.replaceState({}, '', `/console/products/${encodeURIComponent(saved.slug)}`);
    } else {
      if (revision === null) throw new Error('The Product revision is unavailable. Reload the editor.');
      if (schema !== null && isStructural(product, currentDetail)) {
        const previewHash = (await previewProductSchema(revision, {
          productId: currentDetail.id,
          productSlug: currentDetail.slug,
          product: core,
          schema,
        })).previewHash;
        previewHashRef.current = previewHash;
        const result = await applyProductSchema(currentDetail.id, revision, { product: core, schema, previewHash });
        saved = result.product;
        nextRevision = result.revision;
      } else {
        const optionLabels = {
          groups: currentDetail.optionGroups.map((group, groupIndex) => ({
            id: group.id,
            name: product.groups[groupIndex]?.name ?? group.name,
            values: group.values.map((value, valueIndex) => ({
              id: value.id,
              label: product.groups[groupIndex]?.values[valueIndex] ?? value.label,
            })),
          })),
        };
        const variantsById = new Map(product.variants.map((variant) => [variant.id, variant]));
        const variantEdits = currentDetail.variants.map((variant) => {
          const edited = variantsById.get(variant.id);
          if (!edited) throw new Error('Variant rows changed structurally. Regenerate the matrix before saving.');
          return {
            id: variant.id,
            sku: edited.sku,
            status: edited.enabled ? 'enabled' as const : 'disabled' as const,
            priceOverride: edited.priceOverride.trim() === '' ? null : edited.priceOverride,
            delivery: edited.deliverySource === 'Product default'
              ? { source: 'product_default' as const }
              : {
                source: 'variant_override' as const,
                accessTitle: edited.deliveryOverride?.accessTitle ?? '',
                accessInstructions: edited.deliveryOverride?.accessInstructions ?? '',
              },
          };
        });
        const result = await updateProduct(currentDetail.id, revision, { product: core, optionLabels, variantEdits });
        saved = result.product;
        nextRevision = result.revision;
      }
    }

    setRevision(nextRevision);
    let fileMutated = false;
    const productFileChange = pendingProductFileRef.current;
    if (productFileChange instanceof File) {
      nextRevision = await replaceDeliveryFile({ productId: saved.id, variantId: null, revision: nextRevision, file: productFileChange });
      fileMutated = true;
      pendingProductFileRef.current = null;
      saved = { ...saved, revision: nextRevision };
      setRevision(nextRevision);
    } else if (productFileChange === 'remove') {
      nextRevision = await removeDeliveryFile({ productId: saved.id, variantId: null, revision: nextRevision });
      fileMutated = true;
      pendingProductFileRef.current = null;
      saved = { ...saved, revision: nextRevision };
      setRevision(nextRevision);
    }

    const savedRefByLocalRef = new Map<string, string>();
    product.groups.forEach((group, groupIndex) => {
      const savedGroup = saved.optionGroups[groupIndex];
      group.valueRefs?.forEach((ref, valueIndex) => {
        const savedValue = savedGroup?.values[valueIndex];
        if (savedGroup && savedValue) savedRefByLocalRef.set(ref, `group:${savedGroup.id}:value:${savedValue.id}`);
      });
    });
    for (const [localVariantId, change] of pendingVariantFilesRef.current) {
      if (change === null) continue;
      const localVariant = product.variants.find((variant) => variant.id === localVariantId);
      const localSelectionKey = localVariant?.selectedValueRefs
        ?.map((ref) => savedRefByLocalRef.get(ref) ?? ref).join('\u0000');
      const savedVariant = saved.variants.find((variant) => variant.id === localVariantId)
        ?? saved.variants.find((variant) => detailVariantSelectionKey(variant) === localSelectionKey);
      if (!savedVariant) throw new Error('The saved Variant file target could not be resolved.');
      nextRevision = change instanceof File
        ? await replaceDeliveryFile({ productId: saved.id, variantId: savedVariant.id, revision: nextRevision, file: change })
        : await removeDeliveryFile({ productId: saved.id, variantId: savedVariant.id, revision: nextRevision });
      fileMutated = true;
      pendingVariantFilesRef.current.delete(localVariantId);
      saved = { ...saved, revision: nextRevision };
      setRevision(nextRevision);
    }

    if (fileMutated) {
      const refreshed = await fetchProductBySlug(saved.slug);
      saved = refreshed.product;
      nextRevision = refreshed.revision;
    }
    pendingProductFileRef.current = null;
    pendingVariantFilesRef.current.clear();
    previewHashRef.current = null;
    createdDetailRef.current = null;
    setRevision(nextRevision);
    setDetail(saved);
    setDetailLifecycle('saved');
    if (creating) {
      skipNextDetailLoadRef.current = true;
      setRoute({ kind: 'edit', slug: saved.slug });
    }
  }, [detail, revision]);

  let content;
  if (route.kind === 'list') {
    content = <ProductListScreen
      state={listState}
      products={summaries}
      onAddProduct={() => { navigate({ kind: 'new' }); }}
      onEditProduct={(productId) => {
        const slug = listItems.find((item) => item.id === productId)?.slug;
        if (slug) navigate({ kind: 'edit', slug });
      }}
      onImportCsv={() => { navigate({ kind: 'import' }); }}
      onDownloadTemplate={downloadCsvTemplate}
      onRetry={() => setCriteria((current) => ({ ...current }))}
      onCriteriaChange={updateCriteria}
    />;
  } else if (route.kind === 'import') {
    content = <CsvImportScreen
      onBack={() => navigate({ kind: 'list' })}
    />;
  } else {
    content = <ProductEditorScreen
      scenario={editorScenario}
      onBack={(trigger) => { void trigger; navigate({ kind: 'list' }); }}
      onDiscardRequest={(trigger) => { void trigger; navigate(routeRef.current, true); }}
      onDirtyChange={setDirty}
      onRetry={() => { if (routeRef.current.kind === 'edit') loadDetail(routeRef.current.slug); }}
      onSave={saveProduct}
      onSchemaPreview={previewSchema}
      onPendingProductFileChange={(change) => { pendingProductFileRef.current = change; }}
      onPendingVariantFileChange={(variantId, change) => { pendingVariantFilesRef.current.set(variantId, change); }}
    />;
  }

  return <ConsoleShell
    railNote="Manage Product pricing, Variants, and private delivery files."
    onOpenProducts={() => navigate({ kind: 'list' })}
  >{content}</ConsoleShell>;
}
