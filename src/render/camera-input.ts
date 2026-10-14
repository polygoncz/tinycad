// Pure parts of the camera input (spec 09, "Vstup (CameraInput)"): button mapping and wheel zoom.
// Plain values, no DOM types, tested in Node; the DOM listeners are in camera-rig-input.ts.

export type CameraGesture = 'orbit' | 'pan';

/**
 * Onshape-like buttons: right orbits, middle pans, Shift or Ctrl/Cmd swaps them. The left
 * button belongs to selection.
 */
export function cameraGesture(
  button: 0 | 1 | 2,
  shiftKey: boolean,
  modKey: boolean,
): CameraGesture | null {
  if (button === 0) return null;
  const swapped = shiftKey || modKey;
  const orbits = button === 2;
  return orbits !== swapped ? 'orbit' : 'pan';
}

/** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
/** Pixels per line of a line-based wheel. */
const LINE_HEIGHT = 16;
/** Zoom sensitivity per pixel of wheel movement. */
const ZOOM_PER_PIXEL = 0.002;

/**
 * Zoom factor of a wheel event for zoomAt: exp(−0.002 · deltaY in px), so the wheel up
 * (negative deltaY) zooms in. Pages count the canvas height in CSS px.
 */
export function wheelFactor(deltaY: number, deltaMode: number, height: number): number {
  const scale =
    deltaMode === DOM_DELTA_LINE ? LINE_HEIGHT : deltaMode === DOM_DELTA_PAGE ? height : 1;
  return Math.exp(-ZOOM_PER_PIXEL * deltaY * scale);
}
