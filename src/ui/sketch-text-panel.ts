import type { SketchState, TextParams } from '@/sketcher';
import { SKETCH_TEXT_FONTS } from '@/sketcher/constants';
import { formatDimension, parseNumber } from './components/params/field-values';

// The section "Text" of the SketchPanel (spec 12, "Text ve skice (M37)", Úprava): when exactly
// one text is selected, its string, font and height are fields; a changed value goes to
// SketchSession.setTextParams (only that field), which decides its validity; an unchanged or
// unparsable input is not committed and, like a refused one, the field shows the value of the
// text again. A text the Text tool has just written and selected gets the
// focus of its string field (Nástroj Text). Pure functions, so they run in Node tests; the
// component only binds them. ui may not import sketch, so the text is the member of
// SketchState.entities.

/** A text of the sketch as the panel reads it from SketchState.entities. */
export type PanelText = Extract<SketchState['entities'][number], { readonly kind: 'text' }>;

/** A font of a text (one of SKETCH_TEXT_FONTS). */
export type PanelTextFont = TextParams['font'];

/** The fields of the section. */
export type TextField = 'text' | 'font' | 'height';

/** The text when the selection is exactly one text, otherwise null. */
export function selectedText(state: Pick<SketchState, 'entities' | 'selection'>): PanelText | null {
  if (state.selection.length !== 1) return null;
  const [id] = state.selection;
  return state.entities.find((e): e is PanelText => e.kind === 'text' && e.id === id) ?? null;
}

/** What a field shows: the string, the font id, the height rounded like a dimension (mm). */
export function textFieldText(field: TextField, text: PanelText): string {
  switch (field) {
    case 'text':
      return text.text;
    case 'font':
      return text.font;
    case 'height':
      return formatDimension(text.height);
  }
}

/** The label of a font in the font field: `t('sketch.font.<id>')`. */
export function textFontLabel(t: (key: string) => string, font: PanelTextFont): string {
  return t(`sketch.font.${font}`);
}

/**
 * The params of setTextParams for the input of a field, or null when there is nothing to commit:
 * an unchanged value (the height also as its shown rounded text) or an input that is no value of
 * the field (a font out of the list, a height that is not a number). Whether a value is valid
 * (empty string, length, control characters, height > 0) decides the session, which answers false.
 */
export function textCommit(
  field: TextField,
  input: string,
  text: PanelText,
): Partial<TextParams> | null {
  switch (field) {
    case 'text':
      return input === text.text ? null : { text: input };
    case 'font': {
      const font = SKETCH_TEXT_FONTS.find((f) => f === input);
      return font === undefined || font === text.font ? null : { font };
    }
    case 'height': {
      if (input.trim() === textFieldText('height', text)) return null;
      const height = parseNumber(input);
      return height === null || height === text.height ? null : { height };
    }
  }
}

/**
 * Tells which text should get the focus of its string field: a text that appeared since the last
 * change of the selection and is now the only selection – what the Text tool does (it writes the
 * text, then selects it). Each text once; the texts of the sketch at `initial` never. Returns the
 * id of that text for a state, otherwise null.
 */
export function createNewTextFocus(
  initial: Pick<SketchState, 'entities' | 'selection'>,
): (state: Pick<SketchState, 'entities' | 'selection'>) => PanelText['id'] | null {
  const seen = new Set<string>(textIds(initial));
  let pending = new Set<string>();
  let selection = initial.selection;

  return (state) => {
    for (const id of textIds(state)) {
      if (seen.has(id)) continue;
      seen.add(id);
      pending.add(id);
    }
    const changed = !sameItems(selection, state.selection);
    selection = state.selection;
    const text = selectedText(state);
    if (text !== null && pending.has(text.id)) {
      pending = new Set();
      return text.id;
    }
    if (changed) pending = new Set();
    return null;
  };
}

function textIds(state: Pick<SketchState, 'entities'>): string[] {
  return state.entities.filter((e) => e.kind === 'text').map((e) => e.id);
}

function sameItems(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
