import type { TopoDS_Shape } from 'replicad-opencascadejs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createKernelError, kernelErrorCode } from '@/kernel';
import { loadOcct, mapSubShapes, toKernelError, type Occt } from './occt';

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
