// The read model → the ports of the view (D3 of M19.1
// kept): meshes into VersionMeshes, viewport.syncLayers, then RegenStatusPort, the drawings of the
// sketches, RegenUiState, afterSync and the first fitAll; resolvePlane and planeOfSketch for the
// sketcher. Every body is shown under the handle of its content_version (N66), so the view swaps
// exactly the meshes whose version changed. While a feature dialog is open (ADR 0025) and the read
// model carries the input of its feature, the main layer shows the input and the preview what the
// feature made or changed (previewBodies).

import { ObservableValue } from '@/core';
import type { Disposable, Observable, Plane } from '@/core';
import type { BodyId, FeatureId, PlaneRef, TopoName, TopoRef } from '@/document';
import type {
  FeatureAnchors,
  FeatureHealth,
  RegenBody,
  RegenSketch,
  RegenSnapshot,
  RegenStatusPort,
  SketchPort,
  TopoNames,
} from '@/interaction';
import type {
  BodyData,
  FeatureStatusData,
  ReadModelData,
  SketchViewData,
  StateData,
} from '@/remote';
import { parseSketchData } from '@/sketch';
import { artifactDrawing } from '@/sketcher';
import type { ShapeHandle } from '@/kernel';
import type { BodyLayer, CameraController, Viewport } from '@/render';
import type { RegenUiState } from './app-session';
import type { VersionMeshes } from './version-meshes';

export interface ReadModelViewDeps {
  readonly meshes: VersionMeshes;
  readonly viewport: {
    readonly bodies: Pick<BodyLayer, 'reset'>;
    /** M21: the pickable bodies and the result of the edited feature over them, in one swap. */
    readonly syncLayers: Viewport['syncLayers'];
    readonly camera: Pick<CameraController, 'fitAll'>;
    readonly sketches: SketchPort;
  };
  /** The open feature dialog: with one the view shows the input of its feature (ADR 0025). */
  readonly features: { readonly current: Observable<{ readonly featureId: FeatureId } | null> };
  /** The open sketch session: its sketch is drawn by the sketcher, not by the view. */
  readonly sketches: { readonly current: Observable<{ readonly featureId: FeatureId } | null> };
  /** Changes queued and in flight (RemoteSession.pending): RegenUiState.busy. */
  readonly pending: Observable<number>;
  readonly afterSync: () => void;
  readonly reportError: (error: unknown) => void;
}

export interface ReadModelView extends RegenStatusPort, Disposable {
  readonly ui: Observable<RegenUiState>;
  /** A new read model; one of an older generation than the shown one is dropped. */
  show(readModel: ReadModelData): void;
  /** A plane of the final state by id, or the plane of a planar face of a body (facePlanes). */
  resolvePlane(ref: PlaneRef | TopoRef): Plane | undefined;
  /** The plane of the sketch of a feature in the final state. */
  planeOfSketch(featureId: FeatureId): Plane | undefined;
}

/** A body as the body layers take it. */
export type ShownBody = { readonly id: BodyId; readonly shape: ShapeHandle };

/**
 * The preview of an edited feature (ADR 0025): the bodies of the result that the input does not
 * have with the same id and handle, that is what the feature made or changed, in the order of the
 * result. A body the feature consumed is not in the result, so it is not previewed.
 */
export function previewBodies(
  result: readonly ShownBody[],
  input: readonly ShownBody[],
): ShownBody[] {
  const inInput = new Map(input.map((b) => [b.id, b.shape]));
  return result.filter((b) => inInput.get(b.id) !== b.shape);
}

const EMPTY_SNAPSHOT: RegenSnapshot = Object.freeze({
  generation: 0,
  health: new Map<FeatureId, FeatureHealth>(),
  bodies: Object.freeze([]),
  sketches: Object.freeze([]),
  anchors: new Map<FeatureId, FeatureAnchors>(),
  pick: Object.freeze({ feature: null, bodies: Object.freeze([]) }),
});

/**
 * The view over `deps.viewport`: hands it `deps.meshes` once (bodies.reset), then shows every
 * read model given to show(). A newer read model makes the sync of an older one stale, so only
 * the last one publishes (D3 of M19.1).
 */
export function createReadModelView(deps: ReadModelViewDeps): ReadModelView {
  const { meshes, viewport, reportError } = deps;
  let disposed = false;
  /** The last read model show() accepted; its generation is the floor for the next one. */
  let latest: ReadModelData | null = null;
  /** The read model of the last published snapshot: the planes of the sketcher come from it. */
  let published: ReadModelData | null = null;
  /** Counts the syncs; one that settles behind a newer one publishes nothing. */
  let syncCount = 0;
  /** The first published read model decided the first view (D7 of M19.2). */
  let fitted = false;
  const names = new WeakMap<BodyData, TopoNames>();
  const namesOf = (body: BodyData): TopoNames => {
    let table = names.get(body);
    if (table === undefined) {
      table = topoNamesOf(body);
      names.set(body, table);
    }
    return table;
  };
  const drawings = createSketchDrawings(viewport.sketches, reportError);

  const state = new ObservableValue<RegenSnapshot>(EMPTY_SNAPSHOT);
  const ui = new ObservableValue<RegenUiState>(
    Object.freeze({ busy: deps.pending.get() > 0, bodyCount: 0, lastMs: null, failed: null }),
  );
  const updateUi = (change: Partial<RegenUiState>): void => {
    ui.set(Object.freeze({ ...ui.get(), ...change }));
  };

  try {
    // render keeps this MeshOps for the lifetime of the tab: a handle names a version (N66).
    viewport.bodies.reset(meshes);
  } catch (e) {
    reportError(e);
  }

  const offPending = deps.pending.subscribe(() => {
    updateUi({ busy: deps.pending.get() > 0 });
  });
  const edited = (): FeatureId | undefined => deps.sketches.current.get()?.featureId;
  const offEdited = deps.sketches.current.subscribe(() => {
    if (!disposed) drawings.draw(edited());
  });
  // ADR 0025: closing a dialog shows the final state of the shown read model at once; opening one
  // waits for the read model with its input (app refreshes with input_of).
  const offDialog = deps.features.current.subscribe(() => {
    if (!disposed && latest !== null) render(latest);
  });

  /** The input the main layer shows: of the open dialog's feature, when the read model has it. */
  function shownInput(readModel: ReadModelData): ReadModelData['regen']['input'] {
    const { input } = readModel.regen;
    const dialog = deps.features.current.get();
    return input !== null && dialog?.featureId === input.featureId ? input : null;
  }

  function render(readModel: ReadModelData): void {
    const { final, input } = readModel.regen;
    // (1) The meshes the read model brings; a body without one has a version the client holds.
    putMeshes(final);
    if (input !== null) putMeshes(input.state);
    // (2) Both layers in one swap.
    const result = shownBodiesOf(final);
    const shown = shownInput(readModel);
    const layers =
      shown === null
        ? { main: result, preview: [] }
        : (() => {
            const main = shownBodiesOf(shown.state);
            return { main, preview: previewBodies(result, main) };
          })();
    syncCount += 1;
    const sync = syncCount;
    let synced: Promise<void>;
    try {
      synced = viewport.syncLayers(layers);
    } catch (e) {
      reportError(e);
      return;
    }
    synced.then(
      () => {
        // (3)–(6) only for the newest sync: a stale one swapped nothing.
        if (!disposed && sync === syncCount) publish(readModel, shown);
      },
      (e: unknown) => {
        reportError(e);
      },
    );
  }

  function putMeshes(state: StateData): void {
    for (const body of state.bodies) {
      if (body.mesh !== null) meshes.put(body.contentVersion, body.mesh);
    }
  }

  function shownBodiesOf(state: StateData): ShownBody[] {
    return state.bodies.map((b) => ({ id: b.id, shape: meshes.handleOf(b.contentVersion) }));
  }

  function publish(readModel: ReadModelData, shown: ReadModelData['regen']['input']): void {
    const { regen } = readModel;
    published = readModel;
    // A subscriber that throws does not stop the step; its error is reported after it.
    let subscriberError: { readonly error: unknown } | null = null;
    try {
      state.set(snapshotOf(readModel, shown, state.get().generation + 1, namesOf));
    } catch (error) {
      subscriberError = { error };
    }
    try {
      // A subscriber may have disposed the view meanwhile: then the viewport is left alone.
      drawings.received(regen.final.sketches);
      if (!disposed) drawings.draw(edited());
      updateUi({ bodyCount: regen.final.bodies.length, lastMs: regen.durationMs, failed: null });
      if (!disposed) deps.afterSync();
      fitFirstView(regen.final.bodies.length);
    } finally {
      // (6) The meshes of the versions of this read model stay, the rest goes.
      meshes.retain(versionsOf(readModel));
      if (subscriberError !== null) reportError(subscriberError.error);
    }
  }

  // First view (spec 11, D7 of M19.2): the first published read model decides; later ones leave
  // the camera where the user put it.
  function fitFirstView(bodyCount: number): void {
    if (disposed || fitted) return;
    fitted = true;
    if (bodyCount > 0) viewport.camera.fitAll();
  }

  return {
    state: state.asObservable(),
    ui: ui.asObservable(),
    show(readModel) {
      if (disposed) return;
      if (latest !== null && readModel.regen.generation < latest.regen.generation) return;
      latest = readModel;
      render(readModel);
    },
    resolvePlane(ref) {
      const final = published?.regen.final;
      if (final === undefined) return undefined;
      if (ref.kind === 'plane') return final.planes.find((p) => p.id === ref.plane)?.plane;
      const body = final.bodies.find((b) => b.id === ref.body);
      if (body === undefined) return undefined;
      // The face with the smallest index of the name, as regen's planeOfRef.
      const [index] = namesOf(body).faces(ref.name);
      return index === undefined ? undefined : body.facePlanes.get(index);
    },
    planeOfSketch(featureId) {
      return published?.regen.final.sketches.find((s) => s.featureId === featureId)?.plane;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offPending();
      offEdited();
      offDialog();
    },
  };
}

/** The content versions of every body of the read model, of the input too. */
function versionsOf(readModel: ReadModelData): string[] {
  const { final, input } = readModel.regen;
  return [...final.bodies, ...(input?.state.bodies ?? [])].map((b) => b.contentVersion);
}

/** The snapshot of the port, as regen-status-adapter makes it from a RegenResult. */
function snapshotOf(
  readModel: ReadModelData,
  shown: ReadModelData['regen']['input'],
  generation: number,
  namesOf: (body: BodyData) => TopoNames,
): RegenSnapshot {
  const { regen } = readModel;
  // A new map every time; nobody changes it after (spec 10).
  const health = new Map<FeatureId, FeatureHealth>();
  for (const [id, status] of regen.statuses) {
    const h = toHealth(status);
    if (h !== undefined) health.set(id, h);
  }
  const bodiesOf = (state: StateData): readonly RegenBody[] =>
    Object.freeze(
      state.bodies.map((b) => Object.freeze({ body: b.id, feature: b.origin, names: namesOf(b) })),
    );
  const bodies = bodiesOf(regen.final);
  const sketches: readonly RegenSketch[] = Object.freeze(
    regen.final.sketches.map((s) =>
      Object.freeze({
        sketch: s.sketchId,
        feature: s.featureId,
        regions: Object.freeze(s.regions.map((r) => r.name)),
      }),
    ),
  );
  return Object.freeze({
    generation,
    health,
    bodies,
    sketches,
    // The anchors of the read model are frozen and fit the ones of interaction structurally.
    anchors: new Map<FeatureId, FeatureAnchors>(regen.anchors),
    pick:
      shown === null
        ? Object.freeze({ feature: null, bodies })
        : Object.freeze({ feature: shown.featureId, bodies: bodiesOf(shown.state) }),
  });
}

/** Health of an evaluated feature; suppressed and rolled back ones have none. */
function toHealth(status: FeatureStatusData): FeatureHealth | undefined {
  switch (status.kind) {
    case 'ok':
      return OK;
    case 'warning':
      return Object.freeze({ kind: 'warning', message: status.message });
    case 'error': {
      const { message, issues } = status.error;
      return Object.freeze(
        issues === undefined ? { kind: 'error', message } : { kind: 'error', message, issues },
      );
    }
    case 'suppressed':
    case 'rolledBack':
      return undefined;
  }
}

const OK: FeatureHealth = Object.freeze({ kind: 'ok' });
const NO_INDICES: readonly number[] = Object.freeze([]);

/**
 * The TopoNames of a body of the read model: faceNames[i] / edgeNames[i] is the primary name of
 * the face / edge with index i (spec 14), '' = no name. A face with more names is found only by
 * its primary one (spec 14 "Jména ploch a hran").
 */
function topoNamesOf(body: Pick<BodyData, 'faceNames' | 'edgeNames'>): TopoNames {
  const faces = indicesByName(body.faceNames);
  const edges = indicesByName(body.edgeNames);
  const nameAt = (list: readonly string[], index: number): TopoName | undefined => {
    const name = list[index];
    // The names of the NameTable of the server (spec 08), so the brand holds.
    return name === undefined || name === '' ? undefined : (name as TopoName);
  };
  return Object.freeze({
    nameOfFace: (index: number) => nameAt(body.faceNames, index),
    nameOfEdge: (index: number) => nameAt(body.edgeNames, index),
    faces: (name: TopoName) => faces.get(name) ?? NO_INDICES,
    edges: (name: TopoName) => edges.get(name) ?? NO_INDICES,
  });
}

/** Name → its ascending indices; '' (no name) is left out. */
function indicesByName(names: readonly string[]): ReadonlyMap<string, readonly number[]> {
  const out = new Map<string, number[]>();
  names.forEach((name, index) => {
    if (name === '') return;
    const list = out.get(name);
    if (list === undefined) out.set(name, [index]);
    else list.push(index);
  });
  for (const list of out.values()) Object.freeze(list);
  return out;
}

/**
 * The drawings of the sketches of the read model in the view (spec 11, "Skicář"): every sketch of
 * the last published read model under its id except the edited one, which the sketcher draws.
 */
function createSketchDrawings(
  port: SketchPort,
  reportError: (error: unknown) => void,
): {
  /** The sketches of a newly published read model, drawn by the next draw. */
  received(sketches: readonly SketchViewData[]): void;
  /** Draws the sketches of the last read model but the edited one; removes the rest. */
  draw(edited: FeatureId | undefined): void;
} {
  let last: readonly SketchViewData[] = [];
  /** What the view shows per sketch id, so the same sketch is not drawn again. */
  const drawn = new Map<string, SketchViewData>();
  function draw(edited: FeatureId | undefined): void {
    const shown = new Set<string>();
    for (const sketch of last) {
      if (sketch.featureId === edited) continue;
      shown.add(sketch.sketchId);
      if (drawn.get(sketch.sketchId) === sketch) continue;
      // The entities of the read model are unchecked JSON of spec 12: parsed, so the drawing gets
      // typed entities; a sketch the client cannot read is reported, not drawn.
      const parsed = parseSketchData(sketch.entities, []);
      if (!parsed.ok) {
        reportError(
          new Error(`Sketch '${sketch.sketchId}' of the read model has invalid entities`),
        );
        continue;
      }
      drawn.set(sketch.sketchId, sketch);
      port.set(
        sketch.sketchId,
        artifactDrawing(sketch.plane, parsed.value.entities, sketch.regions),
      );
    }
    for (const id of [...drawn.keys()]) {
      if (shown.has(id)) continue;
      drawn.delete(id);
      port.remove(id);
    }
  }
  return {
    received(sketches) {
      last = sketches;
    },
    draw,
  };
}
