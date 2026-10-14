import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import {
  ORIGIN_AXIS_IDS,
  ORIGIN_PLANE_IDS,
  bodyId,
  createFeatureSchemaRegistry,
  sketchId,
  toData,
  validateAgainstSchema,
} from '@/document';
import type { AxisId, FeatureId, FeatureSchema, ParamSchema, PlaneId } from '@/document';
import { aFeature } from '@/document/testing';
import type {
  BodyRenameOp,
  BodySetColorOp,
  BodySetVisibleOp,
  FeatureRenameOp,
  Operation,
} from '@/ops';
import { OP_VERSION } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import { createBrowserModel } from './browser-model';
import { createEditLock } from './edit-lock';
import { createFeatureEditor } from './feature-editor';
import type { RegenBody, RegenSketch } from './regen-status-port';
import { NO_TOPO_NAMES } from './regen-status-port';
import { createSelectionModel } from './selection';
import { FakeRegenStatus } from './testing';

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted

const B1 = bodyId(fid('f1'));
const B2 = bodyId(fid('f2'));
const B3 = bodyId(fid('f3'));
const BODIES: readonly RegenBody[] = [
  { body: B1, feature: fid('f1'), names: NO_TOPO_NAMES },
  { body: B2, feature: fid('f2'), names: NO_TOPO_NAMES },
];

const BOOL_PARAMS: ParamSchema = {
  width: { kind: 'length', label: 'w', default: 1 },
  targets: { kind: 'bodies', label: 'targets' },
};
const BOOL: FeatureSchema = {
  type: 'bool',
  version: 1,
  label: 'bool.label',
  params: BOOL_PARAMS,
  defaults: () => ({ width: 1, targets: [] }),
  validate: (params) => validateAgainstSchema(BOOL_PARAMS, params),
};
const TOPO_PARAMS: ParamSchema = {
  faces: { kind: 'topo', label: 'faces', entity: 'face' },
};
const TOPO: FeatureSchema = {
  type: 'topo',
  version: 1,
  label: 'topo.label',
  params: TOPO_PARAMS,
  defaults: () => ({ faces: [] }),
  validate: () => [],
};

const REV_PARAMS: ParamSchema = {
  axis: { kind: 'axis', label: 'axis' },
  regions: { kind: 'region', label: 'regions' },
};
const REV: FeatureSchema = {
  type: 'rev',
  version: 1,
  label: 'rev.label',
  params: REV_PARAMS,
  defaults: () => ({ axis: null, regions: [] }),
  validate: () => [],
};

const SKETCHES: readonly RegenSketch[] = [
  { sketch: sketchId(fid('s1')), feature: fid('s1'), regions: [] },
  { sketch: sketchId(fid('s2')), feature: fid('s2'), regions: [] },
];

function setup(opts: { readOnly?: boolean; sketchEdit?: (feature: FeatureId) => void } = {}) {
  const schemas = createFeatureSchemaRegistry();
  schemas.register(BOOL);
  schemas.register(TOPO);
  schemas.register(REV);
  const ops = anOpsSession({
    schemas,
    features: [
      aFeature({ id: 'f1', name: 'Box 1' }),
      aFeature({ id: 'f2', name: 'Cylinder 1' }),
      aFeature({ id: 'f3', name: 'Box 2' }),
      // The browser reads only the name of a sketch, so the default test type is enough.
      aFeature({ id: 's1', name: 'Sketch 1' }),
      aFeature({ id: 's2', name: 'Sketch 2' }),
    ],
  });
  const regen = new FakeRegenStatus();
  const selection = createSelectionModel({ regen });
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('new'),
  });
  const locked = createEditLock({ readOnly: opts.readOnly ?? false, editor });
  const browser = createBrowserModel({
    doc: ops.doc,
    ops: ops.dispatcher,
    regen,
    selection,
    editor,
    locked,
    ...(opts.sketchEdit === undefined ? {} : { sketchEdit: opts.sketchEdit }),
  });
  const order: string[] = [];
  browser.bodies.subscribe(() => order.push('bodies'));
  browser.hidden.subscribe(() => order.push('hidden'));
  browser.colors.subscribe(() => order.push('colors'));
  browser.visiblePlanes.subscribe(() => order.push('visiblePlanes'));
  browser.planes.subscribe(() => order.push('planes'));
  browser.sketches.subscribe(() => order.push('sketches'));
  browser.visibleAxes.subscribe(() => order.push('visibleAxes'));
  browser.axes.subscribe(() => order.push('axes'));
  const count = (what: string): number => order.filter((o) => o === what).length;
  return {
    ...ops,
    regen,
    selection,
    editor,
    browser,
    order,
    bodyEmits: () => count('bodies'),
    hiddenEmits: () => count('hidden'),
    colorEmits: () => count('colors'),
    planeEmits: () => count('planes'),
    sketchEmits: () => count('sketches'),
    axisEmits: () => count('axes'),
  };
}

/** The ops of the log in order (body.* are never batched). */
function loggedOps(s: ReturnType<typeof setup>): readonly Operation[] {
  return s.log.entries().map((e) => e.op);
}

describe('BrowserModel rows', () => {
  it('starts empty with nothing hidden', () => {
    const s = setup();
    expect(s.browser.bodies.get()).toEqual([]);
    expect(s.browser.hidden.get().size).toBe(0);
  });

  it('lists the bodies of the last regeneration in their order, numbered from 1', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    expect(s.browser.bodies.get()).toEqual([
      {
        body: B1,
        name: { key: 'browser.body', n: 1 },
        userName: null,
        feature: 'f1',
        visible: true,
        color: null,
        selected: false,
      },
      {
        body: B2,
        name: { key: 'browser.body', n: 2 },
        userName: null,
        feature: 'f2',
        visible: true,
        color: null,
        selected: false,
      },
    ]);
  });

  it('freezes the snapshot and its rows', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const rows = s.browser.bodies.get();
    expect(Object.isFrozen(rows)).toBe(true);
    expect(rows.every((r) => Object.isFrozen(r) && Object.isFrozen(r.name))).toBe(true);
  });

  it('keeps an unchanged row as the same object and the same snapshot without emitting', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const before = s.browser.bodies.get();
    const emits = s.bodyEmits();

    s.regen.publish(new Map(), BODIES);
    expect(s.browser.bodies.get()).toBe(before);
    expect(s.bodyEmits()).toBe(emits);

    s.regen.publish(new Map(), [...BODIES, { body: B3, feature: fid('f3') }]);
    const after = s.browser.bodies.get();
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]?.body).toBe(B3);
  });

  it('marks rows selected from body items of the selection', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const before = s.browser.bodies.get();
    s.selection.set([
      { kind: 'body', body: B2 },
      { kind: 'face', body: B1, faceIndex: 0 },
      { kind: 'feature', feature: fid('f1') },
    ]);
    const rows = s.browser.bodies.get();
    expect(rows.map((r) => r.selected)).toEqual([false, true]);
    expect(rows[0]).toBe(before[0]);
  });

  it('reads the name and the visibility from the body metadata of the document', () => {
    const s = setup();
    s.doc.setBodyMeta(B2, { name: 'Shaft', hidden: true });
    s.regen.publish(new Map(), BODIES);
    const rows = s.browser.bodies.get();
    expect(rows.map((r) => [r.userName, r.visible])).toEqual([
      [null, true],
      ['Shaft', false],
    ]);
    expect([...s.browser.hidden.get()]).toEqual([B2]);
  });

  it('follows a change of the metadata in the document', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const before = s.browser.bodies.get();
    s.doc.setBodyMeta(B1, { name: 'Base' });
    const rows = s.browser.bodies.get();
    expect(rows[0]?.userName).toBe('Base');
    expect(rows[1]).toBe(before[1]);
  });

  it('a document change without metadata change emits nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const [rows, hidden] = [s.browser.bodies.get(), s.browser.hidden.get()];
    const emits = s.order.length;
    s.doc.setRollbackIndex(1);
    expect(s.browser.bodies.get()).toBe(rows);
    expect(s.browser.hidden.get()).toBe(hidden);
    expect(s.order.length).toBe(emits);
  });
});

describe('BrowserModel.hidden', () => {
  it('holds only the bodies of the last regeneration hidden in the metadata', () => {
    const s = setup();
    s.doc.setBodyMeta(B1, { hidden: true });
    s.doc.setBodyMeta(B3, { hidden: true });
    s.regen.publish(new Map(), BODIES);
    expect([...s.browser.hidden.get()]).toEqual([B1]);

    s.regen.publish(new Map(), [{ body: B2, feature: fid('f2') }]);
    expect(s.browser.hidden.get().size).toBe(0);
    // The metadata stay in the document.
    expect(s.doc.bodyMeta(B1)).toEqual({ hidden: true });
  });

  it('emits hidden before bodies', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.order.length = 0;
    s.browser.setVisible(B1, false);
    expect(s.order).toEqual(['hidden', 'bodies']);
  });

  it('a regeneration with the same hidden bodies keeps the hidden set', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B1, false);
    const hidden = s.browser.hidden.get();
    const emits = s.hiddenEmits();
    s.regen.publish(new Map(), BODIES);
    expect(s.browser.hidden.get()).toBe(hidden);
    expect(s.hiddenEmits()).toBe(emits);
  });

  it('a new hidden set is published on each change; the old one does not change', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B1, false);
    const first = s.browser.hidden.get();
    s.browser.setVisible(B2, false);
    expect([...first]).toEqual([B1]);
    expect(new Set(s.browser.hidden.get())).toEqual(new Set([B1, B2]));
  });
});

describe('BrowserModel.setVisible', () => {
  it('dispatches body.setVisible; the row and hidden follow the document', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const before = s.browser.bodies.get();
    s.browser.setVisible(B2, false);
    const op: BodySetVisibleOp = {
      type: 'body.setVisible',
      v: OP_VERSION['body.setVisible'],
      body: B2,
      visible: false,
    };
    expect(loggedOps(s)).toEqual([op]);
    expect(s.doc.bodyMeta(B2)).toEqual({ hidden: true });
    expect([...s.browser.hidden.get()]).toEqual([B2]);
    const rows = s.browser.bodies.get();
    expect(rows.map((r) => r.visible)).toEqual([true, false]);
    expect(rows[0]).toBe(before[0]);

    s.browser.setVisible(B2, true);
    expect(s.doc.bodyMeta(B2)).toEqual({});
    expect(s.browser.hidden.get().size).toBe(0);
  });

  it('undo brings the visibility back', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B1, false);
    s.undo.undo();
    expect(s.doc.bodyMeta(B1)).toEqual({});
    expect(s.browser.hidden.get().size).toBe(0);
    expect(s.browser.bodies.get()[0]?.visible).toBe(true);
  });

  it('the same value does nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B1, true);
    expect(s.log.entries()).toHaveLength(0);
    s.browser.setVisible(B1, false);
    s.browser.setVisible(B1, false);
    expect(s.log.entries()).toHaveLength(1);
  });

  it('a body unknown to the last regeneration does nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B3, false);
    expect(s.log.entries()).toHaveLength(0);
    expect(s.doc.bodyMeta(B3)).toEqual({});
  });

  it('does nothing during a transaction', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const session = s.editor.create('bool');
    s.browser.setVisible(B1, false);
    expect(s.doc.bodyMeta(B1)).toEqual({});
    session.cancel();
    expect(s.log.entries()).toHaveLength(0);
  });
});

describe('BrowserModel colors (M15)', () => {
  it('a row carries the color from the body metadata', () => {
    const s = setup();
    s.doc.setBodyMeta(B2, { color: '#ff8800' });
    s.regen.publish(new Map(), BODIES);
    expect(s.browser.bodies.get().map((r) => r.color)).toEqual([null, '#ff8800']);
  });

  it('colors holds only the bodies of the last regeneration with a color', () => {
    const s = setup();
    s.doc.setBodyMeta(B1, { color: '#112233' });
    s.doc.setBodyMeta(B3, { color: '#445566' });
    s.regen.publish(new Map(), BODIES);
    expect([...s.browser.colors.get()]).toEqual([[B1, '#112233']]);

    s.regen.publish(new Map(), [{ body: B2, feature: fid('f2'), names: NO_TOPO_NAMES }]);
    expect(s.browser.colors.get().size).toBe(0);
    // The metadata stay in the document.
    expect(s.doc.bodyMeta(B1)).toEqual({ color: '#112233' });
  });

  it('without a change of the content no new map and no new rows are published', () => {
    const s = setup();
    s.doc.setBodyMeta(B1, { color: '#112233' });
    s.regen.publish(new Map(), BODIES);
    const colors = s.browser.colors.get();
    const rows = s.browser.bodies.get();
    const emits = s.colorEmits();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B2, false);
    expect(s.browser.colors.get()).toBe(colors);
    expect(s.colorEmits()).toBe(emits);
    expect(s.browser.bodies.get()[0]).toBe(rows[0]);
  });

  it('setColor dispatches body.setColor; the row and colors follow the document', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const before = s.browser.bodies.get();
    const first = s.browser.colors.get();
    s.browser.setColor(B2, '#00ff00');
    const op: BodySetColorOp = {
      type: 'body.setColor',
      v: OP_VERSION['body.setColor'],
      body: B2,
      color: '#00ff00',
    };
    expect(loggedOps(s)).toEqual([op]);
    expect(s.doc.bodyMeta(B2)).toEqual({ color: '#00ff00' });
    expect([...s.browser.colors.get()]).toEqual([[B2, '#00ff00']]);
    // The old map is never mutated.
    expect(first.size).toBe(0);
    const rows = s.browser.bodies.get();
    expect(rows.map((r) => r.color)).toEqual([null, '#00ff00']);
    expect(rows[0]).toBe(before[0]);

    s.browser.setColor(B2, null);
    expect(s.doc.bodyMeta(B2)).toEqual({});
    expect(s.browser.colors.get().size).toBe(0);
  });

  it('undo brings the color back', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setColor(B1, '#abcdef');
    s.browser.setColor(B1, '#123456');
    s.undo.undo();
    expect(s.doc.bodyMeta(B1)).toEqual({ color: '#abcdef' });
    expect(s.browser.bodies.get()[0]?.color).toBe('#abcdef');
    s.undo.undo();
    expect(s.browser.colors.get().size).toBe(0);
    expect(s.browser.bodies.get()[0]?.color).toBeNull();
  });

  it('emits in the order hidden, colors, bodies', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.order.length = 0;
    s.browser.setColor(B1, '#abcdef');
    expect(s.order).toEqual(['colors', 'bodies']);
    s.order.length = 0;
    s.doc.setBodyMeta(B2, { hidden: true, color: '#000000' });
    expect(s.order).toEqual(['hidden', 'colors', 'bodies']);
  });

  it('the same value does nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setColor(B1, null);
    expect(s.log.entries()).toHaveLength(0);
    s.browser.setColor(B1, '#abcdef');
    s.browser.setColor(B1, '#abcdef');
    expect(s.log.entries()).toHaveLength(1);
  });

  it('a body unknown to the last regeneration does nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setColor(B3, '#abcdef');
    expect(s.log.entries()).toHaveLength(0);
    expect(s.doc.bodyMeta(B3)).toEqual({});
  });

  it('does nothing during a transaction', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const session = s.editor.create('bool');
    s.browser.setColor(B1, '#abcdef');
    expect(s.doc.bodyMeta(B1)).toEqual({});
    session.cancel();
    expect(s.log.entries()).toHaveLength(0);
  });

  it('does nothing read-only', () => {
    const s = setup({ readOnly: true });
    s.regen.publish(new Map(), BODIES);
    s.browser.setColor(B1, '#abcdef');
    expect(s.log.entries()).toHaveLength(0);
    expect(s.doc.bodyMeta(B1)).toEqual({});
  });

  it('an invalid color throws and dispatches nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    for (const color of ['#ABCDEF', 'red', '#abc', '']) {
      expect(() => {
        s.browser.setColor(B1, color);
      }).toThrow();
    }
    expect(s.log.entries()).toHaveLength(0);
  });
});

describe('BrowserModel.rename', () => {
  it('dispatches body.rename with the trimmed name', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.rename(B1, '  Base  ');
    const op: BodyRenameOp = {
      type: 'body.rename',
      v: OP_VERSION['body.rename'],
      body: B1,
      name: 'Base',
    };
    expect(loggedOps(s)).toEqual([op]);
    expect(s.browser.bodies.get()[0]?.userName).toBe('Base');
  });

  it('an empty name removes the name', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.rename(B1, 'Base');
    s.browser.rename(B1, '   ');
    expect(s.doc.bodyMeta(B1)).toEqual({});
    expect(s.browser.bodies.get()[0]?.userName).toBeNull();
  });

  it('undo brings the old name back', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.rename(B1, 'Base');
    s.browser.rename(B1, 'Plate');
    s.undo.undo();
    expect(s.browser.bodies.get()[0]?.userName).toBe('Base');
  });

  it('the same name after trimming does nothing; an empty name of an unnamed body neither', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.rename(B1, '');
    expect(s.log.entries()).toHaveLength(0);
    s.browser.rename(B1, 'Base');
    s.browser.rename(B1, ' Base ');
    expect(s.log.entries()).toHaveLength(1);
  });

  it('a body unknown to the last regeneration does nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.rename(B3, 'X');
    expect(s.log.entries()).toHaveLength(0);
  });

  it('does nothing during a transaction', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const session = s.editor.create('bool');
    s.browser.rename(B1, 'Base');
    session.cancel();
    expect(s.doc.bodyMeta(B1)).toEqual({});
    expect(s.log.entries()).toHaveLength(0);
  });
});

describe('BrowserModel.select', () => {
  it('replaces the selection with the body', () => {
    const s = setup();
    s.selection.set([{ kind: 'feature', feature: fid('f1') }]);
    s.browser.select(B1);
    expect(s.selection.items.get()).toEqual([{ kind: 'body', body: B1 }]);
  });

  it('with additive toggles the body in the selection', () => {
    const s = setup();
    s.browser.select(B1);
    s.browser.select(B2, { additive: true });
    expect(s.selection.items.get()).toEqual([
      { kind: 'body', body: B1 },
      { kind: 'body', body: B2 },
    ]);
    s.browser.select(B1, { additive: true });
    expect(s.selection.items.get()).toEqual([{ kind: 'body', body: B2 }]);
  });

  it('with an active bodies param toggles the body in the param and leaves the selection', () => {
    const s = setup();
    const session = s.editor.create('bool');
    expect(session.state.get().activeRefParam).toBe('targets');
    s.browser.select(B1);
    s.browser.select(B2, { additive: true });
    expect(session.state.get().params['targets']).toEqual([
      { kind: 'body', body: B1 },
      { kind: 'body', body: B2 },
    ]);
    s.browser.select(B1);
    expect(session.state.get().params['targets']).toEqual([{ kind: 'body', body: B2 }]);
    expect(s.selection.items.get()).toEqual([]);
  });

  it('with an open session without an active param selects as usual', () => {
    const s = setup();
    const session = s.editor.create('bool');
    session.focusRefParam(null);
    s.browser.select(B1);
    expect(s.selection.items.get()).toEqual([{ kind: 'body', body: B1 }]);
    expect(session.state.get().params['targets']).toEqual([]);
  });

  it('with an active topo param selects as usual', () => {
    const s = setup();
    const session = s.editor.create('topo');
    expect(session.state.get().activeRefParam).toBe('faces');
    s.browser.select(B1);
    expect(s.selection.items.get()).toEqual([{ kind: 'body', body: B1 }]);
    expect(session.state.get().params['faces']).toEqual([]);
  });
});

describe('BrowserModel.canEdit', () => {
  it('is true without a dialog and false while a feature edit session is open', () => {
    const s = setup();
    const seen: boolean[] = [];
    s.browser.canEdit.subscribe(() => seen.push(s.browser.canEdit.get()));
    expect(s.browser.canEdit.get()).toBe(true);
    const session = s.editor.create('bool');
    expect(s.browser.canEdit.get()).toBe(false);
    session.cancel();
    expect(s.browser.canEdit.get()).toBe(true);
    expect(seen).toEqual([false, true]);
    expect('set' in s.browser.canEdit).toBe(false);
  });

  it('is always false read-only; setVisible, beginRename and rename do nothing', () => {
    const s = setup({ readOnly: true });
    s.regen.publish(new Map(), BODIES);
    expect(s.browser.canEdit.get()).toBe(false);
    s.browser.setVisible(B1, false);
    s.browser.beginRename(B1);
    s.browser.rename(B1, 'Base');
    expect(s.browser.renaming.get()).toBeNull();
    expect(s.log.entries()).toHaveLength(0);
    expect(s.doc.bodyMeta(B1)).toEqual({});
  });
});

describe('BrowserModel rename mode', () => {
  it('beginRename puts a body of the last regeneration into the rename mode', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    expect(s.browser.renaming.get()).toBeNull();
    s.browser.beginRename(B2);
    expect(s.browser.renaming.get()).toBe(B2);
    expect('set' in s.browser.renaming).toBe(false);
  });

  it('beginRename of a body unknown to the last regeneration does nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.beginRename(B3);
    expect(s.browser.renaming.get()).toBeNull();
  });

  it('beginRename during a dialog does nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    const session = s.editor.create('bool');
    s.browser.beginRename(B1);
    expect(s.browser.renaming.get()).toBeNull();
    session.cancel();
  });

  it('cancelRename ends the mode without an operation', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.beginRename(B1);
    s.browser.cancelRename();
    expect(s.browser.renaming.get()).toBeNull();
    expect(s.log.entries()).toHaveLength(0);
  });

  it('rename ends the mode and renames', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.beginRename(B1);
    s.browser.rename(B1, 'Base');
    expect(s.browser.renaming.get()).toBeNull();
    expect(s.doc.bodyMeta(B1)).toEqual({ name: 'Base' });
  });

  it('rename with null (the text did not change) ends the mode without an operation', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.doc.setBodyMeta(B1, { name: 'Base' });
    s.browser.beginRename(B1);
    s.browser.rename(B1, null);
    expect(s.browser.renaming.get()).toBeNull();
    expect(s.log.entries()).toHaveLength(0);
    expect(s.doc.bodyMeta(B1)).toEqual({ name: 'Base' });
  });

  it('opening the dialog ends the mode without a change', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.beginRename(B1);
    const session = s.editor.create('bool');
    expect(s.browser.renaming.get()).toBeNull();
    session.cancel();
    expect(s.browser.renaming.get()).toBeNull();
  });
});

describe('BrowserModel.dispose', () => {
  it('unsubscribes from the regeneration status, the selection and the document', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.dispose();
    const rows = s.browser.bodies.get();
    s.regen.publish(new Map(), []);
    s.selection.set([{ kind: 'body', body: B1 }]);
    s.doc.setBodyMeta(B1, { name: 'X' });
    expect(s.browser.bodies.get()).toBe(rows);
  });

  it('unsubscribes from the edit lock', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.beginRename(B1);
    s.browser.dispose();
    s.editor.create('bool').cancel();
    expect(s.browser.renaming.get()).toBe(B1);
  });
});

// The browser only reads; the data in the document are the proof of what it changed.
describe('BrowserModel and the document data', () => {
  it('hiding and renaming end up in toData', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setVisible(B1, false);
    s.browser.rename(B2, 'Shaft');
    expect(toData(s.doc).studio.bodies).toEqual({
      [B1]: { hidden: true },
      [B2]: { name: 'Shaft' },
    });
  });

  it('a color ends up in toData', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES);
    s.browser.setColor(B1, '#abcdef');
    expect(toData(s.doc).studio.bodies).toEqual({ [B1]: { color: '#abcdef' } });
  });
});

describe('BrowserModel planes (M12)', () => {
  const { xy, xz, yz } = ORIGIN_PLANE_IDS;

  it('lists the three origin planes in order, hidden and not selected, frozen', () => {
    const s = setup();
    const rows = s.browser.planes.get();
    expect(rows).toEqual([
      { plane: xy, label: 'origin.plane.xy', visible: false, selected: false },
      { plane: xz, label: 'origin.plane.xz', visible: false, selected: false },
      { plane: yz, label: 'origin.plane.yz', visible: false, selected: false },
    ]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(rows.every((r) => Object.isFrozen(r))).toBe(true);
    expect(s.browser.visiblePlanes.get().size).toBe(0);
  });

  it('selectPlane replaces the selection; additive toggles it', () => {
    const s = setup();
    s.selection.set([{ kind: 'body', body: B1 }]);
    s.browser.selectPlane(xz);
    expect(s.selection.items.get()).toEqual([{ kind: 'plane', plane: xz }]);
    s.browser.selectPlane(yz);
    expect(s.selection.items.get()).toEqual([{ kind: 'plane', plane: yz }]);
    s.browser.selectPlane(xy, { additive: true });
    expect(s.selection.items.get()).toEqual([
      { kind: 'plane', plane: yz },
      { kind: 'plane', plane: xy },
    ]);
    s.browser.selectPlane(yz, { additive: true });
    expect(s.selection.items.get()).toEqual([{ kind: 'plane', plane: xy }]);
  });

  it('marks the selected planes and keeps the other rows as the same objects', () => {
    const s = setup();
    const before = s.browser.planes.get();
    s.browser.selectPlane(xz);
    const rows = s.browser.planes.get();
    expect(rows.map((r) => r.selected)).toEqual([false, true, false]);
    expect(rows[0]).toBe(before[0]);
    expect(rows[2]).toBe(before[2]);
  });

  it('setPlaneVisible changes only the view state, not the document or the log', () => {
    const s = setup();
    const studio = s.doc.studio;
    s.browser.setPlaneVisible(xz, true);
    expect([...s.browser.visiblePlanes.get()]).toEqual([xz]);
    expect(s.browser.planes.get().map((r) => r.visible)).toEqual([false, true, false]);
    expect(s.doc.studio).toBe(studio);
    expect(loggedOps(s)).toEqual([]);

    s.browser.setPlaneVisible(xz, false);
    expect(s.browser.visiblePlanes.get().size).toBe(0);
  });

  it('a new visible set is published on each change; the same value emits nothing', () => {
    const s = setup();
    s.browser.setPlaneVisible(xy, true);
    const first = s.browser.visiblePlanes.get();
    const planes = s.browser.planes.get();
    const emits = s.order.length;
    s.browser.setPlaneVisible(xy, true);
    expect(s.browser.visiblePlanes.get()).toBe(first);
    expect(s.browser.planes.get()).toBe(planes);
    expect(s.order.length).toBe(emits);

    s.browser.setPlaneVisible(yz, true);
    expect(s.browser.visiblePlanes.get()).not.toBe(first);
    expect([...first]).toEqual([xy]);
  });

  it('a plane outside the origin planes does nothing', () => {
    const s = setup();
    const emits = s.order.length;
    s.browser.setPlaneVisible('f1/plane:top' as PlaneId, true); // test ids are trusted
    expect(s.browser.visiblePlanes.get().size).toBe(0);
    expect(s.order.length).toBe(emits);
  });

  it('plane visibility is a view state: it works read-only too', () => {
    const s = setup({ readOnly: true });
    s.browser.setPlaneVisible(xy, true);
    expect([...s.browser.visiblePlanes.get()]).toEqual([xy]);
  });

  it('a regeneration or a document change keeps the plane rows', () => {
    const s = setup();
    const rows = s.browser.planes.get();
    const emits = s.planeEmits();
    s.regen.publish(new Map(), BODIES, SKETCHES);
    s.doc.setRollbackIndex(1);
    expect(s.browser.planes.get()).toBe(rows);
    expect(s.planeEmits()).toBe(emits);
  });

  it('a selected plane survives a new regeneration', () => {
    const s = setup();
    s.browser.selectPlane(xz);
    s.regen.publish(new Map(), BODIES);
    expect(s.selection.items.get()).toEqual([{ kind: 'plane', plane: xz }]);
    expect(s.browser.planes.get()[1]?.selected).toBe(true);
  });

  it('emits in the order hidden, visiblePlanes, bodies, planes, sketches', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES, SKETCHES);
    s.order.length = 0;
    s.browser.setPlaneVisible(xy, true);
    expect(s.order).toEqual(['visiblePlanes', 'planes']);
    s.order.length = 0;
    s.browser.setVisible(B1, false);
    expect(s.order).toEqual(['hidden', 'bodies']);
    s.order.length = 0;
    s.selection.set([
      { kind: 'body', body: B2 },
      { kind: 'plane', plane: xz },
      { kind: 'feature', feature: fid('s1') },
    ]);
    expect(s.order).toEqual(['bodies', 'planes', 'sketches']);
  });
});

describe('BrowserModel sketches (M12)', () => {
  const S1 = sketchId(fid('s1'));
  const S2 = sketchId(fid('s2'));

  it('lists the sketches of the last regeneration with the feature names, frozen', () => {
    const s = setup();
    expect(s.browser.sketches.get()).toEqual([]);
    s.regen.publish(new Map(), BODIES, SKETCHES);
    const rows = s.browser.sketches.get();
    expect(rows).toEqual([
      { sketch: S1, feature: 's1', name: 'Sketch 1', selected: false, regions: [] },
      { sketch: S2, feature: 's2', name: 'Sketch 2', selected: false, regions: [] },
    ]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(rows.every((r) => Object.isFrozen(r))).toBe(true);
  });

  it('keeps unchanged rows and the snapshot without emitting', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES, SKETCHES);
    const before = s.browser.sketches.get();
    const emits = s.sketchEmits();
    s.regen.publish(new Map(), BODIES, SKETCHES);
    expect(s.browser.sketches.get()).toBe(before);
    expect(s.sketchEmits()).toBe(emits);
  });

  it('the name follows feature.rename', () => {
    const s = setup();
    s.regen.publish(new Map(), [], SKETCHES);
    const before = s.browser.sketches.get();
    const op: FeatureRenameOp = {
      type: 'feature.rename',
      v: OP_VERSION['feature.rename'],
      featureId: fid('s2'),
      name: 'Profile',
    };
    s.dispatcher.dispatch(op);
    const rows = s.browser.sketches.get();
    expect(rows.map((r) => r.name)).toEqual(['Sketch 1', 'Profile']);
    expect(rows[0]).toBe(before[0]);
  });

  it('leaves out a sketch whose feature is no longer in the document', () => {
    const s = setup();
    const gone: RegenSketch = { sketch: sketchId(fid('gone')), feature: fid('gone'), regions: [] };
    s.regen.publish(new Map(), [], [...SKETCHES, gone]);
    expect(s.browser.sketches.get().map((r) => r.feature)).toEqual(['s1', 's2']);
  });

  it('marks rows selected from feature items of the selection', () => {
    const s = setup();
    s.regen.publish(new Map(), [], SKETCHES);
    s.selection.set([{ kind: 'feature', feature: fid('s2') }]);
    expect(s.browser.sketches.get().map((r) => r.selected)).toEqual([false, true]);
  });

  it('selectSketch selects the feature; additive toggles it', () => {
    const s = setup();
    s.regen.publish(new Map(), [], SKETCHES);
    s.browser.selectSketch(fid('s1'));
    expect(s.selection.items.get()).toEqual([{ kind: 'feature', feature: 's1' }]);
    s.browser.selectSketch(fid('s2'), { additive: true });
    expect(s.selection.items.get()).toEqual([
      { kind: 'feature', feature: 's1' },
      { kind: 'feature', feature: 's2' },
    ]);
    s.browser.selectSketch(fid('s1'), { additive: true });
    expect(s.selection.items.get()).toEqual([{ kind: 'feature', feature: 's2' }]);
  });

  it('editSketch calls sketchEdit with the feature', () => {
    const edited: FeatureId[] = [];
    const s = setup({ sketchEdit: (feature) => edited.push(feature) });
    s.regen.publish(new Map(), [], SKETCHES);
    s.browser.editSketch(fid('s2'));
    expect(edited).toEqual([fid('s2')]);
  });

  it('editSketch does nothing without canEdit (read-only or an open dialog)', () => {
    const edited: FeatureId[] = [];
    const readOnly = setup({ readOnly: true, sketchEdit: (feature) => edited.push(feature) });
    readOnly.regen.publish(new Map(), [], SKETCHES);
    readOnly.browser.editSketch(fid('s1'));
    const open = setup({ sketchEdit: (feature) => edited.push(feature) });
    open.regen.publish(new Map(), [], SKETCHES);
    open.editor.create('bool');
    open.browser.editSketch(fid('s1'));
    expect(edited).toEqual([]);
  });

  it('editSketch without sketchEdit does nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), [], SKETCHES);
    s.browser.editSketch(fid('s1'));
    expect(s.editor.current.get()).toBeNull();
    expect(loggedOps(s)).toEqual([]);
  });

  it('dispose stops following the sketches', () => {
    const s = setup();
    s.browser.dispose();
    s.regen.publish(new Map(), [], SKETCHES);
    expect(s.browser.sketches.get()).toEqual([]);
  });
});

describe('BrowserModel axes (M13)', () => {
  const { x, y, z } = ORIGIN_AXIS_IDS;

  it('lists the three origin axes in order, hidden and not active, frozen', () => {
    const s = setup();
    const rows = s.browser.axes.get();
    expect(rows).toEqual([
      { axis: x, label: 'origin.axis.x', visible: false, active: false },
      { axis: y, label: 'origin.axis.y', visible: false, active: false },
      { axis: z, label: 'origin.axis.z', visible: false, active: false },
    ]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(rows.every((r) => Object.isFrozen(r))).toBe(true);
    expect(s.browser.visibleAxes.get().size).toBe(0);
  });

  it('setAxisVisible changes only the view state; the other rows stay the same objects', () => {
    const s = setup();
    const before = s.browser.axes.get();
    const set0 = s.browser.visibleAxes.get();
    s.browser.setAxisVisible(y, true);
    expect([...s.browser.visibleAxes.get()]).toEqual([y]);
    expect(set0.size).toBe(0);
    const rows = s.browser.axes.get();
    expect(rows.map((r) => r.visible)).toEqual([false, true, false]);
    expect(rows[0]).toBe(before[0]);
    expect(rows[2]).toBe(before[2]);
    expect(loggedOps(s)).toEqual([]);
    s.browser.setAxisVisible(y, false);
    expect(s.browser.visibleAxes.get().size).toBe(0);
  });

  it('the same visibility, or an axis outside the origin axes, emits nothing', () => {
    const s = setup();
    s.browser.setAxisVisible(x, true);
    s.order.length = 0;
    s.browser.setAxisVisible(x, true);
    s.browser.setAxisVisible(z, false);
    s.browser.setAxisVisible('f1/axis:a' as AxisId, true); // a test id in the shape of AxisId
    expect(s.order).toEqual([]);
  });

  it('selectAxis without a dialog does nothing', () => {
    const s = setup();
    s.browser.selectAxis(x);
    expect(s.selection.items.get()).toEqual([]);
    expect(loggedOps(s)).toEqual([]);
  });

  it('selectAxis with an active axis param sets the axis, the second time clears it', () => {
    const s = setup();
    const session = s.editor.create('rev');
    expect(session.state.get().activeRefParam).toBe('axis');
    s.browser.selectAxis(z);
    expect(session.state.get().params['axis']).toEqual({ kind: 'axis', axis: z });
    expect(s.browser.axes.get().map((r) => r.active)).toEqual([false, false, true]);
    s.browser.selectAxis(x);
    expect(session.state.get().params['axis']).toEqual({ kind: 'axis', axis: x });
    s.browser.selectAxis(x);
    expect(session.state.get().params['axis']).toBeNull();
    expect(s.browser.axes.get().map((r) => r.active)).toEqual([false, false, false]);
    expect(s.selection.items.get()).toEqual([]);
  });

  it('selectAxis with an active param of another kind does nothing', () => {
    const s = setup();
    const session = s.editor.create('rev');
    session.focusRefParam('regions');
    s.browser.selectAxis(z);
    expect(session.state.get().params['axis']).toBeNull();
  });

  it('active only while the axis param is the active one', () => {
    const s = setup();
    const session = s.editor.create('rev');
    s.browser.selectAxis(y);
    expect(s.browser.axes.get()[1]?.active).toBe(true);
    session.focusRefParam('regions');
    expect(s.browser.axes.get()[1]?.active).toBe(false);
    session.focusRefParam('axis');
    expect(s.browser.axes.get()[1]?.active).toBe(true);
    session.cancel();
    expect(s.browser.axes.get()[1]?.active).toBe(false);
  });

  it('a regeneration or a document change keeps the axis rows without emitting', () => {
    const s = setup();
    const before = s.browser.axes.get();
    s.regen.publish(new Map(), BODIES, SKETCHES);
    s.browser.setVisible(B1, false);
    expect(s.browser.axes.get()).toBe(before);
    expect(s.axisEmits()).toBe(0);
  });

  it('axis visibility is a view state: it works read-only too', () => {
    const s = setup({ readOnly: true });
    s.browser.setAxisVisible(x, true);
    expect(s.browser.axes.get()[0]?.visible).toBe(true);
  });

  it('setAxisVisible emits only visibleAxes and axes', () => {
    const s = setup();
    s.regen.publish(new Map(), BODIES, SKETCHES);
    s.order.length = 0;
    s.browser.setAxisVisible(x, true);
    expect(s.order).toEqual(['visibleAxes', 'axes']);
  });

  it('dispose stops following the dialog', () => {
    const s = setup();
    s.browser.dispose();
    s.editor.create('rev');
    s.browser.selectAxis(x);
    expect(s.browser.axes.get()[0]?.active).toBe(false);
  });
});

describe('BrowserModel regions (M13)', () => {
  const WITH_REGIONS: readonly RegenSketch[] = [
    { sketch: sketchId(fid('s1')), feature: fid('s1'), regions: ['r2', 'r1'] },
    { sketch: sketchId(fid('s2')), feature: fid('s2'), regions: [] },
  ];

  it('without a dialog every sketch has no region rows, the same frozen array', () => {
    const s = setup();
    s.regen.publish(new Map(), [], WITH_REGIONS);
    const rows = s.browser.sketches.get();
    expect(rows.map((r) => r.regions)).toEqual([[], []]);
    expect(rows[0]?.regions).toBe(rows[1]?.regions);
    expect(Object.isFrozen(rows[0]?.regions)).toBe(true);
  });

  it('with an active region param lists the regions in order numbered from 1, frozen', () => {
    const s = setup();
    s.regen.publish(new Map(), [], WITH_REGIONS);
    const session = s.editor.create('rev');
    session.focusRefParam('regions');
    const rows = s.browser.sketches.get();
    expect(rows[0]?.regions).toEqual([
      { region: 'r2', n: 1, selected: false },
      { region: 'r1', n: 2, selected: false },
    ]);
    expect(rows[1]?.regions).toEqual([]);
    expect(Object.isFrozen(rows[0]?.regions)).toBe(true);
    expect(rows[0]?.regions.every((r) => Object.isFrozen(r))).toBe(true);
  });

  it('an active param of another kind gives no region rows', () => {
    const s = setup();
    s.regen.publish(new Map(), [], WITH_REGIONS);
    const rev = s.editor.create('rev');
    expect(s.browser.sketches.get()[0]?.regions).toEqual([]);
    rev.cancel();
    s.editor.create('bool');
    expect(s.browser.sketches.get()[0]?.regions).toEqual([]);
  });

  it('selectRegion adds and removes the region in the active param; selected follows', () => {
    const s = setup();
    s.regen.publish(new Map(), [], WITH_REGIONS);
    const session = s.editor.create('rev');
    session.focusRefParam('regions');
    s.browser.selectRegion(fid('s1'), 'r1');
    s.browser.selectRegion(fid('s1'), 'r2');
    expect(session.state.get().params['regions']).toEqual([
      { kind: 'region', sketch: 's1', region: 'r1' },
      { kind: 'region', sketch: 's1', region: 'r2' },
    ]);
    expect(s.browser.sketches.get()[0]?.regions.map((r) => r.selected)).toEqual([true, true]);
    s.browser.selectRegion(fid('s1'), 'r1');
    expect(session.state.get().params['regions']).toEqual([
      { kind: 'region', sketch: 's1', region: 'r2' },
    ]);
    expect(s.browser.sketches.get()[0]?.regions.map((r) => r.selected)).toEqual([true, false]);
    expect(s.selection.items.get()).toEqual([]);
  });

  it('selectRegion without a dialog or with another active param does nothing', () => {
    const s = setup();
    s.regen.publish(new Map(), [], WITH_REGIONS);
    s.browser.selectRegion(fid('s1'), 'r1');
    expect(s.selection.items.get()).toEqual([]);
    const session = s.editor.create('rev');
    s.browser.selectRegion(fid('s1'), 'r1');
    expect(session.state.get().params['regions']).toEqual([]);
    expect(session.state.get().params['axis']).toBeNull();
  });

  it('closing the dialog drops the region rows', () => {
    const s = setup();
    s.regen.publish(new Map(), [], WITH_REGIONS);
    const session = s.editor.create('rev');
    session.focusRefParam('regions');
    expect(s.browser.sketches.get()[0]?.regions).toHaveLength(2);
    session.cancel();
    expect(s.browser.sketches.get()[0]?.regions).toEqual([]);
  });

  it('a new snapshot only on a change: an unrelated dialog change keeps the sketch rows', () => {
    const s = setup();
    s.regen.publish(new Map(), [], WITH_REGIONS);
    const session = s.editor.create('rev');
    session.focusRefParam('regions');
    const before = s.browser.sketches.get();
    const emits = s.sketchEmits();
    session.setParam('axis', { kind: 'axis', axis: ORIGIN_AXIS_IDS.x });
    expect(s.browser.sketches.get()).toBe(before);
    expect(s.sketchEmits()).toBe(emits);
    s.browser.selectRegion(fid('s1'), 'r2');
    const after = s.browser.sketches.get();
    expect(after).not.toBe(before);
    expect(after[1]).toBe(before[1]);
    expect(after[0]?.regions[1]).toBe(before[0]?.regions[1]);
  });
});
