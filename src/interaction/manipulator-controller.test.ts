import { createSequentialIdGenerator } from '@/core';
import type { Vec3 } from '@/core';
import { bodyId, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureId, FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { describe, expect, it, vi } from 'vitest';
import { createFeatureEditor } from './feature-editor';
import { createManipulatorController } from './manipulator-controller';
import { createManipulatorRegistry } from './manipulators';
import type { FeatureAnchors } from './regen-status-port';
import type { Handle, ManipulatorDescriptor, ManipulatorMode } from './manipulators';
import { FakeRegenStatus, FakeViewport } from './testing';
import type { KeyMods, PickResult, ViewKeyEvent, ViewPointerEvent } from './viewport-port';

// The test feature. Mode 'main' (also the frame of '' without modes): a linear handle 'a' over x
// along +X from the anchor 'base', and an angular handle 'b' around +Z at the anchor that switches
// mode to 'b' and sets angle (like a circle of another axis in Transform); 'b' is left out for
// mode 'none'. Mode 'flat': a planar handle 'q' over (x, y) in the XY plane at the anchor. Mode
// 'pick' (picksPoint): a point handle 'p' over pt. pickPoint writes pt in any mode, so only the
// flag of the mode decides whether the controller takes clicks on the model.

interface GizmoParams {
  readonly x: number;
  readonly mode: string;
  readonly angle: number;
  readonly y: number;
  readonly pt: Vec3;
}

const GIZMO_PARAMS: ParamSchema = {
  x: { kind: 'length', label: 'X', default: 10, min: 0 },
  mode: {
    kind: 'enum',
    label: 'Mode',
    default: 'a',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'none', label: 'None' },
    ],
  },
  angle: { kind: 'angle', label: 'Angle', default: 0.3 },
  y: { kind: 'length', label: 'Y', default: 0 },
  pt: { kind: 'point', label: 'Pt', default: [0, 0, 0] },
};

const GIZMO_DEFAULTS: GizmoParams = { x: 10, mode: 'a', angle: 0.3, y: 0, pt: [0, 0, 0] };

const GIZMO_SCHEMA: FeatureSchema<GizmoParams> = {
  type: 'gizmo',
  version: 1,
  label: 'Gizmo',
  params: GIZMO_PARAMS,
  defaults: () => GIZMO_DEFAULTS,
  validate: (params) => validateAgainstSchema(GIZMO_PARAMS, params),
};

const MODES: readonly ManipulatorMode[] = [
  { id: 'main', label: 'gizmo.main', icon: 'icon-main' },
  { id: 'flat', label: 'gizmo.flat', icon: 'icon-flat' },
  { id: 'pick', label: 'gizmo.pick', icon: 'icon-pick', picksPoint: true },
];

interface GizmoOptions {
  readonly displayScale?: number;
  /** The modes of the descriptor; MODES by default. */
  readonly modes?: readonly ManipulatorMode[] | null;
  /** Records the mode of every frame call. */
  readonly frames?: string[];
}

function gizmoDescriptor(options: GizmoOptions = {}) {
  const modes = options.modes === undefined ? MODES : options.modes;
  const descriptor: ManipulatorDescriptor<GizmoParams> = {
    type: 'gizmo',
    ...(modes === null ? {} : { modes }),
    frame(p, anchors, mode) {
      options.frames?.push(mode);
      const base = anchors['base'];
      if (base === undefined) return null;
      const [bx, by, bz] = base.point;
      const center = base.point;
      if (mode === 'flat') {
        const q: Handle = {
          kind: 'planar',
          id: 'q',
          origin: center,
          u: [1, 0, 0],
          v: [0, 1, 0],
          value: [p.x, p.y],
          unit: 'length',
          tint: 'z',
          toParams: ([a, b]) => ({ x: a, y: b }),
        };
        return { center, handles: [q] };
      }
      if (mode === 'pick') {
        const pt: Handle = {
          kind: 'point',
          id: 'p',
          position: p.pt,
          value: p.pt,
          unit: 'length',
          tint: 'neutral',
          dashed: true,
          toParams: (v) => ({ pt: v }),
        };
        return { center, handles: [pt] };
      }
      const a: Handle = {
        kind: 'linear',
        id: 'a',
        position: [bx + p.x, by, bz],
        direction: [1, 0, 0],
        value: p.x,
        unit: 'length',
        min: 0,
        tint: 'x',
        toParams: (v) => ({ x: v }),
        ...(options.displayScale === undefined ? {} : { displayScale: options.displayScale }),
      };
      const b: Handle = {
        kind: 'angular',
        id: 'b',
        center,
        axis: [0, 0, 1],
        zero: [1, 0, 0],
        extent: 'quarter',
        value: p.mode === 'b' ? p.angle : 0,
        unit: 'angle',
        tint: 'z',
        toParams: (v) => ({ mode: 'b', angle: v }),
      };
      return { center, handles: p.mode === 'none' ? [a] : [a, b] };
    },
    pickPoint(_p, _anchors, _mode, point) {
      return { pt: point };
    },
  };
  return descriptor;
}

const NO_MODS: KeyMods = { shift: false, alt: false, mod: false };
const SHIFT: KeyMods = { shift: true, alt: false, mod: false };
const ORIGIN: FeatureAnchors = { base: { point: [0, 0, 0] } };
const FACE_HIT: PickResult = {
  kind: 'face',
  body: bodyId('f1' as FeatureId), // test ids are trusted
  faceIndex: 0,
  point: [1, 2, 3],
  normal: [0, 0, 1],
};

function at(
  type: ViewPointerEvent['type'],
  x: number,
  y: number,
  button: ViewPointerEvent['button'] = 'left',
  mods: KeyMods = NO_MODS,
): ViewPointerEvent {
  return { type, x, y, button, mods };
}

function key(k: string, mods: KeyMods = NO_MODS): ViewKeyEvent {
  return { key: k, mods, inTextField: false };
}

function setup(options: GizmoOptions & { register?: boolean } = {}) {
  const ops = anOpsSession();
  const schemas = createFeatureSchemaRegistry();
  schemas.register(GIZMO_SCHEMA);
  const features = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('g'),
  });
  const registry = createManipulatorRegistry();
  if (options.register !== false) registry.register(gizmoDescriptor(options));
  const regen = new FakeRegenStatus();
  const viewport = new FakeViewport();
  const controller = createManipulatorController({ features, regen, registry, viewport });
  /** Opens a dialog and publishes a regeneration with the anchors of its feature. */
  function open(anchors: FeatureAnchors = ORIGIN) {
    const session = features.create('gizmo');
    regen.publish(new Map(), [], [], new Map([[session.featureId, anchors]]));
    return session;
  }
  /** The handle under the cursor, wherever it is. */
  function pickAt(id: string | null) {
    viewport.prepareHandlePick(() => id);
  }
  return { ops, features, regen, viewport, controller, open, pickAt };
}

function states(viewport: FakeViewport): Record<string, string> {
  return Object.fromEntries(viewport.manipulatorViews.map((v) => [v.id, v.state]));
}

function paramsOf(session: { state: { get(): { params: Readonly<Record<string, unknown>> } } }) {
  return session.state.get().params;
}

describe('createManipulatorController – handles', () => {
  it('without a session, without anchors, without a descriptor or with issues there are none', () => {
    const { viewport, regen, features, open } = setup();
    expect(viewport.manipulatorViews).toEqual([]);

    const session = features.create('gizmo');
    expect(viewport.manipulatorViews).toEqual([]);
    // Anchors of another feature only.
    regen.publish(new Map(), [], [], new Map([['other' as FeatureId, ORIGIN]])); // test ids are trusted
    expect(viewport.manipulatorViews).toEqual([]);
    session.cancel();

    const opened = open();
    expect(viewport.manipulatorViews).toHaveLength(2);
    opened.setParam('x', -1);
    expect(opened.state.get().issues).not.toEqual([]);
    expect(viewport.manipulatorViews).toEqual([]);

    const noDescriptor = setup({ register: false });
    noDescriptor.open();
    expect(noDescriptor.viewport.manipulatorViews).toEqual([]);
  });

  it('sends views of the handles of the open session, idle, without functions and value', () => {
    const { viewport, open } = setup();
    open({ base: { point: [1, 2, 3] } });
    expect(viewport.manipulatorViews).toEqual([
      {
        kind: 'linear',
        id: 'a',
        position: [11, 2, 3],
        direction: [1, 0, 0],
        tint: 'x',
        state: 'idle',
        dashed: false,
      },
      {
        kind: 'angular',
        id: 'b',
        center: [1, 2, 3],
        axis: [0, 0, 1],
        zero: [1, 0, 0],
        extent: 'quarter',
        tint: 'z',
        state: 'idle',
        dashed: false,
      },
    ]);
  });

  it('follows the live params and closes with the session', () => {
    const { viewport, open } = setup();
    const session = open();
    session.setParam('x', 20);
    expect(viewport.manipulatorViews[0]).toMatchObject({ id: 'a', position: [20, 0, 0] });
    session.commit();
    expect(viewport.manipulatorViews).toEqual([]);
  });

  it('does not send the same views again', () => {
    const { viewport, regen, open } = setup();
    const session = open();
    const set = vi.spyOn(viewport.manipulators, 'set');
    regen.publish(new Map(), [], [], new Map([[session.featureId, ORIGIN]]));
    session.setParam('angle', 0.5);
    expect(set).not.toHaveBeenCalled();
    session.setParam('x', 12);
    expect(set).toHaveBeenCalledTimes(1);
  });
});

describe('createManipulatorController – hover', () => {
  it('move over a handle hovers it and returns true; off it and leave clear the hover', () => {
    const { viewport, controller, open, pickAt } = setup();
    open();

    pickAt('a');
    expect(controller.onPointer(at('move', 10, 0))).toBe(true);
    expect(states(viewport)).toEqual({ a: 'hover', b: 'idle' });

    pickAt(null);
    expect(controller.onPointer(at('move', 50, 50))).toBe(false);
    expect(states(viewport)).toEqual({ a: 'idle', b: 'idle' });

    pickAt('b');
    controller.onPointer(at('move', 0, 5));
    expect(controller.onPointer(at('leave', 0, 5))).toBe(false);
    expect(states(viewport)).toEqual({ a: 'idle', b: 'idle' });
  });

  it('without handles a move returns false', () => {
    const { controller, pickAt } = setup();
    pickAt('a');
    expect(controller.onPointer(at('move', 10, 0))).toBe(false);
  });

  it('without a drag up, right and middle buttons and keys are not handled', () => {
    const { controller, open, pickAt } = setup();
    open();
    pickAt('a');
    expect(controller.onPointer(at('up', 10, 0))).toBe(false);
    expect(controller.onPointer(at('down', 10, 0, 'right'))).toBe(false);
    expect(controller.onPointer(at('down', 10, 0, 'middle'))).toBe(false);
    expect(controller.onKey(key('Escape'))).toBe(false);
  });

  it('a left down off a handle is not handled', () => {
    const { controller, open, pickAt } = setup();
    open();
    pickAt(null);
    expect(controller.onPointer(at('down', 50, 50))).toBe(false);
  });
});

describe('createManipulatorController – dragging', () => {
  it('a linear drag writes the snapped value; with Shift without snapping', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    pickAt('a');

    expect(controller.onPointer(at('down', 10, 0))).toBe(true);
    expect(states(viewport)).toEqual({ a: 'active', b: 'idle' });
    // The ray at x = 13.4 is 3.4 along the frozen arrow from the down point.
    expect(controller.onPointer(at('move', 13.4, 0))).toBe(true);
    expect(paramsOf(session)['x']).toBe(13);
    controller.onPointer(at('move', 13.4, 0, null, SHIFT));
    expect(paramsOf(session)['x']).toBeCloseTo(13.4);
    // The arrow moved with x, the drag still measures from the frozen handle.
    controller.onPointer(at('move', 15, 0));
    expect(paramsOf(session)['x']).toBe(15);
    expect(viewport.manipulatorViews[0]).toMatchObject({ position: [15, 0, 0], state: 'active' });

    expect(controller.onPointer(at('up', 15, 0))).toBe(true);
    expect(states(viewport)).toEqual({ a: 'hover', b: 'idle' });
    expect(paramsOf(session)['x']).toBe(15);
  });

  it('clips to min after snapping', () => {
    const { controller, open, pickAt } = setup();
    const session = open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('move', -30, 0));
    expect(paramsOf(session)['x']).toBe(0);
  });

  it('calls setParams only when the value changes', () => {
    const { controller, open, pickAt } = setup();
    const session = open();
    const setParams = vi.spyOn(session, 'setParams');
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('move', 10.2, 0));
    expect(setParams).not.toHaveBeenCalled();
    controller.onPointer(at('move', 11.1, 0));
    controller.onPointer(at('move', 11.3, 0));
    expect(setParams).toHaveBeenCalledTimes(1);
    expect(setParams).toHaveBeenCalledWith({ x: 11 });
  });

  it('an angular drag accumulates across ±π and switches the mode', () => {
    const { controller, open, pickAt } = setup();
    const session = open();
    pickAt('b');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('move', 0, 10));
    expect(paramsOf(session)).toMatchObject({ mode: 'b' });
    expect(paramsOf(session)['angle']).toBeCloseTo(Math.PI / 2);
    controller.onPointer(at('move', -10, 0.1));
    controller.onPointer(at('move', -10, -0.1));
    controller.onPointer(at('move', 0, -10));
    expect(paramsOf(session)['angle']).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('Escape restores the original values of all keys of toParams, the mode too', () => {
    const { controller, open, pickAt } = setup();
    const session = open();
    pickAt('b');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('move', 0, 10));
    expect(paramsOf(session)['mode']).toBe('b');

    expect(controller.onKey(key('Escape'))).toBe(true);
    expect(paramsOf(session)).toEqual(GIZMO_DEFAULTS);
    // The drag is over: a move does not write any more.
    pickAt(null);
    expect(controller.onPointer(at('move', 0, -10))).toBe(false);
    expect(paramsOf(session)).toEqual(GIZMO_DEFAULTS);
  });

  it('the whole drag is one log entry after commit', () => {
    const { ops, controller, open, pickAt } = setup();
    const session = open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('move', 12, 0));
    controller.onPointer(at('move', 14, 0));
    controller.onPointer(at('up', 14, 0));
    session.commit();
    expect(ops.log.entries()).toHaveLength(1);
  });

  it('while dragging other buttons, downs, leave and moves off the handle are swallowed', () => {
    const { controller, open, pickAt } = setup();
    open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    pickAt(null);
    expect(controller.onPointer(at('down', 10, 0))).toBe(true);
    expect(controller.onPointer(at('down', 10, 0, 'right'))).toBe(true);
    expect(controller.onPointer(at('up', 10, 0, 'middle'))).toBe(true);
    expect(controller.onPointer(at('leave', 10, 0))).toBe(true);
    expect(controller.onPointer(at('move', 40, 40))).toBe(true);
    expect(controller.onKey(key('a'))).toBe(false);
  });

  it('a down with an undefined parameter does not start a drag', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    // A ray along the arrow: the linear parameter is undefined.
    viewport.setScreenToRay(() => ({ origin: [0, 0, 0], direction: [1, 0, 0] satisfies Vec3 }));
    pickAt('a');
    expect(controller.onPointer(at('down', 10, 0))).toBe(false);
    expect(controller.onPointer(at('move', 12, 0))).toBe(true);
    expect(paramsOf(session)['x']).toBe(10);
  });

  it('a move with an undefined parameter keeps the value', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    viewport.setScreenToRay(() => ({ origin: [0, 0, 0], direction: [1, 0, 0] satisfies Vec3 }));
    expect(controller.onPointer(at('move', 12, 0))).toBe(true);
    expect(paramsOf(session)['x']).toBe(10);
  });

  it('frozen anchors: a regeneration without anchors does not stop the drag', () => {
    const { viewport, regen, controller, open, pickAt } = setup();
    const session = open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    // The regeneration failed: no anchors for the feature; then other anchors.
    regen.publish(new Map());
    expect(viewport.manipulatorViews).toHaveLength(2);
    regen.publish(
      new Map(),
      [],
      [],
      new Map([[session.featureId, { base: { point: [5, 5, 5] } }]]),
    );
    controller.onPointer(at('move', 12, 0));
    expect(paramsOf(session)['x']).toBe(12);
    expect(viewport.manipulatorViews[0]).toMatchObject({ position: [12, 0, 0] });

    controller.onPointer(at('up', 12, 0));
    expect(viewport.manipulatorViews[0]).toMatchObject({ position: [17, 5, 5] });
  });

  it('views stay while issues appear during the drag', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    const views = viewport.manipulatorViews;
    session.setParam('angle', 'bad');
    expect(session.state.get().issues).not.toEqual([]);
    expect(viewport.manipulatorViews).toBe(views);
  });

  it('a session closed during the drag ends it without writing', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('move', 12, 0));
    session.cancel();
    expect(viewport.manipulatorViews).toEqual([]);
    expect(controller.hud.get()).toBeNull();
    // Writing into the closed session would throw.
    expect(controller.onPointer(at('move', 14, 0))).toBe(false);
    expect(controller.onPointer(at('up', 14, 0))).toBe(false);
    expect(controller.onKey(key('Escape'))).toBe(false);
  });
});

describe('createManipulatorController – dispose', () => {
  it('clears views and the HUD, unsubscribes; a second dispose does nothing', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    controller.dispose();
    expect(viewport.manipulatorViews).toEqual([]);
    expect(controller.hud.get()).toBeNull();

    const set = vi.spyOn(viewport.manipulators, 'set');
    session.setParam('x', 20);
    controller.dispose();
    expect(controller.onPointer(at('move', 12, 0))).toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(controller.hud.get()).toBeNull();
    expect(paramsOf(session)['x']).toBe(20);
  });
});

describe('createManipulatorController – planar and point drags (M19)', () => {
  it('a planar drag writes both components snapped; with Shift without snapping', () => {
    const { controller, open, pickAt } = setup();
    const session = open();
    controller.setMode('flat');
    pickAt('q');
    expect(controller.onPointer(at('down', 10, 0))).toBe(true);
    controller.onPointer(at('move', 13.4, 5.6));
    expect(paramsOf(session)).toMatchObject({ x: 13, y: 6 });
    controller.onPointer(at('move', 13.4, 5.6, null, SHIFT));
    expect(paramsOf(session)['x']).toBeCloseTo(13.4);
    expect(paramsOf(session)['y']).toBeCloseTo(5.6);
  });

  it('a planar drag ignores a move with the plane seen edge-on; a down edge-on does not start', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    controller.setMode('flat');
    pickAt('q');
    controller.onPointer(at('down', 10, 0));
    viewport.setScreenToRay(() => ({ origin: [0, 0, 0], direction: [1, 0, 0] satisfies Vec3 }));
    expect(controller.onPointer(at('move', 20, 20))).toBe(true);
    expect(paramsOf(session)).toMatchObject({ x: 10, y: 0 });
    controller.onPointer(at('up', 20, 20));
    expect(controller.onPointer(at('down', 10, 0))).toBe(false);
  });

  it('a planar drag calls setParams only when a component changes; Escape restores both', () => {
    const { controller, open, pickAt } = setup();
    const session = open();
    const setParams = vi.spyOn(session, 'setParams');
    controller.setMode('flat');
    pickAt('q');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('move', 10.2, 0.3));
    expect(setParams).not.toHaveBeenCalled();
    controller.onPointer(at('move', 12, 3));
    expect(setParams).toHaveBeenCalledWith({ x: 12, y: 3 });
    controller.onKey(key('Escape'));
    expect(paramsOf(session)).toMatchObject({ x: 10, y: 0 });
  });

  it('a point drag moves in the plane perpendicular to the ray of the down', () => {
    const { controller, open, pickAt } = setup();
    const session = open();
    controller.setMode('pick');
    pickAt('p');
    expect(controller.onPointer(at('down', 0, 0))).toBe(true);
    controller.onPointer(at('move', 3.4, 4.6));
    expect(paramsOf(session)['pt']).toEqual([3, 5, 0]);
    controller.onPointer(at('move', 3.4, 4.6, null, SHIFT));
    const fine = paramsOf(session)['pt'] as Vec3; // the controller writes a Vec3
    expect(fine[0]).toBeCloseTo(3.4);
    expect(fine[1]).toBeCloseTo(4.6);
  });

  it('a point drag keeps the plane of the down after viewChanged', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    controller.setMode('pick');
    pickAt('p');
    controller.onPointer(at('down', 0, 0));
    // The camera turned: the ray from (x, y, 10) goes down at 45° along +Y and hits z = 0 at y + 10.
    viewport.setScreenToRay((x, y) => ({
      origin: [x, y, 10] satisfies Vec3,
      direction: [0, Math.SQRT1_2, -Math.SQRT1_2] satisfies Vec3,
    }));
    viewport.emitViewChanged({ generation: 1 });
    controller.onPointer(at('move', 2, -4));
    expect(paramsOf(session)['pt']).toEqual([2, 6, 0]);
  });

  it('a point drag ignores a ray along the plane of the down', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    controller.setMode('pick');
    pickAt('p');
    controller.onPointer(at('down', 0, 0));
    viewport.setScreenToRay(() => ({ origin: [0, 0, 5], direction: [1, 0, 0] satisfies Vec3 }));
    expect(controller.onPointer(at('move', 4, 4))).toBe(true);
    expect(paramsOf(session)['pt']).toEqual([0, 0, 0]);
  });

  it('views of planar and point handles carry their geometry and dashed', () => {
    const { viewport, controller, open } = setup();
    open({ base: { point: [1, 2, 3] } });
    controller.setMode('flat');
    expect(viewport.manipulatorViews).toEqual([
      {
        kind: 'planar',
        id: 'q',
        origin: [1, 2, 3],
        u: [1, 0, 0],
        v: [0, 1, 0],
        tint: 'z',
        state: 'idle',
        dashed: false,
      },
    ]);
    controller.setMode('pick');
    expect(viewport.manipulatorViews).toEqual([
      { kind: 'point', id: 'p', position: [0, 0, 0], tint: 'neutral', state: 'idle', dashed: true },
    ]);
  });
});

describe('createManipulatorController – modes (M19)', () => {
  it('starts in the first mode; the HUD lists the modes with the active one and the center', () => {
    const frames: string[] = [];
    const { controller, open } = setup({ frames });
    expect(controller.hud.get()).toBeNull();
    open({ base: { point: [1, 2, 3] } });
    expect(frames.at(-1)).toBe('main');
    expect(controller.hud.get()).toEqual({
      modes: [
        { id: 'main', label: 'gizmo.main', icon: 'icon-main', active: true },
        { id: 'flat', label: 'gizmo.flat', icon: 'icon-flat', active: false },
        { id: 'pick', label: 'gizmo.pick', icon: 'icon-pick', active: false },
      ],
      center: [1, 2, 3],
      field: null,
    });
  });

  it('without modes there is no toolbar and the mode is empty', () => {
    for (const modes of [null, []]) {
      const frames: string[] = [];
      const { controller, open } = setup({ frames, modes });
      open();
      expect(frames.at(-1)).toBe('');
      expect(controller.hud.get()?.modes).toEqual([]);
    }
  });

  it('with one mode there is no toolbar and the mode is its id', () => {
    const frames: string[] = [];
    const { controller, open } = setup({ frames, modes: MODES.slice(0, 1) });
    open();
    expect(frames.at(-1)).toBe('main');
    expect(controller.hud.get()?.modes).toEqual([]);
  });

  it('setMode switches the frame, clears the hover and the field', () => {
    const { viewport, controller, open, pickAt } = setup();
    open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('up', 10, 0));
    expect(controller.hud.get()?.field?.handleId).toBe('a');
    expect(states(viewport)).toEqual({ a: 'hover', b: 'idle' });

    controller.setMode('flat');
    expect(viewport.manipulatorViews.map((v) => v.id)).toEqual(['q']);
    expect(states(viewport)).toEqual({ q: 'idle' });
    expect(controller.hud.get()?.field).toBeNull();
    expect(controller.hud.get()?.modes.find((m) => m.active)?.id).toBe('flat');
  });

  it('the same or an unknown id, or no manipulator, does nothing', () => {
    const { controller, open } = setup();
    controller.setMode('flat');
    expect(controller.hud.get()).toBeNull();
    open();
    const hud = controller.hud.get();
    controller.setMode('main');
    controller.setMode('unknown');
    expect(controller.hud.get()).toBe(hud);
  });

  it('setMode during a drag does nothing', () => {
    const { viewport, controller, open, pickAt } = setup();
    open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    controller.setMode('flat');
    expect(viewport.manipulatorViews.map((v) => v.id)).toEqual(['a', 'b']);
    controller.onPointer(at('up', 10, 0));
    expect(controller.hud.get()?.modes.find((m) => m.active)?.id).toBe('main');
  });

  it('a new session starts in the default mode again', () => {
    const { viewport, controller, open } = setup();
    const first = open();
    controller.setMode('flat');
    first.cancel();
    open();
    expect(viewport.manipulatorViews.map((v) => v.id)).toEqual(['a', 'b']);
    expect(controller.hud.get()?.modes.find((m) => m.active)?.id).toBe('main');
  });

  it('the HUD is the same object while its content stays', () => {
    const { regen, controller, open } = setup();
    const session = open();
    const hud = controller.hud.get();
    regen.publish(new Map(), [], [], new Map([[session.featureId, ORIGIN]]));
    expect(controller.hud.get()).toBe(hud);
    regen.publish(
      new Map(),
      [],
      [],
      new Map([[session.featureId, { base: { point: [0, 0, 1] } }]]),
    );
    expect(controller.hud.get()).not.toBe(hud);
    expect(controller.hud.get()?.center).toEqual([0, 0, 1]);
  });
});

describe('createManipulatorController – pickPoint (M19)', () => {
  it('a click on the model writes the patch of pickPoint', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    controller.setMode('pick');
    pickAt(null);
    viewport.setPick(FACE_HIT);
    expect(controller.onPointer(at('move', 50, 50))).toBe(true);
    expect(controller.onPointer(at('down', 50, 50))).toBe(true);
    expect(controller.onPointer(at('up', 52, 53))).toBe(true);
    expect(viewport.lastFilter).toEqual(['face', 'edge']);
    expect(paramsOf(session)['pt']).toEqual([1, 2, 3]);
  });

  it('a drag over the model writes nothing', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    controller.setMode('pick');
    pickAt(null);
    viewport.setPick(FACE_HIT);
    controller.onPointer(at('down', 50, 50));
    expect(controller.onPointer(at('move', 70, 70))).toBe(true);
    expect(controller.onPointer(at('up', 70, 70))).toBe(false);
    expect(paramsOf(session)['pt']).toEqual([0, 0, 0]);
  });

  it('a click off the model writes nothing', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    const setParams = vi.spyOn(session, 'setParams');
    controller.setMode('pick');
    pickAt(null);
    viewport.setPick(null);
    expect(controller.onPointer(at('down', 50, 50))).toBe(true);
    expect(controller.onPointer(at('up', 50, 50))).toBe(true);
    expect(setParams).not.toHaveBeenCalled();
  });

  it('in a mode without picksPoint the click goes on, though pickPoint would answer', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    pickAt(null);
    viewport.setPick(FACE_HIT);
    expect(controller.onPointer(at('move', 50, 50))).toBe(false);
    expect(controller.onPointer(at('down', 50, 50))).toBe(false);
    expect(controller.onPointer(at('up', 50, 50))).toBe(false);
    expect(paramsOf(session)['pt']).toEqual([0, 0, 0]);
  });

  it('a handle still wins over the model in a mode with pickPoint', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    controller.setMode('pick');
    viewport.setPick(FACE_HIT);
    pickAt('p');
    controller.onPointer(at('down', 0, 0));
    controller.onPointer(at('move', 4, 0));
    controller.onPointer(at('up', 4, 0));
    expect(paramsOf(session)['pt']).toEqual([4, 0, 0]);
  });
});

describe('createManipulatorController – the field of the HUD (M19)', () => {
  it('belongs to the dragged scalar handle; dragging while the drag runs', () => {
    const { controller, open, pickAt } = setup();
    open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('move', 13, 0));
    expect(controller.hud.get()?.field).toEqual({
      handleId: 'a',
      kind: 'linear',
      at: [13, 0, 0],
      direction: [1, 0, 0],
      value: 13,
      unit: 'length',
      tint: 'x',
      dragging: true,
    });
    controller.onPointer(at('up', 13, 0));
    expect(controller.hud.get()?.field).toMatchObject({
      handleId: 'a',
      value: 13,
      dragging: false,
    });
  });

  it('a click without a move on an angular handle gives its field at the middle of the quarter', () => {
    const { controller, open, pickAt } = setup();
    open({ base: { point: [1, 2, 3] } });
    pickAt('b');
    controller.onPointer(at('down', 20, 2));
    controller.onPointer(at('up', 20, 2));
    const field = controller.hud.get()?.field;
    expect(field).toMatchObject({
      handleId: 'b',
      kind: 'angular',
      at: [1, 2, 3],
      value: 0,
      unit: 'angle',
      tint: 'z',
      dragging: false,
    });
    expect(field?.direction[0]).toBeCloseTo(Math.SQRT1_2);
    expect(field?.direction[1]).toBeCloseTo(Math.SQRT1_2);
    expect(field?.direction[2]).toBeCloseTo(0);
  });

  it('follows the params changed in the dialog and disappears with its handle', () => {
    const { controller, open, pickAt } = setup();
    const session = open();
    pickAt('b');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('up', 10, 0));
    session.setParam('mode', 'b');
    expect(controller.hud.get()?.field).toMatchObject({ handleId: 'b', value: 0.3 });
    session.setParam('mode', 'none');
    expect(controller.hud.get()?.field).toBeNull();
    session.setParam('mode', 'b');
    expect(controller.hud.get()?.field).toBeNull();
  });

  it('planar and point handles have no field', () => {
    const { controller, open, pickAt } = setup();
    open();
    controller.setMode('flat');
    pickAt('q');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('move', 12, 0));
    expect(controller.hud.get()?.field).toBeNull();
  });

  it('shows value · displayScale', () => {
    const { controller, open, pickAt } = setup({ displayScale: 2 });
    open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    expect(controller.hud.get()?.field?.value).toBe(20);
  });
});

describe('createManipulatorController – setValue (M19)', () => {
  it('writes shown / displayScale clipped, without snapping', () => {
    const { controller, open } = setup({ displayScale: 2 });
    const session = open();
    controller.setValue('a', 7.3);
    expect(paramsOf(session)['x']).toBeCloseTo(3.65);
    controller.setValue('a', -4);
    expect(paramsOf(session)['x']).toBe(0);
  });

  it('writes nothing for the same value, an unknown, a hidden or a non-scalar handle', () => {
    const { controller, open } = setup();
    const session = open();
    const setParams = vi.spyOn(session, 'setParams');
    controller.setValue('a', 10);
    controller.setValue('unknown', 3);
    controller.setMode('flat');
    controller.setValue('a', 3);
    controller.setValue('q', 3);
    expect(setParams).not.toHaveBeenCalled();
  });

  it('does nothing during a drag', () => {
    const { controller, open, pickAt } = setup();
    const session = open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    const setParams = vi.spyOn(session, 'setParams');
    controller.setValue('a', 3);
    controller.setValue('b', 0.5);
    expect(setParams).not.toHaveBeenCalled();
  });

  it('without a manipulator does nothing', () => {
    const { controller } = setup();
    expect(() => {
      controller.setValue('a', 3);
    }).not.toThrow();
  });
});
