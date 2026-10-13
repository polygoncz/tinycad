import { describe, expect, it } from 'vitest';
import { createRegistry } from './registry';

interface Schema {
  readonly type: string;
  readonly label: string;
}

const box: Schema = { type: 'box', label: 'Box' };
const cylinder: Schema = { type: 'cylinder', label: 'Cylinder' };

function schemas() {
  return createRegistry<Schema>({ what: 'feature schema', keyOf: (s) => s.type });
}

describe('createRegistry', () => {
  it('returns a registered item by key', () => {
    const r = schemas();
    r.register(box);
    expect(r.get('box')).toBe(box);
    expect(r.find('box')).toBe(box);
    expect(r.has('box')).toBe(true);
  });

  it('throws on a duplicate key, naming what and the key', () => {
    const r = schemas();
    r.register(box);
    expect(() => {
      r.register({ type: 'box', label: 'Other box' });
    }).toThrow("Duplicate feature schema 'box'");
  });

  it('get throws on an unknown key, find returns undefined', () => {
    const r = schemas();
    expect(() => r.get('sphere')).toThrow("Unknown feature schema 'sphere'");
    expect(r.find('sphere')).toBeUndefined();
    expect(r.has('sphere')).toBe(false);
  });

  it('lists items in registration order', () => {
    const r = schemas();
    r.register(cylinder);
    r.register(box);
    expect(r.all()).toEqual([cylinder, box]);
  });

  it('all() returns a snapshot that later registrations do not change', () => {
    const r = schemas();
    r.register(box);
    const before = r.all();
    r.register(cylinder);
    expect(before).toEqual([box]);
  });
});
