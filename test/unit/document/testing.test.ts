import { describe, expect, expectTypeOf, it } from 'vitest';
import { aDocument, aFeature } from '@/document/testing';

describe('test builders', () => {
  it('aFeature gives unique ids and valid defaults, overrides win', () => {
    const a = aFeature();
    const b = aFeature({ id: 'custom', name: 'Box', params: { size: 5 } });
    expect(a.id).not.toBe(aFeature().id);
    expect(b).toMatchObject({
      id: 'custom',
      name: 'Box',
      type: 'box',
      typeVersion: 1,
      params: { size: 5 },
    });
  });

  it('aFeature with own params type requires params', () => {
    const f = aFeature<{ width: number }>({ params: { width: 2 } });
    expectTypeOf(f.params).toEqualTypeOf<Readonly<{ width: number }>>();
    // @ts-expect-error – own P without params would make the type lie
    aFeature<{ width: number }>({ name: 'x' });
  });

  it('aDocument puts the rollback bar at the end by default', () => {
    const doc = aDocument({ features: [aFeature(), aFeature()] });
    expect(doc.studio.rollbackIndex).toBe(2);
    expect(aDocument({ features: [aFeature()], rollbackIndex: 0 }).studio.rollbackIndex).toBe(0);
    expect(aDocument({ meta: { name: 'X' } }).meta).toEqual({
      id: 'doc1',
      name: 'X',
      createdAt: 0,
    });
  });
});
