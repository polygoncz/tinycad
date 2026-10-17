import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import type { FeatureSchema } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type { FeatureEditor, FeatureEditSession } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { boxMessages } from '@/features/box/messages';
import { boxTool } from '@/features/box/tool';
import * as box from '@/features/box';

// The client half of the box feature (N123): the schema and the builder are the core's, so only
// the plugin, its tool and its messages are tested here.

/** The schema of the open edit session; the tool never reads it. */
const SCHEMA: FeatureSchema = {
  type: 'box',
  version: 1,
  label: 'box.label',
  params: {},
  defaults: () => ({}),
  validate: () => [],
};

describe('box public API', () => {
  it('exports exactly boxPlugin', () => {
    expect(Object.keys(box)).toEqual(['boxPlugin']);
  });

  it('boxPlugin is the client half of the feature type box', () => {
    expect(box.boxPlugin.type).toBe('box');
  });

  it('boxPlugin brings the messages of the box', () => {
    expect(box.boxPlugin.messages).toBe(boxMessages);
  });

  it('boxPlugin brings the box tool', () => {
    expect(box.boxPlugin.tools).toEqual([boxTool]);
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
      name: 'Box 1',
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
  registry.register(boxTool);
  const viewport = new FakeViewport();
  const manager = createToolManager({
    registry,
    ctx: {
      viewport,
      selection: createSelectionModel({ regen: new FakeRegenStatus() }),
      doc: aDocument(),
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

describe('boxTool', () => {
  it('is the primitive tool box', () => {
    expect(boxTool).toMatchObject({
      id: 'box',
      label: 'box.label',
      icon: 'box',
      group: 'primitive',
      shortcut: 'B',
    });
  });

  it('labels the tool with a key the box messages translate (ADR 0014)', () => {
    expect(boxMessages.cs[boxTool.label]).toBe('Kvádr');
    expect(boxMessages.en[boxTool.label]).toBe('Box');
  });

  it('opens the dialog for a new box and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('box');

    expect(created).toEqual(['box']);
    expect(emitted).toEqual(['box', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('box');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['box', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(boxTool.create()).not.toBe(boxTool.create());
  });
});
