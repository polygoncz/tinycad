import type { Tool, ToolDescriptor } from '@/interaction';

// The interaction half of the extrude feature (spec 10, "Dialog featury"): a trivial tool that
// opens the feature dialog for a new extrude and finishes; the dialog then picks the regions.

export const extrudeTool: ToolDescriptor = Object.freeze<ToolDescriptor>({
  id: 'extrude',
  // A translation key from the extrude messages (ADR 0014).
  label: 'extrude.label',
  icon: 'arrow-big-up-lines',
  group: 'feature',
  shortcut: 'Shift+E',
  create: createExtrudeTool,
});

function createExtrudeTool(): Tool {
  return {
    activate(ctx) {
      // One dialog at a time: with another session open the tool only finishes.
      if (ctx.features.current.get() === null) ctx.features.create('extrude');
      ctx.finish();
    },
    deactivate() {
      // Nothing to clean up: the tool holds no state, the session belongs to the dialog.
    },
  };
}
