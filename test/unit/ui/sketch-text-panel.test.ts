import { describe, expect, it } from 'vitest';
import type { SketchState } from '@/sketcher';
import {
  createNewTextFocus,
  selectedText,
  textCommit,
  textFieldText,
  textFontLabel,
} from '@/ui/sketch-text-panel';
import type { PanelText } from '@/ui/sketch-text-panel';

// The section "Text" of the sketch panel (spec 12, "Text ve skice (M37)", Úprava and Nástroj Text).

type Entity = SketchState['entities'][number];
type Id = Entity['id'];
type ItemId = SketchState['selection'][number];

// Test ids are trusted.
const eid = (id: string): Id => id as Id;
const sid = (id: string): ItemId => id as ItemId;

function aText(id: string, over: Partial<PanelText> = {}): PanelText {
  return {
    kind: 'text',
    id: eid(id),
    text: 'Text',
    font: 'sans',
    height: 10,
    baseline: eid('l1'),
    contours: [],
    ...over,
  };
}

const POINT: Entity = { kind: 'point', id: eid('p1'), x: 0, y: 0 };

function state(
  entities: readonly Entity[],
  selection: readonly string[],
): Pick<SketchState, 'entities' | 'selection'> {
  return { entities, selection: selection.map(sid) };
}

describe('selectedText', () => {
  it('is the text when exactly one text is selected', () => {
    const t1 = aText('t1');
    expect(selectedText(state([POINT, t1], ['t1']))).toBe(t1);
  });

  it('is null for no selection, more items or another entity', () => {
    const entities = [POINT, aText('t1'), aText('t2')];
    expect(selectedText(state(entities, []))).toBeNull();
    expect(selectedText(state(entities, ['t1', 't2']))).toBeNull();
    expect(selectedText(state(entities, ['t1', 'p1']))).toBeNull();
    expect(selectedText(state(entities, ['p1']))).toBeNull();
    expect(selectedText(state(entities, ['c1']))).toBeNull();
  });
});

describe('textFieldText', () => {
  it('shows the string, the font and the height rounded like a dimension', () => {
    const text = aText('t1', { text: 'Ahoj', font: 'serif', height: 12.3456 });
    expect(textFieldText('text', text)).toBe('Ahoj');
    expect(textFieldText('font', text)).toBe('serif');
    expect(textFieldText('height', text)).toBe('12.35');
  });
});

describe('textFontLabel', () => {
  it('is the translation of sketch.font.<id>', () => {
    expect(textFontLabel((key) => `[${key}]`, 'mono')).toBe('[sketch.font.mono]');
  });
});

describe('textCommit (only the changed field, unparsable input not committed)', () => {
  const text = aText('t1', { text: 'Text', font: 'sans', height: 10 });

  it('commits a changed string as it is typed', () => {
    expect(textCommit('text', 'tinycad', text)).toEqual({ text: 'tinycad' });
    expect(textCommit('text', ' a ', text)).toEqual({ text: ' a ' });
  });

  it('does not commit an unchanged string', () => {
    expect(textCommit('text', 'Text', text)).toBeNull();
  });

  it('commits an empty string, the session decides it is invalid', () => {
    expect(textCommit('text', '', text)).toEqual({ text: '' });
  });

  it('commits a font of the list other than the current one', () => {
    expect(textCommit('font', 'mono', text)).toEqual({ font: 'mono' });
    expect(textCommit('font', 'sans', text)).toBeNull();
    expect(textCommit('font', 'comic', text)).toBeNull();
  });

  it('commits a positive height, with a decimal comma too', () => {
    expect(textCommit('height', '5', text)).toEqual({ height: 5 });
    expect(textCommit('height', ' 2,5 ', text)).toEqual({ height: 2.5 });
  });

  it('does not commit a height that is not a number or did not change', () => {
    expect(textCommit('height', '', text)).toBeNull();
    expect(textCommit('height', 'abc', text)).toBeNull();
    expect(textCommit('height', 'Infinity', text)).toBeNull();
    expect(textCommit('height', '10', text)).toBeNull();
  });

  it('commits a height that is a number but not > 0, the session decides it is invalid', () => {
    expect(textCommit('height', '0', text)).toEqual({ height: 0 });
    expect(textCommit('height', '-3', text)).toEqual({ height: -3 });
  });

  it('does not commit the rounded text of an unchanged height', () => {
    const exact = aText('t1', { height: 12.3456 });
    expect(textCommit('height', '12.35', exact)).toBeNull();
    expect(textCommit('height', '12.3', exact)).toEqual({ height: 12.3 });
  });
});

describe('createNewTextFocus (Nástroj Text: the panel focuses the string of a new text)', () => {
  it('reports a text that appeared and then became the only selection, once', () => {
    const next = createNewTextFocus(state([POINT], []));
    // The tool writes the text, then selects it (two states).
    expect(next(state([POINT, aText('t1')], []))).toBeNull();
    expect(next(state([POINT, aText('t1')], ['t1']))).toBe('t1');
    // Selected again later: no focus.
    expect(next(state([POINT, aText('t1')], []))).toBeNull();
    expect(next(state([POINT, aText('t1')], ['t1']))).toBeNull();
  });

  it('reports a text written and selected in one state', () => {
    const next = createNewTextFocus(state([], []));
    expect(next(state([aText('t1')], ['t1']))).toBe('t1');
  });

  it('ignores the texts of the sketch when the panel opened', () => {
    const next = createNewTextFocus(state([aText('t1')], []));
    expect(next(state([aText('t1')], ['t1']))).toBeNull();
  });

  it('ignores a new text selected together with other items', () => {
    const next = createNewTextFocus(state([POINT], []));
    expect(next(state([POINT, aText('t1')], ['t1', 'p1']))).toBeNull();
    expect(next(state([POINT, aText('t1')], ['t1']))).toBeNull();
  });

  it('forgets a new text when the selection changes to something else first', () => {
    const next = createNewTextFocus(state([POINT], []));
    expect(next(state([POINT, aText('t1')], []))).toBeNull();
    expect(next(state([POINT, aText('t1')], ['p1']))).toBeNull();
    expect(next(state([POINT, aText('t1')], ['t1']))).toBeNull();
  });

  it('keeps a new text while the selection stays', () => {
    const next = createNewTextFocus(state([POINT], ['p1']));
    expect(next(state([POINT, aText('t1')], ['p1']))).toBeNull();
    expect(next(state([POINT, aText('t1')], ['p1']))).toBeNull();
    expect(next(state([POINT, aText('t1')], ['t1']))).toBe('t1');
  });
});
