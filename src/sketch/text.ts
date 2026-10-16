import type { TextContour, TextFontId } from './model';

// Sketch text (spec 12 "Text ve skice (M37)", ADR 0029). The TextOutliner port turns a string into
// letter outlines; the adapter lives in text-opentype (opentype.js and the bundled fonts), tests
// use the fake outliner from testing.ts.

/** Port: letter outlines of a one-line text in its local coordinates (x along the baseline, y up, mm). */
export interface TextOutliner {
  outline(p: {
    readonly text: string;
    readonly font: TextFontId;
    readonly height: number;
  }): Promise<readonly TextContour[]>;
  /** Width of the baseline (advance after the last character) in mm – the length of the anchor line of a new text. */
  advance(p: {
    readonly text: string;
    readonly font: TextFontId;
    readonly height: number;
  }): Promise<number>;
}
