import { describe, expect, it } from 'vitest';
import type { BodyId } from '@/interaction';
import type { MeshData, MeshOps, MeshQuality, ShapeHandle } from '@/kernel';
import { createSceneSync } from '@/render/scene-sync';
import type { ScenePlan } from '@/render/scene-sync';

// Branded ids are created by a cast in tests only.
const body = (id: string): BodyId => id as BodyId;
const shape = (n: number): ShapeHandle => n as ShapeHandle;

const A = body('f1/body');
const B = body('f2/body');
const QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };

/** A small hand-made mesh; face keys deliberately out of order. Tagged by `tag` in positions. */
function aMesh(tag: number): MeshData {
  return {
    positions: new Float32Array([tag, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    faceRanges: new Uint32Array([1, 0, 1, 0, 1, 1]),
    edgePositions: new Float32Array([0, 0, 0, 1, 0, 0]),
    edgeRanges: new Uint32Array([0, 0, 2]),
  };
}

interface Call {
  readonly shape: ShapeHandle;
  readonly resolve: (m: MeshData) => void;
  readonly reject: (e: unknown) => void;
}

/** MeshOps whose tessellate returns deferred promises settled by the test in any order. */
function manualMeshes() {
  const calls: Call[] = [];
  const meshes: MeshOps = {
    tessellate: (s) =>
      new Promise<MeshData>((resolve, reject) => {
        calls.push({ shape: s, resolve, reject });
      }),
  };
  const callFor = (s: ShapeHandle): Call => {
    const found = calls.filter((c) => c.shape === s);
    const last = found[found.length - 1];
    if (last === undefined) throw new Error(`no tessellate call for ${String(s)}`);
    return last;
  };
  return { meshes, calls, callFor };
}

function setup(meshes: MeshOps) {
  const plans: ScenePlan[] = [];
  const errors: { body: BodyId; error: unknown }[] = [];
  const sync = createSceneSync({
    meshes,
    quality: QUALITY,
    reportError: (b, error) => errors.push({ body: b, error }),
    apply: (plan) => plans.push(plan),
  });
  return { sync, plans, errors };
}

describe('createSceneSync', () => {
  it('first sync adds every body in one plan', async () => {
    const k = manualMeshes();
    const { sync, plans } = setup(k.meshes);
    const done = sync.sync([
      { id: A, shape: shape(1) },
      { id: B, shape: shape(2) },
    ]);
    const m1 = aMesh(1);
    const m2 = aMesh(2);
    // Settled in reverse order: the plan still waits for all and keeps the body order.
    k.callFor(shape(2)).resolve(m2);
    k.callFor(shape(1)).resolve(m1);
    await done;
    expect(plans).toEqual([
      {
        remove: [],
        add: [
          { id: A, shape: shape(1), mesh: m1 },
          { id: B, shape: shape(2), mesh: m2 },
        ],
      },
    ]);
  });

  it('does not apply when the second sync has the same handles', async () => {
    const k = manualMeshes();
    const { sync, plans } = setup(k.meshes);
    const bodies = [{ id: A, shape: shape(1) }];
    const first = sync.sync(bodies);
    k.callFor(shape(1)).resolve(aMesh(1));
    await first;
    await sync.sync(bodies);
    expect(plans).toHaveLength(1);
    expect(k.calls).toHaveLength(1);
  });

  it('replaces a body whose handle changed and removes a disappeared one', async () => {
    const k = manualMeshes();
    const { sync, plans } = setup(k.meshes);
    const first = sync.sync([
      { id: A, shape: shape(1) },
      { id: B, shape: shape(2) },
    ]);
    k.callFor(shape(1)).resolve(aMesh(1));
    k.callFor(shape(2)).resolve(aMesh(2));
    await first;

    const second = sync.sync([{ id: A, shape: shape(3) }]);
    const m3 = aMesh(3);
    k.callFor(shape(3)).resolve(m3);
    await second;
    expect(plans[1]).toEqual({ remove: [A, B], add: [{ id: A, shape: shape(3), mesh: m3 }] });
  });

  it('applies only the newer of two concurrent syncs', async () => {
    const k = manualMeshes();
    const { sync, plans } = setup(k.meshes);
    const older = sync.sync([{ id: A, shape: shape(1) }]);
    const newer = sync.sync([{ id: A, shape: shape(2) }]);
    const m2 = aMesh(2);
    k.callFor(shape(2)).resolve(m2);
    await newer;
    k.callFor(shape(1)).resolve(aMesh(1));
    await older;
    expect(plans).toEqual([{ remove: [], add: [{ id: A, shape: shape(2), mesh: m2 }] }]);
  });

  it('drops the result of a sync running during reset', async () => {
    const k = manualMeshes();
    const { sync, plans } = setup(k.meshes);
    const running = sync.sync([{ id: A, shape: shape(1) }]);
    const k2 = manualMeshes();
    sync.reset(k2.meshes);
    k.callFor(shape(1)).resolve(aMesh(1));
    await running;
    // Nothing was shown, so reset had nothing to remove either.
    expect(plans).toEqual([]);
  });

  it('reset removes every shown body and tessellates with the new MeshOps', async () => {
    const k = manualMeshes();
    const { sync, plans } = setup(k.meshes);
    const first = sync.sync([{ id: A, shape: shape(1) }]);
    k.callFor(shape(1)).resolve(aMesh(1));
    await first;

    const k2 = manualMeshes();
    sync.reset(k2.meshes);
    expect(plans[1]).toEqual({ remove: [A], add: [] });

    // The new kernel numbers handles again: the same handle is tessellated anew and added.
    const again = sync.sync([{ id: A, shape: shape(1) }]);
    expect(k.calls).toHaveLength(1);
    const m = aMesh(9);
    k2.callFor(shape(1)).resolve(m);
    await again;
    expect(plans[2]).toEqual({ remove: [], add: [{ id: A, shape: shape(1), mesh: m }] });
  });

  it('tessellates a handle once when two concurrent syncs need it', async () => {
    const k = manualMeshes();
    const { sync, plans } = setup(k.meshes);
    const older = sync.sync([{ id: A, shape: shape(1) }]);
    const newer = sync.sync([
      { id: A, shape: shape(1) },
      { id: B, shape: shape(2) },
    ]);
    expect(k.calls.map((c) => c.shape)).toEqual([shape(1), shape(2)]);
    k.callFor(shape(1)).resolve(aMesh(1));
    k.callFor(shape(2)).resolve(aMesh(2));
    await Promise.all([older, newer]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.add.map((a) => a.id)).toEqual([A, B]);
  });

  it('reports a tessellation error of the current generation and shows the others', async () => {
    const k = manualMeshes();
    const { sync, plans, errors } = setup(k.meshes);
    const first = sync.sync([
      { id: A, shape: shape(1) },
      { id: B, shape: shape(2) },
    ]);
    k.callFor(shape(1)).resolve(aMesh(1));
    k.callFor(shape(2)).resolve(aMesh(2));
    await first;

    const second = sync.sync([
      { id: A, shape: shape(3) },
      { id: B, shape: shape(4) },
    ]);
    const failure = new Error('tessellation failed');
    const m4 = aMesh(4);
    k.callFor(shape(3)).reject(failure);
    k.callFor(shape(4)).resolve(m4);
    await second;
    expect(errors).toEqual([{ body: A, error: failure }]);
    // A's old view is removed (its handle changed), the new one is not shown.
    expect(plans[1]).toEqual({ remove: [A, B], add: [{ id: B, shape: shape(4), mesh: m4 }] });

    // A is not shown, so the same handle is tried again (the failed promise left the cache).
    const third = sync.sync([
      { id: A, shape: shape(3) },
      { id: B, shape: shape(4) },
    ]);
    const m3 = aMesh(3);
    k.callFor(shape(3)).resolve(m3);
    await third;
    expect(plans[2]).toEqual({ remove: [], add: [{ id: A, shape: shape(3), mesh: m3 }] });
  });

  it('drops a tessellation error of a stale generation', async () => {
    const k = manualMeshes();
    const { sync, plans, errors } = setup(k.meshes);
    const older = sync.sync([{ id: A, shape: shape(1) }]);
    const newer = sync.sync([{ id: A, shape: shape(2) }]);
    k.callFor(shape(2)).resolve(aMesh(2));
    await newer;
    k.callFor(shape(1)).reject(new Error('unknown-handle'));
    await older;
    expect(errors).toEqual([]);
    expect(plans).toHaveLength(1);
  });

  it('forgets handles not in the last sync, so an old handle is tessellated again', async () => {
    const k = manualMeshes();
    const { sync } = setup(k.meshes);
    const first = sync.sync([{ id: A, shape: shape(1) }]);
    k.callFor(shape(1)).resolve(aMesh(1));
    await first;
    const second = sync.sync([{ id: A, shape: shape(2) }]);
    k.callFor(shape(2)).resolve(aMesh(2));
    await second;

    void sync.sync([{ id: A, shape: shape(1) }]);
    expect(k.calls.map((c) => c.shape)).toEqual([shape(1), shape(2), shape(1)]);
  });

  it('keeps meshes of kept handles in the cache', async () => {
    const k = manualMeshes();
    const { sync } = setup(k.meshes);
    const first = sync.sync([{ id: A, shape: shape(1) }]);
    k.callFor(shape(1)).resolve(aMesh(1));
    await first;
    const second = sync.sync([
      { id: A, shape: shape(1) },
      { id: B, shape: shape(2) },
    ]);
    k.callFor(shape(2)).resolve(aMesh(2));
    await second;

    // B shows handle 1 now: served from the cache, no new tessellate.
    void sync.sync([{ id: B, shape: shape(1) }]);
    expect(k.calls).toHaveLength(2);
  });

  it('never rejects, even when every tessellation fails', async () => {
    const k = manualMeshes();
    const { sync, plans, errors } = setup(k.meshes);
    const done = sync.sync([{ id: A, shape: shape(1) }]);
    k.callFor(shape(1)).reject(new Error('worker crashed'));
    await expect(done).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    // Nothing to remove and nothing to add: no apply.
    expect(plans).toEqual([]);
  });

  it('throws on a duplicate BodyId and leaves a running sync valid', async () => {
    const k = manualMeshes();
    const { sync, plans } = setup(k.meshes);
    const running = sync.sync([{ id: A, shape: shape(1) }]);
    expect(() =>
      sync.sync([
        { id: B, shape: shape(2) },
        { id: B, shape: shape(3) },
      ]),
    ).toThrow(/duplicate BodyId/);
    k.callFor(shape(1)).resolve(aMesh(1));
    await running;
    expect(plans).toHaveLength(1);
  });
});
