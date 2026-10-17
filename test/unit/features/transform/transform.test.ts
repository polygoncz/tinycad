import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator, mat4, vec3 } from '@/core';
import type { Vec3 } from '@/core';
import type { BodyId, FeatureSchema } from '@/document';
import { aDocument, aFeature, anEvaluated } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type {
  AngularHandle,
  FeatureAnchors,
  FeatureEditor,
  FeatureEditSession,
  Handle,
  LinearHandle,
  ManipulatorFrame,
  PlanarHandle,
  PointHandle,
} from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import type { TransformParams } from '@/features/transform/params';
import { transformMessages } from '@/features/transform/messages';
import { transformTool } from '@/features/transform/tool';
import { transformManipulators } from '@/features/transform/manipulators';
import * as transform from '@/features/transform';

// The client half of the transform feature (N123): the schema and the builder are the core's, so
// the plugin, its manipulator and its tool are tested here.

/** An axis-aligned box: a body before and after the transform. */
interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

const ORIGIN: Vec3 = [0, 0, 0];

/** The defaults of the core with the body b1 picked. */
const DEFAULTS: TransformParams = {
  // Test data: the id has the shape bodyId mints.
  bodies: [{ kind: 'body', body: 'b1/body' as BodyId }],
  pivot: 'bodiesCenter',
  pivotPoint: [0, 0, 0],
  translate: [0, 0, 0],
  rx: 0,
  ry: 0,
  rz: 0,
};

function expectVec(actual: Vec3 | undefined, expected: Vec3): void {
  if (actual === undefined) expect.fail('No vector');
  for (let i = 0; i < 3; i++) {
    expect(actual[i], `[${String(i)}]`).toBeCloseTo(expected[i] ?? Number.NaN, 9);
  }
}

function expectBox(actual: Box, expected: Box): void {
  for (let i = 0; i < 3; i++) {
    expect(actual.min[i], `min[${String(i)}]`).toBeCloseTo(expected.min[i] ?? Number.NaN, 9);
    expect(actual.max[i], `max[${String(i)}]`).toBeCloseTo(expected.max[i] ?? Number.NaN, 9);
  }
}

/** The schema of the open edit session; the tool never reads it. */
const SCHEMA: FeatureSchema = {
  type: 'transform',
  version: 3,
  label: 'transform.label',
  params: {},
  defaults: () => ({}),
  validate: () => [],
  migrate: () => ({}),
};

describe('transform public API', () => {
  it('exports exactly transformPlugin', () => {
    expect(Object.keys(transform)).toEqual(['transformPlugin']);
  });

  it('transformPlugin joins the type, messages, tool and manipulators of transform', () => {
    expect(transform.transformPlugin.type).toBe('transform');
    expect(transform.transformPlugin.messages).toBe(transformMessages);
    expect(transform.transformPlugin.tools).toEqual([transformTool]);
    expect(transform.transformPlugin.manipulators).toBe(transformManipulators);
    expect(transformManipulators.type).toBe('transform');
  });
});

describe('transformManipulators', () => {
  const ANCHORS = { pivot: { point: [1, 2, 3] as Vec3 } };
  const params = (overrides: Partial<TransformParams> = {}): TransformParams => ({
    ...DEFAULTS,
    pivot: 'bodiesCenter',
    translate: [10, 20, 30],
    ...overrides,
  });
  const DEG = Math.PI / 180;

  function frameOf(p: TransformParams, anchors: FeatureAnchors, mode = 'free'): ManipulatorFrame {
    const frame = transformManipulators.frame(anEvaluated(p), anchors, mode);
    if (frame === null) expect.fail('no frame');
    return frame;
  }
  function handlesOf(
    p: TransformParams,
    anchors: FeatureAnchors,
    mode = 'free',
  ): readonly Handle[] {
    return frameOf(p, anchors, mode).handles;
  }

  function handle(handles: readonly Handle[], id: string): Handle {
    const found = handles.find((h) => h.id === id);
    if (found === undefined) expect.fail(`No handle ${id}`);
    return found;
  }
  function linear(handles: readonly Handle[], id: string): LinearHandle {
    const h = handle(handles, id);
    if (h.kind !== 'linear') expect.fail(`${id} is not linear`);
    return h;
  }
  function angular(handles: readonly Handle[], id: string): AngularHandle {
    const h = handle(handles, id);
    if (h.kind !== 'angular') expect.fail(`${id} is not angular`);
    return h;
  }
  function planar(handles: readonly Handle[], id: string): PlanarHandle {
    const h = handle(handles, id);
    if (h.kind !== 'planar') expect.fail(`${id} is not planar`);
    return h;
  }
  function point(handles: readonly Handle[], id: string): PointHandle {
    const h = handle(handles, id);
    if (h.kind !== 'point') expect.fail(`${id} is not a point`);
    return h;
  }

  /** R = Rz · Ry · Rx applied to a vector, computed here on its own from the world axes. */
  function rotate(p: Pick<TransformParams, 'rx' | 'ry' | 'rz'>, v: Vec3): Vec3 {
    const r = mat4.multiply(
      mat4.rotationAxisAngle([0, 0, 1], p.rz),
      mat4.multiply(
        mat4.rotationAxisAngle([0, 1, 0], p.ry),
        mat4.rotationAxisAngle([1, 0, 0], p.rx),
      ),
    );
    // A pure rotation: transforming the vector as a point is R · v.
    return mat4.transformPoint(r, v);
  }

  /**
   * The body box `input` after the transform `p`, as the core moves it (spec 07): the rotation
   * through the pivot first, then the translation, T(translate) · T(pivot) · R · T(−pivot), and the
   * anchors the core gives with it (the center of the input box for 'bodiesCenter').
   */
  function transformed(p: TransformParams, input: Box): { box: Box; anchors: FeatureAnchors } {
    const center = vec3.scale(vec3.add(input.min, input.max), 0.5);
    const anchors: FeatureAnchors = p.pivot === 'bodiesCenter' ? { pivot: { point: center } } : {};
    const pivot = p.pivot === 'bodiesCenter' ? center : p.pivot === 'point' ? p.pivotPoint : ORIGIN;
    const turned = (corner: Vec3): Vec3 =>
      vec3.add(vec3.add(rotate(p, vec3.sub(corner, pivot)), pivot), p.translate);
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      turned([
        i & 1 ? input.max[0] : input.min[0],
        i & 2 ? input.max[1] : input.min[1],
        i & 4 ? input.max[2] : input.min[2],
      ]),
    );
    const along = (axis: 0 | 1 | 2) => corners.map((c) => c[axis]);
    return {
      box: {
        min: [Math.min(...along(0)), Math.min(...along(1)), Math.min(...along(2))],
        max: [Math.max(...along(0)), Math.max(...along(1)), Math.max(...along(2))],
      },
      anchors,
    };
  }

  describe('modes', () => {
    it('are free, move, rotate and pivot in this order; only pivot picks a point', () => {
      expect(transformManipulators.modes).toEqual([
        { id: 'free', label: 'transform.mode.free', icon: 'arrows-move' },
        { id: 'move', label: 'transform.mode.move', icon: 'arrows-up-down' },
        { id: 'rotate', label: 'transform.mode.rotate', icon: 'rotate-clockwise' },
        { id: 'pivot', label: 'transform.mode.pivot', icon: 'focus-2', picksPoint: true },
      ]);
    });

    it('are frozen', () => {
      const modes = transformManipulators.modes ?? expect.fail('no modes');
      expect(Object.isFrozen(modes)).toBe(true);
      for (const mode of modes) expect(Object.isFrozen(mode), mode.id).toBe(true);
    });

    it.each([
      ['free', ['tx', 'ty', 'tz', 'txy', 'tyz', 'tzx', 'tc', 'rx', 'ry', 'rz']],
      ['move', ['tx', 'ty', 'tz', 'txy', 'tyz', 'tzx', 'tc']],
      ['rotate', ['rx', 'ry', 'rz']],
      ['pivot', ['px', 'py', 'pz', 'pxy', 'pyz', 'pzx', 'pc']],
    ] as const)('%s has the handles %j', (mode, ids) => {
      expect(handlesOf(params(), ANCHORS, mode).map((h) => h.id)).toEqual(ids);
    });

    it('the handles of the pivot mode have ids of their own', () => {
      const pivot = handlesOf(params(), ANCHORS, 'pivot').map((h) => h.id);
      const free = handlesOf(params(), ANCHORS, 'free').map((h) => h.id);
      expect(pivot.filter((id) => free.includes(id))).toEqual([]);
    });

    it('rings are quarter circles in free and full circles in rotate', () => {
      for (const id of ['rx', 'ry', 'rz']) {
        expect(angular(handlesOf(params(), ANCHORS, 'free'), id).extent, id).toBe('quarter');
        expect(angular(handlesOf(params(), ANCHORS, 'rotate'), id).extent, id).toBe('full');
      }
    });

    it('only the handles of the pivot mode are dashed', () => {
      for (const mode of ['free', 'move', 'rotate', 'pivot']) {
        for (const h of handlesOf(params(), ANCHORS, mode)) {
          expect(h.dashed === true, `${mode}: ${h.id}`).toBe(mode === 'pivot');
        }
      }
    });

    it('an unknown mode gives no frame', () => {
      expect(transformManipulators.frame(anEvaluated(params()), ANCHORS, '')).toBeNull();
      expect(transformManipulators.frame(anEvaluated(params()), ANCHORS, 'scale')).toBeNull();
    });
  });

  describe('frame', () => {
    it('bodiesCenter gives no frame without the anchor pivot', () => {
      for (const mode of ['free', 'move', 'rotate', 'pivot']) {
        expect(transformManipulators.frame(anEvaluated(params()), {}, mode), mode).toBeNull();
      }
    });

    it('the center of the frame is pivot + translate in every mode', () => {
      for (const mode of ['free', 'move', 'rotate', 'pivot']) {
        expect(frameOf(params(), ANCHORS, mode).center, mode).toEqual([11, 22, 33]);
      }
    });

    it('origin: the handles stand at translate without any anchor', () => {
      const handles = handlesOf(params({ pivot: 'origin' }), {});
      expect(linear(handles, 'tx').position).toEqual([10, 20, 30]);
      expect(angular(handles, 'rz').center).toEqual([10, 20, 30]);
    });

    it('point: the handles stand at pivotPoint + translate without any anchor', () => {
      const handles = handlesOf(params({ pivot: 'point', pivotPoint: [-1, 0, 2] }), {});
      expect(linear(handles, 'tz').position).toEqual([9, 20, 32]);
      expect(angular(handles, 'rx').center).toEqual([9, 20, 32]);
    });

    it('origin and point ignore a stale anchor pivot', () => {
      const origin = handlesOf(params({ pivot: 'origin' }), ANCHORS);
      expect(linear(origin, 'tx').position).toEqual([10, 20, 30]);
      const pt = handlesOf(params({ pivot: 'point', pivotPoint: [-1, 0, 2] }), ANCHORS);
      expect(linear(pt, 'tx').position).toEqual([9, 20, 32]);
    });

    it('the frame, the handles and their vectors are frozen', () => {
      for (const mode of ['free', 'move', 'rotate', 'pivot']) {
        const frame = frameOf(params({ rz: 0.3 }), ANCHORS, mode);
        expect(Object.isFrozen(frame), mode).toBe(true);
        expect(Object.isFrozen(frame.center), mode).toBe(true);
        expect(Object.isFrozen(frame.handles), mode).toBe(true);
        for (const h of frame.handles) {
          expect(Object.isFrozen(h), h.id).toBe(true);
          const vectors = Object.values(h).filter((v) => Array.isArray(v));
          for (const v of vectors) expect(Object.isFrozen(v), h.id).toBe(true);
        }
      }
    });
  });

  describe('translation (free, move)', () => {
    it('arrows stand at c along the world axes with the translate values, even when rotated', () => {
      const handles = handlesOf(params({ rx: 0.4, rz: 1.1 }), ANCHORS, 'move');
      const expected: readonly [string, Vec3, number, string][] = [
        ['tx', [1, 0, 0], 10, 'x'],
        ['ty', [0, 1, 0], 20, 'y'],
        ['tz', [0, 0, 1], 30, 'z'],
      ];
      for (const [id, direction, value, tint] of expected) {
        const h = linear(handles, id);
        expect(h.position, id).toEqual([11, 22, 33]);
        expect(h.direction, id).toEqual(direction);
        expect(h.value, id).toBe(value);
        expect([h.unit, h.tint], id).toEqual(['length', tint]);
      }
    });

    it('toParams of ty changes only the y of translate', () => {
      const ty = linear(handlesOf(params(), ANCHORS), 'ty');
      expect(ty.toParams(-4)).toEqual({ translate: [10, -4, 30] });
    });

    it('squares stand at c between two world axes, tinted by the normal', () => {
      const handles = handlesOf(params({ ry: 0.8 }), ANCHORS, 'move');
      const expected: readonly [string, Vec3, Vec3, string, readonly [number, number]][] = [
        ['txy', [1, 0, 0], [0, 1, 0], 'z', [10, 20]],
        ['tyz', [0, 1, 0], [0, 0, 1], 'x', [20, 30]],
        ['tzx', [0, 0, 1], [1, 0, 0], 'y', [30, 10]],
      ];
      for (const [id, u, v, tint, value] of expected) {
        const h = planar(handles, id);
        expect(h.origin, id).toEqual([11, 22, 33]);
        expect([h.u, h.v], id).toEqual([u, v]);
        expect([h.unit, h.tint], id).toEqual(['length', tint]);
        expect(h.value, id).toEqual(value);
      }
    });

    it('toParams of a square changes its two components of translate', () => {
      const handles = handlesOf(params(), ANCHORS, 'move');
      expect(planar(handles, 'txy').toParams([1, 2])).toEqual({ translate: [1, 2, 30] });
      expect(planar(handles, 'tyz').toParams([1, 2])).toEqual({ translate: [10, 1, 2] });
      expect(planar(handles, 'tzx').toParams([1, 2])).toEqual({ translate: [2, 20, 1] });
    });

    it('the center point stands at c, is neutral and writes the whole translate', () => {
      const tc = point(handlesOf(params(), ANCHORS, 'free'), 'tc');
      expect(tc.position).toEqual([11, 22, 33]);
      expect([tc.unit, tc.tint]).toEqual(['length', 'neutral']);
      expect(tc.value).toEqual([10, 20, 30]);
      expect(tc.toParams([-1, 5, 7])).toEqual({ translate: [-1, 5, 7] });
    });
  });

  describe('rotation (free, rotate)', () => {
    it('without rotation the rings lie about Z, Y, X with zero X, Z, Y', () => {
      const handles = handlesOf(params(), ANCHORS, 'rotate');
      const expected: readonly [string, Vec3, Vec3, string][] = [
        ['rx', [1, 0, 0], [0, 1, 0], 'x'],
        ['ry', [0, 1, 0], [0, 0, 1], 'y'],
        ['rz', [0, 0, 1], [1, 0, 0], 'z'],
      ];
      for (const [id, axis, zero, tint] of expected) {
        const h = angular(handles, id);
        expect(h.center, id).toEqual([11, 22, 33]);
        expectVec(h.axis, axis);
        expectVec(h.zero, zero);
        expect([h.unit, h.tint], id).toEqual(['angle', tint]);
      }
    });

    it('every ring has its own angle and writes only it', () => {
      const handles = handlesOf(params({ rx: 0.1, ry: 0.2, rz: 0.3 }), ANCHORS, 'free');
      expect(angular(handles, 'rx').value).toBe(0.1);
      expect(angular(handles, 'ry').value).toBe(0.2);
      expect(angular(handles, 'rz').value).toBe(0.3);
      expect(angular(handles, 'rx').toParams(1)).toEqual({ rx: 1 });
      expect(angular(handles, 'ry').toParams(2)).toEqual({ ry: 2 });
      expect(angular(handles, 'rz').toParams(3)).toEqual({ rz: 3 });
    });

    it('gimbal: after rz = 90° the ring ry lies about -X and rx about Y', () => {
      const handles = handlesOf(params({ rz: 90 * DEG }), ANCHORS, 'rotate');
      expectVec(angular(handles, 'rz').axis, [0, 0, 1]);
      expectVec(angular(handles, 'rz').zero, [1, 0, 0]);
      expectVec(angular(handles, 'ry').axis, [-1, 0, 0]);
      expectVec(angular(handles, 'ry').zero, [0, 0, 1]);
      expectVec(angular(handles, 'rx').axis, [0, 1, 0]);
      expectVec(angular(handles, 'rx').zero, [-1, 0, 0]);
    });

    it('gimbal: after ry = 90° and rz = 90° the ring rx lies about -Z', () => {
      const handles = handlesOf(params({ ry: 90 * DEG, rz: 90 * DEG }), ANCHORS, 'rotate');
      expectVec(angular(handles, 'rx').axis, [0, 0, -1]);
      expectVec(angular(handles, 'rx').zero, [-1, 0, 0]);
    });

    it('turning a ring by d turns the result about the axis of the ring by d', () => {
      const angles = { rx: 30 * DEG, ry: -50 * DEG, rz: 110 * DEG };
      const handles = handlesOf(params(angles), ANCHORS, 'rotate');
      const d = 0.4;
      const probe: Vec3 = [0.3, -1.2, 2.5];
      for (const key of ['rx', 'ry', 'rz'] as const) {
        const ring = angular(handles, key);
        const turned = rotate({ ...angles, [key]: angles[key] + d }, probe);
        const aboutRing = mat4.transformPoint(
          mat4.rotationAxisAngle(ring.axis, d),
          rotate(angles, probe),
        );
        expectVec(turned, aboutRing);
        // zero lies on the ring: perpendicular to its axis.
        expect(vec3.dot(ring.zero, ring.axis), key).toBeCloseTo(0, 12);
      }
    });
  });

  describe('pivot', () => {
    it('handles stand at c along the world axes with the components of c as values', () => {
      const handles = handlesOf(params({ rz: 0.5 }), ANCHORS, 'pivot');
      const expected: readonly [string, Vec3, number, string][] = [
        ['px', [1, 0, 0], 11, 'x'],
        ['py', [0, 1, 0], 22, 'y'],
        ['pz', [0, 0, 1], 33, 'z'],
      ];
      for (const [id, direction, value, tint] of expected) {
        const h = linear(handles, id);
        expect(h.position, id).toEqual([11, 22, 33]);
        expect(h.direction, id).toEqual(direction);
        expect(h.value, id).toBe(value);
        expect([h.unit, h.tint], id).toEqual(['length', tint]);
      }
      expect(planar(handles, 'pxy').value).toEqual([11, 22]);
      expect(planar(handles, 'pyz').value).toEqual([22, 33]);
      expect(planar(handles, 'pzx').value).toEqual([33, 11]);
      expect(planar(handles, 'pyz').tint).toBe('x');
      expect(point(handles, 'pc').value).toEqual([11, 22, 33]);
      expect(point(handles, 'pc').tint).toBe('neutral');
    });

    it('without rotation moving c moves the pivot point, translate stays', () => {
      const px = linear(handlesOf(params(), ANCHORS, 'pivot'), 'px');
      const patch = px.toParams(16);
      expect(patch).toEqual({ pivot: 'point', pivotPoint: [6, 2, 3], translate: [10, 20, 30] });
    });

    it('toParams of the pivot always writes pivot, pivotPoint and translate (Esc restores all)', () => {
      const handles = handlesOf(params({ rz: 0.5 }), ANCHORS, 'pivot');
      for (const h of handles) {
        const patch =
          h.kind === 'point'
            ? h.toParams(h.value)
            : h.kind === 'planar'
              ? h.toParams(h.value)
              : h.kind === 'linear'
                ? h.toParams(h.value)
                : expect.fail(`${h.id} is angular`);
        expect(Object.keys(patch).sort(), h.id).toEqual(['pivot', 'pivotPoint', 'translate']);
      }
    });

    it("lens: with rx = 30° and rz = 45° moving px by 5 mm keeps the body, the handles go to c'", () => {
      const buildWith = (p: TransformParams) => transformed(p, { min: [3, -1, 2], max: [5, 3, 8] });
      const before = params({ translate: [7, -2, 4], rx: 30 * DEG, rz: 45 * DEG });
      const first = buildWith(before);
      const c = frameOf(before, first.anchors, 'pivot').center;

      const px = linear(handlesOf(before, first.anchors, 'pivot'), 'px');
      const after: TransformParams = { ...before, ...px.toParams(px.value + 5) };
      const second = buildWith(after);

      expectBox(second.box, first.box);
      expect(after.pivot).toBe('point');
      const moved = handlesOf(after, second.anchors, 'pivot');
      expectVec(linear(moved, 'px').position, [c[0] + 5, c[1], c[2]]);
      expect(linear(moved, 'px').value).toBeCloseTo(c[0] + 5, 9);
      expectVec(frameOf(after, second.anchors, 'free').center, [c[0] + 5, c[1], c[2]]);
    });

    it('lens: the square and the center point keep the body as well', () => {
      const boxOf = (p: TransformParams) => transformed(p, { min: [0, 0, 0], max: [2, 4, 6] }).box;
      const before = params({
        pivot: 'point',
        pivotPoint: [1, 1, 1],
        translate: [2, 3, 4],
        rx: 20 * DEG,
        ry: -35 * DEG,
        rz: 70 * DEG,
      });
      const box = boxOf(before);
      const handles = handlesOf(before, {}, 'pivot');

      const square = planar(handles, 'pyz');
      const viaSquare = {
        ...before,
        ...square.toParams([square.value[0] - 3, square.value[1] + 2]),
      };
      expectBox(boxOf(viaSquare), box);
      expectVec(frameOf(viaSquare, {}, 'pivot').center, [3, 4 - 3, 5 + 2]);

      const viaPoint = { ...before, ...point(handles, 'pc').toParams([-5, 6, 0.5]) };
      expectBox(boxOf(viaPoint), box);
      expectVec(frameOf(viaPoint, {}, 'pivot').center, [-5, 6, 0.5]);
    });
  });

  describe('pickPoint', () => {
    it('in the pivot mode puts the pivot at the point and keeps the body', () => {
      const output = (p: TransformParams) => transformed(p, { min: [0, 0, 0], max: [2, 4, 6] });
      const before = params({ translate: [1, 2, 3], rx: 30 * DEG, rz: 45 * DEG });
      const first = output(before);

      const patch = transformManipulators.pickPoint?.(
        anEvaluated(before),
        first.anchors,
        'pivot',
        [4, 5, 6],
      );
      if (patch === undefined || patch === null) expect.fail('no patch');
      const after: TransformParams = { ...before, ...patch };
      const second = output(after);

      expect(Object.keys(patch).sort()).toEqual(['pivot', 'pivotPoint', 'translate']);
      expectBox(second.box, first.box);
      expectVec(frameOf(after, second.anchors, 'pivot').center, [4, 5, 6]);
    });

    it('gives null outside the pivot mode', () => {
      for (const mode of ['free', 'move', 'rotate', '']) {
        expect(
          transformManipulators.pickPoint?.(anEvaluated(params()), ANCHORS, mode, [4, 5, 6]),
          mode,
        ).toBeNull();
      }
    });

    it('gives null for bodiesCenter without the anchor pivot', () => {
      expect(
        transformManipulators.pickPoint?.(anEvaluated(params()), {}, 'pivot', [4, 5, 6]),
      ).toBeNull();
    });
  });
});

/** A FeatureEditor that records create calls; `open` pretends a session is already open. */
function aRecordingEditor(open = false) {
  const created: string[] = [];
  const session: FeatureEditSession = {
    mode: 'create',
    featureId: aFeature().id,
    schema: SCHEMA,
    state: new ObservableValue({
      params: {},
      issues: [],
      fields: [],
      activeRefParam: null,
      open: true,
      name: 'Transform 1',
    }),
    setParam: () => expect.fail('setParam is not expected'),
    setParams: () => expect.fail('setParams is not expected'),
    removeRef: () => expect.fail('removeRef is not expected'),
    focusRefParam: () => expect.fail('focusRefParam is not expected'),
    commit: () => expect.fail('commit is not expected'),
    cancel: () => expect.fail('cancel is not expected'),
  };
  const current = new ObservableValue<FeatureEditSession | null>(open ? session : null);
  const editor: FeatureEditor = {
    current,
    create(type) {
      created.push(type);
      current.set(session);
      return session;
    },
    edit: () => expect.fail('edit is not expected'),
  };
  return { editor, created };
}

function aToolManager(editor: FeatureEditor) {
  const registry = createToolRegistry();
  registry.register(SELECT_TOOL);
  registry.register(transformTool);
  const viewport = new FakeViewport();
  const manager = createToolManager({
    registry,
    ctx: {
      viewport,
      selection: createSelectionModel({ regen: new FakeRegenStatus() }),
      doc: aDocument(),
      ids: createSequentialIdGenerator('t'),
      features: editor,
    },
    viewportEvents: viewport.events,
    defaultToolId: SELECT_TOOL.id,
  });
  const emitted: string[] = [];
  manager.active.subscribe(() => emitted.push(manager.active.get()));
  return { manager, emitted };
}

describe('transformTool', () => {
  it('is the modify tool transform without a shortcut', () => {
    expect(transformTool).toMatchObject({
      id: 'transform',
      label: 'transform.label',
      icon: 'arrows-move',
      group: 'modify',
    });
    expect(transformTool.shortcut).toBeUndefined();
  });

  it('labels the tool with a key the transform messages translate (ADR 0014)', () => {
    expect(transformMessages.cs[transformTool.label]).toBe('Transformace');
    expect(transformMessages.en[transformTool.label]).toBe('Transform');
  });

  it('opens the dialog for a new transform and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('transform');

    expect(created).toEqual(['transform']);
    expect(emitted).toEqual(['transform', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('transform');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['transform', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(transformTool.create()).not.toBe(transformTool.create());
  });
});
