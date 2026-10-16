// Numeric input while drawing (spec 12, "Číselný vstup (M32)", Q090): the fields of a tool step
// at the cursor, like Fusion. A typed value is only a preview; Tab or Enter locks it, and a click
// takes only the locked values. Pure functions over an immutable model, no DOM.

import type { ViewKeyEvent } from '@/interaction';

export type InputFieldKind = 'length' | 'angle' | 'x' | 'y';

/** A field of a tool step; label = the i18n key `sketch.input.<id>`. */
export interface InputField {
  readonly id: string;
  readonly kind: InputFieldKind;
}

/** Text of a field: null = free (shows the value from the cursor); locked = locked by Tab or Enter. */
export interface NumericInput {
  readonly fields: readonly InputField[];
  readonly texts: readonly (string | null)[];
  readonly locked: readonly boolean[];
  readonly active: number;
}

/** Result of inputKey (spec: `{ readonly input; readonly commit }`). */
type InputKeyResult = { readonly input: NumericInput; readonly commit: boolean };

const DEG = Math.PI / 180;
const DIGIT = /^[0-9]$/;

export function emptyInput(fields: readonly InputField[]): NumericInput {
  return {
    fields,
    texts: fields.map(() => null),
    locked: fields.map(() => false),
    active: 0,
  };
}

/** A key over the input: null = the key does not belong to the input (the tool or actions go on). */
export function inputKey(input: NumericInput, e: ViewKeyEvent): InputKeyResult | null {
  if (e.mods.mod || e.mods.alt || e.inTextField || input.fields.length === 0) return null;
  const text = input.texts[input.active] ?? null;
  const locked = input.locked[input.active] === true;
  const spent = (next: NumericInput): InputKeyResult => ({ input: next, commit: false });

  if (DIGIT.test(e.key) || e.key === '.' || e.key === ',') {
    // A locked field starts again from an empty text, a free one from an empty text too.
    const base = locked || text === null ? '' : text;
    return spent(setActive(input, base + (e.key === ',' ? '.' : e.key), false));
  }
  if (e.key === '-') {
    // Only at the start of the text; elsewhere the key is spent and changes nothing.
    if (locked || text === null || text === '') return spent(setActive(input, '-', false));
    return spent(input);
  }
  switch (e.key) {
    case 'Backspace': {
      if (text === null) return null;
      const shorter = text.slice(0, -1);
      return spent(setActive(input, shorter === '' ? null : shorter, false));
    }
    case 'Tab': {
      const count = input.fields.length;
      const step = e.mods.shift ? count - 1 : 1;
      return spent({ ...lockActive(input), active: (input.active + step) % count });
    }
    case 'Enter': {
      const field = input.fields[input.active];
      // An invalid active field: spent, no commit.
      if (field !== undefined && text !== null && parseField(field, text) === null) {
        return spent(input);
      }
      return { input: lockActive(input), commit: true };
    }
    case 'Escape': {
      const touched = input.texts.some((t) => t !== null) || input.locked.some((l) => l);
      return touched ? spent(emptyInput(input.fields)) : null;
    }
    default:
      return null;
  }
}

/** Valid values of the locked fields by id: length in mm (> 0), angle in radians (from degrees), x and y in mm. For a click. */
export function lockedValues(input: NumericInput): ReadonlyMap<string, number> {
  const values = new Map<string, number>();
  input.fields.forEach((field, i) => {
    const text = input.texts[i] ?? null;
    if (input.locked[i] !== true || text === null) return;
    const value = parseField(field, text);
    if (value !== null) values.set(field.id, value);
  });
  return values;
}

/** lockedValues + the valid typed value of the active field (not locked yet). For the preview. */
export function previewValues(input: NumericInput): ReadonlyMap<string, number> {
  const values = new Map(lockedValues(input));
  const field = input.fields[input.active];
  const text = input.texts[input.active] ?? null;
  if (field !== undefined && text !== null && input.locked[input.active] !== true) {
    const value = parseField(field, text);
    if (value !== null) values.set(field.id, value);
  }
  return values;
}

/**
 * A field as SketchState.numericInput shows it (spec 12, "Náhled"): `text` is the typed or locked
 * text, otherwise the measured value rounded to 2 decimals (an angle in degrees).
 */
export interface InputFieldView {
  readonly id: string;
  readonly kind: InputFieldKind;
  readonly text: string;
  readonly typed: boolean;
  readonly locked: boolean;
  readonly valid: boolean;
  readonly active: boolean;
}

/**
 * The views of the fields of the input; `measured` are the values of the fields at the cursor
 * (ClickHandlers.measure: a length in mm, an angle in radians). A free field without a measured
 * value has an empty text.
 */
export function inputFieldViews(
  input: NumericInput,
  measured: ReadonlyMap<string, number>,
): readonly InputFieldView[] {
  return input.fields.map((field, i) => {
    const text = input.texts[i] ?? null;
    const value = measured.get(field.id);
    return {
      id: field.id,
      kind: field.kind,
      text: text ?? (value === undefined ? '' : formatMeasured(field, value)),
      typed: text !== null,
      locked: input.locked[i] === true,
      valid: text === null || parseField(field, text) !== null,
      active: i === input.active,
    };
  });
}

/** A measured value with 2 decimals, an angle in degrees; never "-0.00". */
function formatMeasured(field: InputField, value: number): string {
  const shown = field.kind === 'angle' ? value / DEG : value;
  const rounded = Math.round(shown * 100) / 100;
  return (rounded === 0 ? 0 : rounded).toFixed(2);
}

/** The value of a text in the unit of the field kind; null = invalid. */
function parseField(field: InputField, text: string): number | null {
  if (text === '') return null;
  // Number() accepts '1.' and '.5' and rejects '-', '.' and '1.2.3'; the keys allow nothing else.
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (field.kind === 'length') return value > 0 ? value : null;
  if (field.kind === 'angle') return value * DEG;
  return value;
}

/** The input with a new text of the active field and its lock. */
function setActive(input: NumericInput, text: string | null, locked: boolean): NumericInput {
  return {
    ...input,
    texts: input.texts.map((t, i) => (i === input.active ? text : t)),
    locked: input.locked.map((l, i) => (i === input.active ? locked : l)),
  };
}

/** Locks the active field when it has a valid text; otherwise the input stays. */
function lockActive(input: NumericInput): NumericInput {
  const field = input.fields[input.active];
  const text = input.texts[input.active] ?? null;
  if (field === undefined || text === null || parseField(field, text) === null) return input;
  return setActive(input, text, true);
}
