import { describe, expect, it } from 'vitest';
import * as interaction from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('interaction public API', () => {
  it('exports exactly these runtime values', () => {
    expect(Object.keys(interaction).sort()).toEqual(
      [
        'ACTION_IDS',
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
      ].sort(),
    );
  });
});
