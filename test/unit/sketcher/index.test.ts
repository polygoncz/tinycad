import { describe, expect, it } from 'vitest';
import * as sketcher from '@/sketcher';

// Guards the public API: a value export removed or added by accident shows up here.
describe('sketcher public API', () => {
  it('exports exactly these runtime values', () => {
    expect(Object.keys(sketcher).sort()).toEqual(
      [
        'artifactDrawing',
        'axisDrawing',
        'createSketchActions',
        'createSketchEditor',
        'createSketchTools',
        'planeDrawing',
        'SKETCH_ACTION_IDS',
        'SKETCH_SELECT_TOOL_ID',
        'SKETCH_TOOLBAR',
        'sketchConstraintActionId',
      ].sort(),
    );
  });
});
