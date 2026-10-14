// Layout of the view cube (spec 09, "View cube"): where the cube square lies in the canvas
// and in its overlay, and telling a click from a drag. Pure, no three or DOM import.

/** Sizes in CSS px: overlay box, cube square in its centre, gap to the canvas edges, drag threshold. */
export const VIEW_CUBE = { box: 132, cube: 96, margin: 8, dragThreshold: 3 } as const;

/** Gap between the overlay edge and the cube square. */
const INSET = (VIEW_CUBE.box - VIEW_CUBE.cube) / 2;

/**
 * Square of the cube for renderer.setViewport/setScissor: CSS px, y from the bottom. The renderer
 * multiplies by its pixel ratio itself, so HiDPI needs nothing here. The overlay sits margin px
 * from the right and top edge, the square INSET px inside it.
 */
export function viewCubeRect(
  canvasWidthCss: number,
  canvasHeightCss: number,
): { x: number; y: number; size: number } {
  const fromEdge = VIEW_CUBE.margin + INSET + VIEW_CUBE.cube;
  return { x: canvasWidthCss - fromEdge, y: canvasHeightCss - fromEdge, size: VIEW_CUBE.cube };
}

/**
 * A point in CSS px relative to the overlay → NDC of the cube camera (y up), null outside the
 * cube square (its edge still counts as inside).
 */
export function cubeNdc(x: number, y: number): { x: number; y: number } | null {
  const half = VIEW_CUBE.cube / 2;
  const centre = INSET + half;
  const nx = (x - centre) / half;
  const ny = (centre - y) / half;
  return Math.abs(nx) <= 1 && Math.abs(ny) <= 1 ? { x: nx, y: ny } : null;
}

/**
 * Click versus drag: true once the pointer is more than dragThreshold px from the start. The
 * caller keeps the drag state, so a pointer that comes back stays a drag.
 */
export function isDrag(startX: number, startY: number, x: number, y: number): boolean {
  return Math.hypot(x - startX, y - startY) > VIEW_CUBE.dragThreshold;
}
