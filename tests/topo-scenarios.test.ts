// The acceptance scenarios of topological naming (spec 08, M14) end to end over the OCCT kernel
// in the calling thread, wired like app does it (document, dispatcher, log, UndoManager,
// Regenerator, FeatureEditor and the plugins box, cylinder, boolean, sketch, extrude, fillet and
// chamfer). Edge and face names go into the params as plain strings in the format of spec 08,
// so the tests check the format (ADR 0018) as well:
// 1. a fillet on a box edge survives a new height of the box (and its undo);
// 2. a sketch on the top face and an extrude added to the box survive a new height;
// 3. a fillet on an edge of a hole survives moving the cylinder that made the hole;
// 4. a deleted box leaves the fillet with an unresolved reference, the rest of the model stays;
// and a chamfer on a box edge.

import { beforeAll, describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec3 } from '@/core';
import { bodyId, createDocument, createFeatureSchemaRegistry, toData } from '@/document';
import type { DocumentId, FeatureId, SketchRegionRef, TopoName, TopoRef } from '@/document';
import { booleanPlugin } from '@/features/boolean';
import { boxPlugin } from '@/features/box';
import { chamferPlugin } from '@/features/chamfer';
import { cylinderPlugin } from '@/features/cylinder';
import { extrudePlugin } from '@/features/extrude';
import { filletPlugin } from '@/features/fillet';
import { sketchPlugin } from '@/features/sketch';
import { createFeatureEditor, createManipulatorRegistry, createToolRegistry } from '@/interaction';
import type { BoundingBox, GeometryKernel } from '@/kernel';
import { createInThreadOcctKernel } from '@/kernel-occt/testing';
import {
  OP_VERSION,
  createOpHandlerRegistry,
  createOperationDispatcher,
  createOperationLog,
  createUndoManager,
  replayLog,
} from '@/ops';
import type { FeatureRemoveOp } from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { bodiesOf, createBuilderRegistry, createRegenerator, sketchesOf } from '@/regen';
import type { Body, RegenResult } from '@/regen';
import { rectangleData } from '@/sketch/testing';

const META = { id: 'topo-scenarios' as DocumentId, name: 'Topo', createdAt: 0 }; // a test id is trusted
const TOLERANCE = 1e-6;

function setup(kernel: GeometryKernel) {
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const tools = createToolRegistry();
  const manipulators = createManipulatorRegistry();
  // The plugins of the scenarios directly: app (BUILT_IN_PLUGINS) needs the DOM types.
  const plugins = [
    boxPlugin,
    cylinderPlugin,
    booleanPlugin,
    sketchPlugin,
    extrudePlugin,
    filletPlugin,
    chamferPlugin,
  ];
  for (const plugin of plugins) registerPlugin(plugin, { schemas, builders, tools, manipulators });
  const doc = createDocument({ meta: META });
  const log = createOperationLog();
  const handlers = createOpHandlerRegistry({ schemas });
  const ops = createOperationDispatcher({ doc, handlers, log });
  const undo = createUndoManager({ dispatcher: ops, log });
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

  /** Opens the feature in the dialog, sets the params, OK. */
  function edit(feature: FeatureId, params: Readonly<Record<string, unknown>>): void {
    const session = features.edit(feature);
    session.setParams(params);
    session.commit();
  }

  /** Deletes the feature like the Delete action does (one feature.remove). */
  function remove(feature: FeatureId): void {
    const op: FeatureRemoveOp = {
      type: 'feature.remove',
      v: OP_VERSION['feature.remove'],
      featureId: feature,
    };
    ops.dispatch(op);
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

  return { kernel, doc, log, handlers, undo, add, edit, remove, regenerate, regionsOf };
}

/** A reference to a face or an edge of the body of `owner` by a name written as in spec 08. */
function topo(owner: FeatureId, name: string): TopoRef {
  // The name is written in the format of spec 08 (ADR 0018), as a stored document holds it.
  return { kind: 'topo', body: bodyId(owner), name: name as TopoName };
}

function bodyOf(result: RegenResult, owner: FeatureId): Body {
  const body = bodiesOf(result.finalState).find((b) => b.id === bodyId(owner));
  if (body === undefined) expect.fail(`No body of '${owner}'`);
  return body;
}

function statusKinds(result: RegenResult): string[] {
  return [...result.statuses.values()].map((s) => s.kind);
}

async function faceCount(kernel: GeometryKernel, body: Body): Promise<number> {
  return (await kernel.topology(body.shape)).faces.length;
}

/** The face names of the body that start with `prefix`. */
function faceNamesStartingWith(body: Body, prefix: string): string[] {
  return [...body.names.faceEntries.keys()].filter((name) => name.startsWith(prefix));
}

function expectVecClose(actual: Vec3, expected: Vec3): void {
  actual.forEach((c, k) => {
    expect(Math.abs(c - (expected[k] ?? Number.NaN))).toBeLessThan(TOLERANCE);
  });
}

function expectBox(actual: BoundingBox, min: Vec3, max: Vec3): void {
  expectVecClose(actual.min, min);
  expectVecClose(actual.max, max);
}

const BOX = { origin: [0, 0, 0], width: 10, depth: 10, height: 10 } as const;

describe('topological naming scenarios (spec 08, OCCT)', () => {
  let kernel: GeometryKernel;

  beforeAll(async () => {
    kernel = await createInThreadOcctKernel();
  });

  /** Scenario 1: a box 10 × 10 × 10 and a fillet r = 1 on its top front edge. */
  function filletedBox(k: GeometryKernel = kernel) {
    const s = setup(k);
    const box = s.add('box', BOX);
    const fillet = s.add('fillet', {
      edges: [topo(box, `edge:${box}/face:front|${box}/face:top`)],
      radius: 1,
    });
    return { ...s, box, fillet };
  }

  it('1: a fillet on a box edge survives a new height of the box', async () => {
    const s = filletedBox();
    const { box, fillet } = s;

    const first = await s.regenerate();
    expect(statusKinds(first)).toEqual(['ok', 'ok']);
    const filleted = bodyOf(first, box);
    expect(await faceCount(kernel, filleted)).toBe(7);
    expect(faceNamesStartingWith(filleted, `${fillet}/`)).toEqual([
      `${fillet}/face:fillet:edge:${box}/face:front|${box}/face:top`,
    ]);

    s.edit(box, { height: 20 });
    const taller = await s.regenerate();
    expect(statusKinds(taller)).toEqual(['ok', 'ok']);
    const tallerBody = bodyOf(taller, box);
    expect(await faceCount(kernel, tallerBody)).toBe(7);
    expectBox(await kernel.boundingBox(tallerBody.shape), [0, 0, 0], [10, 10, 20]);
  });

  it('1: undo of the new height brings the box back with the fillet without an error', async () => {
    const s = filletedBox();
    await s.regenerate();
    s.edit(s.box, { height: 20 });
    await s.regenerate();

    s.undo.undo();
    const undone = await s.regenerate();
    expect(undone.statuses.get(s.fillet)).toEqual({ kind: 'ok' });
    const body = bodyOf(undone, s.box);
    expect(await faceCount(kernel, body)).toBe(7);
    expectBox(await kernel.boundingBox(body.shape), [0, 0, 0], [10, 10, 10]);
  });

  it('1: replays the log into a new document with the same data', async () => {
    const s = filletedBox();
    await s.regenerate();
    s.edit(s.box, { height: 20 });
    s.undo.undo();
    s.undo.redo();

    const copy = createDocument({ meta: META });
    replayLog(copy, s.handlers, s.log.entries());
    expect(toData(copy)).toEqual(toData(s.doc));
  });

  it('1: only the handles of the final and the cached states stay alive', async () => {
    // An own kernel: the shared one holds the handles of the other scenarios.
    const own = await createInThreadOcctKernel();
    const s = filletedBox(own);
    await s.regenerate();
    s.edit(s.box, { height: 20 });
    const result = await s.regenerate();

    // Alive after the sweep (spec 07, Životnost handle): the filleted body of the final state
    // and the shape of the box, which the cached state after the box still holds.
    expect(bodiesOf(result.finalState)).toHaveLength(1);
    const cachedBox = 1;
    expect(await own.liveHandleCount()).toBe(1 + cachedBox);
  });

  it('2: a sketch on the top face and an extrude added to the box survive a new height', async () => {
    const s = setup(kernel);
    const box = s.add('box', BOX);
    // The frame of the top face (spec 12): origin (0, 0, 10), xDir +X, so the sketch
    // coordinates are the world x and y. A rectangle inside the face, without the solver.
    const sketch = s.add('sketch', {
      plane: [topo(box, `${box}/face:top`)],
      ...rectangleData({ x: 2, y: 2, width: 6, height: 6 }),
    });
    const regions = s.regionsOf(await s.regenerate(), sketch);
    expect(regions).toHaveLength(1);
    const extrude = s.add('extrude', {
      regions,
      operation: 'add',
      targets: [{ kind: 'body', body: bodyId(box) }],
      distance: 5,
    });

    const first = await s.regenerate();
    expect(statusKinds(first)).toEqual(['ok', 'ok', 'ok']);
    expectBox(await kernel.boundingBox(bodyOf(first, box).shape), [0, 0, 0], [10, 10, 15]);

    s.edit(box, { height: 20 });
    const taller = await s.regenerate();
    expect(statusKinds(taller)).toEqual(['ok', 'ok', 'ok']);
    const plane = sketchesOf(taller.finalState).find((a) => a.owner === sketch)?.plane;
    if (plane === undefined) expect.fail('No sketch artifact');
    expectVecClose(plane.origin, [0, 0, 20]);
    expectVecClose(plane.normal, [0, 0, 1]);
    expect(bodiesOf(taller.finalState).map((b) => b.id)).toEqual([bodyId(box)]);
    expect(bodyOf(taller, box).lastModifiedBy).toBe(extrude);
    expectBox(await kernel.boundingBox(bodyOf(taller, box).shape), [0, 0, 0], [10, 10, 25]);
  });

  it('3: a fillet on an edge of a hole survives moving the cylinder', async () => {
    const s = setup(kernel);
    const box = s.add('box', BOX);
    // A cylinder through the box: from z = -1 to z = 11.
    const cyl = s.add('cylinder', { base: [5, 5, -1], axis: 'z', radius: 2, height: 12 });
    s.add('boolean', {
      op: 'subtract',
      targets: [{ kind: 'body', body: bodyId(box) }],
      tools: [{ kind: 'body', body: bodyId(cyl) }],
    });
    const fillet = s.add('fillet', {
      edges: [topo(box, `edge:${box}/face:top|${cyl}/face:side`)],
      radius: 0.5,
    });

    const first = await s.regenerate();
    expect(statusKinds(first)).toEqual(['ok', 'ok', 'ok', 'ok']);
    const holed = bodyOf(first, box);
    // The 6 faces of the box, the wall of the hole and the fillet of its top edge.
    const faces = await faceCount(kernel, holed);
    expect(faces).toBe(8);
    expect(faceNamesStartingWith(holed, `${fillet}/`)).toEqual([
      `${fillet}/face:fillet:edge:${box}/face:top|${cyl}/face:side`,
    ]);

    s.edit(cyl, { base: [4, 5, -1] });
    const moved = await s.regenerate();
    expect(statusKinds(moved)).toEqual(['ok', 'ok', 'ok', 'ok']);
    const movedBody = bodyOf(moved, box);
    expect(await faceCount(kernel, movedBody)).toBe(faces);
    expect(movedBody.lastModifiedBy).toBe(fillet);
  });

  it('4: a deleted box leaves the fillet unresolved, the other cylinder stays', async () => {
    const s = filletedBox();
    const cyl = s.add('cylinder', { base: [20, 0, 0], axis: 'z', radius: 2, height: 5 });
    expect(statusKinds(await s.regenerate())).toEqual(['ok', 'ok', 'ok']);

    s.remove(s.box);
    const result = await s.regenerate();
    const status = result.statuses.get(s.fillet);
    if (status?.kind !== 'error') expect.fail('The fillet is not an error');
    expect(status.error.code).toBe('UNRESOLVED_REFERENCE');
    expect(status.error.issues).toEqual([{ param: 'edges', code: 'param.unresolvedRef' }]);
    expect(result.statuses.get(cyl)).toEqual({ kind: 'ok' });
    expect(bodiesOf(result.finalState).map((b) => b.id)).toEqual([bodyId(cyl)]);
  });

  it('a chamfer on a box edge makes 7 faces, one named after the edge', async () => {
    const s = setup(kernel);
    const box = s.add('box', BOX);
    const chamfer = s.add('chamfer', {
      edges: [topo(box, `edge:${box}/face:front|${box}/face:top`)],
      distance: 1,
    });

    const result = await s.regenerate();
    expect(statusKinds(result)).toEqual(['ok', 'ok']);
    const body = bodyOf(result, box);
    expect(await faceCount(kernel, body)).toBe(7);
    expect(faceNamesStartingWith(body, `${chamfer}/`)).toEqual([
      `${chamfer}/face:chamfer:edge:${box}/face:front|${box}/face:top`,
    ]);
    expectBox(await kernel.boundingBox(body.shape), [0, 0, 0], [10, 10, 10]);
  });
});
