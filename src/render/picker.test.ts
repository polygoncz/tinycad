import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { BodyId, PickFilter } from '@/interaction';
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
  /** How many times the picker asked for the views, i.e. looked at the scene. */
  let sceneQueries = 0;
  const picker = createPicker({
    views: () => {
      sceneQueries++;
      return views;
    },
    bounds: () => unionBounds(views.map((v) => v.bounds)),
  });
  // Looking down −Z at the origin; 1 px = 0.1 mm, px (500, 500) is the origin.
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  const pickAt = (x: number, y: number, filter?: PickFilter) =>
    picker.pick(camera, x, y, SIZE, SIZE, filter);
  // (3, −7) on the top face of A, far from its edges.
  const pickCenter = (filter?: PickFilter) => pickAt(SIZE / 2 + 30, SIZE / 2 + 70, filter);
  // (9.7, 0): 3 px from the edge x = 10 of the top face of A, inside the edge tolerance.
  const pickNearEdge = (filter?: PickFilter) => pickAt(SIZE / 2 + 97, SIZE / 2, filter);
  return { views, pickCenter, pickNearEdge, sceneQueries: () => sceneQueries };
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

describe('Picker filter', () => {
  it('without a filter an edge near the cursor wins over the face under it', () => {
    const { pickNearEdge } = setup();
    expect(pickNearEdge()).toMatchObject({ kind: 'edge' });
  });

  it('the order of the kinds does not matter: the edge still wins', () => {
    const { pickNearEdge } = setup();
    expect(pickNearEdge(['face', 'edge'])).toMatchObject({ kind: 'edge' });
    expect(pickNearEdge(['edge', 'face'])).toMatchObject({ kind: 'edge' });
  });

  it('with faces only it hits the face and does not project the edges', () => {
    const { views, pickNearEdge } = setup();
    const reads = views.map((view) => vi.spyOn(view.edges.geometry, 'getAttribute'));
    expect(pickNearEdge(['face'])).toMatchObject({ kind: 'face', body: A });
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it('with edges only it hits the edge and never falls back to the face', () => {
    const { pickNearEdge, pickCenter } = setup();
    expect(pickNearEdge(['edge'])).toMatchObject({ kind: 'edge' });
    expect(pickCenter(['edge'])).toBeNull();
  });

  it('an empty filter returns null without looking at the scene', () => {
    const { pickNearEdge, pickCenter, sceneQueries } = setup();
    expect(pickNearEdge([])).toBeNull();
    expect(pickCenter([])).toBeNull();
    expect(sceneQueries()).toBe(0);
  });
});

describe('Picker and sketch entities', () => {
  it('a filter with only sketchEntity returns null without looking at the bodies', () => {
    const { pickNearEdge, pickCenter, sceneQueries } = setup();
    expect(pickNearEdge(['sketchEntity'])).toBeNull();
    expect(pickCenter(['sketchEntity'])).toBeNull();
    expect(sceneQueries()).toBe(0);
  });

  it('sketchEntity next to body kinds does not change the body pick', () => {
    const { pickNearEdge } = setup();
    expect(pickNearEdge(['sketchEntity', 'edge', 'face'])).toMatchObject({ kind: 'edge' });
  });
});

describe('Picker and sketch regions (M13)', () => {
  it('a filter with only sketchRegion returns null without looking at the bodies', () => {
    const { pickNearEdge, pickCenter, sceneQueries } = setup();
    expect(pickNearEdge(['sketchRegion'])).toBeNull();
    expect(pickCenter(['sketchRegion'])).toBeNull();
    expect(sceneQueries()).toBe(0);
  });

  it('sketchRegion next to body kinds does not change the body pick', () => {
    const { pickNearEdge } = setup();
    expect(pickNearEdge(['sketchRegion', 'edge', 'face'])).toMatchObject({ kind: 'edge' });
  });
});
