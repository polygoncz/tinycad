import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import { aFeature, bodyId } from '@/document/testing';
import type { BodyId, FeatureId, FeatureSchema } from '@/document';
import type { DocumentOptions, ParamSchemaOf } from '@/document/testing';
import type { FeatureAddOp } from '@/ops';
import { OP_VERSION } from '@/ops';
import { aFakeOps } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE } from '@/sketch';
import { createEditLock } from '@/interaction/edit-lock';
import { createFeatureEditor } from '@/interaction/feature-dialog/feature-editor';
import { createFeatureTreeModel } from '@/interaction/feature-tree';
import type { FeatureHealth } from '@/interaction/regen-status-port';
import { createSelectionModel } from '@/interaction/selection';
import { FakeRegenStatus } from '@/interaction/testing';

interface BoxParams {
  readonly width: number;
}

const BOX_PARAMS: ParamSchemaOf<BoxParams> = {
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

interface UseParams {
  readonly bodies: readonly { readonly kind: 'body'; readonly body: BodyId }[];
}

const USE_PARAMS: ParamSchemaOf<UseParams> = {
  bodies: { kind: 'bodies', label: 'Bodies' },
};

/** A test feature that refers to bodies of other features (not the real Boolean). */
const USE: FeatureSchema<UseParams> = {
  type: 'use',
  version: 1,
  label: 'Use',
  params: USE_PARAMS,
  defaults: () => ({ bodies: [] }),
  validate: (params) => validateAgainstSchema(USE_PARAMS, params),
};

/** The params of a feature that uses the bodies of the given features. */
function using(...owners: string[]): UseParams {
  return { bodies: owners.map((owner) => ({ kind: 'body', body: bodyId(fid(owner)) })) };
}

/** A feature that uses the bodies of the given features. */
function aUse(id: string, ...owners: string[]): ReturnType<typeof aFeature<UseParams>> {
  return aFeature<UseParams>({ id, name: `Name ${id}`, type: 'use', params: using(...owners) });
}

function aBox(id: string, type = 'box'): ReturnType<typeof aFeature<BoxParams>> {
  return aFeature<BoxParams>({ id, name: `Name ${id}`, type, params: { width: 1 } });
}

interface ExtParams {
  readonly profile: readonly {
    readonly kind: 'region';
    readonly sketch: FeatureId;
    readonly region: string;
  }[];
}

const EXT_PARAMS: ParamSchemaOf<ExtParams> = {
  profile: { kind: 'region', label: 'Profile', min: 1 },
};

/** A test feature with a required region param, like Extrude (D6 of M19.2). */
const EXT: FeatureSchema<ExtParams> = {
  type: 'ext',
  version: 1,
  label: 'Ext',
  params: EXT_PARAMS,
  defaults: () => ({ profile: [] }),
  validate: (params) => validateAgainstSchema(EXT_PARAMS, params),
};

function setup(init: DocumentOptions = {}, sketchEdit?: (id: FeatureId) => void, readOnly = false) {
  const ops = aFakeOps(init);
  const schemas = createFeatureSchemaRegistry();
  schemas.register(BOX);
  schemas.register(USE);
  schemas.register(EXT);
  const regen = new FakeRegenStatus();
  const selection = createSelectionModel({ regen });
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops,
    schemas,
    ids: createSequentialIdGenerator('new'),
  });
  const tree = createFeatureTreeModel({
    doc: ops.doc,
    ops,
    schemas,
    regen,
    editor,
    selection,
    locked: createEditLock({ readOnly, editor }),
    ...(sketchEdit === undefined ? {} : { sketchEdit }),
  });
  /** Counts emissions of rows. */
  let emits = 0;
  tree.rows.subscribe(() => {
    emits++;
  });
  return { ops, doc: ops.doc, schemas, regen, selection, editor, tree, emits: () => emits };
}

/** A read model of the server with a new box at `index` (inserting at the bar moves it, Q068). */
function addFeature(s: ReturnType<typeof setup>, id: string, index: number): void {
  const { features, rollbackIndex } = s.doc.studio;
  s.doc.replace({
    studio: {
      features: features.toSpliced(index, 0, aBox(id)),
      rollbackIndex: index <= rollbackIndex ? rollbackIndex + 1 : rollbackIndex,
    },
  });
}

/** A read model of the server with the feature suppressed. */
function suppress(s: ReturnType<typeof setup>, id: string): void {
  const { studio } = s.doc;
  s.doc.replace({
    studio: {
      ...studio,
      features: studio.features.map((f) => (f.id === id ? { ...f, suppressed: true } : f)),
    },
  });
}

/** The server takes the feature.add of the open dialog: the new feature is in the read model. */
function serveAdded(s: ReturnType<typeof setup>): void {
  const add = s.ops.ops().findLast((op): op is FeatureAddOp => op.type === 'feature.add');
  if (add === undefined) throw new Error('no feature.add sent');
  addFeature(s, add.feature.id, add.index);
  const { studio } = s.doc;
  s.doc.replace({
    studio: {
      ...studio,
      features: studio.features.map((f) => (f.id === add.feature.id ? add.feature : f)),
    },
  });
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
        detail: null,
        selected: false,
        editing: false,
        dependents: 0,
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
    s.doc.replace({ studio: { ...s.doc.studio, rollbackIndex: 1 } });
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

  it('a row with issues has no technical message: the translated issues replace it (ADR 0010)', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aBox('c')] });
    const issues = [{ param: 'radius', code: 'fillet.failed' }];
    s.regen.publish(
      new Map<FeatureId, FeatureHealth>([
        [fid('a'), { kind: 'error', message: 'radius: fillet.failed', issues }],
        // No translated issues (a kernel error, an unresolved reference): the message stays.
        [fid('b'), { kind: 'error', message: 'BRep_API: command not done', issues: [] }],
        [fid('c'), { kind: 'error', message: 'cannot resolve f1/body' }],
      ]),
    );
    expect(s.tree.rows.get().map((r) => [r.status, r.message, r.issues])).toEqual([
      ['error', null, issues],
      ['error', 'BRep_API: command not done', []],
      ['error', 'cannot resolve f1/body', null],
    ]);
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
  it('rename trims the name and dispatches feature.rename; the row follows the answer', () => {
    const s = setup({ features: [aBox('a')] });
    s.tree.rename(fid('a'), '  Base  ');
    // No optimism (N168): the row keeps the old name until the read model of the answer.
    expect(s.tree.rows.get()[0]?.name).toBe('Name a');
    s.ops.answer({
      document: { studio: { features: [{ ...aBox('a'), name: 'Base' }], rollbackIndex: 1 } },
    });
    expect(s.tree.rows.get()[0]?.name).toBe('Base');
    expect(s.ops.ops().at(-1)).toEqual({
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
    expect(s.ops.sent).toEqual([]);
  });

  it('moveRollbackBar dispatches studio.setRollback; rollbackIndex follows the answer', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    expect(s.tree.rollbackIndex.get()).toBe(2);
    let barEmits = 0;
    s.tree.rollbackIndex.subscribe(() => {
      barEmits++;
    });

    s.tree.moveRollbackBar(0);
    expect(s.tree.rollbackIndex.get()).toBe(2);
    s.ops.answer({ document: { studio: { ...s.doc.studio, rollbackIndex: 0 } } });
    expect(s.tree.rollbackIndex.get()).toBe(0);
    expect(barEmits).toBe(1);
    expect(s.ops.ops().at(-1)).toEqual({
      type: 'studio.setRollback',
      v: OP_VERSION['studio.setRollback'],
      index: 0,
    });
  });

  it('moveRollbackBar to the same index does nothing', () => {
    const s = setup({ features: [aBox('a')] });
    s.tree.moveRollbackBar(1);
    expect(s.ops.sent).toEqual([]);
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
    expect(s.ops.sent).toEqual([]);
  });

  it('rename and moveRollbackBar throw during a transaction outside the edit lock', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    s.ops.begin('other');
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
    expect(s.ops.sent).toEqual([]);
  });

  it('rename ends the rename mode, also with an unchanged name', () => {
    const s = setup({ features: [aBox('a')] });
    s.tree.beginRename(fid('a'));
    s.tree.rename(fid('a'), 'Base');
    expect(s.tree.renaming.get()).toBeNull();
    expect(s.ops.ops()).toHaveLength(1);

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

describe('FeatureTreeModel dependencies', () => {
  it('counts the features that depend on a row, 0 without dependents', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aUse('u', 'a')] });
    expect(s.tree.rows.get().map((r) => r.dependents)).toEqual([1, 0, 0]);
  });

  it('a changed reference changes dependents and only the affected rows', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aBox('c'), aUse('u', 'a')] });
    const before = s.tree.rows.get();
    // A read model with u referring to b instead of a.
    s.doc.replace({
      studio: {
        ...s.doc.studio,
        features: s.doc.studio.features.map((f) =>
          f.id === 'u' ? { ...f, params: using('b') } : f,
        ),
      },
    });
    const after = s.tree.rows.get();
    expect(after.map((r) => r.dependents)).toEqual([0, 1, 0, 0]);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    expect(after[3]).toBe(before[3]);
  });

  it('dependentsOf several ids leaves the ids out, in studio order, without duplicates', () => {
    const s = setup({
      features: [aBox('a'), aBox('b'), aUse('u', 'b', 'a'), aUse('v', 'u'), aUse('w', 'a')],
    });
    const dependents = s.tree.dependentsOf([fid('b'), fid('a'), fid('u')]);
    expect(dependents).toEqual(['v', 'w']);
    expect(Object.isFrozen(dependents)).toBe(true);
    expect(s.tree.dependentsOf([fid('b')])).toEqual(['u']);
    expect(s.tree.dependentsOf([])).toEqual([]);
  });
});

describe('FeatureTreeModel move', () => {
  it('a valid move dispatches feature.move', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aUse('u', 'a')] });
    expect(s.tree.move(fid('a'), 1)).toEqual([]);
    expect(s.ops.ops()).toEqual([
      {
        type: 'feature.move',
        v: OP_VERSION['feature.move'],
        featureId: 'a',
        toIndex: 1,
      },
    ]);
  });

  it('moving a dependent feature before its dependency returns the violations and changes nothing', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aUse('u', 'b')] });
    const violations = s.tree.move(fid('u'), 0);
    expect(violations).toEqual([{ feature: 'u', dependsOn: 'b' }]);
    expect(s.ops.sent).toEqual([]);

    // Moving the dependency after the dependent is refused as well.
    expect(s.tree.move(fid('b'), 2)).toEqual([{ feature: 'u', dependsOn: 'b' }]);
    expect(s.ops.sent).toEqual([]);
  });

  it('a move to the same index does nothing', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    expect(s.tree.move(fid('b'), 1)).toEqual([]);
    expect(s.ops.sent).toEqual([]);
  });

  it('an unknown id or an index out of 0..features.length - 1 throws', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    for (const index of [-1, 2, 0.5, Number.NaN]) {
      expect(() => s.tree.move(fid('a'), index)).toThrow();
    }
    expect(() => s.tree.move(fid('x'), 0)).toThrow();
    expect(s.ops.sent).toEqual([]);
  });

  it('a violation already in the document does not block another move', () => {
    // u refers to b, which comes after it: data from outside.
    const s = setup({ features: [aUse('u', 'b'), aBox('a'), aBox('b')] });
    expect(s.tree.move(fid('a'), 2)).toEqual([]);
    expect(s.ops.ops()).toEqual([
      { type: 'feature.move', v: OP_VERSION['feature.move'], featureId: 'a', toIndex: 2 },
    ]);
  });

  it('throws during a transaction outside the edit lock, like rename', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    s.ops.begin('other');
    expect(() => s.tree.move(fid('a'), 1)).toThrow();
  });
});

describe('FeatureTreeModel edit lock', () => {
  /** Calls every command that changes the document or starts an edit; none may throw. */
  function tryAll(s: ReturnType<typeof setup>): void {
    s.tree.beginRename(fid('a'));
    s.tree.rename(fid('a'), 'Renamed');
    s.tree.moveRollbackBar(0);
    expect(s.tree.move(fid('a'), 2)).toEqual([]);
  }

  it('read-only: rename, beginRename, moveRollbackBar and move do nothing and do not throw', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aBox('c')] }, undefined, true);
    const studio = s.doc.studio;
    expect(() => {
      tryAll(s);
    }).not.toThrow();
    expect(s.doc.studio).toBe(studio);
    expect(s.ops.sent).toEqual([]);
    expect(s.tree.renaming.get()).toBeNull();
    expect(s.tree.rollbackIndex.get()).toBe(3);
  });

  it('an open dialog: the commands do nothing and do not throw', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aBox('c')] });
    s.tree.edit(fid('c'));
    const studio = s.doc.studio;
    expect(() => {
      tryAll(s);
    }).not.toThrow();
    expect(s.doc.studio).toBe(studio);
    expect(s.tree.renaming.get()).toBeNull();

    s.editor.current.get()?.cancel();
    // Only the dialog sent something: its begin and abort.
    expect(s.ops.sent.map((c) => c.kind)).toEqual(['begin', 'abort']);
  });

  it('the lock turning on ends the rename mode, turning off does not start it again', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    s.tree.beginRename(fid('a'));
    let emits = 0;
    s.tree.renaming.subscribe(() => {
      emits++;
    });

    s.tree.edit(fid('b'));
    expect(s.tree.renaming.get()).toBeNull();
    expect(emits).toBe(1);

    s.editor.current.get()?.cancel();
    expect(s.tree.renaming.get()).toBeNull();
    expect(emits).toBe(1);
    expect(s.ops.ops()).toEqual([]);
  });

  it('after dispose the lock no longer ends the rename mode', () => {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    s.tree.beginRename(fid('a'));
    s.tree.dispose();
    s.editor.edit(fid('b'));
    expect(s.tree.renaming.get()).toBe('a');
  });
});

describe('FeatureTreeModel.edit of a sketch (M12)', () => {
  /** A sketch feature; the tree routes by type only, so no sketch schema is needed. */
  const aSketch = (id: string) =>
    aFeature({ id, name: `Sketch ${id}`, type: SKETCH_FEATURE_TYPE, params: {} });

  it('sends a sketch to sketchEdit and opens no feature dialog', () => {
    const edited: FeatureId[] = [];
    const s = setup({ features: [aBox('a'), aSketch('s')] }, (id) => edited.push(id));
    s.tree.edit(fid('s'));
    expect(edited).toEqual([fid('s')]);
    expect(s.editor.current.get()).toBeNull();
  });

  it('sends other features to FeatureEditor.edit', () => {
    const edited: FeatureId[] = [];
    const s = setup({ features: [aBox('a'), aSketch('s')] }, (id) => edited.push(id));
    s.tree.edit(fid('a'));
    expect(edited).toEqual([]);
    expect(s.editor.current.get()?.featureId).toBe(fid('a'));
  });

  it('does nothing while locked: read-only or an open dialog', () => {
    const edited: FeatureId[] = [];
    const readOnly = setup({ features: [aBox('a'), aSketch('s')] }, (id) => edited.push(id), true);
    readOnly.tree.edit(fid('a'));
    readOnly.tree.edit(fid('s'));
    expect(readOnly.editor.current.get()).toBeNull();
    const open = setup({ features: [aBox('a'), aBox('b'), aSketch('s')] }, (id) => edited.push(id));
    open.tree.edit(fid('a'));
    open.tree.edit(fid('b'));
    open.tree.edit(fid('s'));
    expect(open.editor.current.get()?.featureId).toBe(fid('a'));
    expect(edited).toEqual([]);
  });

  it('without sketchEdit edits a sketch like any feature', () => {
    const s = setup({ features: [aSketch('s')] });
    // No sketch schema is registered, so FeatureEditor.edit throws: proof it was called.
    expect(() => {
      s.tree.edit(fid('s'));
    }).toThrow();
  });
});

describe('FeatureTreeModel draft and error count (D6 of M19.2)', () => {
  const tooFew = { param: 'profile', code: 'param.tooFewRefs', params: { min: 1 } };
  const missingInput = (): FeatureHealth => ({
    kind: 'error',
    message: 'profile: param.tooFewRefs',
    issues: [tooFew],
  });

  it('a new feature without its required references is draft, not an error', () => {
    const s = setup({ features: [aBox('a')] });
    const session = s.editor.create('ext');
    serveAdded(s);
    s.regen.publish(
      new Map([
        [fid('a'), ok],
        [session.featureId, missingInput()],
      ]),
    );

    expect(s.tree.rows.get()[1]).toMatchObject({
      status: 'draft',
      message: null,
      issues: null,
      detail: null,
    });
    expect(s.tree.errorCount.get()).toBe(0);
  });

  it('after the session ends the same health is an error again', () => {
    const s = setup();
    const session = s.editor.create('ext');
    serveAdded(s);
    s.regen.publish(new Map([[session.featureId, missingInput()]]));
    expect(s.tree.rows.get()[0]?.status).toBe('draft');

    session.commit();
    expect(s.tree.rows.get()[0]).toMatchObject({ status: 'error', issues: [tooFew] });
    expect(s.tree.errorCount.get()).toBe(1);
  });

  it('editing an existing feature with a missing reference is an error, never draft', () => {
    const s = setup({
      features: [aFeature<ExtParams>({ id: 'e', name: 'E', type: 'ext', params: { profile: [] } })],
    });
    s.tree.edit(fid('e'));
    s.regen.publish(new Map([[fid('e'), missingInput()]]));
    expect(s.tree.rows.get()[0]?.status).toBe('error');
    expect(s.tree.errorCount.get()).toBe(1);
  });

  it('another error of a new feature stays an error', () => {
    const s = setup();
    const session = s.editor.create('ext');
    serveAdded(s);
    const kernel = { param: '', code: 'kernel.operationFailed' };
    s.regen.publish(
      new Map([[session.featureId, { kind: 'error', message: 'BRep failed', issues: [kernel] }]]),
    );
    expect(s.tree.rows.get()[0]?.status).toBe('error');

    // Not all issues are missing references.
    s.regen.publish(
      new Map([
        [
          session.featureId,
          { kind: 'error', message: 'x', issues: [tooFew, { param: 'profile', code: 'other' }] },
        ],
      ]),
    );
    expect(s.tree.rows.get()[0]?.status).toBe('error');

    // An error without issues.
    s.regen.publish(new Map([[session.featureId, { kind: 'error', message: 'boom' }]]));
    expect(s.tree.rows.get()[0]?.status).toBe('error');
    expect(s.tree.errorCount.get()).toBe(1);
  });

  it('errorCount counts the error rows only and follows the regeneration', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aBox('c')] });
    expect(s.tree.errorCount.get()).toBe(0);
    s.regen.publish(
      new Map<FeatureId, FeatureHealth>([
        [fid('a'), { kind: 'error', message: 'boom' }],
        [fid('b'), { kind: 'warning', message: 'thin' }],
        [fid('c'), { kind: 'error', message: 'boom' }],
      ]),
    );
    expect(s.tree.errorCount.get()).toBe(2);
    s.regen.publish(
      new Map([
        [fid('a'), ok],
        [fid('b'), ok],
        [fid('c'), ok],
      ]),
    );
    expect(s.tree.errorCount.get()).toBe(0);
  });
});

describe('FeatureTreeModel detail (D9 of M19.2)', () => {
  it('a row with translated issues keeps the technical message in detail', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aBox('c')] });
    const kernel = { param: '', code: 'kernel.operationFailed' };
    s.regen.publish(
      new Map<FeatureId, FeatureHealth>([
        [fid('a'), { kind: 'error', message: 'BRep_API: command not done', issues: [kernel] }],
        [fid('b'), { kind: 'error', message: 'boom' }],
        [fid('c'), { kind: 'warning', message: 'thin wall' }],
      ]),
    );
    expect(s.tree.rows.get().map((r) => [r.status, r.message, r.detail])).toEqual([
      ['error', null, 'BRep_API: command not done'],
      ['error', 'boom', null],
      ['warning', 'thin wall', null],
    ]);
  });

  it('an ok, pending, suppressed or rolled back row has no detail', () => {
    const s = setup({ features: [aBox('a'), aBox('b'), aBox('c')], rollbackIndex: 2 });
    suppress(s, 'b');
    expect(s.tree.rows.get().map((r) => r.detail)).toEqual([null, null, null]);
  });
});
