// The small scene of the view cube (spec 09, "View cube" → "Kreslení", "Vzhled", "Picking"):
// the bevelled cube with one material per region, face labels as canvas textures, the axes
// with their letters, own lights and camera. Drawn into a corner of the main renderer.

import * as THREE from 'three';
import { quat, type Disposable, type Quat } from '@/core';
import { toCssColor, type ScenePalette } from './palette';
import { buildViewCube, cubeRegionAt, type CubeRegion } from './view-cube-geometry';
import { faceLabelKey, type ViewCubeLabelKey, type ViewCubeLabels } from './view-cube-labels';
import { viewCubeRect } from './view-cube-layout';

export interface ViewCubeScene extends Disposable {
  /** Draws over the main scene into the cube square, turned like the main camera. */
  draw(renderer: THREE.WebGLRenderer, orientation: Quat): void;
  /** Region under NDC (x, y) of the cube camera as of the last draw; null when no hit. */
  regionAt(x: number, y: number): CubeRegion | null;
  /** Region drawn in the hover colour; null = none. Returns true on a change. */
  setHover(region: CubeRegion | null): boolean;
  /** Opacity of the cube (not of the axes). */
  setOpacity(opacity: number): void;
  setPalette(palette: ScenePalette): void;
  setLabels(labels: ViewCubeLabels): void;
}

/** Half size of the cube camera frustum (the cube has half edge 1). */
const FRUSTUM = 1.8;
/** Distance of the cube camera from the origin along the view direction. */
const CAMERA_DISTANCE = 5;
/** Side of a face label texture in px. */
const LABEL_SIZE = 256;
/** Largest share of the label texture width the text may take. */
const LABEL_FILL = 0.84;
const LABEL_FONT_PX = 64;
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
/** Axes: shift of their origin out of the corner (−1, −1, −1) along the diagonal, length, radius. */
const AXIS_OFFSET = 0.12;
const AXIS_LENGTH = 1.1;
const AXIS_RADIUS = 0.025;
/** Letters X, Y, Z: gap after the axis end, sprite size, texture side in px. */
const LETTER_GAP = 0.2;
const LETTER_SCALE = 0.4;
const LETTER_SIZE = 64;

/** A face label painted into its own canvas. */
interface FaceLabel {
  readonly key: ViewCubeLabelKey;
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
}

/** One clickable region: its own material, so hover colours only this region. */
interface Part {
  readonly region: CubeRegion;
  readonly material: THREE.MeshStandardMaterial;
  /** Faces only; edges and corners carry no text and no texture. */
  readonly label: FaceLabel | null;
}

interface Axis {
  readonly material: THREE.MeshBasicMaterial;
  readonly letter: THREE.SpriteMaterial;
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly name: string;
}

export function createViewCubeScene(
  initialPalette: ScenePalette,
  initialLabels: ViewCubeLabels,
  initialOpacity: number,
): ViewCubeScene {
  let palette = initialPalette;
  let labels = initialLabels;
  let hovered: Part | null = null;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-FRUSTUM, FRUSTUM, FRUSTUM, -FRUSTUM, 0.1, 10);
  scene.add(camera);

  // Own lights, so the cube is shaded the same whatever the main scene does.
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.8);
  hemisphere.position.set(0, 0, 1);
  scene.add(hemisphere);
  const headlight = new THREE.DirectionalLight(0xffffff, 2);
  headlight.position.set(-0.3, 0.4, 0);
  headlight.target.position.set(0, 0, -1);
  camera.add(headlight, headlight.target);

  const cube = buildViewCube();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(cube.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(cube.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(cube.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(cube.index, 1));
  const parts: readonly Part[] = cube.groups.map((group, i) => {
    geometry.addGroup(group.start, group.count, i);
    const key = faceLabelKey(group.region);
    const label = key === null ? null : createFaceLabel(key);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      metalness: 0,
      map: label?.texture ?? null,
      transparent: true,
      opacity: initialOpacity,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    return { region: group.region, material, label };
  });
  const mesh = new THREE.Mesh(
    geometry,
    parts.map((p) => p.material),
  );
  scene.add(mesh);

  const axisGeometry = new THREE.CylinderGeometry(AXIS_RADIUS, AXIS_RADIUS, AXIS_LENGTH, 12);
  // Cylinder along +Y starting at its origin.
  axisGeometry.translate(0, AXIS_LENGTH / 2, 0);
  const axes = createAxes();

  for (const part of parts) paintPart(part);
  for (const [i, axis] of axes.entries()) paintAxis(axis, palette.axes[i] ?? 0);

  const raycaster = new THREE.Raycaster();
  const size = new THREE.Vector2();
  const ndc = new THREE.Vector2();

  function createFaceLabel(key: ViewCubeLabelKey): FaceLabel {
    const canvas = document.createElement('canvas');
    canvas.width = LABEL_SIZE;
    canvas.height = LABEL_SIZE;
    const texture = new THREE.CanvasTexture(canvas);
    // The canvas is painted in sRGB like the palette colours of the materials.
    texture.colorSpace = THREE.SRGBColorSpace;
    return { key, canvas, texture };
  }

  function createAxes(): readonly Axis[] {
    const origin = -1 - AXIS_OFFSET / Math.sqrt(3);
    const directions: readonly THREE.Vector3[] = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ];
    const up = new THREE.Vector3(0, 1, 0);
    return ['X', 'Y', 'Z'].map((name, i) => {
      const direction = directions[i] ?? up;
      const material = new THREE.MeshBasicMaterial();
      const line = new THREE.Mesh(axisGeometry, material);
      line.position.set(origin, origin, origin);
      line.quaternion.setFromUnitVectors(up, direction);
      scene.add(line);

      const canvas = document.createElement('canvas');
      canvas.width = LETTER_SIZE;
      canvas.height = LETTER_SIZE;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const letter = new THREE.SpriteMaterial({ map: texture });
      const sprite = new THREE.Sprite(letter);
      sprite.position
        .set(origin, origin, origin)
        .addScaledVector(direction, AXIS_LENGTH + LETTER_GAP);
      sprite.scale.setScalar(LETTER_SCALE);
      scene.add(sprite);
      return { material, letter, canvas, texture, name };
    });
  }

  /** Colour of the part (hover or face colour); a face repaints its label on that background. */
  function paintPart(part: Part): void {
    const background = part === hovered ? palette.hover : palette.viewCube[0];
    if (part.label === null) {
      part.material.color.setHex(background);
      return;
    }
    // White, so the texture shows its own colours unchanged.
    part.material.color.setHex(0xffffff);
    const { canvas, texture, key } = part.label;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.fillStyle = toCssColor(background);
    context.fillRect(0, 0, LABEL_SIZE, LABEL_SIZE);
    const text = labels[key];
    context.font = font(LABEL_FONT_PX);
    const width = context.measureText(text).width;
    // Long translations shrink to fit the face.
    const fontPx =
      width > LABEL_SIZE * LABEL_FILL
        ? (LABEL_FONT_PX * LABEL_SIZE * LABEL_FILL) / width
        : LABEL_FONT_PX;
    context.font = font(fontPx);
    context.fillStyle = toCssColor(palette.viewCube[1]);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, LABEL_SIZE / 2, LABEL_SIZE / 2);
    texture.needsUpdate = true;
  }

  function paintAxis(axis: Axis, color: number): void {
    axis.material.color.setHex(color);
    const context = axis.canvas.getContext('2d');
    if (context === null) return;
    context.clearRect(0, 0, LETTER_SIZE, LETTER_SIZE);
    context.font = font(LETTER_SIZE * 0.75);
    context.fillStyle = toCssColor(color);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(axis.name, LETTER_SIZE / 2, LETTER_SIZE / 2);
    axis.texture.needsUpdate = true;
  }

  function partOf(region: CubeRegion | null): Part | null {
    if (region === null) return null;
    return parts.find((p) => p.region.every((c, i) => c === region[i])) ?? null;
  }

  return {
    draw(renderer: THREE.WebGLRenderer, orientation: Quat): void {
      camera.quaternion.set(...orientation);
      camera.position.set(...quat.rotate(orientation, [0, 0, CAMERA_DISTANCE]));
      camera.updateMatrixWorld();

      renderer.getSize(size);
      const rect = viewCubeRect(size.x, size.y);
      // The colour of the main scene stays; only depth is cleared so the cube is never hidden.
      renderer.clearDepth();
      renderer.setScissorTest(true);
      // CSS px: the renderer multiplies by its pixel ratio itself (HiDPI).
      renderer.setScissor(rect.x, rect.y, rect.size, rect.size);
      renderer.setViewport(rect.x, rect.y, rect.size, rect.size);
      renderer.render(scene, camera);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
    },
    regionAt(x: number, y: number): CubeRegion | null {
      raycaster.setFromCamera(ndc.set(x, y), camera);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (hit === undefined) return null;
      // The cube sits in the origin unturned: the hit point is already in cube coordinates.
      return cubeRegionAt([hit.point.x, hit.point.y, hit.point.z]);
    },
    setHover(region: CubeRegion | null): boolean {
      const next = partOf(region);
      if (next === hovered) return false;
      const previous = hovered;
      hovered = next;
      if (previous !== null) paintPart(previous);
      if (next !== null) paintPart(next);
      return true;
    },
    setOpacity(opacity: number): void {
      for (const part of parts) part.material.opacity = opacity;
    },
    setPalette(next: ScenePalette): void {
      palette = next;
      for (const part of parts) paintPart(part);
      for (const [i, axis] of axes.entries()) paintAxis(axis, next.axes[i] ?? 0);
    },
    setLabels(next: ViewCubeLabels): void {
      labels = next;
      for (const part of parts) if (part.label !== null) paintPart(part);
    },
    dispose(): void {
      camera.remove(headlight, headlight.target);
      scene.clear();
      geometry.dispose();
      for (const part of parts) {
        part.material.dispose();
        part.label?.texture.dispose();
      }
      axisGeometry.dispose();
      for (const axis of axes) {
        axis.material.dispose();
        axis.letter.dispose();
        axis.texture.dispose();
      }
      hemisphere.dispose();
      headlight.dispose();
    },
  };
}

function font(px: number): string {
  return `600 ${String(Math.round(px))}px ${FONT_FAMILY}`;
}
