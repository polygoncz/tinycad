// One shown body (spec 09, "Reprezentace tělesa"): faces as a Mesh, edges as LineSegments, both
// built from MeshData. Owns its two geometries; the materials are shared and owned by BodyLayer.

import * as THREE from 'three';
import type { Disposable } from '@/core';
import type { BodyId } from '@/interaction';
import type { BoundingBox, MeshData } from '@/kernel';
import { meshBounds } from './bounds';
import { polylinesToSegments } from './mesh-index';
import type { ScenePalette } from './palette';

/** Materials shared by every BodyView; created and disposed by BodyLayer. */
export interface BodyMaterials extends Disposable {
  readonly faces: THREE.MeshStandardMaterial;
  readonly edges: THREE.LineBasicMaterial;
  /** Recolours both materials in place (Q072); every BodyView follows. */
  setPalette(palette: ScenePalette): void;
}

export function createBodyMaterials(palette: ScenePalette): BodyMaterials {
  const faces = new THREE.MeshStandardMaterial({
    color: palette.face,
    metalness: 0,
    roughness: 0.6,
    // Pushes faces slightly back in depth, so the edges on them win (spec 09).
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const edges = new THREE.LineBasicMaterial({ color: palette.edge });
  return {
    faces,
    edges,
    setPalette(next: ScenePalette): void {
      faces.color.setHex(next.face);
      edges.color.setHex(next.edge);
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
