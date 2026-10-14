import { describe, expect, it } from 'vitest';
import { ORIGIN_AXIS_IDS, ORIGIN_PLANE_IDS, bodyId, createFeatureSchemaRegistry } from '@/document';
import type { FeatureId, FeatureInstance, ParamIssue, PartStudioData } from '@/document';
import { aFeature } from '@/document/testing';
import { createFakeKernel } from '@/kernel/testing';
import { createBuilderRegistry } from './builder';
import type { FeatureBuilder } from './builder';
import { createRegenerator } from './regenerator';
import type { RegenResult } from './regenerator';
import { EMPTY_STATE, bodiesOf } from './state';
import type { FeatureError, FeatureStatus } from './state';
import {
  aRegenSetup,
  aSchema,
  aSpyBuilder,
  aStudio,
  buildCube,
  features,
  stoppedClock,
} from './testing';

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

/** Ids of the bodies of the final state, in map order. */
/** Ids of the origin planes and axes, the first artifacts of every state (EMPTY_STATE seeds them). */
const ORIGIN_IDS = [
  ORIGIN_PLANE_IDS.xy,
  ORIGIN_PLANE_IDS.xz,
  ORIGIN_PLANE_IDS.yz,
  ORIGIN_AXIS_IDS.x,
  ORIGIN_AXIS_IDS.y,
  ORIGIN_AXIS_IDS.z,
];

function bodyIds(result: RegenResult): string[] {
  return bodiesOf(result.finalState).map((b) => b.id);
}

// Feature ids are created by a cast in tests only.
const fid = (s: string): FeatureId => s as FeatureId;

/** aSchema of `type` in version 2; its migrate is never reached by the Regenerator. */
function aSchemaV2(type: string, validate?: (params: unknown) => readonly ParamIssue[]) {
  return { ...aSchema(type, validate), version: 2, migrate: (_from: number, raw: unknown) => raw };
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
      expect([...(box.calls[1]?.state.artifacts.keys() ?? [])]).toEqual([...ORIGIN_IDS, 'f1/body']);
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
      expect(input?.artifacts.get(bodyId(list[0]?.id ?? never()))).toBe(
        first.finalState.artifacts.get(bodyId(list[0]?.id ?? never())),
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

    it('invalid params give INVALID_PARAMS with the issue codes joined by "; " and skip the builder', async () => {
      const { run, schemas, builders } = setup();
      const strict = aSpyBuilder('strict');
      builders.register(strict);
      schemas.register(
        aSchema('strict', () => [
          { param: 'size', code: 'param.atOrBelowMin', params: { min: 0 } },
          { param: '', code: 'strict.inconsistent' },
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
          message: 'size: param.atOrBelowMin; strict.inconsistent',
          issues: [
            { param: 'size', code: 'param.atOrBelowMin', params: { min: 0 } },
            { param: '', code: 'strict.inconsistent' },
          ],
        },
      });
      expect(result.statuses.get(aFeature({ id: 'b' }).id)).toEqual(OK);
      expect(bodyIds(result)).toEqual(['b/body']);
    });

    it('a zero height gives INVALID_PARAMS with a frozen copy of the issues', async () => {
      const { run, schemas, builders } = setup();
      builders.register(aSpyBuilder('tall'));
      const returned = [{ param: 'height', code: 'param.atOrBelowMin', params: { min: 0 } }];
      schemas.register(aSchema('tall', () => returned));
      const result = await run(aStudio([aFeature({ id: 'a', type: 'tall' })]));
      const status = result.statuses.get(aFeature({ id: 'a' }).id);
      expect(status).toEqual({
        kind: 'error',
        error: {
          code: 'INVALID_PARAMS',
          message: 'height: param.atOrBelowMin',
          issues: [{ param: 'height', code: 'param.atOrBelowMin', params: { min: 0 } }],
        },
      });
      const issues = status?.kind === 'error' ? status.error.issues : undefined;
      expect(issues).not.toBe(returned);
      expect(Object.isFrozen(issues)).toBe(true);
      expect(issues?.every((issue) => Object.isFrozen(issue))).toBe(true);
      expect(issues?.every((issue) => Object.isFrozen(issue.params))).toBe(true);
      // The schema's own array stays as it was.
      expect(Object.isFrozen(returned)).toBe(false);
      expect(Object.isFrozen(returned[0])).toBe(false);
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

    it('data of another version than the schema give STALE_VERSION, skip the builder and pass the state through', async () => {
      const { run, box } = setup();
      const list = [
        aFeature({ id: 'a' }),
        aFeature({ id: 'b', typeVersion: 3 }),
        aFeature({ id: 'c' }),
      ];
      const result = await run(aStudio(list));
      expect(box.builtIds()).toEqual(['a', 'c']);
      expect(result.statuses.get(fid('b'))).toEqual({
        kind: 'error',
        error: { code: 'STALE_VERSION', message: expect.any(String) as unknown },
      });
      expect(result.statuses.get(fid('c'))).toEqual(OK);
      expect(bodyIds(result)).toEqual(['a/body', 'c/body']);
    });

    it('STALE_VERSION carries both versions in the message, older data included', async () => {
      const { run, schemas, builders } = setup();
      const v2 = aSpyBuilder('v2');
      builders.register(v2);
      schemas.register(aSchemaV2('v2'));
      const result = await run(aStudio([aFeature({ id: 'a', type: 'v2', typeVersion: 1 })]));
      expect(v2.calls).toHaveLength(0);
      const status = result.statuses.get(fid('a'));
      if (status?.kind !== 'error') expect.fail('Expected an error status');
      expect(status.error.code).toBe('STALE_VERSION');
      expect(status.error.message).toMatch(/\b1\b/);
      expect(status.error.message).toMatch(/\b2\b/);
      expect(result.finalState).toBe(EMPTY_STATE);
    });

    it('STALE_VERSION comes before validation: the schema does not validate stale params', async () => {
      const { run, schemas, builders } = setup();
      let validated = 0;
      builders.register(aSpyBuilder('v2'));
      schemas.register(
        aSchemaV2('v2', () => {
          validated++;
          return [];
        }),
      );
      const result = await run(
        aStudio([aFeature({ id: 'a', type: 'v2', typeVersion: 1, params: { size: 0 } })]),
      );
      expect(validated).toBe(0);
      expect(result.statuses.get(fid('a'))).toMatchObject({
        kind: 'error',
        error: { code: 'STALE_VERSION' },
      });
    });

    it('UNKNOWN_TYPE comes before STALE_VERSION', async () => {
      const { run } = setup();
      const result = await run(aStudio([aFeature({ id: 'a', type: 'unknown', typeVersion: 7 })]));
      expect(result.statuses.get(fid('a'))).toMatchObject({
        kind: 'error',
        error: { code: 'UNKNOWN_TYPE' },
      });
    });

    it('a suppressed feature of a stale version stays suppressed', async () => {
      const { run, box } = setup();
      const result = await run(
        aStudio([aFeature({ id: 'a', typeVersion: 2, suppressed: true }), aFeature({ id: 'b' })]),
      );
      expect(box.builtIds()).toEqual(['b']);
      expect([...result.statuses.values()]).toEqual([{ kind: 'suppressed' }, OK]);
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
      expect([...(box.calls[1]?.state.artifacts.keys() ?? [])]).toEqual([...ORIGIN_IDS, 'a/body']);
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
          aFeature({ id: 'stale', typeVersion: 2 }),
          aFeature({ id: 'suppressed', suppressed: true }),
          aFeature({ id: 'rolledBack' }),
        ],
        8,
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
