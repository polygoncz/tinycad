import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { describe, expect, it, vi } from 'vitest';
import type { BodyId } from '@/interaction';
import type { MeshData, MeshOps, MeshQuality, ShapeHandle } from '@/kernel';
import { createBodyLayers } from '@/render/body-layers';
import { DEFAULT_DISPLAY_STYLE, resolveDisplay } from '@/render/display-style';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render/palette';
import { aBoxMesh, boxMeshes } from '@/render/testing';

// Branded ids are created by a cast in tests only.
const body = (id: string): BodyId => id as BodyId;
const A = body('f1/body');
const B = body('f2/body');
// boxMeshes: the handle is the size of a box from the origin.
const shape = (n: number): ShapeHandle => n as ShapeHandle;
const QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };
const SIZE = 1000;

/** boxMeshes that counts tessellate calls per handle. */
function countingMeshes() {
  const inner = boxMeshes();
  const calls: ShapeHandle[] = [];
  const meshes: MeshOps = {
    tessellate: (s, quality) => {
      calls.push(s);
      return inner.tessellate(s, quality);
    },
  };
  return { meshes, calls };
}

/** MeshOps whose tessellate waits until the test releases the handle (a box of its size). */
function manualMeshes() {
  const pending = new Map<ShapeHandle, () => void>();
  const calls: ShapeHandle[] = [];
  const meshes: MeshOps = {
    tessellate: (s) =>
      new Promise<MeshData>((resolve) => {
        calls.push(s);
        const n = s as number; // boxMeshes convention: the handle is the size of the box
        pending.set(s, () => {
          resolve(aBoxMesh([0, 0, 0], [n, n, n]));
        });
      }),
  };
  const release = async (s: ShapeHandle): Promise<void> => {
    const fn = pending.get(s);
    if (fn === undefined) throw new Error(`no tessellate call for ${String(s)}`);
    fn();
    // Lets every continuation waiting for the mesh run.
    await new Promise((r) => setTimeout(r, 0));
  };
  return { meshes, calls, release };
}

function manualSetup() {
  const k = manualMeshes();
  const layers = createBodyLayers({
    meshes: k.meshes,
    quality: QUALITY,
    palette: LIGHT_PALETTE,
    reportError: () => undefined,
    requestRender: () => undefined,
  });
  return { layers, k };
}

function setup() {
  const k = countingMeshes();
  const requestRender = vi.fn();
  const afterApply = vi.fn();
  const afterVisibilityChange = vi.fn();
  const layers = createBodyLayers({
    meshes: k.meshes,
    quality: QUALITY,
    palette: LIGHT_PALETTE,
    reportError: () => undefined,
    requestRender,
    afterApply,
    afterVisibilityChange,
  });
  return { layers, k, requestRender, afterApply, afterVisibilityChange };
}

function facesOf(view: { readonly faces: THREE.Mesh } | undefined): THREE.MeshStandardMaterial {
  const material = view?.faces.material;
  if (!(material instanceof THREE.MeshStandardMaterial)) throw new Error('faces material');
  return material;
}

/** Looking down −Z at the origin; 1 px = 0.1 mm, px (500, 500) is the origin. */
function topCamera(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  return camera;
}

describe('BodyLayers', () => {
  it('keeps separate bodies by BodyId in the main layer and the preview', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: A, shape: shape(7) }]);
    expect(layers.main.views.get(A)?.bounds?.max).toEqual([5, 5, 5]);
    expect(layers.preview.views.get(A)?.bounds?.max).toEqual([7, 7, 7]);
  });

  it('tessellates a handle once, whichever layer shows it', async () => {
    const { layers, k } = setup();
    await layers.preview.sync([{ id: A, shape: shape(7) }]);
    // The session closes: the main layer shows the result, the preview empties.
    await layers.main.sync([{ id: A, shape: shape(7) }]);
    layers.preview.clear();
    expect(k.calls).toEqual([shape(7)]);
  });

  it('the preview draws in its style, the main layer in the body style', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    expect(facesOf(layers.main.views.get(A)).transparent).toBe(false);
    expect(facesOf(layers.preview.views.get(B)).transparent).toBe(true);
    expect(facesOf(layers.preview.views.get(B)).color.getHex()).toBe(LIGHT_PALETTE.bodyPreview);
  });

  it('setPalette recolours both layers', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    layers.setPalette(DARK_PALETTE);
    expect(facesOf(layers.main.views.get(A)).color.getHex()).toBe(DARK_PALETTE.face);
    expect(facesOf(layers.preview.views.get(B)).color.getHex()).toBe(DARK_PALETTE.bodyPreview);
  });

  it('the bounds enclose the visible bodies of both layers', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    expect(layers.bounds()?.max).toEqual([5, 5, 5]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    expect(layers.bounds()?.max).toEqual([7, 7, 7]);
    layers.setBodyVisible(B, false);
    expect(layers.bounds()?.max).toEqual([5, 5, 5]);
    layers.setBodyVisible(A, false);
    expect(layers.bounds()).toBeNull();
  });

  it('setBodyVisible and setBodyColor apply to both layers', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: A, shape: shape(7) }]);
    layers.setBodyVisible(A, false);
    expect(layers.main.views.get(A)?.object.visible).toBe(false);
    expect(layers.preview.views.get(A)?.object.visible).toBe(false);
    layers.setBodyColor(A, '#ff0000');
    expect(facesOf(layers.main.views.get(A)).color.getHex()).toBe(0xff0000);
    expect(facesOf(layers.preview.views.get(A)).color.getHex()).toBe(0xff0000);
  });

  it('an invalid colour throws and changes neither layer', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: A, shape: shape(7) }]);
    expect(() => {
      layers.setBodyColor(A, 'red');
    }).toThrow();
    expect(facesOf(layers.main.views.get(A)).color.getHex()).toBe(LIGHT_PALETTE.face);
    expect(facesOf(layers.preview.views.get(A)).color.getHex()).toBe(LIGHT_PALETTE.bodyPreview);
  });

  it('the highlight follows the main layer only', async () => {
    const { layers, afterApply, afterVisibilityChange } = setup();
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    layers.setBodyVisible(B, false);
    expect(afterApply).not.toHaveBeenCalled();
    expect(afterVisibilityChange).not.toHaveBeenCalled();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    layers.setBodyVisible(A, false);
    expect(afterApply).toHaveBeenCalledTimes(1);
    expect(afterVisibilityChange).toHaveBeenCalledTimes(1);
  });

  it('the picker sees the main layer only, the preview neither hits nor hides', async () => {
    const { layers } = setup();
    // The preview box (0..50) encloses the main one (0..5) and is closer to the camera.
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(50) }]);
    // (2, 2): inside the top faces of both boxes, far from their edges.
    const hit = layers.picker.pick(topCamera(), SIZE / 2 + 20, SIZE / 2 - 20, SIZE, SIZE);
    expect(hit).toMatchObject({ kind: 'face', body: A });
    expect(layers.picker.isVisible(topCamera(), [2, 2, 5])).toBe(true);
  });

  it('hands the x-ray flag to the picker (M22)', async () => {
    let xray = false;
    const layers = createBodyLayers({
      meshes: boxMeshes(),
      quality: QUALITY,
      palette: LIGHT_PALETTE,
      reportError: () => undefined,
      requestRender: () => undefined,
      xray: () => xray,
    });
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    // Under the box A (0..5), hidden by its top face.
    expect(layers.picker.isVisible(topCamera(), [2, 2, -1])).toBe(false);
    xray = true;
    expect(layers.picker.isVisible(topCamera(), [2, 2, -1])).toBe(true);
  });

  it('preview.clear empties the preview and leaves the main layer', async () => {
    const { layers, requestRender } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    requestRender.mockClear();
    layers.preview.clear();
    expect(layers.preview.views.size).toBe(0);
    expect(layers.preview.group.children).toHaveLength(0);
    expect(layers.main.views.has(A)).toBe(true);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('reset empties both layers and tessellates through the new MeshOps', async () => {
    const { layers, k } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    const k2 = countingMeshes();
    layers.reset(k2.meshes);
    expect(layers.main.views.size).toBe(0);
    expect(layers.preview.views.size).toBe(0);
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    expect(k.calls).toEqual([shape(5), shape(7)]);
    expect(k2.calls).toEqual([shape(5), shape(7)]);
  });

  it('a sync running during reset never applies', async () => {
    const { layers } = setup();
    const running = layers.preview.sync([{ id: B, shape: shape(7) }]);
    layers.reset(countingMeshes().meshes);
    await running;
    expect(layers.preview.views.size).toBe(0);
  });

  it('dispose disposes the views of both layers', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    const main = layers.main.views.get(A);
    const preview = layers.preview.views.get(B);
    if (main === undefined || preview === undefined) throw new Error('not shown');
    const disposeMain = vi.spyOn(main, 'dispose');
    const disposePreview = vi.spyOn(preview, 'dispose');
    layers.dispose();
    expect(disposeMain).toHaveBeenCalledTimes(1);
    expect(disposePreview).toHaveBeenCalledTimes(1);
  });
});

describe('BodyLayers.syncLayers (M21, D3 of M19.1)', () => {
  it('swaps both layers in one block once the meshes of both are ready', async () => {
    const { layers, k } = manualSetup();
    const done = layers.syncLayers({
      main: [{ id: A, shape: shape(5) }],
      preview: [{ id: B, shape: shape(7) }],
    });
    // The main meshes are ready, the preview ones not: neither layer swaps yet.
    await k.release(shape(5));
    expect(layers.main.views.size).toBe(0);
    expect(layers.preview.views.size).toBe(0);
    await k.release(shape(7));
    await done;
    expect(layers.main.views.has(A)).toBe(true);
    expect(layers.preview.views.has(B)).toBe(true);
  });

  it('a stale syncLayers swaps neither layer', async () => {
    const { layers, k } = manualSetup();
    const first = layers.syncLayers({
      main: [{ id: A, shape: shape(5) }],
      preview: [{ id: B, shape: shape(7) }],
    });
    const second = layers.syncLayers({ main: [{ id: A, shape: shape(9) }], preview: [] });
    await k.release(shape(5));
    await k.release(shape(7));
    await first;
    expect(layers.main.views.size).toBe(0);
    expect(layers.preview.views.size).toBe(0);
    await k.release(shape(9));
    await second;
    expect(layers.main.views.get(A)?.bounds?.max).toEqual([9, 9, 9]);
    expect(layers.preview.views.size).toBe(0);
  });

  it('a newer sync of one layer makes the whole syncLayers stale', async () => {
    const { layers, k } = manualSetup();
    const running = layers.syncLayers({
      main: [{ id: A, shape: shape(5) }],
      preview: [{ id: B, shape: shape(7) }],
    });
    const mainOnly = layers.main.sync([{ id: A, shape: shape(9) }]);
    await k.release(shape(5));
    await k.release(shape(7));
    await running;
    expect(layers.preview.views.size).toBe(0);
    await k.release(shape(9));
    await mainOnly;
    expect(layers.main.views.get(A)?.bounds?.max).toEqual([9, 9, 9]);
  });

  it('closing the dialog does not tessellate the previewed result again', async () => {
    const { layers, k } = setup();
    await layers.syncLayers({
      main: [{ id: A, shape: shape(5) }],
      preview: [{ id: A, shape: shape(7) }],
    });
    // The result becomes the main layer and the preview empties.
    await layers.syncLayers({ main: [{ id: A, shape: shape(7) }], preview: [] });
    expect(k.calls).toEqual([shape(5), shape(7)]);
    expect(layers.main.views.get(A)?.bounds?.max).toEqual([7, 7, 7]);
    expect(layers.preview.views.size).toBe(0);
  });

  it('a duplicate BodyId throws before anything changes', async () => {
    const { layers, k } = manualSetup();
    const running = layers.main.sync([{ id: A, shape: shape(5) }]);
    expect(() =>
      layers.syncLayers({
        main: [{ id: B, shape: shape(1) }],
        preview: [
          { id: B, shape: shape(7) },
          { id: B, shape: shape(8) },
        ],
      }),
    ).toThrow();
    // The running sync of the main layer is still current.
    await k.release(shape(5));
    await running;
    expect(layers.main.views.has(A)).toBe(true);
  });
});

describe('BodyLayers display plan (M22)', () => {
  const HIDDEN_VISIBLE = resolveDisplay({ ...DEFAULT_DISPLAY_STYLE, mode: 'hiddenVisible' });

  function hiddenEdgesOf(view: { readonly hiddenEdges: THREE.LineSegments } | undefined) {
    const material = view?.hiddenEdges.material;
    if (!(material instanceof THREE.LineDashedMaterial)) throw new Error('hidden edges material');
    return material;
  }

  it('setDisplayPlan switches the main layer only, the preview stays as it is', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    const preview = layers.preview.views.get(B);
    const before = facesOf(preview);
    layers.setDisplayPlan(HIDDEN_VISIBLE);
    expect(layers.main.views.get(A)?.faces.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(layers.main.views.get(A)?.hiddenEdges.visible).toBe(true);
    expect(facesOf(preview)).toBe(before);
    expect(before.transparent).toBe(true);
    expect(preview?.hiddenEdges.visible).toBe(false);
    // A preview body added later is not switched either.
    await layers.preview.sync([
      { id: B, shape: shape(7) },
      { id: A, shape: shape(8) },
    ]);
    expect(facesOf(layers.preview.views.get(A))).toBe(before);
  });

  it('initialPlan applies to the main layer from the first sync, not to the preview', async () => {
    const layers = createBodyLayers({
      meshes: boxMeshes(),
      quality: QUALITY,
      palette: LIGHT_PALETTE,
      reportError: () => undefined,
      requestRender: () => undefined,
      initialPlan: HIDDEN_VISIBLE,
    });
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    expect(layers.main.views.get(A)?.faces.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(layers.main.views.get(A)?.hiddenEdges.visible).toBe(true);
    expect(facesOf(layers.preview.views.get(B)).transparent).toBe(true);
    expect(layers.preview.views.get(B)?.hiddenEdges.visible).toBe(false);
  });

  it('setPixelSize reaches the main layer only', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    const previewDash = hiddenEdgesOf(layers.preview.views.get(B)).dashSize;
    layers.setPixelSize(0.5);
    expect(hiddenEdgesOf(layers.main.views.get(A)).dashSize).toBe(3);
    expect(hiddenEdgesOf(layers.preview.views.get(B)).dashSize).toBe(previewDash);
  });

  it('setResolution reaches the main layer only', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    const mainSpy = vi.spyOn(layers.main, 'setResolution');
    const previewSpy = vi.spyOn(layers.preview, 'setResolution');
    layers.setResolution(800, 600);
    expect(mainSpy).toHaveBeenCalledWith(800, 600);
    expect(previewSpy).not.toHaveBeenCalled();
  });

  it('the preview gets no thick edges with triangulation', async () => {
    const { layers } = setup();
    await layers.main.sync([{ id: A, shape: shape(5) }]);
    await layers.preview.sync([{ id: B, shape: shape(7) }]);
    layers.setDisplayPlan(resolveDisplay({ ...DEFAULT_DISPLAY_STYLE, mesh: true }));
    const thick = (o: THREE.Object3D | undefined) =>
      o?.children.some((c) => c instanceof LineSegments2);
    expect(thick(layers.main.views.get(A)?.object)).toBe(true);
    expect(thick(layers.preview.views.get(B)?.object)).toBe(false);
    expect(layers.preview.views.get(B)?.edges.visible).toBe(true);
  });
});
