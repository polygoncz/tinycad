import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator, ObservableValue } from '@/core';
import { bodyId, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type {
  BodyId,
  FeatureId,
  FeatureInstance,
  FeatureSchema,
  ParamSchema,
  ParamSchemaOf,
} from '@/document';
import { aFeature } from '@/document/testing';
import type { DocumentOptions } from '@/document/testing';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE } from '@/sketch';
import { createActionRegistry } from '@/interaction/actions';
import type { ActionState } from '@/interaction/actions';
import { createBuiltInActions } from '@/interaction/builtin-actions';
import { ACTION_IDS, toolActionId } from '@/interaction/constants';
import type { ConfirmRequest, StandardViewId } from '@/interaction/builtin-actions';
import { createEditLock } from '@/interaction/edit-lock';
import { createFeatureEditor } from '@/interaction/feature-dialog/feature-editor';
import { createFeatureTreeModel } from '@/interaction/feature-tree';
import { ALL_MODES } from '@/interaction/mode';
import type { Mode } from '@/interaction/mode';
import { SELECT_TOOL } from '@/interaction/select-tool';
import { createSelectionModel } from '@/interaction/selection';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createToolManager } from '@/interaction/tool-manager';
import { createToolRegistry } from '@/interaction/tools';
import type { ToolDescriptor } from '@/interaction/tools';
import type { ViewKeyEvent } from '@/interaction/viewport-port';

interface BoxParams {
  readonly width: number;
}

const BOX_PARAMS: ParamSchemaOf<BoxParams> = {
  width: { kind: 'length', label: 'box.width', default: 10, min: 0 },
};

const BOX: FeatureSchema<BoxParams> = {
  type: 'box',
  version: 1,
  label: 'box.label',
  params: BOX_PARAMS,
  defaults: () => ({ width: 10 }),
  validate: (params) => validateAgainstSchema(BOX_PARAMS, params),
};

const USE_PARAMS: ParamSchema = {
  bodies: { kind: 'bodies', label: 'use.bodies' },
};

/** A test feature that refers to bodies of other features (not the real Boolean). */
const USE: FeatureSchema = {
  type: 'use',
  version: 1,
  label: 'use.label',
  params: USE_PARAMS,
  defaults: () => ({ bodies: [] }),
  validate: (params) => validateAgainstSchema(USE_PARAMS, params),
};

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted
const bid = (id: string): BodyId => id as BodyId; // test ids are trusted

const aBox = (id: string): FeatureInstance => aFeature({ id, type: 'box', params: { width: 1 } });

/** A feature that uses the bodies of the given features. */
const aUse = (id: string, ...owners: string[]): FeatureInstance =>
  aFeature({
    id,
    type: 'use',
    params: { bodies: owners.map((owner) => ({ kind: 'body', body: bodyId(fid(owner)) })) },
  });

/** A tool that finishes at once (like the box tool after opening its dialog). */
function aTool(id: string, shortcut?: string, modes?: readonly Mode[]): ToolDescriptor {
  return {
    id,
    label: `${id}.label`,
    icon: id,
    group: 'sketch',
    ...(shortcut === undefined ? {} : { shortcut }),
    ...(modes === undefined ? {} : { modes }),
    create: () => ({
      activate: (ctx) => {
        ctx.finish();
      },
      deactivate: () => undefined,
    }),
  };
}

const LINE_TOOL = aTool('line', 'L');
const PLANE_TOOL = aTool('plane');
/** The default tool of the sketch mode and a drawing tool of it, for the mode tests. */
const SKETCH_SELECT_TOOL = aTool('sketch.select', undefined, ['sketch']);
const RECT_TOOL = aTool('sketch.rectangle', 'R', ['sketch']);

function setup(
  opts: {
    readOnly?: boolean;
    init?: DocumentOptions;
    confirm?: (r: ConfirmRequest) => boolean;
    /** With a mode: the sketch tools are registered too and everything follows the mode. */
    mode?: ObservableValue<Mode>;
    /** The sketcher of the feature tree (M12). */
    sketchEdit?: (id: FeatureId) => void;
  } = {},
) {
  const ops = anOpsSession(opts.init);
  const { doc, dispatcher, undo } = ops;
  const schemas = createFeatureSchemaRegistry();
  schemas.register(BOX);
  schemas.register(USE);
  const ids = createSequentialIdGenerator('f');
  const regen = new FakeRegenStatus();
  const selection = createSelectionModel({ regen });
  const editor = createFeatureEditor({ doc, ops: dispatcher, schemas, ids });
  const locked = createEditLock({ readOnly: opts.readOnly ?? false, editor });
  const featureTree = createFeatureTreeModel({
    doc,
    ops: dispatcher,
    schemas,
    regen,
    editor,
    selection,
    locked,
    ...(opts.sketchEdit === undefined ? {} : { sketchEdit: opts.sketchEdit }),
  });
  const toolRegistry = createToolRegistry();
  for (const tool of [SELECT_TOOL, LINE_TOOL, PLANE_TOOL]) toolRegistry.register(tool);
  const mode = opts.mode?.asObservable();
  if (mode !== undefined)
    for (const tool of [SKETCH_SELECT_TOOL, RECT_TOOL]) toolRegistry.register(tool);
  const viewport = new FakeViewport();
  const registry = createActionRegistry(mode === undefined ? {} : { mode });
  const tools = createToolManager({
    registry: toolRegistry,
    ctx: { viewport, selection, doc, ids, features: editor },
    viewportEvents: viewport.events,
    defaultToolId: SELECT_TOOL.id,
    unhandledKey: (e) => registry.handleKey(e),
    ...(mode === undefined ? {} : { mode, defaultToolIds: { sketch: SKETCH_SELECT_TOOL.id } }),
  });
  let fitAllCount = 0;
  const views: StandardViewId[] = [];
  const confirms: ConfirmRequest[] = [];
  const answer = opts.confirm ?? (() => true);
  const builtIn = createBuiltInActions({
    registry,
    doc,
    ops: dispatcher,
    undo,
    selection,
    featureTree,
    tools,
    toolList: toolRegistry.all(),
    locked,
    ...(mode === undefined ? {} : { mode }),
    camera: {
      fitAll: () => {
        fitAllCount++;
      },
      setView: (view) => {
        views.push(view);
      },
    },
    confirm: (request) => {
      confirms.push(request);
      return answer(request);
    },
  });

  function addBox(): FeatureId {
    const edit = editor.create('box');
    edit.commit();
    return edit.featureId;
  }
  function state(id: string): ActionState {
    const found = registry.actions.get().find((a) => a.id === id);
    if (found === undefined) throw new Error(`No action '${id}'`);
    return found;
  }
  return {
    ...ops,
    registry,
    selection,
    editor,
    featureTree,
    tools,
    viewport,
    builtIn,
    fitAllCount: () => fitAllCount,
    views,
    confirms,
    addBox,
    state,
    enabled: (id: string): boolean => state(id).enabled,
    select: (...features: FeatureId[]): void => {
      selection.set(features.map((feature) => ({ kind: 'feature', feature })));
    },
    featureIds: (): FeatureId[] => doc.studio.features.map((f) => f.id),
    bar: (): number => doc.studio.rollbackIndex,
  };
}

const STANDARD_VIEW_ACTIONS = [
  'view.front',
  'view.back',
  'view.right',
  'view.left',
  'view.top',
  'view.bottom',
  'view.iso',
] as const;

const key = (k: string, mods: Partial<ViewKeyEvent['mods']> = {}): ViewKeyEvent => ({
  key: k,
  mods: { shift: false, alt: false, mod: false, ...mods },
  inTextField: false,
});

describe('ACTION_IDS and toolActionId', () => {
  it('names the built-in actions', () => {
    expect(ACTION_IDS).toEqual({
      undo: 'undo',
      redo: 'redo',
      fitAll: 'view.fitAll',
      viewFront: 'view.front',
      viewBack: 'view.back',
      viewRight: 'view.right',
      viewLeft: 'view.left',
      viewTop: 'view.top',
      viewBottom: 'view.bottom',
      viewIso: 'view.iso',
      featureEdit: 'feature.edit',
      featureRename: 'feature.rename',
      featureSuppress: 'feature.suppress',
      featureDelete: 'feature.delete',
      rollHere: 'timeline.rollHere',
      toStart: 'timeline.toStart',
      stepBack: 'timeline.stepBack',
      stepForward: 'timeline.stepForward',
      toEnd: 'timeline.toEnd',
    });
  });

  it('the action of a tool is tool.<id>', () => {
    expect(toolActionId('box')).toBe('tool.box');
  });
});

describe('built-in actions – registration', () => {
  it('registers the built-in actions with translation keys as labels and their shortcuts', () => {
    const s = setup();
    const shortcuts = Object.fromEntries(s.registry.actions.get().map((a) => [a.id, a.shortcut]));
    expect(shortcuts).toMatchObject({
      undo: 'Mod+Z',
      redo: 'Mod+Shift+Z',
      'feature.edit': null,
      'feature.rename': null,
      'feature.delete': 'Delete',
      'feature.suppress': 'S',
      'timeline.rollHere': null,
      'view.fitAll': 'F',
      'view.front': null,
      'view.back': null,
      'view.right': null,
      'view.left': null,
      'view.top': null,
      'view.bottom': null,
      'view.iso': null,
      'timeline.toStart': null,
      'timeline.stepBack': null,
      'timeline.stepForward': null,
      'timeline.toEnd': null,
    });
    for (const a of s.registry.actions.get()) {
      if (!a.id.startsWith('tool.')) expect(a.label).toBe(a.id);
    }
  });

  it('the feature context menu is edit, rename, suppress, roll here and delete, in this order', () => {
    const s = setup();
    expect(
      s.registry.actions
        .get()
        .filter((a) => a.group === 'feature')
        .map((a) => a.id),
    ).toEqual([
      'feature.edit',
      'feature.rename',
      'feature.suppress',
      'timeline.rollHere',
      'feature.delete',
    ]);
  });

  it('registers an action for every tool with a shortcut, labelled by the tool', () => {
    const s = setup();
    expect(s.state('tool.line')).toMatchObject({ label: 'line.label', shortcut: 'L' });
    // Tools without a shortcut get no action.
    const ids = s.registry.actions.get().map((a) => a.id);
    expect(ids).not.toContain('tool.select');
    expect(ids).not.toContain('tool.plane');

    s.viewport.emitKey(key('l'));
    // The line tool finishes at once: activation went through and the default tool is back.
    expect(s.tools.active.get()).toBe('select');
    expect(s.registry.run('tool.line')).toBe(true);
  });

  it('tool actions are disabled while a feature edit session is open', () => {
    const s = setup();
    const edit = s.editor.create('box');
    expect(s.enabled('tool.line')).toBe(false);
    edit.cancel();
    expect(s.enabled('tool.line')).toBe(true);
  });
});

describe('built-in actions – undo and redo', () => {
  it('undo and redo bring the document back and forth', () => {
    const s = setup();
    expect(s.enabled('undo')).toBe(false);
    expect(s.enabled('redo')).toBe(false);
    s.addBox();
    expect(s.enabled('undo')).toBe(true);

    s.viewport.emitKey(key('z', { mod: true }));
    expect(s.doc.studio.features).toHaveLength(0);
    expect(s.enabled('undo')).toBe(false);
    expect(s.enabled('redo')).toBe(true);

    s.viewport.emitKey(key('Z', { mod: true, shift: true }));
    expect(s.doc.studio.features).toHaveLength(1);
    expect(s.enabled('redo')).toBe(false);
  });

  it('undo is disabled while a feature edit session is open', () => {
    const s = setup();
    s.addBox();
    const edit = s.editor.create('box');
    expect(s.enabled('undo')).toBe(false);
    expect(s.registry.run('undo')).toBe(false);
    edit.cancel();
    expect(s.enabled('undo')).toBe(true);
  });
});

describe('built-in actions – delete and suppress', () => {
  it('delete removes the selected feature as one undoable step', () => {
    const s = setup();
    const a = s.addBox();
    const b = s.addBox();
    expect(s.enabled('feature.delete')).toBe(false);

    s.select(a);
    expect(s.enabled('feature.delete')).toBe(true);
    s.viewport.emitKey(key('Delete'));

    expect(s.featureIds()).toEqual([b]);
    expect(s.selection.items.get()).toEqual([]);
    expect(s.enabled('feature.delete')).toBe(false);
    s.registry.run('undo');
    expect(s.featureIds()).toEqual([a, b]);
  });

  it('delete also runs on Backspace', () => {
    const s = setup();
    const a = s.addBox();
    const b = s.addBox();
    s.select(a);
    s.viewport.emitKey(key('Backspace'));
    expect(s.featureIds()).toEqual([b]);
  });

  it('delete removes every selected feature in one undoable step', () => {
    const s = setup();
    const a = s.addBox();
    const b = s.addBox();
    const c = s.addBox();
    s.select(a, c);
    expect(s.registry.run('feature.delete')).toBe(true);
    expect(s.featureIds()).toEqual([b]);
    s.registry.run('undo');
    expect(s.featureIds()).toEqual([a, b, c]);
  });

  it('delete without dependent features does not ask', () => {
    const s = setup();
    const a = s.addBox();
    s.select(a);
    s.registry.run('feature.delete');
    expect(s.confirms).toEqual([]);
    expect(s.featureIds()).toEqual([]);
  });

  it('delete with dependent features asks with their count; false deletes nothing', () => {
    const s = setup({
      init: { features: [aBox('a'), aUse('u', 'a'), aUse('v', 'a', 'b'), aBox('b')] },
      confirm: () => false,
    });
    s.select(fid('a'), fid('b'));
    s.registry.run('feature.delete');

    expect(s.confirms).toEqual([{ key: 'feature.delete.confirm', params: { n: 2 } }]);
    expect(s.featureIds()).toEqual(['a', 'u', 'v', 'b']);
    expect(s.log.entries()).toHaveLength(0);
    expect(s.selection.items.get()).toEqual([
      { kind: 'feature', feature: 'a' },
      { kind: 'feature', feature: 'b' },
    ]);
  });

  it('delete with dependent features confirmed deletes as before', () => {
    const s = setup({ init: { features: [aBox('a'), aUse('u', 'a')] } });
    s.select(fid('a'));
    s.registry.run('feature.delete');

    expect(s.confirms).toEqual([{ key: 'feature.delete.confirm', params: { n: 1 } }]);
    expect(s.featureIds()).toEqual(['u']);
    expect(s.selection.items.get()).toEqual([]);
    s.registry.run('undo');
    expect(s.featureIds()).toEqual(['a', 'u']);
  });

  it('delete of a feature together with its dependents does not ask', () => {
    const s = setup({ init: { features: [aBox('a'), aUse('u', 'a')] } });
    s.select(fid('a'), fid('u'));
    s.registry.run('feature.delete');
    expect(s.confirms).toEqual([]);
    expect(s.featureIds()).toEqual([]);
  });

  it('suppress toggles the selected feature', () => {
    const s = setup();
    const a = s.addBox();
    expect(s.enabled('feature.suppress')).toBe(false);
    s.select(a);
    expect(s.enabled('feature.suppress')).toBe(true);

    s.viewport.emitKey(key('s'));
    expect(s.doc.feature(a)?.suppressed).toBe(true);
    s.viewport.emitKey(key('s'));
    expect(s.doc.feature(a)?.suppressed).toBe(false);
  });

  it('suppress of a mixed selection suppresses all, of a suppressed one unsuppresses all', () => {
    const s = setup();
    const a = s.addBox();
    const b = s.addBox();
    s.select(a);
    s.registry.run('feature.suppress');
    s.select(a, b);

    s.registry.run('feature.suppress');
    expect(s.doc.studio.features.map((f) => f.suppressed)).toEqual([true, true]);
    s.registry.run('feature.suppress');
    expect(s.doc.studio.features.map((f) => f.suppressed)).toEqual([false, false]);
  });

  it('a selection without features enables neither delete nor suppress', () => {
    const s = setup();
    s.addBox();
    s.selection.set([{ kind: 'body', body: bid('b1') }]);
    expect(s.enabled('feature.delete')).toBe(false);
    expect(s.enabled('feature.suppress')).toBe(false);
  });

  it('a selected feature that no longer exists does not count', () => {
    const s = setup({ init: { features: [aFeature({ id: 'a', type: 'box' })] } });
    s.select(fid('gone'));
    expect(s.enabled('feature.delete')).toBe(false);
    expect(s.enabled('feature.edit')).toBe(false);
  });

  it('delete and suppress are disabled while a feature edit session is open', () => {
    const s = setup();
    const a = s.addBox();
    s.select(a);
    const edit = s.editor.edit(a);
    expect(s.enabled('feature.delete')).toBe(false);
    expect(s.enabled('feature.suppress')).toBe(false);
    edit.cancel();
    expect(s.enabled('feature.delete')).toBe(true);
    expect(s.enabled('feature.suppress')).toBe(true);
  });
});

describe('built-in actions – edit and rename', () => {
  it('edit opens the dialog of the one selected feature', () => {
    const s = setup();
    const a = s.addBox();
    s.addBox();
    expect(s.enabled('feature.edit')).toBe(false);
    s.select(a);
    expect(s.enabled('feature.edit')).toBe(true);

    expect(s.registry.run('feature.edit')).toBe(true);
    expect(s.editor.current.get()?.featureId).toBe(a);
    // The dialog holds a transaction: no second edit.
    expect(s.enabled('feature.edit')).toBe(false);
  });

  it('edit opens a sketch in the sketcher and a box in the feature dialog', () => {
    const sketch = aFeature({ id: 's', type: SKETCH_FEATURE_TYPE, params: {} });
    const sketched: FeatureId[] = [];
    const s = setup({
      init: { features: [aBox('a'), sketch] },
      sketchEdit: (id) => sketched.push(id),
    });

    s.select(fid('s'));
    expect(s.registry.run('feature.edit')).toBe(true);
    expect(sketched).toEqual(['s']);
    expect(s.editor.current.get()).toBeNull();

    s.select(fid('a'));
    expect(s.registry.run('feature.edit')).toBe(true);
    expect(s.editor.current.get()?.featureId).toBe('a');
    expect(sketched).toEqual(['s']);
  });

  it('edit is disabled with more than one or no selected feature', () => {
    const s = setup();
    const a = s.addBox();
    const b = s.addBox();
    s.select(a, b);
    expect(s.enabled('feature.edit')).toBe(false);
    s.select();
    expect(s.enabled('feature.edit')).toBe(false);
  });

  it('rename puts the one selected feature into the rename mode of the tree', () => {
    const s = setup();
    const a = s.addBox();
    const b = s.addBox();
    expect(s.enabled('feature.rename')).toBe(false);
    s.select(a, b);
    expect(s.enabled('feature.rename')).toBe(false);
    s.select(b);
    expect(s.enabled('feature.rename')).toBe(true);

    expect(s.registry.run('feature.rename')).toBe(true);
    expect(s.featureTree.renaming.get()).toBe(b);
    // Rename mode is view state: the document and the log stay as they were.
    expect(s.log.entries()).toHaveLength(2);
  });

  it('rename is disabled while a feature edit session is open', () => {
    const s = setup();
    const a = s.addBox();
    s.select(a);
    const edit = s.editor.edit(a);
    expect(s.enabled('feature.rename')).toBe(false);
    edit.cancel();
    expect(s.enabled('feature.rename')).toBe(true);
  });
});

describe('built-in actions – timeline', () => {
  it('roll here moves the bar right after the selected feature', () => {
    const s = setup();
    const a = s.addBox();
    const b = s.addBox();
    s.addBox();
    expect(s.enabled('timeline.rollHere')).toBe(false);

    s.select(a);
    expect(s.enabled('timeline.rollHere')).toBe(true);
    s.registry.run('timeline.rollHere');
    expect(s.bar()).toBe(1);
    // The bar is already there.
    expect(s.enabled('timeline.rollHere')).toBe(false);

    // A feature after the bar rolls the bar forward.
    s.select(b);
    s.registry.run('timeline.rollHere');
    expect(s.bar()).toBe(2);
  });

  it('roll here is disabled with more than one selected feature or an open dialog', () => {
    const s = setup();
    const a = s.addBox();
    const b = s.addBox();
    s.select(a, b);
    expect(s.enabled('timeline.rollHere')).toBe(false);
    s.select(a);
    const edit = s.editor.create('box');
    expect(s.enabled('timeline.rollHere')).toBe(false);
    edit.cancel();
    expect(s.enabled('timeline.rollHere')).toBe(true);
  });

  it('the steps move the rollback bar and are disabled at the ends', () => {
    const s = setup();
    s.addBox();
    s.addBox();
    s.addBox();
    expect(s.bar()).toBe(3);
    expect(s.enabled('timeline.stepForward')).toBe(false);
    expect(s.enabled('timeline.toEnd')).toBe(false);

    s.registry.run('timeline.stepBack');
    expect(s.bar()).toBe(2);
    expect(s.enabled('timeline.stepForward')).toBe(true);
    s.registry.run('timeline.toStart');
    expect(s.bar()).toBe(0);
    expect(s.enabled('timeline.stepBack')).toBe(false);
    expect(s.enabled('timeline.toStart')).toBe(false);
    expect(s.registry.run('timeline.stepBack')).toBe(false);

    s.registry.run('timeline.stepForward');
    expect(s.bar()).toBe(1);
    s.registry.run('timeline.toEnd');
    expect(s.bar()).toBe(3);
  });

  it('an empty timeline has every step disabled', () => {
    const s = setup();
    for (const id of [
      'timeline.toStart',
      'timeline.stepBack',
      'timeline.stepForward',
      'timeline.toEnd',
    ]) {
      expect(s.enabled(id)).toBe(false);
    }
  });

  it('the steps are disabled while a feature edit session is open', () => {
    const s = setup();
    s.addBox();
    const edit = s.editor.create('box');
    expect(s.enabled('timeline.stepBack')).toBe(false);
    edit.cancel();
    expect(s.enabled('timeline.stepBack')).toBe(true);
  });
});

describe('built-in actions – view', () => {
  it('fit all fits the camera', () => {
    const s = setup();
    s.viewport.emitKey(key('f'));
    expect(s.fitAllCount()).toBe(1);
  });

  it('every standard view action sets its view of the camera', () => {
    const s = setup();
    const expected: readonly (readonly [string, StandardViewId])[] = [
      ['view.front', 'front'],
      ['view.back', 'back'],
      ['view.right', 'right'],
      ['view.left', 'left'],
      ['view.top', 'top'],
      ['view.bottom', 'bottom'],
      ['view.iso', 'iso'],
    ];
    for (const [id] of expected) s.registry.run(id);
    expect(s.views).toEqual(expected.map(([, view]) => view));
  });
});

describe('built-in actions – locked', () => {
  it('read-only disables everything that changes the document, fit all stays', () => {
    const s = setup({
      readOnly: true,
      init: { features: [aFeature({ id: 'a', type: 'box' }), aFeature({ id: 'b', type: 'box' })] },
    });
    // Something to undo, so only the lock keeps undo disabled.
    s.featureTree.moveRollbackBar(1);
    s.select(fid('a'));

    for (const id of [
      'undo',
      'redo',
      'feature.edit',
      'feature.rename',
      'feature.delete',
      'feature.suppress',
      'timeline.rollHere',
      'timeline.toStart',
      'timeline.stepBack',
      'timeline.stepForward',
      'timeline.toEnd',
      'tool.line',
    ]) {
      expect(s.enabled(id)).toBe(false);
    }
    for (const id of STANDARD_VIEW_ACTIONS) expect(s.enabled(id)).toBe(true);
    expect(s.enabled('view.fitAll')).toBe(true);
  });

  it('the standard views stay enabled while a feature edit session is open', () => {
    const s = setup();
    s.editor.create('box');
    for (const id of STANDARD_VIEW_ACTIONS) expect(s.enabled(id)).toBe(true);
  });
});

describe('built-in actions – dispose', () => {
  it('stops following the sources of enabled', () => {
    const s = setup();
    const a = s.addBox();
    s.builtIn.dispose();
    s.select(a);
    expect(s.enabled('feature.delete')).toBe(false);
  });
});

describe('built-in actions – modes', () => {
  it('feature and timeline actions exist only in the mode model, undo, redo and fit all in all', () => {
    const s = setup({ mode: new ObservableValue<Mode>('model') });
    const modes = Object.fromEntries(s.registry.actions.get().map((a) => [a.id, a.modes]));
    for (const id of [
      'feature.edit',
      'feature.rename',
      'feature.suppress',
      'feature.delete',
      'timeline.rollHere',
      'timeline.toStart',
      'timeline.stepBack',
      'timeline.stepForward',
      'timeline.toEnd',
    ]) {
      expect(modes[id]).toEqual(['model']);
    }
    for (const id of ['undo', 'redo', 'view.fitAll', ...STANDARD_VIEW_ACTIONS])
      expect(modes[id]).toEqual(ALL_MODES);
  });

  it('a tool action has the modes of its tool', () => {
    const s = setup({ mode: new ObservableValue<Mode>('model') });
    expect(s.state('tool.line').modes).toEqual(['model']);
    expect(s.state('tool.sketch.rectangle').modes).toEqual(['sketch']);
  });

  it('in the mode sketch a sketch tool action is enabled although locked, a model one is not', () => {
    const mode = new ObservableValue<Mode>('model');
    const s = setup({ mode });
    expect(s.enabled('tool.sketch.rectangle')).toBe(false);
    // The sketcher is an open feature edit: locked is true in it.
    const edit = s.editor.create('box');
    mode.set('sketch');
    expect(s.enabled('tool.sketch.rectangle')).toBe(true);
    expect(s.enabled('tool.line')).toBe(false);
    s.viewport.emitKey(key('r'));
    // The rectangle tool finishes at once: back to the default tool of the sketch mode.
    expect(s.tools.active.get()).toBe('sketch.select');
    expect(s.registry.run('tool.sketch.rectangle')).toBe(true);

    mode.set('model');
    expect(s.enabled('tool.sketch.rectangle')).toBe(false);
    expect(s.enabled('tool.line')).toBe(false);
    edit.cancel();
    expect(s.enabled('tool.line')).toBe(true);
  });

  it('feature.delete is disabled in the mode sketch and does not claim its shortcut', () => {
    const mode = new ObservableValue<Mode>('model');
    const s = setup({ mode });
    const a = s.addBox();
    s.select(a);
    expect(s.enabled('feature.delete')).toBe(true);
    mode.set('sketch');
    expect(s.enabled('feature.delete')).toBe(false);
    expect(s.registry.handleKey(key('Delete'))).toBe(false);
    expect(s.featureIds()).toEqual([a]);
  });
});
