import { beforeAll, describe, expect, it } from 'vitest';
import { mat4 } from '@/core';
import type { ShapeHistory, SubShapeIndex } from '@/kernel';
import { loadOcct, type Occt } from './occt';
import { OcctKernelImpl } from './occt-kernel-impl';

// What the OCCT adapter does beyond the contract (spec 06, "Testy", M14): the content of the
// history of a boolean and a transform on real shapes.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

const face = (index: number): SubShapeIndex => ({ type: 'face', index });

/** Where face `index` of input `input` went: 'deleted' or the indices of the modified faces. */
function fate(
  history: ShapeHistory | undefined,
  input: number,
  index: number,
): 'deleted' | readonly number[] {
  if (history?.deleted.some((d) => d.input === input && d.sub.index === index)) return 'deleted';
  const link = history?.modified.find((l) => l.input === input && l.from.index === index);
  return link?.to.map((s) => s.index) ?? [];
}

/** The single face face `index` of input `input` became; fails otherwise. */
function onlyTarget(history: ShapeHistory | undefined, input: number, index: number): number {
  const to = fate(history, input, index);
  if (to === 'deleted' || to.length !== 1) {
    return expect.fail(`face ${String(index)} of input ${String(input)}: ${String(to)}`);
  }
  return to[0] ?? -1;
}

/** The only index of the role. */
function roleIndex(
  roles: Readonly<Record<string, readonly SubShapeIndex[]>> | undefined,
  key: string,
) {
  const subs = roles?.[key] ?? [];
  expect(subs, key).toHaveLength(1);
  return subs[0]?.index ?? -1;
}

describe('OcctKernelImpl history (M14)', () => {
  it('a box minus a cylinder through it: the lateral face from the tool, caps deleted', async () => {
    const kernel = new OcctKernelImpl(oc);
    const box = await kernel.makeBox({ origin: [0, 0, 0], size: [20, 20, 10] });
    const cylinder = await kernel.makeCylinder({
      base: [10, 10, -1],
      axis: [0, 0, 1],
      radius: 3,
      height: 12,
    });
    const cut = await kernel.boolean('subtract', [box.shape], [cylinder.shape]);
    const topology = await kernel.topology(cut.shape);
    expect(topology.faces).toHaveLength(7);

    const hole = onlyTarget(cut.history, 1, roleIndex(cylinder.roles, 'face:side'));
    expect(topology.faces[hole]?.surface).toBe('cylinder');

    const topOut = onlyTarget(cut.history, 0, roleIndex(box.roles, 'face:top'));
    const bottomOut = onlyTarget(cut.history, 0, roleIndex(box.roles, 'face:bottom'));
    expect(topology.faces[topOut]?.plane?.normal[2]).toBeCloseTo(1, 9);
    expect(topology.faces[bottomOut]?.plane?.normal[2]).toBeCloseTo(-1, 9);

    expect(fate(cut.history, 1, roleIndex(cylinder.roles, 'face:top'))).toBe('deleted');
    expect(fate(cut.history, 1, roleIndex(cylinder.roles, 'face:bottom'))).toBe('deleted');

    // The circle where the hole meets the top face is an edge between those two faces.
    const between = [hole, topOut].sort((a, b) => a - b);
    expect(topology.edges.some((e) => e.faces.join() === between.join())).toBe(true);
  });

  it('a transform maps every face onto its moved self, in the same order', async () => {
    const kernel = new OcctKernelImpl(oc);
    const box = await kernel.makeBox({ origin: [0, 0, 0], size: [1, 2, 3] });
    const moved = await kernel.transform(box.shape, mat4.translation([5, 0, 0]));
    expect(moved.history).toEqual({
      modified: [0, 1, 2, 3, 4, 5].map((i) => ({ input: 0, from: face(i), to: [face(i)] })),
      generated: [],
      deleted: [],
    });
  });

  it('an extrude: the side faces are generated from the profile edges', async () => {
    const kernel = new OcctKernelImpl(oc);
    const profile = await kernel.makeFace({
      plane: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] },
      outer: [{ kind: 'circle', center: [0, 0], radius: 1 }],
      holes: [],
    });
    const { history } = await kernel.extrude(profile.shape, [0, 0, 1], 2);
    const fromEdges = history?.generated.filter((l) => l.from.type === 'edge') ?? [];
    expect(fromEdges).toHaveLength(1);
    expect(fromEdges[0]?.to).toHaveLength(1);
  });
});
