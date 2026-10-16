// The sketcher's part of the Toolbar (spec 11, "Komponenty"; M20): in the sketch mode the groups
// Historie, Výběr, Kreslit, Vazby, Dokončit, Zobrazit, cancel and finish of a sketch as buttons of
// the group 'finish', the constraint actions as buttons of the group 'constrain' after the
// dimension tool, and construction (M31) as a button of the group 'draw' after the drawing tools.
// app passes it to createToolbarModel; interaction knows nothing of it.

import type { ToolbarModeContribution } from '@/interaction';
import { GEOMETRIC_CONSTRAINT_KINDS } from '@/sketch';
import type { GeometricConstraintKind } from '@/sketch';
import {
  SKETCH_ACTION_IDS,
  SKETCH_CONSTRAINT_ACTION_GROUP,
  SKETCH_DRAW_ACTION_GROUP,
  sketchConstraintActionId,
} from './constants';

/** Icons of the constraint actions by kind (Tabler names); a new kind must bring one. */
const CONSTRAINT_ICONS: Readonly<Record<GeometricConstraintKind, string>> = {
  coincident: 'point',
  horizontal: 'arrows-horizontal',
  vertical: 'arrows-vertical',
  parallel: 'slashes',
  perpendicular: 'angle',
  equal: 'equal',
  tangent: 'circle-dot',
  // The M mark of the midpoint glyph.
  midpoint: 'letter-m',
  fix: 'lock',
};
/** The icon of the construction button (M31). */
const CONSTRUCTION_ICON = 'line-dashed';
/** The icon of an action of the constraint group that is not one of the kinds. */
const DEFAULT_CONSTRAINT_ICON = 'link';

const ICON_BY_ACTION: ReadonlyMap<string, string> = new Map(
  GEOMETRIC_CONSTRAINT_KINDS.map((kind) => [
    sketchConstraintActionId(kind),
    CONSTRAINT_ICONS[kind],
  ]),
);

/** The contribution of the sketch mode to the Toolbar. Frozen. */
export const SKETCH_TOOLBAR: ToolbarModeContribution = Object.freeze({
  mode: 'sketch',
  groupOrder: Object.freeze(['history', 'select', 'draw', 'constrain', 'finish', 'view']),
  actionButtons: Object.freeze({
    finish: Object.freeze([
      Object.freeze({ id: SKETCH_ACTION_IDS.cancel, icon: 'x' }),
      Object.freeze({ id: SKETCH_ACTION_IDS.finish, icon: 'check' }),
    ]),
  }),
  actionGroups: Object.freeze([
    Object.freeze({
      actionGroup: SKETCH_CONSTRAINT_ACTION_GROUP,
      toolbarGroup: 'constrain',
      icon: (actionId: string) => ICON_BY_ACTION.get(actionId) ?? DEFAULT_CONSTRAINT_ICON,
    }),
    // actionButtons come before the tools of a group, an action group after them.
    Object.freeze({
      actionGroup: SKETCH_DRAW_ACTION_GROUP,
      toolbarGroup: 'draw',
      icon: () => CONSTRUCTION_ICON,
    }),
  ]),
});
