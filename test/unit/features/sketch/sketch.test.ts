import { describe, expect, it } from 'vitest';
import { sketchMessages } from '@/features/sketch/messages';
import * as sketch from '@/features/sketch';

// The client half of the sketch feature (N123): the schema and the builder are the core's, the
// plugin brings only the texts of its translation keys.

describe('sketch public API', () => {
  it('exports exactly sketchPlugin', () => {
    expect(Object.keys(sketch)).toEqual(['sketchPlugin']);
  });

  it('sketchPlugin is the client half of the feature type sketch with its messages', () => {
    expect(sketch.sketchPlugin.type).toBe('sketch');
    expect(sketch.sketchPlugin.messages).toBe(sketchMessages);
  });

  it('has no tools: entering the sketcher is a built-in tool of interaction (ADR 0017)', () => {
    expect(sketch.sketchPlugin.tools).toBeUndefined();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(sketch.sketchPlugin)).toBe(true);
  });
});
