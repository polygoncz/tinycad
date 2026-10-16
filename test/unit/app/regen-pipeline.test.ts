import { describe, expect, it, vi } from 'vitest';
import { ObservableValue, RpcError } from '@/core';
import { bodyId, sketchId } from '@/document';
import type { BodyId, FeatureId, PartStudioData } from '@/document';
import type { RegenSnapshot } from '@/interaction';
import type { ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import type { FeatureBuilder, Regenerator } from '@/regen';
import { EMPTY_STATE } from '@/regen';
import { aRegenSetup, aSketchArtifact, aStudio, buildCube, features } from '@/regen/testing';
import { createRegenPipeline, previewBodies } from '@/app/regen-pipeline';
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
  /** The open feature dialog (M21). */
  readonly dialog: ObservableValue<{ readonly featureId: FeatureId } | null>;
  /** Calls of afterSync. */
  readonly afterSync: { count: number };
}

function setup(opts: { build?: FeatureBuilder['build'] } = {}): Harness {
  const { regenerator } = aRegenSetup(opts);
  const viewport = new FakeAppViewport();
  const regenStatus = createRegenStatusAdapter();
  const edited = new ObservableValue<{ readonly featureId: FeatureId } | null>(null);
  const dialog = new ObservableValue<{ readonly featureId: FeatureId } | null>(null);
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
    dialog,
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
    features: { current: dialog },
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

  it('fills the regions of a drawing from the outlines of the artifact (M30)', async () => {
    // Faces with fake handles: only their count matters; the artifact has no entities, so the
    // regions can come only from its outlines (unit circles named r1, r2).
    // A ShapeHandle is a branded number; the drawing never hands it to a kernel.
    const faces = [1, 2].map((n) => n as ShapeHandle);
    const h = setup({
      build: ({ feature, state }) => {
        const sketch = aSketchArtifact(feature.id, faces);
        return Promise.resolve({
          ok: true,
          state: { artifacts: new Map(state.artifacts).set(sketch.id, sketch) },
          anchors: {},
        });
      },
    });
    const [f1] = features(1);
    h.studio = aStudio([f1 ?? expect.fail()]);
    h.pipeline.request();
    await settle();
    const drawn = h.viewport.sketchDrawings.get(sketchId(f1?.id ?? expect.fail()));
    expect(drawn?.regions?.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(drawn?.regions?.[0]?.outer).toHaveLength(72);
  });
});

describe('createRegenPipeline – open feature dialog (M21, ADR 0025)', () => {
  /** Two boxes, the dialog of the second open: its input is the first box. */
  async function editingSecond(): Promise<{ h: Harness; f1: FeatureId; f2: FeatureId }> {
    const h = setup();
    const [a, b] = features(2);
    if (a === undefined || b === undefined) expect.fail();
    h.studio = aStudio([a, b]);
    h.dialog.set({ featureId: b.id });
    await settle();
    return { h, f1: a.id, f2: b.id };
  }

  it('the main layer shows the input of the edited feature, the preview what it made', async () => {
    const { h, f1, f2 } = await editingSecond();
    expect(idsOf(h.viewport.shown)).toEqual([bodyId(f1)]);
    expect(idsOf(h.viewport.previewShown)).toEqual([bodyId(f2)]);
    const snapshot = h.published.at(-1);
    // bodies stay the final state (Browser, export); the input is what can be picked.
    expect(bodiesOf(snapshot)).toEqual([bodyId(f1), bodyId(f2)]);
    expect(snapshot?.pick.feature).toBe(f2);
    expect(snapshot?.pick.bodies.map((b) => b.body)).toEqual([bodyId(f1)]);
    // The counter and lastState stay the final state.
    expect(h.pipeline.state.get().bodyCount).toBe(2);
    expect(h.pipeline.lastState().artifacts.has(bodyId(f2))).toBe(true);
  });

  it('opening a dialog requests a regeneration without a change of the document', async () => {
    const h = setup();
    h.studio = aStudio(features(2));
    h.pipeline.request();
    await settle();
    expect(h.published).toHaveLength(1);
    h.dialog.set({ featureId: features(2)[1]?.id ?? expect.fail() });
    await settle();
    expect(h.published).toHaveLength(2);
    expect(h.published.at(-1)?.pick.feature).toBe(features(2)[1]?.id);
  });

  it('closing the dialog empties the preview and shows the final state again', async () => {
    const { h, f1, f2 } = await editingSecond();
    h.dialog.set(null);
    await settle();
    expect(idsOf(h.viewport.shown)).toEqual([bodyId(f1), bodyId(f2)]);
    expect(h.viewport.previewShown).toEqual([]);
    const snapshot = h.published.at(-1);
    expect(snapshot?.pick.feature).toBeNull();
    expect(snapshot?.pick.bodies).toBe(snapshot?.bodies);
  });

  it('both layers swap together, before the result is published (D3)', async () => {
    const h = setup();
    const [a, b] = features(2);
    if (a === undefined || b === undefined) expect.fail();
    h.studio = aStudio([a, b]);
    const atPublish: { shown: BodyId[]; preview: BodyId[] }[] = [];
    h.regenStatus.state.subscribe(() => {
      atPublish.push({
        shown: idsOf(h.viewport.shown),
        preview: idsOf(h.viewport.previewShown),
      });
    });
    h.viewport.holdSyncs();
    h.dialog.set({ featureId: b.id });
    await settle();
    // The swap of both layers waits: neither shows its new bodies, nothing is published yet.
    expect(h.viewport.heldSyncs).toBe(1);
    expect(h.viewport.previewShown).toEqual([]);
    expect(h.published).toEqual([]);
    h.viewport.releaseSyncs();
    await settle();
    expect(atPublish).toEqual([{ shown: [bodyId(a.id)], preview: [bodyId(b.id)] }]);
  });

  it('closing the dialog empties the preview in the same swap that shows the result', async () => {
    const { h, f1, f2 } = await editingSecond();
    h.viewport.holdSyncs();
    h.dialog.set(null);
    await settle();
    // The preview keeps the result until the main layer has its meshes (shared cache).
    expect(idsOf(h.viewport.previewShown)).toEqual([bodyId(f2)]);
    h.viewport.releaseSyncs();
    await settle();
    expect(idsOf(h.viewport.shown)).toEqual([bodyId(f1), bodyId(f2)]);
    expect(h.viewport.previewShown).toEqual([]);
  });

  it('a feature behind the bar has no input: the final state and no preview', async () => {
    const h = setup();
    const [a, b] = features(2);
    if (a === undefined || b === undefined) expect.fail();
    h.studio = aStudio([a, b], 1);
    h.dialog.set({ featureId: b.id });
    await settle();
    expect(idsOf(h.viewport.shown)).toEqual([bodyId(a.id)]);
    expect(h.viewport.previewSyncs).toEqual([[]]);
    expect(h.viewport.previewShown).toEqual([]);
    expect(h.published.at(-1)?.pick.feature).toBeNull();
  });

  it('a stale regeneration publishes nothing and syncs no preview', async () => {
    const h = setup();
    const [a, b] = features(2);
    if (a === undefined || b === undefined) expect.fail();
    h.studio = aStudio([a, b]);
    h.viewport.holdSyncs();
    h.dialog.set({ featureId: b.id });
    await settle();
    h.regenerator = aRegenSetup().regenerator;
    h.viewport.releaseSyncs();
    await settle();
    expect(h.published).toEqual([]);
  });

  it('after dispose the dialog requests nothing', async () => {
    const h = setup();
    h.studio = aStudio(features(2));
    h.pipeline.dispose();
    h.dialog.set({ featureId: features(2)[1]?.id ?? expect.fail() });
    await settle();
    expect(h.viewport.syncs).toEqual([]);
  });
});

describe('previewBodies', () => {
  const handle = (n: number): ShapeHandle => n as ShapeHandle;
  const [a, b, c] = features(3).map((f) => bodyId(f.id));
  if (a === undefined || b === undefined || c === undefined) expect.fail();

  it('takes the bodies of the result that the input does not have', () => {
    expect(
      previewBodies(
        [
          { id: a, shape: handle(1) },
          { id: b, shape: handle(2) },
        ],
        [{ id: a, shape: handle(1) }],
      ),
    ).toEqual([{ id: b, shape: handle(2) }]);
  });

  it('takes a body the feature changed: the same id with another handle', () => {
    expect(previewBodies([{ id: a, shape: handle(5) }], [{ id: a, shape: handle(1) }])).toEqual([
      { id: a, shape: handle(5) },
    ]);
  });

  it('leaves out a body the feature consumed and keeps the order of the result', () => {
    expect(
      previewBodies(
        [
          { id: c, shape: handle(3) },
          { id: b, shape: handle(2) },
        ],
        [
          { id: a, shape: handle(1) },
          { id: b, shape: handle(9) },
        ],
      ),
    ).toEqual([
      { id: c, shape: handle(3) },
      { id: b, shape: handle(2) },
    ]);
  });

  it('nothing changed: an empty preview', () => {
    expect(previewBodies([{ id: a, shape: handle(1) }], [{ id: a, shape: handle(1) }])).toEqual([]);
  });
});
