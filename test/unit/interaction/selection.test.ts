import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureId, FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import type { BodyId, HighlightTarget, SelectionItem, TopoName } from '@/interaction';
import { createFeatureEditor } from '@/interaction/feature-dialog/feature-editor';
import {
  bindSelectionHighlight,
  createSelectionModel,
  sameSelectionItem,
} from '@/interaction/selection';
import { FakeRegenStatus, FakeViewport, aTopoNames } from '@/interaction/testing';

// Branded ids are created by a cast in tests only.
const BODY = 'f1/body' as BodyId;
const OTHER_BODY = 'f2/body' as BodyId;
const FEATURE = 'f1' as FeatureId;
const OTHER_FEATURE = 'f2' as FeatureId;
const TOP = 'f1/face:top' as TopoName;
const SIDE = 'f1/face:side' as TopoName;
const RIM = 'f1/edge:top|side' as TopoName;

const FACE: SelectionItem = { kind: 'face', body: BODY, faceIndex: 2 };
const EDGE: SelectionItem = { kind: 'edge', body: BODY, edgeIndex: 5 };
const BODY_ITEM: SelectionItem = { kind: 'body', body: BODY };
const FEATURE_ITEM: SelectionItem = { kind: 'feature', feature: FEATURE };
const PLANE_ITEM: SelectionItem = { kind: 'plane', plane: ORIGIN_PLANE_IDS.xy };

function setup() {
  const regen = new FakeRegenStatus();
  const selection = createSelectionModel({ regen });
  let emits = 0;
  selection.items.subscribe(() => emits++);
  return { regen, selection, emits: () => emits };
}

describe('sameSelectionItem', () => {
  it('compares by kind, id and index', () => {
    expect(sameSelectionItem(FACE, { kind: 'face', body: BODY, faceIndex: 2 })).toBe(true);
    expect(sameSelectionItem(FACE, { kind: 'face', body: BODY, faceIndex: 3 })).toBe(false);
    expect(sameSelectionItem(FACE, { kind: 'face', body: OTHER_BODY, faceIndex: 2 })).toBe(false);
    expect(sameSelectionItem(FACE, { kind: 'edge', body: BODY, edgeIndex: 2 })).toBe(false);
    expect(sameSelectionItem(EDGE, { kind: 'edge', body: BODY, edgeIndex: 5 })).toBe(true);
    expect(sameSelectionItem(BODY_ITEM, { kind: 'body', body: BODY })).toBe(true);
    expect(sameSelectionItem(BODY_ITEM, { kind: 'body', body: OTHER_BODY })).toBe(false);
    expect(sameSelectionItem(FEATURE_ITEM, { kind: 'feature', feature: FEATURE })).toBe(true);
    expect(sameSelectionItem(FEATURE_ITEM, BODY_ITEM)).toBe(false);
  });

  it('ignores the name (M14)', () => {
    expect(sameSelectionItem({ ...FACE, name: TOP }, FACE)).toBe(true);
    expect(sameSelectionItem({ ...FACE, name: TOP }, { ...FACE, name: SIDE })).toBe(true);
    expect(sameSelectionItem({ ...EDGE, name: RIM }, EDGE)).toBe(true);
  });

  it('compares planes by id (M12)', () => {
    expect(sameSelectionItem(PLANE_ITEM, { kind: 'plane', plane: ORIGIN_PLANE_IDS.xy })).toBe(true);
    expect(sameSelectionItem(PLANE_ITEM, { kind: 'plane', plane: ORIGIN_PLANE_IDS.xz })).toBe(
      false,
    );
    expect(sameSelectionItem(PLANE_ITEM, FEATURE_ITEM)).toBe(false);
    expect(sameSelectionItem(FEATURE_ITEM, PLANE_ITEM)).toBe(false);
  });
});

describe('SelectionModel', () => {
  it('starts empty', () => {
    expect(setup().selection.items.get()).toEqual([]);
  });

  it('exposes items as a read-only view without set', () => {
    expect('set' in setup().selection.items).toBe(false);
  });

  describe('set', () => {
    it('drops duplicates, the first occurrence wins', () => {
      const { selection, emits } = setup();
      const dup: SelectionItem = { kind: 'face', body: BODY, faceIndex: 2 };

      selection.set([FACE, EDGE, dup, BODY_ITEM, EDGE]);

      expect(selection.items.get()).toEqual([FACE, EDGE, BODY_ITEM]);
      expect(emits()).toBe(1);
    });

    it('emits nothing when the content is the same', () => {
      const { selection, emits } = setup();
      selection.set([FACE, EDGE]);
      const before = selection.items.get();

      selection.set([{ kind: 'face', body: BODY, faceIndex: 2 }, EDGE, FACE]);

      expect(emits()).toBe(1);
      expect(selection.items.get()).toBe(before);
    });

    it('emits nothing when an empty selection is set empty', () => {
      const { selection, emits } = setup();
      selection.set([]);
      expect(emits()).toBe(0);
    });

    it('keeps unchanged items identical in the new snapshot', () => {
      const { selection } = setup();
      selection.set([FACE, EDGE]);
      const [face] = selection.items.get();

      selection.set([{ kind: 'face', body: BODY, faceIndex: 2 }, BODY_ITEM]);

      expect(selection.items.get()[0]).toBe(face);
    });

    it('treats a different order as a change', () => {
      const { selection, emits } = setup();
      selection.set([FACE, EDGE]);
      selection.set([EDGE, FACE]);
      expect(emits()).toBe(2);
      expect(selection.items.get()).toEqual([EDGE, FACE]);
    });
  });

  describe('toggle', () => {
    it('adds a missing item to the end', () => {
      const { selection, emits } = setup();
      selection.set([FACE]);

      selection.toggle(EDGE);

      expect(selection.items.get()).toEqual([FACE, EDGE]);
      expect(emits()).toBe(2);
    });

    it('removes an item compared by value', () => {
      const { selection } = setup();
      selection.set([FACE, EDGE, BODY_ITEM]);
      const [face, , body] = selection.items.get();

      selection.toggle({ kind: 'edge', body: BODY, edgeIndex: 5 });

      expect(selection.items.get()).toEqual([FACE, BODY_ITEM]);
      expect(selection.items.get()[0]).toBe(face);
      expect(selection.items.get()[1]).toBe(body);
    });
  });

  describe('clear', () => {
    it('empties the selection', () => {
      const { selection, emits } = setup();
      selection.set([FACE]);
      selection.clear();
      expect(selection.items.get()).toEqual([]);
      expect(emits()).toBe(2);
    });

    it('emits nothing on an empty selection', () => {
      const { selection, emits } = setup();
      selection.clear();
      expect(emits()).toBe(0);
    });
  });

  it('publishes frozen snapshots and items', () => {
    const { selection } = setup();
    expect(Object.isFrozen(selection.items.get())).toBe(true);

    selection.set([FACE, FEATURE_ITEM]);

    const items = selection.items.get();
    expect(Object.isFrozen(items)).toBe(true);
    for (const item of items) expect(Object.isFrozen(item)).toBe(true);
  });

  it('does not share item objects with the caller', () => {
    const { selection } = setup();
    const mutable = { kind: 'face' as const, body: BODY, faceIndex: 1 };

    selection.set([mutable]);
    mutable.faceIndex = 9;

    expect(selection.items.get()).toEqual([{ kind: 'face', body: BODY, faceIndex: 1 }]);
  });

  describe('new regeneration', () => {
    it('removes face and edge items, keeps feature and body', () => {
      const { regen, selection, emits } = setup();
      selection.set([FEATURE_ITEM, FACE, BODY_ITEM, EDGE]);
      const [feature, , body] = selection.items.get();

      regen.publish(new Map());

      expect(selection.items.get()).toEqual([FEATURE_ITEM, BODY_ITEM]);
      expect(selection.items.get()[0]).toBe(feature);
      expect(selection.items.get()[1]).toBe(body);
      expect(Object.isFrozen(selection.items.get())).toBe(true);
      expect(emits()).toBe(2);
    });

    it('keeps plane items (M12)', () => {
      const { regen, selection } = setup();
      selection.set([PLANE_ITEM, FACE]);
      const [plane] = selection.items.get();

      regen.publish(new Map());

      expect(selection.items.get()).toEqual([PLANE_ITEM]);
      expect(selection.items.get()[0]).toBe(plane);
    });

    it('emits nothing without face or edge items', () => {
      const { regen, selection, emits } = setup();
      selection.set([FEATURE_ITEM, BODY_ITEM]);
      const before = selection.items.get();

      regen.publish(new Map());

      expect(selection.items.get()).toBe(before);
      expect(emits()).toBe(1);
    });

    it('removes nothing after dispose, and the selection still works', () => {
      const { regen, selection } = setup();
      selection.set([FACE, EDGE]);

      selection.dispose();
      selection.dispose();
      regen.publish(new Map());

      expect(selection.items.get()).toEqual([FACE, EDGE]);
      selection.toggle(EDGE);
      expect(selection.items.get()).toEqual([FACE]);
    });

    it('keeps items selected after the regeneration', () => {
      const { regen, selection } = setup();
      regen.publish(new Map());

      selection.set([FACE]);

      expect(selection.items.get()).toEqual([FACE]);
    });
  });
});

describe('plane items (M12)', () => {
  it('stores a frozen copy with only the plane field', () => {
    const { selection } = setup();
    const mutable = { kind: 'plane' as const, plane: ORIGIN_PLANE_IDS.yz, extra: 1 };

    selection.set([mutable]);

    const [stored] = selection.items.get();
    expect(stored).toEqual({ kind: 'plane', plane: ORIGIN_PLANE_IDS.yz });
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it('is not highlighted', () => {
    const { selection } = setup();
    const viewport = new FakeViewport();
    bindSelectionHighlight(selection, viewport.highlight);

    selection.set([PLANE_ITEM, FACE]);

    expect(viewport.selection).toEqual([{ kind: 'face', body: BODY, faceIndex: 2 }]);
  });
});

describe('bindSelectionHighlight', () => {
  it('passes face, edge and body items in selection order, at once and after a change', () => {
    const { selection } = setup();
    const viewport = new FakeViewport();
    selection.set([EDGE, FEATURE_ITEM]);

    bindSelectionHighlight(selection, viewport.highlight);
    const expectedEdge: HighlightTarget = { kind: 'edge', body: BODY, edgeIndex: 5 };
    expect(viewport.selection).toEqual([expectedEdge]);

    selection.set([BODY_ITEM, FACE, EDGE]);
    expect(viewport.selection).toEqual([
      { kind: 'body', body: BODY },
      { kind: 'face', body: BODY, faceIndex: 2 },
      expectedEdge,
    ]);
  });

  it('passes an empty array when nothing is selected', () => {
    const { selection } = setup();
    const viewport = new FakeViewport();
    viewport.highlight.setSelection([{ kind: 'face', body: BODY, faceIndex: 0 }]);

    bindSelectionHighlight(selection, viewport.highlight);

    expect(viewport.selection).toEqual([]);
  });

  it('stops after unsubscribing', () => {
    const { selection } = setup();
    const viewport = new FakeViewport();
    const off = bindSelectionHighlight(selection, viewport.highlight);

    off();
    selection.set([FACE]);

    expect(viewport.selection).toEqual([]);
  });
});

describe('bindSelectionHighlight with the feature dialog (M13)', () => {
  const PARAMS: ParamSchema = {
    mode: {
      kind: 'enum',
      label: 'mode',
      default: 'on',
      options: [
        { value: 'on', label: 'on' },
        { value: 'off', label: 'off' },
      ],
    },
    regions: { kind: 'region', label: 'regions', visibleWhen: (p) => p['mode'] === 'on' },
    others: { kind: 'region', label: 'others' },
  };
  const SCHEMA: FeatureSchema = {
    type: 'profile',
    version: 1,
    label: 'profile',
    params: PARAMS,
    defaults: () => ({ mode: 'on', regions: [], others: [] }),
    validate: (params) => validateAgainstSchema(PARAMS, params),
  };
  const region = (sketch: string, name: string) => ({ kind: 'region', sketch, region: name });

  function setupDialog() {
    const { selection } = setup();
    const viewport = new FakeViewport();
    const schemas = createFeatureSchemaRegistry();
    schemas.register(SCHEMA);
    const ops = anOpsSession({ schemas });
    const editor = createFeatureEditor({
      doc: ops.doc,
      ops: ops.dispatcher,
      schemas,
      ids: createSequentialIdGenerator('new'),
    });
    const off = bindSelectionHighlight(selection, viewport.highlight, editor);
    return { selection, viewport, editor, off };
  }

  it('adds the regions of visible region params after the selection, in schema order', () => {
    const { selection, viewport, editor } = setupDialog();
    selection.set([FACE]);
    const session = editor.create('profile');
    expect(viewport.selection).toEqual([{ kind: 'face', body: BODY, faceIndex: 2 }]);

    session.setParams({
      regions: [region('s1', 'ab,bc'), { kind: 'body', body: BODY }, 'junk'],
      others: [region('s2', 'k')],
    });

    expect(viewport.selection).toEqual([
      { kind: 'face', body: BODY, faceIndex: 2 },
      { kind: 'sketchRegion', sketch: 's1/sketch', region: 'ab,bc' },
      { kind: 'sketchRegion', sketch: 's2/sketch', region: 'k' },
    ]);
  });

  it('follows a change of the value, a hidden param and the closing of the session', () => {
    const { viewport, editor } = setupDialog();
    const session = editor.create('profile');
    session.setParam('regions', [region('s1', 'a')]);
    expect(viewport.selection).toEqual([
      { kind: 'sketchRegion', sketch: 's1/sketch', region: 'a' },
    ]);

    session.setParam('regions', [region('s1', 'a'), region('s1', 'b')]);
    expect(viewport.selection).toHaveLength(2);

    session.setParam('mode', 'off');
    expect(viewport.selection).toEqual([]);

    session.setParam('mode', 'on');
    expect(viewport.selection).toHaveLength(2);

    session.cancel();
    expect(viewport.selection).toEqual([]);
  });

  it('follows the next session and stops after unsubscribing', () => {
    const { viewport, editor, off } = setupDialog();
    editor.create('profile').commit();
    const second = editor.create('profile');
    second.setParam('others', [region('s3', 'x')]);
    expect(viewport.selection).toEqual([
      { kind: 'sketchRegion', sketch: 's3/sketch', region: 'x' },
    ]);

    off();
    second.setParam('others', []);
    expect(viewport.selection).toEqual([
      { kind: 'sketchRegion', sketch: 's3/sketch', region: 'x' },
    ]);
  });
});

describe('topological names (M14)', () => {
  /** A selection whose last snapshot has BODY named by `names` and OTHER_BODY without names. */
  function named(faces: Record<string, number[]>, edges: Record<string, number[]> = {}) {
    const ctx = setup();
    ctx.regen.publish(new Map(), [
      { body: BODY, feature: FEATURE, names: aTopoNames({ faces, edges }) },
      { body: OTHER_BODY, feature: OTHER_FEATURE },
    ]);
    return ctx;
  }

  describe('set and toggle', () => {
    it('fill in the name from the last snapshot', () => {
      const { selection } = named({ [TOP]: [2] }, { [RIM]: [5] });

      selection.set([FACE]);
      expect(selection.items.get()).toEqual([{ ...FACE, name: TOP }]);

      selection.toggle(EDGE);
      expect(selection.items.get()).toEqual([
        { ...FACE, name: TOP },
        { ...EDGE, name: RIM },
      ]);
      expect(selection.items.get().every((item) => Object.isFrozen(item))).toBe(true);
    });

    it('ignore the name of the caller', () => {
      const { selection } = named({ [TOP]: [2] });

      selection.set([
        { ...FACE, name: SIDE },
        { kind: 'face', body: BODY, faceIndex: 3, name: SIDE },
      ]);

      expect(selection.items.get()).toEqual([
        { ...FACE, name: TOP },
        { kind: 'face', body: BODY, faceIndex: 3 },
      ]);
    });

    it('leave out the name when the body is not in the snapshot or has no names', () => {
      const { selection } = named({ [TOP]: [2] });
      const missing = 'f9/body' as BodyId;

      selection.set([
        { kind: 'face', body: missing, faceIndex: 2 },
        { kind: 'face', body: OTHER_BODY, faceIndex: 2 },
      ]);

      const items = selection.items.get();
      expect(items).toEqual([
        { kind: 'face', body: missing, faceIndex: 2 },
        { kind: 'face', body: OTHER_BODY, faceIndex: 2 },
      ]);
      expect(items.every((item) => !('name' in item))).toBe(true);
    });

    it('fill in no name before the first regeneration', () => {
      const { selection } = setup();
      selection.set([FACE]);
      expect('name' in (selection.items.get()[0] ?? {})).toBe(false);
    });
  });

  describe('new regeneration', () => {
    it('moves a selected edge to the new index of its name', () => {
      const { regen, selection } = named({}, { [RIM]: [5] });
      selection.set([EDGE]);

      regen.publish(new Map(), [
        { body: BODY, feature: FEATURE, names: aTopoNames({ edges: { [RIM]: [8] } }) },
      ]);

      expect(selection.items.get()).toEqual([
        { kind: 'edge', body: BODY, edgeIndex: 8, name: RIM },
      ]);
      expect(Object.isFrozen(selection.items.get()[0])).toBe(true);
    });

    it('replaces a face whose name now has two faces by both, in place and ascending', () => {
      const { regen, selection } = named({ [TOP]: [2] });
      selection.set([FEATURE_ITEM, FACE, BODY_ITEM]);

      regen.publish(new Map(), [
        { body: BODY, feature: FEATURE, names: aTopoNames({ faces: { [TOP]: [7, 4] } }) },
      ]);

      expect(selection.items.get()).toEqual([
        FEATURE_ITEM,
        { kind: 'face', body: BODY, faceIndex: 4, name: TOP },
        { kind: 'face', body: BODY, faceIndex: 7, name: TOP },
        BODY_ITEM,
      ]);
    });

    it('drops duplicates of the remapped items, the first occurrence wins', () => {
      const { regen, selection } = named({ [TOP]: [2], [SIDE]: [3] });
      selection.set([FACE, { kind: 'face', body: BODY, faceIndex: 3 }]);

      // The two names merged on one face.
      regen.publish(new Map(), [
        {
          body: BODY,
          feature: FEATURE,
          names: aTopoNames({ faces: { [TOP]: [6], [SIDE]: [6] } }),
        },
      ]);

      expect(selection.items.get()).toEqual([
        { kind: 'face', body: BODY, faceIndex: 6, name: TOP },
      ]);
    });

    it('drops a vanished name, a vanished body and an item without a name', () => {
      const { regen, selection } = named({ [TOP]: [2], [SIDE]: [3] });
      const unnamed: SelectionItem = { kind: 'face', body: BODY, faceIndex: 9 };
      const other: SelectionItem = { kind: 'face', body: OTHER_BODY, faceIndex: 1 };
      selection.set([FACE, { kind: 'face', body: BODY, faceIndex: 3 }, unnamed, other, PLANE_ITEM]);

      regen.publish(new Map(), [
        { body: BODY, feature: FEATURE, names: aTopoNames({ faces: { [SIDE]: [3] } }) },
      ]);

      expect(selection.items.get()).toEqual([
        { kind: 'face', body: BODY, faceIndex: 3, name: SIDE },
        PLANE_ITEM,
      ]);

      regen.publish(new Map());
      expect(selection.items.get()).toEqual([PLANE_ITEM]);
    });

    it('emits nothing and keeps the items identical when nothing moved', () => {
      const { regen, selection, emits } = named({ [TOP]: [2] }, { [RIM]: [5] });
      selection.set([FACE, EDGE, BODY_ITEM]);
      const before = selection.items.get();

      regen.publish(new Map(), [
        {
          body: BODY,
          feature: FEATURE,
          names: aTopoNames({ faces: { [TOP]: [2] }, edges: { [RIM]: [5] } }),
        },
      ]);

      expect(selection.items.get()).toBe(before);
      expect(emits()).toBe(1);
    });
  });

  it('bindSelectionHighlight passes body items as body targets', () => {
    const { selection } = setup();
    const viewport = new FakeViewport();
    bindSelectionHighlight(selection, viewport.highlight);

    selection.set([BODY_ITEM, FEATURE_ITEM, FACE, PLANE_ITEM]);

    expect(viewport.selection).toEqual([
      { kind: 'body', body: BODY },
      { kind: 'face', body: BODY, faceIndex: 2 },
    ]);
  });
});

describe('bindSelectionHighlight with topo and bodies params of the dialog (M14)', () => {
  const PARAMS: ParamSchema = {
    mode: {
      kind: 'enum',
      label: 'mode',
      default: 'on',
      options: [
        { value: 'on', label: 'on' },
        { value: 'off', label: 'off' },
      ],
    },
    edges: { kind: 'topo', label: 'edges', entity: 'edge', visibleWhen: (p) => p['mode'] === 'on' },
    faces: { kind: 'topo', label: 'faces', entity: 'face' },
    tools: { kind: 'bodies', label: 'tools' },
    regions: { kind: 'region', label: 'regions' },
  };
  const SCHEMA: FeatureSchema = {
    type: 'dressup',
    version: 1,
    label: 'dressup',
    params: PARAMS,
    defaults: () => ({ mode: 'on', edges: [], faces: [], tools: [], regions: [] }),
    validate: (params) => validateAgainstSchema(PARAMS, params),
  };
  const E1 = 'f1/edge:face:a|face:b' as TopoName;
  const E2 = 'f1/edge:face:b|face:c' as TopoName;
  const topo = (name: TopoName, body: BodyId = BODY) => ({ kind: 'topo', body, name });

  function setupDialog(options: { readonly withRegen?: boolean } = {}) {
    const { selection, regen } = setup();
    regen.publish(new Map(), [
      {
        body: BODY,
        feature: FEATURE,
        names: aTopoNames({ edges: { [E1]: [1], [E2]: [4] }, faces: { [TOP]: [2, 6] } }),
      },
      { body: OTHER_BODY, feature: OTHER_FEATURE },
    ]);
    const viewport = new FakeViewport();
    const schemas = createFeatureSchemaRegistry();
    schemas.register(SCHEMA);
    const ops = anOpsSession({ schemas });
    const editor = createFeatureEditor({
      doc: ops.doc,
      ops: ops.dispatcher,
      schemas,
      ids: createSequentialIdGenerator('new'),
    });
    const off = bindSelectionHighlight(
      selection,
      viewport.highlight,
      editor,
      options.withRegen === false ? undefined : regen,
    );
    const session = editor.create('dressup');
    return { selection, regen, viewport, session, off };
  }

  it('two edges of a Fillet dialog → two edge targets after the selection', () => {
    const { selection, viewport, session } = setupDialog();
    selection.set([FACE]);
    session.setParam('edges', [topo(E1), topo(E2)]);

    expect(viewport.selection).toEqual([
      { kind: 'face', body: BODY, faceIndex: 2 },
      { kind: 'edge', body: BODY, edgeIndex: 1 },
      { kind: 'edge', body: BODY, edgeIndex: 4 },
    ]);
  });

  it('a name on two faces → both, in schema order after the edges, without duplicates', () => {
    const { selection, viewport, session } = setupDialog();
    selection.set([{ kind: 'edge', body: BODY, edgeIndex: 4 }]);
    session.setParams({ faces: [topo(TOP)], edges: [topo(E2), topo(E1)] });

    expect(viewport.selection).toEqual([
      { kind: 'edge', body: BODY, edgeIndex: 4 },
      { kind: 'edge', body: BODY, edgeIndex: 1 },
      { kind: 'face', body: BODY, faceIndex: 2 },
      { kind: 'face', body: BODY, faceIndex: 6 },
    ]);
  });

  it('a new snapshot with other indices gives new targets', () => {
    const { regen, viewport, session } = setupDialog();
    session.setParam('edges', [topo(E1)]);
    expect(viewport.selection).toEqual([{ kind: 'edge', body: BODY, edgeIndex: 1 }]);

    regen.publish(new Map(), [
      { body: BODY, feature: FEATURE, names: aTopoNames({ edges: { [E1]: [8] } }) },
    ]);

    expect(viewport.selection).toEqual([{ kind: 'edge', body: BODY, edgeIndex: 8 }]);
  });

  it('an unresolved reference, an unnamed body and junk give nothing', () => {
    const { viewport, session } = setupDialog();
    session.setParam('edges', [
      topo('f1/edge:gone' as TopoName),
      topo(E1, OTHER_BODY),
      topo(E1, 'f9/body' as BodyId),
      { kind: 'body', body: BODY },
      'junk',
    ]);
    expect(viewport.selection).toEqual([]);
  });

  it('a hidden param gives nothing', () => {
    const { viewport, session } = setupDialog();
    session.setParam('edges', [topo(E1)]);
    session.setParam('mode', 'off');
    expect(viewport.selection).toEqual([]);
  });

  it('bodies of a Boolean dialog → body targets', () => {
    const { viewport, session } = setupDialog();
    session.setParam('tools', [
      { kind: 'body', body: OTHER_BODY },
      { kind: 'body', body: BODY },
    ]);
    expect(viewport.selection).toEqual([
      { kind: 'body', body: OTHER_BODY },
      { kind: 'body', body: BODY },
    ]);
  });

  it('closing the session leaves the selection only', () => {
    const { selection, viewport, session } = setupDialog();
    selection.set([EDGE]);
    session.setParams({ edges: [topo(E1)], tools: [{ kind: 'body', body: BODY }] });
    expect(viewport.selection).toHaveLength(3);

    session.cancel();
    expect(viewport.selection).toEqual([{ kind: 'edge', body: BODY, edgeIndex: 5 }]);
  });

  it('without regen only regions follow the dialog, as in M13', () => {
    const { viewport, session } = setupDialog({ withRegen: false });
    session.setParams({
      edges: [topo(E1)],
      tools: [{ kind: 'body', body: BODY }],
      regions: [{ kind: 'region', sketch: 's1', region: 'k' }],
    });
    expect(viewport.selection).toEqual([
      { kind: 'sketchRegion', sketch: 's1/sketch', region: 'k' },
    ]);
  });

  it('stops following regen after unsubscribing', () => {
    const { regen, viewport, session, off } = setupDialog();
    session.setParam('edges', [topo(E1)]);
    off();
    regen.publish(new Map(), [
      { body: BODY, feature: FEATURE, names: aTopoNames({ edges: { [E1]: [8] } }) },
    ]);
    expect(viewport.selection).toEqual([{ kind: 'edge', body: BODY, edgeIndex: 1 }]);
  });
});
