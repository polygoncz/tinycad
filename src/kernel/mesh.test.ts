import { describe, expect, it } from 'vitest';
import { validateMeshData } from './mesh';
import type { MeshData } from './types';

// Two triangles of one face (unit square in z = 0, normal +z) and one edge along its bottom.
function aSquare(overrides: Partial<MeshData> = {}): MeshData {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    faceRanges: new Uint32Array([0, 0, 2]),
    edgePositions: new Float32Array([0, 0, 0, 1, 0, 0]),
    edgeRanges: new Uint32Array([0, 0, 2]),
    ...overrides,
  };
}

// Unit box built by hand: 6 faces × 4 own vertices × 2 triangles, 12 edges × 2 points.
function aBox(): MeshData {
  const faces: readonly { readonly n: readonly number[]; readonly corners: readonly number[][] }[] =
    [
      {
        n: [-1, 0, 0],
        corners: [
          [0, 0, 0],
          [0, 0, 1],
          [0, 1, 1],
          [0, 1, 0],
        ],
      },
      {
        n: [1, 0, 0],
        corners: [
          [1, 0, 0],
          [1, 1, 0],
          [1, 1, 1],
          [1, 0, 1],
        ],
      },
      {
        n: [0, -1, 0],
        corners: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 0, 1],
          [0, 0, 1],
        ],
      },
      {
        n: [0, 1, 0],
        corners: [
          [0, 1, 0],
          [0, 1, 1],
          [1, 1, 1],
          [1, 1, 0],
        ],
      },
      {
        n: [0, 0, -1],
        corners: [
          [0, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
          [1, 0, 0],
        ],
      },
      {
        n: [0, 0, 1],
        corners: [
          [0, 0, 1],
          [1, 0, 1],
          [1, 1, 1],
          [0, 1, 1],
        ],
      },
    ];
  const positions = faces.flatMap((f) => f.corners.flat());
  const normals = faces.flatMap((f) => [...f.n, ...f.n, ...f.n, ...f.n]);
  const indices = faces.flatMap((_, i) => {
    const v = i * 4;
    return [v, v + 1, v + 2, v, v + 2, v + 3];
  });
  const faceRanges = faces.flatMap((_, i) => [i, i * 2, 2]);
  const edges = [
    [0, 0, 0, 1, 0, 0],
    [1, 0, 0, 1, 1, 0],
    [1, 1, 0, 0, 1, 0],
    [0, 1, 0, 0, 0, 0],
    [0, 0, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 1],
    [1, 1, 1, 0, 1, 1],
    [0, 1, 1, 0, 0, 1],
    [0, 0, 0, 0, 0, 1],
    [1, 0, 0, 1, 0, 1],
    [1, 1, 0, 1, 1, 1],
    [0, 1, 0, 0, 1, 1],
  ];
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array(faceRanges),
    edgePositions: new Float32Array(edges.flat()),
    edgeRanges: new Uint32Array(edges.flatMap((_, i) => [i, i * 2, 2])),
  };
}

describe('validateMeshData', () => {
  it('accepts two triangles of one face with one edge', () => {
    expect(validateMeshData(aSquare())).toEqual([]);
  });

  it('accepts a hand-built box', () => {
    expect(validateMeshData(aBox())).toEqual([]);
  });

  it('accepts an empty mesh', () => {
    const empty = new Float32Array(0);
    const none = new Uint32Array(0);
    expect(
      validateMeshData({
        positions: empty,
        normals: empty,
        indices: none,
        faceRanges: none,
        edgePositions: empty,
        edgeRanges: none,
      }),
    ).toEqual([]);
  });

  describe('lengths', () => {
    it.each<[string, Partial<MeshData>]>([
      [
        'positions not divisible by 3',
        { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1]) },
      ],
      [
        'normals length differs from positions',
        { normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) },
      ],
      ['indices not divisible by 3', { indices: new Uint32Array([0, 1, 2, 0, 2]) }],
      ['faceRanges not divisible by 3', { faceRanges: new Uint32Array([0, 0, 2, 1]) }],
      ['edgePositions not divisible by 3', { edgePositions: new Float32Array([0, 0, 0, 1, 0]) }],
      ['edgeRanges not divisible by 3', { edgeRanges: new Uint32Array([0, 0, 2, 1]) }],
    ])('reports %s', (_, overrides) => {
      expect(validateMeshData(aSquare(overrides))).not.toEqual([]);
    });

    it('does not throw when every length is wrong at once', () => {
      const mesh = aSquare({
        positions: new Float32Array([0, 0]),
        normals: new Float32Array([0]),
        indices: new Uint32Array([5]),
        faceRanges: new Uint32Array([0, 0]),
        edgePositions: new Float32Array([1]),
        edgeRanges: new Uint32Array([0]),
      });
      expect(validateMeshData(mesh).length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('numbers', () => {
    it.each([Infinity, -Infinity, NaN])('reports %s in positions', (bad) => {
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
      positions[4] = bad;
      expect(validateMeshData(aSquare({ positions }))).not.toEqual([]);
    });

    it.each([Infinity, -Infinity, NaN])('reports %s in normals', (bad) => {
      const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
      normals[5] = bad;
      expect(validateMeshData(aSquare({ normals }))).not.toEqual([]);
    });

    it.each([Infinity, NaN])('reports %s in edgePositions', (bad) => {
      expect(
        validateMeshData(aSquare({ edgePositions: new Float32Array([0, 0, 0, bad, 0, 0]) })),
      ).not.toEqual([]);
    });

    it('reports a normal that is not unit length', () => {
      const normals = new Float32Array([0, 0, 1, 0, 0, 0.5, 0, 0, 1, 0, 0, 1]);
      expect(validateMeshData(aSquare({ normals }))).not.toEqual([]);
    });

    it('reports a zero normal', () => {
      const normals = new Float32Array([0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1]);
      expect(validateMeshData(aSquare({ normals }))).not.toEqual([]);
    });

    it('accepts a normal within the 1e-4 tolerance', () => {
      const normals = new Float32Array([0, 0, 1, 0, 0, 1.00005, 0, 0, 1, 0, 0, 1]);
      expect(validateMeshData(aSquare({ normals }))).toEqual([]);
    });

    it('reports a vertex index out of range', () => {
      expect(
        validateMeshData(aSquare({ indices: new Uint32Array([0, 1, 2, 0, 2, 4]) })),
      ).not.toEqual([]);
    });
  });

  describe('faceRanges', () => {
    it('reports a triangle not covered by any face', () => {
      expect(validateMeshData(aSquare({ faceRanges: new Uint32Array([0, 0, 1]) }))).not.toEqual([]);
    });

    it('reports overlapping ranges', () => {
      const messages = validateMeshData(
        aSquare({ faceRanges: new Uint32Array([0, 0, 2, 1, 1, 1]) }),
      );
      expect(messages).not.toEqual([]);
      expect(messages.join('\n')).toContain('faceRanges[1]');
    });

    it('reports a range past the last triangle', () => {
      expect(validateMeshData(aSquare({ faceRanges: new Uint32Array([0, 0, 3]) }))).not.toEqual([]);
    });

    it('reports a duplicate faceIndex', () => {
      expect(
        validateMeshData(aSquare({ faceRanges: new Uint32Array([0, 0, 1, 0, 1, 1]) })),
      ).not.toEqual([]);
    });

    it('accepts ranges sorted by firstTriangle with face indices in any order', () => {
      expect(
        validateMeshData(aSquare({ faceRanges: new Uint32Array([1, 0, 1, 0, 1, 1]) })),
      ).toEqual([]);
    });

    it('reports ranges not sorted by firstTriangle', () => {
      const messages = validateMeshData(
        aSquare({ faceRanges: new Uint32Array([0, 1, 1, 1, 0, 1]) }),
      );
      expect(messages).not.toEqual([]);
      expect(messages.join('\n')).toContain('faceRanges[1]');
    });

    it('reports two ranges with the same firstTriangle (sorted strictly)', () => {
      const messages = validateMeshData(
        aSquare({ faceRanges: new Uint32Array([0, 0, 1, 1, 0, 2]) }),
      );
      expect(messages.join('\n')).toContain('firstTriangle');
    });

    it('reports a face with no triangles', () => {
      const messages = validateMeshData(
        aSquare({ faceRanges: new Uint32Array([0, 0, 2, 1, 2, 0]) }),
      );
      expect(messages).toEqual([expect.stringContaining('faceRanges[1]: 0 triangles')]);
    });
  });

  describe('edgeRanges', () => {
    it('reports an edge with a single point', () => {
      expect(
        validateMeshData(
          aSquare({
            edgePositions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
            edgeRanges: new Uint32Array([0, 0, 2, 1, 2, 1]),
          }),
        ),
      ).not.toEqual([]);
    });

    it('reports an edge point not covered by any edge', () => {
      expect(
        validateMeshData(aSquare({ edgePositions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]) })),
      ).not.toEqual([]);
    });

    it('reports overlapping ranges', () => {
      expect(
        validateMeshData(
          aSquare({
            edgePositions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
            edgeRanges: new Uint32Array([0, 0, 2, 1, 1, 2]),
          }),
        ),
      ).not.toEqual([]);
    });

    it('reports a range past the last point', () => {
      expect(validateMeshData(aSquare({ edgeRanges: new Uint32Array([0, 0, 3]) }))).not.toEqual([]);
    });

    it('reports a duplicate edgeIndex', () => {
      expect(
        validateMeshData(
          aSquare({
            edgePositions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
            edgeRanges: new Uint32Array([0, 0, 2, 0, 2, 2]),
          }),
        ),
      ).not.toEqual([]);
    });

    it('reports ranges not sorted by firstPoint', () => {
      const messages = validateMeshData(
        aSquare({
          edgePositions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
          edgeRanges: new Uint32Array([0, 2, 2, 1, 0, 2]),
        }),
      );
      expect(messages).not.toEqual([]);
      expect(messages.join('\n')).toContain('edgeRanges[1]');
    });
  });
});
