// The mirror tool (spec 12, "Zrcadlení a pole (M36)", "Nástroje"): sources → Enter → a click on a
// line (not a source) writes the mirror of the sources across it. The steps are those of every
// pattern tool (pattern-tool.ts), with hints of their own (M37).

import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import { createPatternTool } from './pattern-tool';

export function createMirrorTool(sketches: SketchEditor): Tool {
  const hints = { sources: 'hint.mirror.sources', done: 'hint.mirror.done' };
  return createPatternTool(sketches, hints, {
    kind: 'pick',
    hint: 'hint.mirror.axis',
    // After M31 an xline is an axis too (spec 12).
    accepts: (e) => e.kind === 'line',
    build: (id, sources, axis) => ({ kind: 'mirror', id, sources, axis }),
  });
}
