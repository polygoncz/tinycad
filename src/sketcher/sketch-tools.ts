// Tools of the sketcher (spec 10, "Nástroje a akce skicáře"): the entry tool 'sketch' and the
// tools inside the sketch mode. The tools live in ./sketch-tools/, this file only describes them.

import type { Mode, ToolDescriptor } from '@/interaction';
import { SKETCH_SELECT_TOOL_ID } from './constants';
import type { SketchEditor } from './sketch-editor';
import { createArcTangentTool } from './sketch-tools/arc-tangent-tool';
import { createArcTool } from './sketch-tools/arc-tool';
import { createArc3pTool } from './sketch-tools/arc3p-tool';
import { createCircle2pTool } from './sketch-tools/circle2p-tool';
import { createCircle3pTool } from './sketch-tools/circle3p-tool';
import { createCircleTangentTool } from './sketch-tools/circle-tangent-tool';
import { createCircleTool } from './sketch-tools/circle-tool';
import { createDimensionTool } from './sketch-tools/dimension-tool';
import { createEntryTool } from './sketch-tools/entry-tool';
import { createLineTool } from './sketch-tools/line-tool';
import { createRectangleTool } from './sketch-tools/rectangle-tool';
import { createSketchSelectTool } from './sketch-tools/select-tool';
import { createSlotTool } from './sketch-tools/slot-tool';
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
      family: 'circle',
      create: () => createCircleTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.circle2p',
      label: 'tool.circle2p',
      icon: 'circle-number-2',
      group: 'draw',
      modes: SKETCH,
      family: 'circle',
      create: () => createCircle2pTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.circle3p',
      label: 'tool.circle3p',
      icon: 'circle-number-3',
      group: 'draw',
      modes: SKETCH,
      family: 'circle',
      create: () => createCircle3pTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.circle2t',
      label: 'tool.circle2t',
      icon: 'circles-relation',
      group: 'draw',
      modes: SKETCH,
      family: 'circle',
      create: () => createCircleTangentTool(sketches, 2),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.circle3t',
      label: 'tool.circle3t',
      icon: 'circle-letter-t',
      group: 'draw',
      modes: SKETCH,
      family: 'circle',
      create: () => createCircleTangentTool(sketches, 3),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.arc',
      label: 'tool.arc',
      icon: 'chart-arcs',
      group: 'draw',
      modes: SKETCH,
      family: 'arc',
      shortcut: 'A',
      create: () => createArcTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.arc3p',
      label: 'tool.arc3p',
      icon: 'chart-arcs-3',
      group: 'draw',
      modes: SKETCH,
      family: 'arc',
      create: () => createArc3pTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.arcTangent',
      label: 'tool.arcTangent',
      icon: 'ease-out',
      group: 'draw',
      modes: SKETCH,
      family: 'arc',
      create: () => createArcTangentTool(sketches),
    }),
    // The splines (M29) have no shortcut; Tabler icons of a curve with handles and of a curve
    // through points.
    Object.freeze<ToolDescriptor>({
      id: 'sketch.spline',
      label: 'tool.spline',
      icon: 'vector-bezier',
      group: 'draw',
      modes: SKETCH,
      family: 'spline',
      create: () => createSplineTool(sketches, 'bspline'),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.fitSpline',
      label: 'tool.fitSpline',
      icon: 'vector-spline',
      group: 'draw',
      modes: SKETCH,
      family: 'spline',
      create: () => createSplineTool(sketches, 'fitSpline'),
    }),
    // The slots (M31) have no shortcut; Tabler icons of a capsule, of an overall width and of an
    // arc band.
    Object.freeze<ToolDescriptor>({
      id: 'sketch.slot',
      label: 'tool.slot',
      icon: 'capsule-horizontal',
      group: 'draw',
      modes: SKETCH,
      family: 'slot',
      create: () => createSlotTool(sketches, 'centers'),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.slotOverall',
      label: 'tool.slotOverall',
      icon: 'arrow-autofit-width',
      group: 'draw',
      modes: SKETCH,
      family: 'slot',
      create: () => createSlotTool(sketches, 'overall'),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.slotArc',
      label: 'tool.slotArc',
      icon: 'rainbow',
      group: 'draw',
      modes: SKETCH,
      family: 'slot',
      create: () => createSlotTool(sketches, 'arc'),
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
