import { describe, expect, it } from 'vitest';
import { ORIGIN_PLANE_IDS, bodyId } from '@/document';
import type { BodyId, BodyRef, FeatureId, PlaneId, PlaneRef } from '@/document';
import type { ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { createBuildSession } from './build-context';
import { EMPTY_NAMES, EMPTY_STATE, planesOf } from './state';
import type { Artifact, Body, RegenState } from './state';
import { aSketchArtifact } from './testing';

// Feature ids and handles are created by a cast in tests only: the regen state needs no real
// shapes. Body ids come from bodyId, the one place that mints them (ADR 0015).
const fid = (s: string): FeatureId => s as FeatureId;
const ref = (body: BodyId): BodyRef => ({ kind: 'body', body });
const planeRef = (plane: PlaneId): PlaneRef => ({ kind: 'plane', plane });
const bodyOf = (origin: string): BodyId => bodyId(fid(origin));

function aBody(origin: string, shape: number): Body {
  return {
    kind: 'body',
    id: bodyOf(origin),
    origin: fid(origin),
    lastModifiedBy: fid(origin),
    shape: shape as ShapeHandle,
    names: EMPTY_NAMES,
  };
}

function aState(...artifacts: Artifact[]): RegenState {
  return { artifacts: new Map(artifacts.map((a) => [a.id, a])) };
}

function setup(state: RegenState = EMPTY_STATE) {
  const real = createFakeKernel();
  const owned = new Set<ShapeHandle>();
  return { real, owned, session: createBuildSession({ kernel: real, owned, state }) };
}

describe('createBuildSession', () => {
  it('gives the builder a tracked kernel', async () => {
    const { real, owned, session } = setup();
    expect(session.ctx.kernel).not.toBe(real);
    const { shape } = await session.ctx.kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
    expect([...owned]).toEqual([shape]);
  });

  it('gives the builder a kernel without release (Q041)', () => {
    const { session } = setup();
    // @ts-expect-error -- BuildContext.kernel is a ModelingKernel: a builder cannot release.
    expect(session.ctx.kernel.release).toBeUndefined();
  });

  it('resolves bodies of the input state in the order of refs', () => {
    const a = aBody('f1', 1);
    const b = aBody('f2', 2);
    const { session } = setup(aState(a, b));
    expect(session.ctx.resolveBodies([ref(bodyOf('f2')), ref(bodyOf('f1'))])).toEqual({
      ok: true,
      value: [b, a],
    });
  });

  it('resolves an empty list to an empty array', () => {
    const { session } = setup();
    expect(session.ctx.resolveBodies([])).toEqual({ ok: true, value: [] });
  });

  it('returns the first unresolved reference as RefError', () => {
    const { session } = setup(aState(aBody('f1', 1)));
    const missing = ref(bodyOf('f2'));
    const result = session.ctx.resolveBodies([ref(bodyOf('f1')), missing, ref(bodyOf('f3'))]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(missing);
    expect(result.error.message).toMatch(/f2\/body/);
  });

  it('returns a RefError for an id under which there is an artifact of another kind', () => {
    const other = aSketchArtifact('s1');
    const { session } = setup(aState(aBody('f1', 1), other));
    // A sketch id where a body id belongs: the kind check, not the id type, rejects it.
    const notBody = ref(other.id as string as BodyId);
    const result = session.ctx.resolveBodies([ref(bodyOf('f1')), notBody]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(notBody);
    expect(result.error.message).toMatch(/s1\/sketch/);
  });

  it('resolves the origin planes of EMPTY_STATE in the order of refs', () => {
    const [xy, , yz] = planesOf(EMPTY_STATE);
    const { session } = setup();
    expect(
      session.ctx.resolvePlanes([planeRef(ORIGIN_PLANE_IDS.yz), planeRef(ORIGIN_PLANE_IDS.xy)]),
    ).toEqual({ ok: true, value: [yz, xy] });
  });

  it('resolves the planes as the very artifacts of the state', () => {
    const { session } = setup();
    const result = session.ctx.resolvePlanes([planeRef(ORIGIN_PLANE_IDS.xz)]);
    expect(result.ok && result.value[0]).toBe(EMPTY_STATE.artifacts.get(ORIGIN_PLANE_IDS.xz));
  });

  it('resolves an empty list of planes to an empty array', () => {
    expect(setup().session.ctx.resolvePlanes([])).toEqual({ ok: true, value: [] });
  });

  it('returns the first missing plane as RefError', () => {
    const { session } = setup();
    // An id in the shape of a plane id that no artifact has.
    const missing = planeRef('origin/plane:ab' as PlaneId);
    const result = session.ctx.resolvePlanes([
      planeRef(ORIGIN_PLANE_IDS.xy),
      missing,
      planeRef('origin/plane:cd' as PlaneId),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(missing);
    expect(result.error.message).toMatch(/origin\/plane:ab/);
  });

  it('returns a RefError for the id of a body given as a plane', () => {
    const { session } = setup(aState(...planesOf(EMPTY_STATE), aBody('f1', 1)));
    // A body id where a plane id belongs: the kind check, not the id shape, rejects it.
    const notPlane = planeRef(bodyOf('f1') as string as PlaneId);
    const result = session.ctx.resolvePlanes([notPlane]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(notPlane);
    expect(result.error.message).toMatch(/f1\/body/);
  });

  it('resolveBodies gives a RefError for the id of a plane', () => {
    const { session } = setup();
    // A plane id where a body id belongs: the kind check rejects it.
    const notBody = ref(ORIGIN_PLANE_IDS.xy as string as BodyId);
    const result = session.ctx.resolveBodies([notBody]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(notBody);
  });

  it('has no warnings when warn is not called', () => {
    expect(setup().session.warnings()).toBeUndefined();
  });

  it('joins several warnings with a newline in call order', () => {
    const { session } = setup();
    session.ctx.warn('first');
    session.ctx.warn('second');
    expect(session.warnings()).toBe('first\nsecond');
  });
});
