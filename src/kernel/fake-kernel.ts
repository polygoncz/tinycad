import { mat4, plane, type Mat4, type Plane, type Vec2, type Vec3 } from '@/core';
import { createKernelError } from './errors';
import type { KernelErrorCode } from './errors';
import type { Axis, BooleanOp, GeometryKernel } from './kernel';
import { parseFaceInput, type ProfileCurve, type ProfileLoop } from './profile';
import { isRigidMotion } from './transform';
import type {
  BoundingBox,
  EdgeInfo,
  FaceInfo,
  HistoryLink,
  MeshData,
  MeshQuality,
  ShapeHandle,
  ShapeHistory,
  ShapeResult,
  SubShapeIndex,
  TopologySummary,
} from './types';

// In-memory GeometryKernel for tests of higher layers (spec 06, "FakeKernel"). A shape is its
// axis-aligned bounding box (AABB): a cylinder, a moved shape, a boolean result, a face and a
// swept solid are stored as their AABB and tessellated as a box (a face as a box of zero
// thickness). Its topology is that box too (M14): 6 faces, 12 edges, 8 vertices in the order
// of the mesh. Reached only through kernel/testing.ts, so it never gets into production.

export type KernelOp = keyof GeometryKernel;

export interface FakeKernel extends GeometryKernel {
  /** The next call of `op` rejects with `code` (no side effects). Several calls queue up. */
  failNext(op: KernelOp, code: KernelErrorCode, message?: string): void;
  /** Number of calls of `op` (failed ones included), or of all methods. */
  callCount(op?: KernelOp): number;
}

/** `read` of a method whose inputs are primitives: nothing to copy. */
const noInput = (): undefined => undefined;

/** Spec 06: a cylinder axis, an extrude direction and a revolve axis must be longer than this. */
const MIN_AXIS_LENGTH = 1e-9;

/** Spec 06: revolve takes 0 < angle ≤ 2π + this. */
const ANGLE_TOLERANCE = 1e-9;

/** The topology of every stored shape is its AABB as a box (spec 06, M14). */
const BOX_EDGES = 12;
const BOX_VERTICES = 8;

const BOOLEAN_OPS: readonly BooleanOp[] = ['union', 'subtract', 'intersect'];

export function createFakeKernel(): FakeKernel {
  return new FakeKernelImpl();
}

/** The fake's ShapeEntry: the shape as its axis-aligned bounding box (AABB). */
interface AabbEntry {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * A stored shape: its AABB and whether it is a face (spec 06, M13) – a makeFace result or its
 * transform – which extrude and revolve require of the profile.
 */
interface StoredShape extends AabbEntry {
  readonly face: boolean;
}

interface InjectedFailure {
  readonly code: KernelErrorCode;
  readonly message: string;
}

class FakeKernelImpl implements FakeKernel {
  private readonly shapes = new Map<ShapeHandle, StoredShape>();
  /** Increasing counter: a handle is never reused within one instance. */
  private lastHandle = 0;
  private readonly failures = new Map<KernelOp, InjectedFailure[]>();
  private readonly calls = new Map<KernelOp, number>();

  failNext(op: KernelOp, code: KernelErrorCode, message = `Injected failure of ${op}`): void {
    this.failures.set(op, [...(this.failures.get(op) ?? []), { code, message }]);
  }

  callCount(op?: KernelOp): number {
    if (op !== undefined) return this.calls.get(op) ?? 0;
    return [...this.calls.values()].reduce((sum, n) => sum + n, 0);
  }

  makeBox(p: { readonly origin: Vec3; readonly size: Vec3 }): Promise<ShapeResult> {
    // Spec 06, isolation: inputs are read synchronously at the call, as postMessage would clone them.
    const read = (): { origin: Vec3; size: Vec3 } => ({
      origin: [p.origin[0], p.origin[1], p.origin[2]],
      size: [p.size[0], p.size[1], p.size[2]],
    });
    return this.call('makeBox', read, ({ origin, size }) => {
      if (!origin.every(Number.isFinite)) {
        throw createKernelError('invalid-input', 'makeBox: origin must be finite');
      }
      if (!size.every((s) => Number.isFinite(s) && s > 0)) {
        throw createKernelError('invalid-input', 'makeBox: size must be finite and > 0');
      }
      return this.add(
        {
          min: [origin[0], origin[1], origin[2]],
          max: [origin[0] + size[0], origin[1] + size[1], origin[2] + size[2]],
        },
        false,
        { roles: BOX_ROLES },
      );
    });
  }

  makeCylinder(p: {
    readonly base: Vec3;
    readonly axis: Vec3;
    readonly radius: number;
    readonly height: number;
  }): Promise<ShapeResult> {
    const read = (): { base: Vec3; axis: Vec3; radius: number; height: number } => ({
      base: [p.base[0], p.base[1], p.base[2]],
      axis: [p.axis[0], p.axis[1], p.axis[2]],
      radius: p.radius,
      height: p.height,
    });
    return this.call('makeCylinder', read, ({ base, axis, radius, height }) => {
      if (!base.every(Number.isFinite) || !axis.every(Number.isFinite)) {
        throw createKernelError('invalid-input', 'makeCylinder: base and axis must be finite');
      }
      const length = Math.hypot(axis[0], axis[1], axis[2]);
      if (!(length > MIN_AXIS_LENGTH)) {
        throw createKernelError('invalid-input', 'makeCylinder: axis must not be zero');
      }
      if (!positive(radius) || !positive(height)) {
        throw createKernelError(
          'invalid-input',
          'makeCylinder: radius and height must be finite and > 0',
        );
      }
      // The AABB of the two base discs: in axis k a disc of radius r with unit normal a reaches
      // r·sqrt(1 − a_k²) from its centre.
      const unit = axis.map((c) => c / length);
      const min: number[] = [];
      const max: number[] = [];
      for (let k = 0; k < 3; k++) {
        const a = unit[k] ?? Number.NaN;
        const reach = radius * Math.sqrt(Math.max(0, 1 - a * a));
        const bottom = base[k] ?? Number.NaN;
        const top = bottom + height * a;
        min.push(Math.min(bottom, top) - reach);
        max.push(Math.max(bottom, top) + reach);
      }
      return this.add({ min: toVec3(min), max: toVec3(max) }, false, {
        roles: cylinderRoles(unit),
      });
    });
  }

  transform(shape: ShapeHandle, m: Mat4): Promise<ShapeResult> {
    // A spread of the tuple keeps its type: a copy of all 16 elements.
    return this.call(
      'transform',
      (): Mat4 => [...m],
      (matrix) => {
        if (!isRigidMotion(matrix)) {
          throw createKernelError('invalid-input', 'transform: m must be a rigid motion');
        }
        const entry = this.entry(shape);
        const corners = cornersOf(entry).map((c) => mat4.transformPoint(matrix, c));
        // A moved face is still a face (spec 06, M13).
        return this.add(enclosing(corners), entry.face, { history: identityHistory() });
      },
    );
  }

  boolean(
    op: BooleanOp,
    targets: readonly ShapeHandle[],
    tools: readonly ShapeHandle[],
  ): Promise<ShapeResult> {
    const read = (): { targets: ShapeHandle[]; tools: ShapeHandle[] } => ({
      targets: [...targets],
      tools: [...tools],
    });
    return this.call('boolean', read, (lists) => {
      if (!BOOLEAN_OPS.includes(op)) {
        throw createKernelError('invalid-input', `boolean: unknown op ${op}`);
      }
      if (lists.targets.length === 0 || lists.tools.length === 0) {
        throw createKernelError('invalid-input', 'boolean: targets and tools must not be empty');
      }
      const all = [...lists.targets, ...lists.tools];
      if (new Set(all).size !== all.length) {
        throw createKernelError('invalid-input', 'boolean: the same handle more than once');
      }
      const targetBox = enclosing(lists.targets.flatMap((h) => extremes(this.entry(h))));
      const toolBox = enclosing(lists.tools.flatMap((h) => extremes(this.entry(h))));
      // Spec 06, FakeKernel (M14): the first input is the identity, every other one is deleted.
      const history = booleanHistory(all.length);
      switch (op) {
        case 'union':
          return this.add(enclosing([...extremes(targetBox), ...extremes(toolBox)]), false, {
            history,
          });
        case 'subtract':
          // The fake cuts nothing away: the result is the box of the targets.
          return this.add(targetBox, false, { history });
        case 'intersect': {
          const common = overlap(targetBox, toolBox);
          if (common === undefined) {
            throw createKernelError('operation-failed', 'boolean: the intersection is empty');
          }
          return this.add(common, false, { history });
        }
      }
    });
  }

  makeFace(p: {
    readonly plane: Plane;
    readonly outer: ProfileLoop;
    readonly holes: readonly ProfileLoop[];
  }): Promise<ShapeResult> {
    // parseFaceInput reads the input synchronously into a fresh copy and never throws.
    return this.call(
      'makeFace',
      () => parseFaceInput(p),
      (parsed) => {
        if (!parsed.ok) {
          throw createKernelError('invalid-input', `makeFace: ${parsed.error.join('; ')}`);
        }
        const { plane: frame, outer } = parsed.value;
        const local = outer.flatMap(extremePoints);
        return this.add(enclosing(local.map((v) => plane.toWorld(frame, v))), true);
      },
    );
  }

  extrude(profile: ShapeHandle, direction: Vec3, distance: number): Promise<ShapeResult> {
    const read = (): { direction: Vec3; distance: number } => ({
      direction: [direction[0], direction[1], direction[2]],
      distance,
    });
    return this.call('extrude', read, (input) => {
      if (!input.direction.every(Number.isFinite)) {
        throw createKernelError('invalid-input', 'extrude: direction must be finite');
      }
      const length = Math.hypot(...input.direction);
      if (!(length > MIN_AXIS_LENGTH)) {
        throw createKernelError('invalid-input', 'extrude: direction must not be zero');
      }
      if (!positive(input.distance)) {
        throw createKernelError('invalid-input', 'extrude: distance must be finite and > 0');
      }
      const entry = this.face(profile, 'extrude');
      const shift = input.direction.map((c) => (c / length) * input.distance);
      const moved = (p: Vec3): Vec3 => toVec3(p.map((c, k) => c + (shift[k] ?? Number.NaN)));
      return this.add(enclosing([...extremes(entry), ...extremes(entry).map(moved)]), false, {
        roles: sweepRoles(input.direction, 'face:start', 'face:end'),
        history: profileHistory(),
      });
    });
  }

  revolve(profile: ShapeHandle, axis: Axis, angle: number): Promise<ShapeResult> {
    const read = (): { origin: Vec3; direction: Vec3; angle: number } => ({
      origin: [axis.origin[0], axis.origin[1], axis.origin[2]],
      direction: [axis.direction[0], axis.direction[1], axis.direction[2]],
      angle,
    });
    return this.call('revolve', read, (input) => {
      if (!input.origin.every(Number.isFinite) || !input.direction.every(Number.isFinite)) {
        throw createKernelError('invalid-input', 'revolve: the axis must be finite');
      }
      if (!(Math.hypot(...input.direction) > MIN_AXIS_LENGTH)) {
        throw createKernelError('invalid-input', 'revolve: the axis direction must not be zero');
      }
      if (!(positive(input.angle) && input.angle <= 2 * Math.PI + ANGLE_TOLERANCE)) {
        throw createKernelError('invalid-input', 'revolve: angle must be in (0, 2π]');
      }
      const entry = this.face(profile, 'revolve');
      // Spec 06, FakeKernel: the corners turned by 0, the angle and every k·π/2 in between –
      // exact for the cases of the contract suite, approximate elsewhere.
      const quarter = Math.PI / 2;
      const steps = Array.from({ length: Math.ceil(input.angle / quarter) }, (_, k) => k * quarter);
      const turned = [...steps, input.angle].flatMap((a) => {
        const m = rotationAbout(input.origin, input.direction, a);
        return cornersOf(entry).map((c) => mat4.transformPoint(m, c));
      });
      return this.add(enclosing(turned), false, { history: profileHistory() });
    });
  }

  fillet(shape: ShapeHandle, edges: readonly number[], radius: number): Promise<ShapeResult> {
    return this.dressup('fillet', shape, edges, radius);
  }

  chamfer(shape: ShapeHandle, edges: readonly number[], distance: number): Promise<ShapeResult> {
    return this.dressup('chamfer', shape, edges, distance);
  }

  exportStep(shapes: readonly ShapeHandle[]): Promise<Uint8Array<ArrayBuffer>> {
    return this.call(
      'exportStep',
      () => [...shapes],
      (list) => {
        if (list.length === 0) {
          throw createKernelError('invalid-input', 'exportStep: shapes must not be empty');
        }
        if (new Set(list).size !== list.length) {
          throw createKernelError('invalid-input', 'exportStep: the same handle more than once');
        }
        return asciiBytes(fakeStep(list.map((h) => this.entry(h))));
      },
    );
  }

  tessellate(shape: ShapeHandle, q: MeshQuality): Promise<MeshData> {
    const read = (): MeshQuality => ({
      linearDeflection: q.linearDeflection,
      angularDeflection: q.angularDeflection,
    });
    return this.call('tessellate', read, ({ linearDeflection, angularDeflection }) => {
      const valid = (d: number): boolean => Number.isFinite(d) && d > 0;
      if (!valid(linearDeflection) || !valid(angularDeflection)) {
        throw createKernelError('invalid-input', 'tessellate: deflections must be finite and > 0');
      }
      return boxMesh(this.entry(shape));
    });
  }

  boundingBox(shape: ShapeHandle): Promise<BoundingBox> {
    return this.call('boundingBox', noInput, () => {
      const { min, max } = this.entry(shape);
      return { min: [...min], max: [...max] };
    });
  }

  topology(shape: ShapeHandle): Promise<TopologySummary> {
    return this.call('topology', noInput, () => boxTopology(this.entry(shape)));
  }

  release(handles: readonly ShapeHandle[]): Promise<void> {
    return this.call(
      'release',
      () => [...handles],
      (snapshot) => {
        // Check everything first: release is atomic.
        if (new Set(snapshot).size !== snapshot.length) {
          throw createKernelError('invalid-input', 'release: the same handle more than once');
        }
        for (const h of snapshot) this.entry(h);
        for (const h of snapshot) this.shapes.delete(h);
      },
    );
  }

  liveHandleCount(): Promise<number> {
    return this.call('liveHandleCount', noInput, () => this.shapes.size);
  }

  /**
   * Counts the call, calls `read` synchronously – the copy of the inputs (isolation, spec 06) –
   * then runs `body` on the copy in a microtask: results never come synchronously and a
   * failure – injected, thrown by `read` on input outside the types ('internal') or thrown by
   * `body` – is always a rejection. An injected failure skips `read` and `body`, so it has no
   * side effects and wins over any other error of the call.
   */
  private call<I, T>(op: KernelOp, read: () => I, body: (input: I) => T): Promise<T> {
    this.calls.set(op, (this.calls.get(op) ?? 0) + 1);
    const [failure, ...rest] = this.failures.get(op) ?? [];
    if (failure !== undefined) {
      this.failures.set(op, rest);
      return Promise.reject(createKernelError(failure.code, failure.message));
    }
    let input: I;
    try {
      input = read();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return Promise.reject(createKernelError('internal', `${op}: cannot read input: ${reason}`));
    }
    return Promise.resolve().then(() => body(input));
  }

  /**
   * Fillet or chamfer (spec 06, M14): the input checked as by OCCT (12 edges of the box), the
   * AABB unchanged under a new handle, the history the identity of the 6 faces.
   */
  private dressup(
    op: 'fillet' | 'chamfer',
    shape: ShapeHandle,
    edges: readonly number[],
    size: number,
  ): Promise<ShapeResult> {
    const read = (): { edges: number[]; size: number } => ({ edges: [...edges], size });
    return this.call(op, read, (input) => {
      if (!positive(input.size)) {
        throw createKernelError('invalid-input', `${op}: the size must be finite and > 0`);
      }
      const entry = this.entry(shape);
      const problem = edgeListProblem(input.edges, BOX_EDGES);
      if (problem !== undefined) throw createKernelError('invalid-input', `${op}: ${problem}`);
      return this.add({ min: entry.min, max: entry.max }, false, { history: identityHistory() });
    });
  }

  /** Stores the AABB under a new handle; `face` marks a face (spec 06, M13). */
  private add(
    { min, max }: AabbEntry,
    face = false,
    described: Omit<ShapeResult, 'shape'> = {},
  ): ShapeResult {
    const shape = this.nextHandle();
    this.shapes.set(shape, { min, max, face });
    return { shape, ...described };
  }

  private nextHandle(): ShapeHandle {
    this.lastHandle++;
    // The only place a number becomes a ShapeHandle.
    return this.lastHandle as ShapeHandle;
  }

  /** The entry of a profile for `op`: it must be a face, else 'invalid-input'. */
  private face(profile: ShapeHandle, op: KernelOp): StoredShape {
    const entry = this.entry(profile);
    if (!entry.face) {
      throw createKernelError('invalid-input', `${op}: the profile is not a face`);
    }
    return entry;
  }

  private entry(shape: ShapeHandle): StoredShape {
    const entry = this.shapes.get(shape);
    if (entry === undefined) {
      throw createKernelError('unknown-handle', `Unknown shape handle ${String(shape)}`);
    }
    return entry;
  }
}

function positive(x: number): boolean {
  return Number.isFinite(x) && x > 0;
}

/**
 * Spec 06 (M14): what is wrong with the edge list of fillet/chamfer – empty, an index that is
 * not an integer in [0, count), a duplicate – or undefined when it is valid.
 */
function edgeListProblem(edges: readonly number[], count: number): string | undefined {
  if (edges.length === 0) return 'edges must not be empty';
  const bad = edges.find((e) => !(Number.isInteger(e) && e >= 0 && e < count));
  if (bad !== undefined) {
    return `edge ${String(bad)} is not an integer in [0, ${String(count)})`;
  }
  if (new Set(edges).size !== edges.length) return 'the same edge more than once';
  return undefined;
}

// Topology, roles and history of the fake (spec 06, FakeKernel, M14). A face of the box has the
// index 2·axis + (1 on the max side), as in the mesh; a corner has the bits x = 1, y = 2, z = 4.

const faceIndex = (axis: number, high: boolean): number => 2 * axis + (high ? 1 : 0);
const face = (index: number): SubShapeIndex => ({ type: 'face', index });

/** Spec 06: left 0, right 1, front 2, back 3, bottom 4, top 5. */
const BOX_ROLES: Readonly<Record<string, readonly SubShapeIndex[]>> = {
  'face:left': [face(0)],
  'face:right': [face(1)],
  'face:front': [face(2)],
  'face:back': [face(3)],
  'face:bottom': [face(4)],
  'face:top': [face(5)],
};

/** The axis of the largest |component| of v and whether that component is positive. */
function dominantAxis(v: readonly number[]): { axis: number; positive: boolean } {
  let axis = 0;
  for (let k = 1; k < 3; k++) {
    if (Math.abs(v[k] ?? 0) > Math.abs(v[axis] ?? 0)) axis = k;
  }
  return { axis, positive: (v[axis] ?? 0) > 0 };
}

/** The faces against and along the dominant component of `direction`: [back, front]. */
function sweepEnds(direction: readonly number[]): readonly [number, number] {
  const { axis, positive: along } = dominantAxis(direction);
  return [faceIndex(axis, !along), faceIndex(axis, along)];
}

/** Spec 06: start/end = the wall against/along the dominant component of d̂. */
function sweepRoles(
  direction: readonly number[],
  start: string,
  end: string,
): Readonly<Record<string, readonly SubShapeIndex[]>> {
  const [back, front] = sweepEnds(direction);
  return { [start]: [face(back)], [end]: [face(front)] };
}

/** Spec 06: bottom/top = the wall against/along the dominant axis component, side = the rest. */
function cylinderRoles(
  axis: readonly number[],
): Readonly<Record<string, readonly SubShapeIndex[]>> {
  const [bottom, top] = sweepEnds(axis);
  const side = [0, 1, 2, 3, 4, 5].filter((f) => f !== bottom && f !== top);
  return { 'face:bottom': [face(bottom)], 'face:top': [face(top)], 'face:side': side.map(face) };
}

const ALL_FACES = [0, 1, 2, 3, 4, 5];

/** Face i of input 0 → face i of the output, for all 6 faces. */
function identityLinks(input: number): HistoryLink[] {
  return ALL_FACES.map((i) => ({ input, from: face(i), to: [face(i)] }));
}

function deletedFaces(input: number): ShapeHistory['deleted'] {
  return ALL_FACES.map((i) => ({ input, sub: face(i) }));
}

/** transform, fillet, chamfer: the identity of the 6 faces. */
function identityHistory(): ShapeHistory {
  return { modified: identityLinks(0), generated: [], deleted: [] };
}

/** boolean: the first input is the identity, the others are deleted. */
function booleanHistory(inputs: number): ShapeHistory {
  const others = Array.from({ length: inputs - 1 }, (_, k) => k + 1);
  return { modified: identityLinks(0), generated: [], deleted: others.flatMap(deletedFaces) };
}

/** extrude, revolve: the profile is deleted. */
function profileHistory(): ShapeHistory {
  return { modified: [], generated: [], deleted: deletedFaces(0) };
}

/**
 * The AABB as a box: faces −X, +X, −Y, +Y, −Z, +Z (plane through the centre of the wall,
 * normal outwards), edges in the order of the mesh with their faces and corner vertices.
 */
function boxTopology({ min, max }: AabbEntry): TopologySummary {
  const at = (k: number, high: boolean): number => (high ? max[k] : min[k]) ?? Number.NaN;
  const centre = (k: number): number => (at(k, false) + at(k, true)) / 2;
  const faces: FaceInfo[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const high of [false, true]) {
      const origin = toVec3([0, 1, 2].map((k) => (k === axis ? at(k, high) : centre(k))));
      const normal = toVec3([0, 1, 2].map((k) => (k === axis ? (high ? 1 : -1) : 0)));
      faces.push({ surface: 'plane', plane: { origin, normal } });
    }
  }
  const edges: EdgeInfo[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const [uHigh, vHigh] of [
      [false, false],
      [true, false],
      [true, true],
      [false, true],
    ] as const) {
      const corner = (axisHigh: boolean): number =>
        (axisHigh ? 1 << axis : 0) + (uHigh ? 1 << u : 0) + (vHigh ? 1 << v : 0);
      const midpoint = toVec3(
        [0, 1, 2].map((k) => (k === axis ? centre(k) : at(k, k === u ? uHigh : vHigh))),
      );
      edges.push({
        faces: [faceIndex(u, uHigh), faceIndex(v, vHigh)].sort((a, b) => a - b),
        vertices: [corner(false), corner(true)].sort((a, b) => a - b),
        midpoint,
      });
    }
  }
  return { faces, edges, vertexCount: BOX_VERTICES };
}

/**
 * The pseudo-STEP of the fake (spec 06, FakeKernel, M15): the frame of a STEP file with one
 * line `#<i>=FAKE_SOLID((min),(max));` per shape, so tests of higher layers see what was
 * exported. Deterministic: no time in the header.
 */
function fakeStep(entries: readonly AabbEntry[]): string {
  const point = (v: Vec3): string => `(${v.map(String).join(',')})`;
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('tinycad FakeKernel'),'2;1');",
    "FILE_NAME('fake.step','',(''),(''),'','','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    ...entries.map((e, i) => `#${String(i + 1)}=FAKE_SOLID(${point(e.min)},${point(e.max)});`),
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

/**
 * The bytes of an ASCII text in a new buffer. The same bytes as TextEncoder gives for ASCII;
 * the domain build (no DOM, no Node types) has no type for TextEncoder.
 */
function asciiBytes(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function toVec3(v: readonly number[]): Vec3 {
  return [v[0] ?? Number.NaN, v[1] ?? Number.NaN, v[2] ?? Number.NaN];
}

/** Local angles 0, π/2, π, 3π/2: where a circle reaches its extremes along the plane axes. */
const CARDINAL_ANGLES = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

/**
 * Points of the curve whose AABB is the AABB of the curve in plane coordinates (spec 06,
 * FakeKernel): the end points, and for arcs and circles the cardinal points lying on them.
 */
function extremePoints(c: ProfileCurve): Vec2[] {
  const at = (center: Vec2, r: number, angle: number): Vec2 => [
    center[0] + r * Math.cos(angle),
    center[1] + r * Math.sin(angle),
  ];
  switch (c.kind) {
    case 'line':
      return [c.from, c.to];
    case 'circle':
      return CARDINAL_ANGLES.map((a) => at(c.center, c.radius, a));
    case 'arc': {
      const r = Math.hypot(c.from[0] - c.center[0], c.from[1] - c.center[1]);
      const angleOf = (v: Vec2): number => Math.atan2(v[1] - c.center[1], v[0] - c.center[0]);
      // Walk counter-clockwise from `start` to `end`; a clockwise arc is the same set reversed.
      const [start, end] = c.ccw
        ? [angleOf(c.from), angleOf(c.to)]
        : [angleOf(c.to), angleOf(c.from)];
      const sweep = normalizeAngle(end - start);
      const inside = CARDINAL_ANGLES.filter((a) => normalizeAngle(a - start) <= sweep);
      return [c.from, c.to, ...inside.map((a) => at(c.center, r, a))];
    }
  }
}

/** The angle in [0, 2π). */
function normalizeAngle(a: number): number {
  const turn = 2 * Math.PI;
  return ((a % turn) + turn) % turn;
}

/** The 8 corners of the box. */
function cornersOf({ min, max }: AabbEntry): Vec3[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [
    i & 1 ? max[0] : min[0],
    i & 2 ? max[1] : min[1],
    i & 4 ? max[2] : min[2],
  ]);
}

/** Rotation by `angle` about the axis through `origin` along `direction`. */
function rotationAbout(origin: Vec3, direction: Vec3, angle: number): Mat4 {
  const back: Vec3 = [-origin[0], -origin[1], -origin[2]];
  return mat4.multiply(
    mat4.translation(origin),
    mat4.multiply(mat4.rotationAxisAngle(direction, angle), mat4.translation(back)),
  );
}

/** The two extreme corners of the box: enough for `enclosing`. */
function extremes({ min, max }: AabbEntry): Vec3[] {
  return [min, max];
}

/** The AABB of the points. */
function enclosing(points: readonly Vec3[]): AabbEntry {
  const axes = [0, 1, 2];
  return {
    min: toVec3(axes.map((k) => Math.min(...points.map((p) => p[k] ?? Number.NaN)))),
    max: toVec3(axes.map((k) => Math.max(...points.map((p) => p[k] ?? Number.NaN)))),
  };
}

/** The common part of two boxes; undefined when it is empty or of zero thickness in any axis. */
function overlap(a: AabbEntry, b: AabbEntry): AabbEntry | undefined {
  const axes = [0, 1, 2];
  const min = toVec3(axes.map((k) => Math.max(a.min[k] ?? Number.NaN, b.min[k] ?? Number.NaN)));
  const max = toVec3(axes.map((k) => Math.min(a.max[k] ?? Number.NaN, b.max[k] ?? Number.NaN)));
  return axes.every((k) => (max[k] ?? Number.NaN) > (min[k] ?? Number.NaN))
    ? { min, max }
    : undefined;
}

/**
 * The box as 6 faces of 2 triangles (24 vertices, flat normals) in order −X, +X, −Y, +Y, −Z, +Z,
 * and 12 edges of 2 points. Fresh buffers on every call.
 */
function boxMesh({ min, max }: AabbEntry): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceRanges: number[] = [];
  const corner = (k: number, high: boolean): number => (high ? max[k] : min[k]) ?? Number.NaN;

  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1] as const) {
      const face = faceRanges.length / 3;
      // (u, v, axis) is right-handed, so corners in order (u0,v0) (u1,v0) (u1,v1) (u0,v1) run
      // counter-clockwise seen from +axis; seen from −axis the order is reversed.
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      const square: readonly (readonly [boolean, boolean])[] = [
        [false, false],
        [true, false],
        [true, true],
        [false, true],
      ];
      const ordered = sign > 0 ? square : [...square].reverse();
      const first = positions.length / 3;
      for (const [uHigh, vHigh] of ordered) {
        const p = [0, 0, 0];
        const n = [0, 0, 0];
        p[axis] = corner(axis, sign > 0);
        p[u] = corner(u, uHigh);
        p[v] = corner(v, vHigh);
        n[axis] = sign;
        positions.push(...p);
        normals.push(...n);
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
      faceRanges.push(face, 2 * face, 2);
    }
  }

  const edgePositions: number[] = [];
  const edgeRanges: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const [uHigh, vHigh] of [
      [false, false],
      [true, false],
      [true, true],
      [false, true],
    ] as const) {
      const edge = edgeRanges.length / 3;
      for (const high of [false, true]) {
        const p = [0, 0, 0];
        p[axis] = corner(axis, high);
        p[u] = corner(u, uHigh);
        p[v] = corner(v, vHigh);
        edgePositions.push(...p);
      }
      edgeRanges.push(edge, 2 * edge, 2);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array(faceRanges),
    edgePositions: new Float32Array(edgePositions),
    edgeRanges: new Uint32Array(edgeRanges),
  };
}
