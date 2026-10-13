import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { createFeatureSchemaRegistry, toData, validateAgainstSchema } from '@/document';
import type { FeatureId, FeatureSchema, ParamSchema } from '@/document';
import { aFeature } from '@/document/testing';
import type { DocumentOptions } from '@/document/testing';
import type { BatchOp, FeatureAddOp, Operation } from '@/ops';
import { OP_VERSION } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import { createFeatureEditor } from './feature-editor';

interface BoxParams {
  readonly width: number;
  readonly height: number;
  readonly targets: readonly unknown[];
}

const BOX_PARAMS: ParamSchema = {
  width: { kind: 'length', label: 'Width', default: 10, min: 0 },
  height: { kind: 'length', label: 'Height', default: 20, min: 0 },
  targets: { kind: 'bodies', label: 'Targets' },
};

const BOX: FeatureSchema<BoxParams> = {
  type: 'box',
  version: 1,
  label: 'Box',
  params: BOX_PARAMS,
  defaults: () => ({ width: 10, height: 20, targets: [] }),
  validate: (params) => validateAgainstSchema(BOX_PARAMS, params),
};

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted

function aBox(id: string, name = id): ReturnType<typeof aFeature<BoxParams>> {
  return aFeature<BoxParams>({
    id,
    name,
    type: 'box',
    params: { width: 1, height: 2, targets: [] },
  });
}

function setup(init: DocumentOptions = {}) {
  const session = anOpsSession(init);
  const schemas = createFeatureSchemaRegistry();
  schemas.register(BOX);
  const editor = createFeatureEditor({
    doc: session.doc,
    ops: session.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('new'),
  });
  return { ...session, editor };
}

/** Every op of the log, batches flattened. */
function loggedOps(ops: readonly Operation[]): readonly Operation[] {
  return ops.flatMap((op) => (op.type === 'batch' ? loggedOps((op as BatchOp).ops) : [op]));
}

describe('FeatureEditor observables', () => {
  it('exposes read-only views without set', () => {
    const { editor } = setup();
    const session = editor.create('box');

    expect('set' in editor.current).toBe(false);
    expect('set' in session.state).toBe(false);
    expect(editor.current).toBe(editor.current);
  });
});

describe('FeatureEditor.create', () => {
  it('adds the feature with defaults at the rollback bar and opens a session', () => {
    const { doc, editor } = setup();
    const session = editor.create('box');

    expect(session.mode).toBe('create');
    expect(session.featureId).toBe('new1');
    expect(session.schema).toBe(BOX);
    expect(editor.current.get()).toBe(session);
    expect(doc.feature(fid('new1'))).toEqual({
      id: 'new1',
      type: 'box',
      typeVersion: 1,
      name: 'Box 1',
      params: { width: 10, height: 20, targets: [] },
      suppressed: false,
    });
    const state = session.state.get();
    expect(state.open).toBe(true);
    expect(state.params).toEqual({ width: 10, height: 20, targets: [] });
    expect(state.issues).toEqual([]);
    expect(state.activeRefParam).toBeNull();
    expect(state.fields.map((f) => f.name)).toEqual(['width', 'height', 'targets']);
    expect(state.fields[0]).toEqual({
      name: 'width',
      spec: BOX_PARAMS.width,
      value: 10,
      issue: null,
      active: false,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.fields)).toBe(true);
    expect(Object.isFrozen(state.fields[0])).toBe(true);
    expect(Object.isFrozen(state.issues)).toBe(true);
  });

  it('create -> setParam x20 -> commit writes one entry batch[feature.add, feature.setParams]', () => {
    const { log, editor } = setup();
    const session = editor.create('box');
    for (let i = 1; i <= 20; i++) session.setParam('width', i);
    session.commit();

    const entries = log.entries();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.label).toBe('Box');
    expect(entry?.op.type).toBe('batch');
    const ops = (entry?.op as BatchOp).ops; // asserted to be a batch just above
    expect(ops.map((op) => op.type)).toEqual(['feature.add', 'feature.setParams']);
    expect(ops[1]).toMatchObject({ params: { width: 20, height: 20, targets: [] } });
  });

  it('cancel leaves the document and the log unchanged', () => {
    const { doc, log, editor } = setup({ features: [aBox('a')] });
    const before = toData(doc);
    const session = editor.create('box');
    session.setParam('width', 5);
    session.cancel();

    expect(toData(doc)).toEqual(before);
    expect(log.entries()).toEqual([]);
  });

  it('names the feature with the smallest free number', () => {
    const { doc, editor } = setup();
    editor.create('box').commit();
    editor.create('box').commit();
    expect(doc.studio.features.map((f) => f.name)).toEqual(['Box 1', 'Box 2']);
  });

  it('fills the gap after a removed name', () => {
    const { doc, editor } = setup({ features: [aBox('b2', 'Box 2')] });
    editor.create('box').commit();
    expect(doc.feature(fid('new1'))?.name).toBe('Box 1');
  });

  it('inserts at the rollback bar in the middle and moves the bar behind the new feature', () => {
    const { doc, editor } = setup({ features: [aBox('a'), aBox('b')], rollbackIndex: 1 });
    editor.create('box').commit();
    expect(doc.studio.features.map((f) => f.id)).toEqual(['a', 'new1', 'b']);
    expect(doc.studio.rollbackIndex).toBe(2);
  });

  it('throws for an unknown type and changes nothing', () => {
    const { dispatcher, editor } = setup();
    expect(() => editor.create('cylinder')).toThrow();
    expect(dispatcher.inTransaction).toBe(false);
    expect(editor.current.get()).toBeNull();
  });

  it('throws while the dispatcher is in a transaction', () => {
    const { dispatcher, editor } = setup();
    dispatcher.begin('other');
    expect(() => editor.create('box')).toThrow();
    expect(editor.current.get()).toBeNull();
  });

  it('a second session throws', () => {
    const { editor } = setup({ features: [aBox('a')] });
    const first = editor.create('box');
    expect(() => editor.create('box')).toThrow();
    expect(() => editor.edit(fid('a'))).toThrow();
    expect(editor.current.get()).toBe(first);
  });
});

describe('FeatureEditor.edit', () => {
  it('opens an existing feature with its params', () => {
    const { editor } = setup({ features: [aBox('a', 'Box 7')] });
    const session = editor.edit(fid('a'));
    expect(session.mode).toBe('edit');
    expect(session.featureId).toBe('a');
    expect(session.schema).toBe(BOX);
    expect(session.state.get().params).toEqual({ width: 1, height: 2, targets: [] });
    expect(editor.current.get()).toBe(session);
  });

  it('labels the entry Edit <name>', () => {
    const { log, editor } = setup({ features: [aBox('a', 'Box 7')] });
    const session = editor.edit(fid('a'));
    session.setParam('width', 3);
    session.commit();
    expect(log.entries().map((e) => e.label)).toEqual(['Edit Box 7']);
  });

  it('throws for an unknown feature and changes nothing', () => {
    const { dispatcher, editor } = setup();
    expect(() => editor.edit(fid('nope'))).toThrow();
    expect(dispatcher.inTransaction).toBe(false);
    expect(editor.current.get()).toBeNull();
  });

  // Features a, b, c; the edited feature b has index 1, so the bar goes to 2 during the session.
  describe.each([
    { where: 'before the bar', bar: 3 },
    { where: 'behind the bar', bar: 0 },
  ])('a feature $where', ({ bar }) => {
    const features = [aBox('a'), aBox('b'), aBox('c')];

    it('moves the bar to index + 1 during the session and back after commit', () => {
      const { doc, log, editor } = setup({ features, rollbackIndex: bar });
      const session = editor.edit(fid('b'));
      expect(doc.studio.rollbackIndex).toBe(2);
      session.setParam('width', 9);
      session.commit();

      expect(doc.studio.rollbackIndex).toBe(bar);
      expect(doc.feature(fid('b'))?.params).toMatchObject({ width: 9 });
      const ops = loggedOps(log.entries().map((e) => e.op));
      expect(ops.map((op) => op.type)).toEqual(['feature.setParams']);
    });

    it('moves the bar back after cancel and logs nothing', () => {
      const { doc, log, editor } = setup({ features, rollbackIndex: bar });
      const before = toData(doc);
      const session = editor.edit(fid('b'));
      session.setParam('width', 9);
      session.cancel();

      expect(toData(doc)).toEqual(before);
      expect(log.entries()).toEqual([]);
    });
  });

  it('applies no transient op when the bar is already at index + 1', () => {
    const { doc, dispatcher, editor } = setup({
      features: [aBox('a'), aBox('b'), aBox('c')],
      rollbackIndex: 2,
    });
    const applied: Operation[] = [];
    dispatcher.events.on('applied', ({ op }) => applied.push(op));
    const session = editor.edit(fid('b'));
    expect(applied).toEqual([]);
    session.cancel();
    expect(applied).toEqual([]);
    expect(doc.studio.rollbackIndex).toBe(2);
  });
});

describe('FeatureEditSession', () => {
  it('setParam applies the new params and updates the state', () => {
    const { doc, editor } = setup();
    const session = editor.create('box');
    const before = session.state.get();
    session.setParam('height', 7);

    expect(doc.feature(fid('new1'))?.params).toEqual({ width: 10, height: 7, targets: [] });
    const state = session.state.get();
    expect(state).not.toBe(before);
    expect(state.params).toEqual({ width: 10, height: 7, targets: [] });
    expect(state.fields[1]?.value).toBe(7);
    // Unchanged fields stay the same objects.
    expect(state.fields[0]).toBe(before.fields[0]);
    expect(state.fields[2]).toBe(before.fields[2]);
  });

  it('an invalid value is applied and shows in issues and FieldState.issue', () => {
    const { doc, editor } = setup();
    const session = editor.create('box');
    session.setParam('width', -1);

    expect(doc.feature(fid('new1'))?.params).toMatchObject({ width: -1 });
    const state = session.state.get();
    expect(state.issues.map((i) => i.param)).toEqual(['width']);
    expect(state.fields[0]?.issue).toEqual(expect.any(String));
    expect(state.fields[1]?.issue).toBeNull();
  });

  it('commit is allowed with issues', () => {
    const { log, editor } = setup();
    const session = editor.create('box');
    session.setParam('width', -1);
    session.commit();
    expect(log.entries()).toHaveLength(1);
  });

  it('setParam of an unknown param throws', () => {
    const { editor } = setup();
    const session = editor.create('box');
    expect(() => {
      session.setParam('depth', 1);
    }).toThrow();
  });

  it('setParam with the same value applies nothing and emits nothing', () => {
    const { dispatcher, editor } = setup();
    const session = editor.create('box');
    const applied: Operation[] = [];
    dispatcher.events.on('applied', ({ op }) => applied.push(op));
    let emits = 0;
    session.state.subscribe(() => emits++);
    session.setParam('width', 10);
    expect(applied).toEqual([]);
    expect(emits).toBe(0);
  });

  it('a failing handler leaves the session open and unchanged', () => {
    const { doc, editor } = setup();
    const session = editor.create('box');
    const before = session.state.get();
    const studioBefore = doc.studio;
    // Freezing the new params reads the getter, so the document mutator throws before any change.
    const poisoned = {
      get boom(): never {
        throw new Error('boom');
      },
    };
    expect(() => {
      session.setParam('targets', poisoned);
    }).toThrow('boom');

    expect(doc.studio).toBe(studioBefore);
    expect(session.state.get()).toBe(before);
    expect(editor.current.get()).toBe(session);
    session.setParam('width', 3);
    expect(session.state.get().params).toMatchObject({ width: 3 });
  });

  it('focusRefParam marks the active field; null clears it', () => {
    const { editor } = setup();
    const session = editor.create('box');
    const before = session.state.get();
    session.focusRefParam('targets');

    const state = session.state.get();
    expect(state.activeRefParam).toBe('targets');
    expect(state.fields[2]?.active).toBe(true);
    expect(state.fields[0]).toBe(before.fields[0]);

    let emits = 0;
    session.state.subscribe(() => emits++);
    session.focusRefParam('targets');
    expect(emits).toBe(0);

    session.focusRefParam(null);
    expect(session.state.get().activeRefParam).toBeNull();
    expect(session.state.get().fields[2]?.active).toBe(false);
  });

  it('focusRefParam on a non-reference or unknown param throws', () => {
    const { editor } = setup();
    const session = editor.create('box');
    expect(() => {
      session.focusRefParam('width');
    }).toThrow();
    expect(() => {
      session.focusRefParam('depth');
    }).toThrow();
  });

  it('commit closes the session and current goes to null', () => {
    const { editor } = setup();
    const session = editor.create('box');
    const seen: unknown[] = [];
    editor.current.subscribe(() => seen.push(editor.current.get()));
    session.commit();
    expect(session.state.get().open).toBe(false);
    expect(editor.current.get()).toBeNull();
    expect(seen).toEqual([null]);
  });

  it('cancel closes the session and current goes to null', () => {
    const { editor } = setup();
    const session = editor.create('box');
    session.cancel();
    expect(session.state.get().open).toBe(false);
    expect(editor.current.get()).toBeNull();
  });

  it('every command after closing throws', () => {
    const { editor } = setup();
    const session = editor.create('box');
    session.commit();
    expect(() => {
      session.setParam('width', 1);
    }).toThrow();
    expect(() => {
      session.focusRefParam(null);
    }).toThrow();
    expect(() => {
      session.commit();
    }).toThrow();
    expect(() => {
      session.cancel();
    }).toThrow();
  });

  it('a new session can be opened after closing', () => {
    const { editor } = setup();
    editor.create('box').cancel();
    const second = editor.create('box');
    expect(editor.current.get()).toBe(second);
  });

  it('undo is disabled during the session', () => {
    const { dispatcher, undo, editor } = setup();
    const add: FeatureAddOp = {
      type: 'feature.add',
      v: OP_VERSION['feature.add'],
      feature: aBox('a'),
      index: 0,
    };
    dispatcher.dispatch(add);
    expect(undo.canUndo()).toBe(true);
    const session = editor.edit(fid('a'));
    expect(undo.canUndo()).toBe(false);
    session.cancel();
    expect(undo.canUndo()).toBe(true);
  });
});
