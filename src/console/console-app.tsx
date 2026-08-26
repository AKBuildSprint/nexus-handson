import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CSV_TEMPLATE,
  csvScenarios,
  productEditorFixturesById,
  productEditorScenarios,
  productListScenarios,
} from '../../design/prototype-scenarios';
import { CsvImportScreen } from './imports/csv-import-screen';
import { ConsoleShell } from './layout/console-shell';
import { ProductEditorScreen } from './products/product-editor-screen';
import { ProductListScreen } from './products/product-list-screen';

type Journey = 'products' | 'new' | 'edit' | 'import';

interface NavigationTarget {
  journey: Journey;
  productId?: string;
}

interface FocusTrigger {
  readonly isConnected: boolean;
  focus(): void;
}

type PendingNavigation =
  | { kind: 'push'; target: NavigationTarget; trigger: FocusTrigger | null }
  | { kind: 'pop'; target: NavigationTarget; delta: number; trigger: null }
  | { kind: 'editor-scenario'; scenarioId: string; trigger: FocusTrigger | null }
  | { kind: 'discard-only'; trigger: FocusTrigger | null };

interface NexusHistoryState {
  nexusIndex?: number;
  target?: NavigationTarget;
}

function parseConsolePath(pathname: string): NavigationTarget {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/console/products/new') return { journey: 'new' };
  if (normalized === '/console/products/import') return { journey: 'import' };
  if (normalized === '/console/products') return { journey: 'products' };
  const match = normalized.match(/^\/console\/products\/([^/]+)$/);
  if (match) {
    try {
      return { journey: 'edit', productId: decodeURIComponent(match[1]) };
    } catch {
      return { journey: 'products' };
    }
  }
  return { journey: 'products' };
}

function pathForTarget(target: NavigationTarget) {
  if (target.journey === 'new') return '/console/products/new';
  if (target.journey === 'import') return '/console/products/import';
  if (target.journey === 'edit') return `/console/products/${encodeURIComponent(target.productId ?? 'focus-pack')}`;
  return '/console/products';
}

function isEditorJourney(journey: Journey) {
  return journey === 'new' || journey === 'edit';
}

function downloadCsvTemplate() {
  const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'nexus-product-import-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ConsoleApp() {
  const initialTargetRef = useRef<NavigationTarget>(parseConsolePath(window.location.pathname));
  const [journey, setJourney] = useState<Journey>(initialTargetRef.current.journey);
  const [listScenarioId, setListScenarioId] = useState('populated');
  const [editorScenarioId, setEditorScenarioId] = useState(initialTargetRef.current.journey === 'new' ? 'new' : 'edit-ready');
  const [csvScenarioId, setCsvScenarioId] = useState('default');
  const [selectedProductId, setSelectedProductId] = useState(initialTargetRef.current.productId ?? 'focus-pack');
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorInstance, setEditorInstance] = useState(0);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [popRestoring, setPopRestoring] = useState(false);
  const dirtyRef = useRef(false);
  const currentTargetRef = useRef<NavigationTarget>(initialTargetRef.current);
  const currentIndexRef = useRef(0);
  const restoringPopRef = useRef(false);
  const allowNextPopRef = useRef(false);
  const guardDialogRef = useRef<HTMLDialogElement>(null);

  const listScenario = useMemo(
    () => productListScenarios.find((scenario) => scenario.id === listScenarioId)
      ?? productListScenarios.find((scenario) => scenario.id === 'populated')
      ?? productListScenarios[0],
    [listScenarioId],
  );
  const baseEditorScenario = useMemo(
    () => productEditorScenarios.find((scenario) => scenario.id === editorScenarioId) ?? productEditorScenarios[1],
    [editorScenarioId],
  );
  const editorScenario = useMemo(() => {
    if (journey !== 'edit' || baseEditorScenario.lifecycle === 'loading' || baseEditorScenario.lifecycle === 'error') {
      return baseEditorScenario;
    }
    const selectedProduct = productEditorFixturesById[selectedProductId];
    if (!selectedProduct) {
      return productEditorScenarios.find((scenario) => scenario.id === 'edit-error') ?? baseEditorScenario;
    }
    return { ...baseEditorScenario, product: selectedProduct };
  }, [baseEditorScenario, journey, selectedProductId]);
  const csvScenario = useMemo(
    () => csvScenarios.find((scenario) => scenario.id === csvScenarioId)
      ?? csvScenarios.find((scenario) => scenario.id === 'default')
      ?? csvScenarios[0],
    [csvScenarioId],
  );

  const updateDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    setEditorDirty(dirty);
  }, []);

  const applyTarget = useCallback((target: NavigationTarget) => {
    currentTargetRef.current = target;
    dirtyRef.current = false;
    setEditorDirty(false);
    setJourney(target.journey);
    if (target.journey === 'new') setEditorScenarioId('new');
    if (target.journey === 'edit') {
      setSelectedProductId(target.productId ?? 'focus-pack');
      setEditorScenarioId('edit-ready');
    }
    if (target.journey === 'import') setCsvScenarioId('default');
    setEditorInstance((current) => current + 1);
  }, []);

  const commitPush = useCallback((target: NavigationTarget) => {
    const nextIndex = currentIndexRef.current + 1;
    window.history.pushState({ nexusIndex: nextIndex, target } satisfies NexusHistoryState, '', pathForTarget(target));
    currentIndexRef.current = nextIndex;
    applyTarget(target);
  }, [applyTarget]);

  const requestPush = useCallback((target: NavigationTarget, trigger: FocusTrigger | null) => {
    const currentPath = pathForTarget(currentTargetRef.current);
    const nextPath = pathForTarget(target);
    if (dirtyRef.current && isEditorJourney(currentTargetRef.current.journey) && nextPath !== currentPath) {
      setPendingNavigation({ kind: 'push', target, trigger });
      return false;
    }
    commitPush(target);
    return true;
  }, [commitPush]);

  useEffect(() => {
    const initialState = window.history.state as NexusHistoryState | null;
    const initialIndex = initialState?.nexusIndex ?? 0;
    currentIndexRef.current = initialIndex;
    window.history.replaceState(
      { ...(initialState ?? {}), nexusIndex: initialIndex, target: initialTargetRef.current } satisfies NexusHistoryState,
      '',
      pathForTarget(initialTargetRef.current),
    );

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as NexusHistoryState | null;
      const target = parseConsolePath(window.location.pathname);
      const destinationIndex = state?.nexusIndex ?? currentIndexRef.current - 1;

      if (restoringPopRef.current) {
        restoringPopRef.current = false;
        setPopRestoring(false);
        return;
      }
      if (allowNextPopRef.current) {
        allowNextPopRef.current = false;
        currentIndexRef.current = destinationIndex;
        applyTarget(target);
        return;
      }

      const delta = destinationIndex - currentIndexRef.current;
      if (dirtyRef.current && isEditorJourney(currentTargetRef.current.journey) && pathForTarget(target) !== pathForTarget(currentTargetRef.current)) {
        setPendingNavigation({ kind: 'pop', target, delta, trigger: null });
        if (delta !== 0) {
          restoringPopRef.current = true;
          setPopRestoring(true);
          window.history.go(-delta);
        }
        return;
      }

      currentIndexRef.current = destinationIndex;
      applyTarget(target);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [applyTarget]);

  useEffect(() => {
    const dialog = guardDialogRef.current;
    if (!dialog) return;
    if (pendingNavigation && !dialog.open) dialog.showModal();
    if (!pendingNavigation && dialog.open) dialog.close();
  }, [pendingNavigation]);

  const restoreGuardFocus = (trigger: FocusTrigger | null) => {
    window.setTimeout(() => {
      if (trigger?.isConnected) trigger.focus();
      else document.getElementById('console-content')?.focus();
    }, 0);
  };

  const stayInEditor = () => {
    const trigger = pendingNavigation?.trigger ?? null;
    setPendingNavigation(null);
    restoreGuardFocus(trigger);
  };

  const discardAndContinue = () => {
    if (!pendingNavigation || popRestoring) return;
    const request = pendingNavigation;
    setPendingNavigation(null);
    dirtyRef.current = false;
    setEditorDirty(false);
    setEditorInstance((current) => current + 1);

    if (request.kind === 'push') {
      commitPush(request.target);
      return;
    }
    if (request.kind === 'pop') {
      allowNextPopRef.current = true;
      window.history.go(request.delta);
      return;
    }
    if (request.kind === 'editor-scenario') {
      setEditorScenarioId(request.scenarioId);
      return;
    }
    if (currentTargetRef.current.journey === 'edit') setEditorScenarioId('edit-ready');
    if (currentTargetRef.current.journey === 'new') setEditorScenarioId('new');
    restoreGuardFocus(request.trigger);
  };

  const requestEditorScenario = (scenarioId: string, trigger: FocusTrigger) => {
    if (dirtyRef.current) {
      setPendingNavigation({ kind: 'editor-scenario', scenarioId, trigger });
      return;
    }
    setEditorScenarioId(scenarioId);
    setEditorInstance((current) => current + 1);
  };

  const requestDiscardOnly = (trigger: FocusTrigger) => {
    if (!dirtyRef.current) return;
    setPendingNavigation({ kind: 'discard-only', trigger });
  };

  const scenarioOptions = journey === 'products'
    ? productListScenarios.map((scenario) => ({ id: scenario.id, label: scenario.label }))
    : journey === 'import'
      ? csvScenarios.map((scenario) => ({ id: scenario.id, label: scenario.label }))
      : productEditorScenarios
          .filter((scenario) => journey === 'new' ? scenario.id === 'new' : scenario.id !== 'new')
          .map((scenario) => ({ id: scenario.id, label: scenario.label }));
  const currentScenarioId = journey === 'products' ? listScenarioId : journey === 'import' ? csvScenarioId : editorScenarioId;

  const scenarioControls = (
    <section className="scenario-harness" aria-labelledby="scenario-harness-title">
      <div>
        <strong id="scenario-harness-title">Design scenario harness</strong>
        <p>Every fixture is imported from design/prototype-scenarios.ts. This prototype does not provide production fallback data.</p>
      </div>
      <div className="scenario-controls">
        <div className="field">
          <label htmlFor="journey-select">Journey</label>
          <select
            id="journey-select"
            value={journey}
            onChange={(event) => {
              const nextJourney = event.target.value as Journey;
              requestPush(
                nextJourney === 'edit' ? { journey: 'edit', productId: selectedProductId } : { journey: nextJourney },
                event.currentTarget,
              );
            }}
          >
            <option value="products">Product list</option>
            <option value="new">Create Product</option>
            <option value="edit">Edit Product</option>
            <option value="import">Unified CSV import</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="scenario-select">Visible state</label>
          <select
            id="scenario-select"
            value={currentScenarioId}
            onChange={(event) => {
              const scenarioId = event.target.value;
              if (isEditorJourney(journey)) requestEditorScenario(scenarioId, event.currentTarget);
              else if (journey === 'products') setListScenarioId(scenarioId);
              else setCsvScenarioId(scenarioId);
            }}
          >
            {scenarioOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
          </select>
        </div>
      </div>
    </section>
  );

  return (
    <ConsoleShell
      scenarioControls={scenarioControls}
      onOpenProducts={(trigger) => requestPush({ journey: 'products' }, trigger)}
    >
      {journey === 'products' ? (
        <ProductListScreen
          state={listScenario.id}
          products={listScenario.products}
          onAddProduct={() => requestPush({ journey: 'new' }, null)}
          onEditProduct={(productId) => requestPush({ journey: 'edit', productId }, null)}
          onImportCsv={() => requestPush({ journey: 'import' }, null)}
          onDownloadTemplate={downloadCsvTemplate}
          onRetry={() => setListScenarioId('populated')}
        />
      ) : null}

      {isEditorJourney(journey) ? (
        <ProductEditorScreen
          key={`${journey}-${selectedProductId}-${editorScenario.id}-${editorInstance}`}
          scenario={editorScenario}
          onBack={(trigger) => requestPush({ journey: 'products' }, trigger)}
          onDiscardRequest={requestDiscardOnly}
          onDirtyChange={updateDirty}
          onRetry={() => setEditorScenarioId('edit-ready')}
        />
      ) : null}

      {journey === 'import' ? (
        <CsvImportScreen
          scenario={csvScenario}
          onBack={() => requestPush({ journey: 'products' }, null)}
          onShowResult={() => setCsvScenarioId('result')}
          onReset={() => setCsvScenarioId('default')}
        />
      ) : null}

      <dialog
        ref={guardDialogRef}
        className="guard-dialog"
        aria-labelledby="central-discard-title"
        onCancel={(event) => {
          event.preventDefault();
          stayInEditor();
        }}
      >
        <div className="guard-content">
          <h2 id="central-discard-title">Discard changes to {editorScenario.product.name || 'New Product'}?</h2>
          <p>Unsaved field, delivery, option, Variant, and file changes will be removed before leaving this editor.</p>
          {popRestoring ? <p className="field-help" role="status">Returning to the current editor before the navigation decision is applied.</p> : null}
          <div className="inline-actions">
            <button className="button" type="button" onClick={stayInEditor}>Stay and continue editing</button>
            <button className="button button-danger" type="button" disabled={popRestoring} onClick={discardAndContinue}>Discard changes</button>
          </div>
        </div>
      </dialog>

      <span className="sr-only" aria-live="polite">{editorDirty ? 'Unsaved Product changes' : ''}</span>
    </ConsoleShell>
  );
}
