import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { kernelErrorCode } from '@/kernel/testing';
import { Curve2Schema, CurveHitSchema, FilletResponseSchema, OffsetCurveSchema } from '@/protocol';
import type { Curve2, CurveHit, FilletArc, OffsetCurve2 } from '@/sketch';
import {
  curveFromProto,
  curveToProto,
  filletFromProto,
  filletToProto,
  hitFromProto,
  hitToProto,
  offsetCurveFromProto,
  offsetCurveToProto,
} from '@/remote/curves';

const CURVES: readonly Curve2[] = [
  { kind: 'line', from: [0, 0], to: [2, -1.5], id: 'l' },
  { kind: 'arc', center: [1, 1], from: [2, 1], to: [1, 2], ccw: true, id: 'a' },
  { kind: 'arc', center: [0, 0], from: [0, 3], to: [3, 0], ccw: false, id: 'cw' },
  { kind: 'circle', center: [-4, 5], radius: 2.5, id: 'c' },
  {
    kind: 'bspline',
    degree: 3,
    poles: [
      [0, 0],
      [1, 2],
      [3, 2],
      [4, 0],
    ],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
    id: 's',
  },
];

describe('Curve2 conversions', () => {
  it.each(CURVES.map((c) => [c.kind, c] as const))('a %s goes there and back', (_, curve) => {
    expect(curveFromProto(curveToProto(curve))).toEqual(curve);
  });

  it('writes the fields of the message', () => {
    const arc = curveToProto({
      kind: 'arc',
      center: [1, 1],
      from: [2, 1],
      to: [1, 2],
      ccw: true,
      id: 'a',
    });

    expect(arc.id).toBe('a');
    expect(arc.kind.case).toBe('arc');
    if (arc.kind.case !== 'arc') return;
    expect(arc.kind.value.center).toMatchObject({ x: 1, y: 1 });
    expect(arc.kind.value.from).toMatchObject({ x: 2, y: 1 });
    expect(arc.kind.value.to).toMatchObject({ x: 1, y: 2 });
    expect(arc.kind.value.ccw).toBe(true);
  });

  it('sends a curve without an id with an empty id and reads an empty id back as none', () => {
    const line: Curve2 = { kind: 'line', from: [0, 0], to: [1, 0] };

    const message = curveToProto(line);

    expect(message.id).toBe('');
    expect(curveFromProto(message)).toEqual(line);
    expect('id' in curveFromProto(message)).toBe(false);
  });

  it('rejects an answer without a curve or without its kind as an internal kernel error', () => {
    const noKind = create(Curve2Schema, { id: 'x' });
    const noPoint = create(Curve2Schema, { id: 'x', kind: { case: 'line', value: {} } });

    for (const broken of [undefined, noKind, noPoint]) {
      expect(() => curveFromProto(broken)).toThrow();
      try {
        curveFromProto(broken);
      } catch (e) {
        expect(kernelErrorCode(e)).toBe('internal');
      }
    }
  });
});

describe('CurveHit conversions', () => {
  it('goes there and back, overlap only when true', () => {
    const plain: CurveHit = { a: 'h', b: 'v', point: [1, 0], ta: 0.5, tb: 0.25 };
    const overlap: CurveHit = { ...plain, overlap: true };

    expect(hitFromProto(hitToProto(plain))).toEqual(plain);
    expect('overlap' in hitFromProto(hitToProto(plain))).toBe(false);
    expect(hitFromProto(hitToProto(overlap))).toEqual(overlap);
  });

  it('reads the message fields', () => {
    const hit = create(CurveHitSchema, {
      a: 'a',
      b: 'a',
      point: { x: 3, y: 4 },
      ta: 0.1,
      tb: 0.9,
      overlap: true,
    });

    expect(hitFromProto(hit)).toEqual({
      a: 'a',
      b: 'a',
      point: [3, 4],
      ta: 0.1,
      tb: 0.9,
      overlap: true,
    });
  });
});

describe('FilletArc conversions', () => {
  it('goes there and back', () => {
    const arc: FilletArc = { center: [1, 1], pointA: [1, 0], pointB: [0, 1], ta: 0.5, tb: -0.25 };

    expect(filletFromProto(filletToProto(arc))).toEqual(arc);
  });

  it('reads point_a and point_b', () => {
    const message = create(FilletResponseSchema, {
      center: { x: 1, y: 1 },
      pointA: { x: 1, y: 0 },
      pointB: { x: 0, y: 1 },
      ta: 2,
      tb: 3,
    });

    expect(filletFromProto(message)).toEqual({
      center: [1, 1],
      pointA: [1, 0],
      pointB: [0, 1],
      ta: 2,
      tb: 3,
    });
  });
});

describe('OffsetCurve2 conversions', () => {
  it('keeps the source of a piece and none for a join', () => {
    const piece: OffsetCurve2 = { kind: 'line', from: [0, 1], to: [2, 1], id: 'l', source: 'l' };
    const join: OffsetCurve2 = {
      kind: 'arc',
      center: [2, 0],
      from: [2, 1],
      to: [3, 0],
      ccw: false,
    };

    expect(offsetCurveFromProto(offsetCurveToProto(piece))).toEqual(piece);
    expect(offsetCurveFromProto(offsetCurveToProto(join))).toEqual(join);
    expect('source' in offsetCurveFromProto(offsetCurveToProto(join))).toBe(false);
  });

  it('reads the source next to the curve', () => {
    const message = create(OffsetCurveSchema, {
      curve: { id: 'c', kind: { case: 'circle', value: { center: { x: 0, y: 0 }, radius: 3 } } },
      source: 'c',
    });

    expect(offsetCurveFromProto(message)).toEqual({
      kind: 'circle',
      center: [0, 0],
      radius: 3,
      id: 'c',
      source: 'c',
    });
  });
});
