import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { DocumentId, FeatureId } from '@/document';
import { boxPlugin } from '@/features/box';
import type { ActionState, ToolDescriptor, ViewKeyEvent } from '@/interaction';
import { createMemoryDocumentStore } from '@/persistence';
import type { DocumentStore } from '@/persistence';
import { createManualScheduler } from '@/persistence/testing';
import type { FeaturePlugin } from '@/plugin-api';
import { createAppSession } from './index';
import type { AppSession, AppSessionDeps } from './index';
import { aKernelFactory, FakeAppViewport, settle } from './testing';

// Branded ids are created by a cast at one place in tests.
const DOC = 'doc1' as DocumentId;

interface Harness {
  readonly session: AppSession;
  readonly store: DocumentStore;
  readonly viewport: FakeAppViewport;
}

async function open(overrides: Partial<AppSessionDeps> = {}): Promise<Harness> {
  const store = overrides.store ?? createMemoryDocumentStore({ now: () => 0 });
  const viewport = new FakeAppViewport();
  const session = await createAppSession({
    plugins: [boxPlugin],
    store,
    docId: DOC,
    createKernel: aKernelFactory().create,
    viewport,
    scheduler: createManualScheduler(),
    now: () => 1_000_000,
    ids: createSequentialIdGenerator('f'),
    translate: (k) => k,
    readOnly: false,
    ...overrides,
  });
  await settle();
  return { session, store, viewport };
}

function addBox(session: AppSession, height = 10): FeatureId {
  const edit = session.features.create('box');
  edit.setParam('height', height);
  edit.commit();
  return edit.featureId;
}

function state(session: AppSession, id: string): ActionState {
  const found = session.actions.actions.get().find((a) => a.id === id);
  if (found === undefined) throw new Error(`No action '${id}'`);
  return found;
}

const enabled = (session: AppSession, id: string): boolean => state(session, id).enabled;

function selectFeature(session: AppSession, ...features: FeatureId[]): void {
  session.selection.set(features.map((feature) => ({ kind: 'feature', feature })));
}

const featureIds = (session: AppSession): FeatureId[] =>
  session.doc.studio.features.map((f) => f.id);

const key = (k: string, mods: Partial<ViewKeyEvent['mods']> = {}): ViewKeyEvent => ({
  key: k,
  mods: { shift: false, alt: false, mod: false, ...mods },
  inTextField: false,
});

/** A tool with a shortcut that finishes at once; the box plugin carries it. */
const lineTool: ToolDescriptor = {
  id: 'line',
  label: 'line.label',
  icon: 'line',
  group: 'sketch',
  shortcut: 'L',
  create: () => ({
    activate: (ctx) => {
      ctx.finish();
    },
    deactivate: () => undefined,
  }),
};
const withLineTool: FeaturePlugin = {
  ...boxPlugin,
  tools: [...(boxPlugin.tools ?? []), lineTool],
};

describe('built-in actions – registration', () => {
  it('registers the built-in actions with translation keys as labels and their shortcuts', async () => {
    const { session } = await open();
    const shortcuts = Object.fromEntries(
      session.actions.actions.get().map((a) => [a.id, a.shortcut]),
    );
    expect(shortcuts).toMatchObject({
      undo: 'Mod+Z',
      redo: 'Mod+Shift+Z',
      'feature.delete': 'Delete',
      'feature.suppress': 'S',
      'view.fitAll': 'F',
      'timeline.toStart': null,
      'timeline.stepBack': null,
      'timeline.stepForward': null,
      'timeline.toEnd': null,
    });
    for (const a of session.actions.actions.get()) expect(a.label).toBe(a.id);
  });

  it('registers an action for every tool with a shortcut, labelled by the tool', async () => {
    const { session, viewport } = await open({ plugins: [withLineTool] });

    expect(state(session, 'tool.line')).toMatchObject({ label: 'line.label', shortcut: 'L' });
    // Tools without a shortcut get no action.
    expect(session.actions.actions.get().map((a) => a.id)).not.toContain('tool.box');
    viewport.emitKey(key('l'));
    // The line tool finishes at once: activation went through and the default tool is back.
    expect(session.tools.active.get()).toBe('select');
    expect(session.actions.run('tool.line')).toBe(true);
  });

  it('tool actions are disabled while a feature edit session is open', async () => {
    const { session } = await open({ plugins: [withLineTool] });
    const edit = session.features.create('box');
    expect(enabled(session, 'tool.line')).toBe(false);
    edit.cancel();
    expect(enabled(session, 'tool.line')).toBe(true);
  });
});

describe('built-in actions – undo and redo', () => {
  it('undo and redo bring the document back and forth', async () => {
    const { session, viewport } = await open();
    expect(enabled(session, 'undo')).toBe(false);
    expect(enabled(session, 'redo')).toBe(false);
    addBox(session);
    expect(enabled(session, 'undo')).toBe(true);

    viewport.emitKey(key('z', { mod: true }));
    expect(session.doc.studio.features).toHaveLength(0);
    expect(enabled(session, 'undo')).toBe(false);
    expect(enabled(session, 'redo')).toBe(true);

    viewport.emitKey(key('Z', { mod: true, shift: true }));
    expect(session.doc.studio.features).toHaveLength(1);
    expect(enabled(session, 'redo')).toBe(false);
  });

  it('undo is disabled while a feature edit session is open', async () => {
    const { session } = await open();
    addBox(session);
    const edit = session.features.create('box');
    expect(enabled(session, 'undo')).toBe(false);
    expect(session.actions.run('undo')).toBe(false);
    edit.cancel();
    expect(enabled(session, 'undo')).toBe(true);
  });
});

describe('built-in actions – delete and suppress', () => {
  it('delete removes the selected feature as one undoable step', async () => {
    const { session, viewport } = await open();
    const a = addBox(session);
    const b = addBox(session);
    expect(enabled(session, 'feature.delete')).toBe(false);

    selectFeature(session, a);
    expect(enabled(session, 'feature.delete')).toBe(true);
    viewport.emitKey(key('Delete'));

    expect(featureIds(session)).toEqual([b]);
    expect(session.selection.items.get()).toEqual([]);
    expect(enabled(session, 'feature.delete')).toBe(false);
    session.actions.run('undo');
    expect(featureIds(session)).toEqual([a, b]);
  });

  it('delete removes every selected feature in one undoable step', async () => {
    const { session } = await open();
    const a = addBox(session);
    const b = addBox(session);
    const c = addBox(session);
    selectFeature(session, a, c);
    expect(session.actions.run('feature.delete')).toBe(true);
    expect(featureIds(session)).toEqual([b]);
    session.actions.run('undo');
    expect(featureIds(session)).toEqual([a, b, c]);
  });

  it('suppress toggles the selected feature', async () => {
    const { session, viewport } = await open();
    const a = addBox(session);
    expect(enabled(session, 'feature.suppress')).toBe(false);
    selectFeature(session, a);
    expect(enabled(session, 'feature.suppress')).toBe(true);

    viewport.emitKey(key('s'));
    expect(session.doc.feature(a)?.suppressed).toBe(true);
    viewport.emitKey(key('s'));
    expect(session.doc.feature(a)?.suppressed).toBe(false);
  });

  it('suppress of a mixed selection suppresses all, of a suppressed one unsuppresses all', async () => {
    const { session } = await open();
    const a = addBox(session);
    const b = addBox(session);
    selectFeature(session, a);
    session.actions.run('feature.suppress');
    selectFeature(session, a, b);

    session.actions.run('feature.suppress');
    expect(session.doc.studio.features.map((f) => f.suppressed)).toEqual([true, true]);
    session.actions.run('feature.suppress');
    expect(session.doc.studio.features.map((f) => f.suppressed)).toEqual([false, false]);
  });

  it('a selection without features enables neither delete nor suppress', async () => {
    const { session } = await open();
    addBox(session);
    await settle();
    const body = session.browser.bodies.get()[0]?.body ?? fail();
    session.selection.set([{ kind: 'body', body }]);
    expect(enabled(session, 'feature.delete')).toBe(false);
    expect(enabled(session, 'feature.suppress')).toBe(false);
  });

  it('delete and suppress are disabled while a feature edit session is open', async () => {
    const { session } = await open();
    const a = addBox(session);
    selectFeature(session, a);
    const edit = session.features.edit(a);
    expect(enabled(session, 'feature.delete')).toBe(false);
    expect(enabled(session, 'feature.suppress')).toBe(false);
    edit.cancel();
    expect(enabled(session, 'feature.delete')).toBe(true);
    expect(enabled(session, 'feature.suppress')).toBe(true);
  });
});

describe('built-in actions – timeline', () => {
  it('the steps move the rollback bar and are disabled at the ends', async () => {
    const { session } = await open();
    addBox(session);
    addBox(session);
    addBox(session);
    const bar = (): number => session.doc.studio.rollbackIndex;
    expect(bar()).toBe(3);
    expect(enabled(session, 'timeline.stepForward')).toBe(false);
    expect(enabled(session, 'timeline.toEnd')).toBe(false);

    session.actions.run('timeline.stepBack');
    expect(bar()).toBe(2);
    expect(enabled(session, 'timeline.stepForward')).toBe(true);
    session.actions.run('timeline.toStart');
    expect(bar()).toBe(0);
    expect(enabled(session, 'timeline.stepBack')).toBe(false);
    expect(enabled(session, 'timeline.toStart')).toBe(false);
    expect(session.actions.run('timeline.stepBack')).toBe(false);

    session.actions.run('timeline.stepForward');
    expect(bar()).toBe(1);
    session.actions.run('timeline.toEnd');
    expect(bar()).toBe(3);
  });

  it('an empty timeline has every step disabled', async () => {
    const { session } = await open();
    for (const id of [
      'timeline.toStart',
      'timeline.stepBack',
      'timeline.stepForward',
      'timeline.toEnd',
    ]) {
      expect(enabled(session, id)).toBe(false);
    }
  });

  it('the steps are disabled while a feature edit session is open', async () => {
    const { session } = await open();
    addBox(session);
    const edit = session.features.create('box');
    expect(enabled(session, 'timeline.stepBack')).toBe(false);
    edit.cancel();
    expect(enabled(session, 'timeline.stepBack')).toBe(true);
  });
});

describe('built-in actions – view', () => {
  it('fit all fits the camera', async () => {
    const { viewport } = await open();
    const before = viewport.fitAllCount;
    viewport.emitKey(key('f'));
    expect(viewport.fitAllCount).toBe(before + 1);
  });

  it('the first regeneration with a body fits the camera once', async () => {
    const { session, viewport } = await open();
    expect(viewport.fitAllCount).toBe(0);
    addBox(session);
    await settle();
    expect(viewport.fitAllCount).toBe(1);
    addBox(session);
    await settle();
    expect(viewport.fitAllCount).toBe(1);
  });

  it('a stored document with bodies is fitted once after opening', async () => {
    const first = await open();
    addBox(first.session);
    first.session.dispose();
    await settle();
    const { viewport } = await open({ store: first.store });
    expect(viewport.fitAllCount).toBe(1);
  });
});

describe('built-in actions – read-only', () => {
  it('disables everything that changes the document, fit all stays', async () => {
    const first = await open({ plugins: [withLineTool] });
    const a = addBox(first.session);
    first.session.dispose();
    await settle();
    const { session } = await open({
      store: first.store,
      readOnly: true,
      plugins: [withLineTool],
    });
    selectFeature(session, a);

    for (const id of [
      'undo',
      'redo',
      'feature.delete',
      'feature.suppress',
      'timeline.toStart',
      'timeline.stepBack',
      'timeline.stepForward',
      'timeline.toEnd',
      'tool.line',
    ]) {
      expect(enabled(session, id)).toBe(false);
    }
    expect(enabled(session, 'view.fitAll')).toBe(true);
  });
});

function fail(): never {
  throw new Error('Missing test data');
}
