// Tools of the sketcher (spec 10, "Nástroje a akce skicáře"): the entry tool 'sketch' and the
// tools inside the sketch mode. The tools live in ./sketch-tools/, this file only describes them.

import type { Mode, ToolDescriptor } from '@/interaction';
import { SKETCH_SELECT_TOOL_ID } from './constants';
import type { SketchEditor } from './sketch-editor';
import { createArcTool } from './sketch-tools/arc-tool';
import { createCircleTool } from './sketch-tools/circle-tool';
import { createDimensionTool } from './sketch-tools/dimension-tool';
import { createEntryTool } from './sketch-tools/entry-tool';
import { createLineTool } from './sketch-tools/line-tool';
import { createRectangleTool } from './sketch-tools/rectangle-tool';
import { createSketchSelectTool } from './sketch-tools/select-tool';
import { createSplineTool } from './sketch-tools/spline-tool';

const MODEL: readonly Mode[] = Object.freeze(['model']);
const SKETCH: readonly Mode[] = Object.freeze(['sketch']);

/** The descriptors in toolbar order; labels are translation keys (ADR 0014). */
export function createSketchTools(deps: { sketches: SketchEditor }): readonly ToolDescriptor[] {
  const { sketches } = deps;
  return Object.freeze<ToolDescriptor[]>([
    Object.freeze<ToolDescriptor>({
      id: 'sketch',
      label: 'tool.sketch',
      icon: 'pencil',
      group: 'sketch',
      modes: MODEL,
      shortcut: 'Shift+S',
      create: () => createEntryTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: SKETCH_SELECT_TOOL_ID,
      label: 'tool.select',
      icon: 'pointer',
      group: 'select',
      modes: SKETCH,
      create: () => createSketchSelectTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.line',
      label: 'tool.line',
      icon: 'line',
      group: 'draw',
      modes: SKETCH,
      shortcut: 'L',
      create: () => createLineTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.rectangle',
      label: 'tool.rectangle',
      icon: 'square',
      group: 'draw',
      modes: SKETCH,
      shortcut: 'R',
      create: () => createRectangleTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.circle',
      label: 'tool.circle',
      icon: 'circle',
      group: 'draw',
      modes: SKETCH,
      shortcut: 'C',
      create: () => createCircleTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.arc',
      label: 'tool.arc',
      icon: 'chart-arcs',
      group: 'draw',
      modes: SKETCH,
      shortcut: 'A',
      create: () => createArcTool(sketches),
    }),
    // The splines (M29) have no shortcut; Tabler icons of a curve with handles and of a curve
    // through points.
    Object.freeze<ToolDescriptor>({
      id: 'sketch.spline',
      label: 'tool.spline',
      icon: 'vector-bezier',
      group: 'draw',
      modes: SKETCH,
      create: () => createSplineTool(sketches, 'bspline'),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.fitSpline',
      label: 'tool.fitSpline',
      icon: 'vector-spline',
      group: 'draw',
      modes: SKETCH,
      create: () => createSplineTool(sketches, 'fitSpline'),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.dimension',
      label: 'tool.dimension',
      icon: 'ruler-measure',
      group: 'constrain',
      modes: SKETCH,
      shortcut: 'D',
      create: () => createDimensionTool(sketches),
    }),
  ]);
}
