// createAppSession (spec 11, "Kompoziční kořen (app)"): wires finished implementations together.
// It knows no worker and no IndexedDB – the kernel factory, the store, the viewport and the timer
// scheduler come in as deps – so it runs in Node with FakeKernel, MemoryDocumentStore and a fake
// viewport. openAppSession (browser) builds the real ones and calls this.

import { DisposableStore } from '@/core';
import type { Disposable, IdGenerator, Observable, Unsubscribe, Vec3 } from '@/core';
import type {
  BodyId,
  BodyMaterial,
  DocumentId,
  DocumentReader,
  DocumentWriter,
  FeatureId,
} from '@/document';
import {
  bindSelectionHighlight,
  createActionRegistry,
  createBrowserModel,
  createBuiltInActions,
  createDocumentNameModel,
  createEditLock,
  createFeatureEditor,
  createFileActions,
  createHistoryModel,
  createFeatureTreeModel,
  createManipulatorController,
  createRefPickLayer,
  createSelectionModel,
  createToolManager,
  createToolbarModel,
  createTopoInspector,
  SELECT_TOOL,
} from '@/interaction';
import type {
  ActionRegistry,
  BrowserModel,
  ConfirmRequest,
  DocumentNameModel,
  FeatureEditor,
  FeatureTreeModel,
  FileActions,
  HistoryModel,
  ManipulatorHud,
  Mode,
  SelectionModel,
  ToolbarModel,
  ToolHint,
  TopoInspector,
  ViewKeyEvent,
  ViewportPort,
} from '@/interaction';
import { createOperationDispatcher, createUndoManager } from '@/ops';
import type { OperationLog } from '@/ops';
import { exportDocument } from '@/persistence';
import type { DocumentStore, PersistenceStatus, Scheduler } from '@/persistence';
import type { FeaturePlugin, PluginMessages } from '@/plugin-api';
import { createRegenerator, planeOfRef, sketchesOf } from '@/regen';
import type { BodyLayer, CameraController, Viewport } from '@/render';
import type { ConstraintSolver } from '@/sketch';
import {
  createSketchActions,
  createSketchEditor,
  createSketchTools,
  SKETCH_SELECT_TOOL_ID,
  SKETCH_TOOLBAR,
} from '@/sketcher';
import type { SketchEditor } from '@/sketcher';
import { createFileExporter } from './file-exporter';
import type { DownloadFile } from './file-exporter';
import { createKernelSupervisor } from './kernel-supervisor';
import { createSketchGeometry } from './sketch-geometry';
import type { KernelUiState, SupervisedKernel } from './kernel-supervisor';
import { openDocument } from './open-document';
import { createSessionPersistence, refuseChanges } from './read-only';
import { createRegenPipeline } from './regen-pipeline';
import type { RegenUiState } from './regen-pipeline';
import { createRegenStatusAdapter } from './regen-status-adapter';
import { createPluginRegistries } from './registries';
import type { PluginRegistries } from './registries';
import { createViewSettings } from './view-settings';
import type { ViewportSettings, ViewSettings } from './view-settings';
import { bindBrowserView } from './viewport-mirror';

/**
 * What app needs from the 3D view: the port of interaction plus mounting, the body layer, the
 * camera, the view settings (palette, view cube labels, rotation mode), body visibility and body
 * colour (M15). render's Viewport is one; tests
 * use a fake.
 * app hands the kernel to the view through `bodies.reset` whenever a kernel becomes ready
 * (spec 09, "Výměna instance jádra"), so the meshes the view was created with are replaced
 * before the first sync.
 */
export interface AppViewport extends ViewportPort, ViewportSettings {
  mount(el: HTMLElement): void;
  readonly bodies: BodyLayer;
  /**
   * M21: the pickable bodies and the preview of the edited feature's result in one swap
   * (ADR 0025, D3 of M19.1).
   */
  readonly syncLayers: Viewport['syncLayers'];
  readonly camera: CameraController;
  setBodyVisible(body: BodyId, visible: boolean): void;
  /** '#rrggbb', null = the face colour of the palette (spec 09, M15). */
  setBodyColor(body: BodyId, color: string | null): void;
  /** M24: the material preset of a body, shown in Realistic only (spec 09). */
  setBodyMaterial(body: BodyId, material: BodyMaterial): void;
  /** M19.2: the step of the drawn sketch grid in mm; the sketcher snaps to it (D4). */
  sketchGridStep(): number;
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
  /** M15: the theme at the start: the first value of defaultBodyColor; later viewSettings.setTheme. */
  readonly theme: 'light' | 'dark';
}

export interface AppSession extends Disposable {
  readonly doc: DocumentReader;
  /** Q038: the document is open in another tab. */
  readonly readOnly: boolean;
  /** Read-only or an open feature dialog: the one rule, from interaction (createEditLock). */
  readonly locked: Observable<boolean>;
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
  /**
   * M20: the groups of the Toolbar and what its buttons do. Without dispose: the session
   * disposes it (ADR 0011).
   */
  readonly toolbar: Omit<ToolbarModel, 'dispose'>;
  readonly features: FeatureEditor;
  /** M20: what ui does with the actions: list them, run one, hand it a key. */
  readonly actions: Pick<ActionRegistry, 'actions' | 'run' | 'handleKey'>;
  /** Dictionaries of the plugins for vue-i18n (ADR 0014). */
  readonly messages: PluginMessages;
  /**
   * M12: the sketcher (sketch panel, mode). Without gridStep (M19.2): the step of the grid is
   * the viewport's, only the sketch tools read it.
   */
  readonly sketches: Omit<SketchEditor, 'gridStep'>;
  /** M12: = sketches.mode; the Toolbar and the dialog vs. the sketch panel follow it. */
  readonly mode: Observable<Mode>;
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
  /** M15: '#rrggbb' face colour of the current palette (viewSettings.setTheme), for the colour field in ui. */
  readonly defaultBodyColor: Observable<string>;
  /**
   * M19.2: the name of the document in the title bar and its rename (document.rename, outside
   * undo). Without dispose: the session disposes it (ADR 0011).
   */
  readonly documentName: Omit<DocumentNameModel, 'dispose'>;
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
  /** M37: the tools as ui sees them: the hint HUD of the active tool (spec 11, rule 8a). */
  readonly tools: {
    /** The hint of the active tool's current step; null = none. */
    readonly hint: Observable<ToolHint | null>;
  };
  /**
   * M19.2: projection of world points onto the view and its moves, forwarded from the viewport
   * like manipulator.project and onViewChanged, for everything ui places over the view (the
   * dimensions of a sketch, D4).
   */
  readonly view: {
    /** Px relative to the view area; null when the view is not mounted. */
    project(world: Vec3): readonly [x: number, y: number] | null;
    /** The view moved (camera, resize): every frame of an animation. */
    onViewChanged(listener: () => void): Unsubscribe;
  };

  mountViewport(el: HTMLElement): void;
  /** D7 of M20: theme, view cube labels and rotation mode from ui (one port, see ViewSettings). */
  readonly viewSettings: ViewSettings;
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

/**
 * Opens the document `docId` and wires a session over it. Rejects when a plugin is broken, the
 * stored data cannot be loaded, or a read-only document is missing. The kernel starts in the
 * background: the session comes back with `kernel` 'starting' and regenerates once it is ready.
 */
export async function createAppSession(deps: AppSessionDeps): Promise<AppSession> {
  // 1. Registries and plugins, before anything is opened or started.
  const registries = createPluginRegistries(deps.plugins);

  // 2. The document.
  const { doc, log } = await openDocument({
    ...deps,
    schemas: registries.schemas,
    handlers: registries.handlers,
    verify: deps.verify ?? false,
  });

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

  // Without the lock nothing is written (Q038).
  const persistence = createSessionPersistence({
    readOnly,
    store: deps.store,
    log,
    doc,
    scheduler: deps.scheduler,
  });

  const regenStatus = createRegenStatusAdapter();
  const selection = lifetime.add(createSelectionModel({ regen: regenStatus }));
  const features = createFeatureEditor({
    doc,
    ops,
    schemas,
    ids: deps.ids,
    translate: deps.translate,
    // A new Extrude or Revolve takes the only region of the last sketch (D6 of M19.2).
    regen: regenStatus,
  });
  // With the editor, the regions, edges, faces and bodies picked in the dialog are highlighted in
  // the view (M13, M14, spec 10); the port gives the indices of the named edges and faces.
  lifetime.add(bindSelectionHighlight(selection, viewport.highlight, features, regenStatus));
  // The sketcher (M12, spec 11 "Skicář"): the mode is the open sketch session, nothing else.
  const sketches = createSketchEditor({
    features,
    solver: deps.solver,
    // M30: the geometry of the sketch in the kernel; empty until M33.
    geometry: createSketchGeometry(),
    viewport,
    // Origin planes and planar faces of the last regeneration (M14); before the first one
    // EMPTY_STATE still has the origin planes.
    resolvePlane: (ref) => planeOfRef(pipeline.lastState(), ref),
    // M21 (ADR 0025): an edited sketch opens on the plane its builder computed from its input,
    // also after a later Transform or a Boolean that consumes the body of its face.
    planeOfSketch: (id) => sketchesOf(pipeline.lastState()).find((s) => s.owner === id)?.plane,
    // M19.2 D4: the tools snap to the step of the grid drawn on the screen.
    gridStep: () => viewport.sketchGridStep(),
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
  const unhandledKey = (e: ViewKeyEvent): boolean => actions.handleKey(e);
  // The layers of input before the tools (spec 10): the manipulators (M18), then refPick of a
  // focused reference param in the dialog (Q066). Added before ToolManager, so the reverse order
  // of release disposes them after ToolManager.
  const manipulators = lifetime.add(
    createManipulatorController({
      features,
      regen: regenStatus,
      registry: manipulatorRegistry,
      viewport,
    }),
  );
  const refPick = lifetime.add(
    // Names of the bodies for a topo param (M14).
    createRefPickLayer({ features, viewport, doc, regen: regenStatus, unhandledKey }),
  );
  const tools = lifetime.add(
    createToolManager({
      registry: toolRegistry,
      ctx: { viewport, selection, doc, ids: deps.ids, features },
      viewportEvents: viewport.events,
      defaultToolId: SELECT_TOOL.id,
      mode,
      defaultToolIds: { sketch: SKETCH_SELECT_TOOL_ID },
      unhandledKey,
      layers: [manipulators, refPick],
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
  const toolbar = lifetime.add(
    createToolbarModel({
      tools,
      toolList,
      actions,
      locked,
      mode,
      // The sketch mode brings its groups and buttons itself (M20).
      contributions: [SKETCH_TOOLBAR],
    }),
  );
  // Debugging the names (M14, R111): starts disabled, ui switches it on in development only.
  const topoInspector = lifetime.add(createTopoInspector({ viewport, regen: regenStatus }));

  // 4. Regeneration: doc.changed → scheduler → Regenerator of the current kernel → viewport,
  // then the port and the rest of the UI (D3). Started by the last step (supervisor.start()),
  // once everything it calls into exists.
  const supervisor = createKernelSupervisor({
    createKernel: deps.createKernel,
    createRegenerator: (kernel) => createRegenerator({ kernel, builders, schemas, now: deps.now }),
    monotonic: deps.monotonic,
    onReady: (kernel) => {
      pipeline.kernelReady(kernel);
    },
    onError: reportError,
  });
  const pipeline = lifetime.add(
    createRegenPipeline({
      doc,
      kernel: supervisor,
      viewport,
      regenStatus,
      features,
      sketches,
      afterSync: () => {
        browserView.reapply();
      },
      reportError,
    }),
  );
  // Entering a sketch and moving its plane (M21): look at it straight on (spec 11, "Skicář").
  let offSketchPlane: Unsubscribe | null = null;
  lifetime.add(() => {
    offSketchPlane?.();
  });
  lifetime.add(
    sketches.current.subscribe(() => {
      offSketchPlane?.();
      offSketchPlane = null;
      const session = sketches.current.get();
      if (session === null) return;
      const look = (): void => {
        viewport.camera.setViewDirection(session.plane.get().normal);
      };
      offSketchPlane = session.plane.subscribe(look);
      look();
    }),
  );

  // 5., 6. Visibility, colours and materials of bodies (Q071, M15, M24), planes and axes (M12, M13): the browser
  // holds them, the viewport mirrors them.
  const browserView = lifetime.add(bindBrowserView(browser, viewport));

  // 7. Edit history and export (M15).
  const history = lifetime.add(createHistoryModel({ log }));
  // M19.2: the name of the document (title bar); `ops` refuses changes when read-only, `locked`
  // says so in advance.
  const documentName = lifetime.add(createDocumentNameModel({ doc, ops, locked }));
  const exporter = createFileExporter({
    name: () => doc.meta.name,
    regenBusy: pipeline.busy,
    lastState: () => pipeline.lastState(),
    kernel: () => supervisor.kernel(),
    flush: () => persistence.flush(),
    persistenceStatus: () => persistence.status.get(),
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
  // The theme is read here, by the last step of the construction.
  const { viewSettings, defaultBodyColor } = createViewSettings(viewport, deps.theme);

  lifetime.add(
    doc.events.on('changed', () => {
      pipeline.request();
    }),
  );
  // Reverse order of release: it goes first, so no kernel is left to regenerate with.
  lifetime.add(supervisor);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    lifetime.dispose();
    // dispose does not save (spec 05); a flush after it still writes the queue.
    persistence.release(reportError);
  }

  async function close(): Promise<void> {
    if (disposed) return;
    let failure: { readonly error: unknown } | null = null;
    try {
      await persistence.flush();
    } catch (error) {
      failure = { error };
    }
    // Entries appended while the flush ran go with the last flush of dispose.
    dispose();
    if (failure !== null) throw failure.error;
  }
  let closing: Promise<void> | null = null;

  // M19.2: the view for ui; manipulator.project and onViewChanged delegate to it.
  const view: AppSession['view'] = {
    project(world) {
      return viewport.project(world);
    },
    onViewChanged(listener) {
      return viewport.events.on('viewChanged', () => {
        listener();
      });
    },
  };

  const session: AppSession = {
    doc,
    readOnly,
    locked,
    regen: pipeline.state,
    kernel: supervisor.state,
    kernelError: supervisor.error,
    retryKernel() {
      supervisor.retry();
    },
    persistence: persistence.status,
    persistenceError: persistence.error,
    selection,
    featureTree,
    browser,
    toolbar,
    features,
    actions,
    messages,
    sketches,
    mode,
    topoInspector,
    history,
    files,
    defaultBodyColor,
    documentName,
    tools: { hint: tools.hint },
    manipulator: {
      hud: manipulators.hud,
      setMode(id) {
        manipulators.setMode(id);
      },
      setValue(handleId, shown) {
        manipulators.setValue(handleId, shown);
      },
      project(world) {
        return view.project(world);
      },
      onViewChanged(listener) {
        return view.onViewChanged(listener);
      },
    },
    view,
    mountViewport(el) {
      viewport.mount(el);
    },
    viewSettings,
    flush() {
      return persistence.flush();
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

/** Errors with nobody to hand them to (a regeneration bug, a failed save or kernel start). */
function reportError(error: unknown): void {
  console.error(error);
}
