// A layer of input above the active tool (spec 10, "Směrování v ToolManager", M20 A4.3).
// ToolManager asks its layers in order before the tool; app composes them (manipulators, then
// refPick), so the manager knows neither ManipulatorController nor refPick.

import type { ViewKeyEvent, ViewPointerEvent } from './viewport-port';

export interface InputLayer {
  /** true = the event is handled, it goes neither to the layers below nor to the tool. */
  onPointer(e: ViewPointerEvent): boolean;
  /** true = the key is handled, it goes neither to the layers below nor to the tool. */
  onKey(e: ViewKeyEvent): boolean;
  /**
   * What the levels below get when this layer takes a `move`. true (the default): one synthetic
   * `leave` at the same place, when they did not last get a leave, so no hover of theirs stays
   * under the layer (manipulators draw a hover of their own). false: nothing; the layer covers
   * them and shows the shared hover itself, so a leave below would clear its hover (refPick).
   */
  readonly leaveBelow?: boolean;
}
