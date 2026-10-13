import type { Tool, ToolDescriptor } from '@/interaction';

// The interaction half of the box feature (spec 10, "Dialog featury"): a trivial tool that
// opens the feature dialog for a new box and finishes; the dialog then does the rest.

export const boxTool: ToolDescriptor = Object.freeze<ToolDescriptor>({
  id: 'box',
  // A translation key from the box messages (ADR 0014).
  label: 'box.label',
  icon: 'box',
  group: 'primitive',
  shortcut: 'B',
  create: createBoxTool,
});

function createBoxTool(): Tool {
  return {
    activate(ctx) {
      // One dialog at a time: with another session open the tool only finishes.
      if (ctx.features.current.get() === null) ctx.features.create('box');
      ctx.finish();
    },
    deactivate() {
      // Nothing to clean up: the tool holds no state, the session belongs to the dialog.
    },
  };
}
