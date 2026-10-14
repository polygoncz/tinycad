// The mode of the editor (spec 10, "Režim"): 'sketch' exactly while a SketchSession is open
// (SketchEditor.mode). It has no state or commands of its own; tools and actions only say in
// which modes they exist.

export type Mode = 'model' | 'sketch';

export const ALL_MODES: readonly Mode[] = Object.freeze(['model', 'sketch']);
