// Hover and selection over the bodies (spec 09, "Vrstvy pro interakci"). A mirror of the state
// interaction holds (Q058): every call replaces the whole state. Each drawn target is a small own
// copy of the face's triangles or the edge's segments (spec 09, "Reprezentace tělesa"), so
// disposing it never touches the body's buffers. Not part of picking: the picker reads only the
// meshes of BodyLayer.views. Sketch regions (M13) are not drawn here: their targets are handed
// over to the sketch layer, which owns the region fills.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { Disposable } from '@/core';
import type { BodyId, HighlightPort, HighlightTarget } from '@/interaction';
import type { MeshData } from '@/kernel';
import type { BodyView } from './body-view';
import {
  type BodyTarget,
  drawnTargets,
  sameHover,
  sameSelection,
  validTarget,
  validTargets,
} from './highlight-targets';
import { edgeSegments, faceTriangles } from './mesh-index';
import type { ScenePalette } from './palette';
import type { RegionTarget, SketchLayerInternal } from './sketch-layer';

const FACE_OPACITY = 0.45;
/** After the bodies (renderOrder 0), so an equal-depth highlight edge wins over the body edge. */
const RENDER_ORDER = 1;
/** Width of a highlighted edge in CSS px (fat line, see draw). */
const EDGE_WIDTH_PX = 3;

/** What BodyLayer and the viewport need on top of HighlightPort; internal. */
export interface HighlightLayerInternal extends HighlightPort, Disposable {
  /** Parent of every highlight object; the viewport puts it into the scene. */
  readonly group: THREE.Group;
  /**
   * Rebuilds the highlight from the current meshes after BodyLayer swapped the scene (spec 09
   * point 9) or changed the visibility of a body. Targets whose body disappeared or whose index is out of range are dropped, and the
   * state shrinks by them. No-op after dispose.
   */
  rebuild(): void;
  /** Canvas size in CSS px; fat-line materials need it to size their width in pixels. */
  setResolution(width: number, height: number): void;
  /** Recolours hover and selection in place (Q072); the caller requests the render. */
  setPalette(palette: ScenePalette): void;
}

export interface HighlightLayerOptions {
  /** The shown bodies (BodyLayerInternal.views). */
  readonly views: ReadonlyMap<BodyId, BodyView>;
  readonly requestRender: () => void;
  readonly palette: ScenePalette;
  /** Receives the sketch region targets (M13); none = they are dropped. */
  readonly regions?: Pick<SketchLayerInternal, 'setRegionHighlight'>;
}

/** Face and edge material of one highlight kind (hover or selection). */
interface Look {
  readonly face: THREE.MeshBasicMaterial;
  readonly edge: LineMaterial;
}

export function createHighlightLayer(options: HighlightLayerOptions): HighlightLayerInternal {
  const { views, requestRender } = options;
  const group = new THREE.Group();
  const hoverLook = createLook(options.palette.hover);
  const selectionLook = createLook(options.palette.selection);
  /** Geometries of the drawn objects; all replaced on every change. */
  let geometries: THREE.BufferGeometry[] = [];
  /** Only faces and edges: sketch entities (M12) are dropped like invalid targets. */
  let hover: BodyTarget | null = null;
  let selection: readonly BodyTarget[] = [];
  /** Sketch regions (M13), mirrored to options.regions. */
  let regionHover: RegionTarget | null = null;
  let regionSelection: readonly RegionTarget[] = [];
  let disposed = false;

  const meshOf = (body: BodyId): MeshData | undefined => views.get(body)?.mesh;

  /** Drops the drawn objects and draws the current state again. */
  function redraw(): void {
    clearObjects();
    const drawn = drawnTargets(hover, selection);
    for (const target of drawn.selection) draw(target, selectionLook);
    if (drawn.hover !== null) draw(drawn.hover, hoverLook);
    requestRender();
  }

  function draw(target: BodyTarget, look: Look): void {
    const view = views.get(target.body);
    // A hidden body keeps its targets in the state but draws none (spec 09, setBodyVisible);
    // rebuild after showing it draws them again.
    if (view === undefined || !view.object.visible) return;
    let object: THREE.Object3D;
    if (target.kind === 'face') {
      const geometry = new THREE.BufferGeometry();
      geometries.push(geometry);
      // Unlit and transparent: the body's shading shows through the tint, so no normals.
      const { positions } = faceTriangles(view.mesh, target.faceIndex);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      object = new THREE.Mesh(geometry, look.face);
    } else {
      // Fat lines: WebGL draws LineSegments 1 px wide whatever linewidth says, which is lost on
      // top of the body edge. LineSegments2 draws each segment as a screen-space quad.
      const lines = new LineSegmentsGeometry().setPositions(
        edgeSegments(view.mesh, target.edgeIndex),
      );
      geometries.push(lines);
      object = new LineSegments2(lines, look.edge);
    }
    object.renderOrder = RENDER_ORDER;
    // World coordinates as they are: BodyViews and both groups sit at the identity transform.
    group.add(object);
  }

  function clearObjects(): void {
    group.clear();
    for (const geometry of geometries) geometry.dispose();
    geometries = [];
  }

  return {
    group,
    setHover(target) {
      const nextRegion = target !== null && isRegion(target) ? target : null;
      if (!sameHover(nextRegion, regionHover)) {
        regionHover = nextRegion;
        options.regions?.setRegionHighlight(regionHover, regionSelection);
      }
      const next = target !== null && validTarget(target, meshOf) ? target : null;
      if (sameHover(next, hover)) return;
      hover = next;
      redraw();
    },
    setSelection(targets) {
      const nextRegions = targets.filter(isRegion);
      if (!sameSelection(nextRegions, regionSelection)) {
        regionSelection = nextRegions;
        options.regions?.setRegionHighlight(regionHover, regionSelection);
      }
      const next = validTargets(targets, meshOf);
      if (sameSelection(next, selection)) return;
      selection = next;
      redraw();
    },
    setResolution(width: number, height: number): void {
      for (const look of [hoverLook, selectionLook]) look.edge.resolution.set(width, height);
    },
    setPalette(palette: ScenePalette): void {
      recolor(hoverLook, palette.hover);
      recolor(selectionLook, palette.selection);
    },
    rebuild(): void {
      if (disposed) return;
      hover = hover !== null && validTarget(hover, meshOf) ? hover : null;
      selection = validTargets(selection, meshOf);
      // Always: a kept target may point into a new mesh of the same body.
      redraw();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearObjects();
      for (const look of [hoverLook, selectionLook]) {
        look.face.dispose();
        look.edge.dispose();
      }
    },
  };
}

function isRegion(target: HighlightTarget): target is RegionTarget {
  return target.kind === 'sketchRegion';
}

function recolor(look: Look, color: number): void {
  look.face.color.setHex(color);
  look.edge.color.setHex(color);
}

function createLook(color: number): Look {
  return {
    face: new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: FACE_OPACITY,
      depthTest: true,
      // Transparent: it must not hide the body's edges drawn at the same depth.
      depthWrite: false,
      // Body faces are pushed back (factor 1, units 1); the highlight is pulled forward, so it
      // always wins over the face it lies on (spec 09).
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    // LessEqual (three's default) and RENDER_ORDER: a highlight edge at the same depth as the
    // body edge passes the depth test and is drawn over it.
    edge: new LineMaterial({
      color,
      linewidth: EDGE_WIDTH_PX,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
    }),
  };
}
