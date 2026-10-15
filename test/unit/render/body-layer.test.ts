import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { describe, expect, it, vi } from 'vitest';
import type { BodyId } from '@/interaction';
import type { ShapeHandle } from '@/kernel';
import { createBodyLayer } from '@/render/body-layer';
import type { BodyStyle } from '@/render/body-view';
import {
  DEFAULT_DISPLAY_STYLE,
  resolveDisplay,
  TRANSPARENT_FACE_OPACITY,
  type DisplayStyle,
} from '@/render/display-style';
import { createSharedMeshCache } from '@/render/mesh-cache';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render/palette';
import { boxMeshes } from '@/render/testing';

// Branded ids are created by a cast in tests only.
const body = (id: string): BodyId => id as BodyId;
const A = body('f1/body');
const B = body('f2/body');
// boxMeshes: the handle is the box size; distinct handles = distinct shapes.
const shape = (n: number): ShapeHandle => n as ShapeHandle;

async function setup(style: BodyStyle = 'body') {
  const requestRender = vi.fn();
  const afterVisibilityChange = vi.fn();
  const layer = createBodyLayer({
    afterVisibilityChange,
    cache: createSharedMeshCache(boxMeshes(), {
      linearDeflection: 0.1,
      angularDeflection: 0.5,
    }).client(),
    style,
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

  it('clear forgets every hidden body', async () => {
    const { layer } = await setup();
    layer.setBodyVisible(A, false);
    layer.clear();
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

  it('clear forgets every colour and releases the materials', async () => {
    const { layer } = await setup();
    layer.setBodyColor(A, RED);
    const dispose = vi.spyOn(materialsOf(layer, A).faces, 'dispose');
    layer.clear();
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

describe('BodyLayer clear', () => {
  it('removes and disposes every view and requests a render', async () => {
    const { layer, requestRender } = await setup();
    const view = layer.views.get(A);
    if (view === undefined) throw new Error('A is not shown');
    const dispose = vi.spyOn(view, 'dispose');
    layer.clear();
    expect(layer.views.size).toBe(0);
    expect(layer.group.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('with nothing shown does not render', async () => {
    const { layer, requestRender } = await setup();
    layer.clear();
    requestRender.mockClear();
    layer.clear();
    expect(requestRender).not.toHaveBeenCalled();
  });
});

describe('BodyLayer preview style (M21)', () => {
  it('draws transparent faces and edges in the body preview colour, not the tool overlay one', async () => {
    const { layer } = await setup('preview');
    const { faces, edges } = materialsOf(layer, A);
    expect(faces.color.getHex()).toBe(LIGHT_PALETTE.bodyPreview);
    expect(faces.transparent).toBe(true);
    expect(faces.opacity).toBe(0.35);
    expect(faces.depthWrite).toBe(false);
    expect(edges.color.getHex()).toBe(LIGHT_PALETTE.bodyPreview);
  });

  it('pulls its faces towards the camera, so they win over the coplanar faces of the input', async () => {
    // A changed body shares most faces with the input body; two tessellations of one plane would
    // otherwise fight for depth pixel by pixel (z-fighting, found by hand in M21).
    const { faces } = materialsOf((await setup('preview')).layer, A);
    const body = materialsOf((await setup('body')).layer, A).faces;
    expect(faces.polygonOffset).toBe(true);
    expect(faces.polygonOffsetFactor).toBeLessThan(0);
    expect(faces.polygonOffsetUnits).toBeLessThan(0);
    expect(faces.polygonOffsetFactor).toBeLessThan(body.polygonOffsetFactor);
  });

  it('draws above the bodies and below the highlight', async () => {
    const preview = (await setup('preview')).layer.views.get(A);
    const body = (await setup()).layer.views.get(A);
    if (preview === undefined || body === undefined) throw new Error('A is not shown');
    expect(body.faces.renderOrder).toBe(0);
    expect(body.edges.renderOrder).toBe(0);
    for (const object of [preview.faces, preview.edges]) {
      expect(object.renderOrder).toBeGreaterThan(0);
      // HighlightLayer draws with renderOrder 1 (spec 09, "Vrstvy pro interakci").
      expect(object.renderOrder).toBeLessThan(1);
    }
  });

  it('setPalette recolours the preview materials', async () => {
    const { layer } = await setup('preview');
    layer.setPalette(DARK_PALETTE);
    const { faces, edges } = materialsOf(layer, A);
    expect(faces.color.getHex()).toBe(DARK_PALETTE.bodyPreview);
    expect(edges.color.getHex()).toBe(DARK_PALETTE.bodyPreview);
  });

  it('a coloured preview body stays transparent', async () => {
    const { layer } = await setup('preview');
    layer.setBodyColor(A, '#ff0000');
    const { faces } = materialsOf(layer, A);
    expect(faces.color.getHex()).toBe(0xff0000);
    expect(faces.transparent).toBe(true);
    expect(faces.opacity).toBe(0.35);
    expect(faces.depthWrite).toBe(false);
  });
});

describe('BodyLayer display plan (M22)', () => {
  const SHADED = resolveDisplay(DEFAULT_DISPLAY_STYLE);
  const plan = (style: Partial<DisplayStyle>) =>
    resolveDisplay({ ...DEFAULT_DISPLAY_STYLE, ...style });
  const HIDDEN_REMOVED = plan({ mode: 'hiddenRemoved' });
  const HIDDEN_VISIBLE = plan({ mode: 'hiddenVisible' });
  const WIREFRAME = plan({ mode: 'wireframe' });
  const TRANSPARENT = plan({ transparent: true });
  const MESH = plan({ mesh: true });

  function viewOf(layer: Awaited<ReturnType<typeof setup>>['layer'], id: BodyId) {
    const view = layer.views.get(id);
    if (view === undefined) throw new Error(`body ${id} is not shown`);
    return view;
  }

  /** The face material of a body, of the expected class. */
  function facesAs<T extends THREE.Material>(
    layer: Awaited<ReturnType<typeof setup>>['layer'],
    id: BodyId,
    type: abstract new (...args: never[]) => T,
  ): T {
    const material = viewOf(layer, id).faces.material;
    if (!(material instanceof type)) throw new Error('unexpected faces material');
    return material;
  }

  function hiddenEdgesOf(layer: Awaited<ReturnType<typeof setup>>['layer'], id: BodyId) {
    const hidden = viewOf(layer, id).hiddenEdges;
    const material = hidden.material;
    if (!(material instanceof THREE.LineDashedMaterial)) throw new Error('hidden edges material');
    return { hidden, material };
  }

  /** The lines of the triangulation of a body, or undefined when there are none. */
  function meshLinesOf(layer: Awaited<ReturnType<typeof setup>>['layer'], id: BodyId) {
    const view = viewOf(layer, id);
    return view.object.children.find(
      (o): o is THREE.LineSegments =>
        o instanceof THREE.LineSegments && o.geometry instanceof THREE.WireframeGeometry,
    );
  }

  /** The thick edges of a body (triangulation with edges), or undefined when there are none. */
  function thickEdgesOf(layer: Awaited<ReturnType<typeof setup>>['layer'], id: BodyId) {
    const view = viewOf(layer, id);
    const thick = view.object.children.find((o): o is LineSegments2 => o instanceof LineSegments2);
    if (thick === undefined) return undefined;
    const material = thick.material;
    if (!(material instanceof LineMaterial)) throw new Error('thick edges material');
    return { thick, material };
  }

  it('starts in the default plan: lit faces, visible edges, no hidden edges, no mesh lines', async () => {
    const { layer } = await setup();
    expect(facesAs(layer, A, THREE.MeshStandardMaterial).color.getHex()).toBe(LIGHT_PALETTE.face);
    expect(viewOf(layer, A).edges.visible).toBe(true);
    expect(hiddenEdgesOf(layer, A).hidden.visible).toBe(false);
    expect(meshLinesOf(layer, A)).toBeUndefined();
  });

  it('a layer created with an initial plan draws in it from the first sync', async () => {
    const layer = createBodyLayer({
      cache: createSharedMeshCache(boxMeshes(), {
        linearDeflection: 0.1,
        angularDeflection: 0.5,
      }).client(),
      reportError: () => undefined,
      requestRender: () => undefined,
      palette: LIGHT_PALETTE,
      initialPlan: HIDDEN_VISIBLE,
    });
    await layer.sync([{ id: A, shape: shape(10) }]);
    facesAs(layer, A, THREE.MeshBasicMaterial);
    expect(viewOf(layer, A).edges.visible).toBe(true);
    expect(hiddenEdgesOf(layer, A).hidden.visible).toBe(true);
  });

  it('setDisplayPlan with the initial plan does not render', async () => {
    const requestRender = vi.fn();
    const layer = createBodyLayer({
      cache: createSharedMeshCache(boxMeshes(), {
        linearDeflection: 0.1,
        angularDeflection: 0.5,
      }).client(),
      reportError: () => undefined,
      requestRender,
      palette: LIGHT_PALETTE,
      initialPlan: HIDDEN_VISIBLE,
    });
    await layer.sync([{ id: A, shape: shape(10) }]);
    requestRender.mockClear();
    layer.setDisplayPlan(plan({ mode: 'hiddenVisible' }));
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('the default plan again does not render', async () => {
    const { layer, requestRender } = await setup();
    layer.setDisplayPlan(SHADED);
    layer.setDisplayPlan(resolveDisplay({ ...DEFAULT_DISPLAY_STYLE }));
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('a new plan switches every view and renders once; the same plan again does not', async () => {
    const { layer, requestRender } = await setup();
    layer.setDisplayPlan(HIDDEN_REMOVED);
    expect(requestRender).toHaveBeenCalledTimes(1);
    layer.setDisplayPlan(plan({ mode: 'hiddenRemoved' }));
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(viewOf(layer, A).faces.material).toBe(viewOf(layer, B).faces.material);
  });

  it('flat: an unlit material in the background colour that writes depth behind the edges', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(HIDDEN_REMOVED);
    const flat = facesAs(layer, A, THREE.MeshBasicMaterial);
    expect(flat.color.getHex()).toBe(LIGHT_PALETTE.background);
    expect(flat.depthWrite).toBe(true);
    expect(flat.colorWrite).toBe(true);
    expect(flat.polygonOffset).toBe(true);
    expect(flat.polygonOffsetFactor).toBe(1);
    expect(flat.polygonOffsetUnits).toBe(1);
  });

  it('hidden: writes neither colour nor depth, the faces stay visible for the raycast', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(WIREFRAME);
    const hidden = facesAs(layer, A, THREE.MeshBasicMaterial);
    expect(hidden.colorWrite).toBe(false);
    expect(hidden.depthWrite).toBe(false);
    expect(viewOf(layer, A).faces.visible).toBe(true);
    expect(viewOf(layer, A).object.visible).toBe(true);
    expect(viewOf(layer, A).edges.visible).toBe(true);
  });

  it('back to lit returns the palette material', async () => {
    const { layer } = await setup();
    const shared = facesAs(layer, A, THREE.MeshStandardMaterial);
    layer.setDisplayPlan(WIREFRAME);
    layer.setDisplayPlan(SHADED);
    expect(viewOf(layer, A).faces.material).toBe(shared);
  });

  it('a coloured body loses its colour in flat and hidden and gets it back in lit', async () => {
    const { layer } = await setup();
    layer.setBodyColor(A, '#ff0000');
    const red = facesAs(layer, A, THREE.MeshStandardMaterial);
    layer.setDisplayPlan(HIDDEN_REMOVED);
    expect(viewOf(layer, A).faces.material).toBe(viewOf(layer, B).faces.material);
    layer.setDisplayPlan(WIREFRAME);
    expect(viewOf(layer, A).faces.material).toBe(viewOf(layer, B).faces.material);
    layer.setDisplayPlan(SHADED);
    expect(viewOf(layer, A).faces.material).toBe(red);
  });

  it('a colour set in flat applies on the return to lit', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(HIDDEN_REMOVED);
    layer.setBodyColor(A, '#ff0000');
    expect(facesAs(layer, A, THREE.MeshBasicMaterial).color.getHex()).toBe(
      LIGHT_PALETTE.background,
    );
    layer.setDisplayPlan(SHADED);
    expect(facesAs(layer, A, THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000);
  });

  it('transparency applies to the palette and the colour materials', async () => {
    const { layer } = await setup();
    layer.setBodyColor(A, '#ff0000');
    const red = facesAs(layer, A, THREE.MeshStandardMaterial);
    const shared = facesAs(layer, B, THREE.MeshStandardMaterial);
    const versions = [red.version, shared.version];
    layer.setDisplayPlan(TRANSPARENT);
    for (const material of [red, shared]) {
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBe(TRANSPARENT_FACE_OPACITY);
      expect(material.depthWrite).toBe(false);
    }
    // The switch of `transparent` recompiles the program (needsUpdate).
    expect(red.version).toBeGreaterThan(versions[0] ?? 0);
    expect(shared.version).toBeGreaterThan(versions[1] ?? 0);
    expect(viewOf(layer, A).faces.material).toBe(red);
    layer.setDisplayPlan(SHADED);
    for (const material of [red, shared]) {
      expect(material.transparent).toBe(false);
      expect(material.opacity).toBe(1);
      expect(material.depthWrite).toBe(true);
    }
  });

  it('a colour set after the switch to transparency is transparent too', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(TRANSPARENT);
    layer.setBodyColor(A, '#00ff00');
    const green = facesAs(layer, A, THREE.MeshStandardMaterial);
    expect(green.color.getHex()).toBe(0x00ff00);
    expect(green.transparent).toBe(true);
    expect(green.opacity).toBe(TRANSPARENT_FACE_OPACITY);
    expect(green.depthWrite).toBe(false);
  });

  it('a body added after the switch gets the current plan', async () => {
    const { layer, box, a, b } = await setup();
    layer.setDisplayPlan(plan({ mode: 'hiddenVisible', mesh: true }));
    const C = body('f3/body');
    await layer.sync([
      { id: A, shape: a },
      { id: B, shape: b },
      { id: C, shape: box() },
    ]);
    expect(viewOf(layer, C).faces.material).toBe(viewOf(layer, A).faces.material);
    expect(facesAs(layer, C, THREE.MeshBasicMaterial).colorWrite).toBe(true);
    expect(hiddenEdgesOf(layer, C).hidden.visible).toBe(true);
    expect(meshLinesOf(layer, C)).toBeDefined();
  });

  it('a kept coloured body with a new shape follows the plan', async () => {
    const { layer, box, b } = await setup();
    layer.setBodyColor(A, '#ff0000');
    layer.setDisplayPlan(HIDDEN_REMOVED);
    await layer.sync([
      { id: A, shape: box() },
      { id: B, shape: b },
    ]);
    expect(viewOf(layer, A).faces.material).toBe(viewOf(layer, B).faces.material);
    layer.setDisplayPlan(SHADED);
    expect(facesAs(layer, A, THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000);
  });

  it('the edges follow plan.edges', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(plan({ edges: false }));
    expect(viewOf(layer, A).edges.visible).toBe(false);
    layer.setDisplayPlan(SHADED);
    expect(viewOf(layer, A).edges.visible).toBe(true);
  });

  it('hidden edges: dashed only, share the edge geometry, behind the faces', async () => {
    const { layer } = await setup();
    const { hidden, material } = hiddenEdgesOf(layer, A);
    const view = viewOf(layer, A);
    expect(hidden.geometry).toBe(view.edges.geometry);
    expect(hidden.geometry.getAttribute('lineDistance')).toBeDefined();
    expect(hidden.renderOrder).toBe(0.5);
    expect(material.color.getHex()).toBe(LIGHT_PALETTE.hiddenEdge);
    expect(material.depthFunc).toBe(THREE.GreaterDepth);
    expect(material.depthWrite).toBe(false);
    for (const p of [SHADED, HIDDEN_REMOVED, WIREFRAME, TRANSPARENT]) {
      layer.setDisplayPlan(p);
      expect(hidden.visible).toBe(false);
    }
    layer.setDisplayPlan(HIDDEN_VISIBLE);
    expect(hidden.visible).toBe(true);
    expect(hiddenEdgesOf(layer, B).hidden.visible).toBe(true);
  });

  it('mesh lines appear only with meshLines and are released when switched off', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(MESH);
    const lines = meshLinesOf(layer, A);
    if (lines === undefined) throw new Error('no mesh lines');
    const material = lines.material;
    if (!(material instanceof THREE.LineBasicMaterial)) throw new Error('mesh lines material');
    expect(material.color.getHex()).toBe(LIGHT_PALETTE.meshLine);
    expect(meshLinesOf(layer, B)?.material).toBe(material);
    const dispose = vi.spyOn(lines.geometry, 'dispose');
    layer.setDisplayPlan(SHADED);
    expect(meshLinesOf(layer, A)).toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('the mesh lines stay in every mode', async () => {
    const { layer } = await setup();
    for (const mode of ['hiddenRemoved', 'hiddenVisible', 'wireframe'] as const) {
      layer.setDisplayPlan(plan({ mode, mesh: true }));
      expect(meshLinesOf(layer, A)).toBeDefined();
    }
  });

  it('dispose of a view releases its mesh lines', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(MESH);
    const lines = meshLinesOf(layer, A);
    if (lines === undefined) throw new Error('no mesh lines');
    const dispose = vi.spyOn(lines.geometry, 'dispose');
    layer.clear();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('setPixelSize sets 6 px dashes and 4 px gaps without rendering', async () => {
    const { layer, requestRender } = await setup();
    layer.setPixelSize(0.5);
    const { material } = hiddenEdgesOf(layer, A);
    expect(material.dashSize).toBe(3);
    expect(material.gapSize).toBe(2);
    layer.setPixelSize(0.5);
    layer.setPixelSize(0.1);
    expect(material.dashSize).toBeCloseTo(0.6);
    expect(material.gapSize).toBeCloseTo(0.4);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('setPalette recolours the flat material, the hidden edges and the mesh lines', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(plan({ mode: 'hiddenVisible', mesh: true }));
    layer.setPalette(DARK_PALETTE);
    expect(facesAs(layer, A, THREE.MeshBasicMaterial).color.getHex()).toBe(DARK_PALETTE.background);
    expect(hiddenEdgesOf(layer, A).material.color.getHex()).toBe(DARK_PALETTE.hiddenEdge);
    const lines = meshLinesOf(layer, A)?.material;
    if (!(lines instanceof THREE.LineBasicMaterial)) throw new Error('mesh lines material');
    expect(lines.color.getHex()).toBe(DARK_PALETTE.meshLine);
  });

  it('dispose releases the materials of the plan', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(plan({ mode: 'hiddenVisible', mesh: true }));
    const flat = facesAs(layer, A, THREE.MeshBasicMaterial);
    const hidden = hiddenEdgesOf(layer, A).material;
    const lines = meshLinesOf(layer, A)?.material;
    if (!(lines instanceof THREE.LineBasicMaterial)) throw new Error('mesh lines material');
    layer.setDisplayPlan(WIREFRAME);
    const invisible = facesAs(layer, A, THREE.MeshBasicMaterial);
    const spies = [flat, hidden, lines, invisible].map((m) => vi.spyOn(m, 'dispose'));
    layer.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
  it('triangulation with edges draws the thick edges instead of the thin ones', async () => {
    const { layer } = await setup();
    expect(thickEdgesOf(layer, A)).toBeUndefined();
    layer.setDisplayPlan(MESH);
    const found = thickEdgesOf(layer, A);
    if (found === undefined) throw new Error('no thick edges');
    const { thick, material } = found;
    const view = viewOf(layer, A);
    expect(view.edges.visible).toBe(false);
    expect(thick.visible).toBe(true);
    expect(material.color.getHex()).toBe(LIGHT_PALETTE.edge);
    expect(material.linewidth).toBe(2);
    expect(material.worldUnits).toBe(false);
    expect(thick.renderOrder).toBe(0);
    expect(thickEdgesOf(layer, B)?.material).toBe(material);
    // The positions of the thin edges: one instance per segment.
    const edgeVertices = view.edges.geometry.getAttribute('position').count;
    expect(thick.geometry.instanceCount).toBe(edgeVertices / 2);
  });

  it('without triangulation the thin edges are drawn and no thick ones', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(MESH);
    const found = thickEdgesOf(layer, A);
    if (found === undefined) throw new Error('no thick edges');
    const dispose = vi.spyOn(found.thick.geometry, 'dispose');
    layer.setDisplayPlan(SHADED);
    expect(thickEdgesOf(layer, A)).toBeUndefined();
    expect(viewOf(layer, A).edges.visible).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('triangulation without edges draws no edges at all', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(plan({ mesh: true, edges: false }));
    expect(thickEdgesOf(layer, A)).toBeUndefined();
    expect(viewOf(layer, A).edges.visible).toBe(false);
  });

  it('the thick edges are kept between plans and replace the thin ones in every mode', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(MESH);
    const first = thickEdgesOf(layer, A)?.thick;
    for (const mode of ['hiddenRemoved', 'hiddenVisible', 'wireframe'] as const) {
      layer.setDisplayPlan(plan({ mode, mesh: true }));
      expect(thickEdgesOf(layer, A)?.thick).toBe(first);
      expect(viewOf(layer, A).edges.visible).toBe(false);
    }
    // The hidden edges stay thin and dashed.
    layer.setDisplayPlan(plan({ mode: 'hiddenVisible', mesh: true }));
    expect(hiddenEdgesOf(layer, A).hidden.visible).toBe(true);
  });

  it('dispose of a view releases its thick edges', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(MESH);
    const found = thickEdgesOf(layer, A);
    if (found === undefined) throw new Error('no thick edges');
    const dispose = vi.spyOn(found.thick.geometry, 'dispose');
    layer.clear();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('setPalette recolours the thick edges', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(MESH);
    layer.setPalette(DARK_PALETTE);
    expect(thickEdgesOf(layer, A)?.material.color.getHex()).toBe(DARK_PALETTE.edge);
  });

  it('setResolution sets the resolution of the thick edges without rendering', async () => {
    const { layer, requestRender } = await setup();
    layer.setDisplayPlan(MESH);
    requestRender.mockClear();
    layer.setResolution(800, 600);
    const material = thickEdgesOf(layer, A)?.material;
    expect(material?.resolution.x).toBe(800);
    expect(material?.resolution.y).toBe(600);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('dispose releases the thick edge material', async () => {
    const { layer } = await setup();
    layer.setDisplayPlan(MESH);
    const material = thickEdgesOf(layer, A)?.material;
    if (material === undefined) throw new Error('no thick edges');
    const spy = vi.spyOn(material, 'dispose');
    layer.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
