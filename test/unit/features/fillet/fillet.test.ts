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
import { filletBuilder } from '@/features/fillet/builder';
import { filletSchema } from '@/features/fillet/schema';
import type { FilletParams } from '@/features/fillet/schema';
import { filletMessages } from '@/features/fillet/messages';
import { filletTool } from '@/features/fillet/tool';
import * as fillet from '@/features/fillet';

// ---------------------------------------------------------------------------------------------
// Helpers

function edge(body: string, name: string): TopoRef {
  // Test data: the hand-written strings stand for names minted by propagateNames.
  return { kind: 'topo', body: bodyId(body as FeatureId), name: name as TopoName };
}

function aFillet(id: string, params: Partial<FilletParams> = {}): FeatureInstance<FilletParams> {
  return aFeature({
    id,
    type: 'fillet',
    params: { ...filletSchema.defaults(), edges: [edge('a', 'e3')], ...params },
  });
}

/** A kernel call of fillet, as the builder made it. */
interface FilletCall {
  readonly shape: ShapeHandle;
  readonly edges: readonly number[];
  readonly radius: number;
}

/** The FakeKernel with every fillet call recorded (a copy of the edge list). */
function aRecordingKernel() {
  const fake = createFakeKernel();
  const calls: FilletCall[] = [];
  const kernel: ModelingKernel = {
    makeBox: (p) => fake.makeBox(p),
    makeCylinder: (p) => fake.makeCylinder(p),
    transform: (shape, m) => fake.transform(shape, m),
    boolean: (op, targets, tools) => fake.boolean(op, targets, tools),
    makeFace: (p) => fake.makeFace(p),
    profileRegions: (p) => fake.profileRegions(p),
    curveIntersections: (p) => fake.curveIntersections(p),
    curveSegment: (p) => fake.curveSegment(p),
    extrude: (profile, direction, distance) => fake.extrude(profile, direction, distance),
    revolve: (profile, axis, angle) => fake.revolve(profile, axis, angle),
    fillet(shape, edges, radius) {
      calls.push({ shape, edges: [...edges], radius });
      return fake.fillet(shape, edges, radius);
    },
    chamfer: (shape, edges, distance) => fake.chamfer(shape, edges, distance),
    boundingBox: (shape) => fake.boundingBox(shape),
    topology: (shape) => fake.topology(shape),
  };
  return { fake, kernel, calls };
}

const UNIT: Vec3 = [10, 10, 10];

/**
 * A state with one box body per key, created by the feature of that name. Each body has the
 * edge names e3 → [3] and e7 → [7] over the real topology of its box (the kernel history of the
 * fillet refers to all its faces).
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
  feature: FeatureInstance<FilletParams>,
  state: RegenState,
  kernel: ModelingKernel,
): Promise<BuildOutput> {
  return filletBuilder.build(aBuildInput(feature, state), aBuildContext(kernel, state));
}

async function build(
  feature: FeatureInstance<FilletParams>,
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

describe('fillet public API', () => {
  it('exports exactly filletPlugin', () => {
    expect(Object.keys(fillet)).toEqual(['filletPlugin']);
  });

  it('filletPlugin joins the schema, the builder, the tool and the messages', () => {
    expect(fillet.filletPlugin.schema).toBe(filletSchema);
    expect(fillet.filletPlugin.builder).toBe(filletBuilder);
    expect(fillet.filletPlugin.tools).toEqual([filletTool]);
    expect(fillet.filletPlugin.messages).toBe(filletMessages);
    expect(filletSchema.type).toBe('fillet');
    expect(filletBuilder.type).toBe('fillet');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(fillet.filletPlugin)).toBe(true);
    expect(Object.isFrozen(fillet.filletPlugin.tools)).toBe(true);
  });

  it('registers schema, builder and tool through registerPlugin', () => {
    const regs = {
      schemas: createFeatureSchemaRegistry(),
      builders: createBuilderRegistry(),
      tools: createToolRegistry(),
      manipulators: createManipulatorRegistry(),
    };
    registerPlugin(fillet.filletPlugin, regs);
    expect(regs.schemas.get('fillet')).toBe(filletSchema);
    expect(regs.builders.get('fillet')).toBe(filletBuilder);
    expect(regs.tools.get('fillet')).toBe(filletTool);
  });
});

describe('filletSchema', () => {
  it('is version 1 of type fillet with the Tabler icon border-radius', () => {
    expect(filletSchema).toMatchObject({
      type: 'fillet',
      version: 1,
      label: 'fillet.label',
      icon: 'border-radius',
    });
  });

  it('has the params edges, radius in this order with key labels (ADR 0014)', () => {
    expect(Object.entries(filletSchema.params).map(([key, spec]) => [key, spec.label])).toEqual([
      ['edges', 'fillet.edges'],
      ['radius', 'fillet.radius'],
    ]);
  });

  it('needs at least one edge and a radius > 0 of 1 by default', () => {
    expect(filletSchema.params['edges']).toEqual({
      kind: 'topo',
      label: 'fillet.edges',
      entity: 'edge',
      min: 1,
    });
    expect(filletSchema.params['radius']).toEqual({
      kind: 'length',
      label: 'fillet.radius',
      default: 1,
      min: 0,
      exclusiveMin: true,
    });
  });

  it('is frozen deeply', () => {
    expect(Object.isFrozen(filletSchema)).toBe(true);
    expect(Object.isFrozen(filletSchema.params)).toBe(true);
    for (const spec of Object.values(filletSchema.params)) expect(Object.isFrozen(spec)).toBe(true);
  });

  it('defaults are no edges and the radius 1, a new object every call', () => {
    expect(filletSchema.defaults()).toEqual({ edges: [], radius: 1 });
    expect(filletSchema.defaults()).not.toBe(filletSchema.defaults());
  });

  it('defaults alone ask for an edge (R24)', () => {
    expect(filletSchema.validate(filletSchema.defaults())).toEqual([
      { param: 'edges', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
  });

  it('defaults with one edge pass validation', () => {
    expect(filletSchema.validate({ ...filletSchema.defaults(), edges: [edge('a', 'e3')] })).toEqual(
      [],
    );
  });

  it('rejects a radius of 0 and a reference of another kind', () => {
    expect(filletSchema.validate({ edges: [edge('a', 'e3')], radius: 0 })).toEqual([
      { param: 'radius', code: 'param.atOrBelowMin', params: { min: 0 } },
    ]);
    expect(filletSchema.validate({ edges: [{ kind: 'body', body: 'a/body' }], radius: 1 })).toEqual(
      [{ param: 'edges', code: 'param.invalidRef', params: { index: 0 } }],
    );
  });

  it('rejects the same edge twice with param.duplicateRef', () => {
    expect(filletSchema.validate({ edges: [edge('a', 'e3'), edge('a', 'e3')], radius: 1 })).toEqual(
      [{ param: 'edges', code: 'param.duplicateRef', params: { index: 1 } }],
    );
  });
});

describe('filletMessages', () => {
  it('has the texts of the plan', () => {
    expect(filletMessages.cs).toEqual({
      'fillet.label': 'Zaoblení',
      'fillet.edges': 'Hrany',
      'fillet.radius': 'Poloměr',
      'fillet.failed': 'Zaoblení se nepodařilo. Zkuste menší poloměr nebo jiné hrany.',
    });
    expect(filletMessages.en).toEqual({
      'fillet.label': 'Fillet',
      'fillet.edges': 'Edges',
      'fillet.radius': 'Radius',
      'fillet.failed': 'The fillet failed. Try a smaller radius or other edges.',
    });
  });

  it.each(['cs', 'en'] as const)(
    '%s has a text for every key of the schema and the issue code of the builder',
    (lang) => {
      const keys = [
        filletSchema.label,
        ...Object.values(filletSchema.params).map((s) => s.label),
        'fillet.failed',
      ];
      expect(Object.keys(filletMessages[lang]).sort()).toEqual([...keys].sort());
    },
  );

  it('is frozen', () => {
    expect(Object.isFrozen(filletMessages)).toBe(true);
    expect(Object.isFrozen(filletMessages.cs)).toBe(true);
    expect(Object.isFrozen(filletMessages.en)).toBe(true);
  });
});

describe('filletBuilder', () => {
  it('fillets the named edge with one kernel call and keeps the identity of the body', async () => {
    const { kernel, calls } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);
    const input = bodyOf(state, 'a');

    const out = await build(aFillet('f', { radius: 2 }), state, kernel);

    expect(calls).toEqual([{ shape: input.shape, edges: [3], radius: 2 }]);
    const body = bodyOf(out, 'a');
    expect(body).toMatchObject({ kind: 'body', id: 'a/body', origin: 'a', lastModifiedBy: 'f' });
    expect(body.shape).not.toBe(input.shape);
    expect(Object.isFrozen(body)).toBe(true);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('names the result through nameShape with the tag fillet over the names of the body', async () => {
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
      aFillet('f', { edges: [{ kind: 'topo', body: id, name }] }),
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

    await build(aFillet('f', { edges: [edge('a', 'e7'), edge('a', 'e3')] }), state, kernel);

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

    await build(aFillet('f', { edges: [edge('a', 'both'), edge('a', 'e3')] }), state, kernel);

    expect(calls.map((c) => c.edges)).toEqual([[3, 7]]);
  });

  it('calls the kernel once per body in the order of the first edge of each body', async () => {
    const { kernel, calls } = aRecordingKernel();
    const state = await boxesState(kernel, ['a', 'b']);
    const [a, b] = ['a', 'b'].map((f) => bodyOf(state, f).shape);

    const out = await build(
      aFillet('f', { edges: [edge('b', 'e7'), edge('a', 'e3'), edge('b', 'e3')] }),
      state,
      kernel,
    );

    expect(calls).toEqual([
      { shape: b, edges: [3, 7], radius: 1 },
      { shape: a, edges: [3], radius: 1 },
    ]);
    expect([...out.artifacts.keys()]).toEqual(['a/body', 'b/body']);
    expect(bodyOf(out, 'a').lastModifiedBy).toBe('f');
    expect(bodyOf(out, 'b').lastModifiedBy).toBe('f');
  });

  it('keeps the bodies it does not touch and does not change the input state', async () => {
    const { kernel } = aRecordingKernel();
    const state = await boxesState(kernel, ['a', 'b']);
    const [a, b] = [bodyOf(state, 'a'), bodyOf(state, 'b')];

    const out = await build(aFillet('f'), state, kernel);

    expect(bodyOf(out, 'b')).toBe(b);
    expect(bodyOf(state, 'a')).toBe(a);
    expect([...out.artifacts.keys()]).toEqual(['a/body', 'b/body']);
  });

  it('an unknown name gives UNRESOLVED_REFERENCE at edges without calling the kernel', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);

    const output = await run(aFillet('f', { edges: [edge('a', 'gone')] }), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'edges', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('fillet')).toBe(0);
  });

  it('a missing body gives UNRESOLVED_REFERENCE at edges', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);

    const output = await run(
      aFillet('f', { edges: [edge('a', 'e3'), edge('x', 'e3')] }),
      state,
      kernel,
    );

    if (output.ok) expect.fail('Expected an error');
    expect(output.error.issues).toEqual([{ param: 'edges', code: 'param.unresolvedRef' }]);
    expect(fake.callCount('fillet')).toBe(0);
  });

  it('turns operation-failed of the kernel into INVALID_PARAMS at radius (D6)', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);
    fake.failNext('fillet', 'operation-failed', 'fillet: the algorithm failed');

    const output = await run(aFillet('f', { radius: 50 }), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toEqual({
      code: 'INVALID_PARAMS',
      message: 'fillet: the algorithm failed',
      issues: [{ param: 'radius', code: 'fillet.failed' }],
    });
    expect(Object.isFrozen(output.error)).toBe(true);
    expect(Object.isFrozen(output.error.issues)).toBe(true);
    expect(Object.isFrozen(output.error.issues?.[0])).toBe(true);
  });

  it('turns operation-failed of the second body into the same issue', async () => {
    const { fake, kernel, calls } = aRecordingKernel();
    const state = await boxesState(kernel, ['a', 'b']);
    // The first call succeeds, the second one fails.
    const fillet = kernel.fillet.bind(kernel);
    let n = 0;
    const failing: ModelingKernel = {
      ...kernel,
      fillet(shape, edges, radius) {
        n++;
        if (n === 2) fake.failNext('fillet', 'operation-failed');
        return fillet(shape, edges, radius);
      },
    };

    const output = await run(
      aFillet('f', { edges: [edge('a', 'e3'), edge('b', 'e3')] }),
      state,
      failing,
    );

    expect(calls).toHaveLength(2);
    if (output.ok) expect.fail('Expected an error');
    expect(output.error.issues).toEqual([{ param: 'radius', code: 'fillet.failed' }]);
  });

  it.each(['invalid-input', 'unknown-handle', 'internal'] as const)(
    'lets the kernel error %s through',
    async (code) => {
      const { fake, kernel } = aRecordingKernel();
      const state = await boxesState(kernel, ['a']);
      fake.failNext('fillet', code);

      await expect(run(aFillet('f'), state, kernel)).rejects.toMatchObject({ code });
    },
  );

  it('lets an error that is not from the kernel through', async () => {
    const { kernel } = aRecordingKernel();
    const state = await boxesState(kernel, ['a']);
    const bug = new Error('a bug');
    const throwing: ModelingKernel = { ...kernel, fillet: () => Promise.reject(bug) };

    await expect(run(aFillet('f'), state, throwing)).rejects.toBe(bug);
  });
});

// ---------------------------------------------------------------------------------------------

/** A FeatureEditor that records create calls; `open` pretends a session is already open. */
function aRecordingEditor(open = false) {
  const created: string[] = [];
  const session: FeatureEditSession = {
    mode: 'create',
    featureId: aFeature().id,
    schema: filletSchema,
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
