import { describe, expect, it } from 'vitest';
import type { ParamSchema, ParamSpec } from './schema';
import { validateAgainstSchema } from './validate';

// Validates a single param `p` against one spec; returns the messages.
function check(spec: ParamSpec, value: unknown): readonly string[] {
  return validateAgainstSchema({ p: spec }, { p: value }).map((i) => i.message);
}

const ok = (spec: ParamSpec, value: unknown) => {
  expect(check(spec, value)).toEqual([]);
};
const bad = (spec: ParamSpec, value: unknown, message: RegExp) => {
  const messages = check(spec, value);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatch(message);
};

describe('validateAgainstSchema – params object', () => {
  const schema: ParamSchema = {
    width: { kind: 'length', label: 'Width', default: 10 },
    depth: { kind: 'length', label: 'Depth', default: 10 },
  };

  it('accepts params that match the schema', () => {
    expect(validateAgainstSchema(schema, { width: 1, depth: 2 })).toEqual([]);
  });

  it('rejects params that are not an object', () => {
    for (const params of [null, undefined, 3, 'x', [1, 2]]) {
      expect(validateAgainstSchema(schema, params)).toEqual([
        { param: '', message: 'Params must be an object' },
      ]);
    }
  });

  it('reports missing and unexpected params (Q028)', () => {
    expect(validateAgainstSchema(schema, { width: 1, widht: 2 })).toEqual([
      { param: 'depth', message: 'Missing' },
      { param: 'widht', message: 'Unexpected param' },
    ]);
  });

  it('reports every invalid param, not just the first', () => {
    expect(validateAgainstSchema(schema, { width: 'a', depth: NaN }).map((i) => i.param)).toEqual([
      'width',
      'depth',
    ]);
  });
});

describe('validateAgainstSchema – each ParamSpec kind', () => {
  it.each(['length', 'angle'] as const)('%s: finite number within min/max', (kind) => {
    const spec: ParamSpec = { kind, label: 'L', default: 1, min: 0, max: 10 };
    ok(spec, 0);
    ok(spec, 10);
    bad(spec, -1, /at least 0/);
    bad(spec, 11, /at most 10/);
    bad(spec, '5', /finite number/);
    bad(spec, Infinity, /finite number/);
  });

  it('number: honours integer', () => {
    const spec: ParamSpec = { kind: 'number', label: 'N', default: 1, integer: true, min: 1 };
    ok(spec, 3);
    bad(spec, 2.5, /whole number/);
    bad(spec, 0, /at least 1/);
    ok({ kind: 'number', label: 'N', default: 1 }, 2.5);
  });

  it('boolean', () => {
    const spec: ParamSpec = { kind: 'boolean', label: 'B', default: false };
    ok(spec, true);
    bad(spec, 1, /true or false/);
  });

  it('enum: value must be one of the options', () => {
    const spec: ParamSpec = {
      kind: 'enum',
      label: 'E',
      default: 'new',
      options: [
        { value: 'new', label: 'New' },
        { value: 'add', label: 'Add' },
      ],
    };
    ok(spec, 'add');
    bad(spec, 'remove', /one of new, add/);
  });

  it('point: three finite numbers', () => {
    const spec: ParamSpec = { kind: 'point', label: 'P', default: [0, 0, 0] };
    ok(spec, [1, 2, 3]);
    bad(spec, [1, 2], /point/);
    bad(spec, [1, 2, NaN], /point/);
    bad(spec, { x: 1, y: 2, z: 3 }, /point/);
  });

  it('bodies: BodyRef[] with count limits', () => {
    const spec: ParamSpec = { kind: 'bodies', label: 'B', min: 1, max: 2 };
    const ref = { kind: 'body', body: 'f1/body' };
    ok(spec, [ref]);
    ok(spec, [ref, ref]);
    bad(spec, [], /at least 1/);
    bad(spec, [ref, ref, ref], /at most 2/);
    bad(spec, [ref, { kind: 'topo', body: 'f1/body', name: 'x' }], /Reference 1/);
    bad(spec, ref, /list of references/);
  });

  it('bodies: an empty list is fine without min, but the key must be there (Q028)', () => {
    const spec: ParamSpec = { kind: 'bodies', label: 'B' };
    ok(spec, []);
    expect(validateAgainstSchema({ p: spec }, {})).toEqual([{ param: 'p', message: 'Missing' }]);
  });

  it('topo: TopoRef[]', () => {
    const spec: ParamSpec = { kind: 'topo', label: 'T', entity: 'edge' };
    ok(spec, [{ kind: 'topo', body: 'f1/body', name: 'e1' }]);
    bad(spec, [{ kind: 'topo', body: 'f1/body' }], /Reference 0/);
  });

  it('region: SketchRegionRef[]', () => {
    const spec: ParamSpec = { kind: 'region', label: 'R', min: 1 };
    ok(spec, [{ kind: 'region', sketch: 's1', region: 'r1' }]);
    bad(spec, [{ kind: 'region', sketch: 's1', region: 7 }], /Reference 0/);
  });
});
