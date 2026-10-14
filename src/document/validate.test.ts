import { describe, expect, it } from 'vitest';
import type { ParamIssue, ParamSchema, ParamSpec } from './schema';
import { validateAgainstSchema } from './validate';

// Validates a single param `p` against one spec; returns the issues without the param key.
function check(spec: ParamSpec, value: unknown): readonly Omit<ParamIssue, 'param'>[] {
  return validateAgainstSchema({ p: spec }, { p: value }).map((issue) => {
    expect(issue.param).toBe('p');
    return issue.params === undefined
      ? { code: issue.code }
      : { code: issue.code, params: issue.params };
  });
}

const ok = (spec: ParamSpec, value: unknown) => {
  expect(check(spec, value)).toEqual([]);
};
const bad = (
  spec: ParamSpec,
  value: unknown,
  code: string,
  params?: Readonly<Record<string, string | number>>,
) => {
  expect(check(spec, value)).toEqual([params === undefined ? { code } : { code, params }]);
};

describe('validateAgainstSchema – params object', () => {
  const schema: ParamSchema = {
    width: { kind: 'length', label: 'box.width', default: 10 },
    depth: { kind: 'length', label: 'box.depth', default: 10 },
  };

  it('accepts params that match the schema', () => {
    expect(validateAgainstSchema(schema, { width: 1, depth: 2 })).toEqual([]);
  });

  it('rejects params that are not an object', () => {
    for (const params of [null, undefined, 3, 'x', [1, 2]]) {
      expect(validateAgainstSchema(schema, params)).toEqual([
        { param: '', code: 'param.wrongType' },
      ]);
    }
  });

  it('reports missing and unexpected params (Q028)', () => {
    expect(validateAgainstSchema(schema, { width: 1, widht: 2 })).toEqual([
      { param: 'depth', code: 'param.missing' },
      { param: 'widht', code: 'param.unexpected' },
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
    bad(spec, -1, 'param.belowMin', { min: 0 });
    bad(spec, 11, 'param.aboveMax', { max: 10 });
    bad(spec, '5', 'param.wrongType');
    bad(spec, Infinity, 'param.wrongType');
  });

  it('number: honours integer', () => {
    const spec: ParamSpec = { kind: 'number', label: 'N', default: 1, integer: true, min: 1 };
    ok(spec, 3);
    bad(spec, 2.5, 'param.notInteger');
    bad(spec, 0, 'param.belowMin', { min: 1 });
    ok({ kind: 'number', label: 'N', default: 1 }, 2.5);
  });

  it('boolean', () => {
    const spec: ParamSpec = { kind: 'boolean', label: 'B', default: false };
    ok(spec, true);
    bad(spec, 1, 'param.wrongType');
  });

  it('enum: value must be one of the options', () => {
    const spec: ParamSpec = {
      kind: 'enum',
      label: 'E',
      default: 'new',
      options: [
        { value: 'new', label: 'e.new' },
        { value: 'add', label: 'e.add' },
      ],
    };
    ok(spec, 'add');
    bad(spec, 'remove', 'param.unknownOption');
  });

  it('point: three finite numbers', () => {
    const spec: ParamSpec = { kind: 'point', label: 'P', default: [0, 0, 0] };
    ok(spec, [1, 2, 3]);
    bad(spec, [1, 2], 'param.wrongType');
    bad(spec, [1, 2, NaN], 'param.wrongType');
    bad(spec, { x: 1, y: 2, z: 3 }, 'param.wrongType');
  });

  it('bodies: BodyRef[] with count limits', () => {
    const spec: ParamSpec = { kind: 'bodies', label: 'B', min: 1, max: 2 };
    const ref = { kind: 'body', body: 'f1/body' };
    const ref2 = { kind: 'body', body: 'f2/body' };
    const ref3 = { kind: 'body', body: 'f1/body:1' };
    ok(spec, [ref]);
    ok(spec, [ref, ref2]);
    bad(spec, [], 'param.tooFewRefs', { min: 1 });
    bad(spec, [ref, ref2, ref3], 'param.tooManyRefs', { max: 2 });
    bad(spec, [ref, { kind: 'topo', body: 'f1/body', name: 'x' }], 'param.invalidRef', {
      index: 1,
    });
    bad(spec, ref, 'param.wrongType');
  });

  it('bodies: an empty list is fine without min, but the key must be there (Q028)', () => {
    const spec: ParamSpec = { kind: 'bodies', label: 'B' };
    ok(spec, []);
    expect(validateAgainstSchema({ p: spec }, {})).toEqual([{ param: 'p', code: 'param.missing' }]);
  });

  it('topo: TopoRef[]', () => {
    const spec: ParamSpec = { kind: 'topo', label: 'T', entity: 'edge' };
    ok(spec, [{ kind: 'topo', body: 'f1/body', name: 'e1' }]);
    bad(spec, [{ kind: 'topo', body: 'f1/body' }], 'param.invalidRef', { index: 0 });
  });

  it('topo: an empty name is an invalid reference (M14)', () => {
    const spec: ParamSpec = { kind: 'topo', label: 'T', entity: 'edge' };
    bad(spec, [{ kind: 'topo', body: 'f1/body', name: '' }], 'param.invalidRef', { index: 0 });
    bad(spec, [{ kind: 'topo', body: 'f1/body', name: 7 }], 'param.invalidRef', { index: 0 });
  });

  it('region: SketchRegionRef[]', () => {
    const spec: ParamSpec = { kind: 'region', label: 'R', min: 1 };
    ok(spec, [{ kind: 'region', sketch: 's1', region: 'r1' }]);
    bad(spec, [{ kind: 'region', sketch: 's1', region: 7 }], 'param.invalidRef', { index: 0 });
  });
});

describe('validateAgainstSchema – sketcher kinds (M12)', () => {
  const plane = (id: string) => ({ kind: 'plane', plane: id });

  it('planes: PlaneRef[] with a plane id', () => {
    const spec: ParamSpec = { kind: 'planes', label: 'P' };
    ok(spec, []);
    ok(spec, [plane('origin/plane:xy'), plane('f1/plane:1')]);
    bad(spec, [plane('origin/plane:xy'), plane('origin/plane:XY')], 'param.invalidRef', {
      index: 1,
    });
    bad(spec, [{ kind: 'plane' }], 'param.invalidRef', { index: 0 });
    bad(spec, [{ kind: 'body', body: 'f1/body' }], 'param.invalidRef', { index: 0 });
    bad(spec, plane('origin/plane:xy'), 'param.wrongType');
  });

  it('planes: the same plane is a duplicate', () => {
    const spec: ParamSpec = { kind: 'planes', label: 'P' };
    bad(spec, [plane('origin/plane:xy'), plane('origin/plane:xy')], 'param.duplicateRef', {
      index: 1,
    });
  });

  it('planes: a TopoRef to a face of a body is a plane too (M14)', () => {
    const spec: ParamSpec = { kind: 'planes', label: 'P', max: 2 };
    const face = { kind: 'topo', body: 'f1/body', name: 'face:top' };
    ok(spec, [face]);
    ok(spec, [plane('origin/plane:xy'), face]);
    bad(spec, [{ kind: 'topo', body: 'f1/body', name: '' }], 'param.invalidRef', { index: 0 });
    bad(spec, [{ kind: 'topo', body: 'f1', name: 'face:top' }], 'param.invalidRef', { index: 0 });
  });

  it('planes: the same body and name is a duplicate, other names are not (M14)', () => {
    const spec: ParamSpec = { kind: 'planes', label: 'P' };
    const face = (b: string, name: string) => ({ kind: 'topo', body: b, name });
    bad(spec, [face('a/body', 'f1'), face('a/body', 'f1')], 'param.duplicateRef', { index: 1 });
    ok(spec, [face('a/body', 'f1'), face('a/body', 'f2'), face('b/body', 'f1')]);
  });

  it('planes: count limits', () => {
    const spec: ParamSpec = { kind: 'planes', label: 'P', min: 1, max: 1 };
    ok(spec, [plane('origin/plane:xy')]);
    bad(spec, [], 'param.tooFewRefs', { min: 1 });
    bad(spec, [plane('origin/plane:xy'), plane('origin/plane:yz')], 'param.tooManyRefs', {
      max: 1,
    });
  });

  it('data: only required, anything else passes', () => {
    const spec: ParamSpec = { kind: 'data', label: 'D' };
    for (const value of [{}, { entities: [] }, [], 'x', 0, null, false]) ok(spec, value);
    expect(validateAgainstSchema({ p: spec }, {})).toEqual([{ param: 'p', code: 'param.missing' }]);
  });
});

describe('validateAgainstSchema – duplicate references (M11)', () => {
  const body = (b: string) => ({ kind: 'body', body: b });
  const topo = (b: string, name: string) => ({ kind: 'topo', body: b, name });
  const region = (sketch: string, r: string) => ({ kind: 'region', sketch, region: r });

  it('bodies: reports the index of the first item equal to an earlier one', () => {
    const spec: ParamSpec = { kind: 'bodies', label: 'B' };
    bad(spec, [body('a/body'), body('b/body'), body('a/body')], 'param.duplicateRef', {
      index: 2,
    });
    bad(
      spec,
      [body('a/body'), body('b/body'), body('b/body'), body('a/body')],
      'param.duplicateRef',
      { index: 2 },
    );
    ok(spec, [body('a/body'), body('a/body:1')]);
  });

  it('bodies: extra fields of an item do not make it different', () => {
    const spec: ParamSpec = { kind: 'bodies', label: 'B' };
    bad(spec, [body('a/body'), { ...body('a/body'), note: 'x' }], 'param.duplicateRef', {
      index: 1,
    });
  });

  it('topo: the same body and name is a duplicate, other names on one body are not', () => {
    const spec: ParamSpec = { kind: 'topo', label: 'T', entity: 'face' };
    bad(spec, [topo('a/body', 'f1'), topo('a/body', 'f1')], 'param.duplicateRef', { index: 1 });
    ok(spec, [topo('a/body', 'f1'), topo('a/body', 'f2'), topo('b/body', 'f1')]);
  });

  it('region: the same sketch and region is a duplicate', () => {
    const spec: ParamSpec = { kind: 'region', label: 'R' };
    bad(spec, [region('s1', 'r1'), region('s1', 'r1')], 'param.duplicateRef', { index: 1 });
    ok(spec, [region('s1', 'r1'), region('s1', 'r2'), region('s2', 'r1')]);
  });

  it('checks invalidRef first, then duplicateRef, then the counts', () => {
    const spec: ParamSpec = { kind: 'bodies', label: 'B', min: 3, max: 1 };
    bad(spec, [body('a/body'), body('a/body'), { kind: 'body' }], 'param.invalidRef', {
      index: 2,
    });
    bad(spec, [body('a/body'), body('a/body')], 'param.duplicateRef', { index: 1 });
    bad(spec, [body('a/body'), body('b/body')], 'param.tooFewRefs', { min: 3 });
  });
});

describe('validateAgainstSchema – exclusive bounds (Q050)', () => {
  it.each(['length', 'angle', 'number'] as const)(
    '%s: exclusiveMin rejects the bound itself and anything below',
    (kind) => {
      const spec: ParamSpec = { kind, label: 'L', default: 1, min: 0, exclusiveMin: true };
      bad(spec, 0, 'param.atOrBelowMin', { min: 0 });
      bad(spec, -0, 'param.atOrBelowMin', { min: 0 });
      bad(spec, -1, 'param.atOrBelowMin', { min: 0 });
      ok(spec, 1e-9);
    },
  );

  it.each(['length', 'angle', 'number'] as const)(
    '%s: exclusiveMax rejects the bound itself and anything above',
    (kind) => {
      const spec: ParamSpec = { kind, label: 'L', default: 1, max: 10, exclusiveMax: true };
      bad(spec, 10, 'param.atOrAboveMax', { max: 10 });
      bad(spec, 11, 'param.atOrAboveMax', { max: 10 });
      ok(spec, 9.999);
    },
  );

  it('exclusiveMin/exclusiveMax without min/max have no effect', () => {
    const spec: ParamSpec = {
      kind: 'length',
      label: 'L',
      default: 1,
      exclusiveMin: true,
      exclusiveMax: true,
    };
    ok(spec, -1e9);
    ok(spec, 0);
    ok(spec, 1e9);
  });

  it('exclusiveMin: false keeps the inclusive bound', () => {
    const spec: ParamSpec = { kind: 'length', label: 'L', default: 1, min: 0, exclusiveMin: false };
    ok(spec, 0);
    bad(spec, -1, 'param.belowMin', { min: 0 });
  });
});

// A schema in the style of Extrude (M13): targets only for add/remove/intersect, distance only
// for a blind end and the face only for 'up to face'.
describe('validateAgainstSchema – conditional params (M13)', () => {
  const schema: ParamSchema = {
    operation: {
      kind: 'enum',
      label: 'x.operation',
      default: 'new',
      options: [
        { value: 'new', label: 'x.operation.new' },
        { value: 'add', label: 'x.operation.add' },
      ],
    },
    targets: {
      kind: 'bodies',
      label: 'x.targets',
      min: 1,
      group: 'x.group.merge',
      visibleWhen: (p) => p.operation !== 'new',
    },
    endType: {
      kind: 'enum',
      label: 'x.endType',
      default: 'blind',
      options: [
        { value: 'blind', label: 'x.endType.blind' },
        { value: 'upToFace', label: 'x.endType.upToFace' },
      ],
    },
    distance: {
      kind: 'length',
      label: 'x.distance',
      default: 10,
      min: 0,
      exclusiveMin: true,
      visibleWhen: (p) => p.endType === 'blind',
    },
    upTo: {
      kind: 'topo',
      label: 'x.upTo',
      entity: 'face',
      min: 1,
      visibleWhen: (p) => p.endType === 'upToFace',
    },
  };
  const target = { kind: 'body', body: 'f1/body' };

  it("'new' with empty targets passes (targets hidden)", () => {
    expect(
      validateAgainstSchema(schema, {
        operation: 'new',
        targets: [],
        endType: 'blind',
        distance: 10,
        upTo: [],
      }),
    ).toEqual([]);
  });

  it("'add' with empty targets is too few references", () => {
    expect(
      validateAgainstSchema(schema, {
        operation: 'add',
        targets: [],
        endType: 'blind',
        distance: 10,
        upTo: [],
      }),
    ).toEqual([{ param: 'targets', code: 'param.tooFewRefs', params: { min: 1 } }]);
  });

  it('a missing hidden param passes', () => {
    expect(
      validateAgainstSchema(schema, { operation: 'new', endType: 'blind', distance: 5 }),
    ).toEqual([]);
  });

  it('a missing visible param is param.missing', () => {
    expect(validateAgainstSchema(schema, { operation: 'add', endType: 'upToFace' })).toEqual([
      { param: 'targets', code: 'param.missing' },
      { param: 'upTo', code: 'param.missing' },
    ]);
  });

  it('an invalid value of a hidden param passes and is not unexpected', () => {
    expect(
      validateAgainstSchema(schema, {
        operation: 'new',
        targets: 'nonsense',
        endType: 'upToFace',
        distance: -1,
        upTo: [{ kind: 'topo', body: 'f1/body', name: 'Face1' }],
      }),
    ).toEqual([]);
  });

  it('checks a visible param as usual', () => {
    expect(
      validateAgainstSchema(schema, {
        operation: 'add',
        targets: [target, 'x'],
        endType: 'blind',
        distance: 0,
      }),
    ).toEqual([
      { param: 'targets', code: 'param.invalidRef', params: { index: 1 } },
      { param: 'distance', code: 'param.atOrBelowMin', params: { min: 0 } },
    ]);
  });

  it('does not call the predicates for params that are not an object', () => {
    const throwing: ParamSchema = {
      p: {
        kind: 'boolean',
        label: 'B',
        default: false,
        visibleWhen: () => {
          throw new Error('called');
        },
      },
    };
    expect(validateAgainstSchema(throwing, null)).toEqual([{ param: '', code: 'param.wrongType' }]);
  });
});

describe('validateAgainstSchema – axis (M13)', () => {
  const spec: ParamSpec = { kind: 'axis', label: 'A' };

  it('null is too few references, the axis is always required', () => {
    bad(spec, null, 'param.tooFewRefs', { min: 1 });
  });

  it('an origin axis passes', () => {
    ok(spec, { kind: 'axis', axis: 'origin/axis:z' });
  });

  it('a sketch entity passes', () => {
    ok(spec, { kind: 'sketchEntity', sketch: 's1', entity: 'l1' });
  });

  it.each([
    [{ kind: 'axis', axis: 'origin/axis:Z' }],
    [{ kind: 'axis', axis: 'origin/plane:xy' }],
    [{ kind: 'axis' }],
    [{ kind: 'sketchEntity', sketch: '', entity: 'l1' }],
    [{ kind: 'sketchEntity', sketch: 's1', entity: '' }],
    [{ kind: 'sketchEntity', sketch: 's1' }],
    [{ kind: 'plane', plane: 'origin/plane:xy' }],
    [{ kind: 'body', body: 'f1/body' }],
    ['origin/axis:z'],
    [3],
    [undefined],
  ])('an invalid item %j is param.invalidRef without params', (value) => {
    bad(spec, value, 'param.invalidRef');
  });

  it('an array instead of an object is param.invalidRef', () => {
    bad(spec, [{ kind: 'axis', axis: 'origin/axis:z' }], 'param.invalidRef');
  });

  it('is required like any param', () => {
    expect(validateAgainstSchema({ p: spec }, {})).toEqual([{ param: 'p', code: 'param.missing' }]);
  });
});
