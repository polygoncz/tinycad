import { describe, expect, it } from 'vitest';
import { createDocument } from './cad-document';
import type { DocumentWriter } from './document';
import type { DocumentId, DocumentMeta, FeatureId, FeatureInstance, PartStudioData } from './model';
import type { BodyId } from './refs';

const meta: DocumentMeta = { id: 'd1' as DocumentId, name: 'Doc', createdAt: 0 };

function feature(id: string, params: object = { size: 1 }): FeatureInstance {
  return { id: id as FeatureId, type: 'box', typeVersion: 1, name: id, params, suppressed: false };
}

function docWith(ids: readonly string[], rollbackIndex = ids.length) {
  return createDocument({
    meta,
    studio: { features: ids.map((id) => feature(id)), rollbackIndex },
  });
}

const ids = (studio: PartStudioData) => studio.features.map((f) => f.id);
const fid = (id: string) => id as FeatureId;

describe('createDocument', () => {
  it('starts empty when no studio is given', () => {
    const doc = createDocument({ meta });
    expect(doc.studio).toEqual({ features: [], rollbackIndex: 0 });
    expect(doc.meta).toBe(meta);
  });

  it('rejects an initial studio that breaks the invariants', () => {
    const f = feature('a');
    expect(() => createDocument({ meta, studio: { features: [f, f], rollbackIndex: 2 } })).toThrow(
      /Duplicate/,
    );
    expect(() => createDocument({ meta, studio: { features: [f], rollbackIndex: 2 } })).toThrow(
      /rollback/i,
    );
  });

  it('looks features up by id', () => {
    const doc = docWith(['a', 'b']);
    expect(doc.feature(fid('b'))?.id).toBe('b');
    expect(doc.feature(fid('x'))).toBeUndefined();
    expect(doc.indexOf(fid('b'))).toBe(1);
    expect(doc.indexOf(fid('x'))).toBe(-1);
  });
});

describe('immutability', () => {
  it('freezes the studio, the features and their params deeply', () => {
    const doc = docWith(['a']);
    doc.insertFeature(1, feature('b', { nested: { size: 2 } }));
    const b = doc.feature(fid('b'));
    expect(Object.isFrozen(doc.studio)).toBe(true);
    expect(Object.isFrozen(doc.studio.features)).toBe(true);
    expect(Object.isFrozen(b)).toBe(true);
    expect(Object.isFrozen((b?.params as { nested: object }).nested)).toBe(true);
  });

  it('keeps unchanged features identical after replaceFeature (structural sharing)', () => {
    const doc = docWith(['a', 'b', 'c']);
    const before = doc.studio;
    doc.replaceFeature(feature('b', { size: 2 }));
    expect(doc.studio).not.toBe(before);
    expect(doc.studio.features[0]).toBe(before.features[0]);
    expect(doc.studio.features[2]).toBe(before.features[2]);
    expect(doc.studio.features[1]).not.toBe(before.features[1]);
    expect(before.features[1]?.params).toEqual({ size: 1 });
  });

  it.each([
    [
      'insertFeature',
      (d: DocumentWriter) => {
        d.insertFeature(1, feature('x'));
      },
    ],
    [
      'removeFeature',
      (d: DocumentWriter) => {
        d.removeFeature(fid('b'));
      },
    ],
    [
      'moveFeature',
      (d: DocumentWriter) => {
        d.moveFeature(fid('a'), 2);
      },
    ],
  ] as const)('keeps the other features identical after %s', (_, mutate) => {
    const doc = docWith(['a', 'b', 'c']);
    const before = new Map(doc.studio.features.map((f) => [f.id, f]));
    mutate(doc);
    for (const f of doc.studio.features) {
      if (before.has(f.id)) expect(f).toBe(before.get(f.id));
    }
  });

  it('deep-freezes a feature that comes in only shallowly frozen', () => {
    const doc = docWith([]);
    doc.insertFeature(0, Object.freeze(feature('a', { nested: { size: 2 } })));
    const params = doc.feature(fid('a'))?.params as { nested: object };
    expect(Object.isFrozen(params)).toBe(true);
    expect(Object.isFrozen(params.nested)).toBe(true);

    const shallow = Object.freeze([feature('b')]);
    const doc2 = createDocument({ meta, studio: { features: shallow, rollbackIndex: 1 } });
    expect(Object.isFrozen(doc2.studio.features[0])).toBe(true);
  });
});

describe('mutators', () => {
  it('inserts, removes and moves features', () => {
    const doc = docWith(['a', 'b']);
    doc.insertFeature(1, feature('x'));
    expect(ids(doc.studio)).toEqual(['a', 'x', 'b']);
    doc.moveFeature(fid('a'), 2);
    expect(ids(doc.studio)).toEqual(['x', 'b', 'a']);
    doc.removeFeature(fid('b'));
    expect(ids(doc.studio)).toEqual(['x', 'a']);
  });

  it('renames the document', () => {
    const doc = docWith([]);
    doc.rename('New');
    expect(doc.meta).toEqual({ ...meta, name: 'New' });
    expect(Object.isFrozen(doc.meta)).toBe(true);
  });

  it('throws on programmer errors', () => {
    const doc = docWith(['a', 'b']);
    expect(() => {
      doc.insertFeature(1, feature('a'));
    }).toThrow(/Duplicate/);
    expect(() => {
      doc.insertFeature(3, feature('x'));
    }).toThrow(/index/);
    expect(() => {
      doc.insertFeature(-1, feature('x'));
    }).toThrow(/index/);
    expect(() => {
      doc.removeFeature(fid('x'));
    }).toThrow(/Unknown feature/);
    expect(() => {
      doc.replaceFeature(feature('x'));
    }).toThrow(/Unknown feature/);
    expect(() => {
      doc.moveFeature(fid('a'), 2);
    }).toThrow(/index/);
    expect(() => {
      doc.setRollbackIndex(3);
    }).toThrow(/rollback/i);
    expect(() => {
      doc.setRollbackIndex(1.5);
    }).toThrow(/rollback/i);
  });

  it('leaves the document unchanged when a mutator throws', () => {
    const doc = docWith(['a']);
    const before = doc.studio;
    expect(() => {
      doc.insertFeature(0, feature('a'));
    }).toThrow();
    expect(doc.studio).toBe(before);
  });
});

// Q029: the active/rolled-back state of the other features never changes.
describe('rollback bar', () => {
  // [a, b | c, d] – rollbackIndex 2
  const start = () => docWith(['a', 'b', 'c', 'd'], 2);

  it.each([
    [0, 3],
    [2, 3], // at the bar: the new feature is active
    [3, 2],
    [4, 2],
  ])('insert at %i moves the bar to %i', (index, expected) => {
    const doc = start();
    doc.insertFeature(index, feature('x'));
    expect(doc.studio.rollbackIndex).toBe(expected);
  });

  it.each([
    ['a', 1],
    ['b', 1],
    ['c', 2],
    ['d', 2],
  ])('remove %s moves the bar to %i', (id, expected) => {
    const doc = start();
    doc.removeFeature(fid(id));
    expect(doc.studio.rollbackIndex).toBe(expected);
  });

  it.each([
    ['a', 1, 2, ['b', 'a']], // within the active part
    ['a', 3, 1, ['b']], // active feature moved behind the bar
    ['d', 0, 3, ['d', 'a', 'b']], // rolled-back feature moved before the bar
    ['d', 2, 3, ['a', 'b', 'd']], // onto the bar: takes the active state
    ['c', 3, 2, ['a', 'b']], // within the rolled-back part
  ] as const)('move %s to %i puts the bar at %i', (id, to, expected, active) => {
    const doc = start();
    doc.moveFeature(fid(id), to);
    expect(doc.studio.rollbackIndex).toBe(expected);
    expect(ids(doc.studio).slice(0, expected)).toEqual(active);
  });

  it('sets the bar anywhere in 0..features.length', () => {
    const doc = start();
    doc.setRollbackIndex(0);
    expect(doc.studio.rollbackIndex).toBe(0);
    doc.setRollbackIndex(4);
    expect(doc.studio.rollbackIndex).toBe(4);
  });
});

describe('events', () => {
  it('emits changed with the new studio after every mutation', () => {
    const doc = docWith(['a', 'b']);
    const seen: PartStudioData[] = [];
    doc.events.on('changed', ({ studio }) => seen.push(studio));
    doc.insertFeature(0, feature('x'));
    doc.replaceFeature(feature('x', { size: 3 }));
    doc.moveFeature(fid('x'), 2);
    doc.removeFeature(fid('x'));
    doc.setRollbackIndex(1);
    doc.rename('New');
    expect(seen).toHaveLength(6);
    expect(seen.at(-1)).toBe(doc.studio);
  });

  it('does not emit when nothing changes', () => {
    const doc = docWith(['a', 'b']);
    let count = 0;
    doc.events.on('changed', () => count++);
    doc.setRollbackIndex(2);
    doc.moveFeature(fid('a'), 0);
    doc.rename('Doc');
    doc.replaceFeature(doc.studio.features[0] as FeatureInstance);
    expect(count).toBe(0);
  });

  it('exposes only on/once, even to a cast', () => {
    const doc = docWith([]);
    expect(Object.keys(doc.events).sort()).toEqual(['on', 'once']);
    expect('emit' in doc.events).toBe(false);
  });

  it('lets a subscriber error propagate after the change is done', () => {
    const doc = docWith(['a']);
    doc.events.on('changed', () => {
      throw new Error('subscriber failed');
    });
    expect(() => {
      doc.removeFeature(fid('a'));
    }).toThrow('subscriber failed');
    expect(doc.studio.features).toHaveLength(0);
  });

  it('does not emit when a mutator throws', () => {
    const doc = docWith(['a']);
    let count = 0;
    doc.events.on('changed', () => count++);
    expect(() => {
      doc.removeFeature(fid('x'));
    }).toThrow();
    expect(count).toBe(0);
  });
});

describe('body metadata (M11)', () => {
  const body = (s: string) => s as BodyId;
  const a = body('a/body');
  const b = body('b/body:1');

  it('has no metadata at first: bodyMeta gives the shared frozen {}', () => {
    const doc = docWith(['a']);
    expect(doc.bodyMeta(a)).toEqual({});
    expect(doc.bodyMeta(a)).toBe(doc.bodyMeta(b));
    expect(Object.isFrozen(doc.bodyMeta(a))).toBe(true);
    expect('bodies' in doc.studio).toBe(false);
  });

  it('stores a name and hidden, frozen', () => {
    const doc = docWith(['a', 'b']);
    doc.setBodyMeta(a, { name: 'Base' });
    doc.setBodyMeta(b, { hidden: true });
    expect(doc.bodyMeta(a)).toEqual({ name: 'Base' });
    expect(doc.bodyMeta(b)).toEqual({ hidden: true });
    expect(doc.studio.bodies).toEqual({ [a]: { name: 'Base' }, [b]: { hidden: true } });
    expect(Object.isFrozen(doc.studio)).toBe(true);
    expect(Object.isFrozen(doc.studio.bodies)).toBe(true);
    expect(Object.isFrozen(doc.bodyMeta(a))).toBe(true);
  });

  it('does not keep a meta object from outside', () => {
    const doc = docWith(['a']);
    const meta = { name: 'Base' };
    doc.setBodyMeta(a, meta);
    meta.name = 'Changed';
    expect(doc.bodyMeta(a)).toEqual({ name: 'Base' });
  });

  it('keeps the canonical form: an empty name and hidden other than true are dropped', () => {
    const doc = docWith(['a']);
    doc.setBodyMeta(a, { name: 'Base', hidden: true });
    doc.setBodyMeta(a, { name: '', hidden: true });
    expect(doc.studio.bodies).toEqual({ [a]: { hidden: true } });
    // hidden is typed `true`; a cast must still not store `false`.
    doc.setBodyMeta(a, { name: 'X', hidden: false as unknown as true });
    expect(doc.studio.bodies).toEqual({ [a]: { name: 'X' } });
    expect(Object.keys(doc.bodyMeta(a))).toEqual(['name']);
  });

  it('stores a color with the other metadata (M15)', () => {
    const doc = docWith(['a']);
    doc.setBodyMeta(a, { name: 'Base', color: '#ff8800' });
    expect(doc.bodyMeta(a)).toEqual({ name: 'Base', color: '#ff8800' });
    expect(doc.studio.bodies).toEqual({ [a]: { name: 'Base', color: '#ff8800' } });
    expect(Object.isFrozen(doc.bodyMeta(a))).toBe(true);
  });

  it('removes a color and drops metadata left with the default color only (M15)', () => {
    const doc = docWith(['a']);
    doc.setBodyMeta(a, { hidden: true, color: '#00ff00' });
    doc.setBodyMeta(a, { hidden: true });
    expect(doc.studio.bodies).toEqual({ [a]: { hidden: true } });
    doc.setBodyMeta(a, { color: '#00ff00' });
    expect(doc.studio.bodies).toEqual({ [a]: { color: '#00ff00' } });
    doc.setBodyMeta(a, {});
    expect('bodies' in doc.studio).toBe(false);
  });

  it('keeps the color only as a valid color (canonical form, M15)', () => {
    const doc = docWith(['a']);
    doc.setBodyMeta(a, { name: 'A', color: '#FF8800' });
    expect(doc.bodyMeta(a)).toEqual({ name: 'A' });
    doc.setBodyMeta(a, { color: 'red' });
    expect('bodies' in doc.studio).toBe(false);
  });

  it('compares the color too: the same color emits nothing, another one emits (M15)', () => {
    const doc = docWith(['a']);
    doc.setBodyMeta(a, { color: '#112233' });
    let count = 0;
    doc.events.on('changed', () => count++);
    doc.setBodyMeta(a, { color: '#112233' });
    expect(count).toBe(0);
    doc.setBodyMeta(a, { color: '#112234' });
    expect(count).toBe(1);
  });

  it('removes the entry for empty metadata and the whole map when it is empty', () => {
    const doc = docWith(['a']);
    doc.setBodyMeta(a, { name: 'A' });
    doc.setBodyMeta(b, { name: 'B' });
    doc.setBodyMeta(a, {});
    expect(doc.studio.bodies).toEqual({ [b]: { name: 'B' } });
    doc.setBodyMeta(b, { name: '' });
    expect('bodies' in doc.studio).toBe(false);
  });

  it('does not emit changed for the same metadata by value', () => {
    const doc = docWith(['a']);
    doc.setBodyMeta(a, { name: 'A', hidden: true });
    const studio = doc.studio;
    let count = 0;
    doc.events.on('changed', () => count++);
    doc.setBodyMeta(a, { hidden: true, name: 'A' });
    doc.setBodyMeta(b, {});
    doc.setBodyMeta(b, { name: '' });
    expect(count).toBe(0);
    expect(doc.studio).toBe(studio);
    doc.setBodyMeta(a, { name: 'A' });
    expect(count).toBe(1);
  });

  it('keeps the very same features array and rollback index', () => {
    const doc = docWith(['a', 'b'], 1);
    const features = doc.studio.features;
    const seen: PartStudioData[] = [];
    doc.events.on('changed', ({ studio }) => seen.push(studio));
    doc.setBodyMeta(a, { hidden: true });
    expect(doc.studio.features).toBe(features);
    expect(doc.studio.rollbackIndex).toBe(1);
    expect(seen).toEqual([doc.studio]);
  });

  it('every other mutator keeps the metadata', () => {
    const doc = docWith(['a', 'b']);
    doc.setBodyMeta(a, { name: 'A' });
    const bodies = doc.studio.bodies;
    doc.insertFeature(2, feature('c'));
    expect(doc.studio.bodies).toBe(bodies);
    doc.replaceFeature(feature('c', { size: 5 }));
    expect(doc.studio.bodies).toBe(bodies);
    doc.moveFeature(fid('c'), 0);
    expect(doc.studio.bodies).toBe(bodies);
    doc.setRollbackIndex(1);
    expect(doc.studio.bodies).toBe(bodies);
    // The document does not know bodies: the entry of a removed feature stays.
    doc.removeFeature(fid('a'));
    expect(doc.studio.bodies).toBe(bodies);
    doc.rename('Other');
    expect(doc.studio.bodies).toBe(bodies);
  });

  it('starts from the metadata of an initial studio, deeply frozen', () => {
    const doc = createDocument({
      meta,
      studio: { features: [], rollbackIndex: 0, bodies: { [a]: { name: 'A' } } },
    });
    expect(doc.bodyMeta(a)).toEqual({ name: 'A' });
    expect(Object.isFrozen(doc.studio.bodies?.[a])).toBe(true);
  });
});
