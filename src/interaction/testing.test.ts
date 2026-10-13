import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@/document';
import type {
  BodyId,
  FeatureHealth,
  HighlightTarget,
  OverlayShape,
  PickResult,
  ViewKeyEvent,
  ViewPointerEvent,
} from '.';
import type { RegenBody } from './regen-status-port';
import { FakeRegenStatus, FakeViewport } from './testing';

// Branded ids are created by a cast in tests only.
const BODY = 'f1/body' as BodyId;
const FACE: PickResult = {
  kind: 'face',
  body: BODY,
  faceIndex: 2,
  point: [1, 2, 3],
  normal: [0, 0, 1],
};
const EDGE: PickResult = { kind: 'edge', body: BODY, edgeIndex: 5, point: [0, 1, 0] };
const NO_MODS = { shift: false, alt: false, mod: false } as const;
const LINE: OverlayShape = {
  kind: 'lines',
  points: [
    [0, 0, 0],
    [1, 0, 0],
  ],
  style: 'preview',
};
const POINT: OverlayShape = { kind: 'points', points: [[2, 2, 2]], style: 'construction' };

describe('FakeViewport', () => {
  describe('pick', () => {
    it('returns null by default', () => {
      expect(new FakeViewport().pick(10, 20)).toBeNull();
    });

    it('returns the configured value', () => {
      const view = new FakeViewport();
      view.setPick(FACE);
      expect(view.pick(10, 20)).toBe(FACE);
    });

    it('calls the configured function with the coordinates', () => {
      const view = new FakeViewport();
      view.setPick((x, y) => (x < 50 ? FACE : y < 50 ? EDGE : null));
      expect(view.pick(10, 99)).toBe(FACE);
      expect(view.pick(60, 10)).toBe(EDGE);
      expect(view.pick(60, 60)).toBeNull();
    });
  });

  describe('screenToRay', () => {
    it('by default casts down -Z from the screen point in the XY plane', () => {
      expect(new FakeViewport().screenToRay(3, 4)).toEqual({
        origin: [3, 4, 0],
        direction: [0, 0, -1],
      });
    });

    it('uses the configured function', () => {
      const view = new FakeViewport();
      view.setScreenToRay((x, y) => ({ origin: [x, y, 10], direction: [1, 0, 0] }));
      expect(view.screenToRay(1, 2)).toEqual({ origin: [1, 2, 10], direction: [1, 0, 0] });
    });
  });

  describe('highlight', () => {
    it('starts with no hover and an empty selection', () => {
      const view = new FakeViewport();
      expect(view.hover).toBeNull();
      expect(view.selection).toEqual([]);
    });

    it('setHover replaces the hover state', () => {
      const view = new FakeViewport();
      view.highlight.setHover(FACE);
      view.highlight.setHover(EDGE);
      expect(view.hover).toBe(EDGE);
      view.highlight.setHover(null);
      expect(view.hover).toBeNull();
    });

    it('setSelection replaces the whole selection', () => {
      const view = new FakeViewport();
      view.highlight.setSelection([FACE, EDGE]);
      view.highlight.setSelection([EDGE]);
      expect(view.selection).toEqual([EDGE]);
      view.highlight.setSelection([]);
      expect(view.selection).toEqual([]);
    });

    it('records highlight targets without point and normal', () => {
      const view = new FakeViewport();
      const target: HighlightTarget = { kind: 'face', body: BODY, faceIndex: 2 };
      view.highlight.setHover(target);
      view.highlight.setSelection([target, FACE]);
      expect(view.hover).toBe(target);
      expect(view.selection).toEqual([target, FACE]);
    });

    it('keeps its own copy of the selection', () => {
      const view = new FakeViewport();
      const targets: HighlightTarget[] = [FACE];
      view.highlight.setSelection(targets);
      targets.push(EDGE);
      expect(view.selection).toEqual([FACE]);
    });
  });

  describe('overlay', () => {
    it('starts empty', () => {
      expect(new FakeViewport().overlayShapes.size).toBe(0);
    });

    it('set replaces all shapes under the id and keeps other ids', () => {
      const view = new FakeViewport();
      view.overlay.set('a', [LINE, POINT]);
      view.overlay.set('b', [POINT]);
      view.overlay.set('a', [POINT]);
      expect(view.overlayShapes).toEqual(
        new Map([
          ['a', [POINT]],
          ['b', [POINT]],
        ]),
      );
    });

    it('remove drops only the given id', () => {
      const view = new FakeViewport();
      view.overlay.set('a', [LINE]);
      view.overlay.set('b', [POINT]);
      view.overlay.remove('a');
      expect(view.overlayShapes).toEqual(new Map([['b', [POINT]]]));
    });

    it('remove of an unknown id does nothing', () => {
      const view = new FakeViewport();
      view.overlay.set('a', [LINE]);
      view.overlay.remove('unknown');
      expect(view.overlayShapes).toEqual(new Map([['a', [LINE]]]));
    });

    it('clear removes everything', () => {
      const view = new FakeViewport();
      view.overlay.set('a', [LINE]);
      view.overlay.set('b', [POINT]);
      view.overlay.clear();
      expect(view.overlayShapes.size).toBe(0);
    });

    it('a recorded snapshot does not change with later calls', () => {
      const view = new FakeViewport();
      view.overlay.set('a', [LINE]);
      const before = view.overlayShapes;
      view.overlay.clear();
      expect(before).toEqual(new Map([['a', [LINE]]]));
    });
  });

  describe('events', () => {
    it('delivers emitted pointer events to subscribers', () => {
      const view = new FakeViewport();
      const seen: ViewPointerEvent[] = [];
      view.events.on('pointer', (e) => seen.push(e));
      const down: ViewPointerEvent = { type: 'down', x: 1, y: 2, button: 'left', mods: NO_MODS };
      const leave: ViewPointerEvent = { type: 'leave', x: 0, y: 0, button: null, mods: NO_MODS };
      view.emitPointer(down);
      view.emitPointer(leave);
      expect(seen).toEqual([down, leave]);
    });

    it('delivers emitted key events to subscribers', () => {
      const view = new FakeViewport();
      const seen: ViewKeyEvent[] = [];
      view.events.on('key', (e) => seen.push(e));
      const key: ViewKeyEvent = { key: 'Escape', mods: NO_MODS, inTextField: false };
      view.emitKey(key);
      expect(seen).toEqual([key]);
    });

    it('stops delivering after unsubscribe', () => {
      const view = new FakeViewport();
      const seen: ViewKeyEvent[] = [];
      const off = view.events.on('key', (e) => seen.push(e));
      off();
      view.emitKey({ key: 'a', mods: NO_MODS, inTextField: false });
      expect(seen).toEqual([]);
    });
  });
});

describe('FakeRegenStatus', () => {
  // Branded ids are created by a cast in tests only.
  const F1 = 'f1' as FeatureId;
  const F2 = 'f2' as FeatureId;
  const ERROR: FeatureHealth = { kind: 'error', message: 'boom' };

  it('starts at generation 0 with no health and no bodies, frozen', () => {
    const snapshot = new FakeRegenStatus().state.get();
    expect(snapshot.generation).toBe(0);
    expect(snapshot.health.size).toBe(0);
    expect(snapshot.bodies).toEqual([]);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('publish sets frozen copies of the bodies; without them there are none', () => {
    const regen = new FakeRegenStatus();
    const bodies: RegenBody[] = [{ body: BODY, feature: F1 }];
    regen.publish(new Map(), bodies);
    const snapshot = regen.state.get();
    bodies.push({ body: BODY, feature: F2 });
    expect(snapshot.bodies).toEqual([{ body: BODY, feature: F1 }]);
    expect(Object.isFrozen(snapshot.bodies)).toBe(true);
    expect(snapshot.bodies.every((b) => Object.isFrozen(b))).toBe(true);

    regen.publish(new Map());
    expect(regen.state.get().bodies).toEqual([]);
  });

  it('publish increments the generation, sets the health and notifies subscribers', () => {
    const regen = new FakeRegenStatus();
    let calls = 0;
    regen.state.subscribe(() => calls++);
    regen.publish(new Map([[F1, { kind: 'ok' }]]));
    regen.publish(new Map([[F2, ERROR]]));
    const snapshot = regen.state.get();
    expect(calls).toBe(2);
    expect(snapshot.generation).toBe(2);
    expect(snapshot.health).toEqual(new Map([[F2, ERROR]]));
  });

  it('publish with the same health still makes a new generation', () => {
    const regen = new FakeRegenStatus();
    const health = new Map([[F1, ERROR]]);
    regen.publish(health);
    const first = regen.state.get();
    regen.publish(health);
    expect(regen.state.get()).not.toBe(first);
    expect(regen.state.get().generation).toBe(2);
  });

  it('the published snapshot is frozen and does not follow the passed map', () => {
    const regen = new FakeRegenStatus();
    const health = new Map<FeatureId, FeatureHealth>([[F1, ERROR]]);
    regen.publish(health);
    const snapshot = regen.state.get();
    health.set(F2, { kind: 'ok' });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.health).toEqual(new Map([[F1, ERROR]]));
  });
});
