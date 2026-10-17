// A text in a sketch bounds regions (M37, spec 12 "Text ve skice (M37)"): the outlines of "oaB"
// from the real bundled font (the opentype.js adapter, fonts read from disk), extruded over the
// OCCT kernel in the calling thread, wired like app does it (document, dispatcher, log,
// Regenerator, FeatureEditor and the plugins sketch and extrude):
// - the counters of the letters are holes of their regions ("o" and "a" one, "B" two) and regions
//   of their own;
// - the side faces of the extruded letters are named face:side:<text>:<char>-<code>.<loop>.<seg>;
// - changing the middle letter ("oaB" → "oxB") through the dialog keeps the region and face names
//   of "o" and "B", so the extrude of those two still regenerates;
// - a construction text bounds no regions.

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { ORIGIN_PLANE_IDS, createDocument, createFeatureSchemaRegistry } from '@/document';
import type { DocumentId, FeatureId, SketchRegionRef } from '@/document';
import { extrudePlugin } from '@/features/extrude';
import { sketchPlugin } from '@/features/sketch';
import { createFeatureEditor, createManipulatorRegistry, createToolRegistry } from '@/interaction';
import type { GeometryKernel, ProfileRegion } from '@/kernel';
import { createInThreadOcctKernel } from '@/kernel-occt/testing';
import { createOperationDispatcher, createOperationLog, createOpHandlerRegistry } from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { bodiesOf, createBuilderRegistry, createRegenerator, sketchesOf } from '@/regen';
import type { RegenResult } from '@/regen';
import { SKETCH_PARAM } from '@/sketch';
import type { TextContour, TextFontId } from '@/sketch';
import { createOpentypeOutliner } from '@/text-opentype';

const META = { id: 'sketch-text-regions' as DocumentId, name: 'Text', createdAt: 0 }; // a test id is trusted
const DISTANCE = 2;
const HEIGHT = 10;
/** The id of the text entity: the prefix of every derived id of its letters. */
const TEXT = 'tx';

const FONT_FILES: Record<TextFontId, string> = {
  sans: 'NotoSans-Regular.ttf',
  serif: 'NotoSerif-Regular.ttf',
  mono: 'NotoSansMono-Regular.ttf',
};

/** The bundled font from disk (the app fetches it from fontUrl). */
async function loadFont(font: TextFontId): Promise<ArrayBuffer> {
  const url = new URL(`../../src/text-opentype/fonts/${FONT_FILES[font]}`, import.meta.url);
  const bytes = await readFile(url);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const outliner = createOpentypeOutliner(loadFont);

/**
 * A text on a construction baseline from (5, 3) along +x; the contours from the real outliner,
 * as the sketcher computes them before it writes the text.
 */
async function entities(text: string, construction = false): Promise<readonly unknown[]> {
  const contours: readonly TextContour[] = await outliner.outline({
    text,
    font: 'sans',
    height: HEIGHT,
  });
  return [
    { kind: 'point', id: 'b1', x: 5, y: 3 },
    { kind: 'point', id: 'b2', x: 40, y: 3 },
    { kind: 'line', id: 'bl', p1: 'b1', p2: 'b2', construction: true },
    {
      kind: 'text',
      id: TEXT,
      text,
      font: 'sans',
      height: HEIGHT,
      baseline: 'bl',
      contours,
      ...(construction ? { construction: true } : {}),
    },
  ];
}

function setup(kernel: GeometryKernel) {
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const tools = createToolRegistry();
  const manipulators = createManipulatorRegistry();
  // The plugins of the scenario directly: app (BUILT_IN_PLUGINS) needs the DOM types.
  for (const plugin of [sketchPlugin, extrudePlugin]) {
    registerPlugin(plugin, { schemas, builders, tools, manipulators });
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
    session.setParams(params);
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

  async function addSketch(text: string, construction = false): Promise<FeatureId> {
    return add('sketch', {
      plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }],
      entities: await entities(text, construction),
      constraints: [],
    });
  }

  return { add, edit, regenerate, addSketch };
}

/** The region outlines of the sketch, in the order of the kernel (sorted by name). */
function outlinesOf(result: RegenResult, sketch: FeatureId): readonly ProfileRegion[] {
  const artifact = sketchesOf(result.finalState).find((a) => a.owner === sketch);
  if (artifact === undefined) expect.fail(`No sketch artifact of '${sketch}'`);
  return artifact.outlines;
}

/** The ids of the curves of a region name that belong to the letter at `char`. */
function letterIds(name: string, char: number, code: number): string[] {
  return name.split(',').filter((id) => id.startsWith(`${TEXT}:${String(char)}-${String(code)}.`));
}

/**
 * The region of the letter with holes: all its boundary curves are curves of that letter. A
 * letter with counters has exactly one.
 */
function letterBody(regions: readonly ProfileRegion[], char: number, code: number): ProfileRegion {
  const found = regions.filter(
    (r) => r.holes.length > 0 && letterIds(r.name, char, code).length === r.name.split(',').length,
  );
  expect(found).toHaveLength(1);
  const [first] = found;
  if (first === undefined) expect.fail(`No region of letter ${String(char)}`);
  return first;
}

/** The side face names of all bodies of the result without the feature prefix, sorted. */
function sideNames(result: RegenResult): string[] {
  expect([...result.statuses.values()].map((st) => st.kind)).toEqual(['ok', 'ok']);
  return bodiesOf(result.finalState)
    .flatMap((body) => [...body.names.faceEntries.keys()])
    .filter((n) => n.includes('face:side:'))
    .map((n) => n.slice(n.indexOf('face:side:')))
    .sort();
}

const O = 'o'.codePointAt(0) ?? 0;
const A = 'a'.codePointAt(0) ?? 0;
const B = 'B'.codePointAt(0) ?? 0;
const X = 'x'.codePointAt(0) ?? 0;

describe('a text in a sketch, extruded (M37, OCCT, real font)', () => {
  let kernel: GeometryKernel;

  beforeAll(async () => {
    kernel = await createInThreadOcctKernel();
  });

  it('gives the letters regions with holes and keeps the names of unchanged letters', async () => {
    const s = setup(kernel);
    const sketch = await s.addSketch('oaB');
    const regions = outlinesOf(await s.regenerate(), sketch);

    // o and a: the body with one hole and the counter; B: the body with two holes and the two
    // counters. Every region is bounded by curves of the text only.
    expect(regions).toHaveLength(7);
    expect(regions.every((r) => r.name.split(',').every((id) => id.startsWith(`${TEXT}:`)))).toBe(
      true,
    );
    expect(regions.map((r) => r.holes.length).sort()).toEqual([0, 0, 0, 0, 1, 1, 2]);
    const o = letterBody(regions, 0, O);
    const a = letterBody(regions, 1, A);
    const b = letterBody(regions, 2, B);
    expect(o.holes).toHaveLength(1);
    expect(a.holes).toHaveLength(1);
    expect(b.holes).toHaveLength(2);
    for (const r of regions) expect(r.area).toBeGreaterThan(0);

    // The bodies of o and B extruded: their side faces are named by the derived ids of the
    // segments of both their loops.
    const refs: SketchRegionRef[] = [o, b].map((r) => ({ kind: 'region', sketch, region: r.name }));
    s.add('extrude', { regions: refs, distance: DISTANCE });
    const expected = [...o.name.split(','), ...b.name.split(',')]
      .map((id) => `face:side:${id}`)
      .sort();
    const before = sideNames(await s.regenerate());
    expect(before).toEqual(expected);
    expect(before).toContain(`face:side:${TEXT}:0-${String(O)}.0.0`);
    expect(before).toContain(`face:side:${TEXT}:2-${String(B)}.2.0`);

    // The middle letter changed: o and B keep their ids, so their regions and faces keep their
    // names and the extrude still resolves its regions; a is gone, x has no hole.
    s.edit(sketch, SKETCH_PARAM.entities, await entities('oxB'));
    const changed = await s.regenerate();
    const after = outlinesOf(changed, sketch);
    expect(after.map((r) => r.name)).toContain(o.name);
    expect(after.map((r) => r.name)).toContain(b.name);
    expect(after.some((r) => r.name.includes(`${TEXT}:1-${String(A)}.`))).toBe(false);
    expect(after.some((r) => r.name.includes(`${TEXT}:1-${String(X)}.`))).toBe(true);
    expect(after.map((r) => r.holes.length).sort()).toEqual([0, 0, 0, 0, 1, 2]);
    expect(sideNames(changed)).toEqual(expected);
  });

  it('gives a construction text no regions', async () => {
    const s = setup(kernel);
    const sketch = await s.addSketch('oaB', true);
    const result = await s.regenerate();
    expect([...result.statuses.values()].map((st) => st.kind)).toEqual(['ok']);
    expect(outlinesOf(result, sketch)).toEqual([]);
  });
});
