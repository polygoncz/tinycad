import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import {
  ORIGIN_AXIS_IDS,
  bodyId,
  createFeatureSchemaRegistry,
  toData,
  validateAgainstSchema,
} from '@/document';
import type {
  FeatureId,
  FeatureSchema,
  ParamSchema,
  ParamSchemaOf,
  TopoName,
  TopoRef,
} from '@/document';
import { aFeature } from '@/document/testing';
import type { DocumentOptions } from '@/document/testing';
import type { BatchOp, FeatureAddOp, Operation } from '@/ops';
import { OP_VERSION } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import { createFeatureEditor } from '@/interaction/feature-dialog/feature-editor';
import type { EditState } from '@/interaction/feature-dialog/feature-editor';
import type { RegenSketch } from '@/interaction/regen-status-port';
import { createSelectionModel } from '@/interaction/selection';
import { FakeRegenStatus } from '@/interaction/testing';

interface BoxParams {
  readonly width: number;
  readonly height: number;
  readonly targets: readonly unknown[];
}

const BOX_PARAMS: ParamSchemaOf<BoxParams> = {
  width: { kind: 'length', label: 'box.width', default: 10, min: 0, exclusiveMin: true },
  height: { kind: 'length', label: 'box.height', default: 20, min: 0, exclusiveMin: true },
  targets: { kind: 'bodies', label: 'box.targets' },
};

const BOX: FeatureSchema<BoxParams> = {
  type: 'box',
  version: 1,
  label: 'box.label',
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

/** Translates the box label to English, so the names below read 'Box 1'. */
const EN = (key: string): string => (key === 'box.label' ? 'Box' : key);

/** `translate: null` leaves it out of the deps. */
function setup(
  init: DocumentOptions = {},
  translate: ((key: string) => string) | null = EN,
  schema: FeatureSchema = BOX,
) {
  const schemas = createFeatureSchemaRegistry();
  schemas.register(schema);
  // The handlers migrate with the same schemas, as in the app (Q035).
  const session = anOpsSession({ ...init, schemas });
  const editor = createFeatureEditor({
    doc: session.doc,
    ops: session.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('new'),
    ...(translate === null ? {} : { translate }),
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
    // The first reference param takes the selection right away (R19).
    expect(state.activeRefParam).toBe('targets');
    expect(state.fields.map((f) => f.name)).toEqual(['width', 'height', 'targets']);
    expect(state.fields[0]).toEqual({
      name: 'width',
      spec: BOX_PARAMS.width,
      value: 10,
      issue: null,
      active: false,
      refs: null,
      hidden: false,
      group: null,
      heading: null,
      refText: null,
    });
    expect(state.fields[2]?.refs).toEqual([]);
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
    // The label of the transaction stays the key, translated only when shown (ADR 0014).
    expect(entry?.label).toBe('box.label');
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

  it('the state carries the generated name for the title of the dialog', () => {
    const { editor } = setup({ features: [aBox('b1', 'Box 1')] });
    const session = editor.create('box');
    expect(session.state.get().name).toBe('Box 2');
    session.cancel();
    // The feature is gone from the document; the last snapshot keeps its name.
    expect(session.state.get().name).toBe('Box 2');
  });

  it('names the feature in the language of translate', () => {
    const cs = (key: string): string => (key === 'box.label' ? 'Kvádr' : key);
    const { doc, editor } = setup({}, cs);
    editor.create('box').commit();
    expect(doc.feature(fid('new1'))?.name).toBe('Kvádr 1');
  });

  it('names the feature by the key without translate', () => {
    const { doc, log, editor } = setup({}, null);
    editor.create('box').commit();
    expect(doc.feature(fid('new1'))?.name).toBe('box.label 1');
    expect(log.entries()[0]?.label).toBe('box.label');
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

describe('FeatureEditor initial reference param (R19)', () => {
  const REFS: ParamSchema = {
    width: { kind: 'length', label: 'w', default: 1 },
    faces: { kind: 'topo', label: 'faces', entity: 'face' },
    targets: { kind: 'bodies', label: 'targets' },
    profile: { kind: 'region', label: 'profile' },
  };
  const REF_SCHEMA: FeatureSchema = {
    type: 'refs',
    version: 1,
    label: 'refs.label',
    params: REFS,
    defaults: () => ({ width: 1, faces: [], targets: [], profile: [] }),
    validate: () => [],
  };
  const PLAIN: FeatureSchema = {
    type: 'plain',
    version: 1,
    label: 'plain.label',
    params: { width: { kind: 'length', label: 'w', default: 1 } },
    defaults: () => ({ width: 1 }),
    validate: () => [],
  };

  it('create activates the first bodies, topo or region param in schema order', () => {
    const { editor } = setup({}, EN, REF_SCHEMA);
    const state = editor.create('refs').state.get();
    expect(state.activeRefParam).toBe('faces');
    expect(state.fields.map((f) => f.active)).toEqual([false, true, false, false]);
  });

  it('create of a schema without reference params starts with null', () => {
    const { editor } = setup({}, EN, PLAIN);
    expect(editor.create('plain').state.get().activeRefParam).toBeNull();
  });

  // The sketch schema (M12): the plane is picked in the Browser, the sketch data has no field.
  const SKETCH_LIKE: FeatureSchema = {
    type: 'sketchLike',
    version: 1,
    label: 'sketchLike.label',
    params: {
      plane: { kind: 'planes', label: 'plane', min: 1, max: 1 },
      sketch: { kind: 'data', label: 'sketch' },
    },
    defaults: () => ({ plane: [], sketch: {} }),
    validate: () => [],
  };

  it('create does not activate a planes param (M12)', () => {
    const { editor } = setup({}, EN, SKETCH_LIKE);
    expect(editor.create('sketchLike').state.get().activeRefParam).toBeNull();
  });

  it('focusRefParam accepts a planes param (M21) but not a data param', () => {
    const { editor } = setup({}, EN, SKETCH_LIKE);
    const session = editor.create('sketchLike');
    session.focusRefParam('plane');
    expect(session.state.get().activeRefParam).toBe('plane');
    expect(() => {
      session.focusRefParam('sketch');
    }).toThrow();
    expect(session.state.get().activeRefParam).toBe('plane');
  });

  it('edit starts with null', () => {
    const { editor } = setup({ features: [aBox('a')] });
    const state = editor.edit(fid('a')).state.get();
    expect(state.activeRefParam).toBeNull();
    expect(state.fields.every((f) => !f.active)).toBe(true);
  });
});

describe('FeatureEditor.create preselects the only region (D6 of M19.2)', () => {
  const EXT_PARAMS: ParamSchema = {
    profile: { kind: 'region', label: 'profile', min: 1 },
    distance: { kind: 'length', label: 'distance', default: 10 },
  };
  const EXT: FeatureSchema = {
    type: 'ext',
    version: 1,
    label: 'ext.label',
    params: EXT_PARAMS,
    defaults: () => ({ profile: [], distance: 10 }),
    validate: (params) => validateAgainstSchema(EXT_PARAMS, params),
  };
  const sketch = (feature: string, regions: readonly string[]): RegenSketch => ({
    sketch: `${feature}/sketch` as RegenSketch['sketch'], // test ids are trusted
    feature: fid(feature),
    regions,
  });

  /** `withPorts: false` leaves regen out of the deps. */
  function setupWith(sketches: readonly RegenSketch[] | null, withPorts = true) {
    const schemas = createFeatureSchemaRegistry();
    schemas.register(EXT);
    schemas.register(BOX);
    const session = anOpsSession({ schemas });
    const regen = new FakeRegenStatus();
    if (sketches !== null) regen.publish(new Map(), [], sketches);
    const selection = createSelectionModel({ regen });
    const editor = createFeatureEditor({
      doc: session.doc,
      ops: session.dispatcher,
      schemas,
      ids: createSequentialIdGenerator('new'),
      ...(withPorts ? { regen } : {}),
    });
    return { ...session, editor, selection };
  }

  it('fills the region param when the last sketch has exactly one region', () => {
    const { editor, doc } = setupWith([sketch('s0', ['a', 'b']), sketch('s1', ['r1'])]);
    const session = editor.create('ext');
    const profile = [{ kind: 'region', sketch: 's1', region: 'r1' }];
    expect(doc.feature(session.featureId)?.params).toEqual({ profile, distance: 10 });
    expect(session.state.get().params['profile']).toEqual(profile);
    expect(session.state.get().issues).toEqual([]);
    // The focus stays on the region, so another click adds or removes one.
    expect(session.state.get().activeRefParam).toBe('profile');
  });

  it('after the preselection the commit writes one feature.add', () => {
    const { editor, log } = setupWith([sketch('s1', ['r1'])]);
    editor.create('ext').commit();
    const ops = loggedOps(log.entries().map((e) => e.op));
    expect(log.entries()).toHaveLength(1);
    expect(ops.map((op) => op.type)).toEqual(['feature.add']);
  });

  it('does not preselect with two regions in the last sketch', () => {
    const { editor, doc } = setupWith([sketch('s0', ['r0']), sketch('s1', ['r1', 'r2'])]);
    const session = editor.create('ext');
    expect(doc.feature(session.featureId)?.params).toEqual({ profile: [], distance: 10 });
  });

  // The sketch just finished stays selected; a selection never holds a region, so it does not
  // stand in the way (the case of e2e m13: Finish, then Extrude).
  it('preselects with something else selected', () => {
    const { editor, doc, selection } = setupWith([sketch('s1', ['r1'])]);
    selection.set([{ kind: 'feature', feature: fid('x') }]);
    const session = editor.create('ext');
    expect(doc.feature(session.featureId)?.params).toEqual({
      profile: [{ kind: 'region', sketch: 's1', region: 'r1' }],
      distance: 10,
    });
  });

  it('does not preselect without a snapshot or without the ports', () => {
    const none = setupWith(null).editor.create('ext');
    expect(none.state.get().params['profile']).toEqual([]);
    const noPorts = setupWith([sketch('s1', ['r1'])], false).editor.create('ext');
    expect(noPorts.state.get().params['profile']).toEqual([]);
  });

  it('does not preselect for a feature whose first reference param is not a region', () => {
    const { editor, doc } = setupWith([sketch('s1', ['r1'])]);
    const session = editor.create('box');
    expect(doc.feature(session.featureId)?.params).toEqual({ width: 10, height: 20, targets: [] });
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

  it('the state carries the name of the edited feature', () => {
    const { editor } = setup({ features: [aBox('a', 'Box 7')] });
    const session = editor.edit(fid('a'));
    expect(session.state.get().name).toBe('Box 7');
    session.commit();
    expect(session.state.get().name).toBe('Box 7');
  });

  it('labels the entry with the key feature.edit, without the feature name (ADR 0014)', () => {
    const { log, editor } = setup({ features: [aBox('a', 'Box 7')] });
    const session = editor.edit(fid('a'));
    session.setParam('width', 3);
    session.commit();
    expect(log.entries().map((e) => e.label)).toEqual(['feature.edit']);
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

  it('setParam sends the version of the schema with the params (Q035)', () => {
    // Version 3: the op must carry the schema version, not a constant 1.
    const v3: FeatureSchema<BoxParams> = { ...BOX, version: 3, migrate: () => BOX.defaults() };
    const { doc, log, editor } = setup({}, EN, v3);
    const session = editor.create('box');
    session.setParam('width', 5);
    session.commit();

    const ops = loggedOps(log.entries().map((e) => e.op));
    expect(ops.find((op) => op.type === 'feature.setParams')).toEqual({
      type: 'feature.setParams',
      v: OP_VERSION['feature.setParams'],
      featureId: 'new1',
      typeVersion: 3,
      params: { width: 5, height: 20, targets: [] },
    });
    expect(doc.feature(fid('new1'))).toMatchObject({ typeVersion: 3, params: { width: 5 } });
  });

  it('an invalid value is applied and shows in issues and FieldState.issue', () => {
    const { doc, editor } = setup();
    const session = editor.create('box');
    session.setParam('width', -1);

    expect(doc.feature(fid('new1'))?.params).toMatchObject({ width: -1 });
    const state = session.state.get();
    const issue = { param: 'width', code: 'param.atOrBelowMin', params: { min: 0 } };
    expect(state.issues).toEqual([issue]);
    expect(state.fields[0]?.issue).toEqual(issue);
    expect(state.fields[0]?.issue).toBe(state.issues[0]);
    expect(Object.isFrozen(state.fields[0]?.issue?.params)).toBe(true);
    expect(state.fields[1]?.issue).toBeNull();
  });

  it('a field with the same issue after another change stays the same object', () => {
    const { editor } = setup();
    const session = editor.create('box');
    session.setParam('width', -1);
    const before = session.state.get();
    session.setParam('height', 7);

    const state = session.state.get();
    expect(state.issues).toBe(before.issues);
    expect(state.fields[0]).toBe(before.fields[0]);
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
    const { editor } = setup({ features: [aBox('a')] });
    const session = editor.edit(fid('a'));
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

  it.each(['commit', 'cancel'] as const)(
    'a subscriber that throws on %s still closes the session; its error goes on',
    (end) => {
      const { editor } = setup();
      const session = editor.create('box');
      session.state.subscribe(() => {
        if (!session.state.get().open) throw new Error('subscriber failed');
      });

      expect(() => {
        session[end]();
      }).toThrow('subscriber failed');

      expect(session.state.get().open).toBe(false);
      expect(editor.current.get()).toBeNull();
      const second = editor.create('box');
      expect(editor.current.get()).toBe(second);
    },
  );

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

describe('FeatureEditSession.setParams (M12)', () => {
  it('applies several params with one feature.setParams', () => {
    const { dispatcher, editor } = setup({ features: [aBox('a')] });
    const session = editor.edit(fid('a'));
    const applied: Operation[] = [];
    dispatcher.events.on('applied', ({ op }) => applied.push(op));
    let emits = 0;
    session.state.subscribe(() => emits++);

    session.setParams({ width: 5, height: 6 });

    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      type: 'feature.setParams',
      featureId: 'a',
      typeVersion: 1,
      params: { width: 5, height: 6, targets: [] },
    });
    expect(session.state.get().params).toEqual({ width: 5, height: 6, targets: [] });
    expect(emits).toBe(1);
  });

  it('create -> setParams -> commit writes one entry batch[feature.add, feature.setParams]', () => {
    const { log, editor } = setup();
    const session = editor.create('box');
    session.setParams({ width: 1 });
    session.setParams({ width: 2, height: 3 });
    session.commit();

    const entries = log.entries();
    expect(entries).toHaveLength(1);
    const ops = (entries[0]?.op as BatchOp).ops; // the entry of create is a batch
    expect(ops.map((op) => op.type)).toEqual(['feature.add', 'feature.setParams']);
    expect(ops[1]).toMatchObject({ params: { width: 2, height: 3, targets: [] } });
  });

  it('an unknown key throws and applies nothing', () => {
    const { dispatcher, editor } = setup();
    const session = editor.create('box');
    const applied: Operation[] = [];
    dispatcher.events.on('applied', ({ op }) => applied.push(op));
    const before = session.state.get();

    expect(() => {
      session.setParams({ width: 3, depth: 1 });
    }).toThrow();
    expect(applied).toEqual([]);
    expect(session.state.get()).toBe(before);
  });

  it('applies nothing when all values are the same', () => {
    const { dispatcher, editor } = setup();
    const session = editor.create('box');
    const applied: Operation[] = [];
    dispatcher.events.on('applied', ({ op }) => applied.push(op));
    let emits = 0;
    session.state.subscribe(() => emits++);

    session.setParams({ width: 10, height: 20 });
    session.setParams({});

    expect(applied).toEqual([]);
    expect(emits).toBe(0);
  });

  it('throws after closing', () => {
    const { editor } = setup();
    const session = editor.create('box');
    session.cancel();
    expect(() => {
      session.setParams({ width: 1 });
    }).toThrow();
  });
});

describe('FeatureEditSession reference chips (FieldState.refs)', () => {
  const A = bodyId(fid('a'));
  const B2 = bodyId(fid('b'), 2);
  /** The text of a chip of a missing body ("Chybí těleso"), from the presenter (M19.1 Ú13a). */
  const MISSING_BODY = { key: 'field.refs.missing', params: {} };

  function withTargets(targets: readonly unknown[]) {
    const s = setup({ features: [aBox('a', 'Box 1'), aBox('b', 'Box 2')] });
    const session = s.editor.create('box');
    session.setParam('targets', targets);
    return { ...s, session };
  }

  const targetsOf = (session: { state: { get(): { fields: readonly { refs: unknown }[] } } }) =>
    session.state.get().fields[2]?.refs;

  it('lists each item with its index, body and label', () => {
    const { session } = withTargets([
      { kind: 'body', body: A },
      { kind: 'body', body: B2 },
    ]);
    const refs = targetsOf(session);
    expect(refs).toEqual([
      { index: 0, body: A, label: 'Box 1', text: null, missing: false },
      { index: 1, body: B2, label: 'Box 2 (2)', text: null, missing: false },
    ]);
    expect(Object.isFrozen(refs)).toBe(true);
    expect(Array.isArray(refs) && refs.every((r) => Object.isFrozen(r))).toBe(true);
  });

  it('an item of an invalid shape has body and label null and the missing text; a non-array is empty', () => {
    const { session } = withTargets([
      'junk',
      { kind: 'body', body: 'a' },
      { kind: 'body', body: A },
    ]);
    expect(targetsOf(session)).toEqual([
      { index: 0, body: null, label: null, text: MISSING_BODY, missing: true },
      { index: 1, body: null, label: null, text: MISSING_BODY, missing: true },
      { index: 2, body: A, label: 'Box 1', text: null, missing: false },
    ]);
    session.setParam('targets', 'junk');
    expect(targetsOf(session)).toEqual([]);
  });

  it('a missing body: the chip has the text field.refs.missing instead of a label', () => {
    const { session } = withTargets([{ kind: 'body', body: bodyId(fid('gone')) }]);
    expect(targetsOf(session)).toEqual([
      { index: 0, body: 'gone/body', label: null, text: MISSING_BODY, missing: true },
    ]);
  });

  it('a chip has exactly one of a label (a name from the user) and a text (a key)', () => {
    const { session } = withTargets([
      'junk',
      { kind: 'body', body: A },
      { kind: 'body', body: bodyId(fid('gone')) },
    ]);
    const refs = session.state.get().fields[2]?.refs ?? [];
    expect(refs).toHaveLength(3);
    for (const ref of refs) expect((ref.label === null) !== (ref.text === null)).toBe(true);
  });

  it('follows a change of the body metadata in the document', () => {
    const { doc, session } = withTargets([{ kind: 'body', body: A }]);
    const before = session.state.get();
    doc.setBodyMeta(A, { name: 'Base' });
    const state = session.state.get();
    expect(state.fields[2]?.refs).toEqual([
      { index: 0, body: A, label: 'Base', text: null, missing: false },
    ]);
    expect(state.fields[0]).toBe(before.fields[0]);
  });

  it('a document change that keeps the labels keeps the field and the snapshot', () => {
    const { doc, session } = withTargets([{ kind: 'body', body: A }]);
    const before = session.state.get();
    let emits = 0;
    session.state.subscribe(() => emits++);
    doc.setBodyMeta(bodyId(fid('b')), { hidden: true });
    expect(session.state.get()).toBe(before);
    expect(emits).toBe(0);
  });

  it('stops following the document once the session is closed', () => {
    const { doc, session } = withTargets([{ kind: 'body', body: A }]);
    session.commit();
    const closed = session.state.get();
    doc.setBodyMeta(A, { name: 'Base' });
    expect(session.state.get()).toBe(closed);
  });
});

describe('FeatureEditSession topo chips (FieldState.refs, D5 of M19.1)', () => {
  const TOPO_PARAMS: ParamSchema = {
    edges: { kind: 'topo', label: 'edges', entity: 'edge' },
    faces: { kind: 'topo', label: 'faces', entity: 'face' },
    points: { kind: 'topo', label: 'points', entity: 'vertex' },
    targets: { kind: 'bodies', label: 'targets' },
  };
  const TOPO_SCHEMA: FeatureSchema = {
    type: 'topoLike',
    version: 1,
    label: 'topoLike.label',
    params: TOPO_PARAMS,
    defaults: () => ({ edges: [], faces: [], points: [], targets: [] }),
    validate: () => [],
  };
  const A = bodyId(fid('a'));

  // Test data: the names stand for names minted by propagateNames; the chip never reads them.
  const topo = (name: string): TopoRef => ({ kind: 'topo', body: A, name: name as TopoName });
  const E1 = topo('edge:a/face:front|a/face:top');
  const E2 = topo('edge:a/face:back|a/face:top');

  function withParams(params: Readonly<Record<string, unknown>>) {
    const s = setup({ features: [aBox('a', 'Box 1')] }, EN, TOPO_SCHEMA);
    const session = s.editor.create('topoLike');
    session.setParams(params);
    return { ...s, session };
  }

  const refsOf = (session: { state: { get(): EditState } }, name: string) =>
    session.state.get().fields.find((f) => f.name === name)?.refs;

  it('lists two edges as ordinal chips with the body and no label', () => {
    const { session } = withParams({ edges: [E1, E2] });
    const refs = refsOf(session, 'edges');
    expect(refs).toEqual([
      {
        index: 0,
        body: A,
        label: null,
        text: { key: 'ref.edge', params: { n: '1' } },
        missing: false,
      },
      {
        index: 1,
        body: A,
        label: null,
        text: { key: 'ref.edge', params: { n: '2' } },
        missing: false,
      },
    ]);
    expect(Object.isFrozen(refs)).toBe(true);
    for (const ref of refs ?? []) {
      expect(Object.isFrozen(ref)).toBe(true);
      expect(Object.isFrozen(ref.text)).toBe(true);
      expect(Object.isFrozen(ref.text?.params)).toBe(true);
    }
  });

  it('takes the key from the entity of the param, faces and vertices too', () => {
    const { session } = withParams({ faces: [topo('a/face:top')], points: [topo('vertex:x')] });
    expect(refsOf(session, 'faces')).toEqual([
      {
        index: 0,
        body: A,
        label: null,
        text: { key: 'ref.face', params: { n: '1' } },
        missing: false,
      },
    ]);
    expect(refsOf(session, 'points')).toEqual([
      {
        index: 0,
        body: A,
        label: null,
        text: { key: 'ref.vertex', params: { n: '1' } },
        missing: false,
      },
    ]);
  });

  it('an item that is not a topo reference is a missing chip; a non-array is empty', () => {
    const { session } = withParams({
      edges: ['junk', { kind: 'topo', body: 'a', name: 'e' }, { kind: 'body', body: A }, E1],
    });
    const missing = { key: 'field.missingRef', params: {} };
    expect(refsOf(session, 'edges')).toEqual([
      { index: 0, body: null, label: null, text: missing, missing: true },
      { index: 1, body: null, label: null, text: missing, missing: true },
      { index: 2, body: null, label: null, text: missing, missing: true },
      {
        index: 3,
        body: A,
        label: null,
        text: { key: 'ref.edge', params: { n: '4' } },
        missing: false,
      },
    ]);
    session.setParam('edges', 'junk');
    expect(refsOf(session, 'edges')).toEqual([]);
  });

  it('removeRef removes one of two edges and the chips follow', () => {
    const { doc, session } = withParams({ edges: [E1, E2] });

    session.removeRef('edges', 0);

    expect(doc.feature(fid('new1'))?.params).toMatchObject({ edges: [E2] });
    expect(refsOf(session, 'edges')).toEqual([
      {
        index: 0,
        body: A,
        label: null,
        text: { key: 'ref.edge', params: { n: '1' } },
        missing: false,
      },
    ]);
  });

  it('keeps the chips and the field when a change elsewhere leaves them equal', () => {
    const { doc, session } = withParams({ edges: [E1, E2] });
    const before = session.state.get().fields[0];
    session.setParam('faces', [topo('a/face:top')]);
    doc.setBodyMeta(A, { name: 'Base' });
    expect(session.state.get().fields[0]).toBe(before);
  });

  it('a bodies param keeps its chips without a text', () => {
    const { session } = withParams({ targets: [{ kind: 'body', body: A }] });
    expect(refsOf(session, 'targets')).toEqual([
      { index: 0, body: A, label: 'Box 1', text: null, missing: false },
    ]);
  });
});

describe('FeatureEditSession.removeRef', () => {
  const A = bodyId(fid('a'));
  const B = bodyId(fid('b'));

  function withTargets(targets: readonly unknown[]) {
    const s = setup({ features: [aBox('a'), aBox('b')] });
    const session = s.editor.create('box');
    session.setParam('targets', targets);
    return { ...s, session };
  }

  it('removes the item at the index through setParam', () => {
    const { doc, session } = withTargets([
      { kind: 'body', body: A },
      'junk',
      { kind: 'body', body: B },
    ]);
    session.removeRef('targets', 1);
    expect(doc.feature(fid('new1'))?.params).toMatchObject({
      targets: [
        { kind: 'body', body: A },
        { kind: 'body', body: B },
      ],
    });
    session.removeRef('targets', 0);
    expect(session.state.get().params['targets']).toEqual([{ kind: 'body', body: B }]);
  });

  it('an index out of range or a non-array value does nothing', () => {
    const { dispatcher, session } = withTargets([{ kind: 'body', body: A }]);
    const applied: Operation[] = [];
    dispatcher.events.on('applied', ({ op }) => applied.push(op));
    session.removeRef('targets', 1);
    session.removeRef('targets', -1);
    session.removeRef('targets', 0.5);
    session.setParam('targets', 'junk');
    applied.length = 0;
    session.removeRef('targets', 0);
    expect(applied).toEqual([]);
  });

  it('does nothing once the session is closed', () => {
    const { doc, session } = withTargets([{ kind: 'body', body: A }]);
    session.commit();
    expect(() => {
      session.removeRef('targets', 0);
    }).not.toThrow();
    expect(doc.feature(fid('new1'))?.params).toMatchObject({
      targets: [{ kind: 'body', body: A }],
    });
  });

  it('an unknown param throws', () => {
    const { session } = withTargets([]);
    expect(() => {
      session.removeRef('depth', 0);
    }).toThrow();
  });
});

// --- M13: conditional and grouped params, the axis param (spec 03, spec 10) ---

interface ExtrudeLikeParams {
  readonly operation: string;
  readonly targets: readonly unknown[];
  readonly regions: readonly unknown[];
  readonly endType: string;
  readonly distance: number;
  readonly axis: unknown;
}

const EXTRUDE_LIKE_PARAMS: ParamSchemaOf<ExtrudeLikeParams> = {
  operation: {
    kind: 'enum',
    label: 'x.operation',
    default: 'new',
    options: [
      { value: 'new', label: 'x.new' },
      { value: 'add', label: 'x.add' },
    ],
  },
  targets: {
    kind: 'bodies',
    label: 'x.targets',
    min: 1,
    group: 'x.group.merge',
    visibleWhen: (p) => p['operation'] !== 'new',
  },
  regions: { kind: 'region', label: 'x.regions', min: 1 },
  endType: {
    kind: 'enum',
    label: 'x.endType',
    default: 'blind',
    options: [
      { value: 'blind', label: 'x.blind' },
      { value: 'symmetric', label: 'x.symmetric' },
    ],
  },
  distance: {
    kind: 'length',
    label: 'x.distance',
    default: 10,
    visibleWhen: (p) => p['endType'] === 'blind',
  },
  axis: { kind: 'axis', label: 'x.axis' },
};

const EXTRUDE_LIKE: FeatureSchema<ExtrudeLikeParams> = {
  type: 'xlike',
  version: 1,
  label: 'x.label',
  params: EXTRUDE_LIKE_PARAMS,
  defaults: () => ({
    operation: 'new',
    targets: [],
    regions: [],
    endType: 'blind',
    distance: 10,
    axis: null,
  }),
  validate: (params) => validateAgainstSchema(EXTRUDE_LIKE_PARAMS, params),
};

function setupExtrudeLike(init: DocumentOptions = {}) {
  return setup(init, null, EXTRUDE_LIKE);
}

const fieldOf = (session: { state: { get(): EditState } }, name: string) =>
  session.state.get().fields.find((f) => f.name === name);

describe('FeatureEditSession conditional params (M13)', () => {
  it('hidden and group follow the predicates of the schema', () => {
    const { editor } = setupExtrudeLike();
    const session = editor.create('xlike');

    expect(fieldOf(session, 'targets')).toMatchObject({ hidden: true, group: 'x.group.merge' });
    expect(fieldOf(session, 'distance')).toMatchObject({ hidden: false, group: null });
    expect(fieldOf(session, 'regions')).toMatchObject({ hidden: false, group: null });

    session.setParam('operation', 'add');
    expect(fieldOf(session, 'targets')?.hidden).toBe(false);
    session.setParam('endType', 'symmetric');
    expect(fieldOf(session, 'distance')?.hidden).toBe(true);
  });

  it('create focuses the first visible reference param', () => {
    const { editor } = setupExtrudeLike();
    const session = editor.create('xlike');
    // targets comes first but is hidden for 'new'.
    expect(session.state.get().activeRefParam).toBe('regions');
  });

  it('create focuses an axis param when it is the first visible reference param', () => {
    const params: ParamSchema = {
      width: { kind: 'length', label: 'w', default: 1 },
      axis: { kind: 'axis', label: 'a' },
    };
    const schema: FeatureSchema = {
      type: 'rev',
      version: 1,
      label: 'rev',
      params,
      defaults: () => ({ width: 1, axis: null }),
      validate: (p) => validateAgainstSchema(params, p),
    };
    const { editor } = setup({}, null, schema);
    expect(editor.create('rev').state.get().activeRefParam).toBe('axis');
  });

  it('a change that hides the focused param drops the focus', () => {
    const { editor } = setupExtrudeLike();
    const session = editor.create('xlike');
    session.setParam('operation', 'add');
    session.focusRefParam('targets');
    expect(fieldOf(session, 'targets')?.active).toBe(true);

    session.setParam('operation', 'new');

    expect(session.state.get().activeRefParam).toBeNull();
    expect(fieldOf(session, 'targets')).toMatchObject({ hidden: true, active: false });
  });

  it('focusRefParam of a hidden param throws; an axis param can be focused', () => {
    const { editor } = setupExtrudeLike();
    const session = editor.create('xlike');
    expect(() => {
      session.focusRefParam('targets');
    }).toThrow();
    expect(session.state.get().activeRefParam).toBe('regions');

    session.focusRefParam('axis');
    expect(session.state.get().activeRefParam).toBe('axis');
  });

  it('an unchanged field stays the same object, the new fields included', () => {
    const { editor } = setupExtrudeLike();
    const session = editor.create('xlike');
    session.setParam('axis', { kind: 'axis', axis: ORIGIN_AXIS_IDS.x });
    const before = session.state.get();

    session.setParam('distance', 5);

    const after = session.state.get();
    expect(fieldOf(session, 'axis')).toBe(before.fields.find((f) => f.name === 'axis'));
    expect(after.fields.find((f) => f.name === 'targets')).toBe(
      before.fields.find((f) => f.name === 'targets'),
    );
  });
});

describe('FeatureEditSession.refText (M13)', () => {
  const sketch = aFeature({
    id: 's1',
    type: 'sketch',
    name: 'Sketch 1',
    params: { entities: [], constraints: [] },
  });

  function withAxis(value: unknown) {
    const { editor } = setupExtrudeLike({ features: [sketch] });
    const session = editor.create('xlike');
    session.setParam('axis', value);
    return session;
  }

  it('an origin axis shows its label', () => {
    const session = withAxis({ kind: 'axis', axis: ORIGIN_AXIS_IDS.y });
    expect(fieldOf(session, 'axis')?.refText).toEqual({ key: 'origin.axis.y', params: {} });
  });

  it('a sketch entity shows the name of its sketch', () => {
    const session = withAxis({ kind: 'sketchEntity', sketch: 's1', entity: 'ab' });
    expect(fieldOf(session, 'axis')?.refText).toEqual({
      key: 'field.sketchLine',
      params: { sketch: 'Sketch 1' },
    });
  });

  it('a missing sketch or an unknown axis is a missing reference', () => {
    expect(
      fieldOf(withAxis({ kind: 'sketchEntity', sketch: 'gone', entity: 'ab' }), 'axis')?.refText,
    ).toEqual({ key: 'field.missingRef', params: {} });
    expect(fieldOf(withAxis({ kind: 'axis', axis: 'f9/axis:a' }), 'axis')?.refText).toEqual({
      key: 'field.missingRef',
      params: {},
    });
  });

  it('an invalid value is a missing reference, so the field can offer to clear it', () => {
    for (const junk of [
      { kind: 'axis', axis: 'junk' },
      { kind: 'sketchEntity', sketch: '', entity: 'ab' },
      { kind: 'sketchEntity', sketch: 'a/b', entity: 'ab' },
      { kind: 'region', sketch: 's1', region: 'r1' },
      'x',
      [],
    ]) {
      expect(fieldOf(withAxis(junk), 'axis')?.refText).toEqual({
        key: 'field.missingRef',
        params: {},
      });
    }
  });

  it('null, a missing value and the other kinds have no text', () => {
    expect(fieldOf(withAxis(null), 'axis')?.refText).toBeNull();
    expect(fieldOf(withAxis(null), 'regions')?.refText).toBeNull();
    // A missing value comes from a stored feature: writing undefined is refused (M19.1).
    const withoutAxis = {
      operation: 'new',
      targets: [],
      regions: [],
      endType: 'blind',
      distance: 10,
    };
    const stored = aFeature({ id: 'x1', type: 'xlike', params: withoutAxis });
    const { editor } = setupExtrudeLike({ features: [sketch, stored] });
    expect(fieldOf(editor.edit(fid('x1')), 'axis')).toMatchObject({
      name: 'axis',
      value: undefined,
      refText: null,
    });
  });
});

describe('FeatureEditSession headings (M13)', () => {
  // Groups g1, g2 with hidden fields and a field without a component ('data') in between.
  const PARAMS: ParamSchema = {
    plain: { kind: 'length', label: 'plain', default: 1 },
    data: { kind: 'data', label: 'data', group: 'g1' },
    a: { kind: 'length', label: 'a', default: 1, group: 'g1' },
    b: { kind: 'length', label: 'b', default: 1, group: 'g1' },
    hiddenG2: {
      kind: 'length',
      label: 'hiddenG2',
      default: 1,
      group: 'g2',
      visibleWhen: (p) => p['show'] === true,
    },
    c: { kind: 'length', label: 'c', default: 1, group: 'g2' },
    d: { kind: 'length', label: 'd', default: 1, group: 'g1' },
    none: { kind: 'length', label: 'none', default: 1 },
    e: { kind: 'length', label: 'e', default: 1, group: 'g1' },
    show: { kind: 'boolean', label: 'show', default: false },
  };
  const SCHEMA: FeatureSchema = {
    type: 'grouped',
    version: 1,
    label: 'grouped',
    params: PARAMS,
    defaults: () => ({ plain: 1, a: 1, b: 1, hiddenG2: 1, c: 1, d: 1, none: 1, e: 1, show: false }),
    validate: (p) => validateAgainstSchema(PARAMS, p),
  };
  const headings = (session: { state: { get(): EditState } }) =>
    Object.fromEntries(session.state.get().fields.map((f) => [f.name, f.heading]));

  it('the first visible field of a new group has the heading; data and hidden fields none', () => {
    const { editor } = setup({}, null, SCHEMA);
    const session = editor.create('grouped');

    expect(headings(session)).toEqual({
      plain: null,
      data: null,
      a: 'g1',
      b: null,
      hiddenG2: null,
      c: 'g2',
      d: 'g1',
      none: null,
      e: 'g1',
      show: null,
    });
  });

  it('a field that becomes visible takes the heading over', () => {
    const { editor } = setup({}, null, SCHEMA);
    const session = editor.create('grouped');

    session.setParam('show', true);

    expect(fieldOf(session, 'hiddenG2')?.heading).toBe('g2');
    expect(fieldOf(session, 'c')?.heading).toBeNull();
  });
});
