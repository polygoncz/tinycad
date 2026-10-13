import type { ParamSpec } from '@/document';
import { describe, expect, it } from 'vitest';
import { pickFilterFor } from './ref-pick-tool';

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
