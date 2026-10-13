// Test-only entry point of interaction: FakeViewport stands in for the render viewport,
// FakeRegenStatus for the regeneration state that app feeds in.
// dependency-cruiser allows importing it only from *.test.ts.

import { Emitter, ObservableValue } from '@/core';
import type { Observable, Subscribable, Vec3 } from '@/core';
import type { FeatureId } from '@/document';
import type { FeatureHealth, RegenBody, RegenSnapshot, RegenStatusPort } from './regen-status-port';
import type {
  HighlightPort,
  HighlightTarget,
  OverlayPort,
  OverlayShape,
  PickResult,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportEvents,
  ViewportPort,
} from './viewport-port';

type Ray = ReturnType<ViewportPort['screenToRay']>;
type PickFn = (x: number, y: number) => PickResult | null;
type RayFn = (x: number, y: number) => Ray;

/** Default ray: screen px map 1:1 to world XY, looking down -Z (a top view without y flip). */
const DEFAULT_RAY: RayFn = (x, y) => ({ origin: [x, y, 0] satisfies Vec3, direction: [0, 0, -1] });

/**
 * A ViewportPort for tests: preset pick results, a configurable screenToRay, recorded
 * highlight and overlay state, and manual emitting of pointer and key events.
 * The recorded state is replaced on every call, so a read snapshot never changes later.
 */
export class FakeViewport implements ViewportPort {
  readonly highlight: HighlightPort;
  readonly overlay: OverlayPort;
  private readonly emitter = new Emitter<ViewportEvents>();
  readonly events: Subscribable<ViewportEvents> = this.emitter;

  private pickFn: PickFn = () => null;
  private rayFn: RayFn = DEFAULT_RAY;
  private hoverState: HighlightTarget | null = null;
  private selectionState: readonly HighlightTarget[] = [];
  private overlayState: ReadonlyMap<string, readonly OverlayShape[]> = new Map();

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
  }

  /** A fixed result, or a function of the view coordinates. */
  setPick(result: PickResult | null | PickFn): void {
    this.pickFn = typeof result === 'function' ? result : () => result;
  }

  setScreenToRay(fn: RayFn): void {
    this.rayFn = fn;
  }

  pick(x: number, y: number): PickResult | null {
    return this.pickFn(x, y);
  }

  screenToRay(x: number, y: number): Ray {
    return this.rayFn(x, y);
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

  emitPointer(e: ViewPointerEvent): void {
    this.emitter.emit('pointer', e);
  }

  emitKey(e: ViewKeyEvent): void {
    this.emitter.emit('key', e);
  }
}

const NO_BODIES: readonly RegenBody[] = Object.freeze([]);

/**
 * A RegenStatusPort for tests: starts with no regeneration (generation 0, no health, no
 * bodies); each publish stands for one finished regeneration.
 */
export class FakeRegenStatus implements RegenStatusPort {
  private readonly value = new ObservableValue<RegenSnapshot>(
    Object.freeze({ generation: 0, health: new Map(), bodies: NO_BODIES }),
  );
  readonly state: Observable<RegenSnapshot> = this.value.asObservable();

  /**
   * A new frozen snapshot with generation + 1 and copies of health and bodies (no bodies
   * when omitted); notifies subscribers.
   */
  publish(
    health: ReadonlyMap<FeatureId, FeatureHealth>,
    bodies: readonly RegenBody[] = NO_BODIES,
  ): void {
    this.value.set(
      Object.freeze({
        generation: this.value.get().generation + 1,
        health: new Map(health),
        bodies: Object.freeze(bodies.map(({ body, feature }) => Object.freeze({ body, feature }))),
      }),
    );
  }
}
