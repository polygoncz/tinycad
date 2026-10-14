import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import type { HandleView } from '@/interaction';
import {
  HANDLE_ARROW_PX,
  HANDLE_ARROW_START_PX,
  HANDLE_POINT_PX,
  HANDLE_QUARTER_SEGMENTS,
  HANDLE_RING_PX,
  HANDLE_RING_SEGMENTS,
  HANDLE_SQUARE_FAR_PX,
  HANDLE_SQUARE_NEAR_PX,
  handleBounds,
  pickHandle,
  projectHandles,
  ringHidden,
  squareHidden,
  type ScreenHandle,
  type ScreenPoint,
} from './manipulator-pick';

/** px per world unit of the test projection. */
const K = 2;
/** A simple screen projection: x right, y down, K px per mm. */
const project = (p: Vec3): ScreenPoint => [p[0] * K, -p[1] * K];
/** Looking down −Z, so the projection drops z. */
const VIEW: Vec3 = [0, 0, -1];

function arrow(id: string, direction: Vec3, position: Vec3 = [0, 0, 0]): HandleView {
  return { kind: 'linear', id, position, direction, tint: 'x', state: 'idle', dashed: false };
}

function ring(
  id: string,
  axis: Vec3 = [0, 0, 1],
  center: Vec3 = [0, 0, 0],
  zero: Vec3 = [1, 0, 0],
  extent: 'quarter' | 'full' = 'full',
): HandleView {
  return {
    kind: 'angular',
    id,
    center,
    axis,
    zero,
    extent,
    tint: 'z',
    state: 'idle',
    dashed: false,
  };
}

function square(id: string, u: Vec3, v: Vec3, origin: Vec3 = [0, 0, 0]): HandleView {
  return { kind: 'planar', id, origin, u, v, tint: 'z', state: 'idle', dashed: false };
}

function dot(id: string, position: Vec3 = [0, 0, 0]): HandleView {
  return { kind: 'point', id, position, tint: 'neutral', state: 'idle', dashed: false };
}

function only(handles: readonly ScreenHandle[]): ScreenHandle {
  expect(handles).toHaveLength(1);
  const [handle] = handles;
  if (handle === undefined) throw new Error('no handle');
  return handle;
}

function expectPoint(actual: ScreenPoint | undefined, x: number, y: number): void {
  expect(actual?.[0]).toBeCloseTo(x);
  expect(actual?.[1]).toBeCloseTo(y);
}

describe('projectHandles', () => {
  it('projects an arrow as the segment from 14 px to its tip at 98 px along its direction', () => {
    expect(HANDLE_ARROW_START_PX).toBe(14);
    expect(HANDLE_ARROW_PX).toBe(98);
    const handle = only(projectHandles([arrow('tx', [1, 0, 0], [5, 5, 0])], project, 1 / K, VIEW));
    expect(handle.kind).toBe('linear');
    if (handle.kind !== 'linear') return;
    expect(handle.id).toBe('tx');
    expectPoint(handle.from, 10 + 14, -10);
    expectPoint(handle.to, 10 + 98, -10);
  });

  it('keeps the screen direction of a slanted arrow and its length when it lies in the view plane', () => {
    const s = Math.SQRT1_2;
    const handle = only(projectHandles([arrow('a', [s, s, 0])], project, 1 / K, VIEW));
    if (handle.kind !== 'linear') throw new Error('not linear');
    const dx = handle.to[0] - handle.from[0];
    const dy = handle.to[1] - handle.from[1];
    expect(Math.hypot(dx, dy)).toBeCloseTo(HANDLE_ARROW_PX - HANDLE_ARROW_START_PX);
    // Up in the world is up on the screen (−y).
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeLessThan(0);
  });

  it('scales the arrow by worldPerPx, so a zoom does not change its pixel length', () => {
    const zoomed = (p: Vec3): ScreenPoint => [p[0] * 10, -p[1] * 10];
    const handle = only(projectHandles([arrow('a', [0, 1, 0])], zoomed, 1 / 10, VIEW));
    if (handle.kind !== 'linear') throw new Error('not linear');
    expect(handle.from[1]).toBeCloseTo(-HANDLE_ARROW_START_PX);
    expect(handle.to[1]).toBeCloseTo(-HANDLE_ARROW_PX);
  });

  it('normalizes the direction of the arrow', () => {
    const handle = only(projectHandles([arrow('a', [3, 0, 0])], project, 1 / K, VIEW));
    if (handle.kind !== 'linear') throw new Error('not linear');
    expect(handle.to[0]).toBeCloseTo(HANDLE_ARROW_PX);
  });

  it('projects a quarter as 16 segments of radius 72 px from zero to axis × zero', () => {
    expect(HANDLE_RING_PX).toBe(72);
    expect(HANDLE_QUARTER_SEGMENTS).toBe(16);
    const handle = only(
      projectHandles(
        [ring('rz', [0, 0, 1], [1, 2, 3], [1, 0, 0], 'quarter')],
        project,
        1 / K,
        VIEW,
      ),
    );
    if (handle.kind !== 'angular') throw new Error('not angular');
    expect(handle.closed).toBe(false);
    // 16 segments of an open polyline = 17 points.
    expect(handle.points).toHaveLength(17);
    for (const [x, y] of handle.points) expect(Math.hypot(x - 2, y + 4)).toBeCloseTo(72);
    // From zero (+X, right on the screen) to Z × X = +Y (up on the screen).
    expectPoint(handle.points[0], 2 + 72, -4);
    expectPoint(handle.points[16], 2, -4 - 72);
    // Half way: zero turned by 45° about the axis.
    expectPoint(handle.points[8], 2 + 72 * Math.SQRT1_2, -4 - 72 * Math.SQRT1_2);
  });

  it('turns the quarter with zero and the sense of the axis', () => {
    // Axis −Z, zero +Y: from up on the screen to (−Z) × Y = +X, right on the screen.
    const handle = only(
      projectHandles(
        [ring('r', [0, 0, -1], [0, 0, 0], [0, 1, 0], 'quarter')],
        project,
        1 / K,
        VIEW,
      ),
    );
    if (handle.kind !== 'angular') throw new Error('not angular');
    expectPoint(handle.points[0], 0, -72);
    expectPoint(handle.points.at(-1), 72, 0);
  });

  it('projects a full ring as 64 points of a closed polyline starting at zero', () => {
    expect(HANDLE_RING_SEGMENTS).toBe(64);
    const handle = only(
      projectHandles([ring('rz', [0, 0, 1], [1, 2, 3], [0, 1, 0])], project, 1 / K, VIEW),
    );
    if (handle.kind !== 'angular') throw new Error('not angular');
    expect(handle.id).toBe('rz');
    expect(handle.closed).toBe(true);
    expect(handle.points).toHaveLength(64);
    for (const [x, y] of handle.points) expect(Math.hypot(x - 2, y + 4)).toBeCloseTo(72);
    expectPoint(handle.points[0], 2, -4 - 72);
  });

  it('puts the ring into the plane perpendicular to its axis', () => {
    // Axis X projected down −Z: a vertical line through the center. The view direction passed
    // in is slanted, so the ring is not hidden as edge-on (hiding does not drive the projection).
    const handle = only(
      projectHandles([ring('rx', [1, 0, 0], [0, 0, 0], [0, 1, 0])], project, 1 / K, [-1, 0, -1]),
    );
    if (handle.kind !== 'angular') throw new Error('not angular');
    for (const [x] of handle.points) expect(x).toBeCloseTo(0);
    const ys = handle.points.map(([, y]) => y);
    expect(Math.max(...ys)).toBeCloseTo(HANDLE_RING_PX);
    expect(Math.min(...ys)).toBeCloseTo(-HANDLE_RING_PX);
  });

  it('projects a square as its 4 corners from 26 to 46 px along u and v', () => {
    expect(HANDLE_SQUARE_NEAR_PX).toBe(26);
    expect(HANDLE_SQUARE_FAR_PX).toBe(46);
    const handle = only(
      projectHandles([square('txy', [1, 0, 0], [0, 1, 0], [5, 5, 0])], project, 1 / K, VIEW),
    );
    if (handle.kind !== 'planar') throw new Error('not planar');
    expect(handle.id).toBe('txy');
    const [a, b, c, d] = handle.corners;
    expectPoint(a, 10 + 26, -10 - 26);
    expectPoint(b, 10 + 46, -10 - 26);
    expectPoint(c, 10 + 46, -10 - 46);
    expectPoint(d, 10 + 26, -10 - 46);
  });

  it('normalizes u and v of the square', () => {
    const handle = only(projectHandles([square('s', [2, 0, 0], [0, 3, 0])], project, 1 / K, VIEW));
    if (handle.kind !== 'planar') throw new Error('not planar');
    expectPoint(handle.corners[2], 46, -46);
  });

  it('projects a point as its center and the radius 9 px', () => {
    expect(HANDLE_POINT_PX).toBe(9);
    const handle = only(projectHandles([dot('tc', [5, -5, 7])], project, 1 / K, VIEW));
    expect(handle).toEqual({ kind: 'point', id: 'tc', center: [10, 10], radius: 9 });
  });

  it('leaves out an arrow nearly parallel to the view direction', () => {
    const handles = projectHandles(
      [arrow('tz', [0, 0, 1]), arrow('down', [0.1, 0, -0.995]), arrow('tx', [1, 0, 0])],
      project,
      1 / K,
      VIEW,
    );
    expect(handles.map((h) => h.id)).toEqual(['tx']);
  });

  it('keeps an arrow just below the hide limit', () => {
    // cos = 0.97 < HANDLE_HIDE_COS.
    const handles = projectHandles(
      [arrow('a', [Math.sqrt(1 - 0.97 ** 2), 0, 0.97])],
      project,
      1 / K,
      VIEW,
    );
    expect(handles).toHaveLength(1);
  });

  it('keeps a ring seen face-on', () => {
    expect(projectHandles([ring('rz', [0, 0, 1])], project, 1 / K, VIEW)).toHaveLength(1);
  });

  it('leaves out a ring or a quarter seen nearly edge-on', () => {
    // |axis · view| = 0.04 < HANDLE_RING_HIDE_COS: hidden; 0.06: shown.
    const hidden = ring('hidden', [Math.sqrt(1 - 0.04 ** 2), 0, 0.04], [0, 0, 0], [0, 1, 0]);
    const quarter = ring('quarter', [1, 0, 0], [0, 0, 0], [0, 1, 0], 'quarter');
    const shown = ring('shown', [Math.sqrt(1 - 0.06 ** 2), 0, -0.06], [0, 0, 0], [0, 1, 0]);
    const handles = projectHandles([hidden, quarter, shown], project, 1 / K, VIEW);
    expect(handles.map((h) => h.id)).toEqual(['shown']);
  });

  it('leaves out a square seen edge-on', () => {
    // u × v = −Y is perpendicular to the view −Z: the square is a line.
    const edgeOn = square('xz', [1, 0, 0], [0, 0, 1]);
    // |n · view| = 0.04: hidden; 0.06: shown.
    const nearly = square('nearly', [1, 0, 0], [0, 0.04, Math.sqrt(1 - 0.04 ** 2)]);
    const shown = square('shown', [1, 0, 0], [0, 0.06, Math.sqrt(1 - 0.06 ** 2)]);
    const handles = projectHandles([edgeOn, nearly, shown], project, 1 / K, VIEW);
    expect(handles.map((h) => h.id)).toEqual(['shown']);
  });

  it('never leaves out a point', () => {
    expect(projectHandles([dot('tc')], project, 1 / K, [1, 0, 0])).toHaveLength(1);
  });

  it('keeps the order of the input', () => {
    const handles = projectHandles(
      [ring('r'), dot('c'), arrow('a', [1, 0, 0]), square('s', [1, 0, 0], [0, 1, 0])],
      project,
      1 / K,
      VIEW,
    );
    expect(handles.map((h) => h.id)).toEqual(['r', 'c', 'a', 's']);
  });
});

describe('ringHidden', () => {
  it('hides a ring whose axis is nearly perpendicular to the view, whatever the lengths', () => {
    expect(ringHidden([1, 0, 0], VIEW)).toBe(true);
    expect(ringHidden([Math.sqrt(1 - 0.04 ** 2) * 3, 0, 0.04 * 3], [0, 0, -5])).toBe(true);
    expect(ringHidden([Math.sqrt(1 - 0.06 ** 2), 0, 0.06], VIEW)).toBe(false);
    expect(ringHidden([0, 0, 1], VIEW)).toBe(false);
  });
});

describe('squareHidden', () => {
  it('hides a square whose normal u × v is nearly perpendicular to the view, whatever the lengths', () => {
    expect(squareHidden([1, 0, 0], [0, 0, 1], VIEW)).toBe(true);
    expect(squareHidden([2, 0, 0], [0, 3, 0], [0, 0, 5])).toBe(false);
    expect(squareHidden([1, 0, 0], [0, 0.04, Math.sqrt(1 - 0.04 ** 2)], VIEW)).toBe(true);
  });
});

describe('handleBounds', () => {
  it('returns null without handles', () => {
    expect(handleBounds([], 1)).toBeNull();
  });

  it('grows the anchor point of an arrow or a ring by its size in the world', () => {
    const bounds = handleBounds(
      [arrow('tx', [1, 0, 0], [10, 0, 0]), ring('rz', [0, 0, 1], [0, 20, -5])],
      0.5,
    );
    const a = HANDLE_ARROW_PX * 0.5;
    const r = HANDLE_RING_PX * 0.5;
    expect(bounds).toEqual({
      min: [Math.min(10 - a, -r), Math.min(-a, 20 - r), Math.min(-a, -5 - r)],
      max: [Math.max(10 + a, r), Math.max(a, 20 + r), Math.max(a, -5 + r)],
    });
  });

  it('encloses the corners of a square', () => {
    const bounds = handleBounds([square('s', [1, 0, 0], [0, 0, 1], [10, 0, 0])], 0.5);
    expect(bounds).toEqual({ min: [10 + 13, 0, 13], max: [10 + 23, 0, 23] });
  });

  it('grows a point by its radius', () => {
    const bounds = handleBounds([dot('c', [1, 2, 3])], 2);
    expect(bounds).toEqual({ min: [1 - 18, 2 - 18, 3 - 18], max: [1 + 18, 2 + 18, 3 + 18] });
  });

  it('includes hidden handles too (cheap, and they reappear with the next frame)', () => {
    const bounds = handleBounds([arrow('tz', [0, 0, 1], [0, 0, 7])], 1);
    expect(bounds?.max[2]).toBe(7 + HANDLE_ARROW_PX);
  });
});

describe('pickHandle', () => {
  const tx: ScreenHandle = { kind: 'linear', id: 'tx', from: [100, 100], to: [180, 100] };
  const circle = (id: string, cx: number, cy: number, r: number): ScreenHandle => ({
    kind: 'angular',
    id,
    closed: true,
    points: Array.from({ length: HANDLE_RING_SEGMENTS }, (_, i): ScreenPoint => {
      const a = (2 * Math.PI * i) / HANDLE_RING_SEGMENTS;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
  });
  const box = (id: string, x0: number, y0: number, x1: number, y1: number): ScreenHandle => ({
    kind: 'planar',
    id,
    corners: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  });
  const disc = (id: string, x: number, y: number): ScreenHandle => ({
    kind: 'point',
    id,
    center: [x, y],
    radius: HANDLE_POINT_PX,
  });

  it('returns null without handles', () => {
    expect(pickHandle([], 0, 0)).toBeNull();
  });

  it('hits an arrow within 8 px and misses it beyond', () => {
    expect(pickHandle([tx], 140, 107.5)).toBe('tx');
    expect(pickHandle([tx], 186, 100)).toBe('tx');
    expect(pickHandle([tx], 140, 108.5)).toBeNull();
    expect(pickHandle([tx], 189, 100)).toBeNull();
  });

  it('hits a ring within 6 px of its polyline and misses it beyond', () => {
    const r = circle('rz', 0, 0, 72);
    expect(pickHandle([r], 77.5, 0)).toBe('rz');
    expect(pickHandle([r], 0, -66.5)).toBe('rz');
    expect(pickHandle([r], 79, 0)).toBeNull();
    // Inside the ring is not on it.
    expect(pickHandle([r], 0, 0)).toBeNull();
  });

  it('closes a full ring polyline (last point back to the first), not a quarter', () => {
    const points: readonly ScreenPoint[] = [
      [0, 0],
      [30, 0],
      [30, 30],
      [0, 30],
    ];
    // The closing edge runs from (0, 30) to (0, 0).
    expect(pickHandle([{ kind: 'angular', id: 'sq', closed: true, points }], -2, 15)).toBe('sq');
    expect(pickHandle([{ kind: 'angular', id: 'q', closed: false, points }], -2, 15)).toBeNull();
  });

  it('hits a square inside its corners and misses it outside', () => {
    const s = box('txy', 126, 74, 146, 54);
    expect(pickHandle([s], 136, 64)).toBe('txy');
    expect(pickHandle([s], 147, 64)).toBeNull();
    expect(pickHandle([s], 136, 75)).toBeNull();
  });

  it('hits a slanted square inside, whatever the winding of its corners', () => {
    const corners: readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] = [
      [0, 0],
      [10, 5],
      [5, 15],
      [-5, 10],
    ];
    const reversed: readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] = [
      corners[3],
      corners[2],
      corners[1],
      corners[0],
    ];
    expect(pickHandle([{ kind: 'planar', id: 'a', corners }], 2, 7)).toBe('a');
    expect(pickHandle([{ kind: 'planar', id: 'b', corners: reversed }], 2, 7)).toBe('b');
    expect(pickHandle([{ kind: 'planar', id: 'a', corners }], 9, 1)).toBeNull();
  });

  it('hits a point within 10 px and misses it beyond', () => {
    const c = disc('tc', 100, 100);
    expect(pickHandle([c], 107, 107)).toBe('tc');
    expect(pickHandle([c], 110, 100)).toBe('tc');
    expect(pickHandle([c], 108, 108)).toBeNull();
  });

  it('gives the point priority over a nearer line and a square around it', () => {
    // The arrow passes 1 px away, the point is 9 px away and still within its tolerance.
    const through: ScreenHandle = { kind: 'linear', id: 'a', from: [90, 101], to: [200, 101] };
    const around = box('s', 80, 80, 120, 120);
    expect(pickHandle([through, around, disc('tc', 100, 92)], 100, 100)).toBe('tc');
  });

  it('gives a square priority over a nearer line when the point is inside it', () => {
    const through: ScreenHandle = { kind: 'linear', id: 'a', from: [120, 136], to: [160, 136] };
    expect(pickHandle([through, box('s', 126, 74, 146, 54)], 136, 138)).toBe('a');
    expect(pickHandle([through, box('s', 126, 140, 146, 120)], 136, 136)).toBe('s');
  });

  it('gives the earlier of two squares the hit, and the nearer of two points', () => {
    expect(pickHandle([box('a', 0, 0, 20, 20), box('b', 10, 10, 30, 30)], 15, 15)).toBe('a');
    expect(pickHandle([disc('a', 0, 0), disc('b', 4, 0)], 3, 0)).toBe('b');
    expect(pickHandle([disc('a', 0, 0), disc('b', 4, 0)], 2, 0)).toBe('a');
  });

  it('picks the nearer of two lines', () => {
    const ty: ScreenHandle = { kind: 'linear', id: 'ty', from: [100, 104], to: [180, 104] };
    expect(pickHandle([tx, ty], 140, 103)).toBe('ty');
    expect(pickHandle([tx, ty], 140, 101)).toBe('tx');
  });

  it('picks the earlier handle on a tie', () => {
    const twin: ScreenHandle = { kind: 'linear', id: 'twin', from: [100, 100], to: [180, 100] };
    expect(pickHandle([tx, twin], 140, 103)).toBe('tx');
    expect(pickHandle([twin, tx], 140, 103)).toBe('twin');
  });

  it('skips handles that are not on screen (NaN)', () => {
    const lost: ScreenHandle = { kind: 'linear', id: 'lost', from: [NaN, NaN], to: [NaN, NaN] };
    const lostDot = disc('lostDot', NaN, NaN);
    const lostBox = box('lostBox', NaN, NaN, NaN, NaN);
    expect(pickHandle([lostDot, lostBox, lost, tx], 140, 100)).toBe('tx');
  });
});
