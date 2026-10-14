import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import type { HandleView } from '@/interaction';
import {
  HANDLE_ARROW_PX,
  HANDLE_RING_PX,
  HANDLE_RING_SEGMENTS,
  handleBounds,
  pickHandle,
  projectHandles,
  ringHidden,
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
  return { kind: 'linear', id, position, direction, tint: 'x', state: 'idle' };
}

function ring(id: string, axis: Vec3 = [0, 0, 1], center: Vec3 = [0, 0, 0]): HandleView {
  return { kind: 'angular', id, center, axis, tint: 'z', state: 'idle' };
}

function only(handles: readonly ScreenHandle[]): ScreenHandle {
  expect(handles).toHaveLength(1);
  const [handle] = handles;
  if (handle === undefined) throw new Error('no handle');
  return handle;
}

describe('projectHandles', () => {
  it('projects an arrow of HANDLE_ARROW_PX px along its direction', () => {
    const handle = only(projectHandles([arrow('tx', [1, 0, 0], [5, 5, 0])], project, 1 / K, VIEW));
    expect(handle.kind).toBe('linear');
    if (handle.kind !== 'linear') return;
    expect(handle.id).toBe('tx');
    expect(handle.from[0]).toBeCloseTo(10);
    expect(handle.from[1]).toBeCloseTo(-10);
    expect(handle.to[0]).toBeCloseTo(10 + HANDLE_ARROW_PX);
    expect(handle.to[1]).toBeCloseTo(-10);
  });

  it('keeps the screen direction of a slanted arrow and its length when it lies in the view plane', () => {
    const s = Math.SQRT1_2;
    const handle = only(projectHandles([arrow('a', [s, s, 0])], project, 1 / K, VIEW));
    if (handle.kind !== 'linear') throw new Error('not linear');
    const dx = handle.to[0] - handle.from[0];
    const dy = handle.to[1] - handle.from[1];
    expect(Math.hypot(dx, dy)).toBeCloseTo(HANDLE_ARROW_PX);
    // Up in the world is up on the screen (−y).
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeLessThan(0);
  });

  it('scales the arrow by worldPerPx, so a zoom does not change its pixel length', () => {
    const zoomed = (p: Vec3): ScreenPoint => [p[0] * 10, -p[1] * 10];
    const handle = only(projectHandles([arrow('a', [0, 1, 0])], zoomed, 1 / 10, VIEW));
    if (handle.kind !== 'linear') throw new Error('not linear');
    expect(handle.to[1] - handle.from[1]).toBeCloseTo(-HANDLE_ARROW_PX);
  });

  it('normalizes the direction of the arrow', () => {
    const handle = only(projectHandles([arrow('a', [3, 0, 0])], project, 1 / K, VIEW));
    if (handle.kind !== 'linear') throw new Error('not linear');
    expect(handle.to[0] - handle.from[0]).toBeCloseTo(HANDLE_ARROW_PX);
  });

  it('projects a ring as HANDLE_RING_SEGMENTS points HANDLE_RING_PX px around its center', () => {
    const handle = only(projectHandles([ring('rz', [0, 0, 1], [1, 2, 3])], project, 1 / K, VIEW));
    expect(handle.kind).toBe('angular');
    if (handle.kind !== 'angular') return;
    expect(handle.id).toBe('rz');
    expect(handle.points).toHaveLength(HANDLE_RING_SEGMENTS);
    expect(HANDLE_RING_SEGMENTS).toBe(64);
    for (const [x, y] of handle.points) {
      expect(Math.hypot(x - 2, y + 4)).toBeCloseTo(HANDLE_RING_PX);
    }
  });

  it('puts the ring into the plane perpendicular to its axis', () => {
    // Axis X projected down −Z: a vertical line through the center. The view direction passed
    // in is slanted, so the ring is not hidden as edge-on (hiding does not drive the projection).
    const handle = only(projectHandles([ring('rx', [1, 0, 0])], project, 1 / K, [-1, 0, -1]));
    if (handle.kind !== 'angular') throw new Error('not angular');
    for (const [x] of handle.points) expect(x).toBeCloseTo(0);
    const ys = handle.points.map(([, y]) => y);
    expect(Math.max(...ys)).toBeCloseTo(HANDLE_RING_PX);
    expect(Math.min(...ys)).toBeCloseTo(-HANDLE_RING_PX);
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

  it('leaves out a ring seen nearly edge-on', () => {
    // |axis · view| = 0.04 < HANDLE_RING_HIDE_COS: hidden; 0.06: shown.
    const hidden = ring('hidden', [Math.sqrt(1 - 0.04 ** 2), 0, 0.04]);
    const shown = ring('shown', [Math.sqrt(1 - 0.06 ** 2), 0, -0.06]);
    const handles = projectHandles([hidden, shown], project, 1 / K, VIEW);
    expect(handles.map((h) => h.id)).toEqual(['shown']);
  });

  it('keeps the order of the input', () => {
    const handles = projectHandles(
      [ring('r'), arrow('a', [1, 0, 0]), ring('q', [0, 0.6, 0.8])],
      project,
      1 / K,
      VIEW,
    );
    expect(handles.map((h) => h.id)).toEqual(['r', 'a', 'q']);
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

describe('handleBounds', () => {
  it('returns null without handles', () => {
    expect(handleBounds([], 1)).toBeNull();
  });

  it('grows the anchor point of each glyph by its size in the world', () => {
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
    points: Array.from({ length: HANDLE_RING_SEGMENTS }, (_, i): ScreenPoint => {
      const a = (2 * Math.PI * i) / HANDLE_RING_SEGMENTS;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
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
    const r = circle('rz', 0, 0, 60);
    expect(pickHandle([r], 65.5, 0)).toBe('rz');
    expect(pickHandle([r], 0, -54.5)).toBe('rz');
    expect(pickHandle([r], 67, 0)).toBeNull();
    // Inside the ring is not on it.
    expect(pickHandle([r], 0, 0)).toBeNull();
  });

  it('closes the ring polyline (last point back to the first)', () => {
    // A square "ring" of 4 points; the closing edge runs from (0, 10) to (0, 0).
    const square: ScreenHandle = {
      kind: 'angular',
      id: 'sq',
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    };
    expect(pickHandle([square], -2, 5)).toBe('sq');
  });

  it('picks the nearer of two candidates', () => {
    const ty: ScreenHandle = { kind: 'linear', id: 'ty', from: [100, 104], to: [180, 104] };
    expect(pickHandle([tx, ty], 140, 103)).toBe('ty');
    expect(pickHandle([tx, ty], 140, 101)).toBe('tx');
  });

  it('picks the earlier handle on a tie', () => {
    const twin: ScreenHandle = { kind: 'linear', id: 'twin', from: [100, 100], to: [180, 100] };
    expect(pickHandle([tx, twin], 140, 103)).toBe('tx');
    expect(pickHandle([twin, tx], 140, 103)).toBe('twin');
  });

  it('skips points that are not on screen (NaN)', () => {
    const lost: ScreenHandle = { kind: 'linear', id: 'lost', from: [NaN, NaN], to: [NaN, NaN] };
    expect(pickHandle([lost, tx], 140, 100)).toBe('tx');
  });
});
