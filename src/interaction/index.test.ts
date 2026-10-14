import { describe, expect, it } from 'vitest';
import * as interaction from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('interaction public API', () => {
  it('exports exactly these runtime values', () => {
    expect(Object.keys(interaction).sort()).toEqual(
      [
        'ACTION_IDS',
        'ALL_MODES',
        'artifactDrawing',
        'axisDrawing',
        'createSketchActions',
        'createSketchEditor',
        'createSketchTools',
        'EDIT_SKETCH_DRAWING_ID',
        'ORIGIN_POINT_ID',
        'planeDrawing',
        'SKETCH_ACTION_IDS',
        'sketchConstraintActionId',
        'toSketchDrawing',
        'bindSelectionHighlight',
        'createActionRegistry',
        'createBrowserModel',
        'createBuiltInActions',
        'createEditLock',
        'createFeatureEditor',
        'createFeatureTreeModel',
        'createSelectionModel',
        'createToolManager',
        'createToolRegistry',
        'SELECT_TOOL',
        'sameSelectionItem',
        'toolActionId',
        'toolModes',
      ].sort(),
    );
  });
});
