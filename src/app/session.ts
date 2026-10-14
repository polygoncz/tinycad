// createAppSession (spec 11, "Kompoziční kořen (app)"): wires finished implementations together.
// It knows no worker and no IndexedDB – the kernel factory, the store, the viewport and the timer
// scheduler come in as deps – so it runs in Node with FakeKernel, MemoryDocumentStore and a fake
// viewport. openAppSession (browser) builds the real ones and calls this.

import { DisposableStore, ObservableValue, RpcError } from '@/core';
import type { Disposable, IdGenerator, Observable } from '@/core';
import { createDocument, createFeatureSchemaRegistry, ORIGIN_PLANES } from '@/document';
import type {
  BodyId,
  DocumentId,
  DocumentMeta,
  DocumentReader,
  DocumentWriter,
  FeatureId,
  FeatureSchemaRegistry,
  PlaneId,
} from '@/document';
import {
  ACTION_IDS,
  artifactDrawing,
  bindSelectionHighlight,
  createActionRegistry,
  createBrowserModel,
  createBuiltInActions,
  createEditLock,
  createFeatureEditor,
  toolActionId,
  createFeatureTreeModel,
  createSelectionModel,
  createSketchActions,
  createSketchEditor,
  createSketchTools,
  createToolManager,
  createToolRegistry,
  planeDrawing,
  SELECT_TOOL,
  SKETCH_ACTION_IDS,
  sketchConstraintActionId,
} from '@/interaction';
import type {
  ActionRegistry,
  BrowserModel,
  ConfirmRequest,
  FeatureEditor,
  FeatureTreeModel,
  Mode,
  SelectionModel,
  SketchEditor,
  ToolDescriptor,
  ToolManager,
  ViewportPort,
} from '@/interaction';
import type { GeometryKernel } from '@/kernel';
import {
  createOperationDispatcher,
  createOperationLog,
  createOpHandlerRegistry,
  createUndoManager,
} from '@/ops';
import type { OperationDispatcher, OperationLog, OpHandlerRegistry } from '@/ops';
import { createPersistenceService, createSnapshot, loadDocument } from '@/persistence';
import type {
  DocumentStore,
  LoadDocumentError,
  PersistenceService,
  PersistenceStatus,
  Scheduler,
} from '@/persistence';
import { registerPlugin } from '@/plugin-api';
import type { FeaturePlugin, PluginMessages } from '@/plugin-api';
import { bodiesOf, createBuilderRegistry, createRegenerator, sketchesOf } from '@/regen';
import type { BuilderRegistry, RegenResult, SketchArtifact } from '@/regen';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render';
import type { BodyLayer, CameraController, ScenePalette } from '@/render';
import type { ConstraintSolver, GeometricConstraintKind } from '@/sketch';
import { createKernelSupervisor } from './kernel-supervisor';
import type { KernelUiState } from './kernel-supervisor';
import { createRegenScheduler } from './regen-scheduler';
import { createRegenStatusAdapter } from './regen-status-adapter';

export type RegenUiState = {
  /** A regeneration is running or due. */
  readonly busy: boolean;
  /** Bodies of the last finished regeneration. */
  readonly bodyCount: number;
  /** Features with an error in the last finished regeneration. */
  readonly errorCount: number;
  /** Duration of the last finished regeneration; null before the first. */
  readonly lastMs: number | null;
};

/**
 * What app needs from the 3D view: the port of interaction plus mounting, the body layer, the
 * camera, the palette and body visibility. render's Viewport is one; tests use a fake.
 * app hands the kernel to the view through `bodies.reset` whenever a kernel becomes ready
 * (spec 09, "Výměna instance jádra"), so the meshes the view was created with are replaced
 * before the first sync.
 */
export interface AppViewport extends ViewportPort {
  mount(el: HTMLElement): void;
  readonly bodies: BodyLayer;
  readonly camera: CameraController;
  setPalette(palette: ScenePalette): void;
  setBodyVisible(body: BodyId, visible: boolean): void;
}

export interface AppSessionDeps {
  readonly plugins: readonly FeaturePlugin[];
  readonly store: DocumentStore;
  readonly docId: DocumentId;
  /** A new kernel for the start and for every restart after a crash (Q055). */
  readonly createKernel: () => Promise<GeometryKernel & Disposable>;
  readonly viewport: AppViewport;
  /** Timers of the persistence service (ring 1 knows no setTimeout, ADR 0009). */
  readonly scheduler: Scheduler;
  /** Clock in ms: log entry times, regeneration durations, the restart window. */
  readonly now: () => number;
  /** Ids of new features. */
  readonly ids: IdGenerator;
  /** Translation of keys: the name of a new feature and of a new document (ADR 0014). */
  readonly translate: (key: string) => string;
  /** Asks the user a yes/no question (feature.delete with dependents); ui shows the dialog. */
  readonly confirm: (request: ConfirmRequest) => boolean;
  /** Without the document lock (Q038): nothing is written, changes of the document throw. */
  readonly readOnly: boolean;
  /** Handed to loadDocument: replay the whole log from the base and compare (spec 05). */
  readonly verify?: boolean;
  /** M12: the solver of the sketcher; tests FakeSolver, the browser createPlanegcsSolver(). */
  readonly solver: ConstraintSolver;
}

export interface AppSession extends Disposable {
  readonly doc: DocumentReader;
  /** Q038: the document is open in another tab. */
  readonly readOnly: boolean;
  /** Read-only or an open feature dialog: the one rule, from interaction (createEditLock). */
  readonly locked: Observable<boolean>;
  /** The ids of the built-in actions; ui may not import values of interaction. */
  readonly actionIds: typeof ACTION_IDS;
  /** Id of the action that activates a tool (ui must not build it itself, spec 10). */
  toolActionId(toolId: string): string;
  readonly regen: Observable<RegenUiState>;
  /** Q055: restart after a kernel crash. */
  readonly kernel: Observable<KernelUiState>;
  /** Why the kernel did not start ('unavailable'), for the tooltip; null otherwise. */
  readonly kernelError: Observable<string | null>;
  /** Always 'saved' when read-only. */
  readonly persistence: Observable<PersistenceStatus>;
  readonly selection: SelectionModel;
  /** Timeline. */
  readonly featureTree: FeatureTreeModel;
  /** Browser, visibility of bodies (Q071). */
  readonly browser: BrowserModel;
  readonly tools: ToolManager;
  /** Every registered tool, the select tool first. */
  readonly toolList: readonly ToolDescriptor[];
  readonly features: FeatureEditor;
  readonly actions: ActionRegistry;
  /** Dictionaries of the plugins for vue-i18n (ADR 0014). */
  readonly messages: PluginMessages;
  /** M12: the sketcher (sketch panel, mode). */
  readonly sketches: SketchEditor;
  /** M12: = sketches.mode; the Toolbar and the dialog vs. the sketch panel follow it. */
  readonly mode: Observable<Mode>;
  /** M12: the ids of the sketcher actions; ui may not import values of interaction. */
  readonly sketchActionIds: typeof SKETCH_ACTION_IDS;
  /** M12: id of the action adding a geometric constraint of the kind. */
  sketchConstraintActionId(kind: GeometricConstraintKind): string;

  mountViewport(el: HTMLElement): void;
  /** Q072: app picks the ScenePalette, ui does not know render. */
  setTheme(theme: 'light' | 'dark'): void;
  /**
   * Writes the pending queue of the persistence now, without the delay; read-only: nothing.
   * openAppSession calls it on pagehide and visibilitychange to hidden (Q034).
   */
  flush(): Promise<void>;
  /**
   * Writes the pending queue of the persistence (flush), then releases like dispose. Rejects
   * with the error of the flush, after releasing anyway. A second call returns the same promise.
   */
  close(): Promise<void>;
  /** Synchronous safety net: releases at once, the final save runs without being awaited. */
  dispose(): void;
}

const NAME_OF_NEW_DOCUMENT = 'document.untitled';
/** The default tool of the sketch mode (spec 10, "Nástroje a akce skicáře"). */
const SKETCH_SELECT_TOOL_ID = 'sketch.select';

/**
 * Opens the document `docId` and wires a session over it. Rejects when a plugin is broken, the
 * stored data cannot be loaded, or a read-only document is missing. The kernel starts in the
 * background: the session comes back with `kernel` 'starting' and regenerates once it is ready.
 */
export async function createAppSession(deps: AppSessionDeps): Promise<AppSession> {
  const { viewport, readOnly } = deps;

  // 1. Registries and plugins, before anything is opened or started.
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const toolRegistry = createToolRegistry();
  toolRegistry.register(SELECT_TOOL);
  for (const plugin of deps.plugins) {
    registerPlugin(plugin, { schemas, builders, tools: toolRegistry });
  }
  checkComplete(schemas, builders);
  const messages = mergeMessages(deps.plugins);
  const handlers = createOpHandlerRegistry({ schemas });

  // 2. The document.
  const { doc, log } = await openDocument(deps, schemas, handlers);

  // 3. Services and models.
  const lifetime = new DisposableStore();
  let disposed = false;
  const dispatcher = createOperationDispatcher({ doc, handlers, log, now: deps.now });
  // Q038: everything that changes the document goes through `ops`, so this one guard covers
  // the feature dialog, the tree, the tools and the actions.
  const ops = readOnly ? refuseChanges(dispatcher) : dispatcher;
  // Not on AppSession: the built-in actions undo and redo are its UI.
  const undo = lifetime.add(createUndoManager({ dispatcher: ops, log }));

  const persistenceStatus = new ObservableValue<PersistenceStatus>('saved');
  const persistence: PersistenceService | null = readOnly
    ? null
    : createPersistenceService({ store: deps.store, log, doc, scheduler: deps.scheduler });
  if (persistence !== null) {
    lifetime.add(
      persistence.events.on('status', ({ status }) => {
        persistenceStatus.set(status);
      }),
    );
  }

  const regenStatus = createRegenStatusAdapter();
  const selection = lifetime.add(createSelectionModel({ regen: regenStatus }));
  lifetime.add(bindSelectionHighlight(selection, viewport.highlight));
  const features = createFeatureEditor({
    doc,
    ops,
    schemas,
    ids: deps.ids,
    translate: deps.translate,
  });
  // The sketcher (M12, spec 11 "Skicář"): the mode is the open sketch session, nothing else.
  const sketches = createSketchEditor({
    features,
    solver: deps.solver,
    viewport,
    ids: deps.ids,
    resolvePlane: (id) => ORIGIN_PLANES.find((p) => p.id === id)?.plane,
  });
  const { mode } = sketches;
  const sketchEdit = (id: FeatureId): void => {
    sketches.edit(id);
  };
  // After the tools of the plugins.
  for (const tool of createSketchTools({ sketches })) toolRegistry.register(tool);
  const featureTree = lifetime.add(
    createFeatureTreeModel({
      doc,
      ops,
      schemas,
      regen: regenStatus,
      editor: features,
      selection,
      sketchEdit,
    }),
  );
  const locked = createEditLock({ readOnly, editor: features });
  const browser = lifetime.add(
    createBrowserModel({
      doc,
      ops,
      regen: regenStatus,
      selection,
      editor: features,
      locked,
      sketchEdit,
    }),
  );
  const actions = lifetime.add(createActionRegistry({ mode }));
  const tools = lifetime.add(
    createToolManager({
      registry: toolRegistry,
      ctx: { viewport, selection, doc, ops, ids: deps.ids, features },
      defaultToolId: SELECT_TOOL.id,
      mode,
      defaultToolIds: { sketch: SKETCH_SELECT_TOOL_ID },
      unhandledKey: (e) => actions.handleKey(e),
    }),
  );
  const toolList = Object.freeze(toolRegistry.all());
  // Built-in actions (spec 11, step 5): their rules live in interaction (ADR 0010).
  lifetime.add(
    createBuiltInActions({
      registry: actions,
      doc,
      ops,
      undo,
      selection,
      featureTree,
      editor: features,
      tools,
      toolList,
      locked,
      camera: viewport.camera,
      confirm: deps.confirm,
      mode,
    }),
  );
  lifetime.add(createSketchActions({ registry: actions, sketches, ids: deps.ids }));

  // 4. Regeneration: doc.changed → scheduler → Regenerator of the current kernel → port, viewport.
  const regenUi = new ObservableValue<RegenUiState>(
    Object.freeze({ busy: false, bodyCount: 0, errorCount: 0, lastMs: null }),
  );
  const updateRegenUi = (change: Partial<RegenUiState>): void => {
    regenUi.set(Object.freeze({ ...regenUi.get(), ...change }));
  };

  const scheduler = createRegenScheduler({ run: regenerate, onError: reportError });
  lifetime.add(
    scheduler.busy.subscribe(() => {
      updateRegenUi({ busy: scheduler.busy.get() });
    }),
  );

  const supervisor = createKernelSupervisor({
    createKernel: deps.createKernel,
    createRegenerator: (kernel) => createRegenerator({ kernel, builders, schemas, now: deps.now }),
    now: deps.now,
    onReady: (kernel) => {
      // A new kernel numbers its handles anew: drop the meshes of the old one (spec 09).
      viewport.bodies.reset(kernel);
      scheduler.request();
    },
    onError: reportError,
  });

  /** Sketches of the last regeneration; drawn by drawSketches (step 6). */
  let regenSketches: readonly SketchArtifact[] = [];
  /** What the viewport shows per sketch id, so an unchanged artifact is not drawn again. */
  const drawnSketches = new Map<string, SketchArtifact>();

  async function regenerate(): Promise<void> {
    const regenerator = supervisor.regenerator();
    // No kernel (starting, restarting, failed): onReady requests a run once there is one.
    if (regenerator === null) return;
    let result: RegenResult | 'superseded';
    try {
      result = await regenerator.run(doc.studio);
    } catch (e) {
      // Q049: the Regenerator is dead with its kernel; the supervisor starts a new pair.
      if (e instanceof RpcError && e.code === 'disconnected') {
        supervisor.lost(regenerator);
        return;
      }
      throw e;
    }
    if (result === 'superseded' || disposed) return;
    regenStatus.publish(result);
    regenSketches = sketchesOf(result.finalState);
    drawSketches();
    // Only bodies go to the counter and the body layer; sketches have their own channel above
    // (ViewportPort.sketches, ADR 0015).
    const bodies = bodiesOf(result.finalState).map(({ id, shape }) => ({ id, shape }));
    updateRegenUi({
      bodyCount: bodies.length,
      errorCount: [...result.statuses.values()].filter((s) => s.kind === 'error').length,
      lastMs: result.durationMs,
    });
    // sync never rejects and drops a stale result itself (spec 09).
    void viewport.bodies.sync(bodies).then(() => {
      applyHidden();
      fitFirstView(bodies.length);
    });
  }

  // First view (spec 11): fit the camera once, after the first regeneration with a body; later
  // changes leave the camera where the user put it.
  let fitted = false;
  function fitFirstView(bodyCount: number): void {
    if (disposed || fitted || bodyCount === 0) return;
    fitted = true;
    viewport.camera.fitAll();
  }

  // 5. Visibility of bodies (Q071): the document holds it, the browser reads it, the viewport
  // mirrors it.
  let shownHidden: ReadonlySet<BodyId> = browser.hidden.get();
  lifetime.add(
    browser.hidden.subscribe(() => {
      const next = browser.hidden.get();
      for (const body of next) if (!shownHidden.has(body)) viewport.setBodyVisible(body, false);
      for (const body of shownHidden) if (!next.has(body)) viewport.setBodyVisible(body, true);
      shownHidden = next;
    }),
  );
  /** After a sync: bodies new to the view (and all after a kernel reset) start visible. */
  function applyHidden(): void {
    if (disposed) return;
    for (const body of browser.hidden.get()) viewport.setBodyVisible(body, false);
  }

  // 6. Sketches and planes (M12): app draws the sketches of the regeneration and the planes
  // switched on in the browser; the edited sketch is drawn by the SketchEditor.
  function drawSketches(): void {
    if (disposed) return;
    const edited = sketches.current.get()?.featureId;
    const shown = new Set<string>();
    for (const artifact of regenSketches) {
      if (artifact.owner === edited) continue;
      shown.add(artifact.id);
      // The regeneration keeps the artifact of an unchanged feature: no new drawing for it.
      if (drawnSketches.get(artifact.id) === artifact) continue;
      drawnSketches.set(artifact.id, artifact);
      viewport.sketches.set(artifact.id, artifactDrawing(artifact.plane, artifact.entities));
    }
    for (const id of [...drawnSketches.keys()]) {
      if (shown.has(id)) continue;
      drawnSketches.delete(id);
      viewport.sketches.remove(id);
    }
  }
  lifetime.add(
    sketches.current.subscribe(() => {
      const session = sketches.current.get();
      // Entering a sketch: look at it straight on (spec 11, "Skicář").
      if (session !== null) viewport.camera.setViewDirection(session.plane.normal);
      drawSketches();
    }),
  );

  let shownPlanes: ReadonlySet<PlaneId> = new Set();
  lifetime.add(
    browser.visiblePlanes.subscribe(() => {
      const next = browser.visiblePlanes.get();
      for (const origin of ORIGIN_PLANES) {
        if (next.has(origin.id) && !shownPlanes.has(origin.id)) {
          viewport.sketches.set(origin.id, planeDrawing(origin.plane));
        } else if (!next.has(origin.id) && shownPlanes.has(origin.id)) {
          viewport.sketches.remove(origin.id);
        }
      }
      shownPlanes = next;
    }),
  );

  lifetime.add(
    doc.events.on('changed', () => {
      scheduler.request();
    }),
  );
  // Reverse order of release: these go first, so nothing regenerates into released models.
  lifetime.add(supervisor);
  lifetime.add(scheduler);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    lifetime.dispose();
    if (persistence !== null) {
      // dispose does not save (spec 05); a flush after it still writes the queue.
      persistence.dispose();
      persistence.flush().catch(reportError);
    }
  }

  async function close(): Promise<void> {
    if (disposed) return;
    let failure: { readonly error: unknown } | null = null;
    try {
      await persistence?.flush();
    } catch (error) {
      failure = { error };
    }
    // Entries appended while the flush ran go with the last flush of dispose.
    dispose();
    if (failure !== null) throw failure.error;
  }
  let closing: Promise<void> | null = null;

  return {
    doc,
    readOnly,
    locked,
    actionIds: ACTION_IDS,
    toolActionId,
    regen: regenUi.asObservable(),
    kernel: supervisor.state,
    kernelError: supervisor.error,
    persistence: persistenceStatus.asObservable(),
    selection,
    featureTree,
    browser,
    tools,
    toolList,
    features,
    actions,
    messages,
    sketches,
    mode,
    sketchActionIds: SKETCH_ACTION_IDS,
    sketchConstraintActionId,
    mountViewport(el) {
      viewport.mount(el);
    },
    setTheme(theme) {
      viewport.setPalette(theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE);
    },
    async flush() {
      await persistence?.flush();
    },
    close() {
      closing ??= close();
      return closing;
    },
    dispose,
  };
}

/** Loads the document; a missing one is created, unless read-only. */
async function openDocument(
  deps: AppSessionDeps,
  schemas: FeatureSchemaRegistry,
  handlers: OpHandlerRegistry,
): Promise<{ doc: DocumentWriter; log: OperationLog }> {
  const { store, docId } = deps;
  const loaded = await loadDocument(store, docId, {
    schemas,
    handlers,
    verify: deps.verify ?? false,
  });
  if (loaded.ok) return loaded.value;
  if (loaded.error.kind !== 'not-found' || deps.readOnly) {
    throw new Error(`Cannot open document '${docId}': ${describeLoadError(loaded.error)}`);
  }
  const meta: DocumentMeta = {
    id: docId,
    name: deps.translate(NAME_OF_NEW_DOCUMENT),
    createdAt: deps.now(),
  };
  const doc = createDocument({ meta });
  // The service saves only entries; the store needs the document with its base snapshot first.
  await store.createDocument(meta, createSnapshot(doc, 0));
  return { doc, log: createOperationLog() };
}

function describeLoadError(error: LoadDocumentError): string {
  switch (error.kind) {
    case 'not-found':
      return 'not found';
    case 'snapshot':
      return `broken ${error.which} snapshot: ${error.error.issues
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`;
    case 'entry':
      return `broken log entry ${String(error.seq)}: ${error.error.path}: ${error.error.message}`;
  }
}

/** Every type has a schema and a builder; registerPlugin guarantees it, this guards app. */
function checkComplete(schemas: FeatureSchemaRegistry, builders: BuilderRegistry): void {
  const schemaTypes = schemas.all().map((s) => s.type);
  const builderTypes = builders.all().map((b) => b.type);
  const missing = [
    ...schemaTypes.filter((t) => !builders.has(t)).map((t) => `builder of '${t}'`),
    ...builderTypes.filter((t) => !schemas.has(t)).map((t) => `schema of '${t}'`),
  ];
  if (missing.length > 0) throw new Error(`Incomplete registries: missing ${missing.join(', ')}`);
}

/** One dictionary per language over all plugins; a key defined twice is a programmer error. */
function mergeMessages(plugins: readonly FeaturePlugin[]): PluginMessages {
  const cs: Record<string, string> = {};
  const en: Record<string, string> = {};
  for (const plugin of plugins) {
    if (plugin.messages === undefined) continue;
    addMessages(cs, plugin.messages.cs, plugin.schema.type);
    addMessages(en, plugin.messages.en, plugin.schema.type);
  }
  return Object.freeze({ cs: Object.freeze(cs), en: Object.freeze(en) });
}

function addMessages(
  into: Record<string, string>,
  from: Readonly<Record<string, string>>,
  type: string,
): void {
  for (const [key, text] of Object.entries(from)) {
    if (Object.hasOwn(into, key)) {
      throw new Error(`Duplicate message '${key}' in the plugin '${type}'`);
    }
    into[key] = text;
  }
}

/** Q038: a dispatcher that refuses every change; reading and its events stay. */
function refuseChanges(inner: OperationDispatcher): OperationDispatcher {
  const refuse = (): never => {
    throw new Error('The document is open read-only (open in another tab)');
  };
  return {
    dispatch: refuse,
    begin: refuse,
    get inTransaction() {
      return inner.inTransaction;
    },
    events: inner.events,
  };
}

/** Errors with nobody to hand them to (a regeneration bug, a failed save or kernel start). */
function reportError(error: unknown): void {
  console.error(error);
}
