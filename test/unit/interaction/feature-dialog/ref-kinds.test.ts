import { describe, expect, it } from 'vitest';
import { ORIGIN_AXIS_IDS, parseSketchId, sketchId } from '@/document';
import type {
  BodyId,
  FeatureId,
  ParamSpec,
  RefParamKind,
  RefParamSpec,
  SketchId,
  TopoName,
} from '@/document';
import { aFeature } from '@/document/testing';
import { anOpsSession } from '@/ops/testing';
import { rectangleData } from '@/sketch/testing';
import {
  REF_KIND_BEHAVIOR,
  behaviorOf,
  isRefParamSpec,
  refBehaviorOf,
} from '@/interaction/feature-dialog/ref-kinds';
import type {
  BrowserRefTarget,
  RefHitContext,
  RefKindBehavior,
} from '@/interaction/feature-dialog/ref-kinds';
import { FakeRegenStatus, aTopoNames } from '@/interaction/testing';
import type { PickResult } from '@/interaction/viewport-port';

/**
 * A drawing that is not the artifact of any sketch feature (parseSketchId does not take its id),
 * such as the drawing of the sketch being edited: it cannot be referenced.
 */
const NON_ARTIFACT_DRAWING = 'non-artifact-drawing';

const BODIES: RefParamSpec = { kind: 'bodies', label: 'Targets' };
const EDGES: RefParamSpec = { kind: 'topo', label: 'Edges', entity: 'edge' };
const FACES: RefParamSpec = { kind: 'topo', label: 'Faces', entity: 'face' };
const VERTICES: RefParamSpec = { kind: 'topo', label: 'Vertices', entity: 'vertex' };
const REGIONS: RefParamSpec = { kind: 'region', label: 'Profile' };
const PLANES: RefParamSpec = { kind: 'planes', label: 'Plane' };
const AXIS: RefParamSpec = { kind: 'axis', label: 'Axis' };

const VALUE_SPECS: readonly ParamSpec[] = [
  { kind: 'length', label: 'Width', default: 10 },
  { kind: 'angle', label: 'Angle', default: 0 },
  { kind: 'number', label: 'Count', default: 1 },
  { kind: 'boolean', label: 'Flip', default: false },
  { kind: 'enum', label: 'Mode', default: 'a', options: [{ value: 'a', label: 'A' }] },
  { kind: 'point', label: 'Origin', default: [0, 0, 0] },
  { kind: 'data', label: 'Sketch' },
];

const S1 = 's1' as FeatureId; // test ids are trusted
const S1_DRAWING: SketchId = sketchId(S1);
const BOX = 'b1/body' as BodyId;
const OTHER = 'b2/body' as BodyId;
const TOP_FRONT = 'b1/edge:face:front|face:top' as TopoName;
const TOP = 'b1/face:top' as TopoName;

/** A document with the sketch s1 (a rectangle and a circle k) and a snapshot that names BOX. */
function context(): RefHitContext {
  const rect = rectangleData();
  const sketch = aFeature({
    id: 's1',
    type: 'sketch',
    name: 'Sketch 1',
    params: {
      entities: [
        ...rect.entities,
        { kind: 'point', id: 'o', x: 5, y: 2 },
        { kind: 'circle', id: 'k', center: 'o', radius: 1 },
      ],
      constraints: rect.constraints,
    },
  });
  const ops = anOpsSession({ features: [sketch] });
  const regen = new FakeRegenStatus();
  regen.publish(new Map(), [
    {
      body: BOX,
      feature: 'b1' as FeatureId,
      names: aTopoNames({ edges: { [TOP_FRONT]: [3] }, faces: { [TOP]: [5, 6] } }),
    },
  ]);
  return { doc: ops.doc, snapshot: regen.state.get() };
}

const edgeAt = (body: BodyId, edgeIndex: number): PickResult => ({
  kind: 'edge',
  body,
  edgeIndex,
  point: [0, 0, 0],
});
const faceAt = (body: BodyId, faceIndex: number): PickResult => ({
  kind: 'face',
  body,
  faceIndex,
  point: [0, 0, 0],
  normal: [0, 0, 1],
});
const regionHit = (sketch: string, region: string): PickResult => ({
  kind: 'sketchRegion',
  sketch,
  region,
  point: [0, 0, 0],
});
const entityHit = (sketch: string, entity: string): PickResult => ({
  kind: 'sketchEntity',
  sketch,
  entity,
  point: [0, 0, 0],
});

describe('REF_KIND_BEHAVIOR', () => {
  it('has one frozen entry per reference kind, at runtime too', () => {
    expect(Object.keys(REF_KIND_BEHAVIOR).sort()).toEqual([
      'axis',
      'bodies',
      'planes',
      'region',
      'topo',
    ]);
    expect(Object.isFrozen(REF_KIND_BEHAVIOR)).toBe(true);
    for (const behavior of Object.values(REF_KIND_BEHAVIOR)) {
      expect(Object.isFrozen(behavior)).toBe(true);
    }
  });

  it('a table without one kind is a type error', () => {
    const incomplete = {
      bodies: REF_KIND_BEHAVIOR.bodies,
      topo: REF_KIND_BEHAVIOR.topo,
      region: REF_KIND_BEHAVIOR.region,
      axis: REF_KIND_BEHAVIOR.axis,
    };
    // @ts-expect-error -- 'planes' is missing
    const table = incomplete satisfies { readonly [K in RefParamKind]: RefKindBehavior };
    expect(Object.keys(table)).not.toContain('planes');
  });
});

describe('isRefParamSpec / behaviorOf / refBehaviorOf', () => {
  it.each([BODIES, EDGES, REGIONS, PLANES, AXIS])('$kind has the behaviour of its kind', (spec) => {
    expect(isRefParamSpec(spec)).toBe(true);
    expect(behaviorOf(spec)).toBe(REF_KIND_BEHAVIOR[spec.kind]);
    expect(refBehaviorOf(spec)).toBe(REF_KIND_BEHAVIOR[spec.kind]);
  });

  it.each(VALUE_SPECS)('a value param ($kind) has none', (spec) => {
    expect(isRefParamSpec(spec)).toBe(false);
    expect(refBehaviorOf(spec)).toBeNull();
  });
});

describe('pickFilter (spec 10, "Referenční parametr dialogu")', () => {
  it('bodies: a hit on anything is the body, so faces and edges', () => {
    expect([...behaviorOf(BODIES).pickFilter(BODIES)].sort()).toEqual(['edge', 'face']);
  });

  it.each([
    [FACES, ['face']],
    [EDGES, ['edge']],
    // pick returns no vertices (R101).
    [VERTICES, []],
  ] as const)('topo %#: the entity of the spec', (spec, filter) => {
    expect(behaviorOf(spec).pickFilter(spec)).toEqual(filter);
  });

  it('region: sketch regions (M13)', () => {
    expect(behaviorOf(REGIONS).pickFilter(REGIONS)).toEqual(['sketchRegion']);
  });

  it('axis: sketch entities, an axis drawing or a line of a sketch (M13)', () => {
    expect(behaviorOf(AXIS).pickFilter(AXIS)).toEqual(['sketchEntity']);
  });

  it('planes: nothing, a known gap (M12, M20)', () => {
    expect(behaviorOf(PLANES).pickFilter(PLANES)).toEqual([]);
  });
});

describe('fromHit', () => {
  it('bodies: a face or an edge adds the body, a second hit removes it', () => {
    const ctx = context();
    const added = behaviorOf(BODIES).fromHit(edgeAt(BOX, 3), [], ctx);
    expect(added).toEqual({ value: [{ kind: 'body', body: BOX }] });
    const removed = behaviorOf(BODIES).fromHit(faceAt(BOX, 1), added?.value, ctx);
    expect(removed).toEqual({ value: [] });
    expect(behaviorOf(BODIES).fromHit(regionHit(S1_DRAWING, 'r'), [], ctx)).toBeNull();
  });

  it('topo: a named hit adds a TopoRef, a second one removes it; no name, no snapshot → null', () => {
    const ctx = context();
    const added = behaviorOf(EDGES).fromHit(edgeAt(BOX, 3), [], ctx);
    expect(added).toEqual({ value: [{ kind: 'topo', body: BOX, name: TOP_FRONT }] });
    expect(behaviorOf(EDGES).fromHit(edgeAt(BOX, 3), added?.value, ctx)).toEqual({ value: [] });
    expect(behaviorOf(EDGES).fromHit(edgeAt(BOX, 4), [], ctx)).toBeNull();
    expect(behaviorOf(EDGES).fromHit(edgeAt(OTHER, 3), [], ctx)).toBeNull();
    expect(
      behaviorOf(EDGES).fromHit(edgeAt(BOX, 3), [], { ...ctx, snapshot: undefined }),
    ).toBeNull();
  });

  it('region: a region of a regenerated sketch is added and removed, the edited one is not taken', () => {
    const ctx = context();
    const added = behaviorOf(REGIONS).fromHit(regionHit(S1_DRAWING, 'r1'), [], ctx);
    expect(added).toEqual({ value: [{ kind: 'region', sketch: S1, region: 'r1' }] });
    expect(behaviorOf(REGIONS).fromHit(regionHit(S1_DRAWING, 'r1'), added?.value, ctx)).toEqual({
      value: [],
    });
    // The rule: a drawing whose id parseSketchId does not take cannot be referenced.
    expect(parseSketchId(NON_ARTIFACT_DRAWING)).toBeUndefined();
    expect(behaviorOf(REGIONS).fromHit(regionHit(NON_ARTIFACT_DRAWING, 'r1'), [], ctx)).toBeNull();
  });

  it('axis: an origin axis or a line of a sketch is set, the same one again clears it', () => {
    const ctx = context();
    const axis = behaviorOf(AXIS).fromHit(entityHit(ORIGIN_AXIS_IDS.z, 'axis'), null, ctx);
    expect(axis).toEqual({ value: { kind: 'axis', axis: ORIGIN_AXIS_IDS.z } });
    // A wrapper, because the cleared value null is a value too.
    expect(
      behaviorOf(AXIS).fromHit(entityHit(ORIGIN_AXIS_IDS.z, 'axis'), axis?.value, ctx),
    ).toEqual({ value: null });
    expect(behaviorOf(AXIS).fromHit(entityHit(S1_DRAWING, 'ab'), null, ctx)).toEqual({
      value: { kind: 'sketchEntity', sketch: S1, entity: 'ab' },
    });
    // A circle, a drawing that is not an artifact.
    expect(behaviorOf(AXIS).fromHit(entityHit(S1_DRAWING, 'k'), null, ctx)).toBeNull();
    expect(behaviorOf(AXIS).fromHit(entityHit(NON_ARTIFACT_DRAWING, 'ab'), null, ctx)).toBeNull();
  });

  it('planes: takes nothing', () => {
    expect(behaviorOf(PLANES).fromHit(faceAt(BOX, 5), [], context())).toBeNull();
  });
});

describe('hovers', () => {
  it('topo and axis hover only hits they can take, the others every hit of the filter', () => {
    const ctx = context();
    expect(behaviorOf(EDGES).hovers(edgeAt(BOX, 3), ctx)).toBe(true);
    expect(behaviorOf(EDGES).hovers(edgeAt(BOX, 4), ctx)).toBe(false);
    expect(behaviorOf(AXIS).hovers(entityHit(S1_DRAWING, 'ab'), ctx)).toBe(true);
    expect(behaviorOf(AXIS).hovers(entityHit(S1_DRAWING, 'k'), ctx)).toBe(false);
    expect(behaviorOf(BODIES).hovers(edgeAt(OTHER, 9), ctx)).toBe(true);
    // Not taken by a click, yet hovered as before M20.
    expect(behaviorOf(REGIONS).hovers(regionHit(NON_ARTIFACT_DRAWING, 'r1'), ctx)).toBe(true);
  });
});

describe('highlightTargets', () => {
  const { snapshot } = context();

  it('bodies: body targets, only with a snapshot', () => {
    const value = [{ kind: 'body', body: BOX }, { kind: 'x' }];
    expect(behaviorOf(BODIES).highlightTargets(value, BODIES, snapshot)).toEqual([
      { kind: 'body', body: BOX },
    ]);
    expect(behaviorOf(BODIES).highlightTargets(value, BODIES, undefined)).toEqual([]);
  });

  it('topo: the faces or edges of the name by the entity, only with a snapshot', () => {
    const faces = [{ kind: 'topo', body: BOX, name: TOP }];
    expect(behaviorOf(FACES).highlightTargets(faces, FACES, snapshot)).toEqual([
      { kind: 'face', body: BOX, faceIndex: 5 },
      { kind: 'face', body: BOX, faceIndex: 6 },
    ]);
    const edges = [{ kind: 'topo', body: BOX, name: TOP_FRONT }];
    expect(behaviorOf(EDGES).highlightTargets(edges, EDGES, snapshot)).toEqual([
      { kind: 'edge', body: BOX, edgeIndex: 3 },
    ]);
    expect(behaviorOf(VERTICES).highlightTargets(edges, VERTICES, snapshot)).toEqual([]);
    expect(behaviorOf(EDGES).highlightTargets(edges, EDGES, undefined)).toEqual([]);
  });

  it('region: the regions of the sketch drawing, also without a snapshot', () => {
    const value = [{ kind: 'region', sketch: S1, region: 'r1' }];
    expect(behaviorOf(REGIONS).highlightTargets(value, REGIONS, undefined)).toEqual([
      { kind: 'sketchRegion', sketch: S1_DRAWING, region: 'r1' },
    ]);
  });

  it('planes and axis: nothing', () => {
    expect(
      behaviorOf(PLANES).highlightTargets(
        [{ kind: 'plane', plane: 'origin/plane:xy' }],
        PLANES,
        snapshot,
      ),
    ).toEqual([]);
    expect(
      behaviorOf(AXIS).highlightTargets({ kind: 'axis', axis: ORIGIN_AXIS_IDS.x }, AXIS, snapshot),
    ).toEqual([]);
  });
});

describe('browserAccepts, focusable, autoFocus', () => {
  const TARGETS: readonly BrowserRefTarget[] = ['body', 'plane', 'axis', 'region'];
  const accepted = (spec: RefParamSpec): BrowserRefTarget[] =>
    TARGETS.filter((target) => behaviorOf(spec).browserAccepts(target));

  it.each([
    [BODIES, ['body']],
    // Known gap (M20): the Browser takes nothing into topo and planes.
    [EDGES, []],
    [REGIONS, ['region']],
    [PLANES, []],
    [AXIS, ['axis']],
  ] as const)('%o takes the rows %j', (spec, rows) => {
    expect(accepted(spec)).toEqual(rows);
  });

  it('every kind is focusable; all but planes are focused on create (M12)', () => {
    for (const spec of [BODIES, EDGES, REGIONS, PLANES, AXIS]) {
      expect(behaviorOf(spec).focusable).toBe(true);
      expect(behaviorOf(spec).autoFocus).toBe(spec.kind !== 'planes');
    }
  });
});

describe('chips, refText, preselect', () => {
  it('bodies and topo have chips, the other kinds none', () => {
    const { doc } = context();
    expect(behaviorOf(BODIES).chips([{ kind: 'x' }], BODIES, doc)).toEqual([
      {
        index: 0,
        body: null,
        label: null,
        text: { key: 'field.refs.missing', params: {} },
        missing: true,
      },
    ]);
    expect(
      behaviorOf(EDGES).chips([{ kind: 'topo', body: BOX, name: TOP_FRONT }], EDGES, doc),
    ).toEqual([
      {
        index: 0,
        body: BOX,
        label: null,
        text: { key: 'ref.edge', params: { n: '1' } },
        missing: false,
      },
    ]);
    for (const spec of [REGIONS, PLANES, AXIS]) {
      expect(behaviorOf(spec).chips([], spec, doc)).toBeNull();
    }
  });

  it('only axis has a text', () => {
    const { doc } = context();
    expect(behaviorOf(AXIS).refText({ kind: 'axis', axis: ORIGIN_AXIS_IDS.z }, doc)).toEqual({
      key: 'origin.axis.z',
      params: {},
    });
    expect(behaviorOf(AXIS).refText(null, doc)).toBeNull();
    for (const spec of [BODIES, EDGES, REGIONS, PLANES]) {
      expect(behaviorOf(spec).refText([], doc)).toBeNull();
    }
  });

  it('region preselects the only region of the last sketch; the other kinds nothing', () => {
    const regen = new FakeRegenStatus();
    regen.publish(new Map(), [], [{ sketch: S1_DRAWING, feature: S1, regions: ['r1'] }]);
    const snapshot = regen.state.get();
    expect(behaviorOf(REGIONS).preselect(snapshot)).toEqual({
      value: [{ kind: 'region', sketch: S1, region: 'r1' }],
    });
    for (const spec of [BODIES, EDGES, PLANES, AXIS]) {
      expect(behaviorOf(spec).preselect(snapshot)).toBeNull();
    }
    regen.publish(new Map(), [], [{ sketch: S1_DRAWING, feature: S1, regions: ['r1', 'r2'] }]);
    expect(behaviorOf(REGIONS).preselect(regen.state.get())).toBeNull();
  });
});
