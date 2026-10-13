import { describe, expect, it } from 'vitest';
import type { FeatureId } from './model';
import { bodyId, originOfBody, ownerOf } from './refs';
import type { BodyId, TopoName } from './refs';

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
});
