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
import { filletMessages } from '@/features/fillet/messages';
import { filletTool } from '@/features/fillet/tool';
import * as fillet from '@/features/fillet';

// The client half of the fillet feature (N123): the schema and the builder are the core's, so only
// the plugin, its tool and its messages are tested here.

/** The schema of the open edit session; the tool never reads it. */
const SCHEMA: FeatureSchema = {
  type: 'fillet',
  version: 1,
  label: 'fillet.label',
  params: {},
  defaults: () => ({}),
  validate: () => [],
};

describe('fillet public API', () => {
  it('exports exactly filletPlugin', () => {
    expect(Object.keys(fillet)).toEqual(['filletPlugin']);
  });

  it('filletPlugin is the client half of the feature type fillet', () => {
    expect(fillet.filletPlugin.type).toBe('fillet');
  });

  it('filletPlugin brings the messages of the fillet', () => {
    expect(fillet.filletPlugin.messages).toBe(filletMessages);
  });

  it('filletPlugin brings the fillet tool', () => {
    expect(fillet.filletPlugin.tools).toEqual([filletTool]);
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
      name: 'Fillet 1',
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
  registry.register(filletTool);
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

describe('filletTool', () => {
  it('is the modify tool fillet with the shortcut Shift+F', () => {
    expect(filletTool).toMatchObject({
      id: 'fillet',
      label: 'fillet.label',
      icon: 'border-radius',
      group: 'modify',
      shortcut: 'Shift+F',
    });
  });

  it('labels the tool with a key the fillet messages translate (ADR 0014)', () => {
    expect(filletMessages.cs[filletTool.label]).toBe('Zaoblení');
    expect(filletMessages.en[filletTool.label]).toBe('Fillet');
  });

  it('opens the dialog for a new fillet and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('fillet');

    expect(created).toEqual(['fillet']);
    expect(emitted).toEqual(['fillet', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('fillet');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['fillet', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(filletTool.create()).not.toBe(filletTool.create());
  });
});
