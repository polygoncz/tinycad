// The boolean scenario of M11 end to end over FakeKernel: a box, a cylinder through it and a
// boolean subtract of the two, wired like app does it (document, dispatcher, log, Regenerator,
// FeatureEditor, the feature tree and the built-in actions with a fake confirm). Checks the
// identity rule (the result keeps the id of the box), the confirm before deleting the cylinder,
// the unresolved reference after it, undo and replaying the log into a new document.

import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import {
  bodyId,
  createDocument,
  createFeatureSchemaRegistry,
  toData,
  type BodyRef,
  type DocumentId,
  type FeatureId,
} from '@/document';
import { booleanPlugin } from '@/features/boolean';
import { boxPlugin } from '@/features/box';
import { cylinderPlugin } from '@/features/cylinder';
import {
  ACTION_IDS,
  createActionRegistry,
  createBuiltInActions,
  createEditLock,
  createFeatureEditor,
  createFeatureTreeModel,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
  SELECT_TOOL,
  type ConfirmRequest,
} from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createFakeKernel } from '@/kernel/testing';
import {
  createOpHandlerRegistry,
  createOperationDispatcher,
  createOperationLog,
  createUndoManager,
  replayLog,
} from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { bodiesOf, createBuilderRegistry, createRegenerator, type RegenResult } from '@/regen';

const META = { id: 'scenario' as DocumentId, name: 'Scenario', createdAt: 0 }; // a test id is trusted

function setup() {
  const kernel = createFakeKernel();
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const toolRegistry = createToolRegistry();
  toolRegistry.register(SELECT_TOOL);
  // The plugins of the scenario directly: app (BUILT_IN_PLUGINS) needs the DOM types.
  registerPlugin(boxPlugin, { schemas, builders, tools: toolRegistry });
  registerPlugin(cylinderPlugin, { schemas, builders, tools: toolRegistry });
  registerPlugin(booleanPlugin, { schemas, builders, tools: toolRegistry });
  const doc = createDocument({ meta: META });
  const log = createOperationLog();
  const handlers = createOpHandlerRegistry({ schemas });
  const ops = createOperationDispatcher({ doc, handlers, log });
  const undo = createUndoManager({ dispatcher: ops, log });
  const regenerator = createRegenerator({ kernel, schemas, builders, now: () => 0 });
  const regen = new FakeRegenStatus();
  const selection = createSelectionModel({ regen });
  const ids = createSequentialIdGenerator('f');
  const editor = createFeatureEditor({ doc, ops, schemas, ids, translate: (key) => key });
  const locked = createEditLock({ readOnly: false, editor });
  const featureTree = createFeatureTreeModel({
    doc,
    ops,
    schemas,
    regen,
    editor,
    selection,
    locked,
  });
  const viewport = new FakeViewport();
  const actions = createActionRegistry();
  const tools = createToolManager({
    registry: toolRegistry,
    ctx: { viewport, selection, doc, ops, ids, features: editor },
    defaultToolId: SELECT_TOOL.id,
  });
  const confirms: ConfirmRequest[] = [];
  let answer = true;
  createBuiltInActions({
    registry: actions,
    doc,
    ops,
    undo,
    selection,
    featureTree,
    editor,
    tools,
    toolList: toolRegistry.all(),
    locked,
    camera: { fitAll: () => undefined },
    confirm: (request) => {
      confirms.push(request);
      return answer;
    },
  });

  /** Creates a feature of the type through the dialog with the given params, OK. */
  function add(type: string, params: Readonly<Record<string, unknown>>): FeatureId {
    const session = editor.create(type);
    for (const [name, value] of Object.entries(params)) session.setParam(name, value);
    session.commit();
    return session.featureId;
  }

  /** Regenerates the document and publishes the result to the port, like app. */
  async function regenerate(): Promise<RegenResult> {
    const result = await regenerator.run(doc.studio);
    if (result === 'superseded') expect.fail('Unexpected superseded run');
    regen.publish(
      new Map(),
      bodiesOf(result.finalState).map((b) => ({ body: b.id, feature: b.origin })),
    );
    return result;
  }

  return {
    doc,
    log,
    handlers,
    undo,
    editor,
    selection,
    actions,
    confirms,
    add,
    regenerate,
    setAnswer: (value: boolean): void => {
      answer = value;
    },
  };
}

const bodyRef = (feature: FeatureId): BodyRef => ({ kind: 'body', body: bodyId(feature) });

/** Box at the origin, a cylinder along z through it and a boolean subtract of the two. */
async function scenario() {
  const s = setup();
  const box = s.add('box', {});
  const cylinder = s.add('cylinder', { base: [5, 5, -1], radius: 2, height: 12 });
  // The cylinder exists only after a regeneration; references name it, not its shape.
  await s.regenerate();
  const boolean = s.add('boolean', {
    op: 'subtract',
    targets: [bodyRef(box)],
    tools: [bodyRef(cylinder)],
  });
  return { ...s, box, cylinder, boolean };
}

describe('boolean scenario (box, cylinder, subtract)', () => {
  it('leaves one body with the id of the box, last modified by the boolean', async () => {
    const { box, boolean, regenerate } = await scenario();

    const result = await regenerate();
    const bodies = bodiesOf(result.finalState);
    expect(bodies.map((b) => [b.id, b.origin, b.lastModifiedBy])).toEqual([
      [bodyId(box), box, boolean],
    ]);
    expect([...result.statuses.values()].map((s) => s.kind)).toEqual(['ok', 'ok', 'ok']);
  });

  it('keeps the id of the result when the radius of the cylinder changes', async () => {
    const { box, cylinder, editor, regenerate } = await scenario();
    const before = bodiesOf((await regenerate()).finalState).map((b) => b.id);

    const session = editor.edit(cylinder);
    session.setParam('radius', 3);
    session.commit();

    const after = await regenerate();
    expect(before).toEqual([bodyId(box)]);
    expect(bodiesOf(after.finalState).map((b) => b.id)).toEqual(before);
  });

  it('asks before deleting the cylinder, then the boolean loses its reference', async () => {
    const { box, cylinder, boolean, selection, actions, confirms, regenerate } = await scenario();
    await regenerate();

    selection.set([{ kind: 'feature', feature: cylinder }]);
    expect(actions.run(ACTION_IDS.featureDelete)).toBe(true);
    expect(confirms).toEqual([{ key: 'feature.delete.confirm', params: { n: 1 } }]);

    const result = await regenerate();
    expect(result.statuses.get(box)).toEqual({ kind: 'ok' });
    const status = result.statuses.get(boolean);
    if (status?.kind !== 'error') expect.fail('The boolean is not an error');
    expect(status.error.code).toBe('UNRESOLVED_REFERENCE');
    expect(status.error.issues).toEqual([{ param: 'tools', code: 'param.unresolvedRef' }]);
    expect(bodiesOf(result.finalState).map((b) => [b.id, b.lastModifiedBy])).toEqual([
      [bodyId(box), box],
    ]);
  });

  it('brings the cylinder and a healthy boolean back on undo', async () => {
    const { box, cylinder, boolean, doc, undo, selection, actions, regenerate } = await scenario();
    await regenerate();
    selection.set([{ kind: 'feature', feature: cylinder }]);
    actions.run(ACTION_IDS.featureDelete);
    await regenerate();

    undo.undo();
    expect(doc.studio.features.map((f) => f.id)).toEqual([box, cylinder, boolean]);
    const result = await regenerate();
    expect([...result.statuses.values()].map((s) => s.kind)).toEqual(['ok', 'ok', 'ok']);
    expect(bodiesOf(result.finalState).map((b) => [b.id, b.lastModifiedBy])).toEqual([
      [bodyId(box), boolean],
    ]);
  });

  it('deletes nothing when the user says no', async () => {
    const { cylinder, doc, log, selection, actions, confirms, setAnswer, regenerate } =
      await scenario();
    await regenerate();
    const entries = log.entries().length;
    setAnswer(false);

    selection.set([{ kind: 'feature', feature: cylinder }]);
    actions.run(ACTION_IDS.featureDelete);
    expect(confirms).toHaveLength(1);
    expect(doc.feature(cylinder)).toBeDefined();
    expect(log.entries()).toHaveLength(entries);
  });

  it('replays the log into a new document with the same data', async () => {
    const { doc, log, handlers, undo, selection, actions, cylinder, regenerate } = await scenario();
    await regenerate();
    selection.set([{ kind: 'feature', feature: cylinder }]);
    actions.run(ACTION_IDS.featureDelete);
    undo.undo();

    const copy = createDocument({ meta: META });
    replayLog(copy, handlers, log.entries());
    expect(toData(copy)).toEqual(toData(doc));
  });
});
