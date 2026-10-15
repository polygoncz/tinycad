import { describe, expect, it } from 'vitest';
import type { BodyId, HighlightTarget, PickResult } from '@/interaction';
import type { MeshData } from '@/kernel';
import {
  bodyTriangles,
  drawnTargets,
  sameHover,
  sameSelection,
  sameTarget,
  validTarget,
  validTargets,
} from '@/render/highlight-targets';

// Branded ids are created by a cast in tests only.
const body = (id: string): BodyId => id as BodyId;
const A = body('f1/body');
const B = body('f2/body');

const face = (b: BodyId, faceIndex: number): HighlightTarget => ({
  kind: 'face',
  body: b,
  faceIndex,
});
const edge = (b: BodyId, edgeIndex: number): HighlightTarget => ({
  kind: 'edge',
  body: b,
  edgeIndex,
});
/** A pick result is a HighlightTarget too; its point and normal must not count. */
const facePick = (b: BodyId, faceIndex: number, point: [number, number, number]): PickResult => ({
  kind: 'face',
  body: b,
  faceIndex,
  point,
  normal: [0, 0, 1],
});
const edgePick = (b: BodyId, edgeIndex: number, point: [number, number, number]): PickResult => ({
  kind: 'edge',
  body: b,
  edgeIndex,
  point,
});

/** M12: HighlightPort ignores sketch entities (the drawing style carries their highlight). */
const sketchEntity = (sketch: string, entity: string): HighlightTarget => ({
  kind: 'sketchEntity',
  sketch,
  entity,
});

/** M13: a region of a drawing; this layer does not draw it yet (Ú5). */
const sketchRegion = (sketch: string, region: string): HighlightTarget => ({
  kind: 'sketchRegion',
  sketch,
  region,
});

/** M14: a whole body. */
const whole = (b: BodyId): HighlightTarget => ({ kind: 'body', body: b });

/** Face keys 5 and 2 (out of order), edge keys 4 and 1. */
const MESH: MeshData = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  faceRanges: new Uint32Array([5, 0, 1, 2, 1, 1]),
  edgePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  edgeRanges: new Uint32Array([4, 0, 2, 1, 2, 2]),
};
const meshOf = (b: BodyId): MeshData | undefined => (b === A ? MESH : undefined);

describe('sameTarget', () => {
  it('ignores point and normal', () => {
    expect(sameTarget(facePick(A, 5, [1, 2, 3]), facePick(A, 5, [4, 5, 6]))).toBe(true);
    expect(sameTarget(edgePick(A, 4, [1, 2, 3]), edge(A, 4))).toBe(true);
  });

  it('distinguishes kind, body and index', () => {
    expect(sameTarget(face(A, 1), edge(A, 1))).toBe(false);
    expect(sameTarget(face(A, 1), face(B, 1))).toBe(false);
    expect(sameTarget(face(A, 1), face(A, 2))).toBe(false);
    expect(sameTarget(edge(A, 1), edge(A, 2))).toBe(false);
  });

  it('compares sketch entities by sketch and entity', () => {
    expect(sameTarget(sketchEntity('s', 'p1'), sketchEntity('s', 'p1'))).toBe(true);
    expect(sameTarget(sketchEntity('s', 'p1'), sketchEntity('s', 'p2'))).toBe(false);
    expect(sameTarget(sketchEntity('s', 'p1'), sketchEntity('t', 'p1'))).toBe(false);
    expect(sameTarget(sketchEntity('s', 'p1'), face(A, 1))).toBe(false);
  });
});

describe('sameTarget with sketch regions (M13)', () => {
  it('compares sketch regions by sketch and region', () => {
    expect(sameTarget(sketchRegion('s', 'r1'), sketchRegion('s', 'r1'))).toBe(true);
    expect(sameTarget(sketchRegion('s', 'r1'), sketchRegion('s', 'r2'))).toBe(false);
    expect(sameTarget(sketchRegion('s', 'r1'), sketchRegion('t', 'r1'))).toBe(false);
    expect(sameTarget(sketchRegion('s', 'r1'), sketchEntity('s', 'r1'))).toBe(false);
  });
});

describe('sameTarget with whole bodies (M14)', () => {
  it('compares whole bodies by body', () => {
    expect(sameTarget(whole(A), whole(A))).toBe(true);
    expect(sameTarget(whole(A), whole(B))).toBe(false);
  });

  it('a whole body differs from its faces and edges', () => {
    expect(sameTarget(whole(A), face(A, 5))).toBe(false);
    expect(sameTarget(edge(A, 4), whole(A))).toBe(false);
  });
});

describe('sameHover', () => {
  it('compares null and targets', () => {
    expect(sameHover(null, null)).toBe(true);
    expect(sameHover(null, face(A, 5))).toBe(false);
    expect(sameHover(face(A, 5), null)).toBe(false);
    expect(sameHover(facePick(A, 5, [1, 1, 1]), face(A, 5))).toBe(true);
  });
});

describe('sameSelection', () => {
  it('compares element by element, in order', () => {
    expect(sameSelection([], [])).toBe(true);
    expect(sameSelection([face(A, 5)], [facePick(A, 5, [9, 9, 9])])).toBe(true);
    expect(sameSelection([face(A, 5)], [])).toBe(false);
    expect(sameSelection([face(A, 5), edge(A, 4)], [edge(A, 4), face(A, 5)])).toBe(false);
  });
});

describe('validTarget / validTargets', () => {
  it('keeps targets whose body is shown and whose index is a key of the mesh', () => {
    expect(validTarget(face(A, 5), meshOf)).toBe(true);
    expect(validTarget(face(A, 2), meshOf)).toBe(true);
    expect(validTarget(edge(A, 1), meshOf)).toBe(true);
  });

  it('drops a target of a body that disappeared', () => {
    expect(validTarget(face(B, 5), meshOf)).toBe(false);
  });

  it('drops an index out of range, also a range position that is not a key', () => {
    expect(validTarget(face(A, 0), meshOf)).toBe(false);
    expect(validTarget(face(A, 7), meshOf)).toBe(false);
    // Edge keys are 4 and 1: an edge index 5 is a face key, not an edge key.
    expect(validTarget(edge(A, 5), meshOf)).toBe(false);
    expect(validTarget(edge(A, 0), meshOf)).toBe(false);
  });

  it('drops a sketch entity: the highlight layer ignores it', () => {
    expect(validTarget(sketchEntity('s', 'p1'), meshOf)).toBe(false);
    expect(validTargets([sketchEntity('s', 'p1'), face(A, 5)], meshOf)).toEqual([face(A, 5)]);
  });

  it('drops a sketch region: its fill comes later (M13 Ú5)', () => {
    expect(validTarget(sketchRegion('s', 'r1'), meshOf)).toBe(false);
    expect(validTargets([sketchRegion('s', 'r1'), face(A, 5)], meshOf)).toEqual([face(A, 5)]);
  });

  it('keeps a whole body that is shown, drops one that is not (M14)', () => {
    expect(validTarget(whole(A), meshOf)).toBe(true);
    expect(validTarget(whole(B), meshOf)).toBe(false);
    expect(validTargets([whole(B), whole(A), face(A, 5)], meshOf)).toEqual([whole(A), face(A, 5)]);
  });

  it('filters a list and keeps the order', () => {
    expect(validTargets([edge(A, 1), face(B, 5), face(A, 9), face(A, 5)], meshOf)).toEqual([
      edge(A, 1),
      face(A, 5),
    ]);
  });
});

describe('bodyTriangles (M14)', () => {
  it('copies the triangles of every face, in the order of faceRanges', () => {
    const { positions } = bodyTriangles(MESH);
    // Face 5 = triangle (0, 1, 2), face 2 = triangle (0, 2, 3): 2 triangles, 9 floats each.
    expect(Array.from(positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('has as many triangles as all face ranges together', () => {
    const mesh: MeshData = { ...MESH, faceRanges: new Uint32Array([5, 0, 2]) };
    expect(bodyTriangles(mesh).positions).toHaveLength(2 * 9);
  });

  it('a mesh without faces gives no triangles', () => {
    const mesh: MeshData = { ...MESH, faceRanges: new Uint32Array([]) };
    expect(bodyTriangles(mesh).positions).toHaveLength(0);
  });

  it('is a copy: changing it leaves the mesh alone', () => {
    const { positions } = bodyTriangles(MESH);
    positions[0] = 42;
    expect(MESH.positions[0]).toBe(0);
  });
});

describe('drawnTargets', () => {
  it('drops the hover when the selection shows the same target (selection wins)', () => {
    const drawn = drawnTargets(facePick(A, 5, [1, 1, 1]), [edge(A, 4), face(A, 5)]);
    expect(drawn.hover).toBeNull();
    expect(drawn.selection).toEqual([edge(A, 4), face(A, 5)]);
  });

  it('keeps a hover on another target', () => {
    const drawn = drawnTargets(face(A, 2), [face(A, 5)]);
    expect(drawn.hover).toEqual(face(A, 2));
    expect(drawn.selection).toEqual([face(A, 5)]);
  });

  it('a whole body and its face are both drawn; the same body selected twice once', () => {
    const drawn = drawnTargets(whole(A), [whole(A), face(A, 5), whole(A)]);
    expect(drawn.hover).toBeNull();
    expect(drawn.selection).toEqual([whole(A), face(A, 5)]);
  });

  it('draws a target selected twice only once', () => {
    expect(drawnTargets(null, [face(A, 5), facePick(A, 5, [1, 1, 1])]).selection).toEqual([
      face(A, 5),
    ]);
  });
});
