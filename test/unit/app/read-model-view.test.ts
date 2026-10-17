import { describe, expect, it } from 'vitest';
import { ObservableValue } from '@/core';
import type { BodyId, FeatureId, PlaneId, TopoName } from '@/document';
import type { RegenSnapshot } from '@/interaction';
import type { MeshQuality, ShapeHandle } from '@/kernel';
import type { ReadModelData } from '@/remote';
import { aBodyView, aReadModel, aSketchView, decodeReadModel, listValue } from '@/remote/testing';
import type { ReadModelOverrides } from '@/remote/testing';
import { createReadModelView, previewBodies } from '@/app/read-model-view';
import type { ReadModelView } from '@/app/read-model-view';
import { createVersionMeshes } from '@/app/version-meshes';
import type { VersionMeshes } from '@/app/version-meshes';
import { FakeAppViewport, settle } from '@/app/testing';

const QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };
// Ids of the test read models, as the server sends them.
const F1 = 'f1' as FeatureId;
const F2 = 'f2' as FeatureId;
const BOX = 'f1/body' as BodyId;
const CYL = 'f2/body' as BodyId;

/** A read model decoded from the protocol, as RemoteSession hands it. */
const readModel = (overrides: ReadModelOverrides = {}): ReadModelData =>
  decodeReadModel(aReadModel(overrides));

/** The two bodies BOX (version vBox) and CYL (version vCyl), in generation `generation`. */
function twoBodies(generation = 1, versions = { box: 'vBox', cyl: 'vCyl' }): ReadModelData {
  return readModel({
    regen: {
      generation: BigInt(generation),
      final: {
        bodies: [
          aBodyView({ contentVersion: versions.box }),
          aBodyView({ bodyId: CYL, origin: F2, lastModifiedBy: F2, contentVersion: versions.cyl }),
        ],
      },
      durationMs: 12,
    },
  });
}

/** A valid sketch of spec 12: two points and a line between them. */
const SKETCH_ENTITIES = listValue([
  { kind: 'point', id: 'p1', x: 0, y: 0 },
  { kind: 'point', id: 'p2', x: 1, y: 0 },
  { kind: 'line', id: 'a', p1: 'p1', p2: 'p2' },
]);

interface Harness {
  readonly view: ReadModelView;
  readonly viewport: FakeAppViewport;
  readonly meshes: VersionMeshes;
  readonly dialog: ObservableValue<{ readonly featureId: FeatureId } | null>;
  readonly edited: ObservableValue<{ readonly featureId: FeatureId } | null>;
  readonly pending: ObservableValue<number>;
  readonly published: RegenSnapshot[];
  /** How many syncs the viewport had got when each snapshot was published. */
  readonly syncsAtPublish: number[];
  readonly errors: unknown[];
  readonly afterSync: { count: number };
}

function setup(): Harness {
  const viewport = new FakeAppViewport();
  const meshes = createVersionMeshes();
  const dialog = new ObservableValue<{ readonly featureId: FeatureId } | null>(null);
  const edited = new ObservableValue<{ readonly featureId: FeatureId } | null>(null);
  const pending = new ObservableValue(0);
  const errors: unknown[] = [];
  const afterSync = { count: 0 };
  const view = createReadModelView({
    meshes,
    viewport,
    features: { current: dialog.asObservable() },
    sketches: { current: edited.asObservable() },
    pending: pending.asObservable(),
    afterSync: () => {
      afterSync.count += 1;
    },
    reportError: (e) => errors.push(e),
  });
  const published: RegenSnapshot[] = [];
  const syncsAtPublish: number[] = [];
  view.state.subscribe(() => {
    published.push(view.state.get());
    syncsAtPublish.push(viewport.syncs.length);
  });
  return {
    view,
    viewport,
    meshes,
    dialog,
    edited,
    pending,
    published,
    syncsAtPublish,
    errors,
    afterSync,
  };
}

describe('createReadModelView', () => {
  it('hands the meshes to the view once, at the start', () => {
    const h = setup();
    expect(h.viewport.resets).toEqual([h.meshes]);
  });

  it('puts two meshes and syncs the layers before it publishes', async () => {
    const h = setup();
    h.viewport.holdSyncs();
    h.view.show(twoBodies());
    expect(h.meshes.versions()).toEqual(['vBox', 'vCyl']);
    expect(h.viewport.syncs).toEqual([
      [
        { id: BOX, shape: h.meshes.handleOf('vBox') },
        { id: CYL, shape: h.meshes.handleOf('vCyl') },
      ],
    ]);
    await settle();
    expect(h.published).toEqual([]);
    h.viewport.releaseSyncs();
    await settle();
    expect(h.syncsAtPublish).toEqual([1]);
    expect(h.published[0]?.bodies.map((b) => b.body)).toEqual([BOX, CYL]);
    expect(h.errors).toEqual([]);
  });

  it('serves the meshes of the read model through the handles of the view', async () => {
    const h = setup();
    const model = twoBodies();
    h.view.show(model);
    await settle();
    const handle = h.viewport.shown[0]?.shape;
    expect(handle).toBeDefined();
    if (handle === undefined) return;
    await expect(h.meshes.tessellate(handle, QUALITY)).resolves.toBe(
      model.regen.final.bodies[0]?.mesh,
    );
  });

  it('keeps the handle and adds no mesh for the same versions again', async () => {
    const h = setup();
    const first = twoBodies(1);
    h.view.show(first);
    await settle();
    // The server omits the mesh of a version the client listed in known_meshes.
    h.view.show(
      readModel({
        regen: {
          generation: 2n,
          final: {
            bodies: [
              aBodyView({ contentVersion: 'vBox', mesh: undefined }),
              aBodyView({
                bodyId: CYL,
                origin: F2,
                lastModifiedBy: F2,
                contentVersion: 'vCyl',
                mesh: undefined,
              }),
            ],
          },
        },
      }),
    );
    await settle();
    expect(h.viewport.syncs[1]).toEqual(h.viewport.syncs[0]);
    expect(h.meshes.versions()).toEqual(['vBox', 'vCyl']);
    await expect(h.meshes.tessellate(h.meshes.handleOf('vBox'), QUALITY)).resolves.toBe(
      first.regen.final.bodies[0]?.mesh,
    );
  });

  it('gives a changed body a new handle and drops its old version', async () => {
    const h = setup();
    h.view.show(twoBodies(1));
    await settle();
    h.view.show(twoBodies(2, { box: 'vBox2', cyl: 'vCyl' }));
    await settle();
    const [before, after] = h.viewport.syncs;
    expect(after?.[0]?.shape).not.toBe(before?.[0]?.shape);
    expect(after?.[1]?.shape).toBe(before?.[1]?.shape);
    expect(h.meshes.versions()).toEqual(['vCyl', 'vBox2']);
    await expect(h.meshes.tessellate(h.meshes.handleOf('vBox'), QUALITY)).rejects.toThrow();
  });

  // The session orders read models (N136) and starts again after a restart of the server, when
  // the generation may drop: the view shows whatever it is given.
  it('shows a read model of a lower generation too (the session decides the order)', async () => {
    const h = setup();
    h.view.show(twoBodies(3));
    await settle();
    h.view.show(twoBodies(1, { box: 'vBox2', cyl: 'vCyl2' }));
    await settle();
    expect(h.viewport.syncs).toHaveLength(2);
    expect(h.published).toHaveLength(2);
    expect(h.meshes.versions()).toEqual(['vBox2', 'vCyl2']);
  });

  it('publishes only the newest of two syncs under way', async () => {
    const h = setup();
    h.viewport.holdSyncs();
    h.view.show(twoBodies(1));
    h.view.show(twoBodies(2, { box: 'vBox2', cyl: 'vCyl' }));
    h.viewport.releaseSyncs();
    await settle();
    expect(h.published).toHaveLength(1);
    expect(h.published[0]?.generation).toBe(1);
    expect(h.view.ui.get().bodyCount).toBe(2);
  });

  describe('with the input of an edited feature (ADR 0025)', () => {
    /** The final state: BOX changed by F2 (vBox2) and CYL; the input before F2: BOX as vBox. */
    const withInput = (generation = 1): ReadModelData =>
      readModel({
        regen: {
          generation: BigInt(generation),
          final: {
            bodies: [
              aBodyView({ contentVersion: 'vBox2', lastModifiedBy: F2 }),
              aBodyView({
                bodyId: CYL,
                origin: F2,
                lastModifiedBy: F2,
                contentVersion: 'vCyl',
              }),
            ],
          },
          input: { featureId: F2, state: { bodies: [aBodyView({ contentVersion: 'vBox' })] } },
        },
      });

    it('shows the input as the main layer and the changed bodies as the preview', async () => {
      const h = setup();
      h.dialog.set({ featureId: F2 });
      h.view.show(withInput());
      await settle();
      expect(h.viewport.shown).toEqual([{ id: BOX, shape: h.meshes.handleOf('vBox') }]);
      expect(h.viewport.previewShown).toEqual([
        { id: BOX, shape: h.meshes.handleOf('vBox2') },
        { id: CYL, shape: h.meshes.handleOf('vCyl') },
      ]);
      const snapshot = h.published.at(-1);
      expect(snapshot?.pick.feature).toBe(F2);
      expect(snapshot?.pick.bodies.map((b) => b.body)).toEqual([BOX]);
      expect(snapshot?.bodies.map((b) => b.body)).toEqual([BOX, CYL]);
      expect(h.meshes.versions()).toEqual(['vBox2', 'vCyl', 'vBox']);
    });

    it('shows the final state once the dialog closes', async () => {
      const h = setup();
      h.dialog.set({ featureId: F2 });
      h.view.show(withInput());
      await settle();
      h.dialog.set(null);
      await settle();
      expect(h.viewport.shown.map((b) => b.id)).toEqual([BOX, CYL]);
      expect(h.viewport.previewShown).toEqual([]);
      expect(h.published.at(-1)?.pick.feature).toBeNull();
    });

    it('ignores an input of another feature than the dialog', async () => {
      const h = setup();
      h.dialog.set({ featureId: F1 });
      h.view.show(withInput());
      await settle();
      expect(h.viewport.shown.map((b) => b.shape)).toEqual([
        h.meshes.handleOf('vBox2'),
        h.meshes.handleOf('vCyl'),
      ]);
      expect(h.viewport.previewShown).toEqual([]);
    });
  });

  it('turns the names of a body into TopoNames', async () => {
    const h = setup();
    h.view.show(
      readModel({
        regen: {
          final: {
            bodies: [
              aBodyView({
                faceNames: ['face:top', '', 'face:top'],
                edgeNames: ['', 'edge:a'],
              }),
            ],
          },
        },
      }),
    );
    await settle();
    const names = h.published[0]?.bodies[0]?.names;
    expect(names?.nameOfFace(0)).toBe('face:top');
    expect(names?.nameOfFace(1)).toBeUndefined();
    expect(names?.nameOfFace(7)).toBeUndefined();
    expect(names?.faces('face:top' as TopoName)).toEqual([0, 2]);
    expect(names?.faces('face:none' as TopoName)).toEqual([]);
    expect(names?.nameOfEdge(0)).toBeUndefined();
    expect(names?.nameOfEdge(1)).toBe('edge:a');
    expect(names?.edges('edge:a' as TopoName)).toEqual([1]);
    expect(h.published[0]?.bodies[0]?.feature).toBe(F1);
  });

  it('maps the statuses, anchors and sketches into the snapshot', async () => {
    const h = setup();
    h.view.show(
      readModel({
        regen: {
          statuses: {
            f1: { kind: { case: 'ok', value: {} } },
            f2: { kind: { case: 'warning', value: { message: 'odd' } } },
            f3: { kind: { case: 'suppressed', value: {} } },
            f4: { kind: { case: 'rolledBack', value: {} } },
          },
          anchors: { f1: { anchors: { pivot: { point: { x: 1, y: 2, z: 3 } } } } },
          final: { sketches: [aSketchView({ entities: SKETCH_ENTITIES })] },
        },
      }),
    );
    await settle();
    const snapshot = h.published[0];
    expect(snapshot?.generation).toBe(1);
    expect([...(snapshot?.health ?? [])]).toEqual([
      ['f1', { kind: 'ok' }],
      ['f2', { kind: 'warning', message: 'odd' }],
    ]);
    expect(snapshot?.anchors.get(F1)).toEqual({ pivot: { point: [1, 2, 3] } });
    expect(snapshot?.sketches).toEqual([
      { sketch: 'f2/sketch', feature: F2, regions: ['a,b,c,d'] },
    ]);
  });

  it('draws every sketch but the edited one', async () => {
    const h = setup();
    h.view.show(
      readModel({
        regen: {
          final: {
            sketches: [
              aSketchView({ entities: SKETCH_ENTITIES }),
              aSketchView({ sketchId: 'f3/sketch', featureId: 'f3', entities: SKETCH_ENTITIES }),
            ],
          },
        },
      }),
    );
    await settle();
    expect([...h.viewport.sketchDrawings.keys()]).toEqual(['f2/sketch', 'f3/sketch']);
    const drawing = h.viewport.sketchDrawings.get('f2/sketch');
    expect(drawing?.curves.map((c) => c.id)).toEqual(['a']);
    expect(drawing?.regions?.map((r) => r.id)).toEqual(['a,b,c,d']);
    h.edited.set({ featureId: F2 });
    expect([...h.viewport.sketchDrawings.keys()]).toEqual(['f3/sketch']);
    h.edited.set(null);
    expect([...h.viewport.sketchDrawings.keys()]).toEqual(['f3/sketch', 'f2/sketch']);
    expect(h.errors).toEqual([]);
  });

  it('reports a sketch it cannot read and does not draw it', async () => {
    const h = setup();
    h.view.show(readModel({ regen: { final: { sketches: [aSketchView()] } } }));
    await settle();
    expect(h.viewport.sketchDrawings.size).toBe(0);
    expect(h.errors).toHaveLength(1);
  });

  it('a drawn sketch whose next version it cannot read is removed, not left stale', async () => {
    const h = setup();
    h.view.show(
      readModel({ regen: { final: { sketches: [aSketchView({ entities: SKETCH_ENTITIES })] } } }),
    );
    await settle();
    expect([...h.viewport.sketchDrawings.keys()]).toEqual(['f2/sketch']);
    h.view.show(readModel({ regen: { final: { sketches: [aSketchView()] } } }));
    await settle();
    expect(h.viewport.sketchDrawings.size).toBe(0);
    expect(h.errors).toHaveLength(1);
  });

  it('keeps RegenUiState, afterSync and the first view', async () => {
    const h = setup();
    expect(h.view.ui.get()).toEqual({ busy: false, bodyCount: 0, lastMs: null, failed: null });
    h.pending.set(1);
    expect(h.view.ui.get().busy).toBe(true);
    h.view.show(twoBodies(1));
    await settle();
    expect(h.view.ui.get()).toEqual({ busy: true, bodyCount: 2, lastMs: 12, failed: null });
    expect(h.afterSync.count).toBe(1);
    expect(h.viewport.fitAllCount).toBe(1);
    h.pending.set(0);
    h.view.show(twoBodies(2));
    await settle();
    expect(h.view.ui.get().busy).toBe(false);
    expect(h.afterSync.count).toBe(2);
    expect(h.viewport.fitAllCount).toBe(1);
  });

  it('does not fit an empty first view, nor a later one', async () => {
    const h = setup();
    h.view.show(readModel());
    await settle();
    h.view.show(twoBodies(2));
    await settle();
    expect(h.viewport.fitAllCount).toBe(0);
  });

  describe('planes for the sketcher', () => {
    const XY = 'origin/plane:xy' as PlaneId;
    const withPlanes = (): ReadModelData =>
      readModel({
        regen: {
          final: {
            planes: [
              {
                planeId: XY,
                owner: 'origin',
                plane: {
                  origin: { x: 0, y: 0, z: 0 },
                  normal: { x: 0, y: 0, z: 1 },
                  xDir: { x: 1, y: 0, z: 0 },
                },
              },
            ],
            // aBodyView: face 0 'face:top' planar at z = 1, face 1 unnamed and not planar.
            bodies: [aBodyView({ faceNames: ['face:top', 'face:side'] })],
            sketches: [aSketchView({ entities: SKETCH_ENTITIES })],
          },
        },
      });

    it('resolves nothing before the first read model', () => {
      const h = setup();
      expect(h.view.resolvePlane({ kind: 'plane', plane: XY })).toBeUndefined();
      expect(h.view.planeOfSketch(F2)).toBeUndefined();
    });

    it('resolves an origin plane, a planar face and not a curved face', async () => {
      const h = setup();
      h.view.show(withPlanes());
      await settle();
      expect(h.view.resolvePlane({ kind: 'plane', plane: XY })).toEqual({
        origin: [0, 0, 0],
        normal: [0, 0, 1],
        xDir: [1, 0, 0],
      });
      expect(
        h.view.resolvePlane({ kind: 'topo', body: BOX, name: 'face:top' as TopoName }),
      ).toEqual({ origin: [0, 0, 1], normal: [0, 0, 1], xDir: [1, 0, 0] });
      expect(
        h.view.resolvePlane({ kind: 'topo', body: BOX, name: 'face:side' as TopoName }),
      ).toBeUndefined();
      expect(
        h.view.resolvePlane({ kind: 'topo', body: CYL, name: 'face:top' as TopoName }),
      ).toBeUndefined();
      expect(
        h.view.resolvePlane({ kind: 'plane', plane: 'f9/plane:a' as PlaneId }),
      ).toBeUndefined();
    });

    it('gives the plane of the sketch of a feature', async () => {
      const h = setup();
      h.view.show(withPlanes());
      await settle();
      expect(h.view.planeOfSketch(F2)).toEqual({
        origin: [0, 0, 0],
        normal: [0, 0, 1],
        xDir: [1, 0, 0],
      });
      expect(h.view.planeOfSketch(F1)).toBeUndefined();
    });
  });

  it('shows nothing more once disposed', async () => {
    const h = setup();
    h.view.dispose();
    h.view.show(twoBodies());
    await settle();
    expect(h.viewport.syncs).toEqual([]);
    expect(h.published).toEqual([]);
  });
});

describe('previewBodies', () => {
  // Handles and ids of the tests are created by a cast at one place.
  const handle = (n: number): ShapeHandle => n as ShapeHandle;
  const a = 'a/body' as BodyId;
  const b = 'b/body' as BodyId;
  const c = 'c/body' as BodyId;

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
