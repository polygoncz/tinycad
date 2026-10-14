import { describe, expect, it } from 'vitest';
import type { FeatureId } from './model';
import { bodyId, originOfBody, ownerOf, parseBodyId, parsePlaneId, sketchId } from './refs';
import type { BodyId, PlaneId, TopoName } from './refs';

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
