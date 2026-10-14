import { plane } from '@/core';
import type { Vec3 } from '@/core';
import { describe, expect, it } from 'vitest';
import { ORIGIN, ORIGIN_PLANE_IDS, ORIGIN_PLANES } from './origin';
import { parsePlaneId } from './refs';

/** +0 for -0, so that toEqual compares directions by value. */
const plain = (v: Vec3): Vec3 => [v[0] + 0, v[1] + 0, v[2] + 0];

describe('ORIGIN (M12)', () => {
  it("is the reserved owner 'origin'", () => {
    expect(ORIGIN).toBe('origin');
  });
});

describe('ORIGIN_PLANE_IDS (M12)', () => {
  it('names the three planes <origin>/plane:<name>', () => {
    expect(ORIGIN_PLANE_IDS).toEqual({
      xy: 'origin/plane:xy',
      xz: 'origin/plane:xz',
      yz: 'origin/plane:yz',
    });
  });

  it('are valid plane ids', () => {
    for (const id of Object.values(ORIGIN_PLANE_IDS)) expect(parsePlaneId(id)).toBe(id);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ORIGIN_PLANE_IDS)).toBe(true);
  });
});

describe('ORIGIN_PLANES (M12)', () => {
  it('lists xy, xz, yz in this order with their translation keys', () => {
    expect(ORIGIN_PLANES.map((p) => [p.id, p.label])).toEqual([
      [ORIGIN_PLANE_IDS.xy, 'origin.plane.xy'],
      [ORIGIN_PLANE_IDS.xz, 'origin.plane.xz'],
      [ORIGIN_PLANE_IDS.yz, 'origin.plane.yz'],
    ]);
  });

  it('has the frames of the table in spec 12', () => {
    expect(ORIGIN_PLANES.map((p) => p.plane)).toEqual([
      { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] },
      { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] },
      { origin: [0, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] },
    ]);
  });

  it('has orthonormal frames', () => {
    for (const p of ORIGIN_PLANES) expect(plane.isOrthonormal(p.plane)).toBe(true);
  });

  it('has the y axis +Y, +Z, +Z (up is Z on the front and right planes)', () => {
    expect(ORIGIN_PLANES.map((p) => plain(plane.yDir(p.plane)))).toEqual([
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, 1],
    ]);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(ORIGIN_PLANES)).toBe(true);
    for (const p of ORIGIN_PLANES) {
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.plane)).toBe(true);
      expect(Object.isFrozen(p.plane.origin)).toBe(true);
      expect(Object.isFrozen(p.plane.xDir)).toBe(true);
      expect(Object.isFrozen(p.plane.normal)).toBe(true);
    }
  });
});
