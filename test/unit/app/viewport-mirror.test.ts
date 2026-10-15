import { describe, expect, it } from 'vitest';
import { ObservableValue } from '@/core';
import { DEFAULT_BODY_MATERIAL, ORIGIN_AXES, ORIGIN_PLANES } from '@/document';
import type { AxisId, BodyId, BodyMaterial, PlaneId } from '@/document';
import { axisDrawing, planeDrawing } from '@/sketcher';
import { bindBrowserView, mirrorMap, mirrorSet } from '@/app/viewport-mirror';
import { FakeAppViewport } from '@/app/testing';

// Branded ids are created by a cast at one place in tests.
const A = 'a' as BodyId;
const B = 'b' as BodyId;

/** A target that records every call, oldest first. */
function aRecordingTarget<K, V>() {
  const calls: (readonly ['set', K, V] | readonly ['remove', K])[] = [];
  return {
    calls,
    set(key: K, value: V) {
      calls.push(['set', key, value]);
    },
    remove(key: K) {
      calls.push(['remove', key]);
    },
  };
}

function aRecordingSetTarget<K>() {
  const calls: (readonly ['add', K] | readonly ['remove', K])[] = [];
  return {
    calls,
    add(key: K) {
      calls.push(['add', key]);
    },
    remove(key: K) {
      calls.push(['remove', key]);
    },
  };
}

describe('mirrorMap', () => {
  it('applies the state it starts with', () => {
    const source = new ObservableValue<ReadonlyMap<BodyId, string>>(new Map([[A, '#ff0000']]));
    const target = aRecordingTarget<BodyId, string>();
    mirrorMap(source, target);
    expect(target.calls).toEqual([['set', A, '#ff0000']]);
  });

  it('sends only the difference: an added, a changed and a removed key', () => {
    const source = new ObservableValue<ReadonlyMap<BodyId, string>>(new Map([[A, '#ff0000']]));
    const target = aRecordingTarget<BodyId, string>();
    mirrorMap(source, target);
    target.calls.length = 0;

    source.set(new Map([[B, '#00ff00']]).set(A, '#ff0000'));
    expect(target.calls).toEqual([['set', B, '#00ff00']]);
    target.calls.length = 0;

    source.set(new Map([[A, '#0000ff']]));
    expect(target.calls).toEqual([
      ['set', A, '#0000ff'],
      ['remove', B],
    ]);
  });

  it('the same content in a new map calls nothing', () => {
    const source = new ObservableValue<ReadonlyMap<BodyId, string>>(new Map([[A, '#ff0000']]));
    const target = aRecordingTarget<BodyId, string>();
    mirrorMap(source, target);
    target.calls.length = 0;
    source.set(new Map([[A, '#ff0000']]));
    expect(target.calls).toEqual([]);
  });

  it('reapply sends the whole state again: a value the target dropped is set again', () => {
    // The view drops a colour of a body it does not show yet (spec 09); app applies it again
    // after every sync.
    const source = new ObservableValue<ReadonlyMap<BodyId, string>>(new Map([[A, '#ff0000']]));
    const target = aRecordingTarget<BodyId, string>();
    const mirror = mirrorMap(source, target);
    target.calls.length = 0;
    mirror.reapply();
    expect(target.calls).toEqual([['set', A, '#ff0000']]);
  });

  it('after dispose it follows nothing and reapply does nothing', () => {
    const source = new ObservableValue<ReadonlyMap<BodyId, string>>(new Map());
    const target = aRecordingTarget<BodyId, string>();
    const mirror = mirrorMap(source, target);
    mirror.dispose();
    source.set(new Map([[A, '#ff0000']]));
    mirror.reapply();
    expect(target.calls).toEqual([]);
  });
});

describe('mirrorSet', () => {
  it('adds the keys it starts with, then only the difference', () => {
    const source = new ObservableValue<ReadonlySet<BodyId>>(new Set([A]));
    const target = aRecordingSetTarget<BodyId>();
    mirrorSet(source, target);
    expect(target.calls).toEqual([['add', A]]);
    target.calls.length = 0;

    source.set(new Set([B]));
    expect(target.calls).toEqual([
      ['add', B],
      ['remove', A],
    ]);
  });

  it('the same keys in a new set call nothing; reapply adds them all again', () => {
    const source = new ObservableValue<ReadonlySet<BodyId>>(new Set([A, B]));
    const target = aRecordingSetTarget<BodyId>();
    const mirror = mirrorSet(source, target);
    target.calls.length = 0;
    source.set(new Set([B, A]));
    expect(target.calls).toEqual([]);
    mirror.reapply();
    expect(target.calls).toEqual([
      ['add', B],
      ['add', A],
    ]);
  });
});

describe('bindBrowserView', () => {
  function setup() {
    const browser = {
      hidden: new ObservableValue<ReadonlySet<BodyId>>(new Set()),
      colors: new ObservableValue<ReadonlyMap<BodyId, string>>(new Map()),
      materials: new ObservableValue<ReadonlyMap<BodyId, BodyMaterial>>(new Map()),
      visiblePlanes: new ObservableValue<ReadonlySet<PlaneId>>(new Set()),
      visibleAxes: new ObservableValue<ReadonlySet<AxisId>>(new Set()),
    };
    const viewport = new FakeAppViewport();
    const binding = bindBrowserView(browser, viewport);
    return { browser, viewport, binding };
  }

  it('hiding a body hides it in the view, showing shows it', () => {
    const { browser, viewport } = setup();
    browser.hidden.set(new Set([A]));
    browser.hidden.set(new Set());
    expect(viewport.visibilityCalls).toEqual([
      { body: A, visible: false },
      { body: A, visible: true },
    ]);
  });

  it('a colour goes to the view, a removed one resets it with null', () => {
    const { browser, viewport } = setup();
    browser.colors.set(new Map([[A, '#ff0000']]));
    browser.colors.set(new Map());
    expect(viewport.colorCalls).toEqual([
      { body: A, color: '#ff0000' },
      { body: A, color: null },
    ]);
  });

  it('a material goes to the view, a changed one again, a removed one resets it to the default', () => {
    const { browser, viewport } = setup();
    browser.materials.set(new Map([[A, 'steel']]));
    browser.materials.set(new Map([[A, 'glass']]));
    browser.materials.set(new Map());
    expect(viewport.materialCalls).toEqual([
      { body: A, material: 'steel' },
      { body: A, material: 'glass' },
      { body: A, material: DEFAULT_BODY_MATERIAL },
    ]);
  });

  it('materials present at binding are applied at once', () => {
    const viewport = new FakeAppViewport();
    bindBrowserView(
      {
        hidden: new ObservableValue<ReadonlySet<BodyId>>(new Set()),
        colors: new ObservableValue<ReadonlyMap<BodyId, string>>(new Map()),
        materials: new ObservableValue<ReadonlyMap<BodyId, BodyMaterial>>(new Map([[B, 'brass']])),
        visiblePlanes: new ObservableValue<ReadonlySet<PlaneId>>(new Set()),
        visibleAxes: new ObservableValue<ReadonlySet<AxisId>>(new Set()),
      },
      viewport,
    );
    expect(viewport.materialCalls).toEqual([{ body: B, material: 'brass' }]);
  });

  it('reapply hides, colours and sets materials again (after a sync), planes are not drawn again', () => {
    const { browser, viewport, binding } = setup();
    browser.hidden.set(new Set([A]));
    browser.colors.set(new Map([[B, '#00ff00']]));
    browser.materials.set(new Map([[A, 'rubber']]));
    const plane = ORIGIN_PLANES[0] ?? expect.fail('no origin plane');
    browser.visiblePlanes.set(new Set([plane.id]));
    viewport.visibilityCalls.length = 0;
    viewport.colorCalls.length = 0;
    viewport.materialCalls.length = 0;

    binding.reapply();
    expect(viewport.visibilityCalls).toEqual([{ body: A, visible: false }]);
    expect(viewport.colorCalls).toEqual([{ body: B, color: '#00ff00' }]);
    expect(viewport.materialCalls).toEqual([{ body: A, material: 'rubber' }]);
  });

  it('an origin plane switched on is drawn under its id, switched off removed', () => {
    const { browser, viewport } = setup();
    const plane = ORIGIN_PLANES[1] ?? expect.fail('no origin plane');
    browser.visiblePlanes.set(new Set([plane.id]));
    expect(viewport.sketchDrawings.get(plane.id)).toEqual(planeDrawing(plane.plane));
    browser.visiblePlanes.set(new Set());
    expect(viewport.sketchDrawings.has(plane.id)).toBe(false);
  });

  it('an origin axis switched on is drawn under its id, switched off removed', () => {
    const { browser, viewport } = setup();
    const axis = ORIGIN_AXES[2] ?? expect.fail('no origin axis');
    browser.visibleAxes.set(new Set([axis.id]));
    expect(viewport.sketchDrawings.get(axis.id)).toEqual(axisDrawing(axis));
    browser.visibleAxes.set(new Set());
    expect(viewport.sketchDrawings.has(axis.id)).toBe(false);
  });

  it('after dispose the view follows nothing', () => {
    const { browser, viewport, binding } = setup();
    binding.dispose();
    browser.hidden.set(new Set([A]));
    browser.colors.set(new Map([[A, '#ff0000']]));
    browser.materials.set(new Map([[A, 'steel']]));
    binding.reapply();
    expect(viewport.visibilityCalls).toEqual([]);
    expect(viewport.colorCalls).toEqual([]);
    expect(viewport.materialCalls).toEqual([]);
  });
});
