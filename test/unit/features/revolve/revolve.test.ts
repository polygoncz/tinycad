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
import { revolveMessages } from '@/features/revolve/messages';
import { revolveTool } from '@/features/revolve/tool';
import * as revolve from '@/features/revolve';

// The client half of the revolve feature (N123): the schema and the builder are the core's, so only
// the plugin, its tool and its messages are tested here.

/** The schema of the open edit session; the tool never reads it. */
const SCHEMA: FeatureSchema = {
  type: 'revolve',
  version: 1,
  label: 'revolve.label',
  params: {},
  defaults: () => ({}),
  validate: () => [],
};

describe('revolve public API', () => {
  it('exports exactly revolvePlugin', () => {
    expect(Object.keys(revolve)).toEqual(['revolvePlugin']);
  });

  it('revolvePlugin is the client half of the feature type revolve', () => {
    expect(revolve.revolvePlugin.type).toBe('revolve');
  });

  it('revolvePlugin brings the messages of the revolve', () => {
    expect(revolve.revolvePlugin.messages).toBe(revolveMessages);
  });

  it('revolvePlugin brings the revolve tool', () => {
    expect(revolve.revolvePlugin.tools).toEqual([revolveTool]);
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
      name: 'Revolve 1',
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
  registry.register(revolveTool);
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

describe('revolveTool', () => {
  it('is the feature tool revolve with the shortcut Shift+W', () => {
    expect(revolveTool).toMatchObject({
      id: 'revolve',
      label: 'revolve.label',
      icon: 'rotate-360',
      group: 'feature',
      shortcut: 'Shift+W',
    });
  });

  it('labels the tool with a key the revolve messages translate (ADR 0014)', () => {
    expect(revolveMessages.cs[revolveTool.label]).toBe('Rotace');
    expect(revolveMessages.en[revolveTool.label]).toBe('Revolve');
  });

  it('opens the dialog for a new revolve and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('revolve');

    expect(created).toEqual(['revolve']);
    expect(emitted).toEqual(['revolve', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('revolve');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['revolve', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(revolveTool.create()).not.toBe(revolveTool.create());
  });
});
