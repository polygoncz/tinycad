import { describe, expect, it } from 'vitest';
import { bodyId } from '@/document';
import type { BodyId, FeatureId } from '@/document';
import type { ShapeResult } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { modifyBody, replaceBodies } from '@/regen/body-change';
import { nameShape } from '@/regen/names';
import { EMPTY_STATE } from '@/regen/state';
import type { Artifact, ArtifactId, Body, RegenState } from '@/regen/state';
import { aSketchArtifact } from '@/regen/testing';

// The identity rule of a changed body (spec 07, ADR 0015): modifyBody keeps id and origin and
// names the new shape, replaceBodies puts changed bodies in their place and drops consumed ones.

const fid = (s: string): FeatureId => s as FeatureId; // test ids stand for minted ones

/** A box body created and named by the feature `origin`, frozen like the output of a builder. */
async function aBoxBody(origin: string, kernel = createFakeKernel()): Promise<Body> {
  const result = await kernel.makeBox({ origin: [0, 0, 0], size: [10, 10, 10] });
  const names = await nameShape({ kernel, featureId: fid(origin), result, inputs: [] });
  return Object.freeze({
    kind: 'body',
    id: bodyId(fid(origin)),
    origin: fid(origin),
    lastModifiedBy: fid(origin),
    shape: result.shape,
    names,
  });
}

function aState(...artifacts: Artifact[]): RegenState {
  const map = new Map<ArtifactId, Artifact>(EMPTY_STATE.artifacts);
  for (const a of artifacts) map.set(a.id, a);
  return Object.freeze({ artifacts: map });
}

describe('modifyBody', () => {
  /** A named box body of 'a' and a result over the same shape whose face 0 is generated from face 0. */
  async function setup() {
    const kernel = createFakeKernel();
    const body = await aBoxBody('a', kernel);
    const result: ShapeResult = {
      shape: body.shape,
      history: {
        modified: [],
        generated: [
          { input: 0, from: { type: 'face', index: 0 }, to: [{ type: 'face', index: 0 }] },
        ],
        deleted: [],
      },
    };
    const source = body.names.nameOfFace(0) ?? expect.fail('box face 0 has no name');
    return { kernel, body, result, source };
  }

  it('keeps id and origin, takes the new shape and names it, the feature is lastModifiedBy', async () => {
    const { kernel, body, result, source } = await setup();
    const before = { ...body };

    const out = await modifyBody({
      kernel,
      feature: fid('f'),
      body,
      result,
      inputs: [body.names],
      generatedTag: 'fillet',
    });

    expect(out.kind).toBe('body');
    expect(out.id).toBe(body.id);
    expect(out.origin).toBe(fid('a'));
    expect(out.lastModifiedBy).toBe(fid('f'));
    expect(out.shape).toBe(result.shape);
    expect(out.names.nameOfFace(0)).toBe(`f/face:fillet:${source}`);
    expect(Object.isFrozen(out)).toBe(true);
    expect(body).toEqual(before);
  });

  it('without generatedTag names generated faces with the default tag gen', async () => {
    const { kernel, body, result, source } = await setup();

    const out = await modifyBody({ kernel, feature: fid('f'), body, result, inputs: [body.names] });

    expect(out.names.nameOfFace(0)).toBe(`f/face:gen:${source}`);
  });
});

describe('replaceBodies', () => {
  it('puts changed bodies in their place, drops consumed ones, keeps the rest the same object', async () => {
    const a = await aBoxBody('a');
    const b = await aBoxBody('b');
    const c = await aBoxBody('c');
    const sketch = aSketchArtifact('s');
    const state = aState(a, sketch, b, c);
    const a2: Body = Object.freeze({ ...a, lastModifiedBy: fid('x') });

    const out = replaceBodies(state, new Map([[a.id, a2]]), new Set<BodyId>([b.id]));

    expect([...out.artifacts.keys()]).toEqual([
      ...EMPTY_STATE.artifacts.keys(),
      a.id,
      sketch.id,
      c.id,
    ]);
    expect(out.artifacts.get(a.id)).toBe(a2);
    expect(out.artifacts.get(sketch.id)).toBe(sketch);
    expect(out.artifacts.get(c.id)).toBe(c);
    expect(Object.isFrozen(out)).toBe(true);
    // The input state stays as it is.
    expect(state.artifacts.get(a.id)).toBe(a);
    expect(state.artifacts.has(b.id)).toBe(true);
    expect(out.artifacts).not.toBe(state.artifacts);
  });

  it('with nothing changed and nothing consumed gives a new map of the same artifacts', async () => {
    const a = await aBoxBody('a');
    const state = aState(a);

    const out = replaceBodies(state, new Map(), new Set());

    expect([...out.artifacts]).toEqual([...state.artifacts]);
    expect(out.artifacts).not.toBe(state.artifacts);
  });
});
