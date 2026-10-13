import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { bodyId, createFeatureSchemaRegistry, toData, validateAgainstSchema } from '@/document';
import type { BodyId, FeatureId, FeatureSchema, ParamSchema } from '@/document';
import { aFeature } from '@/document/testing';
import type { BodyRenameOp, BodySetVisibleOp, Operation } from '@/ops';
import { OP_VERSION } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import { createBrowserModel } from './browser-model';
import { createFeatureEditor } from './feature-editor';
import type { RegenBody } from './regen-status-port';
import { createSelectionModel } from './selection';
import { FakeRegenStatus } from './testing';

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted

const B1 = bodyId(fid('f1'));
const B2 = bodyId(fid('f2'));
const B3 = bodyId(fid('f3'));
const BODIES: readonly RegenBody[] = [
  { body: B1, feature: fid('f1') },
  { body: B2, feature: fid('f2') },
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

function setup() {
  const schemas = createFeatureSchemaRegistry();
  schemas.register(BOOL);
  schemas.register(TOPO);
  const ops = anOpsSession({
    schemas,
    features: [
      aFeature({ id: 'f1', name: 'Box 1' }),
      aFeature({ id: 'f2', name: 'Cylinder 1' }),
      aFeature({ id: 'f3', name: 'Box 2' }),
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
  const browser = createBrowserModel({
    doc: ops.doc,
    ops: ops.dispatcher,
    regen,
    selection,
    editor,
  });
  const order: string[] = [];
  browser.bodies.subscribe(() => order.push('bodies'));
  browser.hidden.subscribe(() => order.push('hidden'));
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
        selected: false,
      },
      {
        body: B2,
        name: { key: 'browser.body', n: 2 },
        userName: null,
        feature: 'f2',
        visible: true,
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

describe('BrowserModel.refLabel', () => {
  it('is the name from the metadata', () => {
    const s = setup();
    s.doc.setBodyMeta(B1, { name: 'Base' });
    expect(s.browser.refLabel(B1)).toBe('Base');
  });

  it('is the name of the origin feature without a name in the metadata', () => {
    const s = setup();
    expect(s.browser.refLabel(B2)).toBe('Cylinder 1');
  });

  it('adds the number of the body id as a suffix', () => {
    const s = setup();
    expect(s.browser.refLabel(bodyId(fid('f2'), 2))).toBe('Cylinder 1 (2)');
  });

  it('does not need the body in the last regeneration', () => {
    const s = setup();
    s.regen.publish(new Map(), [{ body: B1, feature: fid('f1') }]);
    expect(s.browser.refLabel(B3)).toBe('Box 2');
  });

  it('is null when the origin feature is not in the document, even with a name', () => {
    const s = setup();
    s.doc.setBodyMeta(B3, { name: 'Gone' });
    s.doc.removeFeature(fid('f3'));
    expect(s.browser.refLabel(B3)).toBeNull();
    expect(s.browser.refLabel(bodyId(fid('nope')))).toBeNull();
  });

  it('is null for a value not shaped like a body id (params may hold anything)', () => {
    const s = setup();
    for (const junk of ['f1', '', 'f1/face', 'f1/body:0']) {
      // Simulates an invalid param value that reached the field.
      expect(s.browser.refLabel(junk as BodyId)).toBeNull();
    }
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
});
