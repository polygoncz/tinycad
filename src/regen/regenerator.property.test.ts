import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FeatureInstance, PartStudioData } from '@/document';
import { aFeature } from '@/document/testing';
import type { DefaultParams } from '@/document/testing';
import type { FeatureBuilder } from './builder';
import type { RegenResult } from './regenerator';
import { bodiesOf } from './state';
import { aRegenSetup, aSchema, aSpyBuilder, validateSize } from './testing';
import type { RegenSetup } from './testing';

// Property-based tests of the Regenerator (spec 07, Testy): regeneration with the cache gives
// the same result as a regeneration from scratch, and mark & sweep leaks no handle.

// Abstract steps with plain integers, applied to the CURRENT studio, so every sequence is valid.
type Step =
  | { readonly k: 'insert'; readonly at: number; readonly size: number; readonly scrap: boolean }
  | { readonly k: 'remove'; readonly i: number }
  | { readonly k: 'setSize'; readonly i: number; readonly size: number }
  | { readonly k: 'suppress'; readonly i: number; readonly on: boolean }
  | { readonly k: 'rollback'; readonly at: number };

const int = fc.nat(1000);
// Sizes 0 and -1 are invalid params (INVALID_PARAMS).
const size = fc.integer({ min: -1, max: 4 });
const step: fc.Arbitrary<Step> = fc.oneof(
  {
    arbitrary: fc.record({ k: fc.constant('insert' as const), at: int, size, scrap: fc.boolean() }),
    weight: 3,
  },
  { arbitrary: fc.record({ k: fc.constant('remove' as const), i: int }), weight: 1 },
  { arbitrary: fc.record({ k: fc.constant('setSize' as const), i: int, size }), weight: 2 },
  {
    arbitrary: fc.record({ k: fc.constant('suppress' as const), i: int, on: fc.boolean() }),
    weight: 1,
  },
  { arbitrary: fc.record({ k: fc.constant('rollback' as const), at: int }), weight: 1 },
);

/** Type 'scrap': creates an intermediate box, then fails as an expected feature error. */
const buildScrap: FeatureBuilder['build'] = async (_, { kernel }) => {
  await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
  return { ok: false, error: { code: 'KERNEL', message: 'scrap' } };
};

function aSetup(): RegenSetup {
  const setup = aRegenSetup();
  setup.schemas.register(aSchema('scrap', validateSize));
  setup.builders.register(aSpyBuilder('scrap', buildScrap));
  return setup;
}

/** The studio after one step; the rollback bar moves with inserts and removals in front of it. */
function apply(studio: PartStudioData, s: Step, nextId: () => string): PartStudioData {
  const { features, rollbackIndex } = studio;
  const len = features.length;
  if (s.k === 'insert') {
    const at = s.at % (len + 1);
    const feature = aFeature({
      id: nextId(),
      type: s.scrap ? 'scrap' : 'box',
      params: { size: s.size },
    });
    return {
      features: features.toSpliced(at, 0, feature),
      rollbackIndex: at <= rollbackIndex ? rollbackIndex + 1 : rollbackIndex,
    };
  }
  if (s.k === 'rollback') return { features, rollbackIndex: s.at % (len + 1) };
  if (len === 0) return studio;
  const i = s.i % len;
  const feature = features[i];
  if (feature === undefined) return studio;
  switch (s.k) {
    case 'remove':
      return {
        features: features.toSpliced(i, 1),
        rollbackIndex: i < rollbackIndex ? rollbackIndex - 1 : rollbackIndex,
      };
    case 'setSize':
      return {
        features: features.with(i, { ...feature, params: { size: s.size } }),
        rollbackIndex,
      };
    case 'suppress':
      return { features: features.with(i, { ...feature, suppressed: s.on }), rollbackIndex };
  }
}

/** Cache model of spec 07 (Cache podle identity, step 5): the features it holds after a run. */
function cachedAfter(
  cached: readonly FeatureInstance[],
  studio: PartStudioData,
): readonly FeatureInstance[] {
  const { features, rollbackIndex } = studio;
  let k = 0;
  while (k < features.length && features[k] === cached[k]) k++;
  return k >= rollbackIndex ? cached.slice(0, k) : features.slice(0, rollbackIndex);
}

/** Number of live handles of the cache: one body per valid, unsuppressed box feature. */
function liveHandlesOf(cached: readonly FeatureInstance[]): number {
  return cached.filter((f) => {
    // Every feature of this test has DefaultParams.
    const { size } = f.params as DefaultParams;
    return f.type === 'box' && !f.suppressed && size > 0;
  }).length;
}

async function runOk(setup: RegenSetup, studio: PartStudioData): Promise<RegenResult> {
  const r = await setup.regenerator.run(studio);
  if (r === 'superseded') expect.fail('Unexpected superseded run');
  return r;
}

/** Body ids with their bounding boxes, read through the kernel that owns the handles. */
async function bodySummary(setup: RegenSetup, r: RegenResult) {
  return Promise.all(
    bodiesOf(r.finalState).map(async (b) => ({
      id: b.id,
      origin: b.origin,
      lastModifiedBy: b.lastModifiedBy,
      box: await setup.kernel.boundingBox(b.shape),
    })),
  );
}

describe('Regenerator (property)', () => {
  it('with the cache gives the same bodies and statuses as from scratch, and leaks no handle', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 25 }), async (steps) => {
        const cachedSetup = aSetup();
        let studio: PartStudioData = { features: [], rollbackIndex: 0 };
        let cached: readonly FeatureInstance[] = [];
        let n = 0;
        const nextId = () => `p${String(++n)}`;

        for (const s of steps) {
          studio = apply(studio, s, nextId);
          const withCache = await runOk(cachedSetup, studio);
          const scratchSetup = aSetup();
          const fromScratch = await runOk(scratchSetup, studio);

          expect([...withCache.statuses]).toEqual([...fromScratch.statuses]);
          expect(await bodySummary(cachedSetup, withCache)).toEqual(
            await bodySummary(scratchSetup, fromScratch),
          );

          cached = cachedAfter(cached, studio);
          expect(await cachedSetup.kernel.liveHandleCount()).toBe(liveHandlesOf(cached));
        }
      }),
      { numRuns: 300 },
    );
  });
});
