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
  executeOrderAction,
  fetchOrderDetail,
  fetchOrders,
  fetchProductBySlug,
  fetchProducts,
  previewProductSchema,
  removeDeliveryFile,
  replaceDeliveryFile,
  updateProduct,
} from './api-client';
import { ConsoleShell } from './layout/console-shell';
import { OrderDetailScreen } from './orders/order-detail-screen';
import { OrdersScreen } from './orders/orders-screen';
import {
  EMPTY_ORDER_CRITERIA,
  orderCriteriaEqual,
  type ConsoleOrderDetailState,
  type ConsoleOrderDetailView,
  type ConsoleOrderListCriteria,
  type ConsoleOrderView,
  type ConsoleOrdersState,
} from './orders/order-ui-types';
import { ProductEditorScreen } from './products/product-editor-screen';
import { ProductListScreen } from './products/product-list-screen';
import type { ConsoleOrderAction } from '../orders/order-types';
import type {
  ProductEditorFixture,
  ProductEditorScenario,
  ProductListState,
  ProductSummary,
  VariantFixture,
} from './products/product-ui-types';

type ConsoleRoute =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; slug: string }
  | { kind: 'import' }
  | { kind: 'orders-list'; criteria: ConsoleOrderListCriteria }
  | { kind: 'order-detail'; reference: string };
type PendingFile = File | 'remove' | null;
type OrdersCursorStack = Array<string | null>;
interface OrdersListSnapshot {
  criteria: ConsoleOrderListCriteria;
  cursorStack: OrdersCursorStack;
}

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

function historyRecord(): Record<string, unknown> {
  const state = window.history.state;
  if (!state || typeof state !== 'object') return {};
  return { ...state };
}

function isStatusFilter(value: string | null): value is ConsoleOrderListCriteria['status'] {
  return value === 'all'
    || value === 'pending_payment'
    || value === 'paid'
    || value === 'fulfilled'
    || value === 'cancelled';
}

function parseOrdersCriteria(search: string): ConsoleOrderListCriteria {
  const params = new URLSearchParams(search);
  const statusParam = params.get('status');
  return {
    q: params.get('q') ?? '',
    status: isStatusFilter(statusParam) ? statusParam : 'all',
    refund: params.get('refund') === 'pending' ? 'pending' : 'all',
    cursor: params.get('cursor') || null,
  };
}

function serializeOrdersPath(criteria: ConsoleOrderListCriteria): string {
  const params = new URLSearchParams();
  if (criteria.q) params.set('q', criteria.q);
  if (criteria.status !== 'all') params.set('status', criteria.status);
  if (criteria.refund !== 'all') params.set('refund', criteria.refund);
  if (criteria.cursor) params.set('cursor', criteria.cursor);
  const suffix = params.size > 0 ? `?${params}` : '';
  return `/console/orders${suffix}`;
}

function isCursorStack(value: unknown): value is OrdersCursorStack {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => item === null || typeof item === 'string');
}

function readOrdersSnapshot(state: unknown): OrdersListSnapshot | null {
  if (!state || typeof state !== 'object' || !('ordersList' in state)) return null;
  const snapshot = state.ordersList;
  if (!snapshot || typeof snapshot !== 'object' || !('criteria' in snapshot) || !('cursorStack' in snapshot)) return null;
  const { criteria, cursorStack } = snapshot;
  if (!criteria || typeof criteria !== 'object' || !isCursorStack(cursorStack)) return null;
  if (!('q' in criteria) || !('status' in criteria) || !('refund' in criteria) || !('cursor' in criteria)) return null;
  if (typeof criteria.q !== 'string' || !isStatusFilter(typeof criteria.status === 'string' ? criteria.status : null)) return null;
  if (criteria.refund !== 'all' && criteria.refund !== 'pending') return null;
  if (criteria.cursor !== null && typeof criteria.cursor !== 'string') return null;
  return {
    criteria: {
      q: criteria.q,
      status: criteria.status,
      refund: criteria.refund,
      cursor: criteria.cursor,
    },
    cursorStack,
  };
}

function snapshotMatches(snapshot: OrdersListSnapshot | null, criteria: ConsoleOrderListCriteria): boolean {
  return snapshot !== null
    && orderCriteriaEqual(snapshot.criteria, criteria)
    && snapshot.cursorStack[snapshot.cursorStack.length - 1] === criteria.cursor;
}

function parseRoute(pathname: string, search = window.location.search): ConsoleRoute {
  const detail = /^\/console\/orders\/([^/]+)$/.exec(pathname);
  if (detail) {
    try {
      return { kind: 'order-detail', reference: decodeURIComponent(detail[1]) };
    } catch {
      return { kind: 'orders-list', criteria: { ...EMPTY_ORDER_CRITERIA } };
    }
  }
  if (pathname === '/console/orders') return { kind: 'orders-list', criteria: parseOrdersCriteria(search) };
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
  if (route.kind === 'orders-list') return serializeOrdersPath(route.criteria);
  if (route.kind === 'order-detail') return `/console/orders/${encodeURIComponent(route.reference)}`;
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
  const [route, setRoute] = useState<ConsoleRoute>(() => parseRoute(window.location.pathname, window.location.search));
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const routeRef = useRef(route);
  const [listItems, setListItems] = useState<ProductListItem[]>([]);
  const [listState, setListState] = useState<ProductListState>('loading');
  const [criteria, setCriteria] = useState<{ query: string; status: 'all' | ProductStatus }>({ query: '', status: 'all' });
  const [orders, setOrders] = useState<ConsoleOrderView[]>([]);
  const [ordersNextCursor, setOrdersNextCursor] = useState<string | null>(null);
  const [ordersHasAny, setOrdersHasAny] = useState(false);
  const [ordersState, setOrdersState] = useState<ConsoleOrdersState>('loading');
  const [ordersListEpoch, setOrdersListEpoch] = useState(0);
  const [orderCursorStack, setOrderCursorStack] = useState<OrdersCursorStack>(() => {
    const initial = parseRoute(window.location.pathname, window.location.search);
    const snapshot = readOrdersSnapshot(window.history.state);
    if (initial.kind === 'orders-list' && snapshotMatches(snapshot, initial.criteria)) return snapshot.cursorStack;
    if (initial.kind === 'orders-list') return [initial.criteria.cursor];
    return [null];
  });
  const [orderDetail, setOrderDetail] = useState<ConsoleOrderDetailView | null>(null);
  const [orderDetailState, setOrderDetailState] = useState<ConsoleOrderDetailState>('loading');
  const [orderDetailEpoch, setOrderDetailEpoch] = useState(0);
  const [orderPendingAction, setOrderPendingAction] = useState<ConsoleOrderAction | null>(null);
  const [orderAttempt, setOrderAttempt] = useState<{
    action: ConsoleOrderAction;
    acknowledgedRefundRequestId: string | null;
    idempotencyKey: string;
  } | null>(null);
  const [orderActionError, setOrderActionError] = useState<unknown>(null);
  const [detail, setDetail] = useState<ProductDetailResponse | null>(null);
  const [detailLifecycle, setDetailLifecycle] = useState<ProductEditorScenario['lifecycle']>('loading');
  const [revision, setRevision] = useState<number | null>(null);
  const previewHashRef = useRef<string | null>(null);
  const pendingProductFileRef = useRef<PendingFile>(null);
  const pendingVariantFilesRef = useRef(new Map<string, PendingFile>());
  const skipNextDetailLoadRef = useRef(false);
  const detailRequestRef = useRef(0);
  const createdDetailRef = useRef<ProductDetailResponse | null>(null);
  const listGenerationRef = useRef(0);
  const orderDetailGenerationRef = useRef(0);
  const orderCursorStackRef = useRef(orderCursorStack);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);
  useEffect(() => {
    orderCursorStackRef.current = orderCursorStack;
  }, [orderCursorStack]);

  const confirmDiscard = useCallback(() => !dirtyRef.current || window.confirm('Discard unsaved Product changes?'), []);

  const writeLocation = useCallback((url: string, replace: boolean, patch?: Record<string, unknown>) => {
    const next = patch ? { ...historyRecord(), ...patch } : historyRecord();
    window.history[replace ? 'replaceState' : 'pushState'](next, '', url);
  }, []);

  const navigate = useCallback((target: ConsoleRoute, replace = false) => {
    if (!confirmDiscard()) return false;
    setDirty(false);
    previewHashRef.current = null;
    pendingProductFileRef.current = null;
    pendingVariantFilesRef.current.clear();
    createdDetailRef.current = null;
    detailRequestRef.current += 1;
    writeLocation(routePath(target), replace);
    setRoute(target);
    return true;
  }, [confirmDiscard, writeLocation]);

  const commitOrdersList = useCallback((nextCriteria: ConsoleOrderListCriteria, stack: OrdersCursorStack, historyMode: 'push' | 'replace') => {
    const snapshot = { ordersList: { criteria: nextCriteria, cursorStack: stack } };
    writeLocation(serializeOrdersPath(nextCriteria), historyMode === 'replace', snapshot);
    setOrderCursorStack(stack);
    setRoute({ kind: 'orders-list', criteria: nextCriteria });
  }, [writeLocation]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const next = parseRoute(window.location.pathname, window.location.search);
      if (!confirmDiscard()) {
        writeLocation(routePath(routeRef.current), false);
        return;
      }
      setDirty(false);
      previewHashRef.current = null;
      pendingProductFileRef.current = null;
      pendingVariantFilesRef.current.clear();
      createdDetailRef.current = null;
      detailRequestRef.current += 1;
      if (next.kind === 'orders-list') {
        const snapshot = readOrdersSnapshot(event.state);
        if (snapshotMatches(snapshot, next.criteria)) setOrderCursorStack(snapshot.cursorStack);
        else setOrderCursorStack([next.criteria.cursor]);
      }
      if (next.kind === 'order-detail') setOrderDetailEpoch((current) => current + 1);
      setRoute(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [confirmDiscard, writeLocation]);

  useEffect(() => {
    if (route.kind !== 'orders-list') return;
    const snapshot = readOrdersSnapshot(window.history.state);
    if (snapshotMatches(snapshot, route.criteria)) {
      if (snapshot.cursorStack !== orderCursorStackRef.current) setOrderCursorStack(snapshot.cursorStack);
      return;
    }
    const stack: OrdersCursorStack = [route.criteria.cursor];
    setOrderCursorStack(stack);
    writeLocation(serializeOrdersPath(route.criteria), true, { ordersList: { criteria: route.criteria, cursorStack: stack } });
  }, [route, writeLocation]);

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

  useEffect(() => {
    if (route.kind !== 'orders-list') return;
    const generation = listGenerationRef.current + 1;
    listGenerationRef.current = generation;
    const controller = new AbortController();
    setOrdersState('loading');
    void fetchOrders(route.criteria, controller.signal).then((response) => {
      if (listGenerationRef.current !== generation) return;
      setOrders(response.orders);
      setOrdersNextCursor(response.nextCursor);
      setOrdersHasAny(response.hasAnyOrders);
      if (response.orders.length > 0) setOrdersState('ready');
      else setOrdersState(response.hasAnyOrders ? 'no-match' : 'empty');
    }).catch((error) => {
      if (listGenerationRef.current !== generation) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setOrdersState('error');
    });
    return () => controller.abort();
  }, [ordersListEpoch, route]);

  const orderReference = route.kind === 'order-detail' ? route.reference : null;
  useEffect(() => {
    setOrderDetail(null);
    setOrderPendingAction(null);
    setOrderAttempt(null);
    setOrderActionError(null);
    setOrderDetailState('loading');
  }, [orderReference]);

  useEffect(() => {
    if (route.kind !== 'order-detail') return;
    const generation = orderDetailGenerationRef.current + 1;
    orderDetailGenerationRef.current = generation;
    const controller = new AbortController();
    setOrderDetailState((current) => current === 'ready' ? 'ready' : 'loading');
    void fetchOrderDetail(route.reference, controller.signal).then((response) => {
      if (orderDetailGenerationRef.current !== generation || routeRef.current.kind !== 'order-detail' || routeRef.current.reference !== route.reference) return;
      setOrderDetail(response);
      setOrderDetailState('ready');
      setOrderActionError(null);
    }).catch((error) => {
      if (orderDetailGenerationRef.current !== generation || routeRef.current.kind !== 'order-detail' || routeRef.current.reference !== route.reference) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setOrderDetailState((current) => current === 'ready' ? 'ready' : 'error');
    });
    return () => controller.abort();
  }, [orderDetailEpoch, route]);

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

  const runOrderAction = useCallback(async (attempt: {
    action: ConsoleOrderAction;
    acknowledgedRefundRequestId: string | null;
    idempotencyKey: string;
  }) => {
    if (routeRef.current.kind !== 'order-detail') return;
    const reference = routeRef.current.reference;
    const stillOn = (generation: number) => (
      orderDetailGenerationRef.current === generation
      && routeRef.current.kind === 'order-detail'
      && routeRef.current.reference === reference
    );
    const generation = orderDetailGenerationRef.current + 1;
    orderDetailGenerationRef.current = generation;
    setOrderPendingAction(attempt.action);
    setOrderActionError(null);
    try {
      const result = await executeOrderAction(
        reference,
        attempt.action,
        attempt.acknowledgedRefundRequestId,
        attempt.idempotencyKey,
      );
      if (!stillOn(generation)) return;
      setOrderDetail(result.order);
      setOrderDetailState('ready');
      setOrderPendingAction(null);
      setOrderAttempt(null);
      setOrderActionError(null);
      const refetchGeneration = orderDetailGenerationRef.current + 1;
      orderDetailGenerationRef.current = refetchGeneration;
      try {
        const fresh = await fetchOrderDetail(reference);
        if (!stillOn(refetchGeneration)) return;
        setOrderDetail(fresh);
      } catch (error) {
        if (!stillOn(refetchGeneration)) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    } catch (error) {
      if (!stillOn(generation)) return;
      setOrderPendingAction(null);
      const conflict = error && typeof error === 'object' && 'status' in error && error.status === 409;
      if (conflict) {
        setOrderAttempt(null);
        setOrderActionError(error);
        setOrderDetail((current) => current ? { ...current, allowedActions: [] } : current);
        const refetchGeneration = orderDetailGenerationRef.current + 1;
        orderDetailGenerationRef.current = refetchGeneration;
        try {
          const fresh = await fetchOrderDetail(reference);
          if (!stillOn(refetchGeneration)) return;
          setOrderDetail(fresh);
          setOrderDetailState('ready');
        } catch (refetchError) {
          if (!stillOn(refetchGeneration)) return;
          if (refetchError instanceof DOMException && refetchError.name === 'AbortError') return;
        }
        return;
      }
      setOrderActionError(error);
    }
  }, []);

  const changeOrderCriteria = (next: ConsoleOrderListCriteria) => {
    if (route.kind !== 'orders-list') return;
    const reset = { ...next, cursor: null };
    const stack: OrdersCursorStack = [null];
    const filterChanged = route.criteria.status !== reset.status || route.criteria.refund !== reset.refund;
    commitOrdersList(reset, stack, filterChanged ? 'push' : 'replace');
  };

  let content;
  if (route.kind === 'orders-list') {
    content = <OrdersScreen
      state={ordersState}
      orders={orders}
      criteria={route.criteria}
      nextCursor={ordersNextCursor}
      canGoPrevious={orderCursorStack.length > 1}
      showFirstPage={route.criteria.cursor !== null && orderCursorStack.length <= 1}
      onRetry={() => setOrdersListEpoch((current) => current + 1)}
      onCriteriaChange={changeOrderCriteria}
      onClearFilters={() => commitOrdersList({ ...EMPTY_ORDER_CRITERIA }, [null], 'push')}
      onNext={() => {
        if (!ordersNextCursor) return;
        commitOrdersList({ ...route.criteria, cursor: ordersNextCursor }, [...orderCursorStack, ordersNextCursor], 'push');
      }}
      onPrevious={() => {
        if (orderCursorStack.length < 2) return;
        const stack = orderCursorStack.slice(0, -1);
        commitOrdersList({ ...route.criteria, cursor: stack[stack.length - 1] ?? null }, stack, 'push');
      }}
      onFirstPage={() => commitOrdersList({ ...route.criteria, cursor: null }, [null], 'push')}
      onOpenOrder={(reference) => {
        writeLocation(serializeOrdersPath(route.criteria), true, {
          ordersList: { criteria: route.criteria, cursorStack: orderCursorStack },
        });
        writeLocation(`/console/orders/${encodeURIComponent(reference)}`, false);
        setRoute({ kind: 'order-detail', reference });
      }}
    />;
  } else if (route.kind === 'order-detail') {
    content = <OrderDetailScreen
      state={orderDetailState}
      order={orderDetail}
      pendingAction={orderPendingAction}
      retryAction={orderAttempt?.action ?? null}
      actionError={orderActionError}
      onBack={() => {
        const snapshot = readOrdersSnapshot(window.history.state);
        if (snapshot) commitOrdersList(snapshot.criteria, snapshot.cursorStack, 'push');
        else commitOrdersList({ ...EMPTY_ORDER_CRITERIA }, [null], 'push');
      }}
      onRetry={() => setOrderDetailEpoch((current) => current + 1)}
      onRetryAction={() => { if (orderAttempt) void runOrderAction(orderAttempt); }}
      onAction={(action, acknowledgedRefundRequestId) => {
        const attempt = { action, acknowledgedRefundRequestId, idempotencyKey: crypto.randomUUID() };
        setOrderAttempt(attempt);
        void runOrderAction(attempt);
      }}
    />;
  } else if (route.kind === 'list') {
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
    activeDestination={route.kind === 'orders-list' || route.kind === 'order-detail' ? 'Orders' : 'Products'}
    railNote={route.kind === 'orders-list' || route.kind === 'order-detail' ? 'Review safe Customer Order projections.' : 'Manage Product pricing, Variants, and private delivery files.'}
    onOpenProducts={() => navigate({ kind: 'list' })}
    onOpenOrders={() => navigate({ kind: 'orders-list', criteria: { ...EMPTY_ORDER_CRITERIA } })}
  >{content}</ConsoleShell>;
}
