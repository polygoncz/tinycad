import { describe, expect, it } from 'vitest';
import * as interaction from '@/interaction';

// Guards the public API: a value export removed or added by accident shows up here.
describe('interaction public API', () => {
  it('exports exactly these runtime values', () => {
    expect(Object.keys(interaction).sort()).toEqual(
      [
        'ACTION_IDS',
        'ALL_MODES',
        'CLICK_TOLERANCE_PX',
        'isPlainEscape',
        'bindSelectionHighlight',
        'createActionRegistry',
        'createBrowserModel',
        'createBuiltInActions',
        'createDocumentNameModel',
        'createDocumentListModel',
        'createEditLock',
        'createFeatureEditor',
        'createFeatureTreeModel',
        'createFileActions',
        'createHistoryModel',
        'FILE_ACTION_IDS',
        'HANDLE_VISIBILITY',
        'HISTORY_LIMIT',
        'MANIPULATOR_GLYPHS',
        'createSelectionModel',
        'createToolManager',
        'createRefPickLayer',
        'createToolbarModel',
        'createToolRegistry',
        'createManipulatorRegistry',
        'createManipulatorController',
        'createTopoInspector',
        'SELECT_TOOL',
        'sameSelectionItem',
      ].sort(),
    );
  });
});
