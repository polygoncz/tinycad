// Built-in English texts of ui (ADR 0014). Same keys as cs.ts (checked by a test).

export const en: Readonly<Record<string, string>> = Object.freeze({
  // Codes of validateAgainstSchema (spec 03, "Schéma featury").
  'param.missing': 'Value is missing',
  'param.unexpected': 'Unknown parameter',
  'param.wrongType': 'Invalid value',
  'param.notInteger': 'Must be a whole number',
  'param.belowMin': 'Must be at least {min}',
  'param.atOrBelowMin': 'Must be greater than {min}',
  'param.aboveMax': 'Must be at most {max}',
  'param.atOrAboveMax': 'Must be less than {max}',
  'param.unknownOption': 'Unknown option',
  'param.tooFewRefs': 'Select at least {min}',
  'param.tooManyRefs': 'Select at most {max}',
  'param.invalidRef': 'Invalid selection item',

  // Keys handed over by the domain and interaction.
  'document.untitled': 'Untitled',
  'feature.edit': 'Edit feature',
  'browser.body': 'Body {n}',

  // Param fields.
  'field.refs.count': 'Selected: {n}',
  'field.refs.pick': 'Select in the view',
});
