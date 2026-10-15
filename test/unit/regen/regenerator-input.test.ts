import { describe, expect, it } from 'vitest';
import type { FeatureId, FeatureInstance } from '@/document';
import type { DefaultParams } from '@/document/testing';
import { EMPTY_STATE, bodiesOf } from '@/regen/state';
import { aRegenSetup, aStudio, features, resized, result } from '@/regen/testing';

// The input of the edited feature in RegenResult (ADR 0025, point 1; spec 07, RegenResult.input).

// Feature ids are created by a cast in tests only.
const fid = (s: string): FeatureId => s as FeatureId;

function threeFeatures(): [
  FeatureInstance<DefaultParams>,
  FeatureInstance<DefaultParams>,
  FeatureInstance<DefaultParams>,
] {
  return features(3) as [
    FeatureInstance<DefaultParams>,
    FeatureInstance<DefaultParams>,
    FeatureInstance<DefaultParams>,
  ];
}

describe('Regenerator.run – input of a feature', () => {
  it('is the state after the previous feature for a feature in the middle (same object)', async () => {
    const { regenerator, box } = aRegenSetup();
    const list = threeFeatures();
    const r = result(await regenerator.run(aStudio(list), { inputOf: fid('f2') }));
    // The builder of f2 got the state after f1 as its input.
    const f2Input = box.calls[1]?.state;
    expect(r.input?.feature).toBe('f2');
    expect(r.input?.state).toBe(f2Input);
    expect(bodiesOf(r.input?.state ?? EMPTY_STATE).map((b) => b.id)).toEqual(['f1/body']);
  });

  it('is EMPTY_STATE for the first feature', async () => {
    const { regenerator } = aRegenSetup();
    const r = result(await regenerator.run(aStudio(threeFeatures()), { inputOf: fid('f1') }));
    expect(r.input).toEqual({ feature: 'f1', state: EMPTY_STATE });
    expect(r.input?.state).toBe(EMPTY_STATE);
  });

  it('is the input of the feature right in front of the rollback bar', async () => {
    const { regenerator, box } = aRegenSetup();
    const r = result(await regenerator.run(aStudio(threeFeatures(), 2), { inputOf: fid('f2') }));
    expect(r.input?.state).toBe(box.calls[1]?.state);
  });

  it('exists for a suppressed feature and for a feature in error', async () => {
    const { regenerator, box } = aRegenSetup();
    const [f1, f2, f3] = threeFeatures();
    const studio = aStudio([f1, { ...f2, suppressed: true }, { ...f3, params: { size: -1 } }]);
    const r2 = result(await regenerator.run(studio, { inputOf: fid('f2') }));
    expect(r2.statuses.get(fid('f2'))).toEqual({ kind: 'suppressed' });
    const r3 = result(await regenerator.run(studio, { inputOf: fid('f3') }));
    expect(r3.statuses.get(fid('f3'))?.kind).toBe('error');
    // Only f1 is built; f2 and f3 pass the state after f1 through, so it is the input of both.
    expect(box.builtIds()).toEqual(['f1']);
    expect(r2.input?.state).toBe(r2.finalState);
    expect(r3.input?.state).toBe(r2.finalState);
    expect(bodiesOf(r3.input?.state ?? EMPTY_STATE).map((b) => b.id)).toEqual(['f1/body']);
  });

  it('is null for a feature behind the rollback bar, an unknown feature and without inputOf', async () => {
    const { regenerator } = aRegenSetup();
    const list = threeFeatures();
    const behind = result(await regenerator.run(aStudio(list, 1), { inputOf: fid('f2') }));
    expect(behind.input).toBeNull();
    const unknown = result(await regenerator.run(aStudio(list), { inputOf: fid('nope') }));
    expect(unknown.input).toBeNull();
    const none = result(await regenerator.run(aStudio(list)));
    expect(none.input).toBeNull();
    const empty = result(await regenerator.run(aStudio(list), {}));
    expect(empty.input).toBeNull();
  });

  it('exists for a cached feature (no rebuild)', async () => {
    const { regenerator, box } = aRegenSetup();
    const list = threeFeatures();
    result(await regenerator.run(aStudio(list)));
    const f3Input = box.calls[2]?.state;
    const r = result(await regenerator.run(aStudio(list), { inputOf: fid('f3') }));
    expect(box.calls).toHaveLength(3);
    expect(r.input?.state).toBe(f3Input);
  });

  it('keeps the handles of the input alive after the sweep', async () => {
    const { regenerator, kernel } = aRegenSetup();
    const [f1, f2, f3] = threeFeatures();
    result(await regenerator.run(aStudio([f1, f2, f3])));
    // Editing f3 with the bar right behind it: its old body dies, the input stays.
    const r = result(
      await regenerator.run(aStudio([f1, f2, resized(f3, 2)], 3), { inputOf: fid('f3') }),
    );
    expect(kernel.callCount('release')).toBe(1);
    expect(await kernel.liveHandleCount()).toBe(3);
    const inputHandles = bodiesOf(r.input?.state ?? EMPTY_STATE).map((b) => b.shape);
    expect(inputHandles).toHaveLength(2);
    for (const h of inputHandles) await kernel.boundingBox(h);
  });
});
