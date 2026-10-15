// The entry tool 'sketch' (spec 10, "Nástroje a akce skicáře"; spec 12, "Režim skicáře"): with no
// dialog and no sketch open it creates a sketch on the plane from the selection and finishes: the
// first selected plane, else the first named face with a plane (M14, R107), else XY. The
// SketchEditor then switches the mode, so the ToolManager starts sketch.select.

import { ORIGIN_PLANE_IDS } from '@/document';
import type { PlaneRef, TopoRef } from '@/document';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';

const DEFAULT_PLANE: PlaneRef = Object.freeze({ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy });

export function createEntryTool(sketches: SketchEditor): Tool {
  return {
    activate(ctx) {
      if (ctx.features.current.get() === null && sketches.current.get() === null) {
        sketches.create(selectedPlane(ctx) ?? selectedFace(ctx, sketches) ?? DEFAULT_PLANE);
      }
      ctx.finish();
    },
    deactivate() {
      // Nothing to clean up: the session belongs to the SketchEditor.
    },
  };
}

/** The first selected plane of the Browser; it wins over faces wherever it is in the selection. */
function selectedPlane(ctx: ToolContext): PlaneRef | undefined {
  for (const item of ctx.selection.items.get()) {
    if (item.kind === 'plane') return { kind: 'plane', plane: item.plane };
  }
  return undefined;
}

/** The first selected face with a name whose plane the editor knows (a planar face, M14). */
function selectedFace(ctx: ToolContext, sketches: SketchEditor): TopoRef | undefined {
  for (const item of ctx.selection.items.get()) {
    if (item.kind !== 'face' || item.name === undefined) continue;
    const ref: TopoRef = { kind: 'topo', body: item.body, name: item.name };
    if (sketches.planeOf(ref) !== undefined) return ref;
  }
  return undefined;
}
