// The view cube (spec 09, "View cube"): orientation display and camera control in the top-right
// corner. Drawn by its small scene into the shared renderer; a transparent DOM overlay over the
// corner holds the arrow buttons, the rotation mode button and a transparent target over the cube
// square. Only those take the pointer (D13 of M19.2): the rest of the overlay lets the wheel and
// the right drag through to the viewport.

import type * as THREE from 'three';
import { assert, DisposableStore, type Disposable, type Quat } from '@/core';
import type { CameraRig } from './camera-controller';
import { orientationFor } from './camera-math';
import type { OrbitMode } from './camera-ops';
import { toCssColor, type ScenePalette } from './palette';
import { createFade, VIEW_CUBE_OPACITY } from './view-cube-fade';
import {
  sameLabels,
  VIEW_CUBE_ARROWS,
  type ViewCubeArrow,
  type ViewCubeLabels,
} from './view-cube-labels';
import type { CubeRegion } from './view-cube-geometry';
import { cubeNdc, isDrag, VIEW_CUBE } from './view-cube-layout';
import { createViewCubeScene } from './view-cube-scene';

export interface ViewCube extends Disposable {
  /** Puts the overlay into el right after the canvas; twice without unmount = error. */
  mount(el: HTMLElement, canvas: HTMLCanvasElement): void;
  /** Removes the overlay and its listeners. Idempotent. */
  unmount(): void;
  /** After the main scene. */
  draw(renderer: THREE.WebGLRenderer, orientation: Quat): void;
  /** Opacity transition; true = it keeps running. */
  tick(now: number): boolean;
  setPalette(palette: ScenePalette): void;
  /** The same values = nothing. */
  setLabels(labels: ViewCubeLabels): void;
  /**
   * M17.1: icon and label of the mode button; the roll arrows only in 'free'. Only the display,
   * the rig gets its mode from the viewport. 'turntable' until called.
   */
  setOrbitMode(mode: OrbitMode): void;
}

export interface ViewCubeOptions {
  readonly rig: Pick<CameraRig, 'orbit' | 'animateTo' | 'turn'>;
  readonly palette: ScenePalette;
  readonly labels: ViewCubeLabels;
  readonly requestRender: () => void;
  readonly now: () => number;
  /** M17.1: click on the rotation mode button; the mode changes only through setOrbitMode. */
  readonly onOrbitModeToggle: () => void;
}

/** Side of an arrow button in CSS px. */
const ARROW_SIZE = 16;
/** Gap between the overlay edge and the cube square. */
const INSET = (VIEW_CUBE.box - VIEW_CUBE.cube) / 2;
/** Arrows centred in the gap, on the near and the far side. */
const NEAR = (INSET - ARROW_SIZE) / 2;
const FAR = VIEW_CUBE.box - INSET + NEAR;
const MIDDLE = (VIEW_CUBE.box - ARROW_SIZE) / 2;

/** Position (left, top) in the overlay and the SVG content of every arrow. */
const ARROW_LOOK: Readonly<
  Record<
    ViewCubeArrow['key'],
    { readonly left: number; readonly top: number; readonly svg: string }
  >
> = {
  turnUp: { left: MIDDLE, top: NEAR, svg: '<polygon points="8,3 14,12 2,12"/>' },
  turnDown: { left: MIDDLE, top: FAR, svg: '<polygon points="2,4 14,4 8,13"/>' },
  turnLeft: { left: NEAR, top: MIDDLE, svg: '<polygon points="3,8 12,2 12,14"/>' },
  turnRight: { left: FAR, top: MIDDLE, svg: '<polygon points="4,2 13,8 4,14"/>' },
  // Both rolls at the top-right corner of the cube square: over it and beside it.
  rollCounterClockwise: {
    left: VIEW_CUBE.box - INSET - ARROW_SIZE,
    top: NEAR,
    svg:
      '<path d="M13 10 A5 5 0 0 0 3 10" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<polygon points="0.5,9 5.5,9 3,13"/>',
  },
  rollClockwise: {
    left: FAR,
    top: INSET,
    svg:
      '<path d="M3 10 A5 5 0 0 1 13 10" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<polygon points="10.5,9 15.5,9 13,13"/>',
  },
};

/** Stroke attributes of the outline icons (16 × 16 viewBox). */
const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.4"';

/**
 * Icon of the mode button by the current mode (spec 09, "Tlačítko režimu otáčení"): turntable =
 * an arc around a vertical axis, free = a sphere with arcs.
 */
const MODE_ICON: Readonly<Record<OrbitMode, string>> = {
  turntable:
    `<line x1="8" y1="1.5" x2="8" y2="14.5" ${STROKE}/>` +
    `<path d="M5 6.6 A6 2.6 0 1 0 11 6.6" ${STROKE}/>` +
    '<polygon points="9.6,4.6 13,6.2 10.4,8.6"/>',
  free:
    `<circle cx="8" cy="8" r="6.3" ${STROKE}/>` +
    `<ellipse cx="8" cy="8" rx="6.3" ry="2.4" ${STROKE}/>` +
    `<ellipse cx="8" cy="8" rx="2.4" ry="6.3" ${STROKE}/>`,
};

/** A press of the left button on the cube: click until it moves past the threshold. */
interface Press {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly lastX: number;
  readonly lastY: number;
  readonly dragging: boolean;
}

/** DOM of a mounted view cube. */
interface Overlay {
  readonly root: HTMLDivElement;
  readonly arrows: HTMLDivElement;
  readonly buttons: readonly {
    readonly arrow: ViewCubeArrow;
    readonly button: HTMLButtonElement;
  }[];
  /** M17.1: switches the rotation mode, bottom-right corner. */
  readonly modeButton: HTMLButtonElement;
  readonly resources: DisposableStore;
}

/** A transparent 16 px button at (left, top) of the overlay. */
function createButton(left: number, top: number, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  Object.assign(button.style, {
    position: 'absolute',
    left: `${String(left)}px`,
    top: `${String(top)}px`,
    width: `${String(ARROW_SIZE)}px`,
    height: `${String(ARROW_SIZE)}px`,
    padding: '0',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    pointerEvents: 'auto',
    display: 'block',
  });
  button.addEventListener('click', onClick);
  return button;
}

/** Replaces the SVG icon of a button; `svg` is constant markup of this file, no user text. */
function setIcon(button: HTMLButtonElement, svg: string): void {
  button.innerHTML =
    `<svg viewBox="0 0 16 16" width="${String(ARROW_SIZE)}" height="${String(ARROW_SIZE)}" ` +
    `fill="currentColor" aria-hidden="true">${svg}</svg>`;
}

export function createViewCube(options: ViewCubeOptions): ViewCube {
  const { rig, requestRender, now, onOrbitModeToggle } = options;
  let palette = options.palette;
  let labels = options.labels;
  let orbitMode: OrbitMode = 'turntable';
  const fade = createFade(VIEW_CUBE_OPACITY.rest, VIEW_CUBE_OPACITY.duration);
  const cube = createViewCubeScene(palette, labels, fade.value);
  let overlay: Overlay | null = null;
  let press: Press | null = null;
  let disposed = false;

  /** The pointer is over the overlay; an arrow has the keyboard focus. */
  let pointerOver = false;
  let focusWithin = false;

  /** Pointer over the overlay or focus in it: opaque cube and visible arrows, else at rest. */
  function updateActive(): void {
    const active = pointerOver || focusWithin;
    fade.setTarget(active ? VIEW_CUBE_OPACITY.active : VIEW_CUBE_OPACITY.rest, now());
    if (overlay !== null) overlay.arrows.style.opacity = active ? '1' : '0';
    requestRender();
  }

  /** Region drawn in the hover colour; null = none. */
  function setHover(region: CubeRegion | null): void {
    if (cube.setHover(region)) requestRender();
  }

  /** Region under the client point; null outside the cube square or off the cube. */
  function regionAt(clientX: number, clientY: number): CubeRegion | null {
    if (overlay === null) return null;
    const box = overlay.root.getBoundingClientRect();
    const ndc = cubeNdc(clientX - box.left, clientY - box.top);
    return ndc === null ? null : cube.regionAt(ndc.x, ndc.y);
  }

  function onPointerDown(e: PointerEvent, root: HTMLDivElement, cubeTarget: HTMLDivElement): void {
    // Other buttons are ignored; arrows handle their own clicks.
    if (e.button !== 0 || press !== null) return;
    if (e.target instanceof Element && e.target.closest('button') !== null) return;
    const box = root.getBoundingClientRect();
    if (cubeNdc(e.clientX - box.left, e.clientY - box.top) === null) return;
    cubeTarget.setPointerCapture(e.pointerId);
    press = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      dragging: false,
    };
  }

  function onPointerMove(e: PointerEvent): void {
    if (press === null) {
      if (e.buttons === 0) setHover(regionAt(e.clientX, e.clientY));
      return;
    }
    if (e.pointerId !== press.pointerId) return;
    // Once a drag, always a drag, even when the pointer comes back near the start.
    const dragging = press.dragging || isDrag(press.startX, press.startY, e.clientX, e.clientY);
    if (!dragging) return;
    const { lastX, lastY } = press;
    press = { ...press, lastX: e.clientX, lastY: e.clientY, dragging };
    // The main canvas height is in the rig, so the cube orbits like the right button. The first
    // step of a drag carries the whole move from the start.
    rig.orbit(e.clientX - lastX, e.clientY - lastY);
  }

  function onPointerUp(e: PointerEvent, cubeTarget: HTMLDivElement): void {
    if (press === null || e.pointerId !== press.pointerId) return;
    const { dragging } = press;
    // Cleared before releasing the capture, whose lostpointercapture would end it again.
    press = null;
    if (cubeTarget.hasPointerCapture(e.pointerId)) cubeTarget.releasePointerCapture(e.pointerId);
    const region = regionAt(e.clientX, e.clientY);
    if (!dragging && region !== null) rig.animateTo(orientationFor(region));
    setHover(region);
  }

  function createOverlay(): Overlay {
    const resources = new DisposableStore();
    const root = document.createElement('div');
    root.className = 'tc-view-cube';
    Object.assign(root.style, {
      position: 'absolute',
      top: `${String(VIEW_CUBE.margin)}px`,
      right: `${String(VIEW_CUBE.margin)}px`,
      width: `${String(VIEW_CUBE.box)}px`,
      height: `${String(VIEW_CUBE.box)}px`,
      touchAction: 'none',
      userSelect: 'none',
      // Off the cube and its buttons the input goes to the viewport (D13 of M19.2).
      pointerEvents: 'none',
    });

    // The listeners stay on the root: the events of the target and the buttons bubble up to it.
    const cubeTarget = document.createElement('div');
    Object.assign(cubeTarget.style, {
      position: 'absolute',
      left: `${String(INSET)}px`,
      top: `${String(INSET)}px`,
      width: `${String(VIEW_CUBE.cube)}px`,
      height: `${String(VIEW_CUBE.cube)}px`,
      pointerEvents: 'auto',
    });
    // Before the arrows, so the buttons stack above it.
    root.appendChild(cubeTarget);

    const arrows = document.createElement('div');
    Object.assign(arrows.style, {
      position: 'absolute',
      inset: '0',
      opacity: '0',
      transition: `opacity ${String(VIEW_CUBE_OPACITY.duration)}ms linear`,
      // The container only shows and hides; the buttons take the pointer.
      pointerEvents: 'none',
    });
    root.appendChild(arrows);

    const buttons = VIEW_CUBE_ARROWS.map((arrow) => {
      const look = ARROW_LOOK[arrow.key];
      const button = createButton(look.left, look.top, () => {
        rig.turn(arrow.axis, arrow.quarterTurns);
      });
      setIcon(button, look.svg);
      arrows.appendChild(button);
      return { arrow, button };
    });
    // The rig never sees the click: ui owns the mode and sends it back (ADR 0020).
    const modeButton = createButton(FAR, FAR, onOrbitModeToggle);
    arrows.appendChild(modeButton);

    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ): void => {
      root.addEventListener(type, fn, options);
      resources.add(() => {
        root.removeEventListener(type, fn, options);
      });
    };
    listen('pointerenter', () => {
      pointerOver = true;
      updateActive();
    });
    listen('pointerleave', () => {
      setHover(null);
      pointerOver = false;
      updateActive();
    });
    // Arrows reached by Tab are shown too, not only under the pointer.
    listen('focusin', () => {
      focusWithin = true;
      updateActive();
    });
    listen('focusout', (e) => {
      focusWithin = e.relatedTarget instanceof Node && root.contains(e.relatedTarget);
      updateActive();
    });
    listen('pointerdown', (e) => {
      onPointerDown(e, root, cubeTarget);
    });
    listen('pointermove', onPointerMove);
    listen('pointerup', (e) => {
      onPointerUp(e, cubeTarget);
    });
    const endPress = (e: PointerEvent): void => {
      if (press?.pointerId === e.pointerId) press = null;
    };
    listen('pointercancel', endPress);
    listen('lostpointercapture', endPress);
    // Over the cube and its buttons the wheel and the context menu do nothing (spec 09, "Události
    // v překryvu"); elsewhere in the overlay they reach the canvas, not the root.
    listen(
      'wheel',
      (e) => {
        e.preventDefault();
      },
      { passive: false },
    );
    listen('contextmenu', (e) => {
      e.preventDefault();
    });

    return { root, arrows, buttons, modeButton, resources };
  }

  /** aria-labels and colour of the buttons; icon of the mode, roll arrows only in 'free'. */
  function applyToButtons(target: Overlay): void {
    target.arrows.style.color = toCssColor(palette.viewCube[1]);
    for (const { arrow, button } of target.buttons) {
      button.setAttribute('aria-label', labels[arrow.key]);
      // display: none also takes the hidden rolls out of the tab order.
      const hidden = arrow.axis === 'view' && orbitMode === 'turntable';
      button.style.display = hidden ? 'none' : 'block';
    }
    // The label names the mode the click switches to, the icon shows the current one.
    const next = labels[orbitMode === 'turntable' ? 'switchToFree' : 'switchToTurntable'];
    target.modeButton.setAttribute('aria-label', next);
    target.modeButton.title = next;
    setIcon(target.modeButton, MODE_ICON[orbitMode]);
  }

  function unmount(): void {
    if (overlay === null) return;
    const { root, resources } = overlay;
    overlay = null;
    press = null;
    resources.dispose();
    root.remove();
    // Back at rest for the next mount.
    cube.setHover(null);
    pointerOver = false;
    focusWithin = false;
    fade.setTarget(VIEW_CUBE_OPACITY.rest, now());
  }

  return {
    mount(el: HTMLElement, canvas: HTMLCanvasElement): void {
      assert(!disposed, 'View cube used after dispose');
      assert(overlay === null, 'View cube is already mounted');
      assert(canvas.parentElement === el, 'The canvas must be a child of el');
      const created = createOverlay();
      applyToButtons(created);
      // Right after the canvas, so it stacks above it.
      canvas.after(created.root);
      overlay = created;
    },
    unmount,
    draw(renderer: THREE.WebGLRenderer, orientation: Quat): void {
      cube.draw(renderer, orientation);
    },
    tick(time: number): boolean {
      const running = fade.tick(time);
      cube.setOpacity(fade.value);
      return running;
    },
    setPalette(next: ScenePalette): void {
      palette = next;
      cube.setPalette(next);
      if (overlay !== null) applyToButtons(overlay);
      requestRender();
    },
    setOrbitMode(mode: OrbitMode): void {
      if (mode === orbitMode) return;
      orbitMode = mode;
      if (overlay !== null) applyToButtons(overlay);
    },
    setLabels(next: ViewCubeLabels): void {
      if (sameLabels(labels, next)) return;
      labels = next;
      cube.setLabels(next);
      if (overlay !== null) applyToButtons(overlay);
      requestRender();
    },
    dispose(): void {
      if (disposed) return;
      unmount();
      disposed = true;
      cube.dispose();
    },
  };
}
