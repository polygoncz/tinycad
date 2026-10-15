import { describe, expect, it, vi } from 'vitest';
import { ObservableValue, RpcError } from '@/core';
import { bodyId, sketchId } from '@/document';
import type { BodyId, FeatureId, PartStudioData } from '@/document';
import type { RegenSnapshot } from '@/interaction';
import { createFakeKernel } from '@/kernel/testing';
import type { FeatureBuilder, Regenerator } from '@/regen';
import { EMPTY_STATE } from '@/regen';
import { aRegenSetup, aSketchArtifact, aStudio, buildCube, features } from '@/regen/testing';
import { createRegenPipeline } from '@/app/regen-pipeline';
import type { RegenPipeline } from '@/app/regen-pipeline';
import { createRegenStatusAdapter } from '@/app/regen-status-adapter';
import type { RegenStatusAdapter } from '@/app/regen-status-adapter';
import { FakeAppViewport, settle } from '@/app/testing';

/** A build of the test type that leaves a sketch artifact of its feature, not a body. */
const buildSketch: FeatureBuilder['build'] = ({ feature, state }) => {
  const sketch = aSketchArtifact(feature.id);
  return Promise.resolve({
    ok: true,
    state: { artifacts: new Map(state.artifacts).set(sketch.id, sketch) },
    anchors: {},
  });
};

interface Harness {
  readonly pipeline: RegenPipeline;
  readonly viewport: FakeAppViewport;
  /** The studio the pipeline regenerates; a test replaces it before request(). */
  studio: PartStudioData;
  /** The Regenerator of the "live kernel"; null = no kernel. */
  regenerator: Regenerator | null;
  readonly lost: Regenerator[];
  readonly errors: unknown[];
  /** What was done of the step when each error was reported. */
  readonly reports: { readonly afterSync: number; readonly bodyCount: number }[];
  readonly regenStatus: RegenStatusAdapter;
  /** Snapshots the port published, oldest first. */
  readonly published: RegenSnapshot[];
  readonly edited: ObservableValue<{ readonly featureId: FeatureId } | null>;
  /** Calls of afterSync. */
  readonly afterSync: { count: number };
}

function setup(opts: { build?: FeatureBuilder['build'] } = {}): Harness {
  const { regenerator } = aRegenSetup(opts);
  const viewport = new FakeAppViewport();
  const regenStatus = createRegenStatusAdapter();
  const edited = new ObservableValue<{ readonly featureId: FeatureId } | null>(null);
  const afterSync = { count: 0 };
  const harness: Omit<Harness, 'pipeline'> = {
    viewport,
    studio: aStudio([]),
    regenerator,
    lost: [],
    errors: [],
    reports: [],
    regenStatus,
    published: [],
    edited,
    afterSync,
  };
  regenStatus.state.subscribe(() => harness.published.push(regenStatus.state.get()));
  const pipeline = createRegenPipeline({
    doc: {
      get studio() {
        return harness.studio;
      },
    },
    kernel: {
      regenerator: () => harness.regenerator,
      lost: (r) => harness.lost.push(r),
    },
    viewport,
    regenStatus,
    sketches: { current: edited },
    afterSync: () => {
      afterSync.count++;
    },
    reportError: (error) => {
      harness.errors.push(error);
      harness.reports.push({
        afterSync: afterSync.count,
        bodyCount: pipeline.state.get().bodyCount,
      });
    },
  });
  return Object.assign(harness, { pipeline });
}

const idsOf = (bodies: readonly { readonly id: BodyId }[]): BodyId[] => bodies.map((b) => b.id);
const bodiesOf = (snapshot: RegenSnapshot | undefined): BodyId[] =>
  snapshot?.bodies.map((b) => b.body) ?? [];

describe('createRegenPipeline – regeneration', () => {
  it('regenerates the studio, shows its bodies and publishes the result', async () => {
    const h = setup();
    const [f1] = features(1);
    h.studio = aStudio([f1 ?? expect.fail()]);
    h.pipeline.request();
    expect(h.pipeline.state.get().busy).toBe(true);
    await settle();
    const body = bodyId(f1?.id ?? expect.fail());
    expect(idsOf(h.viewport.shown)).toEqual([body]);
    expect(bodiesOf(h.published.at(-1))).toEqual([body]);
    expect(h.pipeline.state.get()).toEqual({ busy: false, bodyCount: 1, lastMs: 0, failed: null });
    expect(h.pipeline.lastState().artifacts.has(body)).toBe(true);
    expect(h.afterSync.count).toBe(1);
  });

  it('without a live kernel nothing runs', async () => {
    const h = setup();
    h.regenerator = null;
    h.pipeline.request();
    await settle();
    expect(h.viewport.syncs).toEqual([]);
    expect(h.pipeline.state.get()).toMatchObject({ busy: false, lastMs: null });
  });

  it('publishes only once the view shows the bodies of the same generation (D3)', async () => {
    const h = setup();
    h.studio = aStudio(features(1));
    h.viewport.holdSyncs();
    h.pipeline.request();
    await settle();
    // The regeneration finished, the view still tessellates: nothing of it is published yet.
    expect(h.viewport.heldSyncs).toBe(1);
    expect(h.published).toEqual([]);
    expect(h.pipeline.state.get()).toMatchObject({ busy: true, bodyCount: 0 });
    expect(h.pipeline.lastState()).toBe(EMPTY_STATE);
    expect(h.afterSync.count).toBe(0);

    h.viewport.releaseSyncs();
    await settle();
    expect(h.published).toHaveLength(1);
    expect(idsOf(h.viewport.shown)).toEqual(bodiesOf(h.published[0]));
    expect(h.pipeline.state.get()).toMatchObject({ busy: false, bodyCount: 1 });
  });

  it('a kernel replaced during the sync drops the result: nothing is published', async () => {
    const h = setup();
    h.studio = aStudio(features(1));
    h.viewport.holdSyncs();
    h.pipeline.request();
    await settle();
    h.regenerator = aRegenSetup().regenerator;
    h.viewport.releaseSyncs();
    await settle();
    expect(h.published).toEqual([]);
    expect(h.pipeline.state.get()).toMatchObject({ busy: false, bodyCount: 0 });
    expect(h.pipeline.lastState()).toBe(EMPTY_STATE);
  });

  it('a result of a Regenerator that is no longer live sends no tessellation', async () => {
    let replace: (() => void) | null = null;
    const h = setup({
      build: async (input, ctx) => {
        const output = await buildCube(input, ctx);
        replace?.();
        return output;
      },
    });
    h.studio = aStudio(features(1));
    replace = () => {
      h.regenerator = null;
    };
    h.pipeline.request();
    await settle();
    expect(h.viewport.syncs).toEqual([]);
    expect(h.published).toEqual([]);
  });

  it('a regeneration that throws sets failed and is reported; the next successful one clears it', async () => {
    let broken = true;
    const h = setup({
      build: (input, ctx) =>
        broken ? Promise.reject(new Error('builder bug')) : buildCube(input, ctx),
    });
    h.studio = aStudio(features(1));
    h.pipeline.request();
    await settle();
    expect(h.pipeline.state.get()).toMatchObject({ busy: false, failed: 'builder bug' });
    expect(h.errors).toEqual([new Error('builder bug')]);

    broken = false;
    h.studio = aStudio(features(2));
    h.pipeline.request();
    await settle();
    expect(h.pipeline.state.get()).toMatchObject({ busy: false, bodyCount: 2, failed: null });
  });

  it('a Regenerator that rejects disconnected is lost, not a failed regeneration', async () => {
    const h = setup();
    const dead: Regenerator = {
      run: () => Promise.reject(new RpcError('disconnected', 'gone')),
      events: aRegenSetup().regenerator.events,
    };
    h.regenerator = dead;
    h.pipeline.request();
    await settle();
    expect(h.lost).toEqual([dead]);
    expect(h.errors).toEqual([]);
    expect(h.pipeline.state.get()).toMatchObject({ busy: false, failed: null });
  });

  it('a subscriber of the port that throws does not stop the step; it is reported after it', async () => {
    const h = setup();
    h.studio = aStudio(features(1));
    const bug = new Error('subscriber bug');
    h.regenStatus.state.subscribe(() => {
      throw bug;
    });
    h.pipeline.request();
    await settle();
    expect(h.errors).toEqual([bug]);
    // After the whole step: the counters and the view state were done already.
    expect(h.reports).toEqual([{ afterSync: 1, bodyCount: 1 }]);
  });

  it('after dispose a finishing regeneration publishes nothing and requests do nothing', async () => {
    const h = setup();
    h.studio = aStudio(features(1));
    h.viewport.holdSyncs();
    h.pipeline.request();
    await settle();
    h.pipeline.dispose();
    h.viewport.releaseSyncs();
    await settle();
    expect(h.published).toEqual([]);
    h.pipeline.request();
    await settle();
    expect(h.viewport.syncs).toHaveLength(1);
  });
});

describe('createRegenPipeline – kernel ready', () => {
  it('forgets the last state, resets the view with the kernel and regenerates', async () => {
    const h = setup();
    h.studio = aStudio(features(1));
    h.pipeline.request();
    await settle();
    expect(h.pipeline.lastState()).not.toBe(EMPTY_STATE);

    const kernel = createFakeKernel();
    h.viewport.holdSyncs();
    h.pipeline.kernelReady(kernel);
    // A handle of the old kernel must not reach the new one (the STEP export).
    expect(h.pipeline.lastState()).toBe(EMPTY_STATE);
    expect(h.viewport.resets).toEqual([kernel]);
    await settle();
    expect(h.viewport.heldSyncs).toBe(1);
  });

  it('an error while the view is reset goes to reportError', () => {
    const h = setup();
    const failure = new Error('reset failed');
    h.viewport.bodies.reset = () => {
      throw failure;
    };
    h.pipeline.kernelReady(createFakeKernel());
    expect(h.errors).toEqual([failure]);
  });
});

describe('createRegenPipeline – first view', () => {
  // D7 (M19.2): the first finished regeneration decides; later ones never move the camera.
  it('the first regeneration with bodies fits the camera once; later ones do not', async () => {
    const h = setup();
    h.studio = aStudio(features(1));
    h.pipeline.request();
    await settle();
    expect(h.viewport.fitAllCount).toBe(1);
    h.studio = aStudio(features(2));
    h.pipeline.request();
    await settle();
    expect(h.viewport.fitAllCount).toBe(1);
  });

  it('a first regeneration without a body decides too: nothing is ever fitted', async () => {
    const h = setup();
    h.pipeline.request();
    await settle();
    h.studio = aStudio(features(1));
    h.pipeline.request();
    await settle();
    expect(h.pipeline.state.get().bodyCount).toBe(1);
    expect(h.viewport.fitAllCount).toBe(0);
  });

  it('fits only once the view shows the bodies of the first regeneration', async () => {
    const h = setup();
    h.studio = aStudio(features(1));
    h.viewport.holdSyncs();
    h.pipeline.request();
    await settle();
    expect(h.viewport.fitAllCount).toBe(0);
    h.viewport.releaseSyncs();
    await settle();
    expect(h.viewport.fitAllCount).toBe(1);
  });

  it('a kernel restart does not decide again', async () => {
    const h = setup();
    h.studio = aStudio(features(1));
    h.pipeline.request();
    await settle();
    h.pipeline.kernelReady(createFakeKernel());
    await settle();
    expect(h.viewport.fitAllCount).toBe(1);
  });

  it('a regeneration that throws does not decide; the next successful one does', async () => {
    let broken = true;
    const h = setup({
      build: (input, ctx) =>
        broken ? Promise.reject(new Error('builder bug')) : buildCube(input, ctx),
    });
    h.studio = aStudio(features(1));
    h.pipeline.request();
    await settle();
    expect(h.viewport.fitAllCount).toBe(0);
    broken = false;
    h.studio = aStudio(features(2));
    h.pipeline.request();
    await settle();
    expect(h.viewport.fitAllCount).toBe(1);
  });
});

describe('createRegenPipeline – sketch drawings', () => {
  it('draws the sketches of a regeneration under their ids only once its bodies are shown', async () => {
    const h = setup({ build: buildSketch });
    const [f1] = features(1);
    h.studio = aStudio([f1 ?? expect.fail()]);
    h.viewport.holdSyncs();
    h.pipeline.request();
    await settle();
    const id = sketchId(f1?.id ?? expect.fail());
    expect(h.viewport.sketchDrawings.has(id)).toBe(false);
    h.viewport.releaseSyncs();
    await settle();
    expect(h.viewport.sketchDrawings.has(id)).toBe(true);
  });

  it('the edited sketch is not drawn; drawn again when its editing ends', async () => {
    const h = setup({ build: buildSketch });
    const [f1] = features(1);
    if (f1 === undefined) expect.fail();
    const feature = f1.id;
    h.studio = aStudio([f1]);
    h.pipeline.request();
    await settle();
    h.edited.set({ featureId: feature });
    expect(h.viewport.sketchDrawings.has(sketchId(feature))).toBe(false);
    h.edited.set(null);
    expect(h.viewport.sketchDrawings.has(sketchId(feature))).toBe(true);
  });

  it('a sketch that disappears is removed; an unchanged one is not drawn again', async () => {
    const h = setup({ build: buildSketch });
    const [f1, f2] = features(2);
    if (f1 === undefined || f2 === undefined) expect.fail();
    h.studio = aStudio([f1, f2]);
    h.pipeline.request();
    await settle();
    const set = vi.spyOn(h.viewport.sketches, 'set');
    h.studio = aStudio([f1]);
    h.pipeline.request();
    await settle();
    expect(h.viewport.sketchDrawings.has(sketchId(f1.id))).toBe(true);
    expect(h.viewport.sketchDrawings.has(sketchId(f2.id))).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});
