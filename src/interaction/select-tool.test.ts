import { createSequentialIdGenerator, ObservableValue } from '@/core';
import { anOpsSession } from '@/ops/testing';
import { describe, expect, it } from 'vitest';
import type { BodyId, PickResult, SelectionItem } from '.';
import type { FeatureEditor, FeatureEditSession } from './feature-editor';
import { CLICK_TOLERANCE_PX, SELECT_TOOL } from './select-tool';
import { createSelectionModel } from './selection';
import { FakeRegenStatus, FakeViewport } from './testing';
import type { Tool } from './tools';
import type { KeyMods, ViewKeyEvent, ViewPointerEvent } from './viewport-port';

// Branded ids are created by a cast in tests only.
const BODY = 'f1/body' as BodyId;

const FACE_HIT: PickResult = {
  kind: 'face',
  body: BODY,
  faceIndex: 2,
  point: [1, 2, 3],
  normal: [0, 0, 1],
};
const EDGE_HIT: PickResult = { kind: 'edge', body: BODY, edgeIndex: 5, point: [0, 0, 0] };
const SKETCH_HIT: PickResult = {
  kind: 'sketchEntity',
  sketch: 's1',
  entity: 'p1',
  point: [0, 0, 0],
};
const FACE: SelectionItem = { kind: 'face', body: BODY, faceIndex: 2 };
const EDGE: SelectionItem = { kind: 'edge', body: BODY, edgeIndex: 5 };

const NO_MODS: KeyMods = { shift: false, alt: false, mod: false };

function ptr(
  type: ViewPointerEvent['type'],
  x: number,
  y: number,
  opts: { button?: ViewPointerEvent['button']; shift?: boolean } = {},
): ViewPointerEvent {
  return {
    type,
    x,
    y,
    button:
      opts.button === undefined
        ? type === 'move' || type === 'leave'
          ? null
          : 'left'
        : opts.button,
    mods: { ...NO_MODS, shift: opts.shift ?? false },
  };
}

function key(k: string): ViewKeyEvent {
  return { key: k, mods: NO_MODS, inTextField: false };
}

function aFeatureEditorStub(): FeatureEditor {
  return {
    create: () => {
      throw new Error('not expected');
    },
    edit: () => {
      throw new Error('not expected');
    },
    current: new ObservableValue<FeatureEditSession | null>(null),
  };
}

/** SELECT_TOOL activated directly; events go straight to the tool, no ToolManager. */
function setup() {
  const viewport = new FakeViewport();
  const selection = createSelectionModel({ regen: new FakeRegenStatus() });
  const session = anOpsSession();
  let finished = 0;
  const tool: Tool = SELECT_TOOL.create();
  tool.activate({
    viewport,
    selection,
    doc: session.doc,
    ops: session.dispatcher,
    ids: createSequentialIdGenerator(),
    features: aFeatureEditorStub(),
    finish: () => finished++,
  });
  const pointer = (e: ViewPointerEvent): void => tool.onPointer?.(e);
  const click = (x: number, y: number, opts: { shift?: boolean } = {}): void => {
    pointer(ptr('down', x, y, opts));
    pointer(ptr('up', x, y, opts));
  };
  return { tool, viewport, selection, pointer, click, finished: () => finished };
}

describe('SELECT_TOOL', () => {
  it('is the select tool of the select group', () => {
    expect(SELECT_TOOL.id).toBe('select');
    expect(SELECT_TOOL.group).toBe('select');
    expect(CLICK_TOLERANCE_PX).toBe(4);
  });

  it('its label is the translation key tool.select (ADR 0014)', () => {
    expect(SELECT_TOOL.label).toBe('tool.select');
  });

  it('creates a new tool every time', () => {
    expect(SELECT_TOOL.create()).not.toBe(SELECT_TOOL.create());
  });

  describe('hover', () => {
    it('move sets the hover to the pick result', () => {
      const { viewport, pointer } = setup();
      viewport.setPick((x) => (x === 10 ? FACE_HIT : null));
      pointer(ptr('move', 10, 0));
      expect(viewport.hover).toEqual(FACE_HIT);
      pointer(ptr('move', 20, 0));
      expect(viewport.hover).toBeNull();
    });

    it('picks without a filter, so faces and edges both count', () => {
      const { viewport, selection, pointer, click } = setup();
      viewport.setPick(EDGE_HIT);
      // A pick with a narrower filter before each event: the tool must not inherit it.
      viewport.pick(0, 0, ['face']);
      pointer(ptr('move', 10, 0));
      expect(viewport.lastFilter).toBeUndefined();
      expect(viewport.hover).toEqual(EDGE_HIT);

      viewport.pick(0, 0, ['face']);
      click(10, 10);
      expect(viewport.lastFilter).toBeUndefined();
      expect(selection.items.get()).toEqual([EDGE]);
    });

    it('ignores a sketch entity hit it never asks for, as if nothing was hit', () => {
      const { viewport, selection, pointer, click } = setup();
      // A viewport that does not respect the filter: the tool must still not use the hit.
      viewport.pick = () => SKETCH_HIT;
      selection.set([EDGE]);
      pointer(ptr('move', 10, 0));
      expect(viewport.hover).toBeNull();
      click(10, 10);
      expect(selection.items.get()).toEqual([]);
    });

    it('leave clears the hover', () => {
      const { viewport, pointer } = setup();
      viewport.setPick(EDGE_HIT);
      pointer(ptr('move', 10, 0));
      pointer(ptr('leave', 10, 0));
      expect(viewport.hover).toBeNull();
    });

    it('deactivate clears the hover', () => {
      const { tool, viewport, pointer } = setup();
      viewport.setPick(FACE_HIT);
      pointer(ptr('move', 10, 0));
      tool.deactivate();
      expect(viewport.hover).toBeNull();
    });
  });

  describe('click', () => {
    it('on a face selects only it', () => {
      const { viewport, selection, click } = setup();
      selection.set([EDGE]);
      viewport.setPick(FACE_HIT);
      click(10, 10);
      expect(selection.items.get()).toEqual([FACE]);
    });

    it('on an edge selects it', () => {
      const { viewport, selection, click } = setup();
      viewport.setPick(EDGE_HIT);
      click(10, 10);
      expect(selection.items.get()).toEqual([EDGE]);
    });

    it('picks at the up position', () => {
      const { viewport, selection, pointer } = setup();
      viewport.setPick((x, y) => (x === 13 && y === 10 ? FACE_HIT : null));
      pointer(ptr('down', 10, 10));
      pointer(ptr('up', 13, 10));
      expect(selection.items.get()).toEqual([FACE]);
    });

    it(`is still a click ${String(CLICK_TOLERANCE_PX)} px from down`, () => {
      const { viewport, selection, pointer } = setup();
      viewport.setPick(FACE_HIT);
      pointer(ptr('down', 10, 10));
      pointer(ptr('up', 10, 10 + CLICK_TOLERANCE_PX));
      expect(selection.items.get()).toEqual([FACE]);
    });

    it('with Shift toggles the item', () => {
      const { viewport, selection, click } = setup();
      selection.set([EDGE]);
      viewport.setPick(FACE_HIT);
      click(10, 10, { shift: true });
      expect(selection.items.get()).toEqual([EDGE, FACE]);
      click(10, 10, { shift: true });
      expect(selection.items.get()).toEqual([EDGE]);
    });

    it('on empty space without Shift clears the selection', () => {
      const { selection, click } = setup();
      selection.set([FACE, EDGE]);
      click(10, 10);
      expect(selection.items.get()).toEqual([]);
    });

    it('on empty space with Shift keeps the selection', () => {
      const { selection, click } = setup();
      selection.set([FACE, EDGE]);
      click(10, 10, { shift: true });
      expect(selection.items.get()).toEqual([FACE, EDGE]);
    });

    it(`dragging more than ${String(CLICK_TOLERANCE_PX)} px does nothing`, () => {
      const { viewport, selection, pointer } = setup();
      selection.set([EDGE]);
      viewport.setPick(FACE_HIT);
      pointer(ptr('down', 10, 10));
      pointer(ptr('move', 13, 13));
      pointer(ptr('up', 13, 13));
      expect(selection.items.get()).toEqual([EDGE]);
    });

    it('up without a preceding down does nothing', () => {
      const { viewport, selection, pointer } = setup();
      selection.set([EDGE]);
      viewport.setPick(FACE_HIT);
      pointer(ptr('up', 10, 10));
      expect(selection.items.get()).toEqual([EDGE]);
    });

    it.each(['right', 'middle'] as const)('ignores the %s button', (button) => {
      const { viewport, selection, pointer } = setup();
      selection.set([EDGE]);
      viewport.setPick(FACE_HIT);
      pointer(ptr('down', 10, 10, { button }));
      pointer(ptr('up', 10, 10, { button }));
      expect(selection.items.get()).toEqual([EDGE]);
      // Nor does it remember the position for a later left up.
      pointer(ptr('up', 10, 10));
      expect(selection.items.get()).toEqual([EDGE]);
    });
  });

  describe('Escape', () => {
    it('clears a non-empty selection and handles the key', () => {
      const { tool, selection } = setup();
      selection.set([FACE]);
      expect(tool.onKey?.(key('Escape'))).toBe(true);
      expect(selection.items.get()).toEqual([]);
    });

    it('with an empty selection is not handled', () => {
      const { tool, selection } = setup();
      let emits = 0;
      selection.items.subscribe(() => emits++);
      expect(tool.onKey?.(key('Escape'))).toBe(false);
      expect(emits).toBe(0);
    });

    it.each([
      ['with Shift', { key: 'Escape', mods: { ...NO_MODS, shift: true }, inTextField: false }],
      ['with Mod', { key: 'Escape', mods: { ...NO_MODS, mod: true }, inTextField: false }],
      ['with Alt', { key: 'Escape', mods: { ...NO_MODS, alt: true }, inTextField: false }],
      ['in a text field', { key: 'Escape', mods: NO_MODS, inTextField: true }],
    ] satisfies [string, ViewKeyEvent][])('%s is not handled', (_, e) => {
      const { tool, selection } = setup();
      selection.set([FACE]);
      expect(tool.onKey?.(e)).toBe(false);
      expect(selection.items.get()).toEqual([FACE]);
    });

    it('other keys are not handled', () => {
      const { tool, selection } = setup();
      selection.set([FACE]);
      expect(tool.onKey?.(key('a'))).toBe(false);
      expect(selection.items.get()).toEqual([FACE]);
    });
  });

  it('never finishes', () => {
    const { tool, click, finished } = setup();
    click(1, 1);
    tool.onKey?.(key('Escape'));
    expect(finished()).toBe(0);
  });
});
