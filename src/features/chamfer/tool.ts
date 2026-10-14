import type { Tool, ToolDescriptor } from '@/interaction';

// The interaction half of the chamfer feature (spec 10, "Dialog featury"): a trivial tool that
// opens the feature dialog for a new chamfer and finishes; the dialog then picks the edges.

export const chamferTool: ToolDescriptor = Object.freeze<ToolDescriptor>({
  id: 'chamfer',
  // A translation key from the chamfer messages (ADR 0014).
  label: 'chamfer.label',
  icon: 'border-corner-square',
  group: 'modify',
  // No shortcut (R105).
  create: createChamferTool,
});

function createChamferTool(): Tool {
  return {
    activate(ctx) {
      // One dialog at a time: with another session open the tool only finishes.
      if (ctx.features.current.get() === null) ctx.features.create('chamfer');
      ctx.finish();
    },
    deactivate() {
      // Nothing to clean up: the tool holds no state, the session belongs to the dialog.
    },
  };
}
