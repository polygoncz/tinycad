// The runner of the shared cases regen (spec 13, Druhy případů › regen): a stored document loaded
// with the schemas of all built-in feature plugins and regenerated once from scratch over the
// OCCT kernel in the calling thread. The output pins what the C++ core must rebuild: the statuses
// of the features, the bodies by their topological names and geometric signatures (never by the
// indices of sub-shapes, Q108), the sketches with their regions and the anchors.

import { beforeAll } from 'vitest';
import type { Vec3 } from '@/core';
import { fromData } from '@/document';
import type { FeatureId } from '@/document';
import type { FaceInfo, GeometryKernel } from '@/kernel';
import { createInThreadOcctKernel } from '@/kernel-occt/testing';
import { bodiesOf, createRegenerator, sketchesOf } from '@/regen';
import type { Body, FeatureStatus, RegenResult, RegenState, SketchArtifact } from '@/regen';
import type { CaseOutcome } from './support/case';
import { FINE_MESH, meshVolume } from './support/mesh-volume';
import { builtInRegistries } from './support/plugins';
import { describeSharedCases } from './support/runner';
import { compareIssues, compareStrings, normalizeOutline, sortKey } from './support/sort';

/** One regeneration over OCCT with a fine mesh per body takes a few seconds on a loaded machine. */
const TIMEOUT_MS = 60_000;

const { schemas, builders } = builtInRegistries();

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await createInThreadOcctKernel();
}, TIMEOUT_MS);

describeSharedCases(
  'regen',
  { regen: { run: (input) => regenerate(input) } },
  {
    timeout: TIMEOUT_MS,
  },
);

interface RegenInput {
  readonly document: unknown;
  readonly inputOf?: FeatureId;
}

/** Loads the document, regenerates it once with a new Regenerator and describes the result. */
async function regenerate(input: unknown): Promise<CaseOutcome> {
  const { document, inputOf } = regenInput(input);
  const loaded = fromData(document, schemas);
  if (!loaded.ok) throw new Error(`The document does not load: ${JSON.stringify(loaded.error)}`);
  const regenerator = createRegenerator({ kernel, schemas, builders, now: () => 0 });
  const result = await regenerator.run(
    loaded.value.studio,
    inputOf === undefined ? {} : { inputOf },
  );
  if (result === 'superseded') throw new Error('A single run cannot be superseded');
  const output = await describeResult(result);
  if (inputOf === undefined) return { ok: output };
  // Only with inputOf (spec 13): the state in front of the edited feature, null when the feature
  // is behind the rollback bar or unknown (RegenResult.input).
  const inputState =
    result.input === null
      ? null
      : { feature: result.input.feature, ...(await describeState(result.input.state)) };
  return { ok: { ...output, input: inputState } };
}

async function describeResult(result: RegenResult) {
  const statuses: Record<string, unknown> = {};
  for (const [id, status] of result.statuses) statuses[id] = describeStatus(status);
  const { bodies, sketches } = await describeState(result.finalState);
  const anchors: Record<string, unknown> = {};
  for (const [id, featureAnchors] of result.anchors) anchors[id] = featureAnchors;
  return { statuses, bodies, sketches, anchors };
}

/** The bodies and sketches of a state, each sorted by id. */
async function describeState(state: RegenState) {
  const bodies = [];
  for (const body of [...bodiesOf(state)].sort(byId)) bodies.push(await describeBody(body));
  const sketches = [...sketchesOf(state)].sort(byId).map(describeSketch);
  return { bodies, sketches };
}

/**
 * `{ kind }`, with code and issues for an error; never the message (spec 13). The issues are
 * sorted like those of schema.validate.
 */
function describeStatus(status: FeatureStatus) {
  if (status.kind !== 'error') return { kind: status.kind };
  const { code, issues } = status.error;
  return issues === undefined
    ? { kind: status.kind, code }
    : { kind: status.kind, code, issues: [...issues].sort(compareIssues) };
}

async function describeBody(body: Body) {
  const [bbox, topology, mesh] = await Promise.all([
    kernel.boundingBox(body.shape),
    kernel.topology(body.shape),
    kernel.tessellate(body.shape, FINE_MESH),
  ]);
  const faces = topology.faces
    .map((face, i) => ({ names: [...body.names.namesOfFace(i)].sort(), ...faceSignature(face) }))
    .sort((a, b) => compareNames(a.names, b.names) || compareFaces(a, b));
  const edges = topology.edges
    .map((edge, i) => {
      // An edge carries at most one name (spec 08): the NameTable has no namesOfEdge.
      const name = body.names.nameOfEdge(i);
      return { names: name === undefined ? [] : [name], midpoint: edge.midpoint };
    })
    .sort((a, b) => compareNames(a.names, b.names) || compareVectors(a.midpoint, b.midpoint));
  return {
    id: body.id,
    origin: body.origin,
    lastModifiedBy: body.lastModifiedBy,
    volume: meshVolume(mesh),
    bbox: { min: bbox.min, max: bbox.max },
    faces,
    edges,
    vertexCount: topology.vertexCount,
  };
}

interface FaceSignature {
  readonly surface: FaceInfo['surface'];
  readonly plane?: { readonly normal: Vec3; readonly offset: number };
}

/** The type of the surface and, for a plane, its normal and signed distance from the origin. */
function faceSignature(face: FaceInfo): FaceSignature {
  if (face.plane === undefined) return { surface: face.surface };
  const { origin, normal } = face.plane;
  const offset = normal[0] * origin[0] + normal[1] * origin[1] + normal[2] * origin[2];
  return { surface: face.surface, plane: { normal, offset } };
}

function describeSketch(sketch: SketchArtifact) {
  return {
    id: sketch.id,
    owner: sketch.owner,
    regions: [...sketch.regions.keys()].sort(compareStrings),
    // By name; the start of a loop and the order of the holes the port does not define (spec 13).
    outlines: [...sketch.outlines]
      .sort((a, b) => compareStrings(a.name, b.name))
      .map((outline) => normalizeOutline(outline)),
  };
}

/** By the names element by element (string comparison), a shorter prefix first. */
function compareNames(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareStrings(a[i] ?? '', b[i] ?? '');
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

/** Faces with the same names: by the surface type, then the normal, then the offset. */
function compareFaces(a: FaceSignature, b: FaceSignature): number {
  const bySurface = compareStrings(a.surface, b.surface);
  if (bySurface !== 0) return bySurface;
  if (a.plane === undefined || b.plane === undefined) {
    return (a.plane === undefined ? 0 : 1) - (b.plane === undefined ? 0 : 1);
  }
  return (
    compareVectors(a.plane.normal, b.plane.normal) ||
    sortKey(a.plane.offset) - sortKey(b.plane.offset)
  );
}

/** By the components rounded for sorting (spec 13): noise under `length` keeps the order. */
function compareVectors(a: Vec3, b: Vec3): number {
  return (
    sortKey(a[0]) - sortKey(b[0]) || sortKey(a[1]) - sortKey(b[1]) || sortKey(a[2]) - sortKey(b[2])
  );
}

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return compareStrings(a.id, b.id);
}

/** The input { document, inputOf? } of regen; a malformed one is a broken case. */
function regenInput(input: unknown): RegenInput {
  if (typeof input !== 'object' || input === null) throw new Error('input must be an object');
  const { document, inputOf } = input as Partial<Record<string, unknown>>; // fields checked below
  if (inputOf !== undefined && typeof inputOf !== 'string') {
    throw new Error('input.inputOf must be a feature id');
  }
  // A feature id of a case is trusted like the ids of a stored document; fromData checks the rest.
  return inputOf === undefined ? { document } : { document, inputOf: inputOf as FeatureId };
}
