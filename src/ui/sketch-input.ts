// The numeric input of a drawing tool over the view (spec 12, "Číselný vstup (M32)"): the fields
// of the step as a row of small labels left and up from the projection of the anchor. A pure
// function of the projection, kept out of SketchInput.vue so it runs in Node tests. sketcher gives
// the fields and the anchor in the world (SketchState.numericInput), ui projects it. The labels
// are no <input>: the focus stays in the view, the keys go to the tool.

import type { Observable } from '@/core';
import type { SketchState } from '@/sketcher';
import type { Project, ScreenPoint } from './manipulator-hud';

/** What SketchInput needs of the sketch session: the numeric input. */
export interface InputSketch {
  readonly state: Observable<Pick<SketchState, 'numericInput'>>;
}

/** A field of SketchState.numericInput. */
export type InputFieldView = NonNullable<SketchState['numericInput']>['fields'][number];

export interface InputLayoutOptions {
  /** The distance of the bottom right corner of the row from the anchor, left and up. */
  readonly offsetPx: number;
}

/** The place of the row in the view (spec 12). */
export const INPUT_LAYOUT: InputLayoutOptions = Object.freeze({ offsetPx: 12 });

/** Where the row of labels is drawn: its bottom right corner in px of the view area. */
export interface InputPlacement {
  readonly at: ScreenPoint;
  readonly fields: readonly InputFieldView[];
}

/**
 * The row of the fields: its bottom right corner offsetPx left and up from the projection of the
 * anchor (the row grows to the left and up from there). null without an input or when the anchor
 * does not project.
 */
export function inputLayout(
  input: SketchState['numericInput'],
  project: Project,
  options: InputLayoutOptions = INPUT_LAYOUT,
): InputPlacement | null {
  const anchor = input === null ? null : project(input.anchor);
  if (input === null || anchor === null) return null;
  return {
    at: [anchor[0] - options.offsetPx, anchor[1] - options.offsetPx],
    fields: input.fields,
  };
}

/** The label of a field: `t('sketch.input.<id>')`. */
export function inputLabel(t: (key: string) => string, field: Pick<InputFieldView, 'id'>): string {
  return t(`sketch.input.${field.id}`);
}

/** The classes of the label of a field: active, locked, invalid (an invalid typed text), typed. */
export function inputClasses(field: InputFieldView): Readonly<Record<string, boolean>> {
  return {
    active: field.active,
    locked: field.locked,
    invalid: !field.valid,
    typed: field.typed,
  };
}
