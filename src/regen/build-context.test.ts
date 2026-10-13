import { describe, expect, it } from 'vitest';
import type { BodyId, BodyRef, FeatureId } from '@/document';
import type { ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { createBuildSession } from './build-context';
import { EMPTY_NAMES, EMPTY_STATE } from './state';
import type { Body, RegenState } from './state';

// Ids and handles are created by a cast in tests only: the regen state needs no real shapes.
const bodyId = (s: string): BodyId => s as BodyId;
const ref = (s: string): BodyRef => ({ kind: 'body', body: bodyId(s) });

function aBody(id: string, shape: number): Body {
  return {
    id: bodyId(id),
    shape: shape as ShapeHandle,
    createdBy: id.split('/')[0] as FeatureId,
    names: EMPTY_NAMES,
  };
}

function aState(...bodies: Body[]): RegenState {
  return { bodies: new Map(bodies.map((b) => [b.id, b])) };
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
    const a = aBody('f1/body', 1);
    const b = aBody('f2/body', 2);
    const { session } = setup(aState(a, b));
    expect(session.ctx.resolveBodies([ref('f2/body'), ref('f1/body')])).toEqual({
      ok: true,
      value: [b, a],
    });
  });

  it('resolves an empty list to an empty array', () => {
    const { session } = setup();
    expect(session.ctx.resolveBodies([])).toEqual({ ok: true, value: [] });
  });

  it('returns the first unresolved reference as RefError', () => {
    const { session } = setup(aState(aBody('f1/body', 1)));
    const missing = ref('f2/body');
    const result = session.ctx.resolveBodies([ref('f1/body'), missing, ref('f3/body')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(missing);
    expect(result.error.message).toMatch(/f2\/body/);
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
