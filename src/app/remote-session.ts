// createRemoteAppSession (spec 11, "Kompoziční kořen (app)"; M46, N63–N70): the AppSession over a
// session of the native core. It wires the same models as wireSession of the local path, with
// the parts of M46 in place of the local document, dispatcher, undo, persistence, kernel and
// regeneration: the optimistic mirror and the remote dispatcher, the read model view with the
// meshes by content_version, the history and the export of the server, and the connection
// mapped onto the kernel and save states. It knows no DOM: the transport, the viewport, the timers
// and the resume store come in as deps, so it runs in Node over createFakeCore().

import { DisposableStore, ObservableValue } from '@/core';
import type { IdGenerator, Unsubscribe } from '@/core';
import type { DocumentId, FeatureId } from '@/document';
import {
  bindSelectionHighlight,
  createActionRegistry,
  createBrowserModel,
  createBuiltInActions,
  createDocumentNameModel,
  createEditLock,
  createFeatureEditor,
  createFeatureTreeModel,
  createFileActions,
  createHistoryModel,
  createManipulatorController,
  createRefPickLayer,
  createSelectionModel,
  createToolbarModel,
  createToolManager,
  createTopoInspector,
  SELECT_TOOL,
} from '@/interaction';
import type { ConfirmRequest, ViewKeyEvent } from '@/interaction';
import type { MeshQuality } from '@/kernel';
import type { UndoManager } from '@/ops';
import type { FeaturePlugin } from '@/plugin-api';
import { createRemoteDocuments, openRemoteSession } from '@/remote';
import type {
  RemoteError,
  RemoteSession,
  RemoteSessionOptions,
  RetryPolicy,
  SessionResumeStore,
  Timers,
} from '@/remote';
import type { ConstraintSolver, SketchGeometry, TextOutliner } from '@/sketch';
import {
  createSketchActions,
  createSketchEditor,
  createSketchTools,
  SKETCH_SELECT_TOOL_ID,
  SKETCH_TOOLBAR,
} from '@/sketcher';
import { createConnectionState } from './connection-state';
import type { DownloadFile } from './file-exporter';
import { MirrorDocument } from './mirror-document';
import { refuseChanges } from './read-only';
import { createReadModelView } from './read-model-view';
import { createRemoteDispatcher } from './remote-dispatcher';
import { createRemoteFileExporter } from './remote-file-exporter';
import { RemoteHistory } from './remote-history';
import { createRemoteRegistries } from './remote-registries';
import type { AppSession, AppViewport } from './session';
import { createVersionMeshes } from './version-meshes';
import type { VersionMeshes } from './version-meshes';
import { createViewSettings } from './view-settings';
import { bindBrowserView } from './viewport-mirror';

// app uses no npm package of the transport (spec 01): the type comes through remote.
type Transport = RemoteSessionOptions['transport'];

export interface RemoteAppSessionDeps {
  /** The client halves of the feature types: tools, manipulators, messages (N67). */
  readonly plugins: readonly FeaturePlugin[];
  /** The connection to the core (createCoreTransport; tests createFakeCore().transport). */
  readonly transport: Transport;
  readonly docId: DocumentId;
  readonly viewport: AppViewport;
  /** Waits between attempts and the watch of the stream of the session. */
  readonly timers: Timers;
  /** Where the tab keeps its session across a reload (sessionStorage, N70). */
  readonly resume: SessionResumeStore;
  /** A new UUID v4 for every request that changes something. */
  readonly newOperationId: () => string;
  /** Clock in ms: the time of the provisional log entries. */
  readonly now: () => number;
  /** Ids of new features. */
  readonly ids: IdGenerator;
  /** Translation of keys: the name of a new feature (ADR 0014). */
  readonly translate: (key: string) => string;
  /** Asks the user a yes/no question (feature.delete with dependents); ui shows the dialog. */
  readonly confirm: (request: ConfirmRequest) => boolean;
  /** The solver of the sketcher (createPlanegcsSolver; tests FakeSolver). */
  readonly solver: ConstraintSolver;
  /** The letter outlines of sketch texts (M37). */
  readonly text: TextOutliner;
  /** The geometry of the sketch over GeometryService (createRemoteSketchGeometry, N68). */
  readonly geometry: SketchGeometry;
  /** Downloads an exported file. */
  readonly download: (file: DownloadFile) => void;
  /** The theme at the start: the first value of defaultBodyColor; later viewSettings.setTheme. */
  readonly theme: 'light' | 'dark';
  /** Tessellation of the meshes of the session; absent = the server default. */
  readonly meshQuality?: MeshQuality;
  /** Repeating retryable calls; default the one of RemoteSession (5 attempts). */
  readonly retry?: RetryPolicy;
}

/**
 * Opens a session of the document `docId` on the core and wires an AppSession over it. Rejects
 * with RemoteError when the core does not open the session; a failure of the wiring closes the
 * session again and rejects with it. The tab is read-only when the session is not writable
 * (another tab holds the document, Q102).
 */
export async function createRemoteAppSession(deps: RemoteAppSessionDeps): Promise<AppSession> {
  const meshes = createVersionMeshes();
  const inFlight = trackKnownMeshes(deps.transport);
  // The open feature dialog, read when each request is sent: its feature is input_of
  // (ADR 0025). Set once the editor exists.
  let dialogFeature: () => FeatureId | null = () => null;
  const session = await openRemoteSession({
    transport: inFlight.transport,
    docId: deps.docId,
    ...(deps.meshQuality === undefined ? {} : { meshQuality: deps.meshQuality }),
    ...(deps.retry === undefined ? {} : { retry: deps.retry }),
    newOperationId: deps.newOperationId,
    readOptions: () => ({ knownMeshes: meshes.versions(), inputOf: dialogFeature() }),
    resume: deps.resume,
    timers: deps.timers,
  });
  const lifetime = new DisposableStore();
  try {
    await abortForeignTransaction(session);
    return wireRemoteSession(deps, session, {
      // N93: the meshes a request in flight says it has stay until its answer is there.
      meshes: retainingInFlight(meshes, () => inFlight.versions()),
      setDialogFeature: (read) => {
        dialogFeature = read;
      },
      lifetime,
    });
  } catch (e) {
    lifetime.dispose();
    session.close().catch(reportError);
    session.dispose();
    throw e;
  }
}

/**
 * A session resumed after a reload whose CloseSession got lost (N70) still has the transaction of
 * a dialog of the page before; this page has no such dialog, so the transaction is aborted before
 * anything is wired (its steps are not in the document then). NO_TRANSACTION (it ended meanwhile)
 * is fine; any other failure rejects.
 */
async function abortForeignTransaction(session: RemoteSession): Promise<void> {
  const { writable, transactionLabel } = session.readModel.get().session;
  if (!writable || transactionLabel === null) return;
  const outcome = await session.change({ kind: 'abort' });
  if (!outcome.ok && outcome.error.reason !== 'NO_TRANSACTION') throw outcome.error;
}

function wireRemoteSession(
  deps: RemoteAppSessionDeps,
  session: RemoteSession,
  parts: {
    readonly meshes: VersionMeshes;
    readonly setDialogFeature: (read: () => FeatureId | null) => void;
    readonly lifetime: DisposableStore;
  },
): AppSession {
  const { viewport } = deps;
  const { lifetime } = parts;
  const registries = createRemoteRegistries(session.featureTypes, deps.plugins);
  const {
    schemas,
    tools: toolRegistry,
    manipulators: manipulatorRegistry,
    handlers,
    messages,
  } = registries;
  // Q102: the core decides who writes; the second tab of a document is read-only.
  const readOnly = !session.readModel.get().session.writable;

  // 1. The document: the mirror of the read model, changed by the remote dispatcher only.
  const doc = new MirrorDocument(session.readModel.get().document);
  const connection = lifetime.add(createConnectionState({ session, reportError }));
  const remote = createRemoteDispatcher({
    mirror: doc,
    session,
    handlers,
    now: deps.now,
    onError: (error: RemoteError) => {
      // N92: a change dropped for the outage makes saving 'failed' while offline.
      connection.changeDropped(error);
      reportError(error);
    },
    onLost: () => {
      // The transaction died on the server (spec 14): the dialog and the sketcher close; their
      // transaction is a no-op now, so cancel sends nothing.
      features.current.get()?.cancel();
      reportError(new Error('The open transaction ended on the server; the dialog was closed'));
    },
  });
  lifetime.add(remote.undo);
  // Q038, Q102: everything that changes the document goes through `ops`, undo and redo too.
  const ops = readOnly ? refuseChanges(remote) : remote;
  const undo = readOnly ? refuseUndo(remote.undo) : remote.undo;

  // 2. The view of the read model is the RegenStatusPort; the dialog and the sketch session it
  // follows exist only after it, so it follows these two values, fed from them below.
  const dialog = new ObservableValue<{ readonly featureId: FeatureId } | null>(null);
  const sketching = new ObservableValue<{ readonly featureId: FeatureId } | null>(null);
  const view = lifetime.add(
    createReadModelView({
      meshes: parts.meshes,
      viewport,
      features: { current: dialog.asObservable() },
      sketches: { current: sketching.asObservable() },
      pending: session.pending,
      afterSync: () => {
        browserView.reapply();
      },
      reportError,
    }),
  );
  const regenStatus = view;

  // 3. Services and models, as wireSession.
  const selection = lifetime.add(createSelectionModel({ regen: regenStatus }));
  const features = createFeatureEditor({
    doc,
    ops,
    schemas,
    ids: deps.ids,
    translate: deps.translate,
    regen: regenStatus,
  });
  parts.setDialogFeature(() => features.current.get()?.featureId ?? null);
  lifetime.add(bindSelectionHighlight(selection, viewport.highlight, features, regenStatus));
  const sketches = createSketchEditor({
    features,
    solver: deps.solver,
    geometry: deps.geometry,
    text: deps.text,
    viewport,
    resolvePlane: (ref) => view.resolvePlane(ref),
    planeOfSketch: (id) => view.planeOfSketch(id),
    gridStep: () => viewport.sketchGridStep(),
  });
  const { mode } = sketches;
  const sketchEdit = (id: FeatureId): void => {
    sketches.edit(id);
  };
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
  const manipulators = lifetime.add(
    createManipulatorController({
      features,
      regen: regenStatus,
      registry: manipulatorRegistry,
      viewport,
    }),
  );
  const refPick = lifetime.add(
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
      contributions: [SKETCH_TOOLBAR],
    }),
  );
  const topoInspector = lifetime.add(createTopoInspector({ viewport, regen: regenStatus }));

  // 4. The view follows the dialog and the sketch session. Opening or closing a dialog asks for
  // the read model again: with input_of of the open feature, or without it (ADR 0025).
  lifetime.add(
    features.current.subscribe(() => {
      const featureId = features.current.get()?.featureId ?? null;
      if (featureId === (dialog.get()?.featureId ?? null)) return;
      dialog.set(featureId === null ? null : { featureId });
      session.refresh().catch(noteFailure);
    }),
  );
  lifetime.add(
    sketches.current.subscribe(() => {
      const current = sketches.current.get();
      sketching.set(current === null ? null : { featureId: current.featureId });
    }),
  );
  // Entering a sketch and moving its plane (M21): look at it straight on.
  let offSketchPlane: Unsubscribe | null = null;
  lifetime.add(() => {
    offSketchPlane?.();
  });
  lifetime.add(
    sketches.current.subscribe(() => {
      offSketchPlane?.();
      offSketchPlane = null;
      const current = sketches.current.get();
      if (current === null) return;
      const look = (): void => {
        viewport.camera.setViewDirection(current.plane.get().normal);
      };
      offSketchPlane = current.plane.subscribe(look);
      look();
    }),
  );

  // 5. Visibility, colours and materials of bodies, planes and axes.
  const browserView = lifetime.add(bindBrowserView(browser, viewport));

  // 6. Edit history and export from the server.
  const historyLog = lifetime.add(new RemoteHistory(session));
  const history = lifetime.add(createHistoryModel({ log: historyLog }));
  const documentName = lifetime.add(createDocumentNameModel({ doc, ops, locked }));
  const exporter = createRemoteFileExporter({
    session,
    documents: createRemoteDocuments(deps.transport, deps.newOperationId),
    docId: deps.docId,
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
  const { viewSettings, defaultBodyColor } = createViewSettings(viewport, deps.theme);

  function noteFailure(error: unknown): void {
    connection.noteError(error);
    reportError(error);
  }

  // 7. Every read model of the session goes to the view, the first one now.
  lifetime.add(
    session.readModel.subscribe(() => {
      view.show(session.readModel.get());
    }),
  );
  view.show(session.readModel.get());

  let disposed = false;
  /** Releases the models once; false when they already were (dispose during a close). */
  function releaseModels(): boolean {
    if (disposed) return false;
    disposed = true;
    lifetime.dispose();
    return true;
  }

  function dispose(): void {
    if (!releaseModels()) return;
    // Best effort, not awaited: the server releases the lock (N70).
    session.close().catch(reportError);
    session.dispose();
  }

  async function close(): Promise<void> {
    if (disposed) return;
    let failure: { readonly error: unknown } | null = null;
    try {
      await flush();
    } catch (error) {
      failure = { error };
    }
    // A dispose while the flush ran has closed the session already.
    if (releaseModels()) {
      try {
        await session.close();
      } catch (error) {
        failure ??= { error };
      } finally {
        session.dispose();
      }
    }
    if (failure !== null) throw failure.error;
  }
  let closing: Promise<void> | null = null;

  /** Waits for the empty queue; rejects when changes were given up for an outage (N92). */
  async function flush(): Promise<void> {
    await queueEmpty(session);
    if (connection.persistence.get() === 'failed') {
      throw new Error(
        `Changes were not saved: the core is unreachable (${connection.persistenceError.get() ?? 'offline'})`,
      );
    }
  }

  const viewPort: AppSession['view'] = {
    project(world) {
      return viewport.project(world);
    },
    onViewChanged(listener) {
      return viewport.events.on('viewChanged', () => {
        listener();
      });
    },
  };

  return {
    doc,
    readOnly,
    locked,
    regen: view.ui,
    kernel: connection.kernel,
    kernelError: connection.kernelError,
    retryKernel() {
      connection.retryKernel();
    },
    persistence: connection.persistence,
    persistenceError: connection.persistenceError,
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
        return viewPort.project(world);
      },
      onViewChanged(listener) {
        return viewPort.onViewChanged(listener);
      },
    },
    view: viewPort,
    mountViewport(el) {
      viewport.mount(el);
    },
    viewSettings,
    flush,
    close() {
      closing ??= close();
      return closing;
    },
    dispose,
  };
}

/** Resolves once no change of the session is queued or in flight. */
function queueEmpty(session: Pick<RemoteSession, 'pending'>): Promise<void> {
  const { pending } = session;
  if (pending.get() === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const off = pending.subscribe(() => {
      if (pending.get() !== 0) return;
      off();
      resolve();
    });
  });
}

/** Undo of a read-only tab: nothing to undo or redo, both refuse (Q038). */
function refuseUndo(inner: UndoManager): UndoManager {
  const refuse = (): never => {
    throw new Error('The document is open read-only (open in another tab)');
  };
  return {
    canUndo: () => false,
    canRedo: () => false,
    stacks: () => inner.stacks(),
    undo: refuse,
    redo: refuse,
    events: inner.events,
    dispose: () => undefined,
  };
}

/**
 * The transport of the session with the known_meshes of every call in flight (N93): a call that
 * says it holds a mesh gets its body without the mesh, so retain must keep it until the call
 * settled. Read from the request message, so every attempt of a retried call counts by itself.
 */
function trackKnownMeshes(inner: Transport): {
  readonly transport: Transport;
  versions(): Iterable<string>;
} {
  const calls = new Set<readonly string[]>();
  return {
    transport: {
      unary(method, signal, timeoutMs, header, input, contextValues) {
        const known = knownMeshesOf(input);
        if (known.length === 0) {
          return inner.unary(method, signal, timeoutMs, header, input, contextValues);
        }
        calls.add(known);
        return inner.unary(method, signal, timeoutMs, header, input, contextValues).finally(() => {
          calls.delete(known);
        });
      },
      stream(method, signal, timeoutMs, header, input, contextValues) {
        return inner.stream(method, signal, timeoutMs, header, input, contextValues);
      },
    },
    *versions() {
      for (const known of calls) yield* known;
    },
  };
}

/** ReadModelOptions.known_meshes of a request that has `read`; [] for any other. */
function knownMeshesOf(input: unknown): readonly string[] {
  if (typeof input !== 'object' || input === null || !('read' in input)) return [];
  const { read } = input;
  if (typeof read !== 'object' || read === null || !('knownMeshes' in read)) return [];
  const { knownMeshes } = read;
  return Array.isArray(knownMeshes)
    ? knownMeshes.filter((v): v is string => typeof v === 'string')
    : [];
}

/** `meshes` whose retain also keeps the versions of `inFlight` (N93). */
function retainingInFlight(meshes: VersionMeshes, inFlight: () => Iterable<string>): VersionMeshes {
  return {
    put: (version, mesh) => {
      meshes.put(version, mesh);
    },
    handleOf: (version) => meshes.handleOf(version),
    retain: (versions) => {
      meshes.retain([...versions, ...inFlight()]);
    },
    versions: () => meshes.versions(),
    tessellate: (shape, quality) => meshes.tessellate(shape, quality),
  };
}

/** Errors with nobody to hand them to (a refused change, a failed refresh, a lost transaction). */
function reportError(error: unknown): void {
  console.error(error);
}
