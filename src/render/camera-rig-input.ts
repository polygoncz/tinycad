// DOM listeners of the camera input (spec 09, "Vstup (CameraInput)"): pointer gestures with
// pointer capture and the wheel. The decisions are pure functions in camera-input.ts.

import type { Disposable } from '@/core';
import { cameraGesture, wheelFactor, type CameraGesture } from './camera-input';

/** What the input drives; implemented by the camera rig. */
export interface CameraInputTarget {
  /** Drag in CSS px since the last move, screen y down. */
  orbit(dx: number, dy: number): void;
  pan(dx: number, dy: number): void;
  /** Cursor in CSS px relative to the canvas; factor > 1 zooms in. */
  zoomAt(x: number, y: number, factor: number): void;
  cancelAnimation(): void;
  /** Canvas height in CSS px (for wheel pages). */
  readonly height: number;
}

interface Gesture {
  readonly pointerId: number;
  readonly kind: CameraGesture;
  /** Last pointer position in client px; the gesture sends differences. */
  x: number;
  y: number;
}

function isCameraButton(button: number): button is 0 | 1 | 2 {
  return button === 0 || button === 1 || button === 2;
}

/** Listens on `element` until disposed. One gesture at a time; other pointers are ignored. */
export function attachCameraInput(
  element: HTMLElement,
  target: CameraInputTarget,
  isMac: boolean,
): Disposable {
  let gesture: Gesture | null = null;

  const onDown = (e: PointerEvent): void => {
    if (gesture !== null || !isCameraButton(e.button)) return;
    const kind = cameraGesture(e.button, e.shiftKey, isMac ? e.metaKey : e.ctrlKey);
    if (kind === null) return;
    // No autoscroll of the middle button (Windows): it starts from the compatibility mousedown.
    if (e.button === 1) e.preventDefault();
    element.setPointerCapture(e.pointerId);
    target.cancelAnimation();
    gesture = { pointerId: e.pointerId, kind, x: e.clientX, y: e.clientY };
  };

  const onMove = (e: PointerEvent): void => {
    if (gesture?.pointerId !== e.pointerId) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    if (dx === 0 && dy === 0) return;
    if (gesture.kind === 'orbit') target.orbit(dx, dy);
    else target.pan(dx, dy);
  };

  /** pointerup, pointercancel and lostpointercapture end the gesture. */
  const onEnd = (e: PointerEvent): void => {
    if (gesture?.pointerId !== e.pointerId) return;
    gesture = null;
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: WheelEvent): void => {
    // Also Ctrl + wheel (pinch on a trackpad), which would zoom the page otherwise.
    e.preventDefault();
    target.zoomAt(e.offsetX, e.offsetY, wheelFactor(e.deltaY, e.deltaMode, target.height));
  };

  // Touch gestures would scroll or zoom the page instead of reaching the pointer listeners.
  const touchAction = element.style.touchAction;
  element.style.touchAction = 'none';
  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onEnd);
  element.addEventListener('pointercancel', onEnd);
  element.addEventListener('lostpointercapture', onEnd);
  element.addEventListener('wheel', onWheel, { passive: false });

  return {
    dispose(): void {
      element.style.touchAction = touchAction;
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onEnd);
      element.removeEventListener('pointercancel', onEnd);
      element.removeEventListener('lostpointercapture', onEnd);
      element.removeEventListener('wheel', onWheel);
      if (gesture !== null && element.hasPointerCapture(gesture.pointerId)) {
        element.releasePointerCapture(gesture.pointerId);
      }
      gesture = null;
    },
  };
}
