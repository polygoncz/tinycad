import { describe, expect, it } from 'vitest';
import { aDocument, aFeature, bodyId, ORIGIN_AXIS_IDS } from '@/document/testing';
import type { AxisRef, FeatureId, SketchEntityRef, TopoName, TopoRef } from '@/document';
import { rectangleData } from '@/sketch/testing';
import {
  axisRefOf,
  bodyOfRef,
  bodyRefLabel,
  isSketchLine,
  regionRefsOf,
  toggleAxisRef,
  toggleRegionRef,
  toggleTopoRef,
  topoRefsOf,
} from '@/interaction/feature-dialog/ref-values';

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted

const B1 = bodyId(fid('f1'));
const B2 = bodyId(fid('f2'));
const B3 = bodyId(fid('f3'));

function aDoc() {
  return aDocument({
    features: [
      aFeature({ id: 'f1', name: 'Box 1' }),
      aFeature({ id: 'f2', name: 'Cylinder 1' }),
      aFeature({ id: 'f3', name: 'Box 2' }),
    ],
  });
}

describe('bodyOfRef', () => {
  it('is the body of a body reference', () => {
    expect(bodyOfRef({ kind: 'body', body: B1 })).toBe(B1);
    expect(bodyOfRef({ kind: 'body', body: bodyId(fid('f2'), 3) })).toBe(bodyId(fid('f2'), 3));
  });

  it('is null for anything else (params may hold anything)', () => {
    for (const junk of [
      null,
      undefined,
      1,
      'f1/body',
      { kind: 'body' },
      { kind: 'body', body: 3 },
      { kind: 'body', body: 'f1' },
      { kind: 'body', body: 'f1/body:0' },
      { kind: 'topo', body: B1, name: 'face:1' },
    ]) {
      expect(bodyOfRef(junk)).toBeNull();
    }
  });
});

describe('bodyRefLabel', () => {
  it('is the name from the metadata', () => {
    const doc = aDoc();
    doc.setBodyMeta(B1, { name: 'Base' });
    expect(bodyRefLabel(doc, B1)).toBe('Base');
  });

  it('is the name of the origin feature without a name in the metadata', () => {
    expect(bodyRefLabel(aDoc(), B2)).toBe('Cylinder 1');
  });

  it('adds the number of the body id as a suffix', () => {
    expect(bodyRefLabel(aDoc(), bodyId(fid('f2'), 2))).toBe('Cylinder 1 (2)');
  });

  it('is null when the origin feature is not in the document, even with a name', () => {
    const doc = aDoc();
    doc.setBodyMeta(B3, { name: 'Gone' });
    doc.removeFeature(fid('f3'));
    expect(bodyRefLabel(doc, B3)).toBeNull();
    expect(bodyRefLabel(doc, bodyId(fid('nope')))).toBeNull();
  });
});

describe('regionRefsOf (M13)', () => {
  it('reads the region references of the value as frozen copies, in order', () => {
    const refs = regionRefsOf([
      { kind: 'region', sketch: 's1', region: 'ab', extra: 1 },
      { kind: 'region', sketch: 's2', region: 'cd' },
    ]);
    expect(refs).toEqual([
      { kind: 'region', sketch: 's1', region: 'ab' },
      { kind: 'region', sketch: 's2', region: 'cd' },
    ]);
    expect(Object.isFrozen(refs)).toBe(true);
    expect(Object.isFrozen(refs[0])).toBe(true);
  });

  it('skips items of another shape (params may hold anything)', () => {
    expect(
      regionRefsOf([
        null,
        'x',
        { kind: 'body', body: B1 },
        { kind: 'region', sketch: 's1' },
        { kind: 'region', sketch: 1, region: 'ab' },
        { kind: 'region', sketch: '', region: 'ab' },
        { kind: 'region', sketch: 'a/b', region: 'ab' },
        { kind: 'region', sketch: 's1', region: 'ok' },
      ]),
    ).toEqual([{ kind: 'region', sketch: 's1', region: 'ok' }]);
  });

  it('a value that is not an array has no references', () => {
    for (const junk of [null, undefined, 'x', { kind: 'region', sketch: 's1', region: 'ab' }]) {
      expect(regionRefsOf(junk)).toEqual([]);
    }
  });
});

describe('axisRefOf (M13)', () => {
  it('reads an axis or a sketch entity as a frozen copy', () => {
    const axis = axisRefOf({ kind: 'axis', axis: ORIGIN_AXIS_IDS.z, extra: 1 });
    expect(axis).toEqual({ kind: 'axis', axis: ORIGIN_AXIS_IDS.z });
    expect(Object.isFrozen(axis)).toBe(true);
    expect(axisRefOf({ kind: 'sketchEntity', sketch: 's1', entity: 'ab' })).toEqual({
      kind: 'sketchEntity',
      sketch: 's1',
      entity: 'ab',
    });
  });

  it('is null for anything else', () => {
    for (const junk of [
      null,
      undefined,
      'x',
      [],
      { kind: 'axis', axis: 'junk' },
      { kind: 'axis' },
      { kind: 'sketchEntity', sketch: 's1', entity: '' },
      { kind: 'sketchEntity', sketch: '', entity: 'ab' },
      { kind: 'sketchEntity', sketch: 'a/b', entity: 'ab' },
      { kind: 'region', sketch: 's1', region: 'ab' },
    ]) {
      expect(axisRefOf(junk)).toBeNull();
    }
  });
});

describe('toggleRegionRef (M13)', () => {
  const region = (sketch: string, name: string) => ({ kind: 'region', sketch, region: name });

  it('adds the region at the end as a frozen reference', () => {
    const next = toggleRegionRef([region('s1', 'ab')], fid('s1'), 'cd');
    expect(next).toEqual([region('s1', 'ab'), region('s1', 'cd')]);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next[1])).toBe(true);
  });

  it('removes the same sketch and region, keeps the rest in order', () => {
    const value = [region('s1', 'ab'), region('s2', 'ab'), { kind: 'body', body: B1 }];
    expect(toggleRegionRef(value, fid('s1'), 'ab')).toEqual([
      region('s2', 'ab'),
      { kind: 'body', body: B1 },
    ]);
  });

  it('a value that is not an array counts as empty', () => {
    expect(toggleRegionRef(null, fid('s1'), 'ab')).toEqual([region('s1', 'ab')]);
  });
});

describe('toggleAxisRef (M13)', () => {
  const x: AxisRef = { kind: 'axis', axis: ORIGIN_AXIS_IDS.x };
  const line: SketchEntityRef = { kind: 'sketchEntity', sketch: fid('s1'), entity: 'ab' };

  it('sets the reference when the value is empty or another one', () => {
    expect(toggleAxisRef(null, x)).toBe(x);
    expect(toggleAxisRef(line, x)).toBe(x);
    expect(toggleAxisRef({ kind: 'axis', axis: ORIGIN_AXIS_IDS.y }, x)).toBe(x);
    expect(toggleAxisRef({ kind: 'sketchEntity', sketch: 's1', entity: 'bc' }, line)).toBe(line);
  });

  it('the same reference again clears the value', () => {
    expect(toggleAxisRef({ kind: 'axis', axis: ORIGIN_AXIS_IDS.x }, x)).toBeNull();
    expect(toggleAxisRef({ kind: 'sketchEntity', sketch: 's1', entity: 'ab' }, line)).toBeNull();
  });
});

describe('isSketchLine (M13)', () => {
  const rect = rectangleData();
  const withCircle = {
    entities: [
      ...rect.entities,
      { kind: 'point', id: 'o', x: 5, y: 2 },
      { kind: 'circle', id: 'k', center: 'o', radius: 1 },
    ],
    constraints: rect.constraints,
  };
  const doc = aDocument({
    features: [
      aFeature({ id: 's1', type: 'sketch', name: 'Sketch 1', params: withCircle }),
      aFeature({ id: 'f1', name: 'Box 1' }),
    ],
  });

  it('true for a line of the sketch data', () => {
    expect(isSketchLine(doc, fid('s1'), 'ab')).toBe(true);
  });

  it('false for a circle, a point, an unknown entity, a missing or a non-sketch feature', () => {
    expect(isSketchLine(doc, fid('s1'), 'k')).toBe(false);
    expect(isSketchLine(doc, fid('s1'), 'a')).toBe(false);
    expect(isSketchLine(doc, fid('s1'), 'nope')).toBe(false);
    expect(isSketchLine(doc, fid('gone'), 'ab')).toBe(false);
    expect(isSketchLine(doc, fid('f1'), 'ab')).toBe(false);
  });
});

describe('topoRefsOf (M14)', () => {
  it('frozen copies of the topo references of the right shape, in order', () => {
    const refs = topoRefsOf([
      { kind: 'topo', body: B1, name: 'f1/edge:a|b', extra: 1 },
      { kind: 'body', body: B1 },
      { kind: 'topo', body: B2, name: '' },
      { kind: 'topo', body: 'no-slash', name: 'x' },
      { kind: 'topo', body: B2, name: 7 },
      'junk',
      { kind: 'topo', body: B3, name: 'f3/face:top' },
    ]);
    expect(refs).toEqual([
      { kind: 'topo', body: B1, name: 'f1/edge:a|b' },
      { kind: 'topo', body: B3, name: 'f3/face:top' },
    ]);
    expect(Object.isFrozen(refs)).toBe(true);
    expect(refs.every((ref) => Object.isFrozen(ref))).toBe(true);
  });

  it('a value that is not an array has none', () => {
    expect(topoRefsOf(undefined)).toEqual([]);
    expect(topoRefsOf({ kind: 'topo', body: B1, name: 'x' })).toEqual([]);
  });
});

describe('toggleTopoRef (M14)', () => {
  const name = (n: string): TopoName => n as TopoName; // test names are trusted
  const topo = (body: typeof B1, n: string): TopoRef => ({ kind: 'topo', body, name: name(n) });

  it('adds the reference at the end as a frozen array', () => {
    const next = toggleTopoRef([topo(B1, 'f1/edge:a|b')], topo(B1, 'f1/edge:b|c'));
    expect(next).toEqual([topo(B1, 'f1/edge:a|b'), topo(B1, 'f1/edge:b|c')]);
    expect(Object.isFrozen(next)).toBe(true);
  });

  it('removes the same body and name and keeps the order of the rest', () => {
    const value = [topo(B1, 'a'), topo(B2, 'b'), topo(B1, 'b'), topo(B3, 'c')];
    expect(toggleTopoRef(value, topo(B1, 'b'))).toEqual([
      topo(B1, 'a'),
      topo(B2, 'b'),
      topo(B3, 'c'),
    ]);
  });

  it('the same name on another body is another reference', () => {
    expect(toggleTopoRef([topo(B1, 'a')], topo(B2, 'a'))).toEqual([topo(B1, 'a'), topo(B2, 'a')]);
  });

  it('a value that is not an array counts as empty', () => {
    expect(toggleTopoRef(undefined, topo(B1, 'a'))).toEqual([topo(B1, 'a')]);
    expect(toggleTopoRef('junk', topo(B1, 'a'))).toEqual([topo(B1, 'a')]);
  });

  it('drops items that are not topo references', () => {
    expect(
      toggleTopoRef([{ kind: 'body', body: B1 }, 'junk', topo(B2, 'b')], topo(B1, 'a')),
    ).toEqual([topo(B2, 'b'), topo(B1, 'a')]);
  });
});
