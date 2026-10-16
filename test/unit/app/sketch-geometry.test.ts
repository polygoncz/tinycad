import { describe, expect, it } from 'vitest';
import type { GeometryKernel } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import type { Curve2 } from '@/sketch';
import { createSketchGeometry } from '@/app/sketch-geometry';

const H: Curve2 = { kind: 'line', from: [0, 0], to: [2, 0], id: 'h' };
const V: Curve2 = { kind: 'line', from: [1, -1], to: [1, 1], id: 'v' };

describe('createSketchGeometry', () => {
  it('gives the intersections of two lines from the kernel', async () => {
    const kernel = createFakeKernel();
    const geometry = createSketchGeometry(() => kernel);

    const hits = await geometry.intersections([H, V]);

    expect(hits).toHaveLength(1);
    const [hit] = hits;
    expect(hit?.a).toBe('h');
    expect(hit?.b).toBe('v');
    expect(hit?.point[0]).toBeCloseTo(1, 9);
    expect(hit?.point[1]).toBeCloseTo(0, 9);
    expect(hit?.ta).toBeCloseTo(0.5, 9);
    expect(hit?.tb).toBeCloseTo(0.5, 9);
    expect(hit?.overlap).toBeUndefined();
    expect(kernel.callCount('curveIntersections')).toBe(1);
  });

  it('gives an arc as the piece of a circle', async () => {
    const kernel = createFakeKernel();
    const geometry = createSketchGeometry(() => kernel);
    const circle: Curve2 = { kind: 'circle', center: [0, 0], radius: 1, id: 'c' };

    const piece = await geometry.segment(circle, 0, Math.PI / 2);

    expect(piece.kind).toBe('arc');
    expect(piece.id).toBe('c');
    if (piece.kind !== 'arc') return;
    expect(piece.ccw).toBe(true);
    expect(piece.center).toEqual([0, 0]);
    expect(piece.from[0]).toBeCloseTo(1, 9);
    expect(piece.from[1]).toBeCloseTo(0, 9);
    expect(piece.to[0]).toBeCloseTo(0, 9);
    expect(piece.to[1]).toBeCloseTo(1, 9);
    expect(kernel.callCount('curveSegment')).toBe(1);
  });

  it('rejects when the kernel rejects', async () => {
    const kernel = createFakeKernel();
    const geometry = createSketchGeometry(() => kernel);
    kernel.failNext('curveIntersections', 'internal', 'boom');
    kernel.failNext('curveSegment', 'operation-failed', 'bang');

    await expect(geometry.intersections([H, V])).rejects.toThrow('boom');
    await expect(geometry.segment(H, 0, 0.5)).rejects.toThrow('bang');
  });

  it('rejects a curve without an id (an error of the caller)', async () => {
    const geometry = createSketchGeometry(() => createFakeKernel());
    const noId: Curve2 = { kind: 'line', from: [1, -1], to: [1, 1] };

    await expect(geometry.intersections([H, noId])).rejects.toThrow();
  });

  it('rejects an invalid segment', async () => {
    const geometry = createSketchGeometry(() => createFakeKernel());

    await expect(geometry.segment(H, 0.5, 0.2)).rejects.toThrow();
  });

  it('rejects without a running kernel', async () => {
    const geometry = createSketchGeometry(() => null);

    await expect(geometry.intersections([H, V])).rejects.toThrow();
    await expect(geometry.segment(H, 0, 0.5)).rejects.toThrow();
    await expect(geometry.fillet(H, V, 0.1, [1.1, 0.1])).rejects.toThrow();
  });

  it('gives the fillet arc of two lines from the kernel (filletArc)', async () => {
    const kernel = createFakeKernel();
    const geometry = createSketchGeometry(() => kernel);

    const arc = await geometry.fillet(H, V, 0.1, [1.1, 0.1]);

    expect(arc.center[0]).toBeCloseTo(1.1, 9);
    expect(arc.center[1]).toBeCloseTo(0.1, 9);
    expect(arc.pointA[0]).toBeCloseTo(1.1, 9);
    expect(arc.pointA[1]).toBeCloseTo(0, 9);
    expect(arc.pointB[0]).toBeCloseTo(1, 9);
    expect(arc.pointB[1]).toBeCloseTo(0.1, 9);
    expect(arc.ta).toBeCloseTo(0.55, 9);
    expect(arc.tb).toBeCloseTo(0.55, 9);
    expect(kernel.callCount('filletArc')).toBe(1);
  });

  it('rejects a fillet the kernel cannot make', async () => {
    const kernel = createFakeKernel();
    const geometry = createSketchGeometry(() => kernel);
    kernel.failNext('filletArc', 'operation-failed', 'no fillet');

    await expect(geometry.fillet(H, V, 0.1, [1.1, 0.1])).rejects.toThrow('no fillet');
  });

  it('takes the kernel anew on every call (a restarted kernel)', async () => {
    const first = createFakeKernel();
    const second = createFakeKernel();
    let current: GeometryKernel | null = first;
    const geometry = createSketchGeometry(() => current);

    await geometry.intersections([H, V]);
    current = second;
    await geometry.intersections([H, V]);
    await geometry.segment(H, 0, 0.5);

    expect(first.callCount('curveIntersections')).toBe(1);
    expect(second.callCount('curveIntersections')).toBe(1);
    expect(first.callCount('curveSegment')).toBe(0);
    expect(second.callCount('curveSegment')).toBe(1);
  });
});
