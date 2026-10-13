import { describe, expect, it } from 'vitest';
import { bodyId } from '@/document';
import type { BodyId, BodyRef, FeatureId } from '@/document';
import type { ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { createBuildSession } from './build-context';
import { EMPTY_NAMES, EMPTY_STATE } from './state';
import type { Artifact, Body, RegenState } from './state';
import { aForeignArtifact } from './testing';

// Feature ids and handles are created by a cast in tests only: the regen state needs no real
// shapes. Body ids come from bodyId, the one place that mints them (ADR 0015).
const fid = (s: string): FeatureId => s as FeatureId;
const ref = (body: BodyId): BodyRef => ({ kind: 'body', body });
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
    const other = aForeignArtifact('s1/sketch');
    const { session } = setup(aState(aBody('f1', 1), other));
    const notBody = ref(other.id);
    const result = session.ctx.resolveBodies([ref(bodyOf('f1')), notBody]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(notBody);
    expect(result.error.message).toMatch(/s1\/sketch/);
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
