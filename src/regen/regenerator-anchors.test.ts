import { describe, expect, it } from 'vitest';
import type { FeatureId, FeatureInstance } from '@/document';
import { aFeature } from '@/document/testing';
import type { DefaultParams } from '@/document/testing';
import type { FeatureBuilder } from './builder';
import { aRegenSetup, aStudio, buildCube, resized, result } from './testing';

// Anchors of manipulators (spec 07, Kotvy manipulátorů, M18): the Regenerator keeps the anchors
// a builder returned, deeply frozen, in its cache and in RegenResult.anchors.

// Feature ids are created by a cast in tests only.
const fid = (s: string): FeatureId => s as FeatureId;

/** A test feature 'f<n>' of the default type with edge `size`. */
function f(n: number, size = 1): FeatureInstance<DefaultParams> {
  return aFeature({ id: `f${String(n)}`, params: { size } });
}

/** buildCube plus the anchor 'pivot' at [size, 0, 0] pointing along +Z. */
const buildWithAnchors: FeatureBuilder['build'] = async (input, ctx) => {
  const out = await buildCube(input, ctx);
  if (!out.ok) return out;
  // The Regenerator validated the params with aSchema() before calling the builder.
  const { size } = input.feature.params as DefaultParams;
  return { ...out, anchors: { pivot: { point: [size, 0, 0], direction: [0, 0, 1] } } };
};

function setup(build: FeatureBuilder['build'] = buildWithAnchors) {
  const s = aRegenSetup({ build });
  const run = async (list: readonly FeatureInstance[], rollbackIndex?: number) =>
    result(await s.regenerator.run(aStudio(list, rollbackIndex)));
  return { ...s, run };
}

describe('Regenerator anchors', () => {
  it('puts the anchors of a builder under the feature id', async () => {
    const { run } = setup();
    const r = await run([f(1), f(2, 2)]);
    expect([...r.anchors.keys()]).toEqual(['f1', 'f2']);
    expect(r.anchors.get(fid('f1'))).toEqual({ pivot: { point: [1, 0, 0], direction: [0, 0, 1] } });
    expect(r.anchors.get(fid('f2'))?.['pivot']?.point).toEqual([2, 0, 0]);
  });

  it('deeply freezes the anchors', async () => {
    const { run } = setup();
    const r = await run([f(1)]);
    const anchors = r.anchors.get(fid('f1'));
    const pivot = anchors?.['pivot'];
    expect(pivot).toBeDefined();
    expect(Object.isFrozen(anchors)).toBe(true);
    expect(Object.isFrozen(pivot)).toBe(true);
    expect(Object.isFrozen(pivot?.point)).toBe(true);
    expect(Object.isFrozen(pivot?.direction)).toBe(true);
  });

  it('keeps the anchors of a feature taken from the cache', async () => {
    const { run, box } = setup();
    const first = f(1);
    const second = f(2);
    await run([first, second]);
    const r = await run([first, resized(second, 2)]);
    // Only f2 was built again; f1 came from the cache.
    expect(box.builtIds()).toEqual(['f1', 'f2', 'f2']);
    expect(r.anchors.get(fid('f1'))).toEqual({ pivot: { point: [1, 0, 0], direction: [0, 0, 1] } });
    expect(r.anchors.get(fid('f2'))?.['pivot']?.point).toEqual([2, 0, 0]);
  });

  it('keeps the anchors of a feature with a warning', async () => {
    const { run } = setup(async (input, ctx) => {
      ctx.warn('careful');
      return buildWithAnchors(input, ctx);
    });
    const r = await run([f(1)]);
    expect(r.statuses.get(fid('f1'))?.kind).toBe('warning');
    expect(r.anchors.has(fid('f1'))).toBe(true);
  });

  it('leaves out failed, suppressed and rolled back features', async () => {
    const { run } = setup();
    const r = await run([f(1, 0), { ...f(2), suppressed: true }, f(3), f(4)], 3);
    expect(r.statuses.get(fid('f1'))?.kind).toBe('error');
    expect(r.statuses.get(fid('f2'))?.kind).toBe('suppressed');
    expect(r.statuses.get(fid('f4'))?.kind).toBe('rolledBack');
    expect([...r.anchors.keys()]).toEqual(['f3']);
  });

  it('leaves out a feature whose builder returned no anchors', async () => {
    const { run } = setup(buildCube);
    const r = await run([f(1)]);
    expect(r.statuses.get(fid('f1'))?.kind).toBe('ok');
    expect(r.anchors.size).toBe(0);
  });

  it('leaves out a cached feature that moved behind the rollback bar', async () => {
    const { run, box } = setup();
    const list = [f(1), f(2)];
    await run(list);
    const r = await run(list, 1);
    expect(box.builtIds()).toEqual(['f1', 'f2']);
    expect([...r.anchors.keys()]).toEqual(['f1']);
  });

  it('brings the anchors back once a failed feature is fixed', async () => {
    const { run } = setup();
    const broken = f(1, 0);
    const r1 = await run([broken]);
    expect(r1.anchors.size).toBe(0);
    const r2 = await run([resized(broken, 3)]);
    expect(r2.anchors.get(fid('f1'))?.['pivot']?.point).toEqual([3, 0, 0]);
  });
});
