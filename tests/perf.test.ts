// Performance measurement of M15 (spec 13, Měření výkonu; R130) over the OCCT kernel in the calling
// thread: a plate with 36 holes (one boolean subtract) and 4 filleted vertical edges, ~40 features,
// wired like app (document, dispatcher, log, Regenerator, FeatureEditor, plugins).
// It measures and prints the medians of the first regeneration, the tessellation, a full rebuild
// (the first feature changed) and a rebuild from the last cylinder (the cache), but it NEVER
// fails on time: times depend on the machine and its load. It checks only deterministic things:
// no feature error, one body, its face count, the kernel calls of the cached rebuild (the kernel is
// wrapped in a counting Proxy) and that the kernel holds exactly the handles of the cached states.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import {
  bodyId,
  createDocument,
  createFeatureSchemaRegistry,
  type DocumentId,
  type FeatureId,
  type TopoName,
  type TopoRef,
} from '@/document';
import { booleanPlugin } from '@/features/boolean';
import { boxPlugin } from '@/features/box';
import { cylinderPlugin } from '@/features/cylinder';
import { filletPlugin } from '@/features/fillet';
import { createFeatureEditor, createToolRegistry } from '@/interaction';
import type { GeometryKernel, MeshQuality } from '@/kernel';
import { createInThreadOcctKernel } from '@/kernel-occt/testing';
import { createOpHandlerRegistry, createOperationDispatcher, createOperationLog } from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { bodiesOf, createBuilderRegistry, createRegenerator, type Body } from '@/regen';
import type { RegenResult } from '@/regen';

const META = { id: 'perf' as DocumentId, name: 'Perf', createdAt: 0 }; // a test id is trusted
/** The quality of the viewport (MESH_QUALITY of render; render needs the DOM types). */
const MESH: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };
const RUNS = 3;
const GRID = 6;
const PLATE = 200;
const PITCH = 30;
const HOLE_RADIUS = 4;
/** Plate thicknesses the full rebuild alternates between; the cylinders pass through both. */
const THICKNESS = [20, 25] as const;
/** Radii the cached rebuild alternates the last cylinder between. */
const LAST_RADIUS = [3, HOLE_RADIUS] as const;

/** Calls of each kernel method since the last reset. */
class CallCounter {
  private counts = new Map<string, number>();
  add(method: string): void {
    this.counts.set(method, (this.counts.get(method) ?? 0) + 1);
  }
  of(method: string): number {
    return this.counts.get(method) ?? 0;
  }
  reset(): void {
    this.counts = new Map();
  }
  /** 'makeBox:1 makeCylinder:36 …', sorted by method. */
  summary(): string {
    return [...this.counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, n]) => `${m}:${String(n)}`)
      .join(' ');
  }
}

/**
 * The kernel with every method call counted. A Proxy, not a list of methods: the interface grows
 * (exportStep in M15) and a hand-written wrapper would silently miss new methods.
 */
function countingKernel(kernel: GeometryKernel, counter: CallCounter): GeometryKernel {
  return new Proxy(kernel, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      return (...args: unknown[]): unknown => {
        counter.add(prop);
        // The class methods of OcctKernelImpl use `this`: call them on the real kernel.
        const result: unknown = Reflect.apply(value, target, args);
        return result;
      };
    },
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function setup(kernel: GeometryKernel) {
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const tools = createToolRegistry();
  // The plugins of the scenario directly: app (BUILT_IN_PLUGINS) needs the DOM types.
  for (const plugin of [boxPlugin, cylinderPlugin, booleanPlugin, filletPlugin]) {
    registerPlugin(plugin, { schemas, builders, tools });
  }
  const doc = createDocument({ meta: META });
  const log = createOperationLog();
  const handlers = createOpHandlerRegistry({ schemas });
  const ops = createOperationDispatcher({ doc, handlers, log });
  const regenerator = createRegenerator({ kernel, schemas, builders, now: () => 0 });
  const ids = createSequentialIdGenerator('f');
  const features = createFeatureEditor({ doc, ops, schemas, ids, translate: (key) => key });

  /** Creates a feature of the type through the dialog with the given params, OK. */
  function add(type: string, params: Readonly<Record<string, unknown>>): FeatureId {
    const session = features.create(type);
    for (const [name, value] of Object.entries(params)) session.setParam(name, value);
    session.commit();
    return session.featureId;
  }

  /** Changes one param of the feature through the dialog, OK. */
  function edit(feature: FeatureId, name: string, value: unknown): void {
    const session = features.edit(feature);
    session.setParam(name, value);
    session.commit();
  }

  async function regenerate(): Promise<RegenResult> {
    const result = await regenerator.run(doc.studio);
    if (result === 'superseded') expect.fail('Unexpected superseded run');
    return result;
  }

  /** Empties the cache: a run without features sweeps every handle (a cold start for the next run). */
  async function clearCache(): Promise<void> {
    const result = await regenerator.run({ features: [], rollbackIndex: 0 });
    if (result === 'superseded') expect.fail('Unexpected superseded run');
  }

  return { doc, add, edit, regenerate, clearCache };
}

/** The single body of the result; every feature ok. */
function onlyBody(result: RegenResult): Body {
  expect([...result.statuses.values()].filter((s) => s.kind !== 'ok')).toEqual([]);
  const bodies = bodiesOf(result.finalState);
  expect(bodies).toHaveLength(1);
  const [body] = bodies;
  if (body === undefined) expect.fail('No body');
  return body;
}

/**
 * The 4 vertical edges of the plate: the edges between two of its side faces (ADR 0018,
 * 'edge:<A>|<B>'), looked up in the name table of the body.
 */
function verticalEdges(body: Body, plate: FeatureId): readonly TopoRef[] {
  const sides = ['front', 'back', 'left', 'right'].map((s) => `${plate}/face:${s}`);
  const vertical = [...body.names.edgeEntries.keys()].filter((name: TopoName) => {
    const [a, b] = name.replace(/^edge:/, '').split('|');
    return a !== b && sides.includes(a ?? '') && sides.includes(b ?? '');
  });
  return vertical.map((name) => ({ kind: 'topo', body: body.id, name }));
}

describe('performance of regeneration and tessellation (OCCT, plate with 36 holes)', () => {
  const counter = new CallCounter();
  let kernel: GeometryKernel;
  const rows: Record<string, string | number>[] = [];

  beforeAll(async () => {
    kernel = countingKernel(await createInThreadOcctKernel(), counter);
  });

  afterAll(() => {
    // The numbers go to the vault (Q007), not into assertions.
    console.table(rows);
  });

  /**
   * Runs `step` RUNS times, records the median and the kernel calls of the last run. `prepare`
   * runs before each step, outside the time and the counts.
   */
  async function measure(
    name: string,
    step: (run: number) => Promise<void>,
    prepare?: () => Promise<void>,
  ): Promise<void> {
    const times: number[] = [];
    let calls = '';
    for (let run = 0; run < RUNS; run++) {
      if (prepare !== undefined) await prepare();
      counter.reset();
      const start = performance.now();
      await step(run);
      times.push(performance.now() - start);
      calls = counter.summary();
    }
    rows.push({
      step: name,
      medianMs: Math.round(median(times)),
      runsMs: times.map((t) => Math.round(t)).join(' / '),
      calls,
    });
  }

  it('regenerates, tessellates and rebuilds from the cache', { timeout: 60_000 }, async () => {
    const testStart = performance.now();
    const s = setup(kernel);
    const plate = s.add('box', {
      origin: [0, 0, 0],
      width: PLATE,
      depth: PLATE,
      height: THICKNESS[0],
    });
    const offset = (PLATE - (GRID - 1) * PITCH) / 2;
    const cylinders: FeatureId[] = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        cylinders.push(
          s.add('cylinder', {
            base: [offset + i * PITCH, offset + j * PITCH, -5],
            axis: 'z',
            radius: HOLE_RADIUS,
            height: 40,
          }),
        );
      }
    }
    s.add('boolean', {
      op: 'subtract',
      targets: [{ kind: 'body', body: bodyId(plate) }],
      tools: cylinders.map((c) => ({ kind: 'body', body: bodyId(c) })),
    });
    // The edge names exist only after a regeneration of the boolean.
    const edges = verticalEdges(onlyBody(await s.regenerate()), plate);
    expect(edges).toHaveLength(4);
    s.add('fillet', { edges, radius: 5 });
    const featureCount = s.doc.studio.features.length;
    expect(featureCount).toBe(1 + GRID * GRID + 2);

    /** Checks the result and that the kernel holds exactly the handles of the cached states. */
    async function check(result: RegenResult): Promise<Body> {
      const body = onlyBody(result);
      const topology = await kernel.topology(body.shape);
      expect(topology.faces).toHaveLength(6 + GRID * GRID + 4);
      // Every feature leaves one new body shape in its cached state (the plate, each cylinder,
      // the boolean, the fillet); everything else (intermediate shapes, replaced shapes) is swept.
      expect(await kernel.liveHandleCount()).toBe(featureCount);
      return body;
    }

    let last: RegenResult | undefined;
    // From zero: the cache is emptied before each run (it holds the plate and the cylinders
    // from the regeneration above, then the whole model).
    await measure(
      'first regeneration',
      async () => {
        last = await s.regenerate();
      },
      s.clearCache,
    );
    if (last === undefined) expect.fail('No regeneration');
    expect(counter.of('makeBox')).toBe(1);
    expect(counter.of('makeCylinder')).toBe(GRID * GRID);
    const body = await check(last);

    await measure('tessellation', async () => {
      const mesh = await kernel.tessellate(body.shape, MESH);
      expect(mesh.positions.length).toBeGreaterThan(0);
    });

    await measure('rebuild after the plate thickness (full)', async (run) => {
      s.edit(plate, 'height', THICKNESS[(run + 1) % 2]);
      last = await s.regenerate();
    });
    expect(counter.of('makeBox')).toBe(1);
    expect(counter.of('makeCylinder')).toBe(GRID * GRID);
    await check(last);

    const lastCylinder = cylinders[cylinders.length - 1];
    if (lastCylinder === undefined) expect.fail('No cylinder');
    await measure('rebuild after the last cylinder (cache)', async (run) => {
      s.edit(lastCylinder, 'radius', LAST_RADIUS[run % 2]);
      last = await s.regenerate();
      // The cache: only the last cylinder, the boolean and the fillet are built again.
      expect(counter.of('makeBox')).toBe(0);
      expect(counter.of('makeCylinder')).toBe(1);
    });
    await check(last);

    rows.push({ step: 'whole test', medianMs: Math.round(performance.now() - testStart) });
  });
});
