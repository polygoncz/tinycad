import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import type { Vec3 } from '@/core';
import { bodyId, createFeatureSchemaRegistry } from '@/document';
import type { FeatureId, FeatureInstance, TopoName, TopoRef } from '@/document';
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
import type { ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { anOpsSession } from '@/ops/testing';
import { registerPlugin } from '@/plugin-api';
import { createBuilderRegistry, nameShape } from '@/regen';
import type { ArtifactId, Body, BuildOutput, ModelingKernel, NameTable, RegenState } from '@/regen';
import { aBuildContext, aBuildInput, aNameTable } from '@/regen/testing';
import { chamferBuilder } from '@/features/chamfer/builder';
import { chamferSchema } from '@/features/chamfer/schema';
import type { ChamferParams } from '@/features/chamfer/schema';
import { chamferMessages } from '@/features/chamfer/messages';
import { chamferTool } from '@/features/chamfer/tool';
import * as chamfer from '@/features/chamfer';

// ---------------------------------------------------------------------------------------------
// Helpers

function edge(body: string, name: string): TopoRef {
  // Test data: the hand-written strings stand for names minted by propagateNames.
  return { kind: 'topo', body: bodyId(body as FeatureId), name: name as TopoName };
}

function aChamfer(id: string, params: Partial<ChamferParams> = {}): FeatureInstance<ChamferParams> {
  return aFeature({
    id,
    type: 'chamfer',
    params: { ...chamferSchema.defaults(), edges: [edge('a', 'e3')], ...params },
  });
}

/** A kernel call of chamfer, as the builder made it. */
interface ChamferCall {
  readonly shape: ShapeHandle;
  readonly edges: readonly number[];
  readonly distance: number;
}

/** The FakeKernel with every chamfer call recorded (a copy of the edge list). */
function aRecordingKernel() {
  const fake = createFakeKernel();
  const calls: ChamferCall[] = [];
  const kernel: ModelingKernel = {
    makeBox: (p) => fake.makeBox(p),
    makeCylinder: (p) => fake.makeCylinder(p),
    transform: (shape, m) => fake.transform(shape, m),
    boolean: (op, targets, tools) => fake.boolean(op, targets, tools),
    makeFace: (p) => fake.makeFace(p),
    profileRegions: (p) => fake.profileRegions(p),
    curveIntersections: (p) => fake.curveIntersections(p),
    curveSegment: (p) => fake.curveSegment(p),
    filletArc: (p) => fake.filletArc(p),
    extrude: (profile, direction, distance) => fake.extrude(profile, direction, distance),
    revolve: (profile, axis, angle) => fake.revolve(profile, axis, angle),
    fillet: (shape, edges, radius) => fake.fillet(shape, edges, radius),
    chamfer(shape, edges, distance) {
      calls.push({ shape, edges: [...edges], distance });
      return fake.chamfer(shape, edges, distance);
    },
    boundingBox: (shape) => fake.boundingBox(shape),
    topology: (shape) => fake.topology(shape),
  };
  return { fake, kernel, calls };
}

const UNIT: Vec3 = [10, 10, 10];

/**
 * A state with one box body per key, created by the feature of that name. Each body has the
 * edge names e3 → [3] and e7 → [7] over the real topology of its box (the kernel history of the
 * chamfer refers to all its faces).
 */
async function boxesState(
  kernel: ModelingKernel,
  features: readonly string[],
): Promise<RegenState> {
  const artifacts = new Map<ArtifactId, Body>();
  for (const [k, feature] of features.entries()) {
    const { shape } = await kernel.makeBox({ origin: [20 * k, 0, 0], size: UNIT });
    const names = aNameTable({
      edges: { e3: [3], e7: [7] },
      topology: await kernel.topology(shape),
    });
    const id = bodyId(feature as FeatureId);
    artifacts.set(
      id,
      Object.freeze({
        kind: 'body',
        id,
        origin: feature as FeatureId,
        lastModifiedBy: feature as FeatureId,
        shape,
        names,
      }),
    );
  }
  return Object.freeze({ artifacts });
}

async function run(
  feature: FeatureInstance<ChamferParams>,
  state: RegenState,
  kernel: ModelingKernel,
): Promise<BuildOutput> {
  return chamferBuilder.build(aBuildInput(feature, state), aBuildContext(kernel, state));
}

async function build(
  feature: FeatureInstance<ChamferParams>,
  state: RegenState,
  kernel: ModelingKernel,
): Promise<RegenState> {
  const output = await run(feature, state, kernel);
  if (!output.ok) expect.fail(`Unexpected build error: ${output.error.message}`);
  return output.state;
}

function bodyOf(state: RegenState, feature: string): Body {
  const body = state.artifacts.get(bodyId(feature as FeatureId));
  if (body?.kind !== 'body') expect.fail(`No body of ${feature}`);
  return body;
}

// ---------------------------------------------------------------------------------------------

describe('chamfer public API', () => {
  it('exports exactly chamferPlugin', () => {
    expect(Object.keys(chamfer)).toEqual(['chamferPlugin']);
  });

  it('chamferPlugin joins the schema, the builder, the tool and the messages', () => {
    expect(chamfer.chamferPlugin.schema).toBe(chamferSchema);
    expect(chamfer.chamferPlugin.builder).toBe(chamferBuilder);
    expect(chamfer.chamferPlugin.tools).toEqual([chamferTool]);
    expect(chamfer.chamferPlugin.messages).toBe(chamferMessages);
    expect(chamferSchema.type).toBe('chamfer');
    expect(chamferBuilder.type).toBe('chamfer');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(chamfer.chamferPlugin)).toBe(true);
    expect(Object.isFrozen(chamfer.chamferPlugin.tools)).toBe(true);
  });

  it('registers schema, builder and tool through registerPlugin', () => {
    const regs = {
      schemas: createFeatureSchemaRegistry(),
      builders: createBuilderRegistry(),
      tools: createToolRegistry(),
      manipulators: createManipulatorRegistry(),
    };
    registerPlugin(chamfer.chamferPlugin, regs);
    expect(regs.schemas.get('chamfer')).toBe(chamferSchema);
    expect(regs.builders.get('chamfer')).toBe(chamferBuilder);
    expect(regs.tools.get('chamfer')).toBe(chamferTool);
  });
});

describe('chamferSchema', () => {
  it('is version 1 of type chamfer with the Tabler icon border-corner-square', () => {
    expect(chamferSchema).toMatchObject({
      type: 'chamfer',
      version: 1,
      label: 'chamfer.label',
      icon: 'border-corner-square',
    });
  });

  it('has the params edges, distance in this order with key labels (ADR 0014)', () => {
    expect(Object.entries(chamferSchema.params).map(([key, spec]) => [key, spec.label])).toEqual([
      ['edges', 'chamfer.edges'],
      ['distance', 'chamfer.distance'],
    ]);
  });

  it('needs at least one edge and a distance > 0 of 1 by default', () => {
    expect(chamferSchema.params['edges']).toEqual({
      kind: 'topo',
      label: 'chamfer.edges',
      entity: 'edge',
      min: 1,
    });
    expect(chamferSchema.params['distance']).toEqual({
      kind: 'length',
      label: 'chamfer.distance',
      default: 1,
      min: 0,
      exclusiveMin: true,
    });
  });

  it('is frozen deeply', () => {
    expect(Object.isFrozen(chamferSchema)).toBe(true);
    expect(Object.isFrozen(chamferSchema.params)).toBe(true);
    for (const spec of Object.values(chamferSchema.params))
      expect(Object.isFrozen(spec)).toBe(true);
  });

  it('defaults are no edges and the distance 1, a new object every call', () => {
    expect(chamferSchema.defaults()).toEqual({ edges: [], distance: 1 });
    expect(chamferSchema.defaults()).not.toBe(chamferSchema.defaults());
  });

  it('defaults alone ask for an edge (R24)', () => {
    expect(chamferSchema.validate(chamferSchema.defaults())).toEqual([
      { param: 'edges', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
  });

  it('defaults with one edge pass validation', () => {
    expect(
      chamferSchema.validate({ ...chamferSchema.defaults(), edges: [edge('a', 'e3')] }),
    ).toEqual([]);
  });

  it('rejects a distance of 0 and a reference of another kind', () => {
    expect(chamferSchema.validate({ edges: [edge('a', 'e3')], distance: 0 })).toEqual([
      { param: 'distance', code: 'param.atOrBelowMin', params: { min: 0 } },
    ]);
    expect(
      chamferSchema.validate({ edges: [{ kind: 'body', body: 'a/body' }], distance: 1 }),
    ).toEqual([{ param: 'edges', code: 'param.invalidRef', params: { index: 0 } }]);
  });

  it('rejects the same edge twice with param.duplicateRef', () => {
    expect(
      chamferSchema.validate({ edges: [edge('a', 'e3'), edge('a', 'e3')], distance: 1 }),
    ).toEqual([{ param: 'edges', code: 'param.duplicateRef', params: { index: 1 } }]);
  });
});

describe('chamferMessages', () => {
  it('has the texts of the plan', () => {
    expect(chamferMessages.cs).toEqual({
      'chamfer.label': 'Zkosení',
      'chamfer.edges': 'Hrany',
      'chamfer.distance': 'Vzdálenost',
      'chamfer.failed': 'Zkosení se nepodařilo. Zkuste menší vzdálenost nebo jiné hrany.',
    });
    expect(chamferMessages.en).toEqual({
      'chamfer.label': 'Chamfer',
      'chamfer.edges': 'Edges',
      'chamfer.distance': 'Distance',
      'chamfer.failed': 'The chamfer failed. Try a smaller distance or other edges.',
    });
  });

  it.each(['cs', 'en'] as const)(
    '%s has a text for every key of the schema and the issue code of the builder',
    (lang) => {
      const keys = [
        chamferSchema.label,
        ...Object.values(chamferSchema.params).map((s) => s.label),
        'chamfer.failed',
      ];
      expect(Object.keys(chamferMessages[lang]).sort()).toEqual([...keys].sort());
    },
  );

  it('is frozen', () => {
    expect(Object.isFrozen(chamferMessages)).toBe(true);
    expect(Object.isFrozen(chamferMessages.cs)).toBe(true);
    expect(Object.isFrozen(chamferMessages.en)).toBe(true);
  });
});

describe('chamferBuilder', () => {
  it('chamfers the named edge with one kernel call and keeps the identity of the body', async () => {
    const { kernel, calls } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);
    const input = bodyOf(state, 'a');

    const out = await build(aChamfer('f', { distance: 2 }), state, kernel);

    expect(calls).toEqual([{ shape: input.shape, edges: [3], distance: 2 }]);
    const body = bodyOf(out, 'a');
    expect(body).toMatchObject({ kind: 'body', id: 'a/body', origin: 'a', lastModifiedBy: 'f' });
    expect(body.shape).not.toBe(input.shape);
    expect(Object.isFrozen(body)).toBe(true);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('names the result through nameShape with the tag chamfer over the names of the body', async () => {
    const { kernel } = aRecordingKernel();
    const box = await kernel.makeBox({ origin: [0, 0, 0], size: UNIT });
    const { shape } = box;
    // The names of a box feature: its roles (spec 08, rule 1).
    const names: NameTable = await nameShape({
      kernel,
      featureId: 'a' as FeatureId,
      result: box,
      inputs: [],
    });
    const name = names.nameOfEdge(3);
    if (name === undefined) expect.fail('The box has no name of edge 3');
    const id = bodyId('a' as FeatureId);
    const body: Body = Object.freeze({
      kind: 'body',
      id,
      origin: 'a' as FeatureId,
      lastModifiedBy: 'a' as FeatureId,
      shape,
      names,
    });
    const state: RegenState = Object.freeze({ artifacts: new Map([[id, body]]) });

    const out = await build(
      aChamfer('f', { edges: [{ kind: 'topo', body: id, name }] }),
      state,
      kernel,
    );

    // The fake keeps every face (identity history), so the names carry over unchanged.
    const named = bodyOf(out, 'a').names;
    expect(named).not.toBe(names);
    expect([...named.faceEntries]).toEqual([...names.faceEntries]);
    expect(named.edges(name)).toEqual([3]);
  });

  it('passes two edges of one body in one call, sorted and without duplicates', async () => {
    const { kernel, calls } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);

    await build(aChamfer('f', { edges: [edge('a', 'e7'), edge('a', 'e3')] }), state, kernel);

    expect(calls.map((c) => c.edges)).toEqual([[3, 7]]);
  });

  it('joins the indices of names that share an edge', async () => {
    const { kernel, calls } = aRecordingKernel();
    const { shape } = await kernel.makeBox({ origin: [0, 0, 0], size: UNIT });
    const names = aNameTable({
      edges: { e3: [3], both: [3, 7] },
      topology: await kernel.topology(shape),
    });
    const id = bodyId('a' as FeatureId);
    const state: RegenState = Object.freeze({
      artifacts: new Map([
        [
          id,
          Object.freeze<Body>({
            kind: 'body',
            id,
            origin: 'a' as FeatureId,
            lastModifiedBy: 'a' as FeatureId,
            shape,
            names,
          }),
        ],
      ]),
    });

    await build(aChamfer('f', { edges: [edge('a', 'both'), edge('a', 'e3')] }), state, kernel);

    expect(calls.map((c) => c.edges)).toEqual([[3, 7]]);
  });

  it('calls the kernel once per body in the order of the first edge of each body', async () => {
    const { kernel, calls } = aRecordingKernel();
    const state = await boxesState(kernel, ['a', 'b']);
    const [a, b] = ['a', 'b'].map((f) => bodyOf(state, f).shape);

    const out = await build(
      aChamfer('f', { edges: [edge('b', 'e7'), edge('a', 'e3'), edge('b', 'e3')] }),
      state,
      kernel,
    );

    expect(calls).toEqual([
      { shape: b, edges: [3, 7], distance: 1 },
      { shape: a, edges: [3], distance: 1 },
    ]);
    expect([...out.artifacts.keys()]).toEqual(['a/body', 'b/body']);
    expect(bodyOf(out, 'a').lastModifiedBy).toBe('f');
    expect(bodyOf(out, 'b').lastModifiedBy).toBe('f');
  });

  it('keeps the bodies it does not touch and does not change the input state', async () => {
    const { kernel } = aRecordingKernel();
    const state = await boxesState(kernel, ['a', 'b']);
    const [a, b] = [bodyOf(state, 'a'), bodyOf(state, 'b')];

    const out = await build(aChamfer('f'), state, kernel);

    expect(bodyOf(out, 'b')).toBe(b);
    expect(bodyOf(state, 'a')).toBe(a);
    expect([...out.artifacts.keys()]).toEqual(['a/body', 'b/body']);
  });

  it('an unknown name gives UNRESOLVED_REFERENCE at edges without calling the kernel', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);

    const output = await run(aChamfer('f', { edges: [edge('a', 'gone')] }), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'edges', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('chamfer')).toBe(0);
  });

  it('a missing body gives UNRESOLVED_REFERENCE at edges', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);

    const output = await run(
      aChamfer('f', { edges: [edge('a', 'e3'), edge('x', 'e3')] }),
      state,
      kernel,
    );

    if (output.ok) expect.fail('Expected an error');
    expect(output.error.issues).toEqual([{ param: 'edges', code: 'param.unresolvedRef' }]);
    expect(fake.callCount('chamfer')).toBe(0);
  });

  it('turns operation-failed of the kernel into INVALID_PARAMS at distance (D6)', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);
    fake.failNext('chamfer', 'operation-failed', 'chamfer: the algorithm failed');

    const output = await run(aChamfer('f', { distance: 50 }), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toEqual({
      code: 'INVALID_PARAMS',
      message: 'chamfer: the algorithm failed',
      issues: [{ param: 'distance', code: 'chamfer.failed' }],
    });
    expect(Object.isFrozen(output.error)).toBe(true);
    expect(Object.isFrozen(output.error.issues)).toBe(true);
    expect(Object.isFrozen(output.error.issues?.[0])).toBe(true);
  });

  it('turns operation-failed of the second body into the same issue', async () => {
    const { fake, kernel, calls } = aRecordingKernel();
    const state = await boxesState(kernel, ['a', 'b']);
    // The first call succeeds, the second one fails.
    const chamfer = kernel.chamfer.bind(kernel);
    let n = 0;
    const failing: ModelingKernel = {
      ...kernel,
      chamfer(shape, edges, distance) {
        n++;
        if (n === 2) fake.failNext('chamfer', 'operation-failed');
        return chamfer(shape, edges, distance);
      },
    };

    const output = await run(
      aChamfer('f', { edges: [edge('a', 'e3'), edge('b', 'e3')] }),
      state,
      failing,
    );

    expect(calls).toHaveLength(2);
    if (output.ok) expect.fail('Expected an error');
    expect(output.error.issues).toEqual([{ param: 'distance', code: 'chamfer.failed' }]);
  });

  it.each(['invalid-input', 'unknown-handle', 'internal'] as const)(
    'lets the kernel error %s through',
    async (code) => {
      const { fake, kernel } = aRecordingKernel();
      const state = await boxesState(kernel, ['a']);
      fake.failNext('chamfer', code);

      await expect(run(aChamfer('f'), state, kernel)).rejects.toMatchObject({ code });
    },
  );

  it('lets an error that is not from the kernel through', async () => {
    const { kernel } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);
    const bug = new Error('a bug');
    const throwing: ModelingKernel = { ...kernel, chamfer: () => Promise.reject(bug) };

    await expect(run(aChamfer('f'), state, throwing)).rejects.toBe(bug);
  });
});

// ---------------------------------------------------------------------------------------------

/** A FeatureEditor that records create calls; `open` pretends a session is already open. */
function aRecordingEditor(open = false) {
  const created: string[] = [];
  const session: FeatureEditSession = {
    mode: 'create',
    featureId: aFeature().id,
    schema: chamferSchema,
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
  const ops = anOpsSession();
  const viewport = new FakeViewport();
  const manager = createToolManager({
    registry,
    ctx: {
      viewport,
      selection: createSelectionModel({ regen: new FakeRegenStatus() }),
      doc: ops.doc,
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
