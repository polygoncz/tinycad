import type { FeatureId, TopoName } from '@/document';
import type { QueryOps, ShapeHistory, ShapeResult, SubShapeIndex, TopologySummary } from '@/kernel';

// Topological names (spec 08, ADR 0018): from the roles and the history the kernel returns and
// from the topology of the output, a pure function builds the name table of one shape. This is
// the one place that mints a TopoName; everyone else only compares and stores it.

/** Topological names of the faces and edges of one shape and the topology they came from. */
export interface NameTable {
  /** Indices of the faces with the name, ascending; unknown name → []. */
  faces(name: TopoName): readonly number[];
  edges(name: TopoName): readonly number[];
  /** Primary name: the first of the names of the face by sort order; no name (index out of range, too) → undefined. */
  nameOfFace(index: number): TopoName | undefined;
  nameOfEdge(index: number): TopoName | undefined;
  /** All names of the face, sorted; [] = no name. For carrying merged faces over. */
  namesOfFace(index: number): readonly TopoName[];
  /** Name → indices, keys in the sort order of the names. */
  readonly faceEntries: ReadonlyMap<TopoName, readonly number[]>;
  readonly edgeEntries: ReadonlyMap<TopoName, readonly number[]>;
  /** Topology of the shape the table came from. */
  readonly topology: TopologySummary;
}

const NONE: readonly never[] = Object.freeze([]);

/** No names, a topology with 0 faces, 0 edges and 0 vertices; frozen. */
export const EMPTY_NAMES: NameTable = createNameTable(
  [],
  [],
  Object.freeze({ faces: NONE, edges: NONE, vertexCount: 0 }),
);

/**
 * The name table of an output shape (spec 08, rules 1–8): role names, names inherited through
 * `modified`, names of faces generated from named sub-shapes, then edge names from the faces.
 * Pure and independent of the order of the history and the roles. An index out of range or an
 * unknown input throws: that is an adapter bug, not a user error.
 */
export function propagateNames(p: {
  readonly featureId: FeatureId;
  /** Tables of the input shapes; index = HistoryLink.input. An input without names (a profile face) = EMPTY_NAMES. */
  readonly inputs: readonly NameTable[];
  readonly history?: ShapeHistory;
  readonly roles?: Readonly<Record<string, readonly SubShapeIndex[]>>;
  /** Topology of the output shape. */
  readonly topology: TopologySummary;
  /** Tag of the names of generated faces; default 'gen'. */
  readonly generatedTag?: string;
}): NameTable {
  const { featureId, inputs, history, roles = {}, topology } = p;
  const tag = p.generatedTag ?? 'gen';
  const faceNames: Set<string>[] = topology.faces.map(() => new Set<string>());
  const output = (sub: SubShapeIndex): number => checkIndex(sub, topology, 'output');

  // Rule 1: roles. Only face roles name faces; edge roles of makeFace are for the kernel.
  const withRole = new Set<number>();
  for (const [key, subs] of Object.entries(roles)) {
    if (!key.startsWith('face:')) continue;
    for (const sub of subs) {
      const index = output(expectFace(sub, `role '${key}'`));
      withRole.add(index);
      faceNames[index]?.add(`${featureId}/${key}`);
    }
  }

  if (history !== undefined) {
    const input = (n: number): NameTable => {
      const table = inputs[n];
      if (table === undefined || !Number.isInteger(n))
        throw new Error(`Unknown input ${String(n)}`);
      return table;
    };
    // Rules 2, 3 and 6: an output face inherits all names of each input face it came from.
    for (const link of history.modified) {
      const table = input(link.input);
      const from = checkInputIndex(expectFace(link.from, 'modified'), table);
      for (const to of link.to) {
        const index = output(to);
        if (to.type !== 'face') continue;
        for (const name of table.namesOfFace(from)) faceNames[index]?.add(name);
      }
    }
    // Rule 4: a generated face without a role is named after its named source.
    for (const link of history.generated) {
      const table = input(link.input);
      checkInputIndex(link.from, table);
      const source = sourceName(link.from, table);
      for (const to of link.to) {
        const index = output(to);
        if (to.type !== 'face' || withRole.has(index) || source === undefined) continue;
        faceNames[index]?.add(`${featureId}/face:${tag}:${source}`);
      }
    }
    // Rule 5: a deleted face simply passes its names to nobody.
    for (const d of history.deleted) checkInputIndex(d.sub, input(d.input));
  }

  const sortedFaceNames = faceNames.map((names) => [...names].sort());
  const primary = sortedFaceNames.map((names): string | undefined => names[0]);
  for (const e of topology.edges) for (const f of e.faces) output({ type: 'face', index: f });
  return createNameTable(sortedFaceNames, edgeNames(topology, primary), topology);
}

/**
 * The name table of a kernel result: kernel.topology(result.shape) and propagateNames over its
 * roles and history. The one call a builder makes; `inputs` are the tables of the input shapes
 * in the order the builder passed them to the kernel (spec 08).
 */
export async function nameShape(p: {
  readonly kernel: Pick<QueryOps, 'topology'>;
  readonly featureId: FeatureId;
  readonly result: ShapeResult;
  readonly inputs: readonly NameTable[];
  readonly generatedTag?: string;
}): Promise<NameTable> {
  const { result } = p;
  const topology = await p.kernel.topology(result.shape);
  return propagateNames({
    featureId: p.featureId,
    inputs: p.inputs,
    topology,
    ...(result.history === undefined ? {} : { history: result.history }),
    ...(result.roles === undefined ? {} : { roles: result.roles }),
    ...(p.generatedTag === undefined ? {} : { generatedTag: p.generatedTag }),
  });
}

/** Rule 7 and Q014: an edge is named after its two faces, then the faces at its ends, then #k by its midpoint. */
function edgeNames(
  topology: TopologySummary,
  primary: readonly (string | undefined)[],
): (string | undefined)[] {
  const names: (string | undefined)[] = topology.edges.map((e) => baseEdgeName(e.faces, primary));
  const facesAroundVertex = vertexFaces(topology);

  for (const group of groupsOfSameName(names)) {
    for (const index of group) {
      const edge = topology.edges[index];
      const base = names[index];
      if (edge === undefined || base === undefined) continue;
      const own = new Set(edge.faces.map((f) => primary[f]));
      const context = new Set<string>();
      for (const v of edge.vertices) {
        for (const f of facesAroundVertex[v] ?? []) {
          const name = primary[f];
          if (name !== undefined && !own.has(name)) context.add(name);
        }
      }
      names[index] = `${base}[${[...context].sort().join(',')}]`;
    }
  }

  for (const group of groupsOfSameName(names)) {
    const ordered = [...group].sort((a, b) => compareMidpoints(topology, a, b));
    ordered.forEach((index, k) => {
      names[index] = `${names[index] ?? ''}#${String(k + 1)}`;
    });
  }
  return names;
}

/** edge:<A>|<B> with A ≤ B; a seam with one face edge:<A>|<A>; a face without a name → no name. */
function baseEdgeName(
  faces: readonly number[],
  primary: readonly (string | undefined)[],
): string | undefined {
  const [first, second] = faces;
  if (first === undefined || faces.length > 2) return undefined;
  const a = primary[first];
  const b = primary[second ?? first];
  if (a === undefined || b === undefined) return undefined;
  return a <= b ? `edge:${a}|${b}` : `edge:${b}|${a}`;
}

/** Indices of the edges sharing a name with another edge, one group per name. */
function groupsOfSameName(names: readonly (string | undefined)[]): number[][] {
  const byName = new Map<string, number[]>();
  names.forEach((name, index) => {
    if (name === undefined) return;
    const group = byName.get(name);
    if (group === undefined) byName.set(name, [index]);
    else group.push(index);
  });
  return [...byName.values()].filter((g) => g.length > 1);
}

const MIDPOINT_TOLERANCE = 1e-9;

/** Midpoints lexicographically by x, y, z (equal within 1e-9), then by index. */
function compareMidpoints(topology: TopologySummary, a: number, b: number): number {
  const pa = topology.edges[a]?.midpoint;
  const pb = topology.edges[b]?.midpoint;
  if (pa !== undefined && pb !== undefined) {
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (Math.abs(d) > MIDPOINT_TOLERANCE) return d;
    }
  }
  return a - b;
}

/** For each vertex the faces around it: the adjacent faces of all edges that hold it. */
function vertexFaces(topology: TopologySummary): Set<number>[] {
  const around = Array.from({ length: topology.vertexCount }, () => new Set<number>());
  for (const edge of topology.edges) {
    for (const v of edge.vertices) {
      const set = around[v];
      if (set === undefined) throw new Error(`Vertex ${String(v)} out of range`);
      for (const f of edge.faces) set.add(f);
    }
  }
  return around;
}

/** The primary name of a source sub-shape of an input; a vertex: vertex:<A>|<B>|… of the faces around it. */
function sourceName(sub: SubShapeIndex, table: NameTable): string | undefined {
  if (sub.type === 'face') return table.nameOfFace(sub.index);
  if (sub.type === 'edge') return table.nameOfEdge(sub.index);
  const faces = vertexFaces(table.topology)[sub.index];
  if (faces === undefined || faces.size === 0) return undefined;
  const names = [...faces].map((f) => table.nameOfFace(f));
  if (names.some((n) => n === undefined)) return undefined;
  return `vertex:${[...new Set(names)].sort().join('|')}`;
}

function expectFace(sub: SubShapeIndex, where: string): SubShapeIndex {
  if (sub.type !== 'face') throw new Error(`Expected a face in ${where}, got ${sub.type}`);
  return sub;
}

/** The index of `sub` if it lies in `topology`, else throws. */
function checkIndex(sub: SubShapeIndex, topology: TopologySummary, where: string): number {
  const count =
    sub.type === 'face'
      ? topology.faces.length
      : sub.type === 'edge'
        ? topology.edges.length
        : topology.vertexCount;
  if (!Number.isInteger(sub.index) || sub.index < 0 || sub.index >= count) {
    throw new Error(
      `${sub.type} ${String(sub.index)} out of range of the ${where} (${String(count)})`,
    );
  }
  return sub.index;
}

/**
 * An input index is checked only against an input with a known topology: an input without
 * names (EMPTY_NAMES for a profile face) has an empty topology, and its sub-shapes have no
 * names to look up anyway.
 */
function checkInputIndex(sub: SubShapeIndex, table: NameTable): number {
  const t = table.topology;
  if (t.faces.length === 0 && t.edges.length === 0 && t.vertexCount === 0) return sub.index;
  return checkIndex(sub, t, 'input');
}

/** A frozen table over the sorted names of each face and the name of each edge. */
function createNameTable(
  facesNames: readonly (readonly string[])[],
  edgesNames: readonly (string | undefined)[],
  topology: TopologySummary,
): NameTable {
  // The one cast to TopoName (ADR 0018): names are minted here and nowhere else.
  const mint = (name: string): TopoName => name as TopoName;
  const namesOfFaces: readonly (readonly TopoName[])[] = Object.freeze(
    facesNames.map((names) => Object.freeze(names.map(mint))),
  );
  const faceEntries = entries(namesOfFaces);
  const edgeEntries = entries(
    edgesNames.map((name) => (name === undefined ? NONE : Object.freeze([mint(name)]))),
  );
  const edgeName = (index: number): TopoName | undefined =>
    edgesNames[index] === undefined ? undefined : mint(edgesNames[index]);

  return Object.freeze({
    faces: (name: TopoName) => faceEntries.get(name) ?? NONE,
    edges: (name: TopoName) => edgeEntries.get(name) ?? NONE,
    nameOfFace: (index: number) => namesOfFaces[index]?.[0],
    nameOfEdge: edgeName,
    namesOfFace: (index: number) => namesOfFaces[index] ?? NONE,
    faceEntries,
    edgeEntries,
    topology,
  });
}

/** Name → ascending indices of the sub-shapes that carry it, keys in sort order. */
function entries(
  namesByIndex: readonly (readonly TopoName[])[],
): ReadonlyMap<TopoName, readonly number[]> {
  const byName = new Map<TopoName, number[]>();
  namesByIndex.forEach((names, index) => {
    for (const name of names) {
      const indices = byName.get(name);
      if (indices === undefined) byName.set(name, [index]);
      else indices.push(index);
    }
  });
  const sorted = [...byName.keys()].sort();
  return new Map(sorted.map((name) => [name, Object.freeze(byName.get(name) ?? [])]));
}
