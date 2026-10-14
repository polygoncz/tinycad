import type { Tool, ToolDescriptor } from '@/interaction';

// The interaction half of the revolve feature (spec 10, "Dialog featury"): a trivial tool that
// opens the feature dialog for a new revolve and finishes; the dialog then picks regions and axis.

export const revolveTool: ToolDescriptor = Object.freeze<ToolDescriptor>({
  id: 'revolve',
  // A translation key from the revolve messages (ADR 0014).
  label: 'revolve.label',
  icon: 'rotate-360',
  group: 'feature',
  shortcut: 'Shift+W',
  create: createRevolveTool,
});

function createRevolveTool(): Tool {
  return {
    activate(ctx) {
      // One dialog at a time: with another session open the tool only finishes.
      if (ctx.features.current.get() === null) ctx.features.create('revolve');
      ctx.finish();
    },
    deactivate() {
      // Nothing to clean up: the tool holds no state, the session belongs to the dialog.
    },
  };
}
