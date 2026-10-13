import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@/document';
import type { BodyId, HighlightTarget, SelectionItem } from '.';
import { bindSelectionHighlight, createSelectionModel, sameSelectionItem } from './selection';
import { FakeRegenStatus, FakeViewport } from './testing';

// Branded ids are created by a cast in tests only.
const BODY = 'f1/body' as BodyId;
const OTHER_BODY = 'f2/body' as BodyId;
const FEATURE = 'f1' as FeatureId;

const FACE: SelectionItem = { kind: 'face', body: BODY, faceIndex: 2 };
const EDGE: SelectionItem = { kind: 'edge', body: BODY, edgeIndex: 5 };
const BODY_ITEM: SelectionItem = { kind: 'body', body: BODY };
const FEATURE_ITEM: SelectionItem = { kind: 'feature', feature: FEATURE };

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

describe('bindSelectionHighlight', () => {
  it('passes only face and edge items in selection order, at once and after a change', () => {
    const { selection } = setup();
    const viewport = new FakeViewport();
    selection.set([EDGE, FEATURE_ITEM]);

    bindSelectionHighlight(selection, viewport.highlight);
    const expectedEdge: HighlightTarget = { kind: 'edge', body: BODY, edgeIndex: 5 };
    expect(viewport.selection).toEqual([expectedEdge]);

    selection.set([BODY_ITEM, FACE, EDGE]);
    expect(viewport.selection).toEqual([{ kind: 'face', body: BODY, faceIndex: 2 }, expectedEdge]);
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
