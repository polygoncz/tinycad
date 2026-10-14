import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import { ORIGIN_AXIS_IDS, ORIGIN_PLANE_IDS, bodyId, createFeatureSchemaRegistry } from '@/document';
import type { FeatureId, FeatureInstance, TopoName } from '@/document';
import { aFeature } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createManipulatorRegistry,
  createToolRegistry,
} from '@/interaction';
import type { FeatureEditor, FeatureEditSession } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createFakeKernel } from '@/kernel/testing';
import { anOpsSession } from '@/ops/testing';
import { registerPlugin } from '@/plugin-api';
import {
  EMPTY_NAMES,
  EMPTY_STATE,
  bodiesOf,
  createBuilderRegistry,
  createRegenerator,
} from '@/regen';
import type { Body, RegenState } from '@/regen';
import { aBuildContext, stoppedClock } from '@/regen/testing';
import { boxBuilder } from './builder';
import { boxSchema } from './schema';
import type { BoxParams } from './schema';
import { boxMessages } from './messages';
import { boxTool } from './tool';
import * as box from '.';

/** The origin planes and axes EMPTY_STATE is seeded with (spec 07); every builder keeps them in front. */
const ORIGIN_KEYS: readonly string[] = [
  ORIGIN_PLANE_IDS.xy,
  ORIGIN_PLANE_IDS.xz,
  ORIGIN_PLANE_IDS.yz,
  ORIGIN_AXIS_IDS.x,
  ORIGIN_AXIS_IDS.y,
  ORIGIN_AXIS_IDS.z,
];

function topo(name: string): TopoName {
  // Test data: the name as propagateNames mints it for the box.
  return name as TopoName;
}

function aBox(id: string, params: Partial<BoxParams> = {}): FeatureInstance<BoxParams> {
  return aFeature({ id, type: 'box', params: { ...boxSchema.defaults(), ...params } });
}

async function build(
  feature: FeatureInstance<BoxParams>,
  state: RegenState = EMPTY_STATE,
  kernel = createFakeKernel(),
): Promise<RegenState> {
  const output = await boxBuilder.build({ feature, state }, aBuildContext(kernel, state));
  if (!output.ok) expect.fail(`Unexpected build error: ${output.error.message}`);
  return output.state;
}

describe('box public API', () => {
  it('exports exactly boxPlugin', () => {
    expect(Object.keys(box)).toEqual(['boxPlugin']);
  });

  it('boxPlugin joins the schema and the builder of type box', () => {
    expect(box.boxPlugin.schema).toBe(boxSchema);
    expect(box.boxPlugin.builder).toBe(boxBuilder);
    expect(boxSchema.type).toBe('box');
    expect(boxBuilder.type).toBe('box');
  });

  it('boxPlugin brings the messages of the box', () => {
    expect(box.boxPlugin.messages).toBe(boxMessages);
  });

  it('boxPlugin brings the box tool', () => {
    expect(box.boxPlugin.tools).toEqual([boxTool]);
  });

  it('registers schema, builder and tool through registerPlugin', () => {
    const regs = {
      schemas: createFeatureSchemaRegistry(),
      builders: createBuilderRegistry(),
      tools: createToolRegistry(),
      manipulators: createManipulatorRegistry(),
    };
    registerPlugin(box.boxPlugin, regs);
    expect(regs.tools.get('box')).toBe(boxTool);
  });
});

describe('boxSchema', () => {
  it('is version 1 of type box', () => {
    expect(boxSchema).toMatchObject({ type: 'box', version: 1, label: 'box.label' });
  });

  it('has the Tabler icon box for the timeline', () => {
    expect(boxSchema.icon).toBe('box');
  });

  it('labels are translation keys (ADR 0014)', () => {
    expect(Object.entries(boxSchema.params).map(([key, spec]) => [key, spec.label])).toEqual([
      ['origin', 'box.origin'],
      ['width', 'box.width'],
      ['depth', 'box.depth'],
      ['height', 'box.height'],
    ]);
  });

  it('sizes have the exclusive lower bound 0 (Q050)', () => {
    for (const key of ['width', 'depth', 'height']) {
      expect(boxSchema.params[key], key).toMatchObject({ min: 0, exclusiveMin: true });
    }
  });

  it('is frozen deeply, param specs and the origin default included', () => {
    expect(Object.isFrozen(boxSchema)).toBe(true);
    expect(Object.isFrozen(boxSchema.params)).toBe(true);
    for (const [key, spec] of Object.entries(boxSchema.params)) {
      expect(Object.isFrozen(spec), key).toBe(true);
    }
    const origin = boxSchema.params['origin'];
    if (origin?.kind !== 'point') expect.fail('origin is not a point param');
    expect(Object.isFrozen(origin.default)).toBe(true);
  });

  it('defaults pass validation', () => {
    expect(boxSchema.validate(boxSchema.defaults())).toEqual([]);
  });

  it('defaults returns a new object every call', () => {
    const a = boxSchema.defaults();
    const b = boxSchema.defaults();
    expect(a).not.toBe(b);
    expect(a.origin).not.toBe(b.origin);
    expect(a).toEqual(b);
  });

  it.each(['width', 'depth', 'height'] as const)('rejects a zero or negative %s', (key) => {
    for (const value of [0, -0, -1]) {
      const issues = boxSchema.validate({ ...boxSchema.defaults(), [key]: value });
      expect(issues, `${key} = ${String(value)}`).toEqual([
        { param: key, code: 'param.atOrBelowMin', params: { min: 0 } },
      ]);
    }
  });

  it.each(['width', 'depth', 'height'] as const)('rejects a NaN or infinite %s', (key) => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const issues = boxSchema.validate({ ...boxSchema.defaults(), [key]: value });
      expect(issues, `${key} = ${String(value)}`).toEqual([
        { param: key, code: 'param.wrongType' },
      ]);
    }
  });

  it('accepts a small positive size', () => {
    expect(boxSchema.validate({ ...boxSchema.defaults(), width: 1e-9 })).toEqual([]);
  });

  it.each([[[0, 0]], [[0, 0, 0, 0]], [[0, 0, Number.NaN]], ['0,0,0'], [undefined]])(
    'rejects origin %j',
    (origin) => {
      const issues = boxSchema.validate({ ...boxSchema.defaults(), origin });
      expect(issues.map((i) => i.param)).toEqual(['origin']);
    },
  );

  it('rejects params that are not an object, missing and unexpected params', () => {
    expect(boxSchema.validate(null)).not.toEqual([]);
    const withoutWidth = Object.fromEntries(
      Object.entries(boxSchema.defaults()).filter(([key]) => key !== 'width'),
    );
    expect(boxSchema.validate(withoutWidth).map((i) => i.param)).toEqual(['width']);
    expect(boxSchema.validate({ ...boxSchema.defaults(), size: 1 }).map((i) => i.param)).toEqual([
      'size',
    ]);
  });
});

describe('boxMessages', () => {
  /** Every translation key of the schema: its label, the param labels and enum option labels. */
  function schemaKeys(): readonly string[] {
    return [
      boxSchema.label,
      ...Object.values(boxSchema.params).flatMap((spec) => [
        spec.label,
        ...(spec.kind === 'enum' ? spec.options.map((o) => o.label) : []),
      ]),
    ];
  }

  it.each(['cs', 'en'] as const)('%s has a text for every key of the schema', (lang) => {
    for (const key of schemaKeys()) {
      expect(boxMessages[lang][key], `${lang}: ${key}`).toEqual(expect.any(String));
      expect(boxMessages[lang][key], `${lang}: ${key}`).not.toBe('');
    }
  });

  it('cs and en have the same keys', () => {
    expect(Object.keys(boxMessages.cs).sort()).toEqual(Object.keys(boxMessages.en).sort());
  });

  it('names the box Kvádr and Box', () => {
    expect(boxMessages.cs['box.label']).toBe('Kvádr');
    expect(boxMessages.en['box.label']).toBe('Box');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(boxMessages)).toBe(true);
    expect(Object.isFrozen(boxMessages.cs)).toBe(true);
    expect(Object.isFrozen(boxMessages.en)).toBe(true);
  });
});

describe('boxBuilder', () => {
  it('adds one body bodyId(feature), created and last modified by the feature (ADR 0015)', async () => {
    const feature = aBox('b1');
    const state = await build(feature);
    const id = bodyId(feature.id);
    expect([...state.artifacts.keys()]).toEqual([...ORIGIN_KEYS, id]);
    expect(state.artifacts.get(id)).toMatchObject({
      kind: 'body',
      id: 'b1/body',
      origin: 'b1',
      lastModifiedBy: 'b1',
    });
  });

  it('names the faces by their roles and all 12 edges (spec 08, M14)', async () => {
    const feature = aBox('b1');
    const state = await build(feature);
    const body = state.artifacts.get(bodyId(feature.id));
    if (body?.kind !== 'body') expect.fail('No body');
    expect(body.names).not.toBe(EMPTY_NAMES);
    expect([...body.names.faceEntries]).toEqual([
      ['b1/face:back', [3]],
      ['b1/face:bottom', [4]],
      ['b1/face:front', [2]],
      ['b1/face:left', [0]],
      ['b1/face:right', [1]],
      ['b1/face:top', [5]],
    ]);
    expect(body.names.faces(topo('b1/face:top'))).toEqual([5]);
    const named = [...body.names.edgeEntries.values()].flat().sort((a, b) => a - b);
    expect(named).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(body.names.topology.edges).toHaveLength(12);
  });

  it('makes a box spanning origin + size', async () => {
    const kernel = createFakeKernel();
    const feature = aBox('b1', { origin: [1, 2, 3], width: 4, depth: 5, height: 6 });
    const state = await build(feature, EMPTY_STATE, kernel);
    const body = state.artifacts.get(bodyId(feature.id));
    if (body?.kind !== 'body') expect.fail('No body');
    expect(await kernel.boundingBox(body.shape)).toEqual({ min: [1, 2, 3], max: [5, 7, 9] });
  });

  it('keeps the artifacts of the input state and does not change it', async () => {
    const kernel = createFakeKernel();
    const b1 = aBox('b1');
    const first = await build(b1, EMPTY_STATE, kernel);
    const firstBody = first.artifacts.get(bodyId(b1.id));
    const second = await build(aBox('b2'), first, kernel);
    expect([...first.artifacts.keys()]).toEqual([...ORIGIN_KEYS, 'b1/body']);
    expect([...second.artifacts.keys()]).toEqual([...ORIGIN_KEYS, 'b1/body', 'b2/body']);
    expect(second.artifacts.get(bodyId(b1.id))).toBe(firstBody);
    expect([...EMPTY_STATE.artifacts.keys()]).toEqual(ORIGIN_KEYS);
  });

  it('freezes the output state and the new body', async () => {
    const feature = aBox('b1');
    const state = await build(feature);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.artifacts.get(bodyId(feature.id)))).toBe(true);
  });
});

describe('box plugin in the Regenerator', () => {
  it('regenerates a studio with two boxes into two bodies', async () => {
    const kernel = createFakeKernel();
    const schemas = createFeatureSchemaRegistry();
    const builders = createBuilderRegistry();
    registerPlugin(box.boxPlugin, {
      schemas,
      builders,
      tools: createToolRegistry(),
      manipulators: createManipulatorRegistry(),
    });
    const regenerator = createRegenerator({ kernel, schemas, builders, now: stoppedClock });
    const features = [aBox('b1'), aBox('b2', { origin: [20, 0, 0] })];

    const result = await regenerator.run({ features, rollbackIndex: features.length });

    if (result === 'superseded') expect.fail('Unexpected superseded run');
    const bodies: readonly Body[] = bodiesOf(result.finalState);
    expect(bodies.map((b) => [b.id, b.origin, b.lastModifiedBy])).toEqual([
      ['b1/body', 'b1', 'b1'],
      ['b2/body', 'b2', 'b2'],
    ]);
    expect([...result.statuses]).toEqual([
      ['b1' as FeatureId, { kind: 'ok' }],
      ['b2' as FeatureId, { kind: 'ok' }],
    ]);
    expect(await kernel.liveHandleCount()).toBe(2);
  });
});

/** A FeatureEditor that records create calls; `open` pretends a session is already open. */
function aRecordingEditor(open = false) {
  const created: string[] = [];
  const session: FeatureEditSession = {
    mode: 'create',
    featureId: aFeature().id,
    schema: boxSchema,
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
  const ops = anOpsSession();
  const manager = createToolManager({
    registry,
    ctx: {
      viewport: new FakeViewport(),
      selection: createSelectionModel({ regen: new FakeRegenStatus() }),
      doc: ops.doc,
      ops: ops.dispatcher,
      ids: createSequentialIdGenerator('t'),
      features: editor,
    },
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
