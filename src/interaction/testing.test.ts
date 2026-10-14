import { describe, expect, it } from 'vitest';
import { sketchId } from '@/document';
import type { FeatureId } from '@/document';
import type {
  BodyId,
  FeatureAnchors,
  FeatureHealth,
  HandleView,
  RegenSketch,
  HighlightTarget,
  OverlayShape,
  PickKind,
  PickResult,
  SketchDrawing,
  TopoName,
  ViewKeyEvent,
  ViewPointerEvent,
} from '.';
import { NO_TOPO_NAMES } from './regen-status-port';
import { FakeRegenStatus, FakeViewport, aTopoNames } from './testing';

// Branded ids and names are created by a cast in tests only.
const BODY = 'f1/body' as BodyId;
const topoName = (s: string): TopoName => s as TopoName;
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
const SKETCH_HIT: PickResult = {
  kind: 'sketchEntity',
  sketch: 's1',
  entity: 'p1',
  point: [1, 1, 0],
};
const REGION_HIT: PickResult = {
  kind: 'sketchRegion',
  sketch: 'f1/sketch',
  region: 'r1',
  point: [1, 1, 0],
};
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] } as const;
const DRAWING_A: SketchDrawing = {
  plane: XY,
  curves: [{ kind: 'line', id: 'l1', from: [0, 0], to: [1, 0], style: 'normal' }],
  points: [{ id: 'p1', at: [0, 0], style: 'selected' }],
};
const DRAWING_B: SketchDrawing = { plane: XY, curves: [], points: [] };

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

    it('returns the result only when its kind is in the filter', () => {
      const view = new FakeViewport();
      view.setPick(EDGE);
      expect(view.pick(0, 0, ['face'])).toBeNull();
      expect(view.pick(0, 0, ['edge'])).toBe(EDGE);
      expect(view.pick(0, 0, ['face', 'edge'])).toBe(EDGE);
      expect(view.pick(0, 0, [])).toBeNull();
      view.setPick(FACE);
      expect(view.pick(0, 0, ['edge'])).toBeNull();
      expect(view.pick(0, 0, ['face'])).toBe(FACE);
    });

    it('returns a sketch entity only with sketchEntity in the filter', () => {
      const view = new FakeViewport();
      view.setPick(SKETCH_HIT);
      expect(view.pick(0, 0)).toBeNull();
      expect(view.pick(0, 0, ['face', 'edge'])).toBeNull();
      expect(view.pick(0, 0, ['sketchEntity'])).toBe(SKETCH_HIT);
    });

    it('returns a sketch region only with sketchRegion in the filter (M13)', () => {
      const view = new FakeViewport();
      view.setPick(REGION_HIT);
      expect(view.pick(0, 0)).toBeNull();
      expect(view.pick(0, 0, ['face', 'edge', 'sketchEntity'])).toBeNull();
      expect(view.pick(0, 0, ['sketchRegion'])).toBe(REGION_HIT);
    });

    it('records a drawing with regions as it is (M13)', () => {
      const view = new FakeViewport();
      const drawing: SketchDrawing = {
        ...DRAWING_B,
        regions: [
          {
            id: 'r1',
            outer: [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
            holes: [],
          },
        ],
      };
      view.sketches.set('f1/sketch', drawing);
      expect(view.sketchDrawings.get('f1/sketch')?.regions).toEqual(drawing.regions);
    });

    it('lastFilter is the filter of the last call, undefined without one', () => {
      const view = new FakeViewport();
      expect(view.lastFilter).toBeUndefined();
      view.pick(0, 0, ['face']);
      expect(view.lastFilter).toEqual(['face']);
      view.pick(0, 0, []);
      expect(view.lastFilter).toEqual([]);
      view.pick(0, 0);
      expect(view.lastFilter).toBeUndefined();
    });

    it('keeps its own copy of the filter', () => {
      const view = new FakeViewport();
      const filter: PickKind[] = ['face'];
      view.pick(0, 0, filter);
      filter.push('edge');
      expect(view.lastFilter).toEqual(['face']);
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

  describe('sketches', () => {
    it('starts empty', () => {
      expect(new FakeViewport().sketchDrawings.size).toBe(0);
    });

    it('set replaces the drawing under the id and keeps other ids', () => {
      const view = new FakeViewport();
      view.sketches.set('a', DRAWING_A);
      view.sketches.set('b', DRAWING_B);
      view.sketches.set('a', DRAWING_B);
      expect(view.sketchDrawings).toEqual(
        new Map([
          ['a', DRAWING_B],
          ['b', DRAWING_B],
        ]),
      );
    });

    it('remove drops only the given id, an unknown id does nothing', () => {
      const view = new FakeViewport();
      view.sketches.set('a', DRAWING_A);
      view.sketches.set('b', DRAWING_B);
      view.sketches.remove('a');
      view.sketches.remove('unknown');
      expect(view.sketchDrawings).toEqual(new Map([['b', DRAWING_B]]));
    });

    it('a recorded snapshot does not change with later calls', () => {
      const view = new FakeViewport();
      view.sketches.set('a', DRAWING_A);
      const before = view.sketchDrawings;
      view.sketches.remove('a');
      expect(before).toEqual(new Map([['a', DRAWING_A]]));
    });
  });

  describe('manipulators (M18)', () => {
    const VIEW: HandleView = {
      kind: 'linear',
      id: 'a',
      position: [0, 0, 0],
      direction: [1, 0, 0],
      tint: 'x',
      state: 'idle',
      dashed: false,
    };

    it('starts with no views and a pick of null', () => {
      const viewport = new FakeViewport();
      expect(viewport.manipulatorViews).toEqual([]);
      expect(viewport.manipulators.pick(1, 2)).toBeNull();
    });

    it('records the last views as a frozen copy', () => {
      const viewport = new FakeViewport();
      const views = [VIEW];
      viewport.manipulators.set(views);
      views.push({ ...VIEW, id: 'b' });
      expect(viewport.manipulatorViews).toEqual([VIEW]);
      expect(Object.isFrozen(viewport.manipulatorViews)).toBe(true);
    });

    it('pick calls the prepared function with the coordinates', () => {
      const viewport = new FakeViewport();
      viewport.prepareHandlePick((x, y) => (x === 3 && y === 4 ? 'a' : null));
      expect(viewport.manipulators.pick(3, 4)).toBe('a');
      expect(viewport.manipulators.pick(0, 0)).toBeNull();
    });
  });

  describe('project (M19)', () => {
    it('is null by default and calls the prepared function with the world point', () => {
      const viewport = new FakeViewport();
      expect(viewport.project([1, 2, 3])).toBeNull();
      viewport.prepareProject(([x, y]) => [x * 10, y * 10]);
      expect(viewport.project([1, 2, 3])).toEqual([10, 20]);
    });
  });

  describe('events', () => {
    it('delivers emitted viewChanged events to subscribers (M19)', () => {
      const view = new FakeViewport();
      const seen: number[] = [];
      view.events.on('viewChanged', (e) => seen.push(e.generation));
      view.emitViewChanged({ generation: 3 });
      expect(seen).toEqual([3]);
    });

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
    expect(snapshot.sketches).toEqual([]);
    expect(snapshot.anchors.size).toBe(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('publish sets a copy of the anchors; without them there are none (M18)', () => {
    const regen = new FakeRegenStatus();
    const anchors = new Map<FeatureId, FeatureAnchors>([[F1, { pivot: { point: [1, 2, 3] } }]]);
    regen.publish(new Map(), [], [], anchors);
    anchors.set(F2, {});
    expect(regen.state.get().anchors).toEqual(new Map([[F1, { pivot: { point: [1, 2, 3] } }]]));

    regen.publish(new Map());
    expect(regen.state.get().anchors.size).toBe(0);
  });

  it('publish sets frozen copies of the sketches; without them there are none (M12)', () => {
    const regen = new FakeRegenStatus();
    const sketches: RegenSketch[] = [{ sketch: sketchId(F1), feature: F1, regions: [] }];
    regen.publish(new Map(), [], sketches);
    const snapshot = regen.state.get();
    sketches.push({ sketch: sketchId(F2), feature: F2, regions: [] });
    expect(snapshot.sketches).toEqual([{ sketch: sketchId(F1), feature: F1, regions: [] }]);
    expect(Object.isFrozen(snapshot.sketches)).toBe(true);
    expect(snapshot.sketches.every((s) => Object.isFrozen(s))).toBe(true);

    regen.publish(new Map());
    expect(regen.state.get().sketches).toEqual([]);
  });

  it('publish copies the region names of each sketch, frozen and in order (M13)', () => {
    const regen = new FakeRegenStatus();
    const regions = ['r2', 'r1'];
    regen.publish(new Map(), [], [{ sketch: sketchId(F1), feature: F1, regions }]);
    regions.push('r3');
    const published = regen.state.get().sketches[0]?.regions;
    expect(published).toEqual(['r2', 'r1']);
    expect(Object.isFrozen(published)).toBe(true);
  });

  it('publish sets frozen copies of the bodies; without them there are none', () => {
    const regen = new FakeRegenStatus();
    const names = aTopoNames({ faces: { top: [5] } });
    const bodies = [{ body: BODY, feature: F1, names }];
    regen.publish(new Map(), bodies);
    const snapshot = regen.state.get();
    bodies.push({ body: BODY, feature: F2, names });
    expect(snapshot.bodies).toEqual([{ body: BODY, feature: F1, names }]);
    expect(snapshot.bodies[0]?.names).toBe(names);
    expect(Object.isFrozen(snapshot.bodies)).toBe(true);
    expect(snapshot.bodies.every((b) => Object.isFrozen(b))).toBe(true);

    regen.publish(new Map());
    expect(regen.state.get().bodies).toEqual([]);
  });

  it('publish gives a body without names NO_TOPO_NAMES (M14)', () => {
    const regen = new FakeRegenStatus();
    regen.publish(new Map(), [{ body: BODY, feature: F1 }]);
    expect(regen.state.get().bodies[0]?.names).toBe(NO_TOPO_NAMES);
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

describe('NO_TOPO_NAMES', () => {
  it('names nothing', () => {
    expect(NO_TOPO_NAMES.nameOfFace(0)).toBeUndefined();
    expect(NO_TOPO_NAMES.nameOfEdge(0)).toBeUndefined();
    expect(NO_TOPO_NAMES.faces(topoName('f1/face:top'))).toEqual([]);
    expect(NO_TOPO_NAMES.edges(topoName('f1/edge:a|b'))).toEqual([]);
    expect(Object.isFrozen(NO_TOPO_NAMES)).toBe(true);
  });
});

describe('aTopoNames', () => {
  const names = aTopoNames({
    faces: {
      'f1/face:top': [5],
      'f1/face:split': [3, 1],
      'a/face:merged': [4],
      'b/face:merged': [4],
    },
    edges: { 'f1/edge:a|b': [7] },
  });

  it('finds the indices of a name, ascending; an unknown name has none', () => {
    expect(names.faces(topoName('f1/face:top'))).toEqual([5]);
    expect(names.faces(topoName('f1/face:split'))).toEqual([1, 3]);
    expect(names.edges(topoName('f1/edge:a|b'))).toEqual([7]);
    expect(names.faces(topoName('f1/edge:a|b'))).toEqual([]);
    expect(names.edges(topoName('unknown'))).toEqual([]);
  });

  it('names an index; with several names the first in sorted order', () => {
    expect(names.nameOfFace(5)).toBe('f1/face:top');
    expect(names.nameOfFace(1)).toBe('f1/face:split');
    expect(names.nameOfFace(4)).toBe('a/face:merged');
    expect(names.nameOfFace(0)).toBeUndefined();
    expect(names.nameOfEdge(7)).toBe('f1/edge:a|b');
    expect(names.nameOfEdge(5)).toBeUndefined();
  });

  it('without arguments names nothing', () => {
    const empty = aTopoNames();
    expect(empty.nameOfFace(0)).toBeUndefined();
    expect(empty.faces(topoName('x'))).toEqual([]);
  });

  it('returns frozen arrays', () => {
    expect(Object.isFrozen(names.faces(topoName('f1/face:split')))).toBe(true);
    expect(Object.isFrozen(names.faces(topoName('unknown')))).toBe(true);
  });
});
