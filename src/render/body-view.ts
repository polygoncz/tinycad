// One shown body (spec 09, "Reprezentace tělesa"): faces as a Mesh, edges as LineSegments, both
// built from MeshData, plus the hidden edges and the lazy triangulation lines of the display
// style (M22). Owns its geometries; the materials are shared and owned by BodyLayer.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
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

/**
 * The hidden edges draw after every face (0), whose depth they compare, and before the highlight
 * (1) (spec 09, "Skryté hrany").
 */
const HIDDEN_EDGE_RENDER_ORDER = 0.5;

/** Width of the edges drawn over the triangulation, in screen pixels (spec 09, "Triangulace"). */
const THICK_EDGE_PX = 2;

/** Materials shared by every BodyView; created and disposed by BodyLayer. */
export interface BodyMaterials extends Disposable {
  /** Lit faces (DisplayPlan.faces 'lit'); colour materials are copies of it. */
  readonly faces: THREE.MeshStandardMaterial;
  /** Unlit faces in the background colour that write depth ('flat', M22). */
  readonly facesFlat: THREE.MeshBasicMaterial;
  /** Faces that write neither colour nor depth ('hidden', M22); still hit by the raycast. */
  readonly facesHidden: THREE.MeshBasicMaterial;
  readonly edges: THREE.LineBasicMaterial;
  /** Dashed second pass of the edges, only where a face is in front (M22). */
  readonly hiddenEdges: THREE.LineDashedMaterial;
  /** Lines of the triangulation (M22). */
  readonly meshLines: THREE.LineBasicMaterial;
  /**
   * The edges over the triangulation (M22), THICK_EDGE_PX wide: 1 px edges get lost among the
   * triangle lines. Needs the resolution of the canvas (BodyLayerInternal.setResolution).
   */
  readonly edgesThick: LineMaterial;
  /** renderOrder of the faces and edges of every BodyView. */
  readonly renderOrder: number;
  /** Recolours every material in place (Q072); every BodyView follows. */
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
  // Hides what is behind it like the lit faces, and stays behind the edges on it the same way.
  const facesFlat = new THREE.MeshBasicMaterial({
    color: palette.background,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  // Neither colour nor depth: the edges behind show, the mesh is still there for the raycast.
  const facesHidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const hiddenEdges = new THREE.LineDashedMaterial({
    color: palette.hiddenEdge,
    depthFunc: THREE.GreaterDepth,
    depthWrite: false,
  });
  const meshLines = new THREE.LineBasicMaterial({ color: palette.meshLine });
  // WebGL draws LineSegments 1 px wide whatever linewidth says; LineMaterial draws screen quads.
  const edgesThick = new LineMaterial({
    color: edgeColor(palette),
    linewidth: THICK_EDGE_PX,
    worldUnits: false,
  });
  return {
    faces,
    facesFlat,
    facesHidden,
    edges,
    hiddenEdges,
    meshLines,
    edgesThick,
    renderOrder: preview ? PREVIEW_RENDER_ORDER : 0,
    setPalette(next: ScenePalette): void {
      faces.color.setHex(faceColor(next));
      edges.color.setHex(edgeColor(next));
      facesFlat.color.setHex(next.background);
      hiddenEdges.color.setHex(next.hiddenEdge);
      meshLines.color.setHex(next.meshLine);
      edgesThick.color.setHex(edgeColor(next));
    },
    dispose(): void {
      faces.dispose();
      facesFlat.dispose();
      facesHidden.dispose();
      edges.dispose();
      hiddenEdges.dispose();
      meshLines.dispose();
      edgesThick.dispose();
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
  /**
   * The same edges dashed behind the faces (M22); shares the geometry of `edges`. Hidden by
   * default, BodyLayer shows it by the display plan.
   */
  readonly hiddenEdges: THREE.LineSegments;
  /** The source data: triangle → face (picking) and face/edge copies (highlight). */
  readonly mesh: MeshData;
  /** Edge key of each segment of `edges` (polylinesToSegments). */
  readonly segmentEdges: Uint32Array;
  /** Bounds of the vertices; null for a mesh without vertices. */
  readonly bounds: BoundingBox | null;
  /**
   * Lines of the triangulation (M22): the first material builds them from the face geometry,
   * null removes them and releases their geometry. Not picked.
   */
  setMeshLines(material: THREE.LineBasicMaterial | null): void;
  /**
   * The edges drawn thick over the triangulation (M22): the first material builds them from the
   * positions of `edges`, null removes them and releases their geometry. Not picked (the picking
   * of edges works on the mesh, not on objects).
   */
  setThickEdges(material: LineMaterial | null): void;
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
  // One buffer on the GPU, drawn twice; the dashes need the distance along the lines.
  const hiddenEdges = new THREE.LineSegments(edgeGeometry, materials.hiddenEdges);
  hiddenEdges.computeLineDistances();
  hiddenEdges.visible = false;
  faces.renderOrder = materials.renderOrder;
  edges.renderOrder = materials.renderOrder;
  hiddenEdges.renderOrder = HIDDEN_EDGE_RENDER_ORDER;

  const object = new THREE.Group();
  object.add(faces, edges, hiddenEdges);
  // On every level, so a raycast hit on the faces or edges finds the body directly.
  for (const o of [object, faces, edges, hiddenEdges]) o.userData.bodyId = id;

  /** Built lazily: a big model has hundreds of thousands of triangle edges. */
  let meshLines: THREE.LineSegments<THREE.WireframeGeometry> | null = null;

  function removeMeshLines(): void {
    if (meshLines === null) return;
    object.remove(meshLines);
    meshLines.geometry.dispose();
    meshLines = null;
  }

  /** Built lazily like the mesh lines: only the triangulation draws them. */
  let thickEdges: LineSegments2 | null = null;

  function removeThickEdges(): void {
    if (thickEdges === null) return;
    object.remove(thickEdges);
    thickEdges.geometry.dispose();
    thickEdges = null;
  }

  let disposed = false;
  return {
    id,
    object,
    faces,
    edges,
    hiddenEdges,
    mesh,
    segmentEdges,
    bounds: meshBounds(mesh.positions),
    setMeshLines(material): void {
      if (disposed) return;
      if (material === null) {
        removeMeshLines();
        return;
      }
      if (meshLines !== null) {
        meshLines.material = material;
        return;
      }
      meshLines = new THREE.LineSegments(new THREE.WireframeGeometry(faceGeometry), material);
      meshLines.renderOrder = materials.renderOrder;
      object.add(meshLines);
    },
    setThickEdges(material): void {
      if (disposed) return;
      if (material === null) {
        removeThickEdges();
        return;
      }
      if (thickEdges !== null) {
        thickEdges.material = material;
        return;
      }
      // setPositions copies the segments into instanced attributes of its own.
      thickEdges = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), material);
      thickEdges.renderOrder = materials.renderOrder;
      object.add(thickEdges);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Only the own geometries: the materials are shared (BodyLayer disposes them).
      faceGeometry.dispose();
      edgeGeometry.dispose();
      removeMeshLines();
      removeThickEdges();
    },
  };
}
