import { describe, expect, it } from 'vitest';
import { bodyId } from '@/document';
import type { FeatureId } from '@/document';
import type { ShapeHandle } from '@/kernel';
import { EMPTY_NAMES, EMPTY_STATE, bodiesOf } from './state';
import type { Body, RegenState } from './state';
import { aForeignArtifact } from './testing';

// Feature ids and handles are created by a cast in tests only: the state needs no real shapes.
const fid = (s: string): FeatureId => s as FeatureId;

function aBody(origin: string, shape: number): Body {
  return {
    kind: 'body',
    id: bodyId(fid(origin)),
    origin: fid(origin),
    lastModifiedBy: fid(origin),
    shape: shape as ShapeHandle,
    names: EMPTY_NAMES,
  };
}

describe('EMPTY_STATE', () => {
  it('has no artifacts', () => {
    expect(EMPTY_STATE.artifacts.size).toBe(0);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(EMPTY_STATE)).toBe(true);
  });
});

describe('bodiesOf', () => {
  it('gives no bodies for EMPTY_STATE', () => {
    expect(bodiesOf(EMPTY_STATE)).toEqual([]);
  });

  it('gives the bodies in the order of the map', () => {
    const a = aBody('a', 1);
    const b = aBody('b', 2);
    const state: RegenState = { artifacts: new Map([b, a].map((x) => [x.id, x])) };
    expect(bodiesOf(state)).toEqual([b, a]);
    expect(bodiesOf(state)[0]).toBe(b);
  });

  it('leaves out artifacts of another kind', () => {
    const a = aBody('a', 1);
    const other = aForeignArtifact('s/sketch');
    const b = aBody('b', 2);
    const state: RegenState = { artifacts: new Map([a, other, b].map((x) => [x.id, x])) };
    expect(bodiesOf(state)).toEqual([a, b]);
  });
});

describe('EMPTY_NAMES', () => {
  it('is empty and frozen', () => {
    expect(Object.keys(EMPTY_NAMES)).toEqual([]);
    expect(Object.isFrozen(EMPTY_NAMES)).toBe(true);
  });
});
