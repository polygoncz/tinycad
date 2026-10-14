// Test-only entry point of interaction: FakeViewport stands in for the render viewport,
// FakeRegenStatus for the regeneration state that app feeds in, FakeFileExporter for the
// export of app (M15).
// dependency-cruiser allows importing it only from *.test.ts.

import { Emitter, ObservableValue } from '@/core';
import type { Observable, Subscribable, Vec3 } from '@/core';
import type { BodyId, FeatureId, TopoName } from '@/document';
import type { FileExporter } from './file-actions';
import { NO_TOPO_NAMES } from './regen-status-port';
import type {
  FeatureAnchors,
  FeatureHealth,
  RegenBody,
  RegenSketch,
  RegenSnapshot,
  RegenStatusPort,
  TopoNames,
} from './regen-status-port';
import type {
  HandleView,
  HighlightPort,
  HighlightTarget,
  ManipulatorLabel,
  ManipulatorPort,
  OverlayPort,
  OverlayShape,
  PickFilter,
  PickResult,
  SketchDrawing,
  SketchPort,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportEvents,
  ViewportPort,
} from './viewport-port';

type Ray = ReturnType<ViewportPort['screenToRay']>;
type PickFn = (x: number, y: number) => PickResult | null;
type RayFn = (x: number, y: number) => Ray;
type HandlePickFn = (x: number, y: number) => string | null;

/** The filter of a pick called without one (spec 10, "Port viewportu"). */
const DEFAULT_FILTER: PickFilter = Object.freeze(['edge', 'face']);

/** Default ray: screen px map 1:1 to world XY, looking down -Z (a top view without y flip). */
const DEFAULT_RAY: RayFn = (x, y) => ({ origin: [x, y, 0] satisfies Vec3, direction: [0, 0, -1] });

/**
 * A ViewportPort for tests: preset pick results, a configurable screenToRay, recorded
 * highlight, overlay, sketch drawing and manipulator state (M18), a preset handle pick, and
 * manual emitting of pointer and key events. pick returns the preset result only when its kind is in the filter and records the filter.
 * The recorded state is replaced on every call, so a read snapshot never changes later.
 */
export class FakeViewport implements ViewportPort {
  readonly highlight: HighlightPort;
  readonly overlay: OverlayPort;
  readonly sketches: SketchPort;
  readonly manipulators: ManipulatorPort;
  private readonly emitter = new Emitter<ViewportEvents>();
  readonly events: Subscribable<ViewportEvents> = this.emitter;

  private pickFn: PickFn = () => null;
  private rayFn: RayFn = DEFAULT_RAY;
  private filterState: PickFilter | undefined = undefined;
  private hoverState: HighlightTarget | null = null;
  private selectionState: readonly HighlightTarget[] = [];
  private overlayState: ReadonlyMap<string, readonly OverlayShape[]> = new Map();
  private sketchState: ReadonlyMap<string, SketchDrawing> = new Map();
  private handlePickFn: HandlePickFn = () => null;
  private manipulatorViewState: readonly HandleView[] = Object.freeze([]);
  private manipulatorLabelState: ManipulatorLabel | null = null;

  constructor() {
    this.highlight = {
      setHover: (target) => {
        this.hoverState = target;
      },
      setSelection: (targets) => {
        this.selectionState = [...targets];
      },
    };
    this.overlay = {
      set: (id, shapes) => {
        this.overlayState = new Map(this.overlayState).set(id, [...shapes]);
      },
      remove: (id) => {
        if (!this.overlayState.has(id)) return;
        const next = new Map(this.overlayState);
        next.delete(id);
        this.overlayState = next;
      },
      clear: () => {
        this.overlayState = new Map();
      },
    };
    this.sketches = {
      set: (id, drawing) => {
        this.sketchState = new Map(this.sketchState).set(id, drawing);
      },
      remove: (id) => {
        if (!this.sketchState.has(id)) return;
        const next = new Map(this.sketchState);
        next.delete(id);
        this.sketchState = next;
      },
    };
    this.manipulators = {
      set: (handles) => {
        this.manipulatorViewState = Object.freeze([...handles]);
      },
      pick: (x, y) => this.handlePickFn(x, y),
      setLabel: (label) => {
        this.manipulatorLabelState = label;
      },
    };
  }

  /** A fixed result, or a function of the view coordinates. */
  setPick(result: PickResult | null | PickFn): void {
    this.pickFn = typeof result === 'function' ? result : () => result;
  }

  /** The result of manipulators.pick as a function of the view coordinates; default null (M18). */
  prepareHandlePick(fn: HandlePickFn): void {
    this.handlePickFn = fn;
  }

  setScreenToRay(fn: RayFn): void {
    this.rayFn = fn;
  }

  /** The preset result, or null when its kind is not in the filter. */
  pick(x: number, y: number, filter?: PickFilter): PickResult | null {
    this.filterState = filter === undefined ? undefined : Object.freeze([...filter]);
    const hit = this.pickFn(x, y);
    return hit !== null && (filter ?? DEFAULT_FILTER).includes(hit.kind) ? hit : null;
  }

  screenToRay(x: number, y: number): Ray {
    return this.rayFn(x, y);
  }

  /** Filter of the last pick call; undefined = called without one, or not called yet. */
  get lastFilter(): PickFilter | undefined {
    return this.filterState;
  }

  /** Last state passed to highlight.setHover. */
  get hover(): HighlightTarget | null {
    return this.hoverState;
  }

  /** Last state passed to highlight.setSelection. */
  get selection(): readonly HighlightTarget[] {
    return this.selectionState;
  }

  /** Current overlay content: id → shapes. */
  get overlayShapes(): ReadonlyMap<string, readonly OverlayShape[]> {
    return this.overlayState;
  }

  /** Current sketch drawings: id → the last drawing set under it. */
  get sketchDrawings(): ReadonlyMap<string, SketchDrawing> {
    return this.sketchState;
  }

  /** Last state passed to manipulators.set (M18); [] before any. */
  get manipulatorViews(): readonly HandleView[] {
    return this.manipulatorViewState;
  }

  /** Last label passed to manipulators.setLabel (M18); null before any. */
  get manipulatorLabel(): ManipulatorLabel | null {
    return this.manipulatorLabelState;
  }

  emitPointer(e: ViewPointerEvent): void {
    this.emitter.emit('pointer', e);
  }

  emitKey(e: ViewKeyEvent): void {
    this.emitter.emit('key', e);
  }
}

/** A body for FakeRegenStatus.publish: without names it gets NO_TOPO_NAMES (M14). */
type PublishedBody = Omit<RegenBody, 'names'> & { readonly names?: TopoNames };

const NO_BODIES: readonly RegenBody[] = Object.freeze([]);
const NO_SKETCHES: readonly RegenSketch[] = Object.freeze([]);
const NO_ANCHORS: ReadonlyMap<FeatureId, FeatureAnchors> = new Map();

/**
 * A RegenStatusPort for tests: starts with no regeneration (generation 0, no health, no
 * bodies, no sketches, no anchors); each publish stands for one finished regeneration.
 */
export class FakeRegenStatus implements RegenStatusPort {
  private readonly value = new ObservableValue<RegenSnapshot>(
    Object.freeze({
      generation: 0,
      health: new Map(),
      bodies: NO_BODIES,
      sketches: NO_SKETCHES,
      anchors: new Map(),
    }),
  );
  readonly state: Observable<RegenSnapshot> = this.value.asObservable();

  /**
   * A new frozen snapshot with generation + 1 and copies of health, bodies (a body without
   * names gets NO_TOPO_NAMES, M14), sketches (with their regions) and anchors (M18; each empty
   * when omitted); notifies subscribers.
   */
  publish(
    health: ReadonlyMap<FeatureId, FeatureHealth>,
    bodies: readonly PublishedBody[] = NO_BODIES,
    sketches: readonly RegenSketch[] = NO_SKETCHES,
    anchors: ReadonlyMap<FeatureId, FeatureAnchors> = NO_ANCHORS,
  ): void {
    this.value.set(
      Object.freeze({
        generation: this.value.get().generation + 1,
        health: new Map(health),
        bodies: Object.freeze(
          bodies.map(({ body, feature, names }) =>
            Object.freeze({ body, feature, names: names ?? NO_TOPO_NAMES }),
          ),
        ),
        sketches: Object.freeze(
          sketches.map(({ sketch, feature, regions }) =>
            Object.freeze({ sketch, feature, regions: Object.freeze([...regions]) }),
          ),
        ),
        // A new map, like health; the anchors themselves are passed on as they are.
        anchors: new Map(anchors),
      }),
    );
  }
}

/**
 * TopoNames from hand-written names: name → indices (spec 10, M14). faces/edges return the
 * indices ascending; an index with several names is named by the first of them in sorted order.
 */
export function aTopoNames(
  names: {
    readonly faces?: Readonly<Record<string, readonly number[]>>;
    readonly edges?: Readonly<Record<string, readonly number[]>>;
  } = {},
): TopoNames {
  const faces = indexByName(names.faces ?? {});
  const edges = indexByName(names.edges ?? {});
  return Object.freeze({
    nameOfFace: (index: number) => nameOf(faces, index),
    nameOfEdge: (index: number) => nameOf(edges, index),
    faces: (name: TopoName) => faces.get(name) ?? NO_INDICES,
    edges: (name: TopoName) => edges.get(name) ?? NO_INDICES,
  });
}

const NO_INDICES: readonly number[] = Object.freeze([]);

/** Name → frozen ascending indices, the names in sorted order. */
function indexByName(
  record: Readonly<Record<string, readonly number[]>>,
): ReadonlyMap<TopoName, readonly number[]> {
  return new Map(
    Object.keys(record)
      .sort()
      .map((name) => [
        // Test helper: the hand-written strings stand for names minted by regen.
        name as TopoName,
        Object.freeze([...(record[name] ?? [])].sort((a, b) => a - b)),
      ]),
  );
}

/** The first name (in sorted order) whose indices contain `index`. */
function nameOf(
  byName: ReadonlyMap<TopoName, readonly number[]>,
  index: number,
): TopoName | undefined {
  for (const [name, indices] of byName) if (indices.includes(index)) return name;
  return undefined;
}

/** One call of the FakeFileExporter: STEP with its bodies, or the document. */
export type FileExportCall =
  { readonly task: 'step'; readonly bodies: readonly BodyId[] } | { readonly task: 'document' };

interface PendingExport {
  readonly resolve: () => void;
  readonly reject: (e: unknown) => void;
}

/**
 * A FileExporter for tests: records the calls and leaves each one pending until the test
 * settles it with resolve() or reject(e), oldest first (manual settling, like FakeSolver.hold).
 */
export class FakeFileExporter implements FileExporter {
  private callList: readonly FileExportCall[] = [];
  private pending: readonly PendingExport[] = [];

  /** All calls so far, in order; frozen and replaced on every call, so a read list never changes. */
  get calls(): readonly FileExportCall[] {
    return this.callList;
  }

  /** Calls not settled yet. */
  get pendingCount(): number {
    return this.pending.length;
  }

  exportStep(bodies: readonly BodyId[]): Promise<void> {
    return this.record(Object.freeze({ task: 'step', bodies: Object.freeze([...bodies]) }));
  }

  exportDocument(): Promise<void> {
    return this.record(Object.freeze({ task: 'document' }));
  }

  /** Fulfils the oldest pending call; none pending throws. */
  resolve(): void {
    this.take().resolve();
  }

  /** Rejects the oldest pending call with `e`; none pending throws. */
  reject(e: unknown): void {
    this.take().reject(e);
  }

  private record(call: FileExportCall): Promise<void> {
    this.callList = Object.freeze([...this.callList, call]);
    return new Promise<void>((resolve, reject) => {
      this.pending = [...this.pending, { resolve, reject }];
    });
  }

  private take(): PendingExport {
    const [first, ...rest] = this.pending;
    if (first === undefined) throw new Error('FakeFileExporter: no pending export');
    this.pending = rest;
    return first;
  }
}
