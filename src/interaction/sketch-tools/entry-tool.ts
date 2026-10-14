// The entry tool 'sketch' (spec 10, "Nástroje a akce skicáře"; spec 12, "Režim skicáře"): with no
// dialog and no sketch open it creates a sketch on the first selected plane (default XY) and
// finishes. The SketchEditor then switches the mode, so the ToolManager starts sketch.select.

import { ORIGIN_PLANE_IDS } from '@/document';
import type { PlaneId } from '@/document';
import type { SketchEditor } from '../sketch-editor';
import type { Tool, ToolContext } from '../tools';

export function createEntryTool(sketches: SketchEditor): Tool {
  return {
    activate(ctx) {
      if (ctx.features.current.get() === null && sketches.current.get() === null) {
        sketches.create(selectedPlane(ctx) ?? ORIGIN_PLANE_IDS.xy);
      }
      ctx.finish();
    },
    deactivate() {
      // Nothing to clean up: the session belongs to the SketchEditor.
    },
  };
}

function selectedPlane(ctx: ToolContext): PlaneId | undefined {
  for (const item of ctx.selection.items.get()) if (item.kind === 'plane') return item.plane;
  return undefined;
}
