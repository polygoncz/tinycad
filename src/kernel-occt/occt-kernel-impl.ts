import type { TopoDS_Shape } from 'replicad-opencascadejs';
import type { Vec3 } from '@/core';
import {
  createKernelError,
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
      const entry = createShapeEntry(this.oc, this.boxShape(origin, size));
      const shape = this.nextHandle();
      this.shapes.set(shape, entry);
      return { shape };
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

  /** New TopoDS_Shape of the box; the caller owns it. */
  private boxShape(origin: Vec3, size: Vec3): TopoDS_Shape {
    using corner = new this.oc.gp_Pnt(origin[0], origin[1], origin[2]);
    using maker = new this.oc.BRepPrimAPI_MakeBox(corner, size[0], size[1], size[2]);
    return maker.Shape();
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
