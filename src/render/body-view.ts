// One shown body (spec 09, "Reprezentace tělesa"): faces as a Mesh, edges as LineSegments, both
// built from MeshData. Owns its two geometries; the materials are shared and owned by BodyLayer.

import * as THREE from 'three';
import type { Disposable } from '@/core';
import type { BodyId } from '@/interaction';
import type { BoundingBox, MeshData } from '@/kernel';
import { meshBounds } from './bounds';
import { polylinesToSegments } from './mesh-index';
import type { ScenePalette } from './palette';

/**
 * How a body layer draws its bodies: 'body' solid in the face and edge colours, 'preview' the
 * result of an edited feature (M21, ADR 0025), transparent in the body preview colour (palette.bodyPreview).
 */
export type BodyStyle = 'body' | 'preview';

/** Opacity of the preview faces (M21). */
const PREVIEW_OPACITY = 0.35;
/**
 * Above the bodies (0), so the preview edges win at equal depth, and below the highlight (1).
 * Also sorts the transparent preview faces after the opaque bodies.
 */
const PREVIEW_RENDER_ORDER = 0.5;

/** Materials shared by every BodyView; created and disposed by BodyLayer. */
export interface BodyMaterials extends Disposable {
  readonly faces: THREE.MeshStandardMaterial;
  readonly edges: THREE.LineBasicMaterial;
  /** renderOrder of the faces and edges of every BodyView. */
  readonly renderOrder: number;
  /** Recolours both materials in place (Q072); every BodyView follows. */
  setPalette(palette: ScenePalette): void;
}

export function createBodyMaterials(
  palette: ScenePalette,
  style: BodyStyle = 'body',
): BodyMaterials {
  const preview = style === 'preview';
  const faceColor = (p: ScenePalette): number => (preview ? p.bodyPreview : p.face);
  const edgeColor = (p: ScenePalette): number => (preview ? p.bodyPreview : p.edge);
  const faces = new THREE.MeshStandardMaterial({
    color: faceColor(palette),
    metalness: 0,
    roughness: 0.6,
    // Bodies: faces slightly back in depth, so the edges on them win (spec 09). Preview: faces
    // towards the camera, so they win over the coplanar faces of the input body below; two
    // tessellations of one plane would otherwise fight for depth (z-fighting, M21).
    polygonOffset: true,
    polygonOffsetFactor: preview ? -1 : 1,
    polygonOffsetUnits: preview ? -4 : 1,
    // The preview hides nothing behind it: the bodies of the input stay visible and pickable.
    ...(preview ? { transparent: true, opacity: PREVIEW_OPACITY, depthWrite: false } : {}),
  });
  const edges = new THREE.LineBasicMaterial({ color: edgeColor(palette) });
  return {
    faces,
    edges,
    renderOrder: preview ? PREVIEW_RENDER_ORDER : 0,
    setPalette(next: ScenePalette): void {
      faces.color.setHex(faceColor(next));
      edges.color.setHex(edgeColor(next));
    },
    dispose(): void {
      faces.dispose();
      edges.dispose();
    },
  };
}

export interface BodyView extends Disposable {
  readonly id: BodyId;
  /** Added to and removed from the scene by BodyLayer; carries the BodyId in userData. */
  readonly object: THREE.Group;
  /** Faces, the target of the face raycast (Ú7). */
  readonly faces: THREE.Mesh;
  /** Edges as pairs of points. */
  readonly edges: THREE.LineSegments;
  /** The source data: triangle → face (picking) and face/edge copies (highlight). */
  readonly mesh: MeshData;
  /** Edge key of each segment of `edges` (polylinesToSegments). */
  readonly segmentEdges: Uint32Array;
  /** Bounds of the vertices; null for a mesh without vertices. */
  readonly bounds: BoundingBox | null;
}

/**
 * Builds the view of one body. The geometries wrap the arrays of `mesh` without copying; three
 * only reads them, and MeshData is never changed by anyone (it may stay in the MeshCache).
 */
export function createBodyView(id: BodyId, mesh: MeshData, materials: BodyMaterials): BodyView {
  const faceGeometry = new THREE.BufferGeometry();
  faceGeometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  faceGeometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  faceGeometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  const faces = new THREE.Mesh(faceGeometry, materials.faces);

  const { positions, segmentEdges } = polylinesToSegments(mesh.edgePositions, mesh.edgeRanges);
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const edges = new THREE.LineSegments(edgeGeometry, materials.edges);
  faces.renderOrder = materials.renderOrder;
  edges.renderOrder = materials.renderOrder;

  const object = new THREE.Group();
  object.add(faces, edges);
  // On every level, so a raycast hit on the faces or edges finds the body directly.
  for (const o of [object, faces, edges]) o.userData.bodyId = id;

  let disposed = false;
  return {
    id,
    object,
    faces,
    edges,
    mesh,
    segmentEdges,
    bounds: meshBounds(mesh.positions),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Only the own geometries: the materials are shared (BodyLayer disposes them).
      faceGeometry.dispose();
      edgeGeometry.dispose();
    },
  };
}
