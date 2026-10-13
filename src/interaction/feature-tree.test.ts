import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { BodyId, FeatureId, FeatureSchema, ParamSchema } from '@/document';
import { aFeature } from '@/document/testing';
import type { DocumentOptions } from '@/document/testing';
import type { FeatureAddOp, FeatureSuppressOp } from '@/ops';
import { OP_VERSION } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import { createFeatureEditor } from './feature-editor';
import { createFeatureTreeModel } from './feature-tree';
import type { FeatureHealth } from './regen-status-port';
import { createSelectionModel } from './selection';
import { FakeRegenStatus } from './testing';

interface BoxParams {
  readonly width: number;
}

const BOX_PARAMS: ParamSchema = {
  width: { kind: 'length', label: 'Width', default: 10, min: 0 },
};

const BOX: FeatureSchema<BoxParams> = {
  type: 'box',
  version: 1,
  label: 'Box',
  icon: 'box',
  params: BOX_PARAMS,
  defaults: () => ({ width: 10 }),
  validate: (params) => validateAgainstSchema(BOX_PARAMS, params),
};

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted
const bid = (id: string): BodyId => id as BodyId; // test ids are trusted

function aBox(id: string, type = 'box'): ReturnType<typeof aFeature<BoxParams>> {
  return aFeature<BoxParams>({ id, name: `Name ${id}`, type, params: { width: 1 } });
}

function setup(init: DocumentOptions = {}) {
  const session = anOpsSession(init);
  const schemas = createFeatureSchemaRegistry();
  schemas.register(BOX);
  const regen = new FakeRegenStatus();
  const selection = createSelectionModel({ regen });
  const editor = createFeatureEditor({
    doc: session.doc,
    ops: session.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('new'),
  });
  const tree = createFeatureTreeModel({
    doc: session.doc,
    ops: session.dispatcher,
    schemas,
    regen,
    editor,
    selection,
  });
  /** Counts emissions of rows. */
  let emits = 0;
  tree.rows.subscribe(() => {
    emits++;
  });
  return { ...session, schemas, regen, selection, editor, tree, emits: () => emits };
}

function addFeature(s: ReturnType<typeof setup>, id: string, index: number): void {
  const op: FeatureAddOp = {
    type: 'feature.add',
    v: OP_VERSION['feature.add'],
    feature: aBox(id),
    index,
  };
  s.dispatcher.dispatch(op);
}

function suppress(s: ReturnType<typeof setup>, id: string): void {
  const op: FeatureSuppressOp = {
    type: 'feature.suppress',
    v: OP_VERSION['feature.suppress'],
    featureId: fid(id),
    suppressed: true,
  };
  s.dispatcher.dispatch(op);
}

const ok = { kind: 'ok' } as const;

describe('FeatureTreeModel rows', () => {
  it('starts empty and lists an added feature as pending, then ok after a regeneration', () => {
    const s = setup();
    expect(s.tree.rows.get()).toEqual([]);

    addFeature(s, 'f1', 0);
    expect(s.tree.rows.get()).toEqual([
      {
        id: 'f1',
        name: 'Name f1',
        type: 'box',
        typeLabel: 'Box',
        icon: 'box',
        issues: null,
        status: 'pending',
        message: null,
        selected: false,
        editing: false,
      },
    ]);

    s.regen.publish(new Map([[fid('f1'), ok]]));
    expect(s.tree.rows.get()[0]?.status).toBe('ok');
    expect(s.tree.rows.get()[0]?.message).toBeNull();
  });

  it('lists rows in document order and freezes the snapshot and its rows', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aBox('c')] });
    const rows = s.tree.rows.get();
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(rows.every((r) => Object.isFrozen(r))).toBe(true);
  });

  it('shows a regeneration error and warning with their messages', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    s.regen.publish(
      new Map([
        [fid('a'), { kind: 'warning', message: 'thin wall' }],
        [fid('b'), { kind: 'error', message: 'boom' }],
      ]),
    );
    const [a, b] = s.tree.rows.get();
    expect(a).toMatchObject({ status: 'warning', message: 'thin wall' });
    expect(b).toMatchObject({ status: 'error', message: 'boom' });
  });

  it('shows a suppressed feature as suppressed even with an error in health', () => {
    const s = setup({ features: [aBox('a')] });
    s.regen.publish(new Map([[fid('a'), { kind: 'error', message: 'boom' }]]));
    suppress(s, 'a');
    expect(s.tree.rows.get()[0]).toMatchObject({ status: 'suppressed', message: null });
  });

  it('suppressed wins over rolledBack', () => {
    const s = setup({ features: [{ ...aBox('a'), suppressed: true }], rollbackIndex: 0 });
    expect(s.tree.rows.get()[0]?.status).toBe('suppressed');
  });

  it('shows features at and after the rollback bar as rolledBack', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aBox('c')] });
    s.regen.publish(
      new Map([
        [fid('a'), ok],
        [fid('b'), ok],
        [fid('c'), ok],
      ]),
    );
    s.tree.moveRollbackBar(1);
    expect(s.tree.rows.get().map((r) => r.status)).toEqual(['ok', 'rolledBack', 'rolledBack']);
  });

  it('uses the type as the label for an unknown type', () => {
    const s = setup({ features: [aBox('a', 'mystery')] });
    expect(s.tree.rows.get()[0]).toMatchObject({ type: 'mystery', typeLabel: 'mystery' });
  });

  it('takes the icon from the schema, null for an unknown type', () => {
    const s = setup({ features: [aBox('a'), aBox('b', 'mystery')] });
    expect(s.tree.rows.get().map((r) => r.icon)).toEqual(['box', null]);
  });

  it('has a null icon when the schema has none', () => {
    const s = setup({ features: [aBox('a', 'plain')] });
    s.schemas.register({
      type: 'plain',
      version: 1,
      label: 'Plain',
      params: BOX_PARAMS,
      defaults: () => ({ width: 10 }),
      validate: (params) => validateAgainstSchema(BOX_PARAMS, params),
    });
    s.regen.publish(new Map());
    expect(s.tree.rows.get()[0]?.icon).toBeNull();
  });

  it('carries the issues of an error from the regeneration', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aBox('c')] });
    const issues = [{ param: 'width', code: 'param.atOrBelowMin', params: { min: 0 } }];
    s.regen.publish(
      new Map<FeatureId, FeatureHealth>([
        [fid('a'), { kind: 'error', message: 'invalid params', issues }],
        [fid('b'), { kind: 'error', message: 'boom' }],
        [fid('c'), { kind: 'warning', message: 'thin wall' }],
      ]),
    );
    expect(s.tree.rows.get().map((r) => r.issues)).toEqual([issues, null, null]);
  });

  it('drops the issues of a suppressed feature', () => {
    const s = setup({ features: [aBox('a')] });
    const issues = [{ param: 'width', code: 'param.atOrBelowMin', params: { min: 0 } }];
    s.regen.publish(new Map([[fid('a'), { kind: 'error', message: 'x', issues }]]));
    suppress(s, 'a');
    expect(s.tree.rows.get()[0]?.issues).toBeNull();
  });

  it('keeps the row identical when a new regeneration reports equal issues', () => {
    const s = setup({ features: [aBox('a')] });
    const issues = () => [{ param: 'width', code: 'param.atOrBelowMin', params: { min: 0 } }];
    s.regen.publish(new Map([[fid('a'), { kind: 'error', message: 'x', issues: issues() }]]));
    const row = s.tree.rows.get()[0];
    s.regen.publish(new Map([[fid('a'), { kind: 'error', message: 'x', issues: issues() }]]));
    expect(s.tree.rows.get()[0]).toBe(row);

    s.regen.publish(
      new Map([
        [fid('a'), { kind: 'error', message: 'x', issues: [{ param: 'width', code: 'other' }] }],
      ]),
    );
    expect(s.tree.rows.get()[0]).not.toBe(row);
  });

  it('makes a new snapshot object on change and keeps unchanged rows identical', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    const before = s.tree.rows.get();
    s.regen.publish(new Map([[fid('a'), ok]]));
    const after = s.tree.rows.get();
    expect(after).not.toBe(before);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(s.emits()).toBe(1);
  });

  it('does not emit when nothing in the rows changed', () => {
    const s = setup({ features: [aBox('a')] });
    s.regen.publish(new Map([[fid('a'), ok]]));
    const snapshot = s.tree.rows.get();
    expect(s.emits()).toBe(1);

    // Same health again (a new regeneration), a selection without features: no change in rows.
    s.regen.publish(new Map([[fid('a'), ok]]));
    s.selection.set([{ kind: 'body', body: bid('b1') }]);
    expect(s.tree.rows.get()).toBe(snapshot);
    expect(s.emits()).toBe(1);
  });

  it('marks selected rows by the selection', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    s.selection.set([{ kind: 'feature', feature: fid('b') }]);
    expect(s.tree.rows.get().map((r) => r.selected)).toEqual([false, true]);
  });

  it('marks the row of the open edit session as editing', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    s.tree.edit(fid('a'));
    expect(s.editor.current.get()?.featureId).toBe('a');
    expect(s.tree.rows.get().map((r) => r.editing)).toEqual([true, false]);

    s.editor.current.get()?.cancel();
    expect(s.tree.rows.get().map((r) => r.editing)).toEqual([false, false]);
  });
});

describe('FeatureTreeModel commands', () => {
  it('rename trims the name and dispatches feature.rename', () => {
    const s = setup({ features: [aBox('a')] });
    s.tree.rename(fid('a'), '  Base  ');
    expect(s.doc.feature(fid('a'))?.name).toBe('Base');
    expect(s.tree.rows.get()[0]?.name).toBe('Base');
    expect(s.log.entries().at(-1)?.op).toEqual({
      type: 'feature.rename',
      v: OP_VERSION['feature.rename'],
      featureId: 'a',
      name: 'Base',
    });
  });

  it('rename with an empty or the same name does nothing', () => {
    const s = setup({ features: [aBox('a')] });
    s.tree.rename(fid('a'), '   ');
    s.tree.rename(fid('a'), ' Name a ');
    expect(s.log.entries()).toHaveLength(0);
    expect(s.doc.feature(fid('a'))?.name).toBe('Name a');
  });

  it('moveRollbackBar dispatches studio.setRollback and updates rollbackIndex', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    expect(s.tree.rollbackIndex.get()).toBe(2);
    let barEmits = 0;
    s.tree.rollbackIndex.subscribe(() => {
      barEmits++;
    });

    s.tree.moveRollbackBar(0);
    expect(s.doc.studio.rollbackIndex).toBe(0);
    expect(s.tree.rollbackIndex.get()).toBe(0);
    expect(barEmits).toBe(1);
    expect(s.log.entries().at(-1)?.op).toEqual({
      type: 'studio.setRollback',
      v: OP_VERSION['studio.setRollback'],
      index: 0,
    });
  });

  it('moveRollbackBar to the same index does nothing', () => {
    const s = setup({ features: [aBox('a')] });
    s.tree.moveRollbackBar(1);
    expect(s.log.entries()).toHaveLength(0);
  });

  it('moveRollbackBar out of 0..features.length throws', () => {
    const s = setup({ features: [aBox('a')] });
    expect(() => {
      s.tree.moveRollbackBar(2);
    }).toThrow();
    expect(() => {
      s.tree.moveRollbackBar(-1);
    }).toThrow();
    expect(() => {
      s.tree.moveRollbackBar(0.5);
    }).toThrow();
    expect(s.log.entries()).toHaveLength(0);
  });

  it('rename and moveRollbackBar throw during an open transaction', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    s.tree.edit(fid('b'));
    expect(() => {
      s.tree.rename(fid('a'), 'X');
    }).toThrow();
    expect(() => {
      s.tree.moveRollbackBar(0);
    }).toThrow();
  });

  it('select replaces the selection, additive toggles', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    s.selection.set([{ kind: 'body', body: bid('b1') }]);
    s.tree.select(fid('a'));
    expect(s.selection.items.get()).toEqual([{ kind: 'feature', feature: 'a' }]);

    s.tree.select(fid('b'), { additive: true });
    expect(s.selection.items.get()).toEqual([
      { kind: 'feature', feature: 'a' },
      { kind: 'feature', feature: 'b' },
    ]);

    s.tree.select(fid('a'), { additive: true });
    expect(s.selection.items.get()).toEqual([{ kind: 'feature', feature: 'b' }]);
  });

  it('dispose unsubscribes from all sources', () => {
    const s = setup({ features: [aBox('a')] });
    const rows = s.tree.rows.get();
    const bar = s.tree.rollbackIndex.get();
    s.tree.dispose();

    addFeature(s, 'b', 1);
    s.regen.publish(new Map([[fid('a'), ok]]));
    s.selection.set([{ kind: 'feature', feature: fid('a') }]);
    s.editor.edit(fid('a'));

    expect(s.tree.rows.get()).toBe(rows);
    expect(s.tree.rollbackIndex.get()).toBe(bar);
    expect(s.emits()).toBe(0);
  });
});

describe('FeatureTreeModel rename mode', () => {
  it('starts without a feature in the rename mode', () => {
    const s = setup({ features: [aBox('a')] });
    expect(s.tree.renaming.get()).toBeNull();
    expect('set' in s.tree.renaming).toBe(false);
  });

  it('beginRename puts the feature into the rename mode, cancelRename ends it', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    let emits = 0;
    s.tree.renaming.subscribe(() => {
      emits++;
    });

    s.tree.beginRename(fid('b'));
    expect(s.tree.renaming.get()).toBe('b');
    s.tree.beginRename(fid('b'));
    expect(emits).toBe(1);

    s.tree.cancelRename();
    expect(s.tree.renaming.get()).toBeNull();
    s.tree.cancelRename();
    expect(emits).toBe(2);
    expect(s.log.entries()).toHaveLength(0);
  });

  it('rename ends the rename mode, also with an unchanged name', () => {
    const s = setup({ features: [aBox('a')] });
    s.tree.beginRename(fid('a'));
    s.tree.rename(fid('a'), 'Base');
    expect(s.tree.renaming.get()).toBeNull();
    expect(s.doc.feature(fid('a'))?.name).toBe('Base');

    s.tree.beginRename(fid('a'));
    s.tree.rename(fid('a'), '  ');
    expect(s.tree.renaming.get()).toBeNull();
  });

  it('beginRename of an unknown feature throws and leaves the mode as it was', () => {
    const s = setup({ features: [aBox('a')] });
    expect(() => {
      s.tree.beginRename(fid('x'));
    }).toThrow();
    expect(s.tree.renaming.get()).toBeNull();
  });
});
