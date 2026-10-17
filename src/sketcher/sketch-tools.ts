// Tools of the sketcher (spec 10, "Nástroje a akce skicáře"): the entry tool 'sketch' and the
// tools inside the sketch mode. The tools live in ./sketch-tools/, this file only describes them.

import type { Mode, ToolDescriptor } from '@/interaction';
import { SKETCH_SELECT_TOOL_ID } from './constants';
import type { SketchEditor } from './sketch-editor';
import { createChamferTool } from './sketch-tools/chamfer-tool';
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
import { createPointTool } from './sketch-tools/point-tool';
import { createRectangleCenterTool } from './sketch-tools/rectangle-center-tool';
import { createMirrorTool } from './sketch-tools/mirror-tool';
import { createCircularPatternTool, createLinearPatternTool } from './sketch-tools/pattern-tool';
import { createRectangleTool } from './sketch-tools/rectangle-tool';
import { createRectangle3pTool } from './sketch-tools/rectangle3p-tool';
import { createSketchSelectTool } from './sketch-tools/select-tool';
import { createSlotTool } from './sketch-tools/slot-tool';
import { createSplineTool } from './sketch-tools/spline-tool';
import { createTextTool } from './sketch-tools/text-tool';
import { createSplitTool } from './sketch-tools/split-tool';
import { createExtendTool } from './sketch-tools/extend-tool';
import { createFilletTool } from './sketch-tools/fillet-tool';
import { createTrimTool } from './sketch-tools/trim-tool';
import { createXLineTool } from './sketch-tools/xline-tool';

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
      family: 'line',
      create: () => createLineTool(sketches),
    }),
    // The infinite construction line (M31) is a variant of the line.
    Object.freeze<ToolDescriptor>({
      id: 'sketch.xline',
      label: 'tool.xline',
      icon: 'arrows-horizontal',
      group: 'draw',
      modes: SKETCH,
      family: 'line',
      create: () => createXLineTool(sketches),
    }),
    // The lone point (M31) is the last variant of the line family: a toolbar of 1280 px holds the
    // sketcher only with it folded in (merge of M31 and M36).
    Object.freeze<ToolDescriptor>({
      id: 'sketch.point',
      label: 'tool.point',
      icon: 'point',
      group: 'draw',
      modes: SKETCH,
      shortcut: 'P',
      family: 'line',
      create: () => createPointTool(sketches),
    }),
    // The text (M37) folds into the line family after the point: the toolbar may not grow by a
    // button (spec 12); a Tabler icon of letters, no shortcut.
    Object.freeze<ToolDescriptor>({
      id: 'sketch.text',
      label: 'tool.text',
      icon: 'typography',
      group: 'draw',
      modes: SKETCH,
      family: 'line',
      create: () => createTextTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.rectangle',
      label: 'tool.rectangle',
      icon: 'square',
      group: 'draw',
      modes: SKETCH,
      shortcut: 'R',
      family: 'rectangle',
      create: () => createRectangleTool(sketches),
    }),
    // The rectangles of M31: a Tabler square with its centre and a rotated one.
    Object.freeze<ToolDescriptor>({
      id: 'sketch.rectangleCenter',
      label: 'tool.rectangleCenter',
      icon: 'square-dot',
      group: 'draw',
      modes: SKETCH,
      family: 'rectangle',
      create: () => createRectangleCenterTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.rectangle3p',
      label: 'tool.rectangle3p',
      icon: 'square-rotated',
      group: 'draw',
      modes: SKETCH,
      family: 'rectangle',
      create: () => createRectangle3pTool(sketches),
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
    // All modify tools are ONE family 'modify' (Pavel 2026-10-16): the sketcher toolbar must fit
    // 1280 px with the group Vazby. Trim first (the shown variant until another one is used, the
    // only shortcut T), then extend and split (M33), mirror and patterns (M36); fillet, chamfer
    // and offset (M34, M35) join the same family.
    Object.freeze<ToolDescriptor>({
      id: 'sketch.trim',
      label: 'tool.trim',
      icon: 'scissors',
      group: 'modify',
      modes: SKETCH,
      shortcut: 'T',
      family: 'modify',
      create: () => createTrimTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.extend',
      label: 'tool.extend',
      icon: 'arrow-bar-to-right',
      group: 'modify',
      modes: SKETCH,
      family: 'modify',
      create: () => createExtendTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.split',
      label: 'tool.split',
      icon: 'separator',
      group: 'modify',
      modes: SKETCH,
      family: 'modify',
      create: () => createSplitTool(sketches),
    }),
    // Fillet and chamfer (M34), no shortcut; Tabler icons of a rounded corner, of a bevelled join
    // and of an angle.
    Object.freeze<ToolDescriptor>({
      id: 'sketch.fillet',
      label: 'tool.fillet',
      icon: 'border-radius',
      group: 'modify',
      modes: SKETCH,
      family: 'modify',
      create: () => createFilletTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.chamfer',
      label: 'tool.chamfer',
      icon: 'join-bevel',
      group: 'modify',
      modes: SKETCH,
      family: 'modify',
      create: () => createChamferTool(sketches, 'distances'),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.chamferAngle',
      label: 'tool.chamferAngle',
      icon: 'angle',
      group: 'modify',
      modes: SKETCH,
      family: 'modify',
      create: () => createChamferTool(sketches, 'angle'),
    }),
    // Mirror and patterns (M36), no shortcut; Tabler icons of a flip, a grid of dots and a full turn.
    Object.freeze<ToolDescriptor>({
      id: 'sketch.mirror',
      label: 'tool.mirror',
      icon: 'flip-horizontal',
      group: 'modify',
      modes: SKETCH,
      family: 'modify',
      create: () => createMirrorTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.linearPattern',
      label: 'tool.linearPattern',
      icon: 'grid-dots',
      group: 'modify',
      modes: SKETCH,
      family: 'modify',
      create: () => createLinearPatternTool(sketches),
    }),
    Object.freeze<ToolDescriptor>({
      id: 'sketch.circularPattern',
      label: 'tool.circularPattern',
      icon: 'rotate-360',
      group: 'modify',
      modes: SKETCH,
      family: 'modify',
      create: () => createCircularPatternTool(sketches),
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
