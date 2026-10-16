// The splines of M29 end to end over the OCCT kernel in the calling thread, wired like app does
// it (document, dispatcher, log, UndoManager, Regenerator, FeatureEditor, SketchEditor with the
// real planegcs solver and the plugins sketch and extrude). The sketch data go in directly
// through the dialog (the spline tools come with task 8):
// - a profile of three lines and one spline (a bspline, or a fitSpline from bspline.interpolate)
//   extrudes into a valid body whose spline side face is face:side:<spline id> and whose volume
//   is the area of the profile (from a fine tessellation) times the distance;
// - dragging a fit point of a fitSpline with the real solver keeps the spline through all fit
//   points; the solved data pass parseSketchData and still extrude;
// - a spline crossing a line is the crossing warning of the sketch, without regions.

import { beforeAll, describe, expect, it } from 'vitest';
import { bspline, createSequentialIdGenerator } from '@/core';
import type { Plane, Vec2, Vec3 } from '@/core';
import {
  ORIGIN_PLANES,
  ORIGIN_PLANE_IDS,
  bodyId,
  createDocument,
  createFeatureSchemaRegistry,
} from '@/document';
import type { DocumentId, FeatureId, PlaneId, SketchRegionRef, TopoName } from '@/document';
import { extrudePlugin } from '@/features/extrude';
import { sketchPlugin } from '@/features/sketch';
import { createFeatureEditor, createManipulatorRegistry, createToolRegistry } from '@/interaction';
import { FakeViewport } from '@/interaction/testing';
import type { GeometryKernel, MeshData } from '@/kernel';
import { createInThreadOcctKernel } from '@/kernel-occt/testing';
import { createOperationDispatcher, createOperationLog, createOpHandlerRegistry } from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { bodiesOf, createBuilderRegistry, createRegenerator, sketchesOf } from '@/regen';
import type { Body, RegenResult } from '@/regen';
import { SKETCH_PARAM, parseSketchData } from '@/sketch';
import type { SketchEntity, SketchFitSpline, SketchPoint } from '@/sketch';
import { createSketchEditor } from '@/sketcher';
import type { SketchSession } from '@/sketcher';
import { createInThreadPlanegcsSolver } from '@/solver-planegcs/testing';
import { createFakeSketchGeometry } from '@/sketch/testing';

const META = { id: 'sketch-spline' as DocumentId, name: 'Spline', createdAt: 0 }; // a test id is trusted
const TOLERANCE = 1e-6;
const FINE = { linearDeflection: 0.01, angularDeflection: 0.05 };
const DISTANCE = 10;

function setup(kernel: GeometryKernel) {
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const tools = createToolRegistry();
  const manipulators = createManipulatorRegistry();
  // The plugins of the scenario directly: app (BUILT_IN_PLUGINS) needs the DOM types.
  for (const plugin of [sketchPlugin, extrudePlugin]) {
    registerPlugin(plugin, { schemas, builders, tools, manipulators });
  }
  const doc = createDocument({ meta: META });
  const log = createOperationLog();
  const handlers = createOpHandlerRegistry({ schemas });
  const ops = createOperationDispatcher({ doc, handlers, log });
  const regenerator = createRegenerator({ kernel, schemas, builders, now: () => 0 });
  const ids = createSequentialIdGenerator('f');
  const features = createFeatureEditor({ doc, ops, schemas, ids, translate: (key) => key });
  const planes = new Map<PlaneId, Plane>(ORIGIN_PLANES.map((p) => [p.id, p.plane]));
  const sketcher = createSketchEditor({
    features,
    solver: createInThreadPlanegcsSolver(),
    geometry: createFakeSketchGeometry(),
    viewport: new FakeViewport(),
    resolvePlane: (ref) => (ref.kind === 'plane' ? planes.get(ref.plane) : undefined),
    // Only origin planes here: the reference is the plane of the artifact.
    planeOfSketch: () => undefined,
  });

  /** Creates a feature of the type through the dialog with the given params, OK. */
  function add(type: string, params: Readonly<Record<string, unknown>>): FeatureId {
    const session = features.create(type);
    session.setParams(params);
    session.commit();
    return session.featureId;
  }

  /** A sketch on XY with the entities and no constraints, through the dialog (data, not tools). */
  function addSketch(entities: readonly unknown[]): FeatureId {
    return add('sketch', {
      plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }],
      entities,
      constraints: [],
    });
  }

  async function regenerate(): Promise<RegenResult> {
    const result = await regenerator.run(doc.studio);
    if (result === 'superseded') expect.fail('Unexpected superseded run');
    return result;
  }

  /** The region refs of the sketch in the final state of the result, in their order. */
  function regionsOf(result: RegenResult, sketch: FeatureId): SketchRegionRef[] {
    const artifact = sketchesOf(result.finalState).find((a) => a.owner === sketch);
    if (artifact === undefined) expect.fail(`No sketch artifact of '${sketch}'`);
    return [...artifact.regions.keys()].map((region) => ({ kind: 'region', sketch, region }));
  }

  return { kernel, doc, sketcher, add, addSketch, regenerate, regionsOf };
}

type Setup = ReturnType<typeof setup>;

// --- The profile: lines a–b–c–d of a 40 × 20 rectangle, its left side d → a a spline ----------

const CORNERS: readonly SketchPoint[] = [
  { kind: 'point', id: 'a', x: 0, y: 0 },
  { kind: 'point', id: 'b', x: 40, y: 0 },
  { kind: 'point', id: 'c', x: 40, y: 20 },
  { kind: 'point', id: 'd', x: 0, y: 20 },
] as SketchPoint[]; // test ids are trusted

const LINES = [
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
  { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
  { kind: 'line', id: 'cd', p1: 'c', p2: 'd' },
] as const;

/** The spline from d to a bulging out to the left: a cubic bspline over d, p, q, a. */
function bsplineProfile(): unknown[] {
  return [
    ...CORNERS,
    { kind: 'point', id: 'p', x: -12, y: 16 },
    { kind: 'point', id: 'q', x: -12, y: 4 },
    ...LINES,
    {
      kind: 'bspline',
      id: 's',
      degree: 3,
      poles: ['d', 'p', 'q', 'a'],
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
    },
  ];
}

const FIT: readonly Vec2[] = [
  [0, 20],
  [-6, 14],
  [-6, 6],
  [0, 0],
];

/** The fitSpline from d through f, g to a, its params, knots and poles from bspline.interpolate. */
function fitSplineProfile(): unknown[] {
  const { degree, params, knots, poles } = bspline.interpolate(FIT);
  return [
    ...CORNERS,
    { kind: 'point', id: 'f', x: FIT[1]?.[0], y: FIT[1]?.[1] },
    { kind: 'point', id: 'g', x: FIT[2]?.[0], y: FIT[2]?.[1] },
    ...LINES,
    { kind: 'fitSpline', id: 's', degree, fit: ['d', 'f', 'g', 'a'], params, poles, knots },
  ];
}

/**
 * The area of the closed profile a → b → c → d → (spline) → a by the shoelace formula over the
 * spline tessellated finely: the spline runs from d to a, so it closes the loop after c → d.
 */
function profileArea(entities: readonly SketchEntity[]): number {
  const spline = entities.find((e) => e.kind === 'bspline' || e.kind === 'fitSpline');
  if (spline === undefined) expect.fail('No spline');
  const at = (id: string): Vec2 => {
    const p = entities.find((e) => e.id === id);
    if (p?.kind !== 'point') expect.fail(`No point '${id}'`);
    return [p.x, p.y];
  };
  const poles = spline.kind === 'bspline' ? spline.poles.map(at) : spline.poles;
  const curve = { degree: spline.degree, poles, knots: spline.knots };
  const loop = [at('a'), at('b'), at('c'), ...bspline.tessellate(curve, 1e-6)];
  let twice = 0;
  loop.forEach(([x0, y0], i) => {
    const [x1, y1] = loop[(i + 1) % loop.length] ?? [Number.NaN, Number.NaN];
    twice += x0 * y1 - x1 * y0;
  });
  return Math.abs(twice) / 2;
}

/** Volume enclosed by the triangles (divergence theorem): Σ a · (b × c) / 6. */
function volume(mesh: MeshData): number {
  const p = (i: number): Vec3 => [
    mesh.positions[3 * i] ?? Number.NaN,
    mesh.positions[3 * i + 1] ?? Number.NaN,
    mesh.positions[3 * i + 2] ?? Number.NaN,
  ];
  let sum = 0;
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const a = p(mesh.indices[3 * t] ?? Number.NaN);
    const b = p(mesh.indices[3 * t + 1] ?? Number.NaN);
    const c = p(mesh.indices[3 * t + 2] ?? Number.NaN);
    sum +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sum / 6;
}

function expectWithinPercent(actual: number, expected: number, percent: number): void {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThanOrEqual(percent / 100);
}

function statusKinds(result: RegenResult): string[] {
  return [...result.statuses.values()].map((st) => st.kind);
}

/** The sketch data stored in the document: the params of the feature, checked like on load. */
function storedSketch(s: Setup, sketch: FeatureId) {
  const params: unknown = s.doc.feature(sketch)?.params;
  if (typeof params !== 'object' || params === null) expect.fail(`No params of '${sketch}'`);
  if (!(SKETCH_PARAM.entities in params) || !(SKETCH_PARAM.constraints in params)) {
    expect.fail(`No sketch data in '${sketch}'`);
  }
  const parsed = parseSketchData(params[SKETCH_PARAM.entities], params[SKETCH_PARAM.constraints]);
  if (!parsed.ok) expect.fail(`Invalid sketch data: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

/**
 * Extrudes the regions of the sketch by DISTANCE and checks the body: both features ok, one
 * body of the extrude with 6 faces, the spline side named face:side:s, the volume.
 */
async function expectExtrudedProfile(s: Setup, sketch: FeatureId): Promise<Body> {
  const regions = s.regionsOf(await s.regenerate(), sketch);
  expect(regions.map((r) => r.region)).toEqual(['ab,bc,cd,s']);
  const extrude = s.add('extrude', { regions, distance: DISTANCE });

  const result = await s.regenerate();
  expect(statusKinds(result)).toEqual(['ok', 'ok']);
  const bodies = bodiesOf(result.finalState);
  expect(bodies.map((b) => b.id)).toEqual([bodyId(extrude)]);
  const [body] = bodies;
  if (body === undefined) expect.fail('No body');

  expect((await s.kernel.topology(body.shape)).faces).toHaveLength(6);
  const sides = [...body.names.faceEntries.keys()].filter((n) => n.includes('face:side:'));
  expect(sides.map((n) => n.slice(n.indexOf('face:side:'))).sort()).toEqual([
    'face:side:ab',
    'face:side:bc',
    'face:side:cd',
    'face:side:s',
  ]);
  // The name written in the format of spec 08 (ADR 0018), as a stored reference holds it.
  expect(body.names.faces(`${extrude}/face:side:s` as TopoName)).toHaveLength(1);

  const mesh = await s.kernel.tessellate(body.shape, FINE);
  expectWithinPercent(volume(mesh), profileArea(storedSketch(s, sketch).entities) * DISTANCE, 0.5);
  return body;
}

function point(session: SketchSession, id: string): SketchPoint {
  const found = session.state.get().entities.find((e) => e.id === id);
  if (found?.kind !== 'point') expect.fail(`No point '${id}'`);
  return found;
}

function fitSpline(entities: readonly SketchEntity[]): SketchFitSpline {
  const found = entities.find((e) => e.kind === 'fitSpline');
  if (found === undefined) expect.fail('No fitSpline');
  return found;
}

/** Each fit point lies on the spline at its parameter. */
function expectThroughFitPoints(entities: readonly SketchEntity[]): void {
  const spline = fitSpline(entities);
  spline.fit.forEach((id, i) => {
    const p = entities.find((e) => e.id === id);
    if (p?.kind !== 'point') expect.fail(`No fit point '${id}'`);
    const [x, y] = bspline.evaluate(spline, spline.params[i] ?? Number.NaN);
    expect(Math.abs(x - p.x)).toBeLessThan(TOLERANCE);
    expect(Math.abs(y - p.y)).toBeLessThan(TOLERANCE);
  });
}

describe('sketch with a spline (OCCT, real solver)', () => {
  let kernel: GeometryKernel;

  beforeAll(async () => {
    kernel = await createInThreadOcctKernel();
  });

  it('a profile of three lines and a bspline extrudes; the spline side is face:side:s', async () => {
    const s = setup(kernel);
    await expectExtrudedProfile(s, s.addSketch(bsplineProfile()));
  });

  it('a profile of three lines and a fitSpline extrudes; the spline side is face:side:s', async () => {
    const s = setup(kernel);
    await expectExtrudedProfile(s, s.addSketch(fitSplineProfile()));
  });

  it('a dragged fit point keeps the spline through all fit points; the data still extrude', async () => {
    const s = setup(kernel);
    const sketch = s.addSketch(fitSplineProfile());
    const before = fitSpline(storedSketch(s, sketch).entities).poles;

    const edit = s.sketcher.edit(sketch);
    edit.drag(point(edit, 'f').id, [-10, 15]);
    await edit.endDrag();
    expect(edit.state.get().status).toBe('ok');
    expect(point(edit, 'f')).toMatchObject({ x: -10, y: 15 });
    const solved = edit.state.get().entities;
    expectThroughFitPoints(solved);
    expect(fitSpline(solved).poles).not.toEqual(before);
    edit.finish();

    const stored = storedSketch(s, sketch);
    expectThroughFitPoints(stored.entities);
    await expectExtrudedProfile(s, sketch);
  });

  it('a spline crossing a line is the crossing warning of the sketch, without regions', async () => {
    const s = setup(kernel);
    // The bspline of the profile with a line from its inside to the far left across it.
    const sketch = s.addSketch([
      ...bsplineProfile(),
      { kind: 'point', id: 'e', x: 10, y: 10 },
      { kind: 'point', id: 'w', x: -30, y: 10 },
      { kind: 'line', id: 'ew', p1: 'e', p2: 'w' },
    ]);

    const result = await s.regenerate();
    expect(result.statuses.get(sketch)).toEqual({
      kind: 'warning',
      message: 'Sketch curves cross each other; no regions',
    });
    expect(s.regionsOf(result, sketch)).toEqual([]);
  });
});
