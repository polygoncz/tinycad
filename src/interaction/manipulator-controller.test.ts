import { createSequentialIdGenerator } from '@/core';
import type { Vec3 } from '@/core';
import { createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureId, FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { describe, expect, it, vi } from 'vitest';
import { createFeatureEditor } from './feature-editor';
import { createManipulatorController } from './manipulator-controller';
import { createManipulatorRegistry } from './manipulators';
import type { FeatureAnchors } from './regen-status-port';
import type { Handle, HandleUnit, ManipulatorDescriptor } from './manipulators';
import { FakeRegenStatus, FakeViewport } from './testing';
import type { KeyMods, ViewKeyEvent, ViewPointerEvent } from './viewport-port';

// The test feature: a linear handle 'a' over x along +X from the anchor 'base', and an angular
// handle 'b' around +Z at the anchor that switches mode to 'b' and sets angle (like a circle of
// another axis in Transform).

interface GizmoParams {
  readonly x: number;
  readonly mode: string;
  readonly angle: number;
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
    ],
  },
  angle: { kind: 'angle', label: 'Angle', default: 0.3 },
};

const GIZMO_SCHEMA: FeatureSchema<GizmoParams> = {
  type: 'gizmo',
  version: 1,
  label: 'Gizmo',
  params: GIZMO_PARAMS,
  defaults: () => ({ x: 10, mode: 'a', angle: 0.3 }),
  validate: (params) => validateAgainstSchema(GIZMO_PARAMS, params),
};

function gizmoDescriptor(options: { display?: (v: number) => number } = {}) {
  const descriptor: ManipulatorDescriptor<GizmoParams> = {
    type: 'gizmo',
    handles(p, anchors) {
      const base = anchors['base'];
      if (base === undefined) return [];
      const [bx, by, bz] = base.point;
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
        ...(options.display === undefined ? {} : { display: options.display }),
      };
      const b: Handle = {
        kind: 'angular',
        id: 'b',
        center: base.point,
        axis: [0, 0, 1],
        zero: [1, 0, 0],
        value: p.mode === 'b' ? p.angle : 0,
        unit: 'angle',
        tint: 'z',
        toParams: (v) => ({ mode: 'b', angle: v }),
      };
      return [a, b];
    },
  };
  return descriptor;
}

const NO_MODS: KeyMods = { shift: false, alt: false, mod: false };
const SHIFT: KeyMods = { shift: true, alt: false, mod: false };
const ORIGIN: FeatureAnchors = { base: { point: [0, 0, 0] } };

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

const format = (value: number, unit: HandleUnit): string => `${String(value)} ${unit}`;

function setup(options: { display?: (v: number) => number; register?: boolean } = {}) {
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
  const controller = createManipulatorController({
    features,
    regen,
    registry,
    viewport,
    formatValue: format,
  });
  /** Opens a dialog and publishes a regeneration with the anchors of its feature. */
  function open(anchors: FeatureAnchors = ORIGIN) {
    const session = features.create('gizmo');
    regen.publish(new Map(), [], [], new Map([[session.featureId, anchors]]));
    return session;
  }
  /** The handle under the cursor: 'a' near (10, 0) on the arrow, 'b' elsewhere near the circle. */
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
      },
      { kind: 'angular', id: 'b', center: [1, 2, 3], axis: [0, 0, 1], tint: 'z', state: 'idle' },
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
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    pickAt('b');
    controller.onPointer(at('down', 10, 0));
    controller.onPointer(at('move', 0, 10));
    expect(paramsOf(session)['mode']).toBe('b');

    expect(controller.onKey(key('Escape'))).toBe(true);
    expect(paramsOf(session)).toEqual({ x: 10, mode: 'a', angle: 0.3 });
    expect(viewport.manipulatorLabel).toBeNull();
    // The drag is over: a move does not write any more.
    pickAt(null);
    expect(controller.onPointer(at('move', 0, -10))).toBe(false);
    expect(paramsOf(session)).toEqual({ x: 10, mode: 'a', angle: 0.3 });
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
    expect(viewport.manipulatorLabel).toBeNull();
    // Writing into the closed session would throw.
    expect(controller.onPointer(at('move', 14, 0))).toBe(false);
    expect(controller.onPointer(at('up', 14, 0))).toBe(false);
    expect(controller.onKey(key('Escape'))).toBe(false);
  });

  it('the label follows the cursor with the formatted display value', () => {
    const { viewport, controller, open, pickAt } = setup({ display: (v) => 2 * v });
    open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    expect(viewport.manipulatorLabel).toEqual({ x: 26, y: 16, text: '20 length' });
    controller.onPointer(at('move', 13, 1));
    expect(viewport.manipulatorLabel).toEqual({ x: 29, y: 17, text: '26 length' });
    controller.onPointer(at('up', 13, 1));
    expect(viewport.manipulatorLabel).toBeNull();
  });
});

describe('createManipulatorController – dispose', () => {
  it('clears views and label, unsubscribes; a second dispose does nothing', () => {
    const { viewport, controller, open, pickAt } = setup();
    const session = open();
    pickAt('a');
    controller.onPointer(at('down', 10, 0));
    controller.dispose();
    expect(viewport.manipulatorViews).toEqual([]);
    expect(viewport.manipulatorLabel).toBeNull();

    const set = vi.spyOn(viewport.manipulators, 'set');
    const setLabel = vi.spyOn(viewport.manipulators, 'setLabel');
    session.setParam('x', 20);
    controller.dispose();
    expect(controller.onPointer(at('move', 12, 0))).toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(setLabel).not.toHaveBeenCalled();
    expect(paramsOf(session)['x']).toBe(20);
  });
});
