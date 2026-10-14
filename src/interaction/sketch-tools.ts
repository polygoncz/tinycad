// Tools of the sketcher (spec 10, "Nástroje a akce skicáře"): the entry tool 'sketch' and the
// tools inside the sketch mode. Ú12 of M12 fills them in; the signature is final already.

import type { SketchEditor } from './sketch-editor';
import type { ToolDescriptor } from './tools';

const NO_TOOLS: readonly ToolDescriptor[] = Object.freeze([]);

/** Ú12: the tools come in the next wave of M12; until then there are none. */
export const createSketchTools: (deps: {
  sketches: SketchEditor;
}) => readonly ToolDescriptor[] = () => NO_TOOLS;
