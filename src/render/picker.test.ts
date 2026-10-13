import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BodyId } from '@/interaction';
import { unionBounds } from './bounds';
import { createBodyMaterials, createBodyView, type BodyView } from './body-view';
import { LIGHT_PALETTE } from './palette';
import { createPicker } from './picker';
import { aBoxMesh } from './testing';

// Branded ids are created by a cast in tests only.
const A = 'f1/body' as BodyId;
const B = 'f2/body' as BodyId;
const SIZE = 1000;

/** Two boxes in a row along the view direction: A in front (z 10..20), B behind (z 0..5). */
function setup() {
  const materials = createBodyMaterials(LIGHT_PALETTE);
  const view = (id: BodyId, z: number, height: number): BodyView =>
    createBodyView(id, aBoxMesh([-10, -10, z], [10, 10, z + height]), materials);
  const views = [view(A, 10, 10), view(B, 0, 5)];
  const picker = createPicker({
    views: () => views,
    bounds: () => unionBounds(views.map((v) => v.bounds)),
  });
  // Looking down −Z at the origin.
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  const pickCenter = () => picker.pick(camera, SIZE / 2 + 30, SIZE / 2 + 70, SIZE, SIZE);
  return { views, pickCenter };
}

describe('Picker visibility', () => {
  it('picks the front body when everything is visible', () => {
    const { pickCenter } = setup();
    expect(pickCenter()).toMatchObject({ kind: 'face', body: A });
  });

  it('skips a hidden body and hits the one behind it', () => {
    const { views, pickCenter } = setup();
    const front = views[0];
    if (front === undefined) throw new Error('no front view');
    front.object.visible = false;
    expect(pickCenter()).toMatchObject({ kind: 'face', body: B });
  });

  it('finds nothing when every body is hidden', () => {
    const { views, pickCenter } = setup();
    for (const view of views) view.object.visible = false;
    expect(pickCenter()).toBeNull();
  });
});
