// The revolve of M13 end to end over the OCCT kernel in the calling thread, wired like app does
// it (document, dispatcher, log, UndoManager, Regenerator, FeatureEditor and the plugins sketch
// and revolve): a rectangle on the plane XZ (x ∈ [5, 10], z ∈ [0, 10]) turned a full turn about
// the origin axis Z, and about a construction line of the sketch lying on that axis, gives a
// tube with 4 faces and the volume π · (10² − 5²) · 10 = 750π.

import { beforeAll, describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec3 } from '@/core';
import {
  ORIGIN_AXIS_IDS,
  ORIGIN_PLANE_IDS,
  bodyId,
  createDocument,
  createFeatureSchemaRegistry,
} from '@/document';
import type { AxisRef, DocumentId, FeatureId, SketchEntityRef, SketchRegionRef } from '@/document';
import { revolvePlugin } from '@/features/revolve';
import { sketchPlugin } from '@/features/sketch';
import { createFeatureEditor, createToolRegistry } from '@/interaction';
import type { GeometryKernel, MeshData } from '@/kernel';
import { createInThreadOcctKernel } from '@/kernel-occt/testing';
import {
  createOpHandlerRegistry,
  createOperationDispatcher,
  createOperationLog,
  createUndoManager,
} from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { bodiesOf, createBuilderRegistry, createRegenerator, sketchesOf } from '@/regen';
import type { RegenResult } from '@/regen';
import { rectangleData } from '@/sketch/testing';

const META = { id: 'revolve-scenario' as DocumentId, name: 'Revolve', createdAt: 0 }; // a test id is trusted
const FINE = { linearDeflection: 0.01, angularDeflection: 0.05 };

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await createInThreadOcctKernel();
});

function setup() {
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const tools = createToolRegistry();
  // The plugins of the scenario directly: app (BUILT_IN_PLUGINS) needs the DOM types.
  for (const plugin of [sketchPlugin, revolvePlugin]) {
    registerPlugin(plugin, { schemas, builders, tools });
  }
  const doc = createDocument({ meta: META });
  const log = createOperationLog();
  const handlers = createOpHandlerRegistry({ schemas });
  const ops = createOperationDispatcher({ doc, handlers, log });
  // Wired like app, though the scenario does not undo.
  createUndoManager({ dispatcher: ops, log });
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

  async function regenerate(): Promise<RegenResult> {
    const result = await regenerator.run(doc.studio);
    if (result === 'superseded') expect.fail('Unexpected superseded run');
    return result;
  }

  return { add, regenerate };
}

function faceCount(mesh: MeshData): number {
  return mesh.faceRanges.length / 3;
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

/**
 * A sketch on XZ (sketch x → +X, sketch y → +Z) with the rectangle x ∈ [5, 10], z ∈ [0, 10]
 * and a construction line p–q from [0, 0] to [0, 10], i.e. on the axis Z. The data go straight
 * into the params, without the solver.
 */
async function rectangleOnXz(s: ReturnType<typeof setup>) {
  const rectangle = rectangleData({ x: 5, y: 0, width: 5, height: 10 });
  const sketch = s.add('sketch', {
    plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xz }],
    entities: [
      ...rectangle.entities,
      { kind: 'point', id: 'p', x: 0, y: 0 },
      { kind: 'point', id: 'q', x: 0, y: 10 },
      { kind: 'line', id: 'pq', p1: 'p', p2: 'q', construction: true },
    ],
    constraints: rectangle.constraints,
  });
  const result = await s.regenerate();
  const artifact = sketchesOf(result.finalState).find((a) => a.owner === sketch);
  if (artifact === undefined) expect.fail('No sketch artifact');
  const regions = [...artifact.regions.keys()].map((region): SketchRegionRef => ({
    kind: 'region',
    sketch,
    region,
  }));
  // The construction line bounds no region.
  expect(regions).toHaveLength(1);
  return { sketch, regions };
}

/** Revolves the regions about the axis a full turn; the mesh of the only resulting body. */
async function revolvedAbout(
  s: ReturnType<typeof setup>,
  regions: readonly SketchRegionRef[],
  axis: AxisRef | SketchEntityRef,
): Promise<MeshData> {
  const revolve = s.add('revolve', { regions, axis, angle: 2 * Math.PI });
  const result = await s.regenerate();
  expect(result.statuses.get(revolve)).toEqual({ kind: 'ok' });
  const bodies = bodiesOf(result.finalState);
  expect(bodies.map((b) => b.id)).toEqual([bodyId(revolve)]);
  const [body] = bodies;
  if (body === undefined) expect.fail('No body');
  return kernel.tessellate(body.shape, FINE);
}

describe('revolve scenario (rectangle on XZ, OCCT)', () => {
  it('a full turn about the origin axis Z gives a tube with 4 faces and the volume 750π', async () => {
    const s = setup();
    const { regions } = await rectangleOnXz(s);

    const mesh = await revolvedAbout(s, regions, { kind: 'axis', axis: ORIGIN_AXIS_IDS.z });
    expect(faceCount(mesh)).toBe(4);
    expectWithinPercent(volume(mesh), 750 * Math.PI, 1);
  });

  it('a full turn about a construction line of the sketch on x = 0 gives the same tube', async () => {
    const s = setup();
    const { sketch, regions } = await rectangleOnXz(s);

    const mesh = await revolvedAbout(s, regions, { kind: 'sketchEntity', sketch, entity: 'pq' });
    expect(faceCount(mesh)).toBe(4);
    expectWithinPercent(volume(mesh), 750 * Math.PI, 1);
  });
});
