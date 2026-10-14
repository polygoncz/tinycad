import type { TopoDS_Shape } from 'replicad-opencascadejs';
import { createKernelError, type ShapeResult } from '@/kernel';
import { collectHistory } from './history';
import { hasSolid, occtExceptionText, type Occt } from './occt';
import type { AddShape, ShapeEntry } from './shape-entry';

// Fillet and chamfer of edges (spec 06, "Historie, role a topologie v adaptéru (M14)").
// Internal to kernel-occt; the inputs are already checked by OcctKernelImpl.

export type DressupKind = 'fillet' | 'chamfer';

/**
 * The fillet (BRepFilletAPI_MakeFillet, radius `size`) or the symmetric chamfer
 * (BRepFilletAPI_MakeChamfer, distance `size`) of the edges `edges` of `entry`, stored through
 * `add` with the history of the algorithm (input 0 = `entry`). Every failure of the algorithm
 * – an edge OCCT does not accept, an OCCT exception from Build or Shape, not done, a result
 * without a solid or not valid – is 'operation-failed'; a WASM trap still passes unchanged
 * (fatal, Q055).
 */
export function dressupResult(
  oc: Occt,
  kind: DressupKind,
  entry: ShapeEntry,
  edges: readonly number[],
  size: number,
  add: AddShape,
): ShapeResult {
  using maker =
    kind === 'fillet'
      ? new oc.BRepFilletAPI_MakeFillet(entry.shape)
      : new oc.BRepFilletAPI_MakeChamfer(entry.shape);
  for (const index of edges) {
    const sub = entry.edges[index];
    if (sub === undefined) {
      throw createKernelError('invalid-input', `${kind}: edge ${String(index)} out of range`);
    }
    using edge = oc.TopoDS.Edge(sub);
    maker.Add(size, edge);
    // Add is void and skips an edge it cannot use (the seam of a cylinder, M19.1): such an
    // edge is in no contour. Without this check the result would lack it and still succeed.
    if (maker.Contour(edge) === 0) {
      throw createKernelError(
        'operation-failed',
        `${kind}: OCCT did not accept edge ${String(index)}`,
      );
    }
  }
  const result = built(oc, kind, maker);
  try {
    if (!hasSolid(oc, result)) {
      throw createKernelError('operation-failed', `${kind}: the result has no solid`);
    }
    using analyzer = new oc.BRepCheck_Analyzer(result, true, false, false);
    if (!analyzer.IsValid()) {
      throw createKernelError('operation-failed', `${kind}: the result is not valid`);
    }
  } catch (e) {
    result.delete();
    throw e;
  }
  return add(result, { describe: (out) => ({ history: collectHistory(oc, maker, [entry], out) }) });
}

/** Build and Shape of the algorithm; an OCCT exception or not done → 'operation-failed'. */
function built(
  oc: Occt,
  kind: DressupKind,
  maker: { Build(): void; IsDone(): boolean; Shape(): TopoDS_Shape },
): TopoDS_Shape {
  try {
    maker.Build();
    if (!maker.IsDone()) {
      throw createKernelError('operation-failed', `${kind}: the algorithm failed`);
    }
    return maker.Shape();
  } catch (e) {
    const text = occtExceptionText(oc, e);
    if (text === undefined) throw e;
    throw createKernelError('operation-failed', `${kind}: ${text}`);
  }
}
