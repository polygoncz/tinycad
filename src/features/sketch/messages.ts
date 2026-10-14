import type { PluginMessages } from '@/plugin-api';

// Texts of the translation keys of the sketch (ADR 0014): the schema labels and the issue codes
// of parseSketchData; ui adds these dictionaries to vue-i18n.

export const sketchMessages: PluginMessages = Object.freeze<PluginMessages>({
  cs: Object.freeze({
    'sketch.label': 'Skica',
    'sketch.plane': 'Rovina',
    'sketch.entities': 'Entity',
    'sketch.constraints': 'Vazby',
    'sketch.invalidEntity': 'Neplatná entita skici {index}',
    'sketch.invalidConstraint': 'Neplatná vazba skici {index}',
  }),
  en: Object.freeze({
    'sketch.label': 'Sketch',
    'sketch.plane': 'Plane',
    'sketch.entities': 'Entities',
    'sketch.constraints': 'Constraints',
    'sketch.invalidEntity': 'Invalid sketch entity {index}',
    'sketch.invalidConstraint': 'Invalid sketch constraint {index}',
  }),
});
