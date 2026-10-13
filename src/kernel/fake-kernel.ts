import type { Vec3 } from '@/core';
import { createKernelError } from './errors';
import type { KernelErrorCode } from './errors';
import type { GeometryKernel } from './kernel';
import type { BoundingBox, MeshData, MeshQuality, ShapeHandle, ShapeResult } from './types';

// In-memory GeometryKernel for tests of higher layers (spec 06, "FakeKernel"). A shape is an
// axis-aligned box. Reached only through kernel/testing.ts, so it never gets into production.

export type KernelOp = keyof GeometryKernel;

export interface FakeKernel extends GeometryKernel {
  /** The next call of `op` rejects with `code` (no side effects). Several calls queue up. */
  failNext(op: KernelOp, code: KernelErrorCode, message?: string): void;
  /** Number of calls of `op` (failed ones included), or of all methods. */
  callCount(op?: KernelOp): number;
}

export function createFakeKernel(): FakeKernel {
  return new FakeKernelImpl();
}

/** The fake's ShapeEntry: the box as its AABB. */
interface BoxEntry {
  readonly min: Vec3;
  readonly max: Vec3;
}

interface InjectedFailure {
  readonly code: KernelErrorCode;
  readonly message: string;
}

class FakeKernelImpl implements FakeKernel {
  private readonly shapes = new Map<ShapeHandle, BoxEntry>();
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
    const origin: Vec3 = [p.origin[0], p.origin[1], p.origin[2]];
    const size: Vec3 = [p.size[0], p.size[1], p.size[2]];
    return this.call('makeBox', () => {
      if (!origin.every(Number.isFinite)) {
        throw createKernelError('invalid-input', 'makeBox: origin must be finite');
      }
      if (!size.every((s) => Number.isFinite(s) && s > 0)) {
        throw createKernelError('invalid-input', 'makeBox: size must be finite and > 0');
      }
      const shape = this.nextHandle();
      this.shapes.set(shape, {
        min: [origin[0], origin[1], origin[2]],
        max: [origin[0] + size[0], origin[1] + size[1], origin[2] + size[2]],
      });
      return { shape };
    });
  }

  tessellate(shape: ShapeHandle, q: MeshQuality): Promise<MeshData> {
    const { linearDeflection, angularDeflection } = q;
    return this.call('tessellate', () => {
      const valid = (d: number): boolean => Number.isFinite(d) && d > 0;
      if (!valid(linearDeflection) || !valid(angularDeflection)) {
        throw createKernelError('invalid-input', 'tessellate: deflections must be finite and > 0');
      }
      return boxMesh(this.entry(shape));
    });
  }

  boundingBox(shape: ShapeHandle): Promise<BoundingBox> {
    return this.call('boundingBox', () => {
      const { min, max } = this.entry(shape);
      return { min: [...min], max: [...max] };
    });
  }

  release(handles: readonly ShapeHandle[]): Promise<void> {
    const snapshot = [...handles];
    return this.call('release', () => {
      // Check everything first: release is atomic.
      if (new Set(snapshot).size !== snapshot.length) {
        throw createKernelError('invalid-input', 'release: the same handle more than once');
      }
      for (const h of snapshot) this.entry(h);
      for (const h of snapshot) this.shapes.delete(h);
    });
  }

  liveHandleCount(): Promise<number> {
    return this.call('liveHandleCount', () => this.shapes.size);
  }

  /**
   * Counts the call, then runs `body` in a microtask: results never come synchronously and a
   * failure – injected or thrown by `body` – is always a rejection. An injected failure skips
   * `body`, so it has no side effects.
   */
  private call<T>(op: KernelOp, body: () => T): Promise<T> {
    this.calls.set(op, (this.calls.get(op) ?? 0) + 1);
    const [failure, ...rest] = this.failures.get(op) ?? [];
    if (failure !== undefined) this.failures.set(op, rest);
    return Promise.resolve().then(() => {
      if (failure !== undefined) throw createKernelError(failure.code, failure.message);
      return body();
    });
  }

  private nextHandle(): ShapeHandle {
    this.lastHandle++;
    // The only place a number becomes a ShapeHandle.
    return this.lastHandle as ShapeHandle;
  }

  private entry(shape: ShapeHandle): BoxEntry {
    const entry = this.shapes.get(shape);
    if (entry === undefined) {
      throw createKernelError('unknown-handle', `Unknown shape handle ${String(shape)}`);
    }
    return entry;
  }
}

/**
 * The box as 6 faces of 2 triangles (24 vertices, flat normals) in order −X, +X, −Y, +Y, −Z, +Z,
 * and 12 edges of 2 points. Fresh buffers on every call.
 */
function boxMesh({ min, max }: BoxEntry): MeshData {
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
