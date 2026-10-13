import type { NCollection_List_TopoDS_Shape, TopoDS_Shape } from 'replicad-opencascadejs';
import type { Mat4, Vec3 } from '@/core';
import {
  createKernelError,
  isRigidMotion,
  type BooleanOp,
  type BoundingBox,
  type GeometryKernel,
  type MeshData,
  type MeshQuality,
  type ShapeHandle,
  type ShapeResult,
} from '@/kernel';
import { toKernelError, type Occt } from './occt';
import { createShapeEntry, deleteShapeEntry, type ShapeEntry } from './shape-entry';
import { tessellateEntry } from './tessellate';

// GeometryKernel over the OCCT module (spec 06, "kernel-occt: adapter architecture"). Runs in
// the worker; takes the module in the constructor, so it is testable in Node without a worker.
// Internal to kernel-occt.

/** `read` of a method whose inputs are primitives: nothing to copy. */
const noInput = (): undefined => undefined;

/** Spec 06: a cylinder axis must be longer than this. */
const MIN_AXIS_LENGTH = 1e-9;

const BOOLEAN_OPS: readonly BooleanOp[] = ['union', 'subtract', 'intersect'];

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
      return this.add(this.boxShape(origin, size));
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
      return this.add(this.cylinderShape(base, axis, radius, height));
    });
  }

  transform(shape: ShapeHandle, m: Mat4): Promise<ShapeResult> {
    return this.run(
      (): Mat4 => [...m],
      (matrix) => {
        if (!isRigidMotion(matrix)) {
          throw createKernelError('invalid-input', 'transform: m must be a rigid motion');
        }
        return this.add(this.movedShape(this.entry(shape).shape, matrix));
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
      const targetShapes = lists.targets.map((h) => this.entry(h).shape);
      const toolShapes = lists.tools.map((h) => this.entry(h).shape);
      return this.add(this.booleanShape(op, targetShapes, toolShapes));
    });
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

  /** Takes ownership of `shape` and stores it under a new handle. */
  private add(shape: TopoDS_Shape): ShapeResult {
    const entry = createShapeEntry(this.oc, shape);
    const handle = this.nextHandle();
    this.shapes.set(handle, entry);
    return { shape: handle };
  }

  /** New TopoDS_Shape of the box; the caller owns it. */
  private boxShape(origin: Vec3, size: Vec3): TopoDS_Shape {
    using corner = new this.oc.gp_Pnt(origin[0], origin[1], origin[2]);
    using maker = new this.oc.BRepPrimAPI_MakeBox(corner, size[0], size[1], size[2]);
    return maker.Shape();
  }

  /** New TopoDS_Shape of the cylinder about the axis (base, axis); the caller owns it. */
  private cylinderShape(base: Vec3, axis: Vec3, radius: number, height: number): TopoDS_Shape {
    using origin = new this.oc.gp_Pnt(base[0], base[1], base[2]);
    using direction = new this.oc.gp_Dir(axis[0], axis[1], axis[2]);
    using frame = new this.oc.gp_Ax2(origin, direction);
    using maker = new this.oc.BRepPrimAPI_MakeCylinder(frame, radius, height);
    return maker.Shape();
  }

  /**
   * New TopoDS_Shape: `shape` moved by the rigid motion m (spec 06, "Modelovací operace v
   * adaptéru"). gp_Trsf takes the rows a11 … a34; Mat4 is column-major, so a_rc = m[c * 4 + r].
   * A rigid motion only sets a location: the geometry (TShape) is shared, not copied.
   */
  private movedShape(shape: TopoDS_Shape, m: Mat4): TopoDS_Shape {
    using trsf = new this.oc.gp_Trsf();
    // prettier-ignore
    trsf.SetValues(
      m[0], m[4], m[8], m[12],
      m[1], m[5], m[9], m[13],
      m[2], m[6], m[10], m[14],
    );
    using maker = new this.oc.BRepBuilderAPI_Transform(shape, trsf, false, false);
    return maker.Shape();
  }

  /**
   * New TopoDS_Shape of the boolean; the caller owns it. A failed algorithm or a result without
   * a solid (an empty intersection, a cut that removes the whole target) is 'operation-failed'.
   */
  private booleanShape(
    op: BooleanOp,
    targets: readonly TopoDS_Shape[],
    tools: readonly TopoDS_Shape[],
  ): TopoDS_Shape {
    using algo = this.booleanAlgo(op);
    using targetList = this.shapeList(targets);
    using toolList = this.shapeList(tools);
    algo.SetArguments(targetList);
    algo.SetTools(toolList);
    algo.Build();
    if (algo.HasErrors()) {
      throw createKernelError('operation-failed', `boolean ${op}: the algorithm failed`);
    }
    const result = algo.Shape();
    try {
      if (!this.hasSolid(result)) {
        throw createKernelError('operation-failed', `boolean ${op}: the result has no solid`);
      }
    } catch (e) {
      result.delete();
      throw e;
    }
    return result;
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

  private hasSolid(shape: TopoDS_Shape): boolean {
    const { TopAbs_SOLID, TopAbs_SHAPE } = this.oc.TopAbs_ShapeEnum;
    using explorer = new this.oc.TopExp_Explorer(shape, TopAbs_SOLID, TopAbs_SHAPE);
    return explorer.More();
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
