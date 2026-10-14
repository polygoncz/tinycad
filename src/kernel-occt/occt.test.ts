import type { TopoDS_Shape } from 'replicad-opencascadejs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createKernelError, kernelErrorCode } from '@/kernel';
import { loadOcct, mapSubShapes, occtExceptionText, toKernelError, type Occt } from './occt';
import { aWasmTrap } from './testing';

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

/** Calls fn with a 10 × 20 × 30 box at the origin and releases it afterwards. */
function withBox(fn: (shape: TopoDS_Shape) => void): void {
  using origin = new oc.gp_Pnt(0, 0, 0);
  using maker = new oc.BRepPrimAPI_MakeBox(origin, 10, 20, 30);
  using shape = maker.Shape();
  fn(shape);
}

function centre(shape: TopoDS_Shape): [number, number, number] {
  using box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  return [
    (box.GetXMin() + box.GetXMax()) / 2,
    (box.GetYMin() + box.GetYMax()) / 2,
    (box.GetZMin() + box.GetZMax()) / 2,
  ];
}

function release(shapes: readonly TopoDS_Shape[]): void {
  for (const s of shapes) s.delete();
}

const ZERO_DIR = 'gp_Dir() - input vector has zero norm';

/**
 * A caught OCCT exception (WebAssembly.Exception) that owns nothing else on the heap:
 * gp_Dir of a zero vector throws Standard_ConstructionError before it allocates. A failing
 * modelling operation would not do: OCCT itself leaves memory behind after it (Q054).
 */
function anOcctException(): unknown {
  try {
    new oc.gp_Dir(0, 0, 0).delete();
  } catch (e) {
    return e;
  }
  return expect.fail('Expected gp_Dir of a zero vector to throw');
}

/** Size of the block heapTop allocates. */
const HEAP_PROBE = 256 * 1024;

/**
 * The top of the used WASM heap: the address of a fresh block of HEAP_PROBE bytes, freed at
 * once. A block this big comes from the top of the heap, above every live allocation, so a
 * leak of small blocks moves it up. The size of the memory (wasmMemory.buffer.byteLength) is
 * no measure here: the module starts with 100 MB and the memory grows only after ~90 MB leak.
 * malloc and free are exports of this build that its .d.ts does not declare.
 */
function heapTop(): number {
  const malloc: unknown = Reflect.get(oc, '___libc_malloc');
  const free: unknown = Reflect.get(oc, '___libc_free');
  if (typeof malloc !== 'function' || typeof free !== 'function') {
    throw new Error('The OCCT build does not export ___libc_malloc and ___libc_free');
  }
  const address: unknown = Reflect.apply(malloc, undefined, [HEAP_PROBE]);
  if (typeof address !== 'number' || address === 0) throw new Error('malloc failed');
  Reflect.apply(free, undefined, [address]);
  return address >>> 0;
}

describe('loadOcct', () => {
  it('returns the module whose embind objects are disposable', () => {
    using p = new oc.gp_Pnt(1, 2, 3);
    expect(p.X()).toBe(1);
    expect(typeof p[Symbol.dispose]).toBe('function');
  });
});

describe('mapSubShapes', () => {
  it('finds 6 faces, 12 edges and 8 vertices of a box without duplicates', () => {
    withBox((shape) => {
      const { TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX } = oc.TopAbs_ShapeEnum;
      const faces = mapSubShapes(oc, shape, TopAbs_FACE);
      const edges = mapSubShapes(oc, shape, TopAbs_EDGE);
      const vertices = mapSubShapes(oc, shape, TopAbs_VERTEX);
      expect([faces.length, edges.length, vertices.length]).toEqual([6, 12, 8]);
      for (const [i, a] of edges.entries()) {
        expect(edges.slice(i + 1).some((b) => b.IsSame(a))).toBe(false);
      }
      release(faces);
      release(edges);
      release(vertices);
    });
  });

  it('orders box faces like TopExp::MapShapes: -X, +X, -Y, +Y, -Z, +Z', () => {
    withBox((shape) => {
      const faces = mapSubShapes(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
      const expected = [
        [0, 10, 15],
        [10, 10, 15],
        [5, 0, 15],
        [5, 20, 15],
        [5, 10, 0],
        [5, 10, 30],
      ];
      expect(faces).toHaveLength(expected.length);
      faces.forEach((face, i) => {
        const c = centre(face);
        expected[i]?.forEach((v, axis) => {
          expect(c[axis]).toBeCloseTo(v, 6);
        });
      });
      release(faces);
    });
  });

  it('deletes every sub-shape it created, the current one included, when IsSame throws', () => {
    // A stub of the OCCT module, because a real IsSame does not throw: an explorer over two
    // shapes whose IsSame fails. The casts through unknown are deliberate – the stub has only
    // the members mapSubShapes uses.
    const deleted: string[] = [];
    const aStubShape = (name: string): TopoDS_Shape =>
      ({
        IsSame: () => {
          throw new Error('IsSame failed');
        },
        delete: () => deleted.push(name),
      }) as unknown as TopoDS_Shape;
    const stubOc = {
      TopAbs_ShapeEnum: oc.TopAbs_ShapeEnum,
      TopExp_Explorer: class {
        private position = 0;
        More(): boolean {
          return this.position < 2;
        }
        Current(): TopoDS_Shape {
          return aStubShape(`shape ${String(this.position)}`);
        }
        Next(): void {
          this.position++;
        }
        [Symbol.dispose](): void {
          // Nothing to free in the stub.
        }
      },
    } as unknown as Occt;

    withBox((shape) => {
      expect(() => mapSubShapes(stubOc, shape, oc.TopAbs_ShapeEnum.TopAbs_FACE)).toThrow(
        'IsSame failed',
      );
    });
    expect(deleted.sort()).toEqual(['shape 0', 'shape 1']);
  });
});

describe('toKernelError', () => {
  it('converts an OCCT exception to an internal kernel error naming the OCCT type', () => {
    let caught: unknown;
    try {
      using origin = new oc.gp_Pnt(0, 0, 0);
      using maker = new oc.BRepPrimAPI_MakeBox(origin, -1, 0, 0);
      maker.Shape().delete();
    } catch (e) {
      caught = e;
    }
    // WebAssembly.Exception is not a declared value without lib DOM: check its tag instead.
    expect(Object.prototype.toString.call(caught)).toBe('[object WebAssembly.Exception]');
    const error = toKernelError(oc, caught);
    expect(kernelErrorCode(error)).toBe('internal');
    // This exception carries no message: just the OCCT type, no dangling ": ".
    expect(error.message).toBe('Standard_DomainError');
  });

  it('passes an error with a kernel code through unchanged', () => {
    const original = createKernelError('invalid-input', 'size must be positive');
    expect(toKernelError(oc, original)).toBe(original);
  });

  it('passes a WASM trap through unchanged: it is fatal, not a kernel error (Q055)', () => {
    const trap = aWasmTrap();
    expect(toKernelError(oc, trap)).toBe(trap);
  });

  it('converts any other error to internal, keeping its message', () => {
    const error = toKernelError(oc, new Error('boom'));
    expect(kernelErrorCode(error)).toBe('internal');
    expect(error.message).toContain('boom');
  });

  it('converts a thrown non-error value to internal', () => {
    const error = toKernelError(oc, 'boom');
    expect(kernelErrorCode(error)).toBe('internal');
    expect(error.message).toContain('boom');
  });
});

describe('occtExceptionText (M14)', () => {
  it('is the OCCT type of an OCCT exception', () => {
    let caught: unknown;
    try {
      using origin = new oc.gp_Pnt(0, 0, 0);
      using maker = new oc.BRepPrimAPI_MakeBox(origin, -1, 0, 0);
      maker.Shape().delete();
    } catch (e) {
      caught = e;
    }
    expect(occtExceptionText(oc, caught)).toBe('Standard_DomainError');
  });

  it('is undefined for a WASM trap and for anything else: fillet turns only OCCT exceptions into operation-failed', () => {
    expect(occtExceptionText(oc, aWasmTrap())).toBeUndefined();
    expect(occtExceptionText(oc, new Error('boom'))).toBeUndefined();
    expect(occtExceptionText(oc, createKernelError('internal', 'x'))).toBeUndefined();
  });
});

describe('occtExceptionText releases the OCCT exception (M19.1, C8)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('decrements the refcount of the exception it reads, once', () => {
    const caught = anOcctException();
    const release = vi.spyOn(oc, 'decrementExceptionRefcount');
    expect(occtExceptionText(oc, caught)).toBe('Standard_ConstructionError: ' + ZERO_DIR);
    expect(release).toHaveBeenCalledExactlyOnceWith(caught);
  });

  it('releases nothing for a WASM trap or another error', () => {
    const release = vi.spyOn(oc, 'decrementExceptionRefcount');
    occtExceptionText(oc, aWasmTrap());
    occtExceptionText(oc, new Error('boom'));
    expect(release).not.toHaveBeenCalled();
  });

  it('toKernelError releases the exception it converts', () => {
    const caught = anOcctException();
    const release = vi.spyOn(oc, 'decrementExceptionRefcount');
    expect(kernelErrorCode(toKernelError(oc, caught))).toBe('internal');
    expect(release).toHaveBeenCalledExactlyOnceWith(caught);
  });

  it('a loop of OCCT exceptions converted by toKernelError does not grow the WASM heap', () => {
    // Each C++ exception that reaches JS also leaks 32 B of the Emscripten stack (8 MB, so
    // ~262 000 exceptions per module, Q055); the 22 000 here use less than a tenth of it.
    const fail = () => toKernelError(oc, anOcctException());
    for (let i = 0; i < 2_000; i++) fail();
    const before = heapTop();
    for (let i = 0; i < 20_000; i++) fail();
    // Unreleased, the 20 000 exceptions move the top by ~2.8 MB (~140 B each).
    expect(heapTop() - before).toBeLessThan(HEAP_PROBE);
  });
});
