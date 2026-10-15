import { createSequentialIdGenerator, ObservableValue } from '@/core';
import { createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type {
  BodyId,
  Evaluated,
  FeatureId,
  FeatureSchema,
  ParamSchemaOf,
  TopoName,
} from '@/document';
import { anOpsSession } from '@/ops/testing';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  FeatureEditor,
  FeatureEditSession,
} from '@/interaction/feature-dialog/feature-editor';
import { createFeatureEditor } from '@/interaction/feature-dialog/feature-editor';
import { createRefPickLayer } from '@/interaction/feature-dialog/ref-pick-tool';
import type { InputLayer } from '@/interaction/input-layer';
import { createManipulatorController } from '@/interaction/manipulators/manipulator-controller';
import type { ManipulatorController } from '@/interaction/manipulators/manipulator-controller';
import { createManipulatorRegistry } from '@/interaction/manipulators/manipulators';
import type { Mode } from '@/interaction/mode';
import { createSelectionModel } from '@/interaction/selection';
import { FakeRegenStatus, FakeViewport, aTopoNames } from '@/interaction/testing';
import { createToolManager } from '@/interaction/tool-manager';
import { createToolRegistry } from '@/interaction/tools';
import type { Tool, ToolContext, ToolDescriptor, ToolRegistry } from '@/interaction/tools';
import type {
  KeyMods,
  PickResult,
  ViewKeyEvent,
  ViewPointerEvent,
} from '@/interaction/viewport-port';

/** FeatureEditor is not needed by the manager itself; any use fails the test. */
function aFeatureEditorStub(): FeatureEditor {
  return {
    create: () => {
      throw new Error('FeatureEditor.create is not expected here');
    },
    edit: () => {
      throw new Error('FeatureEditor.edit is not expected here');
    },
    current: new ObservableValue<FeatureEditSession | null>(null),
  };
}

interface Recorder {
  readonly calls: string[];
  /** ctx of every activation, in order. */
  readonly contexts: ToolContext[];
}

interface ToolOptions {
  readonly onActivate?: (ctx: ToolContext) => void;
  readonly onKey?: (e: ViewKeyEvent) => boolean;
  readonly withoutOnKey?: boolean;
  readonly failCreate?: boolean;
  readonly failActivate?: boolean;
  readonly modes?: readonly Mode[];
}

/** A descriptor whose tools log their lifecycle and events into the shared recorder. */
function aRecordingTool(id: string, rec: Recorder, opts: ToolOptions = {}): ToolDescriptor {
  return {
    id,
    label: id,
    icon: id,
    group: 'primitive',
    ...(opts.modes === undefined ? {} : { modes: opts.modes }),
    create(): Tool {
      rec.calls.push(`${id}.create`);
      if (opts.failCreate === true) throw new Error(`${id} create failed`);
      const tool: Tool = {
        activate(ctx) {
          rec.calls.push(`${id}.activate`);
          rec.contexts.push(ctx);
          opts.onActivate?.(ctx);
          if (opts.failActivate === true) throw new Error(`${id} activate failed`);
        },
        deactivate() {
          rec.calls.push(`${id}.deactivate`);
        },
        onPointer(e) {
          rec.calls.push(`${id}.pointer:${e.type}`);
        },
      };
      if (opts.withoutOnKey === true) return tool;
      return {
        ...tool,
        onKey(e) {
          rec.calls.push(`${id}.key:${e.key}`);
          return opts.onKey?.(e) ?? false;
        },
      };
    },
  };
}

function key(k: string, mods: Partial<KeyMods> = {}, inTextField = false): ViewKeyEvent {
  return { key: k, mods: { shift: false, alt: false, mod: false, ...mods }, inTextField };
}

function pointer(type: ViewPointerEvent['type']): ViewPointerEvent {
  return { type, x: 1, y: 2, button: 'left', mods: { shift: false, alt: false, mod: false } };
}

function setup(
  options: {
    tools?: (rec: Recorder) => readonly ToolDescriptor[];
    selectOptions?: ToolOptions;
    unhandledKey?: (e: ViewKeyEvent) => boolean;
  } = {},
) {
  const rec: Recorder = { calls: [], contexts: [] };
  const registry: ToolRegistry = createToolRegistry();
  registry.register(aRecordingTool('select', rec, options.selectOptions));
  for (const d of options.tools?.(rec) ?? [aRecordingTool('box', rec)]) registry.register(d);
  const viewport = new FakeViewport();
  const session = anOpsSession();
  const ctx = {
    viewport,
    selection: createSelectionModel({ regen: new FakeRegenStatus() }),
    doc: session.doc,
    ids: createSequentialIdGenerator(),
    features: aFeatureEditorStub(),
  };
  const manager = createToolManager({
    registry,
    viewportEvents: viewport.events,
    ctx,
    defaultToolId: 'select',
    ...(options.unhandledKey === undefined ? {} : { unhandledKey: options.unhandledKey }),
  });
  const emitted: string[] = [];
  manager.active.subscribe(() => emitted.push(manager.active.get()));
  rec.calls.length = 0;
  rec.contexts.length = 0;
  return { manager, rec, viewport, ctx, emitted };
}

describe('createToolManager', () => {
  it('activates the default tool right away', () => {
    const rec: Recorder = { calls: [], contexts: [] };
    const registry = createToolRegistry();
    registry.register(aRecordingTool('select', rec));
    const session = anOpsSession();
    const viewport = new FakeViewport();
    const manager = createToolManager({
      registry,
      viewportEvents: viewport.events,
      ctx: {
        viewport,
        selection: createSelectionModel({ regen: new FakeRegenStatus() }),
        doc: session.doc,
        ids: createSequentialIdGenerator(),
        features: aFeatureEditorStub(),
      },
      defaultToolId: 'select',
    });
    expect(manager.active.get()).toBe('select');
    expect(rec.calls).toEqual(['select.create', 'select.activate']);
  });

  it('throws on an unknown default tool', () => {
    const session = anOpsSession();
    const viewport = new FakeViewport();
    expect(() =>
      createToolManager({
        registry: createToolRegistry(),
        viewportEvents: viewport.events,
        ctx: {
          viewport,
          selection: createSelectionModel({ regen: new FakeRegenStatus() }),
          doc: session.doc,
          ids: createSequentialIdGenerator(),
          features: aFeatureEditorStub(),
        },
        defaultToolId: 'select',
      }),
    ).toThrow(/select/);
  });

  it('passes the shared context plus finish to the tool', () => {
    const { manager, rec, ctx } = setup();
    manager.activate('box');
    const toolCtx = rec.contexts[0];
    expect(toolCtx?.viewport).toBe(ctx.viewport);
    expect(toolCtx?.selection).toBe(ctx.selection);
    expect(toolCtx?.doc).toBe(ctx.doc);
    expect(toolCtx?.ids).toBe(ctx.ids);
    expect(toolCtx?.features).toBe(ctx.features);
    expect(typeof toolCtx?.finish).toBe('function');
  });

  it('narrows the context to what tools use (ADR 0011, Q069)', () => {
    expectTypeOf<ToolContext>().not.toHaveProperty('ops');
    expectTypeOf<ToolContext['viewport']>().not.toHaveProperty('manipulators');
    expectTypeOf<ToolContext['viewport']>().not.toHaveProperty('events');
    expectTypeOf<ToolContext['viewport']>().not.toHaveProperty('sketches');
    expectTypeOf<ToolContext['viewport']>().not.toHaveProperty('project');
    expectTypeOf<ToolContext['viewport']['highlight']>().not.toHaveProperty('setSelection');
    expectTypeOf<ToolContext['features']>().not.toHaveProperty('edit');
  });

  describe('activate', () => {
    it('deactivates the previous tool, then creates and activates the new one', () => {
      const { manager, rec, emitted } = setup();
      manager.activate('box');
      expect(rec.calls).toEqual(['select.deactivate', 'box.create', 'box.activate']);
      expect(manager.active.get()).toBe('box');
      expect(emitted).toEqual(['box']);
    });

    it('creates a fresh tool on every activation', () => {
      const { manager, rec } = setup();
      manager.activate('box');
      manager.activate('select');
      rec.calls.length = 0;
      manager.activate('box');
      expect(rec.calls).toEqual(['select.deactivate', 'box.create', 'box.activate']);
    });

    it('does nothing for the id of the active tool', () => {
      const { manager, rec, emitted } = setup();
      manager.activate('select');
      expect(rec.calls).toEqual([]);
      expect(emitted).toEqual([]);
    });

    it('throws on an unknown id and keeps the active tool', () => {
      const { manager, rec, emitted, viewport } = setup();
      expect(() => {
        manager.activate('nope');
      }).toThrow(/nope/);
      expect(manager.active.get()).toBe('select');
      expect(rec.calls).toEqual([]);
      expect(emitted).toEqual([]);
      viewport.emitPointer(pointer('move'));
      expect(rec.calls).toEqual(['select.pointer:move']);
    });
  });

  describe('finish', () => {
    it('switches back to the default tool', () => {
      const { manager, rec, emitted } = setup();
      manager.activate('box');
      rec.calls.length = 0;
      rec.contexts[0]?.finish();
      expect(manager.active.get()).toBe('select');
      expect(rec.calls).toEqual(['box.deactivate', 'select.create', 'select.activate']);
      expect(emitted).toEqual(['box', 'select']);
    });

    it('called inside activate takes effect after activate returns', () => {
      const { manager, rec, emitted } = setup({
        tools: (r) => [
          aRecordingTool('box', r, {
            onActivate: (ctx) => {
              ctx.finish();
              r.calls.push('box.finished');
            },
          }),
        ],
      });
      manager.activate('box');
      expect(rec.calls).toEqual([
        'select.deactivate',
        'box.create',
        'box.activate',
        'box.finished',
        'box.deactivate',
        'select.create',
        'select.activate',
      ]);
      expect(emitted).toEqual(['box', 'select']);
      expect(manager.active.get()).toBe('select');
    });

    it('of an old context does nothing', () => {
      const { manager, rec, emitted } = setup({
        tools: (r) => [aRecordingTool('box', r), aRecordingTool('line', r)],
      });
      manager.activate('box');
      const boxCtx = rec.contexts[0];
      manager.activate('line');
      rec.calls.length = 0;
      emitted.length = 0;
      boxCtx?.finish();
      expect(manager.active.get()).toBe('line');
      expect(rec.calls).toEqual([]);
      expect(emitted).toEqual([]);
    });

    it('of an earlier activation of the same tool does nothing', () => {
      const { manager, rec } = setup();
      manager.activate('box');
      const first = rec.contexts[0];
      manager.activate('select');
      manager.activate('box');
      rec.calls.length = 0;
      first?.finish();
      expect(manager.active.get()).toBe('box');
      expect(rec.calls).toEqual([]);
    });

    it('of the default tool does nothing', () => {
      const { manager, rec, emitted } = setup();
      manager.activate('box');
      manager.activate('select');
      const selectCtx = rec.contexts[1];
      rec.calls.length = 0;
      emitted.length = 0;
      selectCtx?.finish();
      expect(manager.active.get()).toBe('select');
      expect(rec.calls).toEqual([]);
      expect(emitted).toEqual([]);
    });
  });

  describe('events', () => {
    it('go only to the active tool', () => {
      const { manager, rec, viewport } = setup();
      viewport.emitPointer(pointer('move'));
      manager.activate('box');
      rec.calls.length = 0;
      viewport.emitPointer(pointer('down'));
      viewport.emitKey(key('a'));
      expect(rec.calls).toEqual(['box.pointer:down', 'box.key:a']);
    });

    it('Escape ends a non-default tool', () => {
      const { manager, rec, viewport, emitted } = setup();
      manager.activate('box');
      rec.calls.length = 0;
      viewport.emitKey(key('Escape'));
      expect(rec.calls).toEqual([
        'box.key:Escape',
        'box.deactivate',
        'select.create',
        'select.activate',
      ]);
      expect(manager.active.get()).toBe('select');
      expect(emitted).toEqual(['box', 'select']);
    });

    it('Escape ends also a tool without onKey', () => {
      const { manager, viewport } = setup({
        tools: (r) => [aRecordingTool('box', r, { withoutOnKey: true })],
      });
      manager.activate('box');
      viewport.emitKey(key('Escape'));
      expect(manager.active.get()).toBe('select');
    });

    it('a tool whose onKey returns true captures Escape', () => {
      const unhandled: string[] = [];
      const { manager, viewport } = setup({
        tools: (r) => [aRecordingTool('box', r, { onKey: () => true })],
        unhandledKey: (e) => {
          unhandled.push(e.key);
          return true;
        },
      });
      manager.activate('box');
      viewport.emitKey(key('Escape'));
      expect(manager.active.get()).toBe('box');
      expect(unhandled).toEqual([]);
    });

    it.each([
      ['with Shift', key('Escape', { shift: true })],
      ['with Mod', key('Escape', { mod: true })],
      ['with Alt', key('Escape', { alt: true })],
      ['in a text field', key('Escape', {}, true)],
    ])('Escape %s does not end the tool and goes to unhandledKey', (_, e) => {
      const unhandled: ViewKeyEvent[] = [];
      const { manager, viewport } = setup({
        unhandledKey: (k) => {
          unhandled.push(k);
          return false;
        },
      });
      manager.activate('box');
      viewport.emitKey(e);
      expect(manager.active.get()).toBe('box');
      expect(unhandled).toEqual([e]);
    });

    it('Escape on the default tool goes to unhandledKey', () => {
      const unhandled: string[] = [];
      const { manager, viewport, rec } = setup({
        unhandledKey: (e) => {
          unhandled.push(e.key);
          return false;
        },
      });
      viewport.emitKey(key('Escape'));
      expect(manager.active.get()).toBe('select');
      expect(rec.calls).toEqual(['select.key:Escape']);
      expect(unhandled).toEqual(['Escape']);
    });

    it('other unhandled keys go to unhandledKey, handled ones do not', () => {
      const unhandled: string[] = [];
      const { manager, viewport } = setup({
        tools: (r) => [aRecordingTool('box', r, { onKey: (e) => e.key === 'Enter' })],
        unhandledKey: (e) => {
          unhandled.push(e.key);
          return true;
        },
      });
      manager.activate('box');
      viewport.emitKey(key('z', { mod: true }));
      viewport.emitKey(key('Enter'));
      expect(unhandled).toEqual(['z']);
    });

    it('works without unhandledKey', () => {
      const { viewport } = setup();
      expect(() => {
        viewport.emitKey(key('z'));
      }).not.toThrow();
    });
  });

  describe('a failing tool', () => {
    it.each([
      ['create', { failCreate: true }],
      ['activate', { failActivate: true }],
    ] as const)(
      'failing in %s is dropped without deactivate, the default tool comes back and the error flies on',
      (_, failure) => {
        const { manager, rec, emitted, viewport } = setup({
          tools: (r) => [aRecordingTool('box', r), aRecordingTool('broken', r, failure)],
        });
        manager.activate('box');
        rec.calls.length = 0;
        emitted.length = 0;
        expect(() => {
          manager.activate('broken');
        }).toThrow(/broken/);
        expect(rec.calls.filter((c) => c.endsWith('deactivate'))).toEqual(['box.deactivate']);
        expect(rec.calls.slice(-2)).toEqual(['select.create', 'select.activate']);
        expect(manager.active.get()).toBe('select');
        expect(emitted).toEqual(['select']);
        rec.calls.length = 0;
        viewport.emitPointer(pointer('move'));
        expect(rec.calls).toEqual(['select.pointer:move']);
      },
    );

    it('finish called before a failing activate does nothing extra', () => {
      const { manager, rec } = setup({
        tools: (r) => [
          aRecordingTool('broken', r, {
            failActivate: true,
            onActivate: (ctx) => {
              ctx.finish();
            },
          }),
        ],
      });
      expect(() => {
        manager.activate('broken');
      }).toThrow(/broken/);
      expect(manager.active.get()).toBe('select');
      expect(rec.calls.filter((c) => c === 'select.activate')).toHaveLength(1);
    });

    it('when the default tool fails too, no tool is active, events are dropped and the error flies on', () => {
      const unhandled: string[] = [];
      let failSelect = false;
      const { manager, rec, viewport } = setup({
        selectOptions: {
          onActivate: () => {
            if (failSelect) throw new Error('select activate failed');
          },
        },
        tools: (r) => [aRecordingTool('box', r)],
        unhandledKey: (e) => {
          unhandled.push(e.key);
          return false;
        },
      });
      manager.activate('box');
      failSelect = true;
      expect(() => rec.contexts[0]?.finish()).toThrow(/select activate failed/);
      rec.calls.length = 0;
      viewport.emitPointer(pointer('move'));
      viewport.emitKey(key('a'));
      expect(rec.calls).toEqual([]);
      expect(unhandled).toEqual([]);
    });

    it('when the default tool fails while replacing a failed tool, both errors fly on', () => {
      let failSelect = false;
      const { manager, viewport, rec } = setup({
        selectOptions: {
          onActivate: () => {
            if (failSelect) throw new Error('select activate failed');
          },
        },
        tools: (r) => [aRecordingTool('box', r), aRecordingTool('broken', r, { failCreate: true })],
      });
      manager.activate('box');
      failSelect = true;
      let thrown: unknown = null;
      try {
        manager.activate('broken');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AggregateError);
      const messages = (thrown instanceof AggregateError ? thrown.errors : []).map((e) =>
        e instanceof Error ? e.message : String(e),
      );
      expect(messages).toEqual(['broken create failed', 'select activate failed']);
      rec.calls.length = 0;
      viewport.emitPointer(pointer('move'));
      expect(rec.calls).toEqual([]);
    });

    it('a failing default tool makes createToolManager throw and leaves nothing subscribed', () => {
      const rec: Recorder = { calls: [], contexts: [] };
      const registry = createToolRegistry();
      registry.register(aRecordingTool('select', rec, { failActivate: true }));
      const viewport = new FakeViewport();
      const session = anOpsSession();
      const unhandled: string[] = [];
      expect(() =>
        createToolManager({
          registry,
          viewportEvents: viewport.events,
          ctx: {
            viewport,
            selection: createSelectionModel({ regen: new FakeRegenStatus() }),
            doc: session.doc,
            ids: createSequentialIdGenerator(),
            features: aFeatureEditorStub(),
          },
          defaultToolId: 'select',
          unhandledKey: (e) => {
            unhandled.push(e.key);
            return false;
          },
        }),
      ).toThrow(/select activate failed/);
      rec.calls.length = 0;
      viewport.emitPointer(pointer('move'));
      viewport.emitKey(key('a'));
      expect(rec.calls).toEqual([]);
      expect(unhandled).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('makes activate throw', () => {
      const { manager } = setup();
      manager.dispose();
      expect(() => {
        manager.activate('box');
      }).toThrow(/disposed/);
    });

    it('deactivates the active tool and stops forwarding events', () => {
      const unhandled: string[] = [];
      const { manager, rec, viewport, emitted } = setup({
        unhandledKey: (e) => {
          unhandled.push(e.key);
          return false;
        },
      });
      manager.activate('box');
      const boxCtx = rec.contexts[0];
      rec.calls.length = 0;
      emitted.length = 0;
      manager.dispose();
      expect(rec.calls).toEqual(['box.deactivate']);
      viewport.emitPointer(pointer('move'));
      viewport.emitKey(key('Escape'));
      viewport.emitKey(key('a'));
      boxCtx?.finish();
      expect(rec.calls).toEqual(['box.deactivate']);
      expect(unhandled).toEqual([]);
      expect(emitted).toEqual([]);
    });

    it('is idempotent', () => {
      const { manager, rec } = setup();
      manager.dispose();
      manager.dispose();
      expect(rec.calls).toEqual(['select.deactivate']);
    });
  });
});

// --- refPick: a focused reference param of the dialog covers the active tool (Q066) ---

interface RefParams {
  readonly width: number;
  readonly targets: readonly unknown[];
  readonly faces: readonly unknown[];
  readonly profile: readonly unknown[];
}

const REF_PARAMS: ParamSchemaOf<RefParams> = {
  width: { kind: 'length', label: 'Width', default: 10, min: 0 },
  targets: { kind: 'bodies', label: 'Targets' },
  faces: { kind: 'topo', label: 'Faces', entity: 'face' },
  profile: { kind: 'region', label: 'Profile' },
};

const REF_SCHEMA: FeatureSchema<RefParams> = {
  type: 'ref',
  version: 1,
  label: 'Ref',
  params: REF_PARAMS,
  defaults: () => ({ width: 10, targets: [], faces: [], profile: [] }),
  validate: (params) => validateAgainstSchema(REF_PARAMS, params),
};

const NO_MODS: KeyMods = { shift: false, alt: false, mod: false };

function at(
  type: ViewPointerEvent['type'],
  x: number,
  y: number,
  button: ViewPointerEvent['button'] = 'left',
): ViewPointerEvent {
  return { type, x, y, button, mods: NO_MODS };
}

function faceHit(body: string): PickResult {
  return {
    kind: 'face',
    body: body as BodyId, // test ids are trusted
    faceIndex: 0,
    point: [0, 0, 0],
    normal: [0, 0, 1],
  };
}

function edgeHit(body: string): PickResult {
  return {
    kind: 'edge',
    body: body as BodyId, // test ids are trusted
    edgeIndex: 2,
    point: [0, 0, 0],
  };
}

/** The filter of the last pick, sorted: the order of kinds has no meaning. */
function lastKinds(viewport: FakeViewport): readonly string[] | undefined {
  return viewport.lastFilter === undefined ? undefined : [...viewport.lastFilter].sort();
}

function setupRefPick(
  options: {
    unhandledKey?: (e: ViewKeyEvent) => boolean;
    regen?: FakeRegenStatus;
  } = {},
) {
  const rec: Recorder = { calls: [], contexts: [] };
  const registry: ToolRegistry = createToolRegistry();
  registry.register(aRecordingTool('select', rec));
  registry.register(aRecordingTool('box', rec));
  const viewport = new FakeViewport();
  const ops = anOpsSession();
  const schemas = createFeatureSchemaRegistry();
  schemas.register(REF_SCHEMA);
  const features = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('new'),
  });
  const ctx = {
    viewport,
    selection: createSelectionModel({ regen: new FakeRegenStatus() }),
    doc: ops.doc,
    ids: createSequentialIdGenerator(),
    features,
  };
  const unhandled =
    options.unhandledKey === undefined ? {} : { unhandledKey: options.unhandledKey };
  const refPick = createRefPickLayer({
    features,
    viewport,
    doc: ops.doc,
    ...unhandled,
    ...(options.regen === undefined ? {} : { regen: options.regen }),
  });
  const manager = createToolManager({
    registry,
    viewportEvents: viewport.events,
    ctx,
    defaultToolId: 'select',
    ...unhandled,
    layers: [refPick],
  });
  const emitted: string[] = [];
  manager.active.subscribe(() => emitted.push(manager.active.get()));
  rec.calls.length = 0;
  return { manager, refPick, rec, viewport, features, emitted };
}

function click(viewport: FakeViewport, x = 5, y = 5): void {
  viewport.emitPointer(at('down', x, y));
  viewport.emitPointer(at('up', x, y));
}

describe('createToolManager – the refPick layer', () => {
  it('routes events to refPick while a bodies param is focused; the active tool gets nothing', () => {
    const { manager, rec, viewport, features, emitted } = setupRefPick();
    manager.activate('box');
    rec.calls.length = 0;
    const session = features.create('ref');
    session.focusRefParam('targets');
    viewport.setPick(faceHit('f1/body'));

    viewport.emitPointer(at('move', 3, 4));
    expect(viewport.hover).toEqual(faceHit('f1/body'));
    viewport.emitPointer(at('leave', 3, 4));
    expect(viewport.hover).toBeNull();
    click(viewport);
    viewport.emitKey(key('a'));

    expect(rec.calls).toEqual([]);
    expect(manager.active.get()).toBe('box');
    expect(emitted).toEqual(['box']);
  });

  it('a click on a body adds { kind: body, body }, a second click removes it', () => {
    const { viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('targets');

    viewport.setPick(faceHit('f1/body'));
    click(viewport);
    viewport.setPick(faceHit('f2/body'));
    click(viewport);
    expect(session.state.get().params['targets']).toEqual([
      { kind: 'body', body: 'f1/body' },
      { kind: 'body', body: 'f2/body' },
    ]);

    viewport.setPick(faceHit('f1/body'));
    click(viewport);
    expect(session.state.get().params['targets']).toEqual([{ kind: 'body', body: 'f2/body' }]);
  });

  it('an edge hit adds its body as well', () => {
    const { viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('targets');
    viewport.setPick({
      kind: 'edge',
      body: 'f1/body' as BodyId, // test ids are trusted
      edgeIndex: 2,
      point: [0, 0, 0],
    });
    click(viewport);
    expect(session.state.get().params['targets']).toEqual([{ kind: 'body', body: 'f1/body' }]);
  });

  it('a bodies param picks faces and edges, also for the hover', () => {
    const { viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('targets');
    viewport.setPick(edgeHit('f1/body'));

    viewport.emitPointer(at('move', 1, 1));
    expect(lastKinds(viewport)).toEqual(['edge', 'face']);
    expect(viewport.hover).toEqual(edgeHit('f1/body'));
    viewport.pick(0, 0);
    click(viewport);
    expect(lastKinds(viewport)).toEqual(['edge', 'face']);
    expect(session.state.get().params['targets']).toEqual([{ kind: 'body', body: 'f1/body' }]);
  });

  it('a topo face param picks faces only: an edge is neither hovered nor added', () => {
    const { viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('faces');
    const before = session.state.get();
    viewport.setPick(edgeHit('f1/body'));
    viewport.highlight.setHover(faceHit('f2/body'));

    viewport.emitPointer(at('move', 1, 1));
    expect(viewport.lastFilter).toEqual(['face']);
    expect(viewport.hover).toBeNull();
    viewport.pick(0, 0);
    click(viewport);
    expect(viewport.lastFilter).toEqual(['face']);
    expect(session.state.get()).toBe(before);
  });

  it('a region param picks sketch regions only: a face is neither hovered nor added (M13)', () => {
    const { viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('profile');
    const before = session.state.get();
    viewport.setPick(faceHit('f1/body'));
    viewport.highlight.setHover(faceHit('f2/body'));

    viewport.emitPointer(at('move', 1, 1));
    expect(viewport.lastFilter).toEqual(['sketchRegion']);
    expect(viewport.hover).toBeNull();
    click(viewport);
    expect(session.state.get()).toBe(before);
  });

  it('switching the focused param clears the hover of the old one', () => {
    const { viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('targets');
    viewport.setPick(edgeHit('f1/body'));
    viewport.emitPointer(at('move', 1, 1));
    expect(viewport.hover).toEqual(edgeHit('f1/body'));

    // A face param does not allow the hovered edge: nothing stays highlighted.
    session.focusRefParam('faces');
    expect(viewport.hover).toBeNull();
  });

  it('the filter follows the focused param', () => {
    const { viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('targets');
    viewport.emitPointer(at('move', 1, 1));
    expect(lastKinds(viewport)).toEqual(['edge', 'face']);

    session.focusRefParam('faces');
    viewport.emitPointer(at('move', 1, 1));
    expect(lastKinds(viewport)).toEqual(['face']);
  });

  it('ignores a drag, an empty click and the right button', () => {
    const { viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('targets');
    const before = session.state.get();

    viewport.setPick(null);
    click(viewport);
    viewport.setPick(faceHit('f1/body'));
    viewport.emitPointer(at('down', 0, 0));
    viewport.emitPointer(at('up', 10, 0));
    viewport.emitPointer(at('down', 0, 0, 'right'));
    viewport.emitPointer(at('up', 0, 0, 'right'));
    viewport.emitPointer(at('up', 0, 0));

    expect(session.state.get()).toBe(before);
  });

  it('without regen a click into a topo param does nothing (M14)', () => {
    const { viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('faces');
    const before = session.state.get();
    viewport.setPick(faceHit('f1/body'));
    click(viewport);
    expect(session.state.get()).toBe(before);
  });

  it('with regen a click on a named face adds a TopoRef (M14)', () => {
    const regen = new FakeRegenStatus();
    const top = 'f1/face:top' as TopoName; // test names are trusted
    regen.publish(new Map(), [
      {
        body: 'f1/body' as BodyId, // test ids are trusted
        feature: 'f1' as FeatureId,
        names: aTopoNames({ faces: { [top]: [0] } }),
      },
    ]);
    const { viewport, features } = setupRefPick({ regen });
    const session = features.create('ref');
    session.focusRefParam('faces');
    viewport.setPick(faceHit('f1/body'));

    viewport.emitPointer(at('move', 1, 1));
    expect(viewport.hover).toEqual(faceHit('f1/body'));
    click(viewport);
    expect(session.state.get().params['faces']).toEqual([
      { kind: 'topo', body: 'f1/body', name: top },
    ]);
  });

  it('Escape drops the focus and the events go back to the active tool', () => {
    const unhandled: string[] = [];
    const { manager, rec, viewport, features } = setupRefPick({
      unhandledKey: (e) => {
        unhandled.push(e.key);
        return false;
      },
    });
    manager.activate('box');
    rec.calls.length = 0;
    const session = features.create('ref');
    session.focusRefParam('targets');

    viewport.emitKey(key('a'));
    viewport.emitKey(key('Escape', { shift: true }));
    expect(unhandled).toEqual(['a', 'Escape']);
    expect(session.state.get().activeRefParam).toBe('targets');

    viewport.emitKey(key('Escape'));
    expect(session.state.get().activeRefParam).toBeNull();
    expect(manager.active.get()).toBe('box');
    expect(rec.calls).toEqual([]);

    viewport.emitPointer(at('move', 1, 1));
    viewport.emitKey(key('b'));
    expect(rec.calls).toEqual(['box.pointer:move', 'box.key:b']);
  });

  it('dropping the focus from outside clears the hover', () => {
    const { viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('targets');
    viewport.setPick(faceHit('f1/body'));
    viewport.emitPointer(at('move', 1, 1));

    session.focusRefParam(null);
    expect(viewport.hover).toBeNull();
  });

  it('closing the session while focused clears the hover and gives events back', () => {
    const { rec, viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('targets');
    viewport.setPick(faceHit('f1/body'));
    viewport.emitPointer(at('move', 1, 1));

    session.cancel();
    expect(viewport.hover).toBeNull();
    viewport.emitPointer(at('move', 1, 1));
    expect(rec.calls).toEqual(['select.pointer:move']);
  });

  it('follows the next session', () => {
    const { rec, viewport, features } = setupRefPick();
    features.create('ref').commit();
    const second = features.create('ref');
    // create focuses the first reference param (R19); without a focus the active tool gets the events.
    second.focusRefParam(null);

    viewport.emitPointer(at('move', 1, 1));
    expect(rec.calls).toEqual(['select.pointer:move']);

    second.focusRefParam('targets');
    viewport.setPick(faceHit('f1/body'));
    click(viewport);
    expect(second.state.get().params['targets']).toEqual([{ kind: 'body', body: 'f1/body' }]);
    expect(rec.calls).toEqual(['select.pointer:move']);
  });

  it('dispose of the layer unsubscribes from the editor and the session', () => {
    const { refPick, viewport, features } = setupRefPick();
    const session = features.create('ref');
    session.focusRefParam('targets');
    refPick.dispose();
    expect(viewport.hover).toBeNull();

    viewport.setPick(faceHit('f1/body'));
    viewport.emitPointer(at('move', 1, 1));
    session.focusRefParam(null);
    session.focusRefParam('targets');
    session.cancel();
    features.create('ref').focusRefParam('targets');
    click(viewport);
    expect(viewport.hover).toBeNull();
  });
});

describe('createToolManager – modes', () => {
  function setupModes(
    options: {
      initial?: Mode;
      defaultToolIds?: Partial<Record<Mode, string>>;
      tools?: (rec: Recorder) => readonly ToolDescriptor[];
    } = {},
  ) {
    const rec: Recorder = { calls: [], contexts: [] };
    const registry: ToolRegistry = createToolRegistry();
    registry.register(aRecordingTool('select', rec));
    const tools = options.tools?.(rec) ?? [
      aRecordingTool('box', rec),
      aRecordingTool('sketch.select', rec, { modes: ['sketch'] }),
      aRecordingTool('sketch.line', rec, { modes: ['sketch'] }),
    ];
    for (const d of tools) registry.register(d);
    const mode = new ObservableValue<Mode>(options.initial ?? 'model');
    const viewport = new FakeViewport();
    const session = anOpsSession();
    const manager = createToolManager({
      registry,
      viewportEvents: viewport.events,
      ctx: {
        viewport,
        selection: createSelectionModel({ regen: new FakeRegenStatus() }),
        doc: session.doc,
        ids: createSequentialIdGenerator(),
        features: aFeatureEditorStub(),
      },
      defaultToolId: 'select',
      mode: mode.asObservable(),
      defaultToolIds: options.defaultToolIds ?? { sketch: 'sketch.select' },
    });
    const emitted: string[] = [];
    manager.active.subscribe(() => emitted.push(manager.active.get()));
    rec.calls.length = 0;
    rec.contexts.length = 0;
    return { manager, rec, viewport, mode, emitted };
  }

  it('starts with the default tool of the current mode', () => {
    const { manager } = setupModes({ initial: 'sketch' });
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('a change of mode deactivates the active tool and activates the default of the new mode', () => {
    const { manager, rec, mode, emitted } = setupModes();
    manager.activate('box');
    rec.calls.length = 0;
    emitted.length = 0;
    mode.set('sketch');
    expect(rec.calls).toEqual(['box.deactivate', 'sketch.select.create', 'sketch.select.activate']);
    expect(manager.active.get()).toBe('sketch.select');
    expect(emitted).toEqual(['sketch.select']);

    rec.calls.length = 0;
    mode.set('model');
    expect(rec.calls).toEqual(['sketch.select.deactivate', 'select.create', 'select.activate']);
    expect(manager.active.get()).toBe('select');
  });

  it('activate of a tool outside the mode throws and keeps the active tool', () => {
    const { manager, rec, mode, emitted } = setupModes();
    expect(() => {
      manager.activate('sketch.line');
    }).toThrow(/sketch\.line/);
    expect(manager.active.get()).toBe('select');

    mode.set('sketch');
    rec.calls.length = 0;
    emitted.length = 0;
    expect(() => {
      manager.activate('box');
    }).toThrow(/box/);
    expect(manager.active.get()).toBe('sketch.select');
    expect(rec.calls).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('a tool in both modes can be activated in either', () => {
    const { manager, mode } = setupModes({
      tools: (r) => [
        aRecordingTool('sketch.select', r, { modes: ['sketch'] }),
        aRecordingTool('measure', r, { modes: ['model', 'sketch'] }),
      ],
    });
    manager.activate('measure');
    expect(manager.active.get()).toBe('measure');
    mode.set('sketch');
    manager.activate('measure');
    expect(manager.active.get()).toBe('measure');
  });

  it('finish returns to the default tool of the current mode', () => {
    const { manager, rec, mode } = setupModes();
    mode.set('sketch');
    manager.activate('sketch.line');
    rec.calls.length = 0;
    rec.contexts.at(-1)?.finish();
    expect(manager.active.get()).toBe('sketch.select');
    expect(rec.calls).toEqual([
      'sketch.line.deactivate',
      'sketch.select.create',
      'sketch.select.activate',
    ]);
  });

  it('finish of the default tool of the mode does nothing', () => {
    const { manager, rec, mode, emitted } = setupModes();
    mode.set('sketch');
    const ctx = rec.contexts.at(-1);
    rec.calls.length = 0;
    emitted.length = 0;
    ctx?.finish();
    expect(manager.active.get()).toBe('sketch.select');
    expect(rec.calls).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('Escape returns to the default tool of the current mode', () => {
    const { manager, viewport, mode } = setupModes();
    mode.set('sketch');
    manager.activate('sketch.line');
    viewport.emitKey(key('Escape'));
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('a missing default tool of a mode throws at creation', () => {
    expect(() => setupModes({ defaultToolIds: {} })).toThrow(/sketch/);
    expect(() => setupModes({ defaultToolIds: { sketch: 'nope' } })).toThrow(/nope/);
  });

  it('a tool that switches the mode in activate leaves the default tool of the new mode active', () => {
    // The entry tool of the sketcher: it opens a sketch (mode 'sketch') and finishes.
    let switchMode = (): void => undefined;
    const { manager, rec, mode, emitted } = setupModes({
      tools: (r) => [
        aRecordingTool('sketch.select', r, { modes: ['sketch'] }),
        aRecordingTool('enter', r, {
          onActivate: (ctx) => {
            switchMode();
            ctx.finish();
          },
        }),
      ],
    });
    switchMode = () => {
      mode.set('sketch');
    };

    manager.activate('enter');

    expect(manager.active.get()).toBe('sketch.select');
    expect(emitted).toEqual(['sketch.select']);
    expect(rec.calls).toEqual([
      'select.deactivate',
      'enter.create',
      'enter.activate',
      'enter.deactivate',
      'sketch.select.create',
      'sketch.select.activate',
    ]);
  });

  it('dispose stops following the mode', () => {
    const { manager, rec, mode } = setupModes();
    manager.dispose();
    rec.calls.length = 0;
    mode.set('sketch');
    expect(rec.calls).toEqual([]);
  });
});

// --- manipulators (M18): the layer above refPick and the active tool ---

/** A ManipulatorController that records the events and handles what `handles` says. */
function aManipulatorStub(handles: {
  pointer?: (e: ViewPointerEvent) => boolean;
  key?: (e: ViewKeyEvent) => boolean;
}) {
  const calls: string[] = [];
  const controller: ManipulatorController = {
    onPointer(e) {
      calls.push(`pointer:${e.type}`);
      return handles.pointer?.(e) ?? false;
    },
    onKey(e) {
      calls.push(`key:${e.key}`);
      return handles.key?.(e) ?? false;
    },
    hud: new ObservableValue(null).asObservable(),
    setMode() {
      calls.push('setMode');
    },
    setValue() {
      calls.push('setValue');
    },
    dispose() {
      calls.push('dispose');
    },
  };
  return { controller, calls };
}

function setupManipulators(manipulators: ManipulatorController) {
  const rec: Recorder = { calls: [], contexts: [] };
  const registry: ToolRegistry = createToolRegistry();
  registry.register(aRecordingTool('select', rec));
  registry.register(aRecordingTool('box', rec));
  const viewport = new FakeViewport();
  const ops = anOpsSession();
  const ctx = {
    viewport,
    selection: createSelectionModel({ regen: new FakeRegenStatus() }),
    doc: ops.doc,
    ids: createSequentialIdGenerator(),
    features: aFeatureEditorStub(),
  };
  const unhandled: string[] = [];
  const manager = createToolManager({
    registry,
    viewportEvents: viewport.events,
    ctx,
    defaultToolId: 'select',
    unhandledKey: (e) => {
      unhandled.push(e.key);
      return false;
    },
    layers: [manipulators],
  });
  rec.calls.length = 0;
  return { manager, rec, viewport, unhandled };
}

describe('createToolManager – manipulators', () => {
  it('pointer events go to the manipulators first; unhandled ones reach the tool', () => {
    const { controller, calls } = aManipulatorStub({});
    const { rec, viewport } = setupManipulators(controller);
    viewport.emitPointer(at('move', 1, 2));
    viewport.emitPointer(at('down', 1, 2));
    expect(calls).toEqual(['pointer:move', 'pointer:down']);
    expect(rec.calls).toEqual(['select.pointer:move', 'select.pointer:down']);
  });

  it('a move over a handle does not reach the tool; it gets one leave at the same place', () => {
    let overHandle = false;
    const { controller } = aManipulatorStub({ pointer: (e) => e.type === 'move' && overHandle });
    const { rec, viewport, manager } = setupManipulators(controller);
    manager.activate('box');
    rec.calls.length = 0;

    viewport.emitPointer(at('move', 1, 1));
    overHandle = true;
    viewport.emitPointer(at('move', 2, 2));
    viewport.emitPointer(at('move', 3, 3));
    overHandle = false;
    viewport.emitPointer(at('move', 4, 4));
    overHandle = true;
    viewport.emitPointer(at('move', 5, 5));
    expect(rec.calls).toEqual([
      'box.pointer:move',
      'box.pointer:leave',
      'box.pointer:move',
      'box.pointer:leave',
    ]);
  });

  it('the synthetic leave carries the coordinates of the move', () => {
    const { controller } = aManipulatorStub({ pointer: (e) => e.type === 'move' });
    const seen: ViewPointerEvent[] = [];
    const rec: Recorder = { calls: [], contexts: [] };
    const registry: ToolRegistry = createToolRegistry();
    registry.register({
      ...aRecordingTool('select', rec),
      create: () => ({
        activate: () => undefined,
        deactivate: () => undefined,
        onPointer: (e) => seen.push(e),
      }),
    });
    const viewport = new FakeViewport();
    const ops = anOpsSession();
    createToolManager({
      registry,
      viewportEvents: viewport.events,
      ctx: {
        viewport,
        selection: createSelectionModel({ regen: new FakeRegenStatus() }),
        doc: ops.doc,
        ids: createSequentialIdGenerator(),
        features: aFeatureEditorStub(),
      },
      defaultToolId: 'select',
      layers: [controller],
    });
    viewport.emitPointer(at('move', 7, 8));
    expect(seen).toEqual([{ type: 'leave', x: 7, y: 8, button: 'left', mods: NO_MODS }]);
  });

  it('a real leave to the tool is not followed by a synthetic one', () => {
    let overHandle = false;
    const { controller } = aManipulatorStub({ pointer: (e) => e.type === 'move' && overHandle });
    const { rec, viewport } = setupManipulators(controller);
    viewport.emitPointer(at('leave', 1, 1));
    overHandle = true;
    viewport.emitPointer(at('move', 2, 2));
    expect(rec.calls).toEqual(['select.pointer:leave']);
  });

  it('handled downs, ups and leaves reach neither the tool nor a synthetic leave', () => {
    const { controller } = aManipulatorStub({ pointer: (e) => e.type !== 'move' });
    const { rec, viewport } = setupManipulators(controller);
    viewport.emitPointer(at('move', 1, 1));
    viewport.emitPointer(at('down', 1, 1));
    viewport.emitPointer(at('up', 1, 1));
    viewport.emitPointer(at('leave', 1, 1));
    expect(rec.calls).toEqual(['select.pointer:move']);
  });

  it('keys go to the manipulators first; a handled Escape does not end the tool', () => {
    const { controller, calls } = aManipulatorStub({ key: (e) => e.key === 'Escape' });
    const { rec, viewport, manager, unhandled } = setupManipulators(controller);
    manager.activate('box');
    rec.calls.length = 0;

    viewport.emitKey(key('Escape'));
    expect(rec.calls).toEqual([]);
    expect(manager.active.get()).toBe('box');
    expect(unhandled).toEqual([]);

    viewport.emitKey(key('x'));
    expect(calls).toEqual(['key:Escape', 'key:x']);
    expect(rec.calls).toEqual(['box.key:x']);
    expect(unhandled).toEqual(['x']);
  });

  it('dispose of the manager does not dispose the controller and stops routing to it', () => {
    const { controller, calls } = aManipulatorStub({});
    const { viewport, manager } = setupManipulators(controller);
    manager.dispose();
    viewport.emitPointer(at('move', 1, 1));
    viewport.emitKey(key('a'));
    expect(calls).toEqual([]);
  });

  it('with a real controller a left down on a handle reaches neither the tool nor refPick', () => {
    const rec: Recorder = { calls: [], contexts: [] };
    const registry: ToolRegistry = createToolRegistry();
    registry.register(aRecordingTool('select', rec));
    const viewport = new FakeViewport();
    const ops = anOpsSession();
    const schemas = createFeatureSchemaRegistry();
    schemas.register(REF_SCHEMA);
    const features = createFeatureEditor({
      doc: ops.doc,
      ops: ops.dispatcher,
      schemas,
      ids: createSequentialIdGenerator('new'),
    });
    const handles = createManipulatorRegistry();
    handles.register({
      type: 'ref',
      frame: (p: Evaluated<RefParams>) => ({
        center: [0, 0, 0],
        handles: [
          {
            kind: 'linear',
            id: 'w',
            position: [p.width, 0, 0],
            direction: [1, 0, 0],
            value: p.width,
            unit: 'length',
            tint: 'x',
            toParams: (v) => ({ width: v }),
          },
        ],
      }),
    });
    const regen = new FakeRegenStatus();
    const controller = createManipulatorController({
      features,
      regen,
      registry: handles,
      viewport,
    });
    createToolManager({
      registry,
      viewportEvents: viewport.events,
      ctx: {
        viewport,
        selection: createSelectionModel({ regen }),
        doc: ops.doc,
        ids: createSequentialIdGenerator(),
        features,
      },
      defaultToolId: 'select',
      layers: [controller, createRefPickLayer({ features, viewport, doc: ops.doc, regen })],
    });
    // create focuses 'targets': refPick covers the tool.
    const session = features.create('ref');
    regen.publish(
      new Map(),
      [],
      [],
      new Map([[session.featureId, { base: { point: [0, 0, 0] } }]]),
    );
    expect(session.state.get().activeRefParam).toBe('targets');
    viewport.setPick(faceHit('f1/body'));
    viewport.prepareHandlePick(() => 'w');
    rec.calls.length = 0;

    viewport.emitPointer(at('down', 10, 0));
    viewport.emitPointer(at('move', 12, 0));
    viewport.emitPointer(at('up', 12, 0));

    expect(rec.calls).toEqual([]);
    expect(session.state.get().params['targets']).toEqual([]);
    expect(session.state.get().params['width']).toBe(12);
  });
});

// --- layers of input (M20, A4.3): generic, in order before the active tool ---

/** A layer that records what it gets under its name and handles what `handles` says. */
function aRecordingLayer(
  name: string,
  calls: string[],
  handles: {
    pointer?: (e: ViewPointerEvent) => boolean;
    key?: (e: ViewKeyEvent) => boolean;
    leaveBelow?: boolean;
  } = {},
): InputLayer {
  return {
    ...(handles.leaveBelow === undefined ? {} : { leaveBelow: handles.leaveBelow }),
    onPointer(e) {
      calls.push(`${name}.pointer:${e.type}`);
      return handles.pointer?.(e) ?? false;
    },
    onKey(e) {
      calls.push(`${name}.key:${e.key}`);
      return handles.key?.(e) ?? false;
    },
  };
}

function setupLayers(layers: (calls: string[]) => readonly InputLayer[]) {
  const rec: Recorder = { calls: [], contexts: [] };
  const registry: ToolRegistry = createToolRegistry();
  registry.register(aRecordingTool('select', rec));
  const viewport = new FakeViewport();
  const ops = anOpsSession();
  const unhandled: string[] = [];
  const manager = createToolManager({
    registry,
    viewportEvents: viewport.events,
    ctx: {
      viewport,
      selection: createSelectionModel({ regen: new FakeRegenStatus() }),
      doc: ops.doc,
      ids: createSequentialIdGenerator(),
      features: aFeatureEditorStub(),
    },
    defaultToolId: 'select',
    unhandledKey: (e) => {
      rec.calls.push(`unhandled:${e.key}`);
      unhandled.push(e.key);
      return false;
    },
    layers: layers(rec.calls),
  });
  rec.calls.length = 0;
  return { manager, rec, viewport, unhandled };
}

describe('createToolManager – layers', () => {
  it('without layers the events go to the active tool as before', () => {
    const { rec, viewport } = setupLayers(() => []);
    viewport.emitPointer(at('move', 1, 1));
    viewport.emitKey(key('x'));
    expect(rec.calls).toEqual(['select.pointer:move', 'select.key:x', 'unhandled:x']);
  });

  it('asks the layers in their order before the tool', () => {
    const { rec, viewport } = setupLayers((calls) => [
      aRecordingLayer('a', calls),
      aRecordingLayer('b', calls),
    ]);
    viewport.emitPointer(at('down', 1, 1));
    viewport.emitKey(key('x'));
    expect(rec.calls).toEqual([
      'a.pointer:down',
      'b.pointer:down',
      'select.pointer:down',
      'a.key:x',
      'b.key:x',
      'select.key:x',
      'unhandled:x',
    ]);
  });

  it('a layer that handles an event does not pass it on', () => {
    const { rec, viewport } = setupLayers((calls) => [
      aRecordingLayer('a', calls, { pointer: (e) => e.type === 'down', key: (e) => e.key === 'x' }),
      aRecordingLayer('b', calls),
    ]);
    viewport.emitPointer(at('down', 1, 1));
    viewport.emitKey(key('x'));
    expect(rec.calls).toEqual(['a.pointer:down', 'a.key:x']);
  });

  it('a lower layer that handles the synthetic leave keeps it from the tool', () => {
    let overHandle = false;
    const { rec, viewport } = setupLayers((calls) => [
      aRecordingLayer('a', calls, { pointer: (e) => e.type === 'move' && overHandle }),
      aRecordingLayer('b', calls, { pointer: () => true }),
    ]);
    viewport.emitPointer(at('move', 1, 1));
    overHandle = true;
    viewport.emitPointer(at('move', 2, 2));
    viewport.emitPointer(at('move', 3, 3));
    // b takes the first move itself, so the tool gets its one leave there, not from a.
    expect(rec.calls).toEqual([
      'a.pointer:move',
      'b.pointer:move',
      'select.pointer:leave',
      'a.pointer:move',
      'b.pointer:leave',
      'a.pointer:move',
    ]);
  });

  it('the synthetic leave passes through a lower layer that does not handle it', () => {
    let overHandle = false;
    const { rec, viewport } = setupLayers((calls) => [
      aRecordingLayer('a', calls, { pointer: (e) => e.type === 'move' && overHandle }),
      aRecordingLayer('b', calls),
    ]);
    viewport.emitPointer(at('move', 1, 1));
    overHandle = true;
    viewport.emitPointer(at('move', 2, 2));
    expect(rec.calls).toEqual([
      'a.pointer:move',
      'b.pointer:move',
      'select.pointer:move',
      'a.pointer:move',
      'b.pointer:leave',
      'select.pointer:leave',
    ]);
  });

  it('a layer with leaveBelow false takes a move without a synthetic leave below', () => {
    let covering = false;
    const { rec, viewport } = setupLayers((calls) => [
      aRecordingLayer('a', calls, { pointer: () => covering, leaveBelow: false }),
    ]);
    viewport.emitPointer(at('move', 1, 1));
    covering = true;
    viewport.emitPointer(at('move', 2, 2));
    covering = false;
    viewport.emitPointer(at('move', 3, 3));
    expect(rec.calls).toEqual([
      'a.pointer:move',
      'select.pointer:move',
      'a.pointer:move',
      'a.pointer:move',
      'select.pointer:move',
    ]);
  });

  it('after dispose no layer gets an event', () => {
    const { manager, rec, viewport } = setupLayers((calls) => [aRecordingLayer('a', calls)]);
    manager.dispose();
    rec.calls.length = 0;
    viewport.emitPointer(at('move', 1, 1));
    viewport.emitKey(key('x'));
    expect(rec.calls).toEqual([]);
  });
});
