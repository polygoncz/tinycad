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
import { cylinderMessages } from '@/features/cylinder/messages';
import { cylinderTool } from '@/features/cylinder/tool';
import * as cylinder from '@/features/cylinder';

// The client half of the cylinder feature (N123): the schema and the builder are the core's, so only
// the plugin, its tool and its messages are tested here.

/** The schema of the open edit session; the tool never reads it. */
const SCHEMA: FeatureSchema = {
  type: 'cylinder',
  version: 1,
  label: 'cylinder.label',
  params: {},
  defaults: () => ({}),
  validate: () => [],
};

describe('cylinder public API', () => {
  it('exports exactly cylinderPlugin', () => {
    expect(Object.keys(cylinder)).toEqual(['cylinderPlugin']);
  });

  it('cylinderPlugin is the client half of the feature type cylinder', () => {
    expect(cylinder.cylinderPlugin.type).toBe('cylinder');
  });

  it('cylinderPlugin brings the messages of the cylinder', () => {
    expect(cylinder.cylinderPlugin.messages).toBe(cylinderMessages);
  });

  it('cylinderPlugin brings the cylinder tool', () => {
    expect(cylinder.cylinderPlugin.tools).toEqual([cylinderTool]);
  });
});

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
      name: 'Cylinder 1',
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
  registry.register(cylinderTool);
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

describe('cylinderTool', () => {
  it('is the primitive tool cylinder with the shortcut C', () => {
    expect(cylinderTool).toMatchObject({
      id: 'cylinder',
      label: 'cylinder.label',
      icon: 'cylinder',
      group: 'primitive',
      shortcut: 'C',
    });
  });

  it('labels the tool with a key the cylinder messages translate (ADR 0014)', () => {
    expect(cylinderMessages.cs[cylinderTool.label]).toBe('Válec');
    expect(cylinderMessages.en[cylinderTool.label]).toBe('Cylinder');
  });

  it('opens the dialog for a new cylinder and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('cylinder');

    expect(created).toEqual(['cylinder']);
    expect(emitted).toEqual(['cylinder', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('cylinder');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['cylinder', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(cylinderTool.create()).not.toBe(cylinderTool.create());
  });
});
