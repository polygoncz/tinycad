// Drag of a dimension label over the view (spec 12, "Přetažení"; M28): a press on the label and a
// move farther than CLICK_TOLERANCE_PX from it start a drag; from then on every move is
// SketchSession.moveDimension and the release endMoveDimension. A press without such a move stays
// a click. Kept out of SketchDimensions.vue as a plain object over the coordinates in px of the
// view area, so it runs in Node tests; the component only feeds it the pointer events.

import { CLICK_TOLERANCE_PX } from '@/interaction/constants';
import type { SketchDimensionView, SketchSession } from '@/sketcher';

export interface DimensionDrag {
  /** A press on the label of `id` at (x, y), px of the view area. */
  down(id: SketchDimensionView['id'], x: number, y: number): void;
  move(x: number, y: number): void;
  /** The release: ends a drag (endMoveDimension). */
  up(): void;
  /** The press was cancelled (pointercancel): a started drag ends like on release. */
  cancel(): void;
  /**
   * The click that follows the release: true = select (no drag), false = it ends a drag and is
   * swallowed. Resets, so the next click selects again.
   */
  takeClick(): boolean;
}

interface Press {
  readonly id: SketchDimensionView['id'];
  readonly x: number;
  readonly y: number;
  readonly dragging: boolean;
}

export function createDimensionDrag(
  sketch: Pick<SketchSession, 'moveDimension' | 'endMoveDimension'>,
): DimensionDrag {
  let press: Press | null = null;
  /** The last press became a drag: its click is not a selection. */
  let dragged = false;

  function end(): void {
    if (press?.dragging === true) {
      sketch.endMoveDimension();
      dragged = true;
    }
    press = null;
  }

  return {
    down(id, x, y) {
      press = { id, x, y, dragging: false };
      dragged = false;
    },
    move(x, y) {
      if (press === null) return;
      if (!press.dragging) {
        if (Math.hypot(x - press.x, y - press.y) <= CLICK_TOLERANCE_PX) return;
        press = { ...press, dragging: true };
      }
      sketch.moveDimension(press.id, x, y);
    },
    up: end,
    cancel: end,
    takeClick() {
      const select = !dragged;
      dragged = false;
      return select;
    },
  };
}
