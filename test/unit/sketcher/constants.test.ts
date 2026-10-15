import { describe, expect, it } from 'vitest';
import * as constants from '@/sketcher/constants';
import {
  SKETCH_ACTION_IDS,
  SKETCH_CONSTRAINT_ACTION_GROUP,
  SKETCH_SELECT_TOOL_ID,
  sketchConstraintActionId,
} from '@/sketcher/constants';

// The data entry point of sketcher (M20, D6, ADR 0024).

describe('sketcher/constants', () => {
  it('exports only the data for ui and app', () => {
    expect(Object.keys(constants).sort()).toEqual(
      [
        'SKETCH_ACTION_IDS',
        'SKETCH_CONSTRAINT_ACTION_GROUP',
        'SKETCH_SELECT_TOOL_ID',
        'sketchConstraintActionId',
      ].sort(),
    );
  });

  it('has the frozen ids of the sketcher actions', () => {
    expect(SKETCH_ACTION_IDS).toEqual({
      finish: 'sketch.finish',
      cancel: 'sketch.cancel',
      delete: 'sketch.delete',
      construction: 'sketch.construction',
    });
    expect(Object.isFrozen(SKETCH_ACTION_IDS)).toBe(true);
  });

  it('sketchConstraintActionId is sketch.constraint.<kind>', () => {
    expect(sketchConstraintActionId('horizontal')).toBe('sketch.constraint.horizontal');
  });

  it('names the constraint action group and the default tool of the sketch mode', () => {
    expect(SKETCH_CONSTRAINT_ACTION_GROUP).toBe('sketch.constraint');
    expect(SKETCH_SELECT_TOOL_ID).toBe('sketch.select');
  });
});
