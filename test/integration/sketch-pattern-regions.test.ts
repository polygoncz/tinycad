// The copies of a sketch pattern bound regions (M36, spec 12 "Zrcadlení a pole (M36)"): a square
// plate with a circular hole and a circular pattern of the hole, extruded over the OCCT kernel in
// the calling thread, wired like app does it (document, dispatcher, log, Regenerator,
// FeatureEditor and the plugins sketch and extrude):
// - the copied holes are holes of the plate region, their side faces are named
//   face:side:<pattern>:<index>.<source>;
// - changing the angle of the pattern through the dialog moves the holes, the extrude still
//   regenerates and the face names stay the same.

import { beforeAll, describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { ORIGIN_PLANE_IDS, createDocument, createFeatureSchemaRegistry } from '@/document';
import type { DocumentId, FeatureId, SketchRegionRef, TopoName } from '@/document';
import { extrudePlugin } from '@/features/extrude';
import { sketchPlugin } from '@/features/sketch';
import { createFeatureEditor, createManipulatorRegistry, createToolRegistry } from '@/interaction';
import type { GeometryKernel } from '@/kernel';
import { createInThreadOcctKernel } from '@/kernel-occt/testing';
import { createOperationDispatcher, createOperationLog, createOpHandlerRegistry } from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { bodiesOf, createBuilderRegistry, createRegenerator, sketchesOf } from '@/regen';
import type { Body, RegenResult } from '@/regen';
import { SKETCH_PARAM } from '@/sketch';

const META = { id: 'sketch-pattern-regions' as DocumentId, name: 'Pattern', createdAt: 0 }; // a test id is trusted
const DISTANCE = 5;
const HOLE_RADIUS = 3;

/**
 * A 60 × 60 plate a–b–c–d around the origin o, a hole k of radius 3 at [15, 0] and a circular
 * pattern cp of k around o: 4 instances within the angle (the copies cp:1.k … cp:3.k).
 */
function entities(angle: number): readonly unknown[] {
  return [
    { kind: 'point', id: 'a', x: -30, y: -30 },
    { kind: 'point', id: 'b', x: 30, y: -30 },
    { kind: 'point', id: 'c', x: 30, y: 30 },
    { kind: 'point', id: 'd', x: -30, y: 30 },
    { kind: 'point', id: 'o', x: 0, y: 0 },
    { kind: 'point', id: 'h', x: 15, y: 0 },
    { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
    { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
    { kind: 'line', id: 'cd', p1: 'c', p2: 'd' },
    { kind: 'line', id: 'da', p1: 'd', p2: 'a' },
    { kind: 'circle', id: 'k', center: 'h', radius: HOLE_RADIUS },
    { kind: 'circularPattern', id: 'cp', sources: ['k'], center: 'o', count: 4, angle },
  ];
}

/** The plate region: all boundary ids sorted (string comparison), the copies among them. */
const PLATE = 'ab,bc,cd,cp:1.k,cp:2.k,cp:3.k,da,k';

const EXPECTED_SIDES = [
  'face:side:ab',
  'face:side:bc',
  'face:side:cd',
  'face:side:cp:1.k',
  'face:side:cp:2.k',
  'face:side:cp:3.k',
  'face:side:da',
  'face:side:k',
];

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

  /** Creates a feature of the type through the dialog with the given params, OK. */
  function add(type: string, params: Readonly<Record<string, unknown>>): FeatureId {
    const session = features.create(type);
    session.setParams(params);
    session.commit();
    return session.featureId;
  }

  /** Changes one param of the feature through the dialog, OK. */
  function edit(feature: FeatureId, name: string, value: unknown): void {
    const session = features.edit(feature);
    session.setParam(name, value);
    session.commit();
  }

  async function regenerate(): Promise<RegenResult> {
    const result = await regenerator.run(doc.studio);
    if (result === 'superseded') expect.fail('Unexpected superseded run');
    return result;
  }

  return { kernel, add, edit, regenerate };
}

type Setup = ReturnType<typeof setup>;

function regionNames(result: RegenResult, sketch: FeatureId): string[] {
  const artifact = sketchesOf(result.finalState).find((a) => a.owner === sketch);
  if (artifact === undefined) expect.fail(`No sketch artifact of '${sketch}'`);
  return [...artifact.regions.keys()];
}

/** The one body of the result: both features ok. */
function onlyBody(result: RegenResult): Body {
  expect([...result.statuses.values()].map((st) => st.kind)).toEqual(['ok', 'ok']);
  const [body, ...rest] = bodiesOf(result.finalState);
  if (body === undefined) expect.fail('No body');
  expect(rest).toEqual([]);
  return body;
}

/** The side face names of the body without the feature prefix, sorted. */
function sideNames(body: Body): string[] {
  return [...body.names.faceEntries.keys()]
    .filter((n) => n.includes('face:side:'))
    .map((n) => n.slice(n.indexOf('face:side:')))
    .sort();
}

/** The centre of the side face of a hole: the middle of its bounding box in the plane. */
async function holeCentre(s: Setup, body: Body, name: string): Promise<readonly [number, number]> {
  const [face] = body.names.faces(name as TopoName); // a test name in the format of spec 08 is trusted
  if (face === undefined) expect.fail(`No face '${name}'`);
  const mesh = await s.kernel.tessellate(body.shape, {
    linearDeflection: 0.01,
    angularDeflection: 0.05,
  });
  const xs: number[] = [];
  const ys: number[] = [];
  // faceRanges: triples [faceIndex, firstTriangle, triangleCount].
  for (let r = 0; r < mesh.faceRanges.length; r += 3) {
    if (mesh.faceRanges[r] !== face) continue;
    const first = mesh.faceRanges[r + 1] ?? 0;
    const count = mesh.faceRanges[r + 2] ?? 0;
    for (let i = 3 * first; i < 3 * (first + count); i++) {
      const v = mesh.indices[i] ?? Number.NaN;
      xs.push(mesh.positions[3 * v] ?? Number.NaN);
      ys.push(mesh.positions[3 * v + 1] ?? Number.NaN);
    }
  }
  if (xs.length === 0) expect.fail(`No triangles of face '${name}'`);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

describe('a circular pattern of holes in a sketch, extruded (M36, OCCT)', () => {
  let kernel: GeometryKernel;

  beforeAll(async () => {
    kernel = await createInThreadOcctKernel();
  });

  it('names the side faces of the copied holes by their derived ids and keeps them when the angle changes', async () => {
    const s = setup(kernel);
    const sketch = s.add('sketch', {
      plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }],
      entities: entities(Math.PI),
      constraints: [],
    });
    const regions = regionNames(await s.regenerate(), sketch);
    expect(regions).toContain(PLATE);
    for (const hole of ['k', 'cp:1.k', 'cp:2.k', 'cp:3.k']) expect(regions).toContain(hole);

    const region: SketchRegionRef = { kind: 'region', sketch, region: PLATE };
    const extrude = s.add('extrude', { regions: [region], distance: DISTANCE });
    const before = onlyBody(await s.regenerate());
    expect(sideNames(before)).toEqual(EXPECTED_SIDES);
    // The name written in the format of spec 08 (ADR 0018), as a stored reference holds it.
    expect(before.names.faces(`${extrude}/face:side:cp:3.k` as TopoName)).toHaveLength(1); // a literal name is trusted
    // 4 instances within π: step π/3, the last copy at angle π.
    const [x0, y0] = await holeCentre(s, before, `${extrude}/face:side:cp:3.k`);
    expect(x0).toBeCloseTo(-15, 1);
    expect(y0).toBeCloseTo(0, 1);

    // A wider pattern: step π/2, the last copy at 3π/2.
    s.edit(sketch, SKETCH_PARAM.entities, entities((3 * Math.PI) / 2));
    const afterResult = await s.regenerate();
    expect(regionNames(afterResult, sketch)).toContain(PLATE);
    const after = onlyBody(afterResult);
    expect(sideNames(after)).toEqual(EXPECTED_SIDES);
    const [x1, y1] = await holeCentre(s, after, `${extrude}/face:side:cp:3.k`);
    expect(x1).toBeCloseTo(0, 1);
    expect(y1).toBeCloseTo(-15, 1);
  });
});
