// Ring 2 – presentation models, selection, tools, actions, ViewportPort.
// Public API of interaction (spec 10). Everything else in this folder is internal.

export type {
  HighlightPort,
  KeyMods,
  OverlayPort,
  OverlayShape,
  OverlayStyle,
  PickResult,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportEvents,
  ViewportPort,
} from './viewport-port';
// Part of the port's vocabulary: render takes BodyId from here, never from document (Q056).
export type { BodyId } from '@/document';
