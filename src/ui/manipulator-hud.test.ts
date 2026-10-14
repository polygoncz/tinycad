import { describe, expect, it } from 'vitest';
import type { HudField, ManipulatorHud } from '@/app';
import type { Vec3 } from '@/core';
import { degToRad } from './components/params/field-values';
import {
  axisLetter,
  fieldCommit,
  fieldPosition,
  fieldText,
  hudLayout,
  insideArea,
  toolbarPosition,
} from './manipulator-hud';
import type { ScreenPoint } from './manipulator-hud';

describe('fieldPosition', () => {
  it('puts the field offsetPx from a along the screen direction a → b', () => {
    expect(fieldPosition([100, 100], [103, 104], 96)).toEqual([100 + 96 * 0.6, 100 + 96 * 0.8]);
  });

  it('uses the offset it gets (88 for an angular handle)', () => {
    expect(fieldPosition([10, 20], [10, 15], 88)).toEqual([10, 20 - 88]);
  });

  it('the length of a → b does not matter, only its direction', () => {
    expect(fieldPosition([0, 0], [-200, 0], 96)).toEqual([-96, 0]);
  });

  it('coinciding projections put the field 96 px to the right', () => {
    expect(fieldPosition([50, 60], [50, 60], 88)).toEqual([50 + 96, 60]);
  });

  it('b out of the projection behaves like coinciding projections', () => {
    expect(fieldPosition([50, 60], null, 96)).toEqual([146, 60]);
  });

  it('a out of the projection → null', () => {
    expect(fieldPosition(null, [1, 2], 96)).toBeNull();
  });
});

describe('toolbarPosition', () => {
  const area = { width: 800, height: 600 };
  const size = { width: 120, height: 30 };

  it('the bottom left corner stands 110 px right of and 110 px above the center', () => {
    // Beyond the glyphs (arrow tip 98 px, arcs 72 px), so the bar covers no handle.
    expect(toolbarPosition([400, 300], size, area)).toEqual([510, 300 - 110 - 30]);
  });

  it('is moved inside the area at the right and top edge', () => {
    expect(toolbarPosition([790, 10], size, area)).toEqual([800 - 120, 0]);
  });

  it('is moved inside the area at the left and bottom edge', () => {
    // A toolbar taller than the space below: it starts at the bottom edge minus its height.
    expect(toolbarPosition([-200, 900], size, area)).toEqual([0, 600 - 30]);
  });

  it('a toolbar larger than the area sticks to the top left corner', () => {
    expect(toolbarPosition([10, 10], { width: 900, height: 700 }, area)).toEqual([0, 0]);
  });

  it('no center (out of the projection) → null', () => {
    expect(toolbarPosition(null, size, area)).toBeNull();
  });
});

describe('insideArea', () => {
  const area = { width: 800, height: 600 };

  it.each([
    [[0, 0], true],
    [[800, 600], true],
    [[400, 300], true],
    [[-1, 300], false],
    [[400, 601], false],
  ] as const)('%j → %s', (point, expected) => {
    expect(insideArea(point, area)).toBe(expected);
  });

  it('null → false', () => {
    expect(insideArea(null, area)).toBe(false);
  });
});

describe('hudLayout', () => {
  const area = { width: 800, height: 600 };
  const barSize = { width: 120, height: 30 };
  // A view from the top: world x to the right, world y up, 1 mm = 1 px, origin in the middle.
  const top = (p: Vec3): ScreenPoint | null => [400 + p[0], 300 - p[1]];

  function aHud(overrides: Partial<ManipulatorHud> = {}): ManipulatorHud {
    return {
      modes: [{ id: 'free', label: 'mode.free', icon: 'arrows-move', active: true }],
      center: [0, 0, 0],
      field: null,
      ...overrides,
    };
  }

  function aField(overrides: Partial<HudField> = {}): HudField {
    return {
      handleId: 'h',
      kind: 'linear',
      at: [0, 0, 0],
      direction: [1, 0, 0],
      value: 10,
      unit: 'length',
      tint: 'x',
      dragging: false,
      ...overrides,
    };
  }

  it('no hud → both hidden', () => {
    expect(hudLayout(null, top, area, barSize)).toEqual({ barAt: null, fieldAt: null });
  });

  it('puts the bar 110 px right of and above the projected center', () => {
    expect(hudLayout(aHud({ center: [10, 20, 0] }), top, area, barSize).barAt).toEqual([
      410 + 110,
      280 - 110 - 30,
    ]);
  });

  it('hides the bar when it is not rendered (no size)', () => {
    expect(hudLayout(aHud(), top, area, null).barAt).toBeNull();
  });

  it('hides the bar when the center is out of the area or out of the projection', () => {
    expect(hudLayout(aHud({ center: [500, 0, 0] }), top, area, barSize).barAt).toBeNull();
    expect(hudLayout(aHud(), () => null, area, barSize).barAt).toBeNull();
  });

  it('no field → fieldAt null', () => {
    expect(hudLayout(aHud(), top, area, barSize).fieldAt).toBeNull();
  });

  it('moves a linear field 96 px along the screen direction of its handle', () => {
    const field = aField({ at: [10, 0, 0], direction: [0, 1, 0] });
    expect(hudLayout(aHud({ field }), top, area, barSize).fieldAt).toEqual([410, 300 - 96]);
  });

  it('moves an angular field 88 px, whatever its unit', () => {
    const field = aField({ kind: 'angular', unit: 'length', direction: [-1, 0, 0] });
    expect(hudLayout(aHud({ field }), top, area, barSize).fieldAt).toEqual([400 - 88, 300]);
  });

  it('the offset follows kind, not unit', () => {
    const field = aField({ kind: 'linear', unit: 'angle', direction: [1, 0, 0] });
    expect(hudLayout(aHud({ field }), top, area, barSize).fieldAt).toEqual([400 + 96, 300]);
  });

  it('hides the field out of the area', () => {
    const field = aField({ at: [350, 0, 0], direction: [1, 0, 0] });
    expect(hudLayout(aHud({ field }), top, area, barSize).fieldAt).toBeNull();
  });

  it('hides the field when its handle is out of the projection', () => {
    const field = aField();
    expect(hudLayout(aHud({ field }), () => null, area, barSize).fieldAt).toBeNull();
  });

  it('shows the field without a bar (no modes)', () => {
    const layout = hudLayout(aHud({ modes: [], field: aField() }), top, area, null);
    expect(layout).toEqual({ barAt: null, fieldAt: [496, 300] });
  });
});

describe('fieldText', () => {
  it('is the rounded number of the field, degrees for an angle; no field → empty', () => {
    expect(fieldText({ value: 12.345, unit: 'length' })).toBe('12.35');
    expect(fieldText({ value: Math.PI / 4, unit: 'angle' })).toBe('45');
    expect(fieldText(null)).toBe('');
  });
});

describe('fieldCommit', () => {
  const length = { value: 12.345, unit: 'length', dragging: false } as const;
  const angle = { value: Math.PI / 4, unit: 'angle', dragging: false } as const;

  it('reads millimetres as they are', () => {
    expect(fieldCommit('20,5', length)).toBe(20.5);
  });

  it('reads degrees and gives radians', () => {
    expect(fieldCommit('30', angle)).toBeCloseTo(degToRad(30));
  });

  it('untouched text (the rounded value) → null', () => {
    expect(fieldCommit('12.35', length)).toBeNull();
    expect(fieldCommit('45', angle)).toBeNull();
  });

  it('text that is not a number → null', () => {
    expect(fieldCommit('abc', length)).toBeNull();
    expect(fieldCommit('', angle)).toBeNull();
  });

  it('while dragging → null (the field only shows)', () => {
    expect(fieldCommit('20', { ...length, dragging: true })).toBeNull();
  });
});

describe('axisLetter', () => {
  it.each([
    ['x', 'X'],
    ['y', 'Y'],
    ['z', 'Z'],
    ['neutral', null],
  ] as const)('%s → %s', (tint, letter) => {
    expect(axisLetter(tint)).toBe(letter);
  });
});
