import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import type { FeatureSchema } from '@/document';
import { aSnapshotDocument, aFeature } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type { FeatureEditor, FeatureEditSession } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { booleanMessages } from '@/features/boolean/messages';
import { booleanTool } from '@/features/boolean/tool';
import * as boolean from '@/features/boolean';

// The client half of the boolean feature (N123): the schema and the builder are the core's, so only
// the plugin, its tool and its messages are tested here.

/** The schema of the open edit session; the tool never reads it. */
const SCHEMA: FeatureSchema = {
  type: 'boolean',
  version: 1,
  label: 'boolean.label',
  params: {},
  defaults: () => ({}),
  validate: () => [],
};

describe('boolean public API', () => {
  it('exports exactly booleanPlugin', () => {
    expect(Object.keys(boolean)).toEqual(['booleanPlugin']);
  });

  it('booleanPlugin is the client half of the feature type boolean', () => {
    expect(boolean.booleanPlugin.type).toBe('boolean');
  });

  it('booleanPlugin brings the messages of the boolean', () => {
    expect(boolean.booleanPlugin.messages).toBe(booleanMessages);
  });

  it('booleanPlugin brings the boolean tool', () => {
    expect(boolean.booleanPlugin.tools).toEqual([booleanTool]);
  });
});

// ---------------------------------------------------------------------------------------------

/** A FeatureEditor that records create calls; `open` pretends a session is already open. */
function aRecordingEditor(open = false) {
  const created: string[] = [];
  const session: FeatureEditSession = {
    mode: 'create',
    featureId: aFeature().id,
    schema: SCHEMA,
    state: new ObservableValue({
      params: {},
      issues: [],
      fields: [],
      activeRefParam: null,
      open: true,
      name: 'Boolean 1',
    }),
    setParam: () => expect.fail('setParam is not expected'),
    setParams: () => expect.fail('setParams is not expected'),
    removeRef: () => expect.fail('removeRef is not expected'),
    focusRefParam: () => expect.fail('focusRefParam is not expected'),
    commit: () => expect.fail('commit is not expected'),
    cancel: () => expect.fail('cancel is not expected'),
  };
  const current = new ObservableValue<FeatureEditSession | null>(open ? session : null);
  const editor: FeatureEditor = {
    current,
    create(type) {
      created.push(type);
      current.set(session);
      return session;
    },
    edit: () => expect.fail('edit is not expected'),
  };
  return { editor, created };
}

function aToolManager(editor: FeatureEditor) {
  const registry = createToolRegistry();
  registry.register(SELECT_TOOL);
  registry.register(booleanTool);
  const viewport = new FakeViewport();
  const manager = createToolManager({
    registry,
    ctx: {
      viewport,
      selection: createSelectionModel({ regen: new FakeRegenStatus() }),
      doc: aSnapshotDocument(),
      ids: createSequentialIdGenerator('t'),
      features: editor,
    },
    viewportEvents: viewport.events,
    defaultToolId: SELECT_TOOL.id,
  });
  const emitted: string[] = [];
  manager.active.subscribe(() => emitted.push(manager.active.get()));
  return { manager, emitted };
}

describe('booleanTool', () => {
  it('is the modify tool boolean without a shortcut', () => {
    expect(booleanTool).toMatchObject({
      id: 'boolean',
      label: 'boolean.label',
      icon: 'layers-union',
      group: 'modify',
    });
    expect(booleanTool.shortcut).toBeUndefined();
  });

  it('labels the tool with a key the boolean messages translate (ADR 0014)', () => {
    expect(booleanMessages.cs[booleanTool.label]).toBe('Boolean');
    expect(booleanMessages.en[booleanTool.label]).toBe('Boolean');
  });

  it('opens the dialog for a new boolean and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('boolean');

    expect(created).toEqual(['boolean']);
    expect(emitted).toEqual(['boolean', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('boolean');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['boolean', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(booleanTool.create()).not.toBe(booleanTool.create());
  });
});
