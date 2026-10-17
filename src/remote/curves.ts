// Conversions between the domain types of the SketchGeometry port (sketch Curve2, CurveHit,
// FilletArc, OffsetCurve2) and the messages of GeometryService (spec 14 "GeometryService",
// geometry.proto). The domain never sees a protobuf message (Q106); every conversion lives here.

import { create } from '@bufbuild/protobuf';
import type { Vec2 } from '@/core';
import { createKernelError } from '@/kernel';
import {
  Curve2Schema,
  FilletResponseSchema,
  OffsetCurveSchema,
  CurveHitSchema,
  Vec2Schema,
} from '@/protocol';
import type {
  Curve2 as ProtoCurve2,
  CurveHit as ProtoCurveHit,
  FilletResponse,
  OffsetCurve as ProtoOffsetCurve,
  Vec2 as ProtoVec2,
} from '@/protocol';
import type { Curve2, CurveHit, FilletArc, OffsetCurve2 } from '@/sketch';

/** Vec2 of core → the message Vec2. */
export function vec2ToProto(v: Vec2): ProtoVec2 {
  return create(Vec2Schema, { x: v[0], y: v[1] });
}

/**
 * The message Vec2 → Vec2 of core. A missing message field (unset on the wire) is a broken answer
 * of the server: an 'internal' kernel error, so the caller sees it like any failed kernel call.
 */
export function vec2FromProto(v: ProtoVec2 | undefined, what: string): Vec2 {
  if (v === undefined) throw brokenAnswer(`${what} is missing`);
  return [v.x, v.y];
}

/** A curve of the port → the message Curve2; a curve without an id gets '' (the server rejects it). */
export function curveToProto(curve: Curve2): ProtoCurve2 {
  const id = curve.id ?? '';
  switch (curve.kind) {
    case 'line':
      return create(Curve2Schema, {
        id,
        kind: {
          case: 'line',
          value: { from: vec2ToProto(curve.from), to: vec2ToProto(curve.to) },
        },
      });
    case 'arc':
      return create(Curve2Schema, {
        id,
        kind: {
          case: 'arc',
          value: {
            center: vec2ToProto(curve.center),
            from: vec2ToProto(curve.from),
            to: vec2ToProto(curve.to),
            ccw: curve.ccw,
          },
        },
      });
    case 'circle':
      return create(Curve2Schema, {
        id,
        kind: {
          case: 'circle',
          value: { center: vec2ToProto(curve.center), radius: curve.radius },
        },
      });
    case 'bspline':
      return create(Curve2Schema, {
        id,
        kind: {
          case: 'bspline',
          value: {
            degree: curve.degree,
            poles: curve.poles.map(vec2ToProto),
            knots: [...curve.knots],
          },
        },
      });
  }
}

/**
 * The message Curve2 → a curve of the port; '' as the id means no id. A curve without a kind is a
 * broken answer ('internal').
 */
export function curveFromProto(curve: ProtoCurve2 | undefined): Curve2 {
  if (curve === undefined) throw brokenAnswer('curve is missing');
  const id = curve.id === '' ? {} : { id: curve.id };
  const { kind } = curve;
  switch (kind.case) {
    case 'line':
      return {
        kind: 'line',
        from: vec2FromProto(kind.value.from, 'line.from'),
        to: vec2FromProto(kind.value.to, 'line.to'),
        ...id,
      };
    case 'arc':
      return {
        kind: 'arc',
        center: vec2FromProto(kind.value.center, 'arc.center'),
        from: vec2FromProto(kind.value.from, 'arc.from'),
        to: vec2FromProto(kind.value.to, 'arc.to'),
        ccw: kind.value.ccw,
        ...id,
      };
    case 'circle':
      return {
        kind: 'circle',
        center: vec2FromProto(kind.value.center, 'circle.center'),
        radius: kind.value.radius,
        ...id,
      };
    case 'bspline':
      return {
        kind: 'bspline',
        degree: kind.value.degree,
        poles: kind.value.poles.map((p) => vec2FromProto(p, 'bspline.poles')),
        knots: [...kind.value.knots],
        ...id,
      };
    case undefined:
      throw brokenAnswer(`curve '${curve.id}' has no kind`);
  }
}

/** CurveHit of the port → the message CurveHit (the fake server of the tests answers with it). */
export function hitToProto(hit: CurveHit): ProtoCurveHit {
  return create(CurveHitSchema, {
    a: hit.a,
    b: hit.b,
    point: vec2ToProto(hit.point),
    ta: hit.ta,
    tb: hit.tb,
    overlap: hit.overlap === true,
  });
}

/** The message CurveHit → CurveHit of the port; `overlap` only when true, as the kernel gives it. */
export function hitFromProto(hit: ProtoCurveHit): CurveHit {
  return {
    a: hit.a,
    b: hit.b,
    point: vec2FromProto(hit.point, 'hit.point'),
    ta: hit.ta,
    tb: hit.tb,
    ...(hit.overlap ? { overlap: true as const } : {}),
  };
}

/** FilletArc of the port → the message FilletResponse (the fake server of the tests). */
export function filletToProto(arc: FilletArc): FilletResponse {
  return create(FilletResponseSchema, {
    center: vec2ToProto(arc.center),
    pointA: vec2ToProto(arc.pointA),
    pointB: vec2ToProto(arc.pointB),
    ta: arc.ta,
    tb: arc.tb,
  });
}

/** The message FilletResponse → FilletArc of the port. */
export function filletFromProto(arc: FilletResponse): FilletArc {
  return {
    center: vec2FromProto(arc.center, 'fillet.center'),
    pointA: vec2FromProto(arc.pointA, 'fillet.point_a'),
    pointB: vec2FromProto(arc.pointB, 'fillet.point_b'),
    ta: arc.ta,
    tb: arc.tb,
  };
}

/** OffsetCurve2 of the port → the message OffsetCurve; a join (no source) gets ''. */
export function offsetCurveToProto(curve: OffsetCurve2): ProtoOffsetCurve {
  return create(OffsetCurveSchema, {
    curve: curveToProto(curve),
    source: curve.source ?? '',
  });
}

/** The message OffsetCurve → OffsetCurve2 of the port; '' as the source means a join. */
export function offsetCurveFromProto(curve: ProtoOffsetCurve): OffsetCurve2 {
  const shape = curveFromProto(curve.curve);
  return curve.source === '' ? shape : { ...shape, source: curve.source };
}

function brokenAnswer(detail: string): Error {
  return createKernelError('internal', `GeometryService answered a broken message: ${detail}`);
}
