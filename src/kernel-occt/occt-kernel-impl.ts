import type {
  BRepBuilderAPI_Transform,
  NCollection_List_TopoDS_Shape,
  TopoDS_Shape,
} from 'replicad-opencascadejs';
import type { Mat4, Plane, Vec3 } from '@/core';
import {
  createKernelError,
  isRigidMotion,
  type Axis,
  type BooleanOp,
  type BoundingBox,
  type GeometryKernel,
  type MeshData,
  type MeshQuality,
  type ProfileLoop,
  type ShapeHandle,
  type ShapeResult,
  type SubShapeIndex,
  type TopologySummary,
  validateFaceInput,
} from '@/kernel';
import { dressupResult, type DressupKind } from './dressup';
import { copyFaceInput, faceResult } from './face';
import { collectHistory } from './history';
import { hasSolid, toKernelError, type Occt } from './occt';
import {
  createShapeEntry,
  deleteShapeEntry,
  indexOfSame,
  type EntryDescription,
  type ShapeEntry,
} from './shape-entry';
import { prismResult, requireFace, revolResult } from './sweep';
import { tessellateEntry } from './tessellate';
import { topologyOf } from './topology';

// GeometryKernel over the OCCT module (spec 06, "kernel-occt: adapter architecture"). Runs in
// the worker; takes the module in the constructor, so it is testable in Node without a worker.
// Internal to kernel-occt.

/** `read` of a method whose inputs are primitives: nothing to copy. */
const noInput = (): undefined => undefined;

/** Spec 06: a cylinder axis, an extrude direction and a revolve axis must be longer than this. */
const MIN_AXIS_LENGTH = 1e-9;

/** Spec 06: revolve takes 0 < angle ≤ 2π + this. */
const ANGLE_TOLERANCE = 1e-9;

const TURN = 2 * Math.PI;

const BOOLEAN_OPS: readonly BooleanOp[] = ['union', 'subtract', 'intersect'];

/**
 * Roles of the box faces by world axes (spec 06, R93). BRepPrimAPI_MakeBox names its faces
 * after its own view: Left/Right are YMin/YMax, Back/Front are XMin/XMax.
 */
const BOX_ROLES = [
  ['face:top', 'TopFace'],
  ['face:bottom', 'BottomFace'],
  ['face:front', 'LeftFace'],
  ['face:back', 'RightFace'],
  ['face:left', 'BackFace'],
  ['face:right', 'FrontFace'],
] as const;

export class OcctKernelImpl implements GeometryKernel {
  private readonly oc: Occt;
  private readonly shapes = new Map<ShapeHandle, ShapeEntry>();
  /** Increasing counter: a handle is never reused within one instance. */
  private lastHandle = 0;

  constructor(oc: Occt) {
    this.oc = oc;
  }

  makeBox(p: { readonly origin: Vec3; readonly size: Vec3 }): Promise<ShapeResult> {
    // Spec 06, isolation: inputs are read synchronously at the call, as postMessage would clone them.
    const read = (): { origin: Vec3; size: Vec3 } => ({
      origin: [p.origin[0], p.origin[1], p.origin[2]],
      size: [p.size[0], p.size[1], p.size[2]],
    });
    return this.run(read, ({ origin, size }) => {
      if (!origin.every(Number.isFinite)) {
        throw createKernelError('invalid-input', 'makeBox: origin must be finite');
      }
      if (!size.every((s) => Number.isFinite(s) && s > 0)) {
        throw createKernelError('invalid-input', 'makeBox: size must be finite and > 0');
      }
      return this.boxResult(origin, size);
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
    return this.run(read, ({ base, axis, radius, height }) => {
      if (!base.every(Number.isFinite) || !axis.every(Number.isFinite)) {
        throw createKernelError('invalid-input', 'makeCylinder: base and axis must be finite');
      }
      if (!(Math.hypot(axis[0], axis[1], axis[2]) > MIN_AXIS_LENGTH)) {
        throw createKernelError('invalid-input', 'makeCylinder: axis must not be zero');
      }
      const positive = (x: number): boolean => Number.isFinite(x) && x > 0;
      if (!positive(radius) || !positive(height)) {
        throw createKernelError(
          'invalid-input',
          'makeCylinder: radius and height must be finite and > 0',
        );
      }
      return this.cylinderResult(base, axis, radius, height);
    });
  }

  transform(shape: ShapeHandle, m: Mat4): Promise<ShapeResult> {
    return this.run(
      (): Mat4 => [...m],
      (matrix) => {
        if (!isRigidMotion(matrix)) {
          throw createKernelError('invalid-input', 'transform: m must be a rigid motion');
        }
        return this.movedResult(this.entry(shape), matrix);
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
    return this.run(read, (lists) => {
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
      const targetEntries = lists.targets.map((h) => this.entry(h));
      const toolEntries = lists.tools.map((h) => this.entry(h));
      return this.booleanResult(op, targetEntries, toolEntries);
    });
  }

  makeFace(p: {
    readonly plane: Plane;
    readonly outer: ProfileLoop;
    readonly holes: readonly ProfileLoop[];
  }): Promise<ShapeResult> {
    // The check reads the whole input synchronously and never throws; a valid input is copied
    // right away (isolation), an invalid one leaves only the messages.
    const read = () => {
      const errors = validateFaceInput(p);
      return errors.length === 0 ? { input: copyFaceInput(p), errors } : { errors };
    };
    return this.run(read, ({ input, errors }) => {
      if (input === undefined) {
        throw createKernelError('invalid-input', `makeFace: ${errors.join('; ')}`);
      }
      return faceResult(this.oc, input, this.adder);
    });
  }

  extrude(profile: ShapeHandle, direction: Vec3, distance: number): Promise<ShapeResult> {
    const read = (): { direction: Vec3; distance: number } => ({
      direction: [direction[0], direction[1], direction[2]],
      distance,
    });
    return this.run(read, (input) => {
      if (!input.direction.every(Number.isFinite)) {
        throw createKernelError('invalid-input', 'extrude: direction must be finite');
      }
      const length = Math.hypot(...input.direction);
      if (!(length > MIN_AXIS_LENGTH)) {
        throw createKernelError('invalid-input', 'extrude: direction must not be zero');
      }
      if (!(Number.isFinite(input.distance) && input.distance > 0)) {
        throw createKernelError('invalid-input', 'extrude: distance must be finite and > 0');
      }
      const face = this.entry(profile);
      requireFace(this.oc, face.shape, 'extrude');
      const k = input.distance / length;
      const shift: Vec3 = [input.direction[0] * k, input.direction[1] * k, input.direction[2] * k];
      return prismResult(this.oc, face, shift, this.adder);
    });
  }

  revolve(profile: ShapeHandle, axis: Axis, angle: number): Promise<ShapeResult> {
    const read = (): { axis: Axis; angle: number } => ({
      axis: {
        origin: [axis.origin[0], axis.origin[1], axis.origin[2]],
        direction: [axis.direction[0], axis.direction[1], axis.direction[2]],
      },
      angle,
    });
    return this.run(read, (input) => {
      const { origin, direction } = input.axis;
      if (!origin.every(Number.isFinite) || !direction.every(Number.isFinite)) {
        throw createKernelError('invalid-input', 'revolve: the axis must be finite');
      }
      if (!(Math.hypot(...direction) > MIN_AXIS_LENGTH)) {
        throw createKernelError('invalid-input', 'revolve: the axis direction must not be zero');
      }
      const valid = Number.isFinite(input.angle) && input.angle > 0;
      if (!(valid && input.angle <= TURN + ANGLE_TOLERANCE)) {
        throw createKernelError('invalid-input', 'revolve: angle must be in (0, 2π]');
      }
      const face = this.entry(profile);
      requireFace(this.oc, face.shape, 'revolve');
      // An angle within the tolerance above 2π is a full turn.
      const angle = Math.min(input.angle, TURN);
      return revolResult(this.oc, face, input.axis, angle, this.adder);
    });
  }

  fillet(shape: ShapeHandle, edges: readonly number[], radius: number): Promise<ShapeResult> {
    return this.dressup('fillet', shape, edges, radius);
  }

  chamfer(shape: ShapeHandle, edges: readonly number[], distance: number): Promise<ShapeResult> {
    return this.dressup('chamfer', shape, edges, distance);
  }

  tessellate(shape: ShapeHandle, q: MeshQuality): Promise<MeshData> {
    const read = (): MeshQuality => ({
      linearDeflection: q.linearDeflection,
      angularDeflection: q.angularDeflection,
    });
    return this.run(read, (quality) => {
      const { linearDeflection, angularDeflection } = quality;
      if (!(Number.isFinite(linearDeflection) && linearDeflection > 0)) {
        throw createKernelError(
          'invalid-input',
          'tessellate: linearDeflection must be finite and > 0',
        );
      }
      if (!(Number.isFinite(angularDeflection) && angularDeflection > 0)) {
        throw createKernelError(
          'invalid-input',
          'tessellate: angularDeflection must be finite and > 0',
        );
      }
      return tessellateEntry(this.oc, this.entry(shape), quality);
    });
  }

  boundingBox(shape: ShapeHandle): Promise<BoundingBox> {
    return this.run(noInput, () => {
      const entry = this.entry(shape);
      using box = new this.oc.Bnd_Box();
      // Without the shape tolerance: the box is exactly [origin, origin + size] (spec 06, makeBox).
      this.oc.BRepBndLib.AddOptimal(entry.shape, box, false, false);
      return {
        min: [box.GetXMin(), box.GetYMin(), box.GetZMin()],
        max: [box.GetXMax(), box.GetYMax(), box.GetZMax()],
      };
    });
  }

  topology(shape: ShapeHandle): Promise<TopologySummary> {
    return this.run(noInput, () => topologyOf(this.oc, this.entry(shape)));
  }

  release(handles: readonly ShapeHandle[]): Promise<void> {
    return this.run(
      () => [...handles],
      (snapshot) => {
        // Check everything first: release is atomic.
        if (new Set(snapshot).size !== snapshot.length) {
          throw createKernelError('invalid-input', 'release: the same handle more than once');
        }
        const entries = snapshot.map((h) => this.entry(h));
        for (const h of snapshot) this.shapes.delete(h);
        for (const entry of entries) deleteShapeEntry(entry);
      },
    );
  }

  liveHandleCount(): Promise<number> {
    return this.run(noInput, () => this.shapes.size);
  }

  /**
   * Calls `read` synchronously – the copy of the inputs (isolation, spec 06) – then runs `body`
   * on the copy in a microtask: a result never comes synchronously and anything thrown – by
   * `read` on input outside the types, a kernel error or an OCCT exception – is a rejection
   * with a kernel error code, never a synchronous exception.
   */
  private run<I, T>(read: () => I, body: (input: I) => T): Promise<T> {
    let input: I;
    try {
      input = read();
    } catch (e) {
      return Promise.reject(toKernelError(this.oc, e));
    }
    return Promise.resolve().then(() => {
      try {
        return body(input);
      } catch (e) {
        throw toKernelError(this.oc, e);
      }
    });
  }

  /**
   * Takes ownership of `shape` and stores it under a new handle, with the edge roles and the
   * roles and history of `description` (M14). If describing fails, the entry is deleted and
   * no handle is created.
   */
  private add(shape: TopoDS_Shape, description: EntryDescription = {}): ShapeResult {
    const entry = createShapeEntry(this.oc, shape, description.edgeRoles);
    let described: Omit<ShapeResult, 'shape'>;
    try {
      described = description.describe?.(entry) ?? {};
    } catch (e) {
      deleteShapeEntry(entry);
      throw e;
    }
    const handle = this.nextHandle();
    this.shapes.set(handle, entry);
    return { shape: handle, ...described };
  }

  /** `add` for the helpers in other files (sweep, face, dressup). */
  private readonly adder = (shape: TopoDS_Shape, description?: EntryDescription): ShapeResult =>
    this.add(shape, description);

  /**
   * Fillet or chamfer (spec 06, M14): the size finite and > 0, the edges a non-empty list of
   * distinct integer indices of edges of the shape, else 'invalid-input'.
   */
  private dressup(
    kind: DressupKind,
    shape: ShapeHandle,
    edges: readonly number[],
    size: number,
  ): Promise<ShapeResult> {
    const read = (): { edges: number[]; size: number } => ({ edges: [...edges], size });
    return this.run(read, (input) => {
      if (!(Number.isFinite(input.size) && input.size > 0)) {
        throw createKernelError('invalid-input', `${kind}: the size must be finite and > 0`);
      }
      const entry = this.entry(shape);
      const count = entry.edges.length;
      if (input.edges.length === 0) {
        throw createKernelError('invalid-input', `${kind}: edges must not be empty`);
      }
      const bad = input.edges.find((e) => !(Number.isInteger(e) && e >= 0 && e < count));
      if (bad !== undefined) {
        throw createKernelError(
          'invalid-input',
          `${kind}: edge ${String(bad)} is not an integer in [0, ${String(count)})`,
        );
      }
      if (new Set(input.edges).size !== input.edges.length) {
        throw createKernelError('invalid-input', `${kind}: the same edge more than once`);
      }
      return dressupResult(this.oc, kind, entry, input.edges, input.size, this.adder);
    });
  }

  /** The box, with the roles of its faces by world axes (spec 06, R93). */
  private boxResult(origin: Vec3, size: Vec3): ShapeResult {
    using corner = new this.oc.gp_Pnt(origin[0], origin[1], origin[2]);
    using maker = new this.oc.BRepPrimAPI_MakeBox(corner, size[0], size[1], size[2]);
    return this.add(maker.Shape(), {
      describe: (entry) => {
        const roles: Record<string, readonly SubShapeIndex[]> = {};
        for (const [role, method] of BOX_ROLES) {
          using face = maker[method]();
          roles[role] = this.faceRole(entry, face, role);
        }
        return { roles };
      },
    });
  }

  /**
   * The cylinder about the axis (base, axis), with the roles face:side (the lateral face of
   * BRepPrimAPI_MakeOneAxis) and face:bottom/face:top: of the two other faces, the bottom is
   * the one whose plane point projects lower onto the axis (spec 06, M14).
   */
  private cylinderResult(base: Vec3, axis: Vec3, radius: number, height: number): ShapeResult {
    using origin = new this.oc.gp_Pnt(base[0], base[1], base[2]);
    using direction = new this.oc.gp_Dir(axis[0], axis[1], axis[2]);
    using frame = new this.oc.gp_Ax2(origin, direction);
    using maker = new this.oc.BRepPrimAPI_MakeCylinder(frame, radius, height);
    return this.add(maker.Shape(), {
      describe: (entry) => {
        using lateral = maker.Face();
        const side = this.faceRole(entry, lateral, 'face:side');
        const caps = topologyOf(this.oc, entry)
          .faces.map((f, index) => ({ index, plane: f.plane }))
          .filter((f) => f.plane !== undefined && !side.some((s) => s.index === f.index))
          .map((f) => ({
            index: f.index,
            level: f.plane === undefined ? 0 : dot(f.plane.origin, axis),
          }))
          .sort((a, b) => a.level - b.level);
        const [bottom, top] = caps;
        if (caps.length !== 2 || bottom === undefined || top === undefined) {
          throw createKernelError('internal', 'makeCylinder: expected two planar caps');
        }
        return {
          roles: {
            'face:bottom': [{ type: 'face', index: bottom.index }],
            'face:top': [{ type: 'face', index: top.index }],
            'face:side': side,
          },
        };
      },
    });
  }

  /** The face of the entry IsSame as `face`, as a role; 'internal' if it is not there. */
  private faceRole(entry: ShapeEntry, face: TopoDS_Shape, role: string): SubShapeIndex[] {
    const index = indexOfSame(entry.faces, face);
    if (index < 0) throw createKernelError('internal', `${role}: the face is not in the shape`);
    return [{ type: 'face', index }];
  }

  /**
   * `entry` moved by the rigid motion m (spec 06, "Modelovací operace v adaptéru"). gp_Trsf
   * takes the rows a11 … a34; Mat4 is column-major, so a_rc = m[c * 4 + r]. A rigid motion
   * only sets a location: the geometry (TShape) is shared, not copied. The edge roles move
   * along through Modified of the edges (M14); the history is that of BRepBuilderAPI_Transform.
   */
  private movedResult(entry: ShapeEntry, m: Mat4): ShapeResult {
    using trsf = new this.oc.gp_Trsf();
    // prettier-ignore
    trsf.SetValues(
      m[0], m[4], m[8], m[12],
      m[1], m[5], m[9], m[13],
      m[2], m[6], m[10], m[14],
    );
    using maker = new this.oc.BRepBuilderAPI_Transform(entry.shape, trsf, false, false);
    return this.add(maker.Shape(), {
      edgeRoles: (edges) => this.movedEdgeRoles(maker, entry, edges),
      describe: (moved) => ({ history: collectHistory(this.oc, maker, [entry], moved) }),
    });
  }

  /** Edge roles of the moved shape: each edge with a role → the edges IsSame as its Modified. */
  private movedEdgeRoles(
    maker: BRepBuilderAPI_Transform,
    entry: ShapeEntry,
    edges: readonly TopoDS_Shape[],
  ): ReadonlyMap<number, string> {
    const roles = new Map<number, string>();
    for (const [index, id] of entry.edgeRoles) {
      const edge = entry.edges[index];
      if (edge === undefined) continue;
      using list = maker.Modified(edge);
      while (!list.IsEmpty()) {
        using item = list.First();
        list.RemoveFirst();
        const moved = indexOfSame(edges, item);
        if (moved >= 0) roles.set(moved, id);
      }
    }
    return roles;
  }

  /**
   * The boolean with its history (inputs = [...targets, ...tools]). A failed algorithm or a
   * result without a solid (an empty intersection, a cut that removes the whole target) is
   * 'operation-failed'.
   */
  private booleanResult(
    op: BooleanOp,
    targets: readonly ShapeEntry[],
    tools: readonly ShapeEntry[],
  ): ShapeResult {
    using algo = this.booleanAlgo(op);
    using targetList = this.shapeList(targets.map((e) => e.shape));
    using toolList = this.shapeList(tools.map((e) => e.shape));
    algo.SetArguments(targetList);
    algo.SetTools(toolList);
    algo.Build();
    if (algo.HasErrors()) {
      throw createKernelError('operation-failed', `boolean ${op}: the algorithm failed`);
    }
    const result = algo.Shape();
    try {
      if (!hasSolid(this.oc, result)) {
        throw createKernelError('operation-failed', `boolean ${op}: the result has no solid`);
      }
    } catch (e) {
      result.delete();
      throw e;
    }
    const inputs = [...targets, ...tools];
    return this.add(result, {
      describe: (entry) => ({ history: collectHistory(this.oc, algo, inputs, entry) }),
    });
  }

  private booleanAlgo(
    op: BooleanOp,
  ): InstanceType<Occt['BRepAlgoAPI_Fuse' | 'BRepAlgoAPI_Cut' | 'BRepAlgoAPI_Common']> {
    switch (op) {
      case 'union':
        return new this.oc.BRepAlgoAPI_Fuse();
      case 'subtract':
        return new this.oc.BRepAlgoAPI_Cut();
      case 'intersect':
        return new this.oc.BRepAlgoAPI_Common();
    }
  }

  /** New list of the shapes; the caller owns it. The list keeps its own copies of the shapes. */
  private shapeList(shapes: readonly TopoDS_Shape[]): NCollection_List_TopoDS_Shape {
    const list = new this.oc.NCollection_List_TopoDS_Shape();
    try {
      // Append returns a new wrapper of the stored item, which is not needed.
      for (const s of shapes) list.Append(s).delete();
    } catch (e) {
      list.delete();
      throw e;
    }
    return list;
  }

  private nextHandle(): ShapeHandle {
    this.lastHandle++;
    // The only place a number becomes a ShapeHandle.
    return this.lastHandle as ShapeHandle;
  }

  private entry(shape: ShapeHandle): ShapeEntry {
    const entry = this.shapes.get(shape);
    if (entry === undefined) {
      throw createKernelError('unknown-handle', `Unknown shape handle ${String(shape)}`);
    }
    return entry;
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
