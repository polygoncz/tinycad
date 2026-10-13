import { describe, expect, it } from 'vitest';
import type { FeatureInstance, PartStudioData } from '@/document';
import { aFeature } from '@/document/testing';
import { createFakeKernel } from '@/kernel/testing';
import { createBuilderRegistry } from './builder';
import type { FeatureBuilder } from './builder';
import { createRegenerator } from './regenerator';
import type { RegenResult } from './regenerator';
import { EMPTY_STATE } from './state';
import type { FeatureError, FeatureStatus } from './state';
import {
  aRegenSetup,
  aSchema,
  aSpyBuilder,
  aStudio,
  bodyIdOf,
  buildCube,
  features,
  stoppedClock,
} from './testing';
import { createFeatureSchemaRegistry } from '@/document';

const OK: FeatureStatus = { kind: 'ok' };

/** Runs and fails the test when the run was superseded (never in these tests). */
async function regen(
  run: (studio: PartStudioData) => Promise<RegenResult | 'superseded'>,
  studio: PartStudioData,
): Promise<RegenResult> {
  const result = await run(studio);
  if (result === 'superseded') expect.fail('Unexpected superseded run');
  return result;
}

function setup(opts: { now?: () => number } = {}) {
  const s = aRegenSetup(opts);
  return { ...s, run: (studio: PartStudioData) => regen((x) => s.regenerator.run(x), studio) };
}

function bodyIds(result: RegenResult): string[] {
  return [...result.finalState.bodies.keys()];
}

/** Replaces the feature at index i by a copy with the given overrides (new identity). */
function withChanged<T extends FeatureInstance>(
  list: readonly T[],
  i: number,
  overrides: Partial<T>,
): T[] {
  return list.map((f, j) => (j === i ? { ...f, ...overrides } : f));
}

describe('Regenerator.run', () => {
  describe('result', () => {
    it('builds all features in order and returns their bodies and ok statuses', async () => {
      const { run, box } = setup();
      const list = features(3);
      const result = await run(aStudio(list));
      expect(box.builtIds()).toEqual(['f1', 'f2', 'f3']);
      expect(bodyIds(result)).toEqual(['f1/body', 'f2/body', 'f3/body']);
      expect([...result.statuses]).toEqual([
        ['f1', OK],
        ['f2', OK],
        ['f3', OK],
      ]);
    });

    it('gives each builder the output state of the previous feature', async () => {
      const { run, box } = setup();
      await run(aStudio(features(2)));
      expect(box.calls[0]?.state).toBe(EMPTY_STATE);
      expect([...(box.calls[1]?.state.bodies.keys() ?? [])]).toEqual(['f1/body']);
    });

    it('an empty studio gives EMPTY_STATE and no statuses', async () => {
      const { run } = setup();
      const result = await run(aStudio([]));
      expect(result.finalState).toBe(EMPTY_STATE);
      expect(result.statuses.size).toBe(0);
    });

    it('increases the generation with every run', async () => {
      const { run } = setup();
      const studio = aStudio(features(1));
      const first = await run(studio);
      const second = await run(studio);
      expect(second.generation).toBe(first.generation + 1);
    });

    it('measures durationMs with the given clock', async () => {
      const times = [10, 25.5];
      const { run } = setup({ now: () => times.shift() ?? Number.NaN });
      const result = await run(aStudio(features(1)));
      expect(result.durationMs).toBe(15.5);
    });
  });

  describe('cache by identity', () => {
    it('a changed param of feature 3 of 5 rebuilds only 3–5', async () => {
      const { run, box } = setup();
      const list = features(5);
      await run(aStudio(list));
      const changed = withChanged(list, 2, { params: { size: 2 } });
      const result = await run(aStudio(changed));
      expect(box.builtIds().slice(5)).toEqual(['f3', 'f4', 'f5']);
      expect(bodyIds(result)).toEqual(['f1/body', 'f2/body', 'f3/body', 'f4/body', 'f5/body']);
    });

    it('the same studio again builds nothing and returns the same final state', async () => {
      const { run, kernel } = setup();
      const studio = aStudio(features(3));
      const first = await run(studio);
      const calls = kernel.callCount();
      const second = await run(studio);
      expect(kernel.callCount()).toBe(calls);
      expect(second.finalState).toBe(first.finalState);
      expect([...second.statuses]).toEqual([...first.statuses]);
    });

    it('an equal but new feature object is rebuilt (identity, not equality)', async () => {
      const { run, box } = setup();
      const list = features(2);
      await run(aStudio(list));
      await run(aStudio(withChanged(list, 1, {})));
      expect(box.builtIds()).toEqual(['f1', 'f2', 'f2']);
    });

    it('deleting a feature rebuilds from its position on', async () => {
      const { run, box } = setup();
      const list = features(4);
      await run(aStudio(list));
      const result = await run(aStudio(list.filter((f) => f.id !== 'f2')));
      expect(box.builtIds().slice(4)).toEqual(['f3', 'f4']);
      expect(bodyIds(result)).toEqual(['f1/body', 'f3/body', 'f4/body']);
    });

    it('inserting a feature rebuilds from its position on', async () => {
      const { run, box } = setup();
      const list = features(3);
      await run(aStudio(list));
      const inserted = aFeature({ id: 'new' });
      await run(aStudio([list[0], inserted, list[1], list[2]].filter((f) => f !== undefined)));
      expect(box.builtIds().slice(3)).toEqual(['new', 'f2', 'f3']);
    });

    it('builds after a changed feature start from the cached state before it', async () => {
      const { run, box } = setup();
      const list = features(3);
      const first = await run(aStudio(list));
      await run(aStudio(withChanged(list, 1, { params: { size: 2 } })));
      const input = box.calls[3]?.state;
      expect(input?.bodies.get(bodyIdOf(list[0]?.id ?? never()))).toBe(
        first.finalState.bodies.get(bodyIdOf(list[0]?.id ?? never())),
      );
    });
  });

  describe('rollback bar', () => {
    it('features behind the bar are rolledBack, not built, and finalState is at the bar', async () => {
      const { run, box } = setup();
      const result = await run(aStudio(features(4), 2));
      expect(box.builtIds()).toEqual(['f1', 'f2']);
      expect(bodyIds(result)).toEqual(['f1/body', 'f2/body']);
      expect([...result.statuses]).toEqual([
        ['f1', OK],
        ['f2', OK],
        ['f3', { kind: 'rolledBack' }],
        ['f4', { kind: 'rolledBack' }],
      ]);
    });

    it('rollbackIndex 0 gives EMPTY_STATE and builds nothing', async () => {
      const { run, kernel } = setup();
      const result = await run(aStudio(features(2), 0));
      expect(result.finalState).toBe(EMPTY_STATE);
      expect(kernel.callCount()).toBe(0);
    });

    it('moving the bar back calls no kernel, moving it forward again neither', async () => {
      const { run, kernel } = setup();
      const list = features(5);
      const full = await run(aStudio(list));
      const calls = kernel.callCount();

      const back = await run(aStudio(list, 2));
      expect(kernel.callCount()).toBe(calls);
      expect(bodyIds(back)).toEqual(['f1/body', 'f2/body']);
      expect(back.statuses.get(list[4]?.id ?? never())).toEqual({ kind: 'rolledBack' });

      const forward = await run(aStudio(list));
      expect(kernel.callCount()).toBe(calls);
      expect(forward.finalState).toBe(full.finalState);
      expect([...forward.statuses]).toEqual([...full.statuses]);
    });

    it('moving the bar forward builds only the newly included features', async () => {
      const { run, box } = setup();
      const list = features(5);
      await run(aStudio(list, 2));
      const result = await run(aStudio(list, 4));
      expect(box.builtIds()).toEqual(['f1', 'f2', 'f3', 'f4']);
      expect(bodyIds(result)).toEqual(['f1/body', 'f2/body', 'f3/body', 'f4/body']);
    });

    it('a change behind the bar builds nothing and keeps valid entries in front of it', async () => {
      const { run, box } = setup();
      const list = features(4);
      await run(aStudio(list));
      const changed = withChanged(list, 3, { params: { size: 2 } });
      await run(aStudio(changed, 2));
      expect(box.builtIds()).toEqual(['f1', 'f2', 'f3', 'f4']);
      await run(aStudio(changed));
      expect(box.builtIds()).toEqual(['f1', 'f2', 'f3', 'f4', 'f4']);
    });
  });

  describe('statuses', () => {
    it('a failing builder gives error, passes the state through and later features are ok', async () => {
      const { run, builders, schemas } = setup();
      schemas.register(aSchema('broken'));
      builders.register(
        aSpyBuilder('broken', () =>
          Promise.resolve({
            ok: false,
            error: { code: 'UNRESOLVED_REFERENCE', message: 'gone' },
          }),
        ),
      );
      const list = [
        aFeature({ id: 'a' }),
        aFeature({ id: 'b', type: 'broken' }),
        aFeature({ id: 'c' }),
      ];
      const result = await run(aStudio(list));
      expect([...result.statuses]).toEqual([
        ['a', OK],
        ['b', { kind: 'error', error: { code: 'UNRESOLVED_REFERENCE', message: 'gone' } }],
        ['c', OK],
      ]);
      expect(bodyIds(result)).toEqual(['a/body', 'c/body']);
    });

    it('a failing builder as the last feature leaves its input state as the final state', async () => {
      const { run, builders, schemas } = setup();
      schemas.register(aSchema('broken'));
      builders.register(
        aSpyBuilder('broken', () =>
          Promise.resolve({ ok: false, error: { code: 'KERNEL', message: 'x' } }),
        ),
      );
      const a = aFeature({ id: 'a' });
      const first = await run(aStudio([a]));
      const result = await run(aStudio([a, aFeature({ id: 'b', type: 'broken' })]));
      expect(result.finalState).toBe(first.finalState);
    });

    it('invalid params give INVALID_PARAMS with the issues joined by "; " and skip the builder', async () => {
      const { run, schemas, builders } = setup();
      const strict = aSpyBuilder('strict');
      builders.register(strict);
      schemas.register(
        aSchema('strict', () => [
          { param: 'size', message: 'Must be greater than 0' },
          { param: '', message: 'Params are inconsistent' },
        ]),
      );
      const result = await run(
        aStudio([aFeature({ id: 'a', type: 'strict' }), aFeature({ id: 'b' })]),
      );
      expect(strict.calls).toHaveLength(0);
      expect(result.statuses.get(aFeature({ id: 'a' }).id)).toEqual({
        kind: 'error',
        error: {
          code: 'INVALID_PARAMS',
          message: 'size: Must be greater than 0; Params are inconsistent',
        },
      });
      expect(result.statuses.get(aFeature({ id: 'b' }).id)).toEqual(OK);
      expect(bodyIds(result)).toEqual(['b/body']);
    });

    it('invalid params of the default schema skip the builder', async () => {
      const { run, box } = setup();
      const result = await run(aStudio([aFeature({ id: 'a', params: { size: 0 } })]));
      expect(box.calls).toHaveLength(0);
      expect(result.statuses.get(aFeature({ id: 'a' }).id)).toMatchObject({
        kind: 'error',
        error: { code: 'INVALID_PARAMS' },
      });
      expect(result.finalState).toBe(EMPTY_STATE);
    });

    it('a type without schema gives UNKNOWN_TYPE and regeneration goes on', async () => {
      const { run, builders } = setup();
      const noSchema = aSpyBuilder('noSchema');
      builders.register(noSchema);
      const result = await run(
        aStudio([aFeature({ id: 'a', type: 'noSchema' }), aFeature({ id: 'b' })]),
      );
      expect(noSchema.calls).toHaveLength(0);
      expect(result.statuses.get(aFeature({ id: 'a' }).id)).toMatchObject({
        kind: 'error',
        error: { code: 'UNKNOWN_TYPE' },
      });
      expect(result.statuses.get(aFeature({ id: 'b' }).id)).toEqual(OK);
      expect(bodyIds(result)).toEqual(['b/body']);
    });

    it('a type without builder gives UNKNOWN_TYPE and the schema is not asked', async () => {
      const { run, schemas } = setup();
      let validated = 0;
      schemas.register(
        aSchema('noBuilder', () => {
          validated++;
          return [];
        }),
      );
      const result = await run(
        aStudio([aFeature({ id: 'a', type: 'noBuilder' }), aFeature({ id: 'b' })]),
      );
      expect(validated).toBe(0);
      expect(result.statuses.get(aFeature({ id: 'a' }).id)).toMatchObject({
        kind: 'error',
        error: { code: 'UNKNOWN_TYPE', message: expect.stringContaining('noBuilder') as unknown },
      });
      expect(bodyIds(result)).toEqual(['b/body']);
    });

    it('a suppressed feature passes the state through without building or validating', async () => {
      const { run, box } = setup();
      const list = [
        aFeature({ id: 'a' }),
        aFeature({ id: 'b', suppressed: true, params: { size: -1 } }),
        aFeature({ id: 'c', type: 'unknown', suppressed: true }),
        aFeature({ id: 'd' }),
      ];
      const result = await run(aStudio(list));
      expect(box.builtIds()).toEqual(['a', 'd']);
      expect([...result.statuses.values()]).toEqual([
        OK,
        { kind: 'suppressed' },
        { kind: 'suppressed' },
        OK,
      ]);
      expect([...(box.calls[1]?.state.bodies.keys() ?? [])]).toEqual(['a/body']);
      expect(bodyIds(result)).toEqual(['a/body', 'd/body']);
    });

    it('a rolledBack feature wins over suppressed and unknown type', async () => {
      const { run } = setup();
      const list = [
        aFeature({ id: 'a' }),
        aFeature({ id: 'b', suppressed: true }),
        aFeature({ id: 'c', type: 'unknown' }),
      ];
      const result = await run(aStudio(list, 1));
      expect([...result.statuses.values()]).toEqual([
        OK,
        { kind: 'rolledBack' },
        { kind: 'rolledBack' },
      ]);
    });

    it('warn twice gives one warning with the messages joined by "\\n"', async () => {
      const { run, schemas, builders } = setup();
      schemas.register(aSchema('warns'));
      builders.register(
        aSpyBuilder('warns', async (input, ctx) => {
          ctx.warn('first');
          const out = await buildCube(input, ctx);
          ctx.warn('second');
          return out;
        }),
      );
      const result = await run(aStudio([aFeature({ id: 'a', type: 'warns' })]));
      expect(result.statuses.get(aFeature({ id: 'a' }).id)).toEqual({
        kind: 'warning',
        message: 'first\nsecond',
      });
      expect(bodyIds(result)).toEqual(['a/body']);
    });

    it('a kernel exception gives KERNEL with its message and passes the state through', async () => {
      const { run, kernel } = setup();
      const list = features(2);
      kernel.failNext('makeBox', 'operation-failed', 'Box failed');
      const result = await run(aStudio(list));
      expect([...result.statuses]).toEqual([
        ['f1', { kind: 'error', error: { code: 'KERNEL', message: 'Box failed' } }],
        ['f2', OK],
      ]);
      expect(bodyIds(result)).toEqual(['f2/body']);
    });

    it('a non-kernel exception rejects run with that exception', async () => {
      const { regenerator, schemas, builders } = setup();
      const bug = new TypeError('plugin bug');
      schemas.register(aSchema('buggy'));
      builders.register(aSpyBuilder('buggy', () => Promise.reject(bug)));
      await expect(
        regenerator.run(aStudio([aFeature({ id: 'a' }), aFeature({ id: 'b', type: 'buggy' })])),
      ).rejects.toBe(bug);
    });

    it('a non-kernel exception does not write the cache', async () => {
      const { run, regenerator, schemas, builders, box } = setup();
      let fail = true;
      schemas.register(aSchema('flaky'));
      builders.register(
        aSpyBuilder('flaky', (input, ctx) =>
          fail ? Promise.reject(new Error('bug')) : buildCube(input, ctx),
        ),
      );
      const list = features(2);
      await run(aStudio(list));
      const studio = aStudio([
        ...list,
        aFeature({ id: 'x' }),
        aFeature({ id: 'y', type: 'flaky' }),
      ]);
      await expect(regenerator.run(studio)).rejects.toThrow('bug');
      expect(box.builtIds()).toEqual(['f1', 'f2', 'x']);

      fail = false;
      const result = await run(studio);
      // The cache still holds the first run: x is built again, f1 and f2 are not.
      expect(box.builtIds()).toEqual(['f1', 'f2', 'x', 'x']);
      expect(bodyIds(result)).toEqual(['f1/body', 'f2/body', 'x/body', 'y/body']);
    });

    it('statuses from the cache are kept: warning and error before a change', async () => {
      const { run, schemas, builders, box } = setup();
      schemas.register(aSchema('warns'));
      const warns = aSpyBuilder('warns', (input, ctx) => {
        ctx.warn('careful');
        return buildCube(input, ctx);
      });
      builders.register(warns);
      const list = [
        aFeature({ id: 'w', type: 'warns' }),
        aFeature({ id: 'e', params: { size: -1 } }),
        aFeature({ id: 'k' }),
        aFeature({ id: 'z' }),
      ];
      const first = await run(aStudio(list));
      const changed = withChanged(list, 3, { params: { size: 3 } });
      const second = await run(aStudio(changed));
      expect(warns.calls).toHaveLength(1);
      expect(box.builtIds()).toEqual(['k', 'z', 'z']);
      expect(second.statuses.get(aFeature({ id: 'w' }).id)).toEqual({
        kind: 'warning',
        message: 'careful',
      });
      expect(second.statuses.get(aFeature({ id: 'e' }).id)).toEqual(
        first.statuses.get(aFeature({ id: 'e' }).id),
      );
      expect(second.statuses.get(aFeature({ id: 'e' }).id)).toMatchObject({ kind: 'error' });
    });

    it('a kernel error status is cached and not rebuilt', async () => {
      const { run, kernel, box } = setup();
      const list = features(2);
      kernel.failNext('makeBox', 'operation-failed');
      await run(aStudio(list));
      const result = await run(aStudio(withChanged(list, 1, { params: { size: 2 } })));
      expect(box.builtIds()).toEqual(['f1', 'f2', 'f2']);
      expect(result.statuses.get(list[0]?.id ?? never())).toMatchObject({
        kind: 'error',
        error: { code: 'KERNEL' },
      });
    });
  });

  describe('immutability', () => {
    /** A studio with every kind of status Regenerator gives (spec 07, Stav featury). */
    function everyStatus() {
      const s = setup();
      const builderError: FeatureError = { code: 'UNRESOLVED_REFERENCE', message: 'gone' };
      s.schemas.register(aSchema('broken'));
      s.builders.register(
        aSpyBuilder('broken', () => Promise.resolve({ ok: false, error: builderError })),
      );
      s.schemas.register(aSchema('warns'));
      s.builders.register(
        aSpyBuilder('warns', (input, ctx) => {
          ctx.warn('careful');
          return buildCube(input, ctx);
        }),
      );
      s.schemas.register(aSchema('kernelFails'));
      s.builders.register(
        aSpyBuilder('kernelFails', (input, ctx) => {
          s.kernel.failNext('makeBox', 'operation-failed');
          return buildCube(input, ctx);
        }),
      );
      const studio = aStudio(
        [
          aFeature({ id: 'ok' }),
          aFeature({ id: 'warning', type: 'warns' }),
          aFeature({ id: 'broken', type: 'broken' }),
          aFeature({ id: 'kernel', type: 'kernelFails' }),
          aFeature({ id: 'invalid', params: { size: 0 } }),
          aFeature({ id: 'unknown', type: 'unknown' }),
          aFeature({ id: 'suppressed', suppressed: true }),
          aFeature({ id: 'rolledBack' }),
        ],
        7,
      );
      return { ...s, studio, builderError };
    }

    it('freezes every status of the result and of featureDone, errors included', async () => {
      const { run, regenerator, studio } = everyStatus();
      const done: FeatureStatus[] = [];
      regenerator.events.on('featureDone', (e) => done.push(e.status));
      const result = await run(studio);
      const statuses = [...result.statuses.values()];
      expect(new Set(statuses.map((st) => st.kind))).toEqual(
        new Set(['ok', 'warning', 'error', 'suppressed', 'rolledBack']),
      );
      expect(done).toEqual(statuses);
      for (const status of [...statuses, ...done]) {
        expect(Object.isFrozen(status), status.kind).toBe(true);
        if (status.kind === 'error') expect(Object.isFrozen(status.error)).toBe(true);
      }
    });

    it('does not freeze the error object a builder returned', async () => {
      const { run, studio, builderError } = everyStatus();
      await run(studio);
      expect(Object.isFrozen(builderError)).toBe(false);
    });

    it('freezes the result; finished carries the same frozen object', async () => {
      const { run, regenerator } = setup();
      let finished: RegenResult | undefined;
      regenerator.events.on('finished', (e) => {
        finished = e.result;
      });
      const result = await run(aStudio(features(1)));
      expect(Object.isFrozen(result)).toBe(true);
      expect(finished).toBe(result);
    });
  });

  describe('dependencies', () => {
    it('reads the registries at run time', async () => {
      const kernel = createFakeKernel();
      const schemas = createFeatureSchemaRegistry();
      const builders = createBuilderRegistry();
      const regenerator = createRegenerator({ kernel, schemas, builders, now: stoppedClock });
      const builder: FeatureBuilder = aSpyBuilder();
      schemas.register(aSchema());
      builders.register(builder);
      const result = await regen((s) => regenerator.run(s), aStudio([aFeature({ id: 'a' })]));
      expect(bodyIds(result)).toEqual(['a/body']);
    });
  });
});

function never(): never {
  throw new Error('Unexpected undefined in test data');
}
