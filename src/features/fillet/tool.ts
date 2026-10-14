import type { Tool, ToolDescriptor } from '@/interaction';

// The interaction half of the fillet feature (spec 10, "Dialog featury"): a trivial tool that
// opens the feature dialog for a new fillet and finishes; the dialog then picks the edges.

export const filletTool: ToolDescriptor = Object.freeze<ToolDescriptor>({
  id: 'fillet',
  // A translation key from the fillet messages (ADR 0014).
  label: 'fillet.label',
  icon: 'border-radius',
  group: 'modify',
  // R105. F alone is the view action fitAll; Shift+F is free in the model mode.
  shortcut: 'Shift+F',
  create: createFilletTool,
});

function createFilletTool(): Tool {
  return {
    activate(ctx) {
      // One dialog at a time: with another session open the tool only finishes.
      if (ctx.features.current.get() === null) ctx.features.create('fillet');
      ctx.finish();
    },
    deactivate() {
      // Nothing to clean up: the tool holds no state, the session belongs to the dialog.
    },
  };
}
