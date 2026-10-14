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
        'NO_TOPO_NAMES',
        'ORIGIN_POINT_ID',
        'planeDrawing',
        'SKETCH_ACTION_IDS',
        'sketchConstraintActionId',
        'toSketchDrawing',
        'bindSelectionHighlight',
        'createActionRegistry',
        'createBrowserModel',
        'createBuiltInActions',
        'createDocumentNameModel',
        'createEditLock',
        'createFeatureEditor',
        'createFeatureTreeModel',
        'createFileActions',
        'createHistoryModel',
        'FILE_ACTION_IDS',
        'HISTORY_LIMIT',
        'createSelectionModel',
        'createToolManager',
        'createToolRegistry',
        'createManipulatorRegistry',
        'createManipulatorController',
        'createTopoInspector',
        'SELECT_TOOL',
        'sameSelectionItem',
        'toolActionId',
        'toolModes',
      ].sort(),
    );
  });
});
