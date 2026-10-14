import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FeatureId } from './model';
import {
  bodyId,
  originOfBody,
  ownerOf,
  ownerOfArtifact,
  parseAxisId,
  parseBodyId,
  parsePlaneId,
  parseSketchId,
  readRefOf,
  sketchId,
} from './refs';
import type { PlaneRef, TopoRef } from './refs';
import type { AxisId, BodyId, PlaneId, SketchId, TopoName } from './refs';

const fid = (s: string): FeatureId => s as FeatureId;
const bid = (s: string): BodyId => s as BodyId;

describe('bodyId', () => {
  it('names the single body of a feature <origin>/body', () => {
    expect(bodyId(fid('f1'))).toBe('f1/body');
  });

  it('numbers further bodies <origin>/body:<n> from 1', () => {
    expect(bodyId(fid('f1'), 1)).toBe('f1/body:1');
    expect(bodyId(fid('f1'), 2)).toBe('f1/body:2');
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects n = %s', (n) => {
    expect(() => bodyId(fid('f1'), n)).toThrow();
  });

  it.each(['', 'f/1', '/'])('rejects the origin %j (empty or with a slash)', (origin) => {
    expect(() => bodyId(fid(origin))).toThrow();
  });
});

describe('originOfBody', () => {
  it('reads the feature back from both forms', () => {
    expect(originOfBody(bodyId(fid('f1')))).toBe('f1');
    expect(originOfBody(bodyId(fid('f1'), 2))).toBe('f1');
  });

  it('takes the text before the first slash', () => {
    expect(originOfBody(bid('f1/body/x'))).toBe('f1');
  });

  it('throws on an id without a slash (programmer error)', () => {
    expect(() => originOfBody(bid('f1'))).toThrow();
  });
});

describe('ownerOf', () => {
  it('body and topo references belong to the origin of their body', () => {
    expect(ownerOf({ kind: 'body', body: bodyId(fid('a'), 2) })).toBe('a');
    expect(ownerOf({ kind: 'topo', body: bodyId(fid('b')), name: 'Face1' as TopoName })).toBe('b');
  });

  it('a region reference belongs to its sketch', () => {
    expect(ownerOf({ kind: 'region', sketch: fid('s1'), region: 'r1' })).toBe('s1');
  });

  it('a plane reference belongs to the text before the slash (M12)', () => {
    expect(ownerOf({ kind: 'plane', plane: 'origin/plane:xy' as PlaneId })).toBe('origin');
    expect(ownerOf({ kind: 'plane', plane: 'f3/plane:1' as PlaneId })).toBe('f3');
  });

  it('an axis reference belongs to the text before the slash (M13)', () => {
    expect(ownerOf({ kind: 'axis', axis: 'origin/axis:z' as AxisId })).toBe('origin');
    expect(ownerOf({ kind: 'axis', axis: 'f4/axis:1' as AxisId })).toBe('f4');
  });

  it('a sketch entity reference belongs to its sketch (M13)', () => {
    expect(ownerOf({ kind: 'sketchEntity', sketch: fid('s1'), entity: 'l1' })).toBe('s1');
  });
});

describe('parseBodyId', () => {
  it.each(['f1/body', 'f1/body:1', 'f1/body:12', 'a.b-c/body:3'])('accepts %j', (text) => {
    expect(parseBodyId(text)).toBe(text);
  });

  it.each([
    '',
    'f1',
    'f1/',
    '/body',
    'f1/body:0',
    'f1/body:01',
    'f1/body:',
    'f1/body:x',
    'f1/sketch',
    'f1/b/body',
    'f1/body/x',
  ])('rejects %j', (text) => {
    expect(parseBodyId(text)).toBeUndefined();
  });

  it.each([[undefined], [null], [3], [{}], [['f1/body']]])('rejects the non-string %j', (value) => {
    expect(parseBodyId(value)).toBeUndefined();
  });

  it('gives back what bodyId mints', () => {
    expect(parseBodyId(bodyId(fid('f1'), 2))).toBe(bodyId(fid('f1'), 2));
  });
});

describe('sketchId (M12)', () => {
  it('names the sketch of a feature <owner>/sketch', () => {
    expect(sketchId(fid('f1'))).toBe('f1/sketch');
  });

  it.each(['', 'f/1', '/'])('rejects the owner %j (empty or with a slash)', (owner) => {
    expect(() => sketchId(fid(owner))).toThrow();
  });
});

describe('parsePlaneId (M12)', () => {
  it.each(['origin/plane:xy', 'origin/plane:yz', 'f1/plane:1', 'a.b-c/plane:top2'])(
    'accepts %j',
    (text) => {
      expect(parsePlaneId(text)).toBe(text);
    },
  );

  it.each([
    '',
    'plane:xy',
    '/plane:xy',
    'a/b/plane:xy',
    'origin/plane:',
    'origin/plane',
    'origin/plane:XY',
    'origin/plane:x-y',
    'origin/plane:xy/z',
    'origin/body',
    'origin/axis:z',
  ])('rejects %j', (text) => {
    expect(parsePlaneId(text)).toBeUndefined();
  });

  it.each([[undefined], [null], [3], [{}], [['origin/plane:xy']]])(
    'rejects the non-string %j',
    (value) => {
      expect(parsePlaneId(value)).toBeUndefined();
    },
  );
});

describe('parseAxisId (M13)', () => {
  it.each(['origin/axis:x', 'origin/axis:z', 'f1/axis:1', 'a.b-c/axis:main2'])(
    'accepts %j',
    (text) => {
      expect(parseAxisId(text)).toBe(text);
    },
  );

  it.each([
    '',
    'axis:x',
    '/axis:x',
    'a/b/axis:x',
    'origin/axis:',
    'origin/axis',
    'origin/axis:X',
    'origin/axis:x-y',
    'origin/axis:x/y',
    'origin/plane:xy',
    'origin/body',
  ])('rejects %j', (text) => {
    expect(parseAxisId(text)).toBeUndefined();
  });

  it.each([[undefined], [null], [3], [{}], [['origin/axis:x']]])(
    'rejects the non-string %j',
    (value) => {
      expect(parseAxisId(value)).toBeUndefined();
    },
  );
});

describe('parseSketchId (M13)', () => {
  it.each(['f1/sketch', 'a.b-c/sketch', 'S1/sketch'])('accepts %j', (text) => {
    expect(parseSketchId(text)).toBe(text);
  });

  it.each([
    '',
    'sketch',
    '/sketch',
    'a/b/sketch',
    'f1/sketch:1',
    'f1/Sketch',
    'f1/sketch/x',
    'f1/body',
    'sketch-edit',
  ])('rejects %j', (text) => {
    expect(parseSketchId(text)).toBeUndefined();
  });

  it.each([[undefined], [null], [3], [{}], [['f1/sketch']]])(
    'rejects the non-string %j',
    (value) => {
      expect(parseSketchId(value)).toBeUndefined();
    },
  );

  it('gives back what sketchId mints', () => {
    expect(parseSketchId(sketchId(fid('f1')))).toBe(sketchId(fid('f1')));
  });
});

describe('ownerOfArtifact (M13)', () => {
  it('reads the owner of every artifact id', () => {
    expect(ownerOfArtifact(bodyId(fid('f1'), 2))).toBe('f1');
    expect(ownerOfArtifact(sketchId(fid('s1')))).toBe('s1');
    expect(ownerOfArtifact('origin/plane:xy' as PlaneId)).toBe('origin');
    expect(ownerOfArtifact('origin/axis:z' as AxisId)).toBe('origin');
  });

  it('takes the text before the first slash', () => {
    expect(ownerOfArtifact('f1/sketch/x' as SketchId)).toBe('f1');
  });

  it('throws on an id without a slash (programmer error)', () => {
    expect(() => ownerOfArtifact('f1' as SketchId)).toThrow();
  });
});

describe('readRefOf (M14, one reading of references outside document)', () => {
  it('reads a topo reference as a frozen copy with only its fields', () => {
    const ref = readRefOf(['topo'], { kind: 'topo', body: 'b/body', name: 'b/face:top', x: 1 });
    expect(ref).toEqual({ kind: 'topo', body: 'b/body', name: 'b/face:top' });
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it.each([
    ['an empty name', { kind: 'topo', body: 'b/body', name: '' }],
    ['a name that is not a string', { kind: 'topo', body: 'b/body', name: 3 }],
    ['a body id of a wrong shape', { kind: 'topo', body: 'b', name: 'b/face:top' }],
    ['another kind', { kind: 'body', body: 'b/body' }],
    ['not an object', 'b/face:top'],
    ['null', null],
  ])('gives undefined for %s', (_, value) => {
    expect(readRefOf(['topo'], value)).toBeUndefined();
  });

  it('takes the first of the kinds the value has and narrows the type to them', () => {
    const plane = readRefOf(['plane', 'topo'], { kind: 'plane', plane: 'origin/plane:xy' });
    const topo = readRefOf(['plane', 'topo'], { kind: 'topo', body: 'b/body', name: 'n' });
    expect(plane).toEqual({ kind: 'plane', plane: 'origin/plane:xy' });
    expect(topo).toEqual({ kind: 'topo', body: 'b/body', name: 'n' });
    expect(readRefOf(['plane', 'topo'], { kind: 'body', body: 'b/body' })).toBeUndefined();
    expectTypeOf(plane).toEqualTypeOf<PlaneRef | TopoRef | undefined>();
  });
});
