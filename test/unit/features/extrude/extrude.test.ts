import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import type { Vec3 } from '@/core';
import type { FeatureId, FeatureInstance, FeatureSchema, SketchRegionRef } from '@/document';
import { aSnapshotDocument, aFeature, anEvaluated } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type { FeatureEditor, FeatureEditSession, Handle, LinearHandle } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { extrudeManipulators } from '@/features/extrude/manipulators';
import { extrudeMessages } from '@/features/extrude/messages';
import { flipApplies } from '@/features/extrude/params';
import type { ExtrudeParams } from '@/features/extrude/params';
import { extrudeTool } from '@/features/extrude/tool';
import * as extrude from '@/features/extrude';

// The client half of the extrude feature (N123): the schema and the builder are the core's, so
// the plugin, its manipulator, its tool and the helpers of its params are tested here.

// ---------------------------------------------------------------------------------------------
// Helpers

// ---------------------------------------------------------------------------------------------
// Helpers

function region(name = 'r1', sketch = 's'): SketchRegionRef {
  return { kind: 'region', sketch: sketch as FeatureId, region: name };
}

/** The defaults of the core for an extrude of the region r1 of the sketch s. */
const DEFAULTS: ExtrudeParams = {
  regions: [region()],
  operation: 'new',
  targets: [],
  endType: 'blind',
  distance: 10,
  upTo: [],
  flip: false,
};

function anExtrude(
  id: string,
  params: Partial<ExtrudeParams> = {},
): FeatureInstance<ExtrudeParams> {
  return aFeature({ id, type: 'extrude', params: { ...DEFAULTS, ...params } });
}

function expectVec(actual: Vec3 | undefined, expected: Vec3): void {
  if (actual === undefined) expect.fail('No vector');
  for (let i = 0; i < 3; i++) {
    expect(actual[i], `[${String(i)}]`).toBeCloseTo(expected[i] ?? Number.NaN, 9);
  }
}

/** The schema of the open edit session; the tool never reads it. */
const SCHEMA: FeatureSchema = {
  type: 'extrude',
  version: 1,
  label: 'extrude.label',
  params: {},
  defaults: () => ({}),
  validate: () => [],
};

describe('extrude public API', () => {
  it('exports exactly extrudePlugin', () => {
    expect(Object.keys(extrude)).toEqual(['extrudePlugin']);
  });

  it('extrudePlugin joins the type, the tool, the messages and the manipulators', () => {
    expect(extrude.extrudePlugin.type).toBe('extrude');
    expect(extrude.extrudePlugin.tools).toEqual([extrudeTool]);
    expect(extrude.extrudePlugin.messages).toBe(extrudeMessages);
    expect(extrude.extrudePlugin.manipulators).toBe(extrudeManipulators);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(extrude.extrudePlugin)).toBe(true);
    expect(Object.isFrozen(extrude.extrudePlugin.tools)).toBe(true);
  });
});

describe('flipApplies', () => {
  it.each([
    ['blind', true],
    ['symmetric', false],
    ['upToFace', false],
  ])('flipApplies(%s) is %s, the rule of the manipulator and of the core', (endType, applies) => {
    expect(flipApplies(endType)).toBe(applies);
  });
});

describe('extrudeManipulators', () => {
  // The anchor carries the sketch normal; flip comes from the live params (spec 07).
  const ANCHORS = { base: { point: [1, 2, 3] as Vec3, direction: [0, 0, 1] as Vec3 } };

  /** The handles of the frame (M19); the extrude has no modes, so the mode is ''. */
  function handlesOf(params: ExtrudeParams): readonly Handle[] {
    const frame = extrudeManipulators.frame(anEvaluated(params), ANCHORS, '');
    if (frame === null) expect.fail('no frame');
    return frame.handles;
  }

  function only(handles: readonly Handle[]): LinearHandle {
    expect(handles.map((h) => h.id)).toEqual(['distance']);
    const [h] = handles;
    if (h?.kind !== 'linear') expect.fail('distance is not linear');
    return h;
  }

  it('has no modes', () => {
    expect(extrudeManipulators.modes).toBeUndefined();
  });

  it('gives no frame without the anchor base', () => {
    expect(extrudeManipulators.frame(anEvaluated(anExtrude('e').params), {}, '')).toBeNull();
  });

  it('the center of the frame is the base point', () => {
    expect(
      extrudeManipulators.frame(anEvaluated(anExtrude('e').params), ANCHORS, '')?.center,
    ).toEqual([1, 2, 3]);
  });

  it('blind: one neutral length arrow at base + d·distance with min 0.01', () => {
    const h = only(handlesOf(anExtrude('e', { distance: 10 }).params));
    expect(h).toMatchObject({ unit: 'length', tint: 'neutral', min: 0.01, value: 10 });
    expectVec(h.position, [1, 2, 13]);
    expect(h.direction).toEqual([0, 0, 1]);
    expect(h.toParams(12)).toEqual({ distance: 12 });
    expect(h.displayScale ?? 1).toBe(1);
  });

  it('blind with flip: the arrow points against the normal of the anchor', () => {
    const params = anExtrude('e', { distance: 10, flip: true }).params;
    const h = only(handlesOf(params));
    expectVec(h.position, [1, 2, -7]);
    expectVec(h.direction, [0, 0, -1]);
    expect(h.value).toBe(10);
    expect(h.toParams(12)).toEqual({ distance: 12 });
  });

  it('symmetric: the arrow at base + d·distance/2, the field shows the whole distance', () => {
    const params = anExtrude('e', { endType: 'symmetric', distance: 10 }).params;
    const h = only(handlesOf(params));
    expect(h).toMatchObject({ unit: 'length', tint: 'neutral', min: 0.01, value: 5 });
    expectVec(h.position, [1, 2, 8]);
    expect(h.direction).toEqual([0, 0, 1]);
    expect(h.toParams(6)).toEqual({ distance: 12 });
    expect(h.displayScale).toBe(2);
  });

  it('symmetric ignores a set flip: the arrow goes along the normal', () => {
    const params = anExtrude('e', { endType: 'symmetric', distance: 10, flip: true }).params;
    const h = only(handlesOf(params));
    expectVec(h.position, [1, 2, 8]);
    expectVec(h.direction, [0, 0, 1]);
  });

  it('up to face gives no frame even with an old anchor base', () => {
    const params = anExtrude('e', { endType: 'upToFace' }).params;
    expect(extrudeManipulators.frame(anEvaluated(params), ANCHORS, '')).toBeNull();
  });

  it('the frame and the handles are frozen', () => {
    const frame = extrudeManipulators.frame(anEvaluated(anExtrude('e').params), ANCHORS, '');
    expect(Object.isFrozen(frame)).toBe(true);
    const handles = handlesOf(anExtrude('e').params);
    expect(Object.isFrozen(handles)).toBe(true);
    const h = only(handles);
    expect(Object.isFrozen(h)).toBe(true);
    expect(Object.isFrozen(h.position)).toBe(true);
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
      name: 'Extrude 1',
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
  registry.register(extrudeTool);
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

describe('extrudeTool', () => {
  it('is the feature tool extrude with the shortcut Shift+E', () => {
    expect(extrudeTool).toMatchObject({
      id: 'extrude',
      label: 'extrude.label',
      icon: 'arrow-big-up-lines',
      group: 'feature',
      shortcut: 'Shift+E',
    });
    expect(Object.isFrozen(extrudeTool)).toBe(true);
  });

  it('labels the tool with a key the extrude messages translate (ADR 0014)', () => {
    expect(extrudeMessages.cs[extrudeTool.label]).toBe('Vysunutí');
    expect(extrudeMessages.en[extrudeTool.label]).toBe('Extrude');
  });

  it('opens the dialog for a new extrude and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('extrude');

    expect(created).toEqual(['extrude']);
    expect(emitted).toEqual(['extrude', 'select']);
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('extrude');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['extrude', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(extrudeTool.create()).not.toBe(extrudeTool.create());
  });
});
