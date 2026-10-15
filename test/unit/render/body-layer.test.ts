import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { BodyId } from '@/interaction';
import type { ShapeHandle } from '@/kernel';
import { createBodyLayer } from '@/render/body-layer';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render/palette';
import { boxMeshes } from '@/render/testing';

// Branded ids are created by a cast in tests only.
const body = (id: string): BodyId => id as BodyId;
const A = body('f1/body');
const B = body('f2/body');
// boxMeshes: the handle is the box size; distinct handles = distinct shapes.
const shape = (n: number): ShapeHandle => n as ShapeHandle;

async function setup() {
  const requestRender = vi.fn();
  const afterVisibilityChange = vi.fn();
  const layer = createBodyLayer({
    afterVisibilityChange,
    meshes: boxMeshes(),
    quality: { linearDeflection: 0.1, angularDeflection: 0.5 },
    reportError: () => undefined,
    requestRender,
    palette: LIGHT_PALETTE,
  });
  let next = 10;
  const box = (): ShapeHandle => shape(next++);
  const a = box();
  const b = box();
  await layer.sync([
    { id: A, shape: a },
    { id: B, shape: b },
  ]);
  requestRender.mockClear();
  return { layer, requestRender, afterVisibilityChange, box, a, b };
}

function materialsOf(layer: Awaited<ReturnType<typeof setup>>['layer'], id: BodyId) {
  const view = layer.views.get(id);
  if (view === undefined) throw new Error(`body ${id} is not shown`);
  const faces = view.faces.material;
  const edges = view.edges.material;
  if (!(faces instanceof THREE.MeshStandardMaterial)) throw new Error('faces material');
  if (!(edges instanceof THREE.LineBasicMaterial)) throw new Error('edges material');
  return { faces, edges };
}

describe('BodyLayer palette', () => {
  it('starts with the colours of the given palette', async () => {
    const { layer } = await setup();
    const { faces, edges } = materialsOf(layer, A);
    expect(faces.color.getHex()).toBe(LIGHT_PALETTE.face);
    expect(edges.color.getHex()).toBe(LIGHT_PALETTE.edge);
  });

  it('setPalette recolours the shared materials without creating new ones', async () => {
    const { layer } = await setup();
    const before = materialsOf(layer, A);
    layer.setPalette(DARK_PALETTE);
    const after = materialsOf(layer, A);
    expect(after.faces).toBe(before.faces);
    expect(after.edges).toBe(before.edges);
    expect(after.faces.color.getHex()).toBe(DARK_PALETTE.face);
    expect(after.edges.color.getHex()).toBe(DARK_PALETTE.edge);
    expect(materialsOf(layer, B).faces).toBe(before.faces);
  });

  it('a body added after setPalette gets the new colours', async () => {
    const { layer, box, a } = await setup();
    layer.setPalette(DARK_PALETTE);
    await layer.sync([
      { id: A, shape: a },
      { id: body('f3/body'), shape: box() },
    ]);
    expect(materialsOf(layer, body('f3/body')).faces.color.getHex()).toBe(DARK_PALETTE.face);
  });
});

describe('BodyLayer visibility', () => {
  it('setBodyVisible(false) hides the view and requests a render', async () => {
    const { layer, requestRender } = await setup();
    layer.setBodyVisible(A, false);
    expect(layer.views.get(A)?.object.visible).toBe(false);
    expect(layer.views.get(B)?.object.visible).toBe(true);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('setBodyVisible(true) shows it again', async () => {
    const { layer } = await setup();
    layer.setBodyVisible(A, false);
    layer.setBodyVisible(A, true);
    expect(layer.views.get(A)?.object.visible).toBe(true);
  });

  it('the same value again does not render', async () => {
    const { layer, requestRender } = await setup();
    layer.setBodyVisible(A, true);
    expect(requestRender).not.toHaveBeenCalled();
    layer.setBodyVisible(A, false);
    layer.setBodyVisible(A, false);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('reports a change only (the highlight redraws on it)', async () => {
    const { layer, afterVisibilityChange } = await setup();
    layer.setBodyVisible(A, true);
    layer.setBodyVisible(body('nope'), false);
    expect(afterVisibilityChange).not.toHaveBeenCalled();
    layer.setBodyVisible(A, false);
    layer.setBodyVisible(A, false);
    expect(afterVisibilityChange).toHaveBeenCalledTimes(1);
    layer.setBodyVisible(A, true);
    expect(afterVisibilityChange).toHaveBeenCalledTimes(2);
  });

  it('an unknown body does nothing', async () => {
    const { layer, requestRender, a, b } = await setup();
    const unknown = body('nope');
    layer.setBodyVisible(unknown, false);
    expect(requestRender).not.toHaveBeenCalled();
    // Not remembered: when the body appears later, it is visible.
    await layer.sync([
      { id: A, shape: a },
      { id: B, shape: b },
      { id: unknown, shape: a },
    ]);
    expect(layer.views.get(unknown)?.object.visible).toBe(true);
  });

  it('a body missing from a sync forgets that it was hidden', async () => {
    const { layer, a, b } = await setup();
    layer.setBodyVisible(A, false);
    await layer.sync([{ id: B, shape: b }]);
    await layer.sync([
      { id: A, shape: a },
      { id: B, shape: b },
    ]);
    expect(layer.views.get(A)?.object.visible).toBe(true);
  });

  it('a kept body stays hidden, also with a new shape', async () => {
    const { layer, box, b } = await setup();
    layer.setBodyVisible(A, false);
    await layer.sync([
      { id: A, shape: box() },
      { id: B, shape: b },
    ]);
    expect(layer.views.get(A)?.object.visible).toBe(false);
  });

  it('reset forgets every hidden body', async () => {
    const { layer } = await setup();
    layer.setBodyVisible(A, false);
    layer.reset(boxMeshes());
    await layer.sync([{ id: A, shape: shape(5) }]);
    expect(layer.views.get(A)?.object.visible).toBe(true);
  });
});

describe('BodyLayer bounds', () => {
  it('leave hidden bodies out (fitAll)', async () => {
    const { layer } = await setup();
    // Boxes from the origin, B the bigger one: hiding B shrinks the union to A.
    const both = layer.bounds();
    const onlyA = layer.views.get(A)?.bounds;
    layer.setBodyVisible(B, false);
    expect(layer.bounds()).toEqual(onlyA);
    expect(layer.bounds()).not.toEqual(both);
    layer.setBodyVisible(B, true);
    expect(layer.bounds()).toEqual(both);
  });

  it('are null when every body is hidden', async () => {
    const { layer } = await setup();
    layer.setBodyVisible(A, false);
    layer.setBodyVisible(B, false);
    expect(layer.bounds()).toBeNull();
  });
});

describe('BodyLayer colour', () => {
  const RED = '#ff0000';
  const GREEN = '#00ff00';

  it('gives a coloured body its own face material, the edges keep the palette', async () => {
    const { layer, requestRender } = await setup();
    const shared = materialsOf(layer, B);
    layer.setBodyColor(A, RED);
    const { faces, edges } = materialsOf(layer, A);
    expect(faces).not.toBe(shared.faces);
    expect(faces.color.getHex()).toBe(0xff0000);
    expect(edges).toBe(shared.edges);
    expect(materialsOf(layer, B).faces.color.getHex()).toBe(LIGHT_PALETTE.face);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('the copy keeps the other properties of the shared material', async () => {
    const { layer } = await setup();
    const shared = materialsOf(layer, B).faces;
    layer.setBodyColor(A, RED);
    const { faces } = materialsOf(layer, A);
    expect(faces.polygonOffset).toBe(shared.polygonOffset);
    expect(faces.roughness).toBe(shared.roughness);
  });

  it('null returns the shared material of the palette', async () => {
    const { layer, requestRender } = await setup();
    const shared = materialsOf(layer, B).faces;
    layer.setBodyColor(A, RED);
    const own = materialsOf(layer, A).faces;
    const dispose = vi.spyOn(own, 'dispose');
    layer.setBodyColor(A, null);
    expect(materialsOf(layer, A).faces).toBe(shared);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(requestRender).toHaveBeenCalledTimes(2);
  });

  it('the same value again does not render', async () => {
    const { layer, requestRender } = await setup();
    layer.setBodyColor(A, null);
    expect(requestRender).not.toHaveBeenCalled();
    layer.setBodyColor(A, RED);
    layer.setBodyColor(A, RED);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('switching colours swaps the material and releases the old one', async () => {
    const { layer } = await setup();
    layer.setBodyColor(A, RED);
    const red = materialsOf(layer, A).faces;
    const dispose = vi.spyOn(red, 'dispose');
    layer.setBodyColor(A, GREEN);
    expect(materialsOf(layer, A).faces.color.getHex()).toBe(0x00ff00);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('an invalid colour throws and changes nothing', async () => {
    const { layer, requestRender } = await setup();
    const shared = materialsOf(layer, A).faces;
    expect(() => {
      layer.setBodyColor(A, 'red');
    }).toThrow();
    expect(materialsOf(layer, A).faces).toBe(shared);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('an unknown body does nothing and is not remembered', async () => {
    const { layer, requestRender, a, b } = await setup();
    const unknown = body('nope');
    layer.setBodyColor(unknown, RED);
    expect(requestRender).not.toHaveBeenCalled();
    await layer.sync([
      { id: A, shape: a },
      { id: B, shape: b },
      { id: unknown, shape: a },
    ]);
    expect(materialsOf(layer, unknown).faces.color.getHex()).toBe(LIGHT_PALETTE.face);
  });

  it('a kept body keeps its colour, also with a new shape', async () => {
    const { layer, box, b } = await setup();
    layer.setBodyColor(A, RED);
    const red = materialsOf(layer, A).faces;
    await layer.sync([
      { id: A, shape: box() },
      { id: B, shape: b },
    ]);
    expect(materialsOf(layer, A).faces).toBe(red);
    expect(red.color.getHex()).toBe(0xff0000);
  });

  it('a body missing from a sync forgets its colour and releases the material', async () => {
    const { layer, a, b } = await setup();
    layer.setBodyColor(A, RED);
    const dispose = vi.spyOn(materialsOf(layer, A).faces, 'dispose');
    await layer.sync([{ id: B, shape: b }]);
    expect(dispose).toHaveBeenCalledTimes(1);
    await layer.sync([
      { id: A, shape: a },
      { id: B, shape: b },
    ]);
    expect(materialsOf(layer, A).faces).toBe(materialsOf(layer, B).faces);
  });

  it('bodies with the same colour share the material, the last one releases it', async () => {
    const { layer } = await setup();
    layer.setBodyColor(A, RED);
    layer.setBodyColor(B, RED);
    const red = materialsOf(layer, A).faces;
    expect(materialsOf(layer, B).faces).toBe(red);
    const dispose = vi.spyOn(red, 'dispose');
    layer.setBodyColor(A, null);
    expect(dispose).not.toHaveBeenCalled();
    expect(materialsOf(layer, B).faces).toBe(red);
    layer.setBodyColor(B, GREEN);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('setPalette changes the default only, coloured bodies keep their colour', async () => {
    const { layer } = await setup();
    layer.setBodyColor(A, RED);
    layer.setPalette(DARK_PALETTE);
    expect(materialsOf(layer, A).faces.color.getHex()).toBe(0xff0000);
    expect(materialsOf(layer, A).edges.color.getHex()).toBe(DARK_PALETTE.edge);
    expect(materialsOf(layer, B).faces.color.getHex()).toBe(DARK_PALETTE.face);
    layer.setBodyColor(A, null);
    expect(materialsOf(layer, A).faces.color.getHex()).toBe(DARK_PALETTE.face);
  });

  it('reset forgets every colour and releases the materials', async () => {
    const { layer } = await setup();
    layer.setBodyColor(A, RED);
    const dispose = vi.spyOn(materialsOf(layer, A).faces, 'dispose');
    layer.reset(boxMeshes());
    expect(dispose).toHaveBeenCalledTimes(1);
    await layer.sync([{ id: A, shape: shape(5) }]);
    expect(materialsOf(layer, A).faces.color.getHex()).toBe(LIGHT_PALETTE.face);
  });

  it('dispose releases the colour materials', async () => {
    const { layer } = await setup();
    layer.setBodyColor(A, RED);
    const dispose = vi.spyOn(materialsOf(layer, A).faces, 'dispose');
    layer.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
