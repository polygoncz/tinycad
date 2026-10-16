import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import type { ScreenPoint } from '@/ui/manipulator-hud';
import { INPUT_LAYOUT, inputClasses, inputLabel, inputLayout } from '@/ui/sketch-input';
import type { InputFieldView } from '@/ui/sketch-input';

/** A top view 2 px = 1 mm with the origin at (100, 200); the point x = 99 does not project. */
const project = (world: Vec3): ScreenPoint | null =>
  world[0] === 99 ? null : [100 + 2 * world[0], 200 - 2 * world[1]];

function aField(overrides: Partial<InputFieldView> = {}): InputFieldView {
  return {
    id: 'length',
    kind: 'length',
    text: '50.00',
    typed: false,
    locked: false,
    valid: true,
    active: true,
    ...overrides,
  };
}

describe('inputLayout (spec 12, "Číselný vstup (M32)")', () => {
  it('has the offset of the spec by default', () => {
    expect(INPUT_LAYOUT).toEqual({ offsetPx: 12 });
  });

  it('puts the bottom right corner of the row offsetPx left and up from the projected anchor', () => {
    const fields = [aField(), aField({ id: 'angle', kind: 'angle', active: false })];
    expect(inputLayout({ anchor: [5, 10, 0], fields }, project)).toEqual({
      at: [98, 168],
      fields,
    });
  });

  it('takes the offset from the options', () => {
    expect(
      inputLayout({ anchor: [0, 0, 0], fields: [aField()] }, project, { offsetPx: 0 })?.at,
    ).toEqual([100, 200]);
  });

  it('is null without an input or when the anchor does not project', () => {
    expect(inputLayout(null, project)).toBeNull();
    expect(inputLayout({ anchor: [99, 0, 0], fields: [aField()] }, project)).toBeNull();
  });
});

describe('inputLabel and inputClasses', () => {
  it('translates sketch.input.<id>', () => {
    expect(inputLabel((key) => `<${key}>`, { id: 'diameter' })).toBe('<sketch.input.diameter>');
  });

  it('marks the active, locked, invalid and typed fields', () => {
    expect(inputClasses(aField())).toEqual({
      active: true,
      locked: false,
      invalid: false,
      typed: false,
    });
    expect(
      inputClasses(aField({ active: false, locked: true, valid: false, typed: true })),
    ).toEqual({ active: false, locked: true, invalid: true, typed: true });
  });
});
