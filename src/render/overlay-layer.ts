// Temporary geometry of tools (spec 09, "Vrstvy pro interakci"): OverlayShape → LineSegments or
// Points in an own group, drawn over the bodies and never picked (the picker reads only the
// meshes of BodyLayer.views). Owns the geometries under each id and the shared materials.

import * as THREE from 'three';
import type { Disposable } from '@/core';
import type { OverlayPort, OverlayShape, OverlayStyle } from '@/interaction';
import { flattenPoints, validateOverlayShapes } from './overlay-shapes';

const PREVIEW_COLOR = 0x2563eb;
const CONSTRUCTION_COLOR = 0x6b7280;
/** Dash and gap of construction lines in mm (world units). */
const DASH_SIZE = 2;
const GAP_SIZE = 1.5;
/** Point size in CSS px (no size attenuation, like a marker). */
const POINT_SIZE = 6;
/** After the bodies and the highlight. */
const RENDER_ORDER = 2;

/** What the viewport needs on top of OverlayPort; internal. */
export interface OverlayLayerInternal extends OverlayPort, Disposable {
  /** Parent of every overlay object; the viewport puts it into the scene. */
  readonly group: THREE.Group;
}

export interface OverlayLayerOptions {
  readonly requestRender: () => void;
}

/** Objects under one id with their geometries. */
interface Entry {
  readonly objects: readonly THREE.Object3D[];
  readonly geometries: readonly THREE.BufferGeometry[];
}

export function createOverlayLayer(options: OverlayLayerOptions): OverlayLayerInternal {
  const { requestRender } = options;
  const group = new THREE.Group();
  const lineMaterials: Record<OverlayStyle, THREE.LineBasicMaterial> = {
    preview: new THREE.LineBasicMaterial({ color: PREVIEW_COLOR, depthTest: true }),
    // Dashes need line distances on the geometry (computeLineDistances below).
    construction: new THREE.LineDashedMaterial({
      color: CONSTRUCTION_COLOR,
      dashSize: DASH_SIZE,
      gapSize: GAP_SIZE,
      depthTest: true,
    }),
  };
  const pointMaterials: Record<OverlayStyle, THREE.PointsMaterial> = {
    preview: createPointMaterial(PREVIEW_COLOR),
    construction: createPointMaterial(CONSTRUCTION_COLOR),
  };
  const entries = new Map<string, Entry>();

  function build(shape: OverlayShape): { object: THREE.Object3D; geometry: THREE.BufferGeometry } {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(flattenPoints(shape.points), 3));
    let object: THREE.Object3D;
    if (shape.kind === 'lines') {
      const lines = new THREE.LineSegments(geometry, lineMaterials[shape.style]);
      // Harmless for the solid style; required by LineDashedMaterial.
      lines.computeLineDistances();
      object = lines;
    } else {
      object = new THREE.Points(geometry, pointMaterials[shape.style]);
    }
    object.renderOrder = RENDER_ORDER;
    return { object, geometry };
  }

  /** Removes and disposes everything under id; false when there was nothing. */
  function drop(id: string): boolean {
    const entry = entries.get(id);
    if (entry === undefined) return false;
    entries.delete(id);
    group.remove(...entry.objects);
    for (const geometry of entry.geometries) geometry.dispose();
    return true;
  }

  function dropAll(): boolean {
    const any = entries.size > 0;
    for (const id of [...entries.keys()]) drop(id);
    return any;
  }

  return {
    group,
    set(id, shapes) {
      // Before any change: an odd `lines` throws and leaves the previous shapes under id.
      validateOverlayShapes(shapes);
      drop(id);
      const built = shapes.map(build);
      const objects = built.map(({ object }) => object);
      if (objects.length > 0) group.add(...objects);
      entries.set(id, { objects, geometries: built.map(({ geometry }) => geometry) });
      requestRender();
    },
    remove(id) {
      if (drop(id)) requestRender();
    },
    clear() {
      if (dropAll()) requestRender();
    },
    dispose(): void {
      dropAll();
      for (const material of [...Object.values(lineMaterials), ...Object.values(pointMaterials)]) {
        material.dispose();
      }
    },
  };
}

function createPointMaterial(color: number): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    color,
    size: POINT_SIZE,
    sizeAttenuation: false,
    depthTest: true,
  });
}
