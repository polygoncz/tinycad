// Labels and arrows of the view cube (spec 09, "View cube"). render knows no i18n: the texts
// come as a value from the app. Pure, no three or DOM import.

import type { TurnAxis } from './camera-ops';
import { regionKey, type CubeRegion } from './view-cube-geometry';

export type ViewCubeLabelKey =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'turnLeft'
  | 'turnRight'
  | 'turnUp'
  | 'turnDown'
  | 'rollClockwise'
  | 'rollCounterClockwise'
  // M17.1: the rotation mode button names the mode it switches to.
  | 'switchToFree'
  | 'switchToTurntable';

/** Face labels and aria-labels of the arrows and of the rotation mode button. */
export type ViewCubeLabels = Readonly<Record<ViewCubeLabelKey, string>>;

/** English labels until the app sends translated ones (texts of spec 11). */
export const DEFAULT_VIEW_CUBE_LABELS: ViewCubeLabels = Object.freeze({
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  turnUp: 'Turn up',
  turnDown: 'Turn down',
  rollClockwise: 'Roll clockwise',
  rollCounterClockwise: 'Roll counterclockwise',
  switchToFree: 'Switch to free rotation',
  switchToTurntable: 'Switch to rotation with Z up',
});

// Object.keys returns string[]; the defaults are a full Record over the key union.
const KEYS = Object.keys(DEFAULT_VIEW_CUBE_LABELS) as readonly ViewCubeLabelKey[];

/** True when both have the same text for every key. */
export function sameLabels(a: ViewCubeLabels, b: ViewCubeLabels): boolean {
  return KEYS.every((key) => a[key] === b[key]);
}

/** Face labels by regionKey of the face direction (the view after a click on the face). */
const FACE_LABELS: ReadonlyMap<string, ViewCubeLabelKey> = new Map([
  ['0,-1,0', 'front'],
  ['0,1,0', 'back'],
  ['-1,0,0', 'left'],
  ['1,0,0', 'right'],
  ['0,0,1', 'top'],
  ['0,0,-1', 'bottom'],
]);

/** Label of a face region; edges and corners carry none (null). */
export function faceLabelKey(region: CubeRegion): ViewCubeLabelKey | null {
  return FACE_LABELS.get(regionKey(region)) ?? null;
}

/** Label key of an arrow button with its quarter turn. */
export interface ViewCubeArrow {
  readonly key: Exclude<
    ViewCubeLabelKey,
    'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'switchToFree' | 'switchToTurntable'
  >;
  readonly axis: TurnAxis;
  readonly quarterTurns: 1 | -1;
}

/**
 * The six arrows (spec 09, "Operace", turn): the model turns in the direction of the arrow;
 * right = about up +1, down = about right +1, clockwise roll = about the view direction −1.
 */
export const VIEW_CUBE_ARROWS: readonly ViewCubeArrow[] = Object.freeze([
  { key: 'turnUp', axis: 'right', quarterTurns: -1 },
  { key: 'turnDown', axis: 'right', quarterTurns: 1 },
  { key: 'turnLeft', axis: 'up', quarterTurns: -1 },
  { key: 'turnRight', axis: 'up', quarterTurns: 1 },
  { key: 'rollClockwise', axis: 'view', quarterTurns: -1 },
  { key: 'rollCounterClockwise', axis: 'view', quarterTurns: 1 },
]);
