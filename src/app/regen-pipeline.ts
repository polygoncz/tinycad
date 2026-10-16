// The regeneration of a session (spec 11, "Krok regenerace"): from the scheduler to the publishing
// of the result. One run regenerates the studio with the Regenerator of the live kernel, waits
// until the view shows the new bodies and only then publishes the result (D3 of M19.1), draws the
// sketches of the regeneration, updates RegenUiState, applies the view state of the bodies again
// and decides the first view (D7 of M19.2). While a feature dialog is open (M21, ADR 0025) the
// view shows the input of the edited feature and its result as a transparent preview.

import { ObservableValue, RpcError } from '@/core';
import type { Disposable, Observable } from '@/core';
import type { BodyId, FeatureId, PartStudioData } from '@/document';
import type { SketchPort } from '@/interaction';
import type { MeshOps, ShapeHandle } from '@/kernel';
import { bodiesOf, EMPTY_STATE, sketchesOf } from '@/regen';
import type { Regenerator, RegenState, SketchArtifact } from '@/regen';
import { artifactDrawing } from '@/sketcher';
import type { BodyLayer, CameraController, Viewport } from '@/render';
import type { KernelSupervisor } from './kernel-supervisor';
import { createRegenScheduler } from './regen-scheduler';
import type { RegenStatusAdapter } from './regen-status-adapter';

export type RegenUiState = {
  /** A regeneration is running or due. */
  readonly busy: boolean;
  /** Bodies of the last finished regeneration. */
  readonly bodyCount: number;
  /** Duration of the last finished regeneration; null before the first. */
  readonly lastMs: number | null;
  /**
   * M19.1: text of the error of the last regeneration that threw (a bug, not a lost kernel);
   * null before the first such error and after a successful regeneration.
   */
  readonly failed: string | null;
};

export interface RegenPipelineDeps {
  /** The studio to regenerate, read at the start of every run. */
  readonly doc: { readonly studio: PartStudioData };
  /** The Regenerator of the live kernel and the report of its loss (KernelSupervisor). */
  readonly kernel: Pick<KernelSupervisor, 'regenerator' | 'lost'>;
  readonly viewport: {
    readonly bodies: Pick<BodyLayer, 'reset'>;
    /** M21: the pickable bodies and the result of the edited feature over them, in one swap. */
    readonly syncLayers: Viewport['syncLayers'];
    readonly camera: Pick<CameraController, 'fitAll'>;
    readonly sketches: SketchPort;
  };
  /** The port of interaction; gets the result once the view shows its bodies. */
  readonly regenStatus: Pick<RegenStatusAdapter, 'publish'>;
  /**
   * The open feature dialog (M21, ADR 0025): with one the run asks for the input of its feature,
   * which the view and the picking show; opening and closing it requests a run.
   */
  readonly features: { readonly current: Observable<{ readonly featureId: FeatureId } | null> };
  /** The open sketch session: its sketch is drawn by the sketcher, not by the regeneration. */
  readonly sketches: { readonly current: Observable<{ readonly featureId: FeatureId } | null> };
  /**
   * After every published result: the view state of the bodies (visibility, colours) applied
   * again, because the bodies new to the view start visible and in the palette colour.
   */
  readonly afterSync: () => void;
  /** Errors with nobody to hand them to (a regeneration bug, a failing subscriber). */
  readonly reportError: (error: unknown) => void;
}

export interface RegenPipeline extends Disposable {
  readonly state: Observable<RegenUiState>;
  /** The scheduler is running or due (the STEP export waits for false). */
  readonly busy: Observable<boolean>;
  /**
   * The final state of the last published regeneration, also with a dialog open (not its input);
   * EMPTY_STATE before it and after kernelReady.
   */
  lastState(): RegenState;
  /** The document changed: a run starts, or one more after the running one. */
  request(): void;
  /**
   * A new kernel is ready (start, restart): forgets the last state, hands the kernel to the
   * view and requests a run. A new kernel numbers its handles anew, so no handle of the old one
   * may reach it, through the last state (the STEP export) or the meshes of the view (spec 09).
   * An error goes to reportError.
   */
  kernelReady(kernel: MeshOps): void;
}

export function createRegenPipeline(deps: RegenPipelineDeps): RegenPipeline {
  const { doc, kernel, viewport, regenStatus, reportError } = deps;
  let disposed = false;
  let lastState: RegenState = EMPTY_STATE;
  /** The first finished regeneration decided the first view (D7 of M19.2). */
  let fitted = false;
  const sketchDrawings = createSketchDrawings(viewport.sketches);

  const ui = new ObservableValue<RegenUiState>(
    Object.freeze({ busy: false, bodyCount: 0, lastMs: null, failed: null }),
  );
  const updateUi = (change: Partial<RegenUiState>): void => {
    ui.set(Object.freeze({ ...ui.get(), ...change }));
  };

  const scheduler = createRegenScheduler({ run: regenerate, onError: reportError });
  const offBusy = scheduler.busy.subscribe(() => {
    updateUi({ busy: scheduler.busy.get() });
  });
  const edited = (): FeatureId | undefined => deps.sketches.current.get()?.featureId;
  const offEdited = deps.sketches.current.subscribe(() => {
    if (!disposed) sketchDrawings.draw(edited());
  });
  // M21: the layers switch between the input and the final state even when the document does not
  // change. Opening an edit also moves the bar; the scheduler then runs once more at most.
  const offDialog = deps.features.current.subscribe(() => {
    scheduler.request();
  });

  /** One run of the scheduler: a regeneration with the Regenerator of the live kernel. */
  async function regenerate(): Promise<void> {
    const regenerator = kernel.regenerator();
    // No kernel (starting, restarting, failed): kernelReady requests a run once there is one.
    if (regenerator === null) return;
    try {
      await regenerateWith(regenerator);
    } catch (e) {
      // Q049: the Regenerator is dead with its kernel; the supervisor starts a new pair.
      if (e instanceof RpcError && e.code === 'disconnected') {
        kernel.lost(regenerator);
        return;
      }
      // M19.1: shown in the UI, so the model does not stay stale silently; reported as well.
      if (!disposed) updateUi({ failed: errorText(e) });
      throw e;
    }
  }

  /** The pipeline lives and `regenerator` is still the one of the live kernel. */
  function isCurrent(regenerator: Regenerator): boolean {
    return !disposed && kernel.regenerator() === regenerator;
  }

  /**
   * D3 (M19.1): the result is published only once the view shows its bodies, so an index picked
   * in the view and the names in the port belong to the same generation (revize C6). The
   * scheduler runs one regeneration at a time and this one includes the tessellation, so a stale
   * result neither publishes a snapshot nor sends a tessellation.
   */
  async function regenerateWith(regenerator: Regenerator): Promise<void> {
    const inputOf = deps.features.current.get()?.featureId;
    const result = await regenerator.run(
      doc.studio,
      inputOf === undefined ? undefined : { inputOf },
    );
    // Also when the kernel died after its last call: the next kernel numbers its handles anew, so
    // these must not reach its view.
    if (result === 'superseded' || !isCurrent(regenerator)) return;
    // Only bodies go to the counter and the body layers; sketches have their own channel
    // (ViewportPort.sketches, ADR 0015).
    const bodies = shownBodies(result.finalState);
    // ADR 0025: with the input of the edited feature the main layer shows the input and the
    // preview what the feature made or changed; otherwise the final state and no preview. Both
    // layers swap together (D3 of M19.1), so no index of a new mesh is read with the names of the
    // old snapshot, and closing the dialog moves the previewed meshes to the main layer without
    // tessellating them again. Never rejects; settles once swapped or stale (spec 09).
    if (result.input === null) {
      await viewport.syncLayers({ main: bodies, preview: [] });
    } else {
      const input = shownBodies(result.input.state);
      await viewport.syncLayers({ main: input, preview: previewBodies(bodies, input) });
    }
    // A restart meanwhile reset the view (kernelReady): the result belongs to a dead kernel.
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
      // A subscriber may have disposed the session meanwhile: then the view is left alone.
      sketchDrawings.regenerated(sketchesOf(result.finalState));
      if (!disposed) sketchDrawings.draw(edited());
      updateUi({ bodyCount: bodies.length, lastMs: result.durationMs, failed: null });
      if (!disposed) deps.afterSync();
      fitFirstView(bodies.length);
    } finally {
      if (subscriberError !== null) reportError(subscriberError.error);
    }
  }

  // First view (spec 11, D7 of M19.2): the first finished regeneration after opening decides. It
  // fits the camera when the document has bodies; either way later regenerations (new bodies, a
  // kernel restart) leave the camera where the user put it. A regeneration that throws never
  // gets here, so the next successful one decides.
  function fitFirstView(bodyCount: number): void {
    if (disposed || fitted) return;
    fitted = true;
    if (bodyCount > 0) viewport.camera.fitAll();
  }

  return {
    state: ui.asObservable(),
    busy: scheduler.busy,
    lastState: () => lastState,
    request() {
      scheduler.request();
    },
    kernelReady(meshes) {
      try {
        lastState = EMPTY_STATE;
        viewport.bodies.reset(meshes);
        scheduler.request();
      } catch (e) {
        reportError(e);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scheduler.dispose();
      offBusy();
      offEdited();
      offDialog();
    },
  };
}

/** A body as the body layers take it. */
export type ShownBody = { readonly id: BodyId; readonly shape: ShapeHandle };

/** The bodies of a state as the body layers take them. */
function shownBodies(state: RegenState): ShownBody[] {
  return bodiesOf(state).map(({ id, shape }) => ({ id, shape }));
}

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

/**
 * The drawings of the regenerated sketches in the view (spec 11, "Skicář"): every sketch of the
 * last regeneration under its id except the edited one, which the sketcher draws.
 */
function createSketchDrawings(port: SketchPort): {
  /** The sketches of a new regeneration, drawn by the next draw. */
  regenerated(sketches: readonly SketchArtifact[]): void;
  /** Draws the sketches of the last regeneration but the edited one; removes the rest. */
  draw(edited: FeatureId | undefined): void;
} {
  let last: readonly SketchArtifact[] = [];
  /** What the view shows per sketch id, so an unchanged artifact is not drawn again. */
  const drawn = new Map<string, SketchArtifact>();
  function draw(edited: FeatureId | undefined): void {
    const shown = new Set<string>();
    for (const artifact of last) {
      if (artifact.owner === edited) continue;
      shown.add(artifact.id);
      // The regeneration keeps the artifact of an unchanged feature: no new drawing for it.
      if (drawn.get(artifact.id) === artifact) continue;
      drawn.set(artifact.id, artifact);
      port.set(artifact.id, artifactDrawing(artifact.plane, artifact.entities, artifact.outlines));
    }
    for (const id of [...drawn.keys()]) {
      if (shown.has(id)) continue;
      drawn.delete(id);
      port.remove(id);
    }
  }
  return {
    regenerated(sketches) {
      last = sketches;
    },
    draw,
  };
}

/** The text of an error for the UI (RegenUiState.failed). */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
