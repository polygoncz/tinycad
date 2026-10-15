import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import type { FeatureId, TopoName } from '@/document';
import type {
  EdgeInfo,
  FaceInfo,
  HistoryLink,
  ShapeHistory,
  SubShapeIndex,
  TopologySummary,
} from '@/kernel';
import { EMPTY_NAMES, propagateNames } from '@/regen/names';
import type { NameTable } from '@/regen/names';

// Hand-built topologies and histories (spec 08, Tabulka jmen a přenos): no kernel needed.

// Ids and names are created by a cast in tests only: the table never parses them.
const fid = (s: string): FeatureId => s as FeatureId;
const tn = (s: string): TopoName => s as TopoName;
const face = (index: number): SubShapeIndex => ({ type: 'face', index });
const edge = (index: number): SubShapeIndex => ({ type: 'edge', index });
const vertex = (index: number): SubShapeIndex => ({ type: 'vertex', index });
const PLANE: FaceInfo = { surface: 'plane', plane: { origin: [0, 0, 0], normal: [0, 0, 1] } };

function anEdge(faces: readonly number[], vertices: readonly number[], midpoint: Vec3): EdgeInfo {
  return { faces, vertices, midpoint };
}

/**
 * The topology of an axis-aligned box in the face order of the fake kernel: left 0 (−X),
 * right 1 (+X), front 2 (−Y), back 3 (+Y), bottom 4 (−Z), top 5 (+Z). Vertex v = x + 2y + 4z
 * for the corner (x, y, z) ∈ {0, 1}³.
 */
function boxTopology(): TopologySummary {
  // An edge along one axis is the line between two corners; its faces are the two faces that
  // hold both corners.
  const facesOf = (v: number): number[] => [v & 1 ? 1 : 0, v & 2 ? 3 : 2, v & 4 ? 5 : 4];
  const corner = (v: number): Vec3 => [v & 1, (v >> 1) & 1, (v >> 2) & 1];
  const edges: EdgeInfo[] = [];
  for (let a = 0; a < 8; a++) {
    for (const bit of [1, 2, 4]) {
      if (a & bit) continue;
      const b = a | bit;
      const shared = facesOf(a).filter((f) => facesOf(b).includes(f));
      const [ax, ay, az] = corner(a);
      const [bx, by, bz] = corner(b);
      edges.push(
        anEdge(
          [...shared].sort((x, y) => x - y),
          [a, b],
          [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2],
        ),
      );
    }
  }
  return { faces: Array.from({ length: 6 }, () => PLANE), edges, vertexCount: 8 };
}

const BOX_ROLES = {
  'face:left': [face(0)],
  'face:right': [face(1)],
  'face:front': [face(2)],
  'face:back': [face(3)],
  'face:bottom': [face(4)],
  'face:top': [face(5)],
};

function aBoxTable(id = 'box'): NameTable {
  return propagateNames({
    featureId: fid(id),
    inputs: [],
    roles: BOX_ROLES,
    topology: boxTopology(),
  });
}

const identity = (input: number, count: number): HistoryLink[] =>
  Array.from({ length: count }, (_, i) => ({ input, from: face(i), to: [face(i)] }));

function aHistory(h: Partial<ShapeHistory>): ShapeHistory {
  return { modified: [], generated: [], deleted: [], ...h };
}

/** A topology of `n` faces without edges. */
function facesOnly(n: number): TopologySummary {
  return { faces: Array.from({ length: n }, () => PLANE), edges: [], vertexCount: 0 };
}

describe('propagateNames: roles', () => {
  it('names the six faces of a box by role and its twelve edges by their two faces', () => {
    const t = aBoxTable();
    expect([...t.faceEntries.keys()]).toEqual([
      'box/face:back',
      'box/face:bottom',
      'box/face:front',
      'box/face:left',
      'box/face:right',
      'box/face:top',
    ]);
    expect(t.nameOfFace(5)).toBe('box/face:top');
    expect(t.faces(tn('box/face:top'))).toEqual([5]);
    expect(t.edgeEntries.size).toBe(12);
    for (const name of t.edgeEntries.keys())
      expect(name).toMatch(/^edge:box\/face:\w+\|box\/face:\w+$/);
    // Edge 0 joins corners 0 and 1: front (−Y) and bottom (−Z); A ≤ B in sort order.
    expect(t.nameOfEdge(0)).toBe('edge:box/face:bottom|box/face:front');
    expect(t.edges(t.nameOfEdge(0) ?? fail())).toEqual([0]);
  });

  it('ignores role keys that are not faces', () => {
    const t = propagateNames({
      featureId: fid('f'),
      inputs: [],
      roles: { 'edge:l1': [edge(0)], 'face:start': [face(0)] },
      topology: facesOnly(1),
    });
    expect([...t.faceEntries.keys()]).toEqual(['f/face:start']);
    expect(t.edgeEntries.size).toBe(0);
  });

  it('gives one role name to all faces of the role', () => {
    const t = propagateNames({
      featureId: fid('f'),
      inputs: [],
      roles: { 'face:end': [face(2), face(0)] },
      topology: facesOnly(3),
    });
    expect(t.faces(tn('f/face:end'))).toEqual([0, 2]);
    expect(t.nameOfFace(1)).toBeUndefined();
  });
});

describe('propagateNames: history', () => {
  it('keeps the names through an identity history (a transform)', () => {
    const box = aBoxTable();
    const moved = propagateNames({
      featureId: fid('move'),
      inputs: [box],
      history: aHistory({ modified: identity(0, 6) }),
      topology: boxTopology(),
    });
    expect([...moved.faceEntries]).toEqual([...box.faceEntries]);
    expect([...moved.edgeEntries]).toEqual([...box.edgeEntries]);
  });

  it('gives a split face its name on both output faces', () => {
    const input = propagateNames({
      featureId: fid('a'),
      inputs: [],
      roles: { 'face:x': [face(0)] },
      topology: facesOnly(1),
    });
    const t = propagateNames({
      featureId: fid('cut'),
      inputs: [input],
      history: aHistory({ modified: [{ input: 0, from: face(0), to: [face(0), face(1)] }] }),
      topology: facesOnly(2),
    });
    expect(t.faces(tn('a/face:x'))).toEqual([0, 1]);
    expect(t.nameOfFace(1)).toBe('a/face:x');
  });

  it('keeps all names on a merged face; the primary one is the first by sort order', () => {
    const a = propagateNames({
      featureId: fid('a'),
      inputs: [],
      roles: { 'face:z': [face(0)] },
      topology: facesOnly(1),
    });
    const b = propagateNames({
      featureId: fid('b'),
      inputs: [],
      roles: { 'face:y': [face(0)] },
      topology: facesOnly(1),
    });
    const t = propagateNames({
      featureId: fid('u'),
      inputs: [a, b],
      history: aHistory({
        modified: [
          { input: 0, from: face(0), to: [face(0)] },
          { input: 1, from: face(0), to: [face(0)] },
        ],
      }),
      topology: facesOnly(1),
    });
    expect(t.namesOfFace(0)).toEqual(['a/face:z', 'b/face:y']);
    expect(t.nameOfFace(0)).toBe('a/face:z');
    expect(t.faces(tn('b/face:y'))).toEqual([0]);
  });

  it('drops the name of a deleted face', () => {
    const box = aBoxTable();
    const t = propagateNames({
      featureId: fid('cut'),
      inputs: [box],
      history: aHistory({
        modified: identity(0, 5),
        deleted: [{ input: 0, sub: face(5) }],
      }),
      topology: facesOnly(5),
    });
    expect(t.faces(tn('box/face:top'))).toEqual([]);
    expect(t.faceEntries.has(tn('box/face:top'))).toBe(false);
    expect(t.faceEntries.size).toBe(5);
  });

  it('names a face generated from an edge by the tag and the edge name', () => {
    const box = aBoxTable();
    const edgeName = box.nameOfEdge(0) ?? fail();
    const t = propagateNames({
      featureId: fid('fil'),
      inputs: [box],
      history: aHistory({
        modified: identity(0, 6),
        generated: [{ input: 0, from: edge(0), to: [face(6)] }],
      }),
      topology: facesOnly(7),
      generatedTag: 'fillet',
    });
    expect(t.nameOfFace(6)).toBe(`fil/face:fillet:${edgeName}`);
    expect(t.nameOfFace(6)).toBe('fil/face:fillet:edge:box/face:bottom|box/face:front');
  });

  it('names a face generated from a vertex by the sorted names of the faces around the vertex', () => {
    const box = aBoxTable();
    const t = propagateNames({
      featureId: fid('fil'),
      inputs: [box],
      history: aHistory({
        modified: identity(0, 6),
        generated: [{ input: 0, from: vertex(0), to: [face(6)] }],
      }),
      topology: facesOnly(7),
      generatedTag: 'fillet',
    });
    // Corner 0 = (0, 0, 0): left, front, bottom.
    expect(t.nameOfFace(6)).toBe(
      'fil/face:fillet:vertex:box/face:bottom|box/face:front|box/face:left',
    );
  });

  it('names a face generated from a face with the default tag gen', () => {
    const box = aBoxTable();
    const t = propagateNames({
      featureId: fid('b'),
      inputs: [box],
      history: aHistory({
        modified: identity(0, 6),
        generated: [{ input: 0, from: face(5), to: [face(6)] }],
      }),
      topology: facesOnly(7),
    });
    expect(t.nameOfFace(6)).toBe('b/face:gen:box/face:top');
  });

  it('skips a generated source without a name', () => {
    const t = propagateNames({
      featureId: fid('ex'),
      inputs: [EMPTY_NAMES],
      history: aHistory({
        deleted: [{ input: 0, sub: face(0) }],
        generated: [{ input: 0, from: edge(3), to: [face(0)] }],
      }),
      topology: facesOnly(1),
    });
    expect(t.nameOfFace(0)).toBeUndefined();
    expect(t.namesOfFace(0)).toEqual([]);
    expect(t.faceEntries.size).toBe(0);
  });

  it('gives the role precedence over generated', () => {
    const box = aBoxTable();
    const t = propagateNames({
      featureId: fid('ex'),
      inputs: [box],
      history: aHistory({
        modified: identity(0, 6),
        generated: [{ input: 0, from: edge(0), to: [face(6)] }],
      }),
      roles: { 'face:side:l1': [face(6)] },
      topology: facesOnly(7),
    });
    expect(t.namesOfFace(6)).toEqual(['ex/face:side:l1']);
  });

  it('leaves a face without history and role without a name', () => {
    const t = propagateNames({ featureId: fid('f'), inputs: [], topology: facesOnly(2) });
    expect(t.nameOfFace(0)).toBeUndefined();
    expect(t.nameOfFace(7)).toBeUndefined();
    expect(t.namesOfFace(7)).toEqual([]);
  });
});

describe('propagateNames: edges', () => {
  // Two faces A (0) and B (1) joined by two edges, like a cylinder side cut by a plane twice.
  // Faces C (2) and D (3) touch the ends of edge 0, E (4) the ends of edge 1.
  function twoEdgesBetween(
    roles: Record<string, readonly SubShapeIndex[]>,
    midpoints: [Vec3, Vec3],
  ) {
    const topology: TopologySummary = {
      faces: Array.from({ length: 5 }, () => PLANE),
      edges: [
        anEdge([0, 1], [0, 1], midpoints[0]),
        anEdge([0, 1], [2, 3], midpoints[1]),
        anEdge([0, 2], [0], [0, 0, 0]),
        anEdge([1, 3], [1], [0, 0, 0]),
        anEdge([0, 4], [2], [0, 0, 0]),
        anEdge([1, 4], [3], [0, 0, 0]),
      ],
      vertexCount: 4,
    };
    return propagateNames({ featureId: fid('f'), inputs: [], roles, topology });
  }

  it('tells two edges between the same faces apart by the faces around their vertices', () => {
    const t = twoEdgesBetween(
      {
        'face:a': [face(0)],
        'face:b': [face(1)],
        'face:c': [face(2)],
        'face:d': [face(3)],
        'face:e': [face(4)],
      },
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
    );
    expect(t.nameOfEdge(0)).toBe('edge:f/face:a|f/face:b[f/face:c,f/face:d]');
    expect(t.nameOfEdge(1)).toBe('edge:f/face:a|f/face:b[f/face:e]');
    expect(t.nameOfEdge(2)).toBe('edge:f/face:a|f/face:c');
  });

  it('numbers edges with the same context by their midpoint (#1, #2)', () => {
    const t = twoEdgesBetween(
      { 'face:a': [face(0)], 'face:b': [face(1)], 'face:c': [face(2), face(3), face(4)] },
      [
        [0, 5, 0],
        [0, 1, 0],
      ],
    );
    expect(t.nameOfEdge(1)).toBe('edge:f/face:a|f/face:b[f/face:c]#1');
    expect(t.nameOfEdge(0)).toBe('edge:f/face:a|f/face:b[f/face:c]#2');
  });

  it('falls back to the index when midpoints match within 1e-9', () => {
    const t = twoEdgesBetween(
      { 'face:a': [face(0)], 'face:b': [face(1)], 'face:c': [face(2), face(3), face(4)] },
      [
        [1, 1, 1],
        [1, 1 - 1e-12, 1],
      ],
    );
    expect(t.nameOfEdge(0)).toBe('edge:f/face:a|f/face:b[f/face:c]#1');
    expect(t.nameOfEdge(1)).toBe('edge:f/face:a|f/face:b[f/face:c]#2');
  });

  it('writes an empty context as []', () => {
    const topology: TopologySummary = {
      faces: [PLANE, PLANE],
      edges: [anEdge([0, 1], [0], [0, 0, 0]), anEdge([0, 1], [1], [1, 0, 0])],
      vertexCount: 2,
    };
    const t = propagateNames({
      featureId: fid('f'),
      inputs: [],
      roles: { 'face:a': [face(0)], 'face:b': [face(1)] },
      topology,
    });
    expect(t.nameOfEdge(0)).toBe('edge:f/face:a|f/face:b[]#1');
    expect(t.nameOfEdge(1)).toBe('edge:f/face:a|f/face:b[]#2');
  });

  it('names a seam with one adjacent face edge:A|A', () => {
    const topology: TopologySummary = {
      faces: [PLANE],
      edges: [anEdge([0], [0], [0, 0, 0])],
      vertexCount: 1,
    };
    const t = propagateNames({
      featureId: fid('c'),
      inputs: [],
      roles: { 'face:side': [face(0)] },
      topology,
    });
    expect(t.nameOfEdge(0)).toBe('edge:c/face:side|c/face:side');
  });

  it('leaves an edge next to a face without a name without a name', () => {
    const topology: TopologySummary = {
      faces: [PLANE, PLANE],
      edges: [anEdge([0, 1], [0, 1], [0, 0, 0])],
      vertexCount: 2,
    };
    const t = propagateNames({
      featureId: fid('f'),
      inputs: [],
      roles: { 'face:a': [face(0)] },
      topology,
    });
    expect(t.nameOfEdge(0)).toBeUndefined();
    expect(t.edgeEntries.size).toBe(0);
  });

  it('uses the primary name of a merged face for its edges', () => {
    const a = propagateNames({
      featureId: fid('a'),
      inputs: [],
      roles: { 'face:p': [face(0)], 'face:q': [face(1)] },
      topology: facesOnly(2),
    });
    const t = propagateNames({
      featureId: fid('u'),
      inputs: [a],
      history: aHistory({
        modified: [
          { input: 0, from: face(0), to: [face(0)] },
          { input: 0, from: face(1), to: [face(0)] },
        ],
      }),
      topology: { faces: [PLANE], edges: [anEdge([0], [], [0, 0, 0])], vertexCount: 0 },
    });
    expect(t.nameOfEdge(0)).toBe('edge:a/face:p|a/face:p');
  });
});

describe('propagateNames: determinism and errors', () => {
  it('gives the same table when history and roles come in another order', () => {
    const box = aBoxTable();
    const history = aHistory({
      modified: identity(0, 6),
      generated: [
        { input: 0, from: edge(0), to: [face(6)] },
        { input: 0, from: vertex(0), to: [face(7)] },
      ],
    });
    const topology = facesOnly(9);
    const roles = { 'face:z': [face(8)], 'face:a': [face(6)] };
    const one = propagateNames({ featureId: fid('f'), inputs: [box], history, roles, topology });
    const shuffledRoles = { 'face:a': [face(6)], 'face:z': [face(8)] };
    const shuffled = aHistory({
      modified: [...history.modified].reverse(),
      generated: [...history.generated].reverse(),
    });
    const two = propagateNames({
      featureId: fid('f'),
      inputs: [box],
      history: shuffled,
      roles: shuffledRoles,
      topology,
    });
    expect([...two.faceEntries]).toEqual([...one.faceEntries]);
    expect([...two.faceEntries.keys()]).toEqual([...one.faceEntries.keys()].sort());
  });

  it('freezes the table and its arrays', () => {
    const t = aBoxTable();
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.faces(tn('box/face:top')))).toBe(true);
    expect(Object.isFrozen(t.namesOfFace(0))).toBe(true);
    expect(Object.isFrozen(t.faces(tn('nothing')))).toBe(true);
  });

  it('throws on a role index out of the output range', () => {
    expect(() =>
      propagateNames({
        featureId: fid('f'),
        inputs: [],
        roles: { 'face:x': [face(3)] },
        topology: facesOnly(3),
      }),
    ).toThrow();
  });

  it('throws on a history index out of the output range', () => {
    expect(() =>
      propagateNames({
        featureId: fid('f'),
        inputs: [aBoxTable()],
        history: aHistory({ modified: [{ input: 0, from: face(0), to: [face(6)] }] }),
        topology: facesOnly(6),
      }),
    ).toThrow();
  });

  it('throws on a history index out of the input range', () => {
    expect(() =>
      propagateNames({
        featureId: fid('f'),
        inputs: [aBoxTable()],
        history: aHistory({ deleted: [{ input: 0, sub: face(6) }] }),
        topology: facesOnly(6),
      }),
    ).toThrow();
    expect(() =>
      propagateNames({
        featureId: fid('f'),
        inputs: [aBoxTable()],
        history: aHistory({ generated: [{ input: 0, from: vertex(8), to: [face(0)] }] }),
        topology: facesOnly(6),
      }),
    ).toThrow();
  });

  it('throws on an unknown input', () => {
    expect(() =>
      propagateNames({
        featureId: fid('f'),
        inputs: [aBoxTable()],
        history: aHistory({ modified: [{ input: 1, from: face(0), to: [face(0)] }] }),
        topology: facesOnly(6),
      }),
    ).toThrow();
  });

  it('throws on an edge face index out of the output range', () => {
    expect(() =>
      propagateNames({
        featureId: fid('f'),
        inputs: [],
        topology: { faces: [PLANE], edges: [anEdge([0, 1], [], [0, 0, 0])], vertexCount: 0 },
      }),
    ).toThrow();
  });
});

describe('EMPTY_NAMES', () => {
  it('has no names and an empty topology', () => {
    expect(EMPTY_NAMES.faceEntries.size).toBe(0);
    expect(EMPTY_NAMES.edgeEntries.size).toBe(0);
    expect(EMPTY_NAMES.topology).toEqual({ faces: [], edges: [], vertexCount: 0 });
    expect(EMPTY_NAMES.nameOfFace(0)).toBeUndefined();
    expect(EMPTY_NAMES.nameOfEdge(0)).toBeUndefined();
    expect(EMPTY_NAMES.namesOfFace(0)).toEqual([]);
    expect(EMPTY_NAMES.faces(tn('x'))).toEqual([]);
    expect(EMPTY_NAMES.edges(tn('x'))).toEqual([]);
  });

  it('is frozen, topology included', () => {
    expect(Object.isFrozen(EMPTY_NAMES)).toBe(true);
    expect(Object.isFrozen(EMPTY_NAMES.topology)).toBe(true);
    expect(Object.isFrozen(EMPTY_NAMES.topology.faces)).toBe(true);
    expect(Object.isFrozen(EMPTY_NAMES.topology.edges)).toBe(true);
  });
});

function fail(): never {
  throw new Error('Expected a value');
}
