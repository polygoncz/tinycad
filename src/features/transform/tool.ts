import type { Tool, ToolDescriptor } from '@/interaction';

// The interaction half of the transform feature (spec 10, "Dialog featury"): a trivial tool that
// opens the feature dialog for a new transform and finishes; the dialog then does the rest.

export const transformTool: ToolDescriptor = Object.freeze<ToolDescriptor>({
  id: 'transform',
  // A translation key from the transform messages (ADR 0014).
  label: 'transform.label',
  icon: 'arrows-move',
  group: 'modify',
  create: createTransformTool,
});

function createTransformTool(): Tool {
  return {
    activate(ctx) {
      // One dialog at a time: with another session open the tool only finishes.
      if (ctx.features.current.get() === null) ctx.features.create('transform');
      ctx.finish();
    },
    deactivate() {
      // Nothing to clean up: the tool holds no state, the session belongs to the dialog.
    },
  };
}
