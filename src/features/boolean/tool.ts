import type { Tool, ToolDescriptor } from '@/interaction';

// The interaction half of the boolean feature (spec 10, "Dialog featury"): a trivial tool that
// opens the feature dialog for a new boolean and finishes; the dialog then picks the bodies.

export const booleanTool: ToolDescriptor = Object.freeze<ToolDescriptor>({
  id: 'boolean',
  // A translation key from the boolean messages (ADR 0014).
  label: 'boolean.label',
  icon: 'layers-union',
  group: 'modify',
  create: createBooleanTool,
});

function createBooleanTool(): Tool {
  return {
    activate(ctx) {
      // One dialog at a time: with another session open the tool only finishes.
      if (ctx.features.current.get() === null) ctx.features.create('boolean');
      ctx.finish();
    },
    deactivate() {
      // Nothing to clean up: the tool holds no state, the session belongs to the dialog.
    },
  };
}
