import { describe, expect, it } from 'vitest';
import * as constants from '@/interaction/constants';
import {
  ACTION_IDS,
  FILE_ACTION_IDS,
  HANDLE_VISIBILITY,
  MANIPULATOR_GLYPHS,
  toolActionId,
  toolModes,
} from '@/interaction/constants';
import { EDGE_ON_LIMIT, PARALLEL_LIMIT } from '@/interaction/manipulators/manipulator-drag';

// The data entry point of interaction (M20, D6) and the shared invariant of the hiding and the
// drag limits of the handles.

describe('interaction/constants', () => {
  it('exports only the data for ui and app', () => {
    expect(Object.keys(constants).sort()).toEqual(
      [
        'ACTION_IDS',
        'CLICK_TOLERANCE_PX',
        'FILE_ACTION_IDS',
        'HANDLE_VISIBILITY',
        'MANIPULATOR_GLYPHS',
        'toolActionId',
        'toolModes',
      ].sort(),
    );
  });

  it('is frozen', () => {
    expect(Object.isFrozen(MANIPULATOR_GLYPHS)).toBe(true);
    expect(Object.isFrozen(HANDLE_VISIBILITY)).toBe(true);
    expect(Object.isFrozen(ACTION_IDS)).toBe(true);
    expect(Object.isFrozen(FILE_ACTION_IDS)).toBe(true);
  });

  it('has the ids of the built-in and the File actions', () => {
    expect(ACTION_IDS.undo).toBe('undo');
    expect(ACTION_IDS.featureRename).toBe('feature.rename');
    expect(ACTION_IDS.fitAll).toBe('view.fitAll');
    expect(FILE_ACTION_IDS).toEqual({
      exportStep: 'file.exportStep',
      exportDocument: 'file.exportDocument',
    });
  });

  it('toolActionId is the action that activates a tool', () => {
    expect(toolActionId('box')).toBe('tool.box');
  });

  it('toolModes: the modes of a tool, model when it does not say', () => {
    expect(toolModes({})).toEqual(['model']);
    expect(toolModes({ modes: ['sketch'] })).toEqual(['sketch']);
    expect(Object.isFrozen(toolModes({}))).toBe(true);
  });

  it('has the sizes and limits of spec 09 ("Vzhled od M19")', () => {
    expect(MANIPULATOR_GLYPHS).toEqual({
      arrowStartPx: 14,
      arrowShaftPx: 80,
      arrowConePx: 18,
      arrowConeRadiusPx: 6,
      arrowTipPx: 98,
      ringPx: 72,
      squareNearPx: 26,
      squareFarPx: 46,
      pointPx: 9,
    });
    expect(HANDLE_VISIBILITY).toEqual({
      arrowHideCos: 0.98,
      ringHideCos: 0.05,
      squareHideCos: 0.05,
    });
  });

  it('the tip of an arrow is its shaft and cone', () => {
    expect(MANIPULATOR_GLYPHS.arrowTipPx).toBe(
      MANIPULATOR_GLYPHS.arrowShaftPx + MANIPULATOR_GLYPHS.arrowConePx,
    );
    expect(MANIPULATOR_GLYPHS.arrowStartPx).toBeLessThan(MANIPULATOR_GLYPHS.arrowShaftPx);
    expect(MANIPULATOR_GLYPHS.squareNearPx).toBeLessThan(MANIPULATOR_GLYPHS.squareFarPx);
  });

  describe('every hiding limit is stricter than the limit of its drag', () => {
    it('an arrow hides before the ray runs along it (|cos| above the limit)', () => {
      expect(HANDLE_VISIBILITY.arrowHideCos).toBeLessThan(PARALLEL_LIMIT);
    });

    it('a ring or quarter hides before its plane is seen edge-on for the drag', () => {
      expect(HANDLE_VISIBILITY.ringHideCos).toBeGreaterThan(EDGE_ON_LIMIT);
    });

    it('a square hides before its plane is seen edge-on for the drag', () => {
      expect(HANDLE_VISIBILITY.squareHideCos).toBeGreaterThan(EDGE_ON_LIMIT);
    });
  });
});
