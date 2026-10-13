import { describe, expect, it } from 'vitest';
import type { BodyId } from '@/interaction';
import type { ShapeHandle } from '@/kernel';
import { diffBodies } from './body-diff';

// Branded ids are created by a cast in tests only.
const body = (id: string): BodyId => id as BodyId;
const shape = (n: number): ShapeHandle => n as ShapeHandle;

const A = body('f1/body');
const B = body('f2/body');

describe('diffBodies', () => {
  it('adds everything when nothing is shown', () => {
    const next = [
      { id: A, shape: shape(1) },
      { id: B, shape: shape(2) },
    ];
    expect(diffBodies(new Map(), next)).toEqual({ add: next, remove: [], keep: [] });
  });

  it('keeps bodies with the same id and handle', () => {
    const shown = new Map([
      [A, shape(1)],
      [B, shape(2)],
    ]);
    const next = [
      { id: A, shape: shape(1) },
      { id: B, shape: shape(2) },
    ];
    expect(diffBodies(shown, next)).toEqual({ add: [], remove: [], keep: [A, B] });
  });

  it('removes and adds a body whose handle changed', () => {
    const shown = new Map([
      [A, shape(1)],
      [B, shape(2)],
    ]);
    const next = [
      { id: A, shape: shape(1) },
      { id: B, shape: shape(3) },
    ];
    expect(diffBodies(shown, next)).toEqual({
      add: [{ id: B, shape: shape(3) }],
      remove: [B],
      keep: [A],
    });
  });

  it('removes a body that disappeared', () => {
    const shown = new Map([
      [A, shape(1)],
      [B, shape(2)],
    ]);
    expect(diffBodies(shown, [{ id: B, shape: shape(2) }])).toEqual({
      add: [],
      remove: [A],
      keep: [B],
    });
    expect(diffBodies(shown, [])).toEqual({ add: [], remove: [A, B], keep: [] });
  });

  it('throws on a duplicate BodyId in next', () => {
    const next = [
      { id: A, shape: shape(1) },
      { id: A, shape: shape(2) },
    ];
    expect(() => diffBodies(new Map(), next)).toThrow(/f1\/body/);
  });
});
