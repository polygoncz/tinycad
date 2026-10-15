import { describe, expect, it } from 'vitest';
import { mat4 } from '@/core';
import type { FeatureId, TopoName } from '@/document';
import type { QueryOps, ShapeResult, TopologySummary } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { EMPTY_NAMES, nameShape } from '@/regen/names';
import { aNameTable } from '@/regen/testing';

// nameShape (spec 08): kernel.topology of the result and propagateNames, nothing more.

// Feature ids and names are created by a cast in tests only.
const fid = (s: string): FeatureId => s as FeatureId;
const tn = (s: string): TopoName => s as TopoName;

describe('nameShape', () => {
  it('names the faces of a box by its roles: <f>/face:top on index 5', async () => {
    const kernel = createFakeKernel();
    const result = await kernel.makeBox({ origin: [0, 0, 0], size: [10, 10, 10] });

    const names = await nameShape({ kernel, featureId: fid('b'), result, inputs: [] });

    expect(names.faces(tn('b/face:top'))).toEqual([5]);
    expect(names.faces(tn('b/face:left'))).toEqual([0]);
    expect(names.edgeEntries.size).toBe(12);
    expect(names.topology).toEqual(await kernel.topology(result.shape));
    expect(Object.isFrozen(names)).toBe(true);
  });

  it('carries the names of the input over the history of a transform', async () => {
    const kernel = createFakeKernel();
    const box = await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
    const boxNames = await nameShape({ kernel, featureId: fid('b'), result: box, inputs: [] });
    const moved = await kernel.transform(box.shape, mat4.translation([5, 0, 0]));

    const names = await nameShape({
      kernel,
      featureId: fid('t'),
      result: moved,
      inputs: [boxNames],
    });

    expect([...names.faceEntries]).toEqual([...boxNames.faceEntries]);
    expect([...names.edgeEntries]).toEqual([...boxNames.edgeEntries]);
  });

  it('passes the generated tag on and asks the kernel only for the topology of the result', async () => {
    const topology: TopologySummary = {
      faces: [{ surface: 'other' }, { surface: 'other' }],
      edges: [],
      vertexCount: 0,
    };
    const asked: unknown[] = [];
    const kernel: Pick<QueryOps, 'topology'> = {
      topology: (shape) => {
        asked.push(shape);
        return Promise.resolve(topology);
      },
    };
    const input = aNameTable({
      faces: { 'b/face:top': [0] },
      topology: { faces: [{ surface: 'other' }], edges: [], vertexCount: 0 },
    });
    // A handle is created by a cast in tests only: the stub kernel never reads it.
    const result: ShapeResult = {
      shape: 7 as ShapeResult['shape'],
      history: {
        modified: [],
        generated: [
          { input: 0, from: { type: 'face', index: 0 }, to: [{ type: 'face', index: 1 }] },
        ],
        deleted: [],
      },
    };

    const names = await nameShape({
      kernel,
      featureId: fid('f'),
      result,
      inputs: [input],
      generatedTag: 'fillet',
    });

    expect(asked).toEqual([7]);
    expect(names.nameOfFace(1)).toBe('f/face:fillet:b/face:top');
    expect(names.nameOfFace(0)).toBeUndefined();
  });

  it('rejects with the error of the kernel', async () => {
    const kernel = createFakeKernel();
    const result = await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
    kernel.failNext('topology', 'internal', 'boom');
    await expect(nameShape({ kernel, featureId: fid('b'), result, inputs: [] })).rejects.toThrow(
      'boom',
    );
  });
});

describe('aNameTable', () => {
  it('builds a table from names of faces and edges with a default topology', () => {
    const t = aNameTable({
      faces: { 'b/face:top': [5], 'b/face:a': [5, 2] },
      edges: { 'edge:x': [3] },
    });
    expect(t.faces(tn('b/face:a'))).toEqual([2, 5]);
    expect(t.nameOfFace(5)).toBe('b/face:a');
    expect(t.namesOfFace(5)).toEqual(['b/face:a', 'b/face:top']);
    expect(t.nameOfEdge(3)).toBe('edge:x');
    expect(t.edges(tn('edge:y'))).toEqual([]);
    expect([...t.faceEntries.keys()]).toEqual(['b/face:a', 'b/face:top']);
    // Enough faces and edges for every index, none of them planar.
    expect(t.topology.faces).toHaveLength(6);
    expect(t.topology.faces.every((f) => f.surface === 'other')).toBe(true);
    expect(t.topology.edges).toHaveLength(4);
  });

  it('keeps a given topology and is empty by default', () => {
    expect(aNameTable().faceEntries.size).toBe(0);
    expect(aNameTable().topology).toEqual(EMPTY_NAMES.topology);
    const topology: TopologySummary = {
      faces: [{ surface: 'plane', plane: { origin: [0, 0, 5], normal: [0, 0, -1] } }],
      edges: [],
      vertexCount: 0,
    };
    expect(aNameTable({ faces: { 'k/face:bottom': [0] }, topology }).topology).toBe(topology);
  });
});
