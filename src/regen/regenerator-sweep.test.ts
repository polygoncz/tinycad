import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry } from '@/document';
import type { FeatureInstance, PartStudioData } from '@/document';
import { aFeature } from '@/document/testing';
import type { DefaultParams } from '@/document/testing';
import { RpcError } from '@/core';
import { kernelErrorCode } from '@/kernel';
import type { GeometryKernel, ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import type { FakeKernel } from '@/kernel/testing';
import { createBuilderRegistry } from './builder';
import type { FeatureBuilder } from './builder';
import { createRegenerator } from './regenerator';
import type { RegenResult, Regenerator } from './regenerator';
import type { RegenState } from './state';
import {
  aGatedBuild,
  aRegenSetup,
  aSchema,
  aSpyBuilder,
  aStudio,
  buildCube,
  deferred,
  features,
  resized,
  result,
  stoppedClock,
} from './testing';
import type { Deferred, RegenSetup } from './testing';

// Lifetime of handles: mark & sweep (spec 07, Životnost handle) and failures of release (Q040).

/** Handles of the bodies of a state. */
function handlesOf(state: RegenState): ShapeHandle[] {
  return [...state.bodies.values()].map((b) => b.shape);
}

/** A build that creates an intermediate box and then fails as an expected feature error. */
const buildScrapAndFail: FeatureBuilder['build'] = async (_, { kernel }) => {
  await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
  return { ok: false, error: { code: 'KERNEL', message: 'boolean failed' } };
};

/** A build that creates a box and then throws an error that is not from the kernel (Q043). */
function buildScrapAndThrow(error: unknown): FeatureBuilder['build'] {
  return async (_, { kernel }) => {
    await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
    throw error;
  };
}

/**
 * The FakeKernel with release replaced: `release` decides per call (call index from 0) whether
 * to delegate. Used for rejections the fake cannot inject (RpcError) and for a release that waits.
 */
function withRelease(
  fake: FakeKernel,
  release: (handles: readonly ShapeHandle[], call: number) => Promise<void>,
): GeometryKernel {
  let calls = 0;
  return {
    makeBox: (p) => fake.makeBox(p),
    tessellate: (shape, q) => fake.tessellate(shape, q),
    boundingBox: (shape) => fake.boundingBox(shape),
    release: (handles) => release(handles, calls++),
    liveHandleCount: () => fake.liveHandleCount(),
  };
}

/** A Regenerator with type 'box' (buildCube) over the given kernel. */
function regeneratorOver(kernel: GeometryKernel, build: FeatureBuilder['build'] = buildCube) {
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const box = aSpyBuilder('box', build);
  schemas.register(aSchema());
  builders.register(box);
  return { box, regenerator: createRegenerator({ kernel, builders, schemas, now: stoppedClock }) };
}

/** Registers the type `type` with the given build into a setup. */
function registerType(setup: RegenSetup, type: string, build: FeatureBuilder['build']): void {
  setup.schemas.register(aSchema(type));
  setup.builders.register(aSpyBuilder(type, build));
}

async function runOk(regenerator: Regenerator, studio: PartStudioData): Promise<RegenResult> {
  return result(await regenerator.run(studio));
}

describe('Regenerator mark & sweep', () => {
  it('a changed param releases the old body; only live handles remain', async () => {
    const { regenerator, kernel } = aRegenSetup();
    const [f1, f2] = features(2) as [
      FeatureInstance<DefaultParams>,
      FeatureInstance<DefaultParams>,
    ];
    await runOk(regenerator, aStudio([f1, f2]));
    const r = await runOk(regenerator, aStudio([f1, resized(f2, 2)]));
    expect(await kernel.liveHandleCount()).toBe(2);
    for (const h of handlesOf(r.finalState)) await kernel.boundingBox(h);
  });

  it('deleting a feature releases its body and the rebuilt bodies after it', async () => {
    const { regenerator, kernel } = aRegenSetup();
    const [f1, f2, f3] = features(3) as [
      FeatureInstance<DefaultParams>,
      FeatureInstance<DefaultParams>,
      FeatureInstance<DefaultParams>,
    ];
    await runOk(regenerator, aStudio([f1, f2, f3]));
    await runOk(regenerator, aStudio([f1, f3]));
    expect(await kernel.liveHandleCount()).toBe(2);
  });

  it('releases all dead handles in one release call and skips release when none is dead', async () => {
    const { regenerator, kernel } = aRegenSetup();
    const list = features(3);
    await runOk(regenerator, aStudio(list));
    expect(kernel.callCount('release')).toBe(0);
    // Deleting f1 rebuilds f2 and f3: three handles die at once.
    await runOk(regenerator, aStudio(list.slice(1)));
    expect(kernel.callCount('release')).toBe(1);
    expect(await kernel.liveHandleCount()).toBe(2);
    await runOk(regenerator, aStudio(list.slice(1)));
    expect(kernel.callCount('release')).toBe(1);
  });

  it('keeps the handles of cache entries behind the rollback bar', async () => {
    const { regenerator, kernel } = aRegenSetup();
    const list = features(3);
    await runOk(regenerator, aStudio(list));
    await runOk(regenerator, aStudio(list, 1));
    expect(kernel.callCount('release')).toBe(0);
    expect(await kernel.liveHandleCount()).toBe(3);
  });

  it('a builder that creates an intermediate shape and fails leaks nothing', async () => {
    const setup = aRegenSetup();
    const { regenerator, kernel } = setup;
    registerType(setup, 'scrap', buildScrapAndFail);
    const r = await runOk(
      regenerator,
      aStudio([aFeature({ id: 'a' }), aFeature({ id: 'b', type: 'scrap' })]),
    );
    expect(r.statuses.get(aFeature({ id: 'b' }).id)?.kind).toBe('error');
    expect(await kernel.liveHandleCount()).toBe(1);
  });

  it('a non-kernel exception rejects run and its handles are released anyway', async () => {
    const setup = aRegenSetup();
    const { regenerator, kernel } = setup;
    const bug = new TypeError('plugin bug');
    registerType(setup, 'buggy', buildScrapAndThrow(bug));
    await runOk(regenerator, aStudio([aFeature({ id: 'a' })]));
    const studio = aStudio([
      aFeature({ id: 'a' }),
      aFeature({ id: 'x' }),
      aFeature({ id: 'y', type: 'buggy' }),
    ]);
    await expect(regenerator.run(studio)).rejects.toBe(bug);
    // The cache still holds the first run (one body); a, x and the scrap of y are dead.
    expect(await kernel.liveHandleCount()).toBe(1);
  });

  it('an exception of an event listener rejects run and its handles are released', async () => {
    const { regenerator, kernel } = aRegenSetup();
    const bug = new Error('listener bug');
    regenerator.events.on('featureDone', () => {
      throw bug;
    });
    await expect(regenerator.run(aStudio(features(2)))).rejects.toBe(bug);
    expect(await kernel.liveHandleCount()).toBe(0);
  });

  it('an exception of a finished listener rejects run; the cache stays written and swept', async () => {
    const { regenerator, kernel, box } = aRegenSetup();
    const bug = new Error('listener bug');
    const list = features(3);
    await runOk(regenerator, aStudio(list));
    const off = regenerator.events.on('finished', () => {
      throw bug;
    });
    // Deleting f1 rebuilds f2 and f3: the old three bodies die.
    await expect(regenerator.run(aStudio(list.slice(1)))).rejects.toBe(bug);
    off();
    expect(kernel.callCount('release')).toBe(1);
    expect(await kernel.liveHandleCount()).toBe(2);

    // The cache holds the rejected run: the same studio builds nothing and releases nothing.
    const before = box.calls.length;
    await runOk(regenerator, aStudio(list.slice(1)));
    expect(box.calls.length).toBe(before);
    expect(kernel.callCount('release')).toBe(1);
  });

  it('a superseded run leaks nothing once the run that replaced it has swept', async () => {
    const gated = aGatedBuild();
    const { regenerator, kernel } = aRegenSetup({ build: gated.build });
    const [f1, f2] = features(2) as [
      FeatureInstance<DefaultParams>,
      FeatureInstance<DefaultParams>,
    ];
    const changed = resized(f1, 2);
    const firstGate = gated.hold(f1);
    const secondGate = gated.hold(changed);

    const first = regenerator.run(aStudio([f1, f2]));
    const second = regenerator.run(aStudio([changed, f2]));
    firstGate.resolve();
    expect(await first).toBe('superseded');
    // The superseded run built f1 and did not sweep.
    expect(await kernel.liveHandleCount()).toBe(1);
    secondGate.resolve();
    const r = result(await second);
    expect(await kernel.liveHandleCount()).toBe(2);
    expect(handlesOf(r.finalState)).toHaveLength(2);
  });

  it('sweeps before finished and before the promise resolves', async () => {
    const { regenerator, kernel } = aRegenSetup();
    const list = features(2);
    await runOk(regenerator, aStudio(list));
    let releasesAtFinished: number | undefined;
    regenerator.events.on('finished', () => {
      releasesAtFinished = kernel.callCount('release');
    });
    await runOk(regenerator, aStudio(list.slice(1)));
    expect(releasesAtFinished).toBe(1);
  });

  it('a run started while release is pending supersedes the sweeping run; nothing is released twice', async () => {
    const fake = createFakeKernel();
    const gate: Deferred<void> = deferred();
    const kernel = withRelease(fake, async (handles, call) => {
      if (call === 0) await gate.promise;
      return fake.release(handles);
    });
    const { regenerator } = regeneratorOver(kernel);
    const finished: number[] = [];
    regenerator.events.on('finished', (e) => finished.push(e.generation));
    const list = features(3);
    await runOk(regenerator, aStudio(list));

    const first = regenerator.run(aStudio(list.slice(1)));
    // Let the first run reach its pending release.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = regenerator.run(aStudio(list.slice(2)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    gate.resolve();

    expect(await first).toBe('superseded');
    result(await second);
    expect(finished).toEqual([1, 3]);
    expect(await fake.liveHandleCount()).toBe(1);
  });
});

describe('Regenerator release failures (Q040)', () => {
  it('unknown-handle rejects run with that error and emits no finished', async () => {
    const { regenerator, kernel } = aRegenSetup();
    const list = features(2);
    await runOk(regenerator, aStudio(list));
    const finished: number[] = [];
    regenerator.events.on('finished', (e) => finished.push(e.generation));
    kernel.failNext('release', 'unknown-handle');
    const failure = await regenerator.run(aStudio(list.slice(1))).then(
      () => expect.fail('Expected run to reject'),
      (e: unknown) => e,
    );
    expect(kernelErrorCode(failure)).toBe('unknown-handle');
    expect(finished).toEqual([]);
  });

  it('another kernel error keeps the handles and the next sweep releases them', async () => {
    const { regenerator, kernel } = aRegenSetup();
    const list = features(2);
    await runOk(regenerator, aStudio(list));
    const finished: number[] = [];
    regenerator.events.on('finished', (e) => finished.push(e.generation));
    kernel.failNext('release', 'internal');

    const r = await runOk(regenerator, aStudio(list.slice(1)));
    expect(finished).toEqual([r.generation]);
    // Old f1 and f2 are still alive in the kernel.
    expect(await kernel.liveHandleCount()).toBe(3);

    await runOk(regenerator, aStudio(list.slice(1)));
    expect(await kernel.liveHandleCount()).toBe(1);
    expect(kernel.callCount('release')).toBe(2);
  });

  it('disconnected rejects run with the RpcError and the Regenerator is dead', async () => {
    const fake = createFakeKernel();
    const disconnected = new RpcError('disconnected', 'Worker is gone');
    const kernel = withRelease(fake, (handles, call) =>
      call === 0 ? Promise.reject(disconnected) : fake.release(handles),
    );
    const { regenerator, box } = regeneratorOver(kernel);
    const list = features(2);
    await runOk(regenerator, aStudio(list));
    await expect(regenerator.run(aStudio(list.slice(1)))).rejects.toBe(disconnected);

    // Q049: every later run rejects with the same error, without touching the kernel.
    const builds = box.builtIds().length;
    const makeBoxes = fake.callCount('makeBox');
    await expect(regenerator.run(aStudio(list.slice(1)))).rejects.toBe(disconnected);
    expect(box.builtIds()).toHaveLength(builds);
    expect(fake.callCount('makeBox')).toBe(makeBoxes);
    expect(fake.callCount('release')).toBe(0);
  });

  it('after a non-kernel exception, the original exception wins over a failed release', async () => {
    const setup = aRegenSetup();
    const { regenerator, kernel } = setup;
    const bug = new TypeError('plugin bug');
    registerType(setup, 'buggy', buildScrapAndThrow(bug));
    kernel.failNext('release', 'unknown-handle');
    await expect(regenerator.run(aStudio([aFeature({ id: 'y', type: 'buggy' })]))).rejects.toBe(
      bug,
    );
  });

  it('after a non-kernel exception, a disconnected release still kills the Regenerator', async () => {
    const fake = createFakeKernel();
    const disconnected = new RpcError('disconnected', 'Worker is gone');
    const kernel = withRelease(fake, (handles, call) =>
      call === 0 ? Promise.reject(disconnected) : fake.release(handles),
    );
    const bug = new TypeError('plugin bug');
    const { regenerator, box } = regeneratorOver(kernel);
    const list = features(1);
    await runOk(regenerator, aStudio(list));
    // A listener bug fails the run after f2 is built (a non-kernel exception, like Q043).
    const off = regenerator.events.on('featureDone', (e) => {
      if (e.featureId === aFeature({ id: 'f2' }).id) throw bug;
    });
    await expect(regenerator.run(aStudio([...list, aFeature({ id: 'f2' })]))).rejects.toBe(bug);
    off();

    const before = box.builtIds().length;
    await expect(regenerator.run(aStudio(list))).rejects.toBe(disconnected);
    expect(box.builtIds()).toHaveLength(before);
  });
});

describe('Regenerator kernel lost during a build (Q049)', () => {
  /** A setup with type 'dead': it creates a box and then the kernel is gone. */
  function deadKernelSetup(disconnected: RpcError): RegenSetup {
    const setup = aRegenSetup();
    registerType(setup, 'dead', buildScrapAndThrow(disconnected));
    return setup;
  }

  it('rejects run with the RpcError without calling release', async () => {
    const disconnected = new RpcError('disconnected', 'Worker is gone');
    const { regenerator, kernel } = deadKernelSetup(disconnected);
    const list = features(2);
    await runOk(regenerator, aStudio(list));
    // Deleting f1 makes the handles of the first run dead, so a sweep would have to release them.
    const studio = aStudio([...list.slice(1), aFeature({ id: 'x', type: 'dead' })]);
    await expect(regenerator.run(studio)).rejects.toBe(disconnected);
    expect(kernel.callCount('release')).toBe(0);
  });

  it('the Regenerator is dead: every later run rejects without calling the kernel', async () => {
    const disconnected = new RpcError('disconnected', 'Worker is gone');
    const { regenerator, kernel, box } = deadKernelSetup(disconnected);
    const list = features(2);
    await runOk(regenerator, aStudio(list));
    await expect(
      regenerator.run(aStudio([...list, aFeature({ id: 'x', type: 'dead' })])),
    ).rejects.toBe(disconnected);

    const started: number[] = [];
    regenerator.events.on('started', (e) => started.push(e.generation));
    const builds = box.builtIds().length;
    const makeBoxes = kernel.callCount('makeBox');
    // Even a run that would take everything from the cache rejects.
    await expect(regenerator.run(aStudio(list))).rejects.toBe(disconnected);
    await expect(regenerator.run(aStudio(list, 0))).rejects.toBe(disconnected);
    expect(box.builtIds()).toHaveLength(builds);
    expect(kernel.callCount('makeBox')).toBe(makeBoxes);
    expect(kernel.callCount('release')).toBe(0);
    expect(started).toEqual([]);
  });

  it('a concurrent run that takes everything from the cache rejects too, without finished', async () => {
    const fake = createFakeKernel();
    const lost: Deferred<void> = deferred();
    const releasing: Deferred<void> = deferred();
    const disconnected = new RpcError('disconnected', 'Worker is gone');
    // Every release waits until the test lets it go on.
    const kernel = withRelease(fake, async (handles) => {
      await releasing.promise;
      return fake.release(handles);
    });
    // The feature `held` creates a scrap box, then waits until the kernel is lost.
    const f1 = aFeature({ id: 'f1' });
    const held = aFeature({ id: 'held' });
    const build: FeatureBuilder['build'] = async (input, ctx) => {
      if (input.feature !== held) return buildCube(input, ctx);
      await ctx.kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
      await lost.promise;
      return buildCube(input, ctx);
    };
    const { regenerator } = regeneratorOver(kernel, build);
    const finished: number[] = [];
    regenerator.events.on('finished', (e) => finished.push(e.generation));
    await runOk(regenerator, aStudio([f1]));

    // Run A waits in the build of `held`.
    const a = regenerator.run(aStudio([f1, held]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Run B only moves the bar in front of `held`: f1 comes from the cache, nothing is built.
    // Its sweep finds the scrap of A dead and waits in release.
    const b = regenerator.run(aStudio([f1, held], 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    lost.reject(disconnected);
    await expect(a).rejects.toBe(disconnected);
    releasing.resolve();

    await expect(b).rejects.toBe(disconnected);
    expect(finished).toEqual([1]);
    // Dead: the next run rejects without calling the kernel.
    const makeBoxes = fake.callCount('makeBox');
    await expect(regenerator.run(aStudio([f1]))).rejects.toBe(disconnected);
    expect(fake.callCount('makeBox')).toBe(makeBoxes);
  });

  it('the feature gets no status and finished is not emitted', async () => {
    const disconnected = new RpcError('disconnected', 'Worker is gone');
    const { regenerator } = deadKernelSetup(disconnected);
    const dead = aFeature({ id: 'x', type: 'dead' });
    const done: string[] = [];
    const finished: number[] = [];
    regenerator.events.on('featureDone', (e) => done.push(e.featureId));
    regenerator.events.on('finished', (e) => finished.push(e.generation));
    await expect(regenerator.run(aStudio([aFeature({ id: 'a' }), dead]))).rejects.toBe(
      disconnected,
    );
    expect(done).toEqual([aFeature({ id: 'a' }).id]);
    expect(finished).toEqual([]);
  });
});
