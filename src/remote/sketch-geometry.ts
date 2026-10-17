// The SketchGeometry port of the sketcher over GeometryService of the native core (spec 14
// "GeometryService", Q096, M39): the sketcher asks the port and does not know that the server's
// OCCT kernel (server/src/service) answers.

import { createClient } from '@connectrpc/connect';
import type { Transport } from '@connectrpc/connect';
import { GeometryService } from '@/protocol';
import type { Curve2, SketchGeometry } from '@/sketch';
import {
  curveFromProto,
  curveToProto,
  filletFromProto,
  hitFromProto,
  offsetCurveFromProto,
  vec2ToProto,
} from './curves';
import { kernelErrorOf } from './kernel-errors';
import { coalescingQueue } from './coalescing-queue';

/**
 * The port over a GeometryService client on `transport` (createCoreTransport in the browser, a
 * router transport in the tests). Each of the four methods keeps at most one request in flight
 * (coalescingQueue, N6); the methods do not wait for each other. Queued calls coalesce only with
 * the same question: intersections of the same curves (the hits of the whole sketch), the offset
 * of the same chain (the preview with a changing distance); segment and fillet never coalesce, so
 * every call gets the answer to its own arguments. A failed call rejects with a kernel error
 * (kernelErrorOf), a broken answer with an 'internal' one.
 */
export function createRemoteSketchGeometry(transport: Transport): SketchGeometry {
  const client = createClient(GeometryService, transport);
  const call = async <Res>(rpc: () => Promise<Res>): Promise<Res> => {
    try {
      return await rpc();
    } catch (e) {
      throw kernelErrorOf(e);
    }
  };

  const intersections = coalescingQueue(
    async (curves: SketchGeometryArgs['intersections']) => {
      const res = await call(() => client.intersections({ curves: curves.map(curveToProto) }));
      return res.hits.map(hitFromProto);
    },
    (curves) => idsKey(curves),
  );
  const segment = coalescingQueue(async ([curve, from, to]: SketchGeometryArgs['segment']) => {
    const res = await call(() => client.segment({ curve: curveToProto(curve), from, to }));
    return curveFromProto(res.curve);
  });
  const fillet = coalescingQueue(async ([a, b, radius, near]: SketchGeometryArgs['fillet']) => {
    const res = await call(() =>
      client.fillet({ a: curveToProto(a), b: curveToProto(b), radius, near: vec2ToProto(near) }),
    );
    return filletFromProto(res);
  });
  const offset = coalescingQueue(
    async ([chain, closed, distance]: SketchGeometryArgs['offset']) => {
      const res = await call(() =>
        client.offset({ chain: chain.map(curveToProto), closed, distance }),
      );
      return res.curves.map(offsetCurveFromProto);
    },
    ([chain, closed]) => `${idsKey(chain)}|${String(closed)}`,
  );

  return Object.freeze({
    intersections: (curves) => intersections(curves),
    segment: (curve, from, to) => segment([curve, from, to]),
    fillet: (a, b, radius, near) => fillet([a, b, radius, near]),
    offset: (chain, closed, distance) => offset([chain, closed, distance]),
  } satisfies SketchGeometry);
}

/** The coalescing key of a list of curves: their ids, sorted (a curve without an id as ''). */
function idsKey(curves: readonly Curve2[]): string {
  return JSON.stringify(curves.map((c) => c.id ?? '').toSorted());
}

/** The arguments of each port method as one request value for coalescingQueue. */
interface SketchGeometryArgs {
  readonly intersections: Parameters<SketchGeometry['intersections']>[0];
  readonly segment: Readonly<Parameters<SketchGeometry['segment']>>;
  readonly fillet: Readonly<Parameters<SketchGeometry['fillet']>>;
  readonly offset: Readonly<Parameters<SketchGeometry['offset']>>;
}
