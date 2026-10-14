// createAppSession (spec 11, "Kompoziční kořen (app)"): wires finished implementations together.
// It knows no worker and no IndexedDB – the kernel factory, the store, the viewport and the timer
// scheduler come in as deps – so it runs in Node with FakeKernel, MemoryDocumentStore and a fake
// viewport. openAppSession (browser) builds the real ones and calls this.

import { DisposableStore, ObservableValue, RpcError } from '@/core';
import type { Disposable, IdGenerator, Observable, Unsubscribe, Vec3 } from '@/core';
import { createDocument, ORIGIN_AXES, ORIGIN_PLANES } from '@/document';
import type {
  AxisId,
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
  axisDrawing,
  bindSelectionHighlight,
  createActionRegistry,
  createBrowserModel,
  createBuiltInActions,
  createEditLock,
  createFeatureEditor,
  createFileActions,
  createHistoryModel,
  toolActionId,
  toolModes,
  createFeatureTreeModel,
  createManipulatorController,
  createSelectionModel,
  createSketchActions,
  createSketchEditor,
  createSketchTools,
  createToolManager,
  createTopoInspector,
  FILE_ACTION_IDS,
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
  FileActions,
  HistoryModel,
  ManipulatorHud,
  Mode,
  SelectionModel,
  SketchEditor,
  ToolDescriptor,
  ToolManager,
  TopoInspector,
  ViewportPort,
} from '@/interaction';
import { createOperationDispatcher, createOperationLog, createUndoManager } from '@/ops';
import type { OperationDispatcher, OperationLog, OpHandlerRegistry } from '@/ops';
import {
  createPersistenceService,
  createSnapshot,
  exportDocument,
  loadDocument,
} from '@/persistence';
import type {
  DocumentStore,
  PersistenceService,
  PersistenceStatus,
  Scheduler,
} from '@/persistence';
import type { FeaturePlugin, PluginMessages } from '@/plugin-api';
import { bodiesOf, createRegenerator, EMPTY_STATE, planeOfRef, sketchesOf } from '@/regen';
import type { Regenerator, RegenState, SketchArtifact } from '@/regen';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render';
import type {
  BodyLayer,
  CameraController,
  OrbitMode,
  ScenePalette,
  ViewCubeLabels,
} from '@/render';
import type { ConstraintSolver, GeometricConstraintKind } from '@/sketch';
import { createFileExporter } from './file-exporter';
import type { DownloadFile } from './file-exporter';
import { createKernelSupervisor } from './kernel-supervisor';
import type { KernelUiState, SupervisedKernel } from './kernel-supervisor';
import { describeLoadError } from './load-error';
import { createRegenScheduler } from './regen-scheduler';
import { createRegenStatusAdapter } from './regen-status-adapter';
import { createPluginRegistries } from './registries';
import type { PluginRegistries } from './registries';

export type RegenUiState = {
  /** A regeneration is running or due. */
  readonly busy: boolean;
  /** Bodies of the last finished regeneration. */
  readonly bodyCount: number;
  /** Features with an error in the last finished regeneration. */
  readonly errorCount: number;
  /** Duration of the last finished regeneration; null before the first. */
  readonly lastMs: number | null;
  /**
   * M19.1: text of the error of the last regeneration that threw (a bug, not a lost kernel);
   * null before the first such error and after a successful regeneration.
   */
  readonly failed: string | null;
};

/**
 * What app needs from the 3D view: the port of interaction plus mounting, the body layer, the
 * camera, the palette, body visibility and body colour (M15). render's Viewport is one; tests
 * use a fake.
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
  /** '#rrggbb', null = the face colour of the palette (spec 09, M15). */
  setBodyColor(body: BodyId, color: string | null): void;
  /** M17: translated labels of the view cube; the same texts again are ignored (spec 09). */
  setViewCubeLabels(labels: ViewCubeLabels): void;
  /** M17.1: the rotation mode of the camera; ui owns it, the viewport only applies it. */
  setOrbitMode(mode: OrbitMode): void;
  /** M17.1: click on the rotation mode button of the view cube. */
  onOrbitModeToggle(listener: () => void): Unsubscribe;
}

export interface AppSessionDeps {
  readonly plugins: readonly FeaturePlugin[];
  readonly store: DocumentStore;
  readonly docId: DocumentId;
  /**
   * A new kernel for the start, for every restart after a crash (Q055) and for a retry; it
   * reports its own crash (onDisconnected, M19.1).
   */
  readonly createKernel: () => Promise<SupervisedKernel>;
  readonly viewport: AppViewport;
  /** Timers of the persistence service (ring 1 knows no setTimeout, ADR 0009). */
  readonly scheduler: Scheduler;
  /** Clock in ms: log entry times, regeneration durations. */
  readonly now: () => number;
  /**
   * M19.1: monotonic clock in ms (performance.now in the browser) for the restart window of the
   * kernel; unlike `now` it does not jump when the system time is set.
   */
  readonly monotonic: () => number;
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
  /** M15: downloads an exported file; tests capture it, the browser hands ui's implementation. */
  readonly download: (file: DownloadFile) => void;
  /** M15: the theme at the start: the first value of defaultBodyColor; later setTheme. */
  readonly theme: 'light' | 'dark';
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
  /** The modes of a tool (its own or the default, spec 10 "Režim"); ui may not import toolModes. */
  toolModes(tool: ToolDescriptor): readonly Mode[];
  readonly regen: Observable<RegenUiState>;
  /** Q055: restart after a kernel crash. */
  readonly kernel: Observable<KernelUiState>;
  /**
   * Why the kernel did not start ('unavailable') or its last crash ('failed'), for the UI; null
   * otherwise.
   */
  readonly kernelError: Observable<string | null>;
  /**
   * M19.1: from 'failed' or 'unavailable' starts the kernel again, with an empty restart window;
   * in any other state it does nothing.
   */
  retryKernel(): void;
  /** Always 'saved' when read-only. */
  readonly persistence: Observable<PersistenceStatus>;
  /**
   * M19.1: the text of the last failed write while `persistence` is 'error' or 'failed', for the
   * UI; null otherwise and when read-only.
   */
  readonly persistenceError: Observable<string | null>;
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
  /**
   * M14: the name of the face or edge under the cursor, for the debug panel (R111). Without
   * dispose: the inspector belongs to the session, which disposes it (ADR 0011).
   */
  readonly topoInspector: Omit<TopoInspector, 'dispose'>;
  /** M15: the edit history panel. Without dispose: the session disposes it (ADR 0011). */
  readonly history: Omit<HistoryModel, 'dispose'>;
  /**
   * M15: the state of an export; the actions themselves are in `actions`, group 'file'. Without
   * dispose: the session disposes it (ADR 0011).
   */
  readonly files: Omit<FileActions, 'dispose'>;
  /** M15: the ids of the File actions; ui may not import values of interaction. */
  readonly fileActionIds: typeof FILE_ACTION_IDS;
  /** M15: '#rrggbb' face colour of the current palette (setTheme), for the colour field in ui. */
  readonly defaultBodyColor: Observable<string>;
  /**
   * M19: the HUD of the manipulator (mode bar and value field, spec 11 rule 8). hud, setMode and
   * setValue are the controller's; project and onViewChanged are forwarded from the viewport, so
   * ui can place the HUD over the view without knowing render.
   */
  readonly manipulator: {
    readonly hud: Observable<ManipulatorHud | null>;
    setMode(id: string): void;
    setValue(handleId: string, shown: number): void;
    /** Px relative to the view area; null when the view is not mounted. */
    project(world: Vec3): readonly [x: number, y: number] | null;
    /** The view moved (camera, resize): positions of the HUD are stale; every frame of an animation. */
    onViewChanged(listener: () => void): Unsubscribe;
  };

  mountViewport(el: HTMLElement): void;
  /** Q072: app picks the ScenePalette, ui does not know render. */
  setTheme(theme: 'light' | 'dark'): void;
  /** M17: translated labels of the view cube from ui; render knows no i18n. */
  setViewCubeLabels(labels: ViewCubeLabels): void;
  /** M17.1: the rotation mode from ui (a page preference like the theme) → viewport. */
  setOrbitMode(mode: OrbitMode): void;
  /** M17.1: request of the rotation mode button of the view cube, forwarded from the viewport. */
  onOrbitModeToggle(listener: () => void): Unsubscribe;
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
  // 1. Registries and plugins, before anything is opened or started.
  const registries = createPluginRegistries(deps.plugins);

  // 2. The document.
  const { doc, log } = await openDocument(deps, registries.schemas, registries.handlers);

  // 3.–7. Synchronous wiring. A step that throws releases what the steps before it built; the
  // kernel starts only after the last step, so no worker is left behind (M19.1).
  const lifetime = new DisposableStore();
  try {
    return wireSession(deps, registries, { doc, log }, lifetime);
  } catch (e) {
    lifetime.dispose();
    throw e;
  }
}

/**
 * Steps 3–7 of createAppSession over the opened document. Everything it builds that needs
 * releasing goes to `lifetime`; the persistence service, released by dispose separately, holds
 * nothing outside the session before the first change. Starts the kernel as its last step.
 */
function wireSession(
  deps: AppSessionDeps,
  registries: PluginRegistries,
  { doc, log }: { readonly doc: DocumentWriter; readonly log: OperationLog },
  lifetime: DisposableStore,
): AppSession {
  const { viewport, readOnly } = deps;
  const {
    schemas,
    builders,
    tools: toolRegistry,
    manipulators: manipulatorRegistry,
    handlers,
    messages,
  } = registries;

  // 3. Services and models.
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
  const persistenceError =
    persistence?.lastError ?? new ObservableValue<string | null>(null).asObservable();

  const regenStatus = createRegenStatusAdapter();
  const selection = lifetime.add(createSelectionModel({ regen: regenStatus }));
  const features = createFeatureEditor({
    doc,
    ops,
    schemas,
    ids: deps.ids,
    translate: deps.translate,
  });
  // With the editor, the regions, edges, faces and bodies picked in the dialog are highlighted in
  // the view (M13, M14, spec 10); the port gives the indices of the named edges and faces.
  lifetime.add(bindSelectionHighlight(selection, viewport.highlight, features, regenStatus));
  /** The final state of the last regeneration: the planes of sketches on faces (M14). */
  let lastState: RegenState = EMPTY_STATE;
  // The sketcher (M12, spec 11 "Skicář"): the mode is the open sketch session, nothing else.
  const sketches = createSketchEditor({
    features,
    solver: deps.solver,
    viewport,
    // Origin planes and planar faces of the last regeneration (M14); before the first one
    // EMPTY_STATE still has the origin planes.
    resolvePlane: (ref) => planeOfRef(lastState, ref),
  });
  const { mode } = sketches;
  const sketchEdit = (id: FeatureId): void => {
    sketches.edit(id);
  };
  // After the tools of the plugins.
  for (const tool of createSketchTools({ sketches })) toolRegistry.register(tool);
  const locked = createEditLock({ readOnly, editor: features });
  const featureTree = lifetime.add(
    createFeatureTreeModel({
      doc,
      ops,
      schemas,
      regen: regenStatus,
      editor: features,
      selection,
      locked,
      sketchEdit,
    }),
  );
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
  // M18: the layer of manipulators above refPick and the tools. Added before ToolManager, so the
  // reverse order of release disposes it after ToolManager.
  const manipulators = lifetime.add(
    createManipulatorController({
      features,
      regen: regenStatus,
      registry: manipulatorRegistry,
      viewport,
    }),
  );
  const tools = lifetime.add(
    createToolManager({
      registry: toolRegistry,
      ctx: { viewport, selection, doc, ops, ids: deps.ids, features },
      regen: regenStatus,
      defaultToolId: SELECT_TOOL.id,
      mode,
      defaultToolIds: { sketch: SKETCH_SELECT_TOOL_ID },
      unhandledKey: (e) => actions.handleKey(e),
      manipulators,
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
      tools,
      toolList,
      locked,
      camera: viewport.camera,
      confirm: deps.confirm,
      mode,
    }),
  );
  lifetime.add(createSketchActions({ registry: actions, sketches, ids: deps.ids }));
  // Debugging the names (M14, R111): starts disabled, ui switches it on in development only.
  const topoInspector = lifetime.add(createTopoInspector({ viewport, regen: regenStatus }));

  // 4. Regeneration: doc.changed → scheduler → Regenerator of the current kernel → viewport,
  // then the port and the rest of the UI (D3).
  const regenUi = new ObservableValue<RegenUiState>(
    Object.freeze({ busy: false, bodyCount: 0, errorCount: 0, lastMs: null, failed: null }),
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

  // Started by the last step (supervisor.start()), once everything it calls into exists.
  const supervisor = createKernelSupervisor({
    createKernel: deps.createKernel,
    createRegenerator: (kernel) => createRegenerator({ kernel, builders, schemas, now: deps.now }),
    monotonic: deps.monotonic,
    onReady: (kernel) => {
      try {
        // A new kernel numbers its handles anew: no handle of the old one may reach it, through
        // the last state (the STEP export, revize AF13) or the meshes of the view (spec 09).
        lastState = EMPTY_STATE;
        viewport.bodies.reset(kernel);
        scheduler.request();
      } catch (e) {
        reportError(e);
      }
    },
    onError: reportError,
  });

  /** Sketches of the last regeneration; drawn by drawSketches (step 6). */
  let regenSketches: readonly SketchArtifact[] = [];
  /** What the viewport shows per sketch id, so an unchanged artifact is not drawn again. */
  const drawnSketches = new Map<string, SketchArtifact>();

  /** One run of the scheduler: a regeneration with the Regenerator of the live kernel. */
  async function regenerate(): Promise<void> {
    const regenerator = supervisor.regenerator();
    // No kernel (starting, restarting, failed): onReady requests a run once there is one.
    if (regenerator === null) return;
    try {
      await regenerateWith(regenerator);
    } catch (e) {
      // Q049: the Regenerator is dead with its kernel; the supervisor starts a new pair.
      if (e instanceof RpcError && e.code === 'disconnected') {
        supervisor.lost(regenerator);
        return;
      }
      // M19.1: shown in the UI, so the model does not stay stale silently; reported as well.
      if (!disposed) updateRegenUi({ failed: errorText(e) });
      throw e;
    }
  }

  /** The session lives and `regenerator` is still the one of the live kernel. */
  function isCurrent(regenerator: Regenerator): boolean {
    return !disposed && supervisor.regenerator() === regenerator;
  }

  /**
   * D3 (M19.1): the result is published only once the view shows its bodies, so an index picked
   * in the view and the names in the port belong to the same generation (revize C6). The
   * scheduler runs one regeneration at a time and this one includes the tessellation, so a stale
   * result neither publishes a snapshot nor sends a tessellation.
   */
  async function regenerateWith(regenerator: Regenerator): Promise<void> {
    const result = await regenerator.run(doc.studio);
    // Also when the kernel died after its last call: the next kernel numbers its handles anew, so
    // these must not reach its view.
    if (result === 'superseded' || !isCurrent(regenerator)) return;
    // Only bodies go to the counter and the body layer; sketches have their own channel
    // (ViewportPort.sketches, ADR 0015).
    const bodies = bodiesOf(result.finalState).map(({ id, shape }) => ({ id, shape }));
    // Never rejects; settles once the scene is swapped or the sync is stale (spec 09).
    await viewport.bodies.sync(bodies);
    // A restart meanwhile reset the view (onReady): the result belongs to a dead kernel.
    if (!isCurrent(regenerator)) return;

    lastState = result.finalState;
    // A subscriber that throws does not stop the step; its error is reported after it.
    let subscriberError: { readonly error: unknown } | null = null;
    try {
      regenStatus.publish(result);
    } catch (error) {
      subscriberError = { error };
    }
    try {
      regenSketches = sketchesOf(result.finalState);
      drawSketches();
      updateRegenUi({
        bodyCount: bodies.length,
        errorCount: [...result.statuses.values()].filter((s) => s.kind === 'error').length,
        lastMs: result.durationMs,
        failed: null,
      });
      applyHidden();
      applyColors();
      fitFirstView(bodies.length);
    } finally {
      if (subscriberError !== null) reportError(subscriberError.error);
    }
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

  // Colours of bodies (M15): like visibility; a colour set before the body is shown is dropped by
  // the view, so it is applied again after every sync.
  let shownColors: ReadonlyMap<BodyId, string> = browser.colors.get();
  lifetime.add(
    browser.colors.subscribe(() => {
      const next = browser.colors.get();
      for (const [body, color] of next) {
        if (shownColors.get(body) !== color) viewport.setBodyColor(body, color);
      }
      for (const body of shownColors.keys()) {
        if (!next.has(body)) viewport.setBodyColor(body, null);
      }
      shownColors = next;
    }),
  );
  function applyColors(): void {
    if (disposed) return;
    for (const [body, color] of browser.colors.get()) viewport.setBodyColor(body, color);
  }

  // 6. Sketches, planes and axes (M12, M13): app draws the sketches of the regeneration (with
  // their regions) and the planes and axes switched on in the browser; the edited sketch is
  // drawn by the SketchEditor.
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

  // Origin axes (M13): like the planes, a view state of the browser drawn under the axis id.
  let shownAxes: ReadonlySet<AxisId> = new Set();
  lifetime.add(
    browser.visibleAxes.subscribe(() => {
      const next = browser.visibleAxes.get();
      for (const origin of ORIGIN_AXES) {
        if (next.has(origin.id) && !shownAxes.has(origin.id)) {
          viewport.sketches.set(origin.id, axisDrawing(origin));
        } else if (!next.has(origin.id) && shownAxes.has(origin.id)) {
          viewport.sketches.remove(origin.id);
        }
      }
      shownAxes = next;
    }),
  );

  // 7. Edit history and export (M15).
  const history = lifetime.add(createHistoryModel({ log }));
  const exporter = createFileExporter({
    name: () => doc.meta.name,
    regenBusy: scheduler.busy,
    lastState: () => lastState,
    kernel: () => supervisor.kernel(),
    flush: () => persistence?.flush() ?? Promise.resolve(),
    persistenceStatus: () => persistenceStatus.get(),
    // The exporter gets the file of the live document, not the document (ADR 0011).
    liveFile: () => exportDocument(doc),
    store: deps.store,
    docId: deps.docId,
    schemas,
    handlers,
    download: deps.download,
  });
  const files = lifetime.add(
    createFileActions({
      registry: actions,
      exporter,
      regen: regenStatus,
      browser,
      editor: features,
      mode,
    }),
  );
  const defaultBodyColor = new ObservableValue(hexColor(paletteOf(deps.theme).face));

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

  const session: AppSession = {
    doc,
    readOnly,
    locked,
    actionIds: ACTION_IDS,
    toolActionId,
    toolModes,
    regen: regenUi.asObservable(),
    kernel: supervisor.state,
    kernelError: supervisor.error,
    retryKernel() {
      supervisor.retry();
    },
    persistence: persistenceStatus.asObservable(),
    persistenceError,
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
    topoInspector,
    history,
    files,
    fileActionIds: FILE_ACTION_IDS,
    defaultBodyColor: defaultBodyColor.asObservable(),
    manipulator: {
      hud: manipulators.hud,
      setMode(id) {
        manipulators.setMode(id);
      },
      setValue(handleId, shown) {
        manipulators.setValue(handleId, shown);
      },
      project(world) {
        return viewport.project(world);
      },
      onViewChanged(listener) {
        return viewport.events.on('viewChanged', () => {
          listener();
        });
      },
    },
    mountViewport(el) {
      viewport.mount(el);
    },
    setTheme(theme) {
      const palette = paletteOf(theme);
      viewport.setPalette(palette);
      defaultBodyColor.set(hexColor(palette.face));
    },
    setViewCubeLabels(labels) {
      viewport.setViewCubeLabels(labels);
    },
    setOrbitMode(mode) {
      viewport.setOrbitMode(mode);
    },
    onOrbitModeToggle(listener) {
      return viewport.onOrbitModeToggle(listener);
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
  // Last: everything the kernel's onReady and the regeneration call into exists now.
  supervisor.start();
  return session;
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

function paletteOf(theme: 'light' | 'dark'): ScenePalette {
  return theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}

/** 0xRRGGBB of a palette → '#rrggbb', the form of a body colour in the document. */
function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
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

/** The text of an error for the UI (RegenUiState.failed). */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
