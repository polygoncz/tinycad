import type { Tool, ToolDescriptor } from '@/interaction';

// The interaction half of the cylinder feature (spec 10, "Dialog featury"): a trivial tool that
// opens the feature dialog for a new cylinder and finishes; the dialog then does the rest.

export const cylinderTool: ToolDescriptor = Object.freeze<ToolDescriptor>({
  id: 'cylinder',
  // A translation key from the cylinder messages (ADR 0014).
  label: 'cylinder.label',
  icon: 'cylinder',
  group: 'primitive',
  shortcut: 'C',
  create: createCylinderTool,
});

function createCylinderTool(): Tool {
  return {
    activate(ctx) {
      // One dialog at a time: with another session open the tool only finishes.
      if (ctx.features.current.get() === null) ctx.features.create('cylinder');
      ctx.finish();
    },
    deactivate() {
      // Nothing to clean up: the tool holds no state, the session belongs to the dialog.
    },
  };
}
