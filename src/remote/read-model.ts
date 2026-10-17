// The read model of the core (read_model.proto, spec 14 "Read model a sítě", Q099) → plain frozen
// data of the domain: the document as PartStudioData, the result of the regeneration of the
// server (server/src/regen) with the statuses of its features, bodies with their meshes, sketches,
// planes and axes, and the state of the session. app hands these values to the ports of interaction, render
// and the sketcher unchanged; the domain never sees a protobuf message (Q106).

import { toJson } from '@bufbuild/protobuf';
import type { JsonValue } from '@bufbuild/protobuf';
import { ListValueSchema, timestampMs } from '@bufbuild/protobuf/wkt';
import type { Plane, Vec3 } from '@/core';
import type {
  AxisId,
  BodyId,
  BodyMeta,
  DocumentId,
  FeatureId,
  FeatureInstance,
  ParamIssue,
  PartStudioData,
  PlaneId,
  SketchId,
} from '@/document';
import { validateMeshData } from '@/kernel';
import type { MeshData, ProfileLoop, ProfileRegion } from '@/kernel';
import { FeatureError_Code, LogEntryView_Kind } from '@/protocol';
import type {
  AxisView,
  BodyMeta as ProtoBodyMeta,
  BodyView,
  FeatureAnchors as ProtoFeatureAnchors,
  FeatureStatus as ProtoFeatureStatus,
  GetHistoryResponse,
  LogEntryView,
  Mesh,
  Plane as ProtoPlane,
  PlaneView,
  ReadModel,
  RegionView,
  SketchView,
  StateView,
  Vec3 as ProtoVec3,
} from '@/protocol';
import { curveFromProto } from './curves';
import { decoding, issueFromProto } from './errors';
import { bodyId, featureFromProto, featureId, materialFromProto } from './operations';

/** The error of a feature (FeatureError of read_model.proto, regen::FeatureError of the server). */
export interface FeatureErrorData {
  readonly code:
    'INVALID_PARAMS' | 'UNRESOLVED_REFERENCE' | 'KERNEL' | 'UNKNOWN_TYPE' | 'STALE_VERSION';
  /** Technical text. */
  readonly message: string;
  /** Only when there are some. */
  readonly issues?: readonly ParamIssue[];
}

/** The status of a feature after the regeneration of the server (FeatureStatus of read_model.proto). */
export type FeatureStatusData =
  | { readonly kind: 'ok' }
  | { readonly kind: 'warning'; readonly message: string }
  | { readonly kind: 'error'; readonly error: FeatureErrorData }
  | { readonly kind: 'suppressed' }
  | { readonly kind: 'rolledBack' };

/** An anchor of a manipulator (ADR 0021), in the shape of the anchors of interaction. */
export interface AnchorData {
  readonly point: Vec3;
  /** Unit length; absent = a point only. */
  readonly direction?: Vec3;
}

/** The anchors of one feature by name. */
export type FeatureAnchors = Readonly<Record<string, AnchorData>>;

/** A body of a state; the mesh only when the request did not list contentVersion. */
export interface BodyData {
  readonly id: BodyId;
  readonly origin: FeatureId;
  readonly lastModifiedBy: FeatureId;
  /** Changes with the shape (Q100); the key of the mesh cache. */
  readonly contentVersion: string;
  /** faceNames[i] is the primary name of the face with index i (0-based, N91); '' = no name. */
  readonly faceNames: readonly string[];
  readonly edgeNames: readonly string[];
  /** Index of a planar face (as faceNames) → its plane (N56); non-planar faces are absent. */
  readonly facePlanes: ReadonlyMap<number, Plane>;
  readonly mesh: MeshData | null;
}

/** A solved sketch of a state. */
export interface SketchViewData {
  readonly sketchId: SketchId;
  readonly featureId: FeatureId;
  readonly plane: Plane;
  /** The solved entities as the JSON of spec 12, the derived ones included; unchecked. */
  readonly entities: readonly unknown[];
  /** The regions in the order of the artifact. */
  readonly regions: readonly ProfileRegion[];
}

/** A plane of a state (regen PlaneArtifact without `kind`). */
export interface PlaneData {
  readonly id: PlaneId;
  readonly owner: FeatureId;
  readonly plane: Plane;
}

/** An axis of a state (regen AxisArtifact without `kind`). */
export interface AxisData {
  readonly id: AxisId;
  readonly owner: FeatureId;
  readonly origin: Vec3;
  /** Unit length. */
  readonly direction: Vec3;
}

/** A state of the regeneration, in the order of the state. */
export interface StateData {
  readonly bodies: readonly BodyData[];
  readonly sketches: readonly SketchViewData[];
  readonly planes: readonly PlaneData[];
  readonly axes: readonly AxisData[];
}

/** The decoded read model: plain frozen data (maps are ReadonlyMap). */
export interface ReadModelData {
  readonly document: {
    readonly id: DocumentId;
    readonly name: string;
    /** ms since epoch, when the document was created (DocumentView.created_at_ms, N89). */
    readonly createdAt: number;
    /** seq of the last log entry; 0 for an empty log. */
    readonly lastSeq: number;
    /** Features, rollback index and body metadata in the canonical form of spec 03. */
    readonly studio: PartStudioData;
  };
  readonly regen: {
    /** The counter of changes of the document runtime (N55). */
    readonly generation: number;
    readonly statuses: ReadonlyMap<FeatureId, FeatureStatusData>;
    readonly final: StateData;
    /** The input of the feature of ReadModelOptions.input_of; null without it. */
    readonly input: { readonly featureId: FeatureId; readonly state: StateData } | null;
    readonly anchors: ReadonlyMap<FeatureId, FeatureAnchors>;
    readonly durationMs: number;
  };
  readonly session: {
    readonly writable: boolean;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /** The label of the open transaction of the document; null without one. */
    readonly transactionLabel: string | null;
  };
}

/** A log entry for the client (LogEntryView): without the operations, with their type. */
export interface LogEntryData {
  readonly seq: number;
  readonly kind: 'do' | 'undo' | 'redo';
  /** For undo and redo the seq of the original 'do' entry. */
  readonly target?: number;
  readonly label: string;
  /** ms since epoch. */
  readonly time: number;
  /** The type of the operation ('feature.setParams', 'batch'). */
  readonly opType: string;
}

/** The log from some seq on and the undo stacks (GetHistory). */
export interface HistoryData {
  readonly entries: readonly LogEntryData[];
  /** seq of the original 'do' entries, the top at the end. */
  readonly stacks: { readonly undo: readonly number[]; readonly redo: readonly number[] };
}

/**
 * The message ReadModel → ReadModelData. Meshes are copied out of the message (a decoded `bytes`
 * may start at an offset that is not a multiple of 4, and MeshData keeps every array over its own
 * ArrayBuffer). A message a correct server never sends (a missing state or plane, a status without
 * a kind, a byte array of a wrong length) → RemoteError INTERNAL with the problem in the message.
 */
export function decodeReadModel(msg: ReadModel): ReadModelData {
  return decoding('read model', () => {
    const document = required(msg.document, 'document');
    const regen = required(msg.regen, 'regen');
    const session = required(msg.session, 'session');
    const input = regen.input;
    return Object.freeze({
      document: Object.freeze({
        id: document.documentId as DocumentId, // the id of the catalog of the server (spec 14)
        name: document.name,
        createdAt: Number(document.createdAtMs),
        lastSeq: Number(document.lastSeq),
        studio: Object.freeze({
          features: Object.freeze(document.features.map(decodeFeature)),
          rollbackIndex: document.rollbackIndex,
          ...bodiesOf(document.bodyMeta),
        }),
      }),
      regen: Object.freeze({
        generation: Number(regen.generation),
        statuses: new Map(
          Object.entries(regen.statuses).map(([id, status]) => [
            featureId(id),
            decodeStatus(status, id),
          ]),
        ),
        final: decodeState(required(regen.final, 'regen.final')),
        input:
          input === undefined
            ? null
            : Object.freeze({
                featureId: featureId(input.featureId),
                state: decodeState(required(input.state, 'regen.input.state')),
              }),
        anchors: new Map(
          Object.entries(regen.anchors).map(([id, anchors]) => [
            featureId(id),
            decodeAnchors(anchors),
          ]),
        ),
        durationMs: regen.durationMs,
      }),
      session: Object.freeze({
        writable: session.writable,
        canUndo: session.canUndo,
        canRedo: session.canRedo,
        transactionLabel: session.transaction?.label ?? null,
      }),
    });
  });
}

/**
 * The message Mesh → MeshData; every array is copied into its own ArrayBuffer. A mesh that fails
 * validateMeshData is a broken answer: render relies on its structure (index bounds, strictly
 * increasing face ranges searched binarily).
 */
export function decodeMesh(mesh: Mesh): MeshData {
  const data: MeshData = Object.freeze({
    positions: floats(mesh.positions, 'positions'),
    normals: floats(mesh.normals, 'normals'),
    indices: uints(mesh.indices, 'indices'),
    faceRanges: uints(mesh.faceRanges, 'face_ranges'),
    edgePositions: floats(mesh.edgePositions, 'edge_positions'),
    edgeRanges: uints(mesh.edgeRanges, 'edge_ranges'),
  });
  const problems = validateMeshData(data);
  if (problems.length > 0) {
    // The first few say enough; a broken mesh may have a problem per vertex.
    const shown = problems.slice(0, 3).join('; ');
    throw new BrokenAnswer(`invalid mesh (${String(problems.length)} problems): ${shown}`);
  }
  return data;
}

/** The message LogEntryView → LogEntryData; a kind UNSPECIFIED is a broken answer. */
export function decodeLogEntry(view: LogEntryView): LogEntryData {
  return decoding('log entry', () => Object.freeze(logEntryOf(view)));
}

/** The answer of GetHistory → HistoryData. */
export function decodeHistory(msg: GetHistoryResponse): HistoryData {
  return decoding('history', () =>
    Object.freeze({
      entries: Object.freeze(msg.entries.map((view) => Object.freeze(logEntryOf(view)))),
      stacks: Object.freeze({
        undo: Object.freeze(msg.undoStack.map(Number)),
        redo: Object.freeze(msg.redoStack.map(Number)),
      }),
    }),
  );
}

// ---- internal --------------------------------------------------------------------------------

/** A problem of a message a correct server never sends. */
class BrokenAnswer extends Error {}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new BrokenAnswer(`${what} is missing`);
  return value;
}

function decodeFeature(feature: Parameters<typeof featureFromProto>[0]): FeatureInstance {
  const decoded = featureFromProto(feature);
  return Object.freeze({ ...decoded, params: freezeJson(decoded.params) });
}

/** body_meta → the `bodies` of PartStudioData in canonical form (absent when empty). */
function bodiesOf(meta: Readonly<Record<string, ProtoBodyMeta>>): {
  readonly bodies?: Readonly<Record<BodyId, BodyMeta>>;
} {
  const bodies: Record<BodyId, BodyMeta> = {};
  for (const [id, m] of Object.entries(meta)) {
    const canonical = canonicalMeta(m);
    if (Object.keys(canonical).length > 0) bodies[bodyId(id)] = canonical;
  }
  return Object.keys(bodies).length === 0 ? {} : { bodies: Object.freeze(bodies) };
}

/** BodyMeta of the wire → the canonical BodyMeta of spec 03 (no default values stored). */
function canonicalMeta(m: ProtoBodyMeta): BodyMeta {
  const material = m.material === 0 ? undefined : materialFromProto(m.material);
  return Object.freeze({
    ...(m.name === '' ? {} : { name: m.name }),
    ...(m.hidden ? { hidden: true as const } : {}),
    ...(m.color === undefined ? {} : { color: m.color }),
    ...(material === undefined || material === 'plastic' ? {} : { material }),
  });
}

const ERROR_CODES: Readonly<Record<number, FeatureErrorData['code'] | undefined>> = Object.freeze({
  [FeatureError_Code.INVALID_PARAMS]: 'INVALID_PARAMS',
  [FeatureError_Code.UNRESOLVED_REFERENCE]: 'UNRESOLVED_REFERENCE',
  [FeatureError_Code.KERNEL]: 'KERNEL',
  [FeatureError_Code.UNKNOWN_TYPE]: 'UNKNOWN_TYPE',
  [FeatureError_Code.STALE_VERSION]: 'STALE_VERSION',
});

function decodeStatus(status: ProtoFeatureStatus, id: string): FeatureStatusData {
  const { kind } = status;
  switch (kind.case) {
    case 'ok':
      return OK;
    case 'warning':
      return Object.freeze({ kind: 'warning', message: kind.value.message });
    case 'error': {
      const code = ERROR_CODES[kind.value.code];
      if (code === undefined) {
        throw new BrokenAnswer(`the error of feature '${id}' has no known code`);
      }
      const issues = kind.value.issues.map(issueFromProto);
      return Object.freeze({
        kind: 'error',
        error: Object.freeze({
          code,
          message: kind.value.message,
          ...(issues.length > 0 ? { issues: Object.freeze(issues) } : {}),
        }),
      });
    }
    case 'suppressed':
      return SUPPRESSED;
    case 'rolledBack':
      return ROLLED_BACK;
    case undefined:
      throw new BrokenAnswer(`the status of feature '${id}' has no kind`);
  }
}

const OK: FeatureStatusData = Object.freeze({ kind: 'ok' });
const SUPPRESSED: FeatureStatusData = Object.freeze({ kind: 'suppressed' });
const ROLLED_BACK: FeatureStatusData = Object.freeze({ kind: 'rolledBack' });

function decodeAnchors(anchors: ProtoFeatureAnchors): FeatureAnchors {
  const out: Record<string, AnchorData> = {};
  for (const [name, anchor] of Object.entries(anchors.anchors)) {
    out[name] = Object.freeze({
      point: vec3(anchor.point, `anchor '${name}'`),
      ...(anchor.direction === undefined
        ? {}
        : { direction: vec3(anchor.direction, `direction of anchor '${name}'`) }),
    });
  }
  return Object.freeze(out);
}

function decodeState(state: StateView): StateData {
  return Object.freeze({
    bodies: Object.freeze(state.bodies.map(decodeBody)),
    sketches: Object.freeze(state.sketches.map(decodeSketch)),
    planes: Object.freeze(state.planes.map(decodePlaneView)),
    axes: Object.freeze(state.axes.map(decodeAxis)),
  });
}

function decodeBody(body: BodyView): BodyData {
  return Object.freeze({
    id: bodyId(body.bodyId),
    origin: featureId(body.origin),
    lastModifiedBy: featureId(body.lastModifiedBy),
    contentVersion: body.contentVersion,
    faceNames: Object.freeze([...body.faceNames]),
    edgeNames: Object.freeze([...body.edgeNames]),
    facePlanes: new Map(
      Object.entries(body.facePlanes).map(([index, p]) => [
        Number(index),
        plane(p, `face plane ${index} of body '${body.bodyId}'`),
      ]),
    ),
    mesh: body.mesh === undefined ? null : decodeMesh(body.mesh),
  });
}

function decodeSketch(sketch: SketchView): SketchViewData {
  const entities: JsonValue =
    sketch.entities === undefined ? [] : toJson(ListValueSchema, sketch.entities);
  if (!Array.isArray(entities)) {
    throw new BrokenAnswer(`the entities of sketch '${sketch.sketchId}' are no list`);
  }
  return Object.freeze({
    sketchId: sketch.sketchId as SketchId, // the artifact id of the core (ADR 0015)
    featureId: featureId(sketch.featureId),
    plane: plane(sketch.plane, `plane of sketch '${sketch.sketchId}'`),
    entities: Object.freeze(entities.map(freezeJson)),
    regions: Object.freeze(sketch.regions.map(decodeRegion)),
  });
}

function decodeRegion(region: RegionView): ProfileRegion {
  return Object.freeze({
    name: region.name,
    outer: loop(region.outer),
    holes: Object.freeze(region.holes.map((hole) => loop(hole.curves))),
    area: region.area,
  });
}

function loop(curves: Parameters<typeof curveFromProto>[0][]): ProfileLoop {
  return Object.freeze(curves.map((c) => Object.freeze(curveFromProto(c))));
}

function decodePlaneView(view: PlaneView): PlaneData {
  return Object.freeze({
    id: view.planeId as PlaneId, // the artifact id of the core (ADR 0015)
    owner: featureId(view.owner),
    plane: plane(view.plane, `plane '${view.planeId}'`),
  });
}

function decodeAxis(view: AxisView): AxisData {
  return Object.freeze({
    id: view.axisId as AxisId, // the artifact id of the core (ADR 0015)
    owner: featureId(view.owner),
    origin: vec3(view.origin, `origin of axis '${view.axisId}'`),
    direction: vec3(view.direction, `direction of axis '${view.axisId}'`),
  });
}

function plane(p: ProtoPlane | undefined, what: string): Plane {
  const value = required(p, what);
  return Object.freeze({
    origin: vec3(value.origin, `${what}: origin`),
    xDir: vec3(value.xDir, `${what}: x_dir`),
    normal: vec3(value.normal, `${what}: normal`),
  });
}

function vec3(v: ProtoVec3 | undefined, what: string): Vec3 {
  const value = required(v, what);
  return Object.freeze([value.x, value.y, value.z] as const);
}

const LOG_KINDS: Readonly<Record<number, LogEntryData['kind'] | undefined>> = Object.freeze({
  [LogEntryView_Kind.DO]: 'do',
  [LogEntryView_Kind.UNDO]: 'undo',
  [LogEntryView_Kind.REDO]: 'redo',
});

function logEntryOf(view: LogEntryView): LogEntryData {
  const kind = LOG_KINDS[view.kind];
  if (kind === undefined) throw new BrokenAnswer(`entry ${String(view.seq)} has no kind`);
  return {
    seq: Number(view.seq),
    kind,
    ...(view.target === 0n ? {} : { target: Number(view.target) }),
    label: view.label,
    time: view.time === undefined ? 0 : timestampMs(view.time),
    opType: view.opType,
  };
}

/**
 * A little-endian float32 array of the wire → its own Float32Array. Copied: the bytes may start
 * at an offset that is not a multiple of 4 (Q099). Browsers are little-endian, so the typed array
 * reads the wire format directly.
 */
function floats(bytes: Uint8Array, what: string): Float32Array<ArrayBuffer> {
  return new Float32Array(copyOfWords(bytes, what));
}

/** A little-endian uint32 array of the wire → its own Uint32Array (see floats). */
function uints(bytes: Uint8Array, what: string): Uint32Array<ArrayBuffer> {
  return new Uint32Array(copyOfWords(bytes, what));
}

function copyOfWords(bytes: Uint8Array, what: string): ArrayBuffer {
  if (bytes.byteLength % 4 !== 0) {
    throw new BrokenAnswer(`mesh ${what} has ${String(bytes.byteLength)} bytes, not words of 4`);
  }
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** Freezes a JSON value of the message deeply (it is ours, decoded for this read model). */
function freezeJson<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) freezeJson(item);
    Object.freeze(value);
  }
  return value;
}
