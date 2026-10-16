// Regression of M30 (geometry of the sketch in OCCT): a document of M29 – a sketch with a
// spline side and a circular hole, one region extruded – gives the same region names, holes,
// areas and topological face names as before M30, when the regions came from computeRegions of
// sketch (TypeScript). The expected values are literals measured on the commit before M30
// (929fa1a), not computed by the code under test; wired like app does it (document, dispatcher,
// log, Regenerator, FeatureEditor and the plugins sketch and extrude) over the OCCT kernel in the
// calling thread.

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
import type { RegenResult, SketchArtifact } from '@/regen';

const META = { id: 'sketch-regions-regression' as DocumentId, name: 'Regions', createdAt: 0 }; // a test id is trusted

/**
 * Before M30 the area of a spline region came from its tessellation (SPLINE_TOLERANCE · scale =
 * 4e-3 here), so it was a little smaller than the exact area of the kernel (851.0192 before,
 * 851.0602 exact); relative.
 */
const AREA_TOLERANCE = 1e-4;

/**
 * The sketch of M29 on XY: a 40 × 20 rectangle a–b–c–d whose left side d → a is a cubic bspline
 * bulging out to the left, and a circle k of radius 5 inside it (the hole of the outer region and
 * a region of its own).
 */
const ENTITIES: readonly unknown[] = [
  { kind: 'point', id: 'a', x: 0, y: 0 },
  { kind: 'point', id: 'b', x: 40, y: 0 },
  { kind: 'point', id: 'c', x: 40, y: 20 },
  { kind: 'point', id: 'd', x: 0, y: 20 },
  { kind: 'point', id: 'p', x: -12, y: 16 },
  { kind: 'point', id: 'q', x: -12, y: 4 },
  { kind: 'point', id: 'o', x: 25, y: 10 },
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
  { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
  { kind: 'line', id: 'cd', p1: 'c', p2: 'd' },
  {
    kind: 'bspline',
    id: 's',
    degree: 3,
    poles: ['d', 'p', 'q', 'a'],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
  },
  { kind: 'circle', id: 'k', center: 'o', radius: 5 },
];

/** Measured on 929fa1a: the regions of the sketch in their order, with holes and areas. */
const EXPECTED_REGIONS = [
  { name: 'ab,bc,cd,k,s', holes: 1, area: 851.0191703240736 },
  { name: 'k', holes: 0, area: 78.53981633974483 },
] as const;

/** Measured on 929fa1a: name -> number of faces of the body of the extrude (f2) of 'ab,bc,cd,k,s'. */
const EXPECTED_FACE_NAMES: readonly (readonly [string, number])[] = [
  ['f2/face:end', 1],
  ['f2/face:side:ab', 1],
  ['f2/face:side:bc', 1],
  ['f2/face:side:cd', 1],
  ['f2/face:side:k', 1],
  ['f2/face:side:s', 1],
  ['f2/face:start', 1],
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

  async function regenerate(): Promise<RegenResult> {
    const result = await regenerator.run(doc.studio);
    if (result === 'superseded') expect.fail('Unexpected superseded run');
    return result;
  }

  return { kernel, add, regenerate };
}

function sketchArtifact(result: RegenResult, sketch: FeatureId): SketchArtifact {
  const artifact = sketchesOf(result.finalState).find((a) => a.owner === sketch);
  if (artifact === undefined) expect.fail(`No sketch artifact of '${sketch}'`);
  return artifact;
}

describe('a sketch of M29 after M30 (OCCT)', () => {
  let kernel: GeometryKernel;

  beforeAll(async () => {
    kernel = await createInThreadOcctKernel();
  });

  it('gives the same region names, holes and areas as before M30', async () => {
    const s = setup(kernel);
    const sketch = s.add('sketch', {
      plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }],
      entities: ENTITIES,
      constraints: [],
    });

    const result = await s.regenerate();
    expect(result.statuses.get(sketch)).toEqual({ kind: 'ok' });
    const artifact = sketchArtifact(result, sketch);
    const names = EXPECTED_REGIONS.map((r) => r.name);
    expect([...artifact.regions.keys()]).toEqual(names);
    expect(artifact.outlines.map((o) => o.name)).toEqual(names);
    artifact.outlines.forEach((outline, i) => {
      const expected = EXPECTED_REGIONS[i];
      if (expected === undefined) expect.fail(`No expected region ${String(i)}`);
      expect(outline.holes).toHaveLength(expected.holes);
      expect(Math.abs(outline.area - expected.area) / expected.area).toBeLessThanOrEqual(
        AREA_TOLERANCE,
      );
    });
  });

  it('extruding the region with the hole gives the same face names as before M30', async () => {
    const s = setup(kernel);
    const sketch = s.add('sketch', {
      plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }],
      entities: ENTITIES,
      constraints: [],
    });
    const region: SketchRegionRef = { kind: 'region', sketch, region: 'ab,bc,cd,k,s' };
    const extrude = s.add('extrude', { regions: [region], distance: 10 });
    expect(extrude).toBe('f2');

    const result = await s.regenerate();
    expect([...result.statuses.values()].map((st) => st.kind)).toEqual(['ok', 'ok']);
    const [body, ...rest] = bodiesOf(result.finalState);
    if (body === undefined) expect.fail('No body');
    expect(rest).toEqual([]);

    expect((await s.kernel.topology(body.shape)).faces).toHaveLength(7);
    const faceNames = [...body.names.faceEntries.entries()]
      .map(([name, indices]): [string, number] => [name, indices.length])
      .sort(([n1], [n2]) => (n1 < n2 ? -1 : n1 > n2 ? 1 : 0));
    expect(faceNames).toEqual(EXPECTED_FACE_NAMES);
    // The names written in the format of spec 08 (ADR 0018), as a stored reference holds them.
    expect(body.names.faces('f2/face:side:s' as TopoName)).toHaveLength(1); // a literal name is trusted
    expect(body.names.faces('f2/face:side:k' as TopoName)).toHaveLength(1); // a literal name is trusted
  });
});
