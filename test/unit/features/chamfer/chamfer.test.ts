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
import { chamferMessages } from '@/features/chamfer/messages';
import { chamferTool } from '@/features/chamfer/tool';
import * as chamfer from '@/features/chamfer';

// The client half of the chamfer feature (N123): the schema and the builder are the core's, so only
// the plugin, its tool and its messages are tested here.

/** The schema of the open edit session; the tool never reads it. */
const SCHEMA: FeatureSchema = {
  type: 'chamfer',
  version: 1,
  label: 'chamfer.label',
  params: {},
  defaults: () => ({}),
  validate: () => [],
};

describe('chamfer public API', () => {
  it('exports exactly chamferPlugin', () => {
    expect(Object.keys(chamfer)).toEqual(['chamferPlugin']);
  });

  it('chamferPlugin is the client half of the feature type chamfer', () => {
    expect(chamfer.chamferPlugin.type).toBe('chamfer');
  });

  it('chamferPlugin brings the messages of the chamfer', () => {
    expect(chamfer.chamferPlugin.messages).toBe(chamferMessages);
  });

  it('chamferPlugin brings the chamfer tool', () => {
    expect(chamfer.chamferPlugin.tools).toEqual([chamferTool]);
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
      name: 'Chamfer 1',
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
  registry.register(chamferTool);
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

describe('chamferTool', () => {
  it('is the modify tool chamfer without a shortcut', () => {
    expect(chamferTool).toMatchObject({
      id: 'chamfer',
      label: 'chamfer.label',
      icon: 'border-corner-square',
      group: 'modify',
    });
    expect(chamferTool.shortcut).toBeUndefined();
  });

  it('labels the tool with a key the chamfer messages translate (ADR 0014)', () => {
    expect(chamferMessages.cs[chamferTool.label]).toBe('Zkosení');
    expect(chamferMessages.en[chamferTool.label]).toBe('Chamfer');
  });

  it('opens the dialog for a new chamfer and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('chamfer');

    expect(created).toEqual(['chamfer']);
    expect(emitted).toEqual(['chamfer', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('chamfer');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['chamfer', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(chamferTool.create()).not.toBe(chamferTool.create());
  });
});
