import { describe, expect, it } from 'vitest';
import type { KeyMods, ViewKeyEvent } from '@/interaction';
import { emptyInput, inputKey, lockedValues, previewValues } from '@/sketcher/numeric-input';
import type { InputField, NumericInput } from '@/sketcher/numeric-input';

const LENGTH_ANGLE: readonly InputField[] = [
  { id: 'length', kind: 'length' },
  { id: 'angle', kind: 'angle' },
];
const XY: readonly InputField[] = [
  { id: 'x', kind: 'x' },
  { id: 'y', kind: 'y' },
];

function key(k: string, mods: Partial<KeyMods> = {}, inTextField = false): ViewKeyEvent {
  return { key: k, mods: { shift: false, alt: false, mod: false, ...mods }, inTextField };
}

/** Feeds the keys one by one; every key must belong to the input. */
function type(input: NumericInput, keys: readonly (string | ViewKeyEvent)[]): NumericInput {
  return keys.reduce((acc, k) => {
    const result = inputKey(acc, typeof k === 'string' ? key(k) : k);
    if (result === null) throw new Error(`Key ${JSON.stringify(k)} did not belong to the input`);
    return result.input;
  }, input);
}

// Only ASCII digits, signs and points: code units are characters.
const chars = (text: string): readonly string[] => Array.from(text);

describe('emptyInput', () => {
  it('starts with free unlocked fields and the first one active', () => {
    expect(emptyInput(LENGTH_ANGLE)).toEqual({
      fields: LENGTH_ANGLE,
      texts: [null, null],
      locked: [false, false],
      active: 0,
    });
  });
});

describe('inputKey – typing', () => {
  it.each([
    ['digits', '125', '125'],
    ['a decimal point', '12.5', '12.5'],
    ['a comma as the decimal point', '12,5', '12.5'],
    ['a minus at the start', '-3', '-3'],
  ])('appends %s to the active field', (_name, typed, text) => {
    const input = type(emptyInput(XY), chars(typed));
    expect(input.texts).toEqual([text, null]);
    expect(input.locked).toEqual([false, false]);
  });

  it('a minus after the start is spent and changes nothing', () => {
    const input = type(emptyInput(XY), chars('12'));
    expect(inputKey(input, key('-'))).toEqual({ input, commit: false });
  });

  it('typing never commits', () => {
    expect(inputKey(emptyInput(XY), key('1'))?.commit).toBe(false);
  });

  it('typing into the locked active field unlocks it and starts again', () => {
    const locked = type(emptyInput(LENGTH_ANGLE), [
      '5',
      '0',
      'Tab',
      '3',
      key('Tab', { shift: true }),
    ]);
    expect(locked.active).toBe(0);
    expect(locked.locked).toEqual([true, true]);
    const input = type(locked, ['7']);
    expect(input.texts).toEqual(['7', '3']);
    expect(input.locked).toEqual([false, true]);
  });

  it('a minus into the locked active field starts a new negative text', () => {
    const locked = type(emptyInput(XY), ['5', 'Enter']);
    expect(type(locked, ['-']).texts).toEqual(['-', null]);
  });

  it('digits with Shift still type (layouts with digits on Shift)', () => {
    expect(type(emptyInput(XY), [key('4', { shift: true })]).texts).toEqual(['4', null]);
  });
});

describe('inputKey – keys that do not belong to the input', () => {
  it.each([
    ['with Ctrl/Cmd', key('1', { mod: true })],
    ['with Alt', key('1', { alt: true })],
    ['in a text field', key('1', {}, true)],
    ['a letter', key('l')],
    ['Delete', key('Delete')],
    ['Tab with Ctrl/Cmd', key('Tab', { mod: true })],
    ['Enter in a text field', key('Enter', {}, true)],
  ])('%s → null', (_name, e) => {
    expect(inputKey(emptyInput(XY), e)).toBeNull();
  });

  it('every key → null without fields', () => {
    expect(inputKey(emptyInput([]), key('1'))).toBeNull();
    expect(inputKey(emptyInput([]), key('Enter'))).toBeNull();
  });
});

describe('inputKey – Backspace', () => {
  it('removes the last character', () => {
    expect(type(emptyInput(XY), ['1', '2', 'Backspace']).texts).toEqual(['1', null]);
  });

  it('an empty text frees the field', () => {
    expect(type(emptyInput(XY), ['1', 'Backspace']).texts).toEqual([null, null]);
  });

  it('unlocks the locked field', () => {
    const input = type(emptyInput(XY), ['1', '2', 'Enter', 'Backspace']);
    expect(input.texts).toEqual(['1', null]);
    expect(input.locked).toEqual([false, false]);
  });

  it('a free field → null', () => {
    expect(inputKey(emptyInput(XY), key('Backspace'))).toBeNull();
  });
});

describe('inputKey – Tab and Shift+Tab', () => {
  it('Tab locks the active field with a valid text and moves to the next one', () => {
    const result = inputKey(type(emptyInput(LENGTH_ANGLE), ['5', '0']), key('Tab'));
    expect(result?.commit).toBe(false);
    expect(result?.input.locked).toEqual([true, false]);
    expect(result?.input.active).toBe(1);
  });

  it('cycles: after the last field comes the first', () => {
    expect(type(emptyInput(LENGTH_ANGLE), ['Tab', 'Tab']).active).toBe(0);
  });

  it('Shift+Tab moves to the previous field, cyclically', () => {
    expect(type(emptyInput(LENGTH_ANGLE), [key('Tab', { shift: true })]).active).toBe(1);
  });

  it('Shift+Tab locks the active field too', () => {
    const input = type(emptyInput(LENGTH_ANGLE), ['Tab', '3', '0', key('Tab', { shift: true })]);
    expect(input.locked).toEqual([false, true]);
    expect(input.active).toBe(0);
  });

  it('without a text only moves', () => {
    const input = type(emptyInput(LENGTH_ANGLE), ['Tab']);
    expect(input.texts).toEqual([null, null]);
    expect(input.locked).toEqual([false, false]);
    expect(input.active).toBe(1);
  });

  it('an invalid text does not lock, the field keeps it', () => {
    const input = type(emptyInput(LENGTH_ANGLE), ['-', '5', 'Tab']);
    expect(input.texts).toEqual(['-5', null]);
    expect(input.locked).toEqual([false, false]);
    expect(input.active).toBe(1);
  });

  it('a single field stays active', () => {
    expect(type(emptyInput([{ id: 'diameter', kind: 'length' }]), ['Tab']).active).toBe(0);
  });
});

describe('inputKey – Enter', () => {
  it('locks the active field with a valid text and commits', () => {
    const result = inputKey(type(emptyInput(XY), ['5']), key('Enter'));
    expect(result).toEqual({
      input: { fields: XY, texts: ['5', null], locked: [true, false], active: 0 },
      commit: true,
    });
  });

  it('commits without any value (a click on the cursor)', () => {
    const input = emptyInput(XY);
    expect(inputKey(input, key('Enter'))).toEqual({ input, commit: true });
  });

  it('an invalid active field: spent, nothing happens', () => {
    const input = type(emptyInput(LENGTH_ANGLE), ['0']);
    expect(inputKey(input, key('Enter'))).toEqual({ input, commit: false });
  });
});

describe('inputKey – Escape', () => {
  it('with a typed field clears the input', () => {
    expect(inputKey(type(emptyInput(XY), ['5']), key('Escape'))).toEqual({
      input: emptyInput(XY),
      commit: false,
    });
  });

  it('with a locked field clears the input', () => {
    const locked = type(emptyInput(XY), ['5', 'Tab']);
    expect(inputKey(locked, key('Escape'))?.input).toEqual(emptyInput(XY));
  });

  it('without typed or locked fields → null (the tool handles Esc)', () => {
    expect(inputKey(type(emptyInput(XY), ['Tab']), key('Escape'))).toBeNull();
  });
});

describe('validity and values', () => {
  const RAD = Math.PI / 180;

  it.each<[string, InputField, string, number | undefined]>([
    ['a length', { id: 'length', kind: 'length' }, '50', 50],
    ['a decimal length', { id: 'length', kind: 'length' }, '2.5', 2.5],
    ['a zero length', { id: 'length', kind: 'length' }, '0', undefined],
    ['a negative length', { id: 'length', kind: 'length' }, '-5', undefined],
    ['a minus alone', { id: 'x', kind: 'x' }, '-', undefined],
    ['a point alone', { id: 'x', kind: 'x' }, '.', undefined],
    ['two points', { id: 'x', kind: 'x' }, '1.2.3', undefined],
    ['a negative coordinate', { id: 'x', kind: 'x' }, '-12.5', -12.5],
    ['a zero coordinate', { id: 'y', kind: 'y' }, '0', 0],
    ['an angle in degrees', { id: 'angle', kind: 'angle' }, '30', 30 * RAD],
    ['a negative angle', { id: 'angle', kind: 'angle' }, '-90', -90 * RAD],
    ['a leading point', { id: 'x', kind: 'x' }, '.5', 0.5],
  ])('%s: %s', (_name, field, typed, value) => {
    const typedInput = type(emptyInput([field]), chars(typed));
    const preview = previewValues(typedInput);
    expect(preview.get(field.id)).toBe(value);
    // Tab locks only a valid text; lockedValues has exactly the valid ones.
    const tabbed = type(typedInput, ['Tab']);
    expect(tabbed.locked).toEqual([value !== undefined]);
    if (value === undefined) expect(lockedValues(tabbed).size).toBe(0);
    else expect(lockedValues(tabbed).get(field.id)).toBeCloseTo(value);
  });

  it('previewValues has the typed active field, lockedValues does not', () => {
    const input = type(emptyInput(LENGTH_ANGLE), ['5', '0', 'Tab', '3', '0']);
    expect([...lockedValues(input)]).toEqual([['length', 50]]);
    expect(previewValues(input).get('length')).toBe(50);
    expect(previewValues(input).get('angle')).toBeCloseTo(Math.PI / 6);
  });

  it('a typed field that is not active is in neither (left with an invalid text)', () => {
    const input = type(emptyInput(LENGTH_ANGLE), ['0', 'Tab']);
    expect(previewValues(input).size).toBe(0);
    expect(lockedValues(input).size).toBe(0);
  });

  it('an empty input has no values', () => {
    expect(previewValues(emptyInput(XY)).size).toBe(0);
    expect(lockedValues(emptyInput(XY)).size).toBe(0);
  });
});
