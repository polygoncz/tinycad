import type { BodyId, ParamSpec } from '@/document';
import { describe, expect, it } from 'vitest';
import { pickFilterFor } from './ref-pick-tool';
import { toggleBodyRef } from './ref-values';

describe('pickFilterFor', () => {
  it('bodies: a hit on anything is the body, so faces and edges', () => {
    const spec: ParamSpec = { kind: 'bodies', label: 'Targets' };
    expect([...pickFilterFor(spec)].sort()).toEqual(['edge', 'face']);
  });

  it.each([
    ['face', ['face']],
    ['edge', ['edge']],
    // Vertices are not pickable until M14.
    ['vertex', []],
  ] as const)('topo with entity %s → %j', (entity, filter) => {
    const spec: ParamSpec = { kind: 'topo', label: 'Entities', entity };
    expect(pickFilterFor(spec)).toEqual(filter);
  });

  it('region: nothing, sketch regions are not pickable yet', () => {
    expect(pickFilterFor({ kind: 'region', label: 'Profile' })).toEqual([]);
  });

  it.each<ParamSpec>([
    { kind: 'length', label: 'Width', default: 10 },
    { kind: 'angle', label: 'Angle', default: 0 },
    { kind: 'number', label: 'Count', default: 1 },
    { kind: 'boolean', label: 'Flip', default: false },
    { kind: 'enum', label: 'Mode', default: 'a', options: [{ value: 'a', label: 'A' }] },
    { kind: 'point', label: 'Origin', default: [0, 0, 0] },
  ])('a value param ($kind) picks nothing', (spec) => {
    expect(pickFilterFor(spec)).toEqual([]);
  });
});

describe('toggleBodyRef', () => {
  const body = (id: string): BodyId => id as BodyId; // test ids are trusted
  const ref = (id: string) => ({ kind: 'body', body: body(id) });

  it('adds the body at the end as a frozen reference', () => {
    const next = toggleBodyRef([ref('a/body')], body('b/body'));
    expect(next).toEqual([ref('a/body'), ref('b/body')]);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next[1])).toBe(true);
  });

  it('removes a body that is there and keeps the order of the rest', () => {
    const other = { kind: 'topo', body: body('b/body'), name: 'x' };
    const value = [ref('a/body'), other, ref('b/body'), ref('c/body')];
    expect(toggleBodyRef(value, body('b/body'))).toEqual([ref('a/body'), other, ref('c/body')]);
  });

  it('a value that is not an array counts as empty', () => {
    expect(toggleBodyRef(undefined, body('a/body'))).toEqual([ref('a/body')]);
    expect(toggleBodyRef('junk', body('a/body'))).toEqual([ref('a/body')]);
  });
});
